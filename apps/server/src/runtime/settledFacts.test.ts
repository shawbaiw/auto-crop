import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Company, NextStepItem, Proof, Task, TaskCompletionEvent, VerificationRework } from "@auto-crop/core";
import type { AgentAdapter, AgentRunRequest } from "../adapters/types";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { runSchedulerOnce } from "./scheduler";
import { renderSettledFacts, resolveSettledFacts } from "./settledFacts";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveSettledFacts", () => {
  it("gives a task the Founder Decisions resolved on it, and not ones returned or on another task", () => {
    const { repositories, client } = createFixture([task("task_1"), task("task_2")]);
    repositories.appendTaskCompletionEvent(completionEvent("event_a", "task_1", [decisionItem("pricing_model")]));
    repositories.appendTaskCompletionEvent(completionEvent("event_b", "task_1", [decisionItem("target_market")]));
    repositories.appendTaskCompletionEvent(completionEvent("event_c", "task_2", [decisionItem("launch_target")]));
    resolveDecision(repositories, "event_a_founder_decision_1", "task_1", "resolved", "Option A");
    resolveDecision(repositories, "event_b_founder_decision_1", "task_1", "returned", null);
    resolveDecision(repositories, "event_c_founder_decision_1", "task_2", "resolved", "Option B");

    expect(resolveSettledFacts(repositories, repositories.getTask("task_1")!)).toEqual([
      {
        kind: "founder_decision",
        sourceId: "event_a_founder_decision_1",
        settledAt: "2026-10-01T01:00:00.000Z",
        decisionKind: "pricing_model",
        chosenOption: "Option A",
      },
    ]);
    client.close();
  });

  it("gives a task the confirmed Human Actions on it and the ones that gated it, each naming who asked", () => {
    const { repositories, client } = createFixture([task("task_1"), task("task_2"), task("task_3")]);
    // task_1's delivery asks for two actions: one gating task_2, one gating task_3. task_2 asks for its own.
    repositories.appendTaskCompletionEvent(completionEvent("event_a", "task_1", [
      humanActionItem("Register the domain", ["task_2"]),
      humanActionItem("Open the ad account", ["task_3"]),
    ]));
    repositories.appendTaskCompletionEvent(completionEvent("event_b", "task_2", [humanActionItem("Look up five KD values", [])]));
    confirm(repositories, "event_a_human_action_1", { domain: "example.com" });
    confirm(repositories, "event_a_human_action_2", { account: "acct-1" });
    // event_b's action stays pending: an unconfirmed request is not a fact.

    const facts = resolveSettledFacts(repositories, repositories.getTask("task_2")!);
    expect(facts).toEqual([
      expect.objectContaining({
        kind: "human_action_confirmation",
        sourceId: "event_a_human_action_1",
        requestedByTaskId: "task_1",
        requestedByTaskTitle: "Task task_1",
        evidence: { domain: "example.com" },
      }),
    ]);

    confirm(repositories, "event_b_human_action_1", { kd: "keyword-a: 12" });
    expect(resolveSettledFacts(repositories, repositories.getTask("task_2")!).map((fact) => fact.sourceId))
      .toEqual(["event_a_human_action_1", "event_b_human_action_1"]);
    client.close();
  });

  it("gives a producer the rework it owes, only its own checks, and drops it once redelivered", () => {
    const { repositories, client } = createFixture([task("task_1"), task("task_2"), task("task_3")]);
    repositories.recordVerificationRework(rework({
      producerTaskIds: ["task_1", "task_2"],
      failedChecks: [
        { requirement_id: "r1", outcome: "failed", evidence: "broken on task_1", description: "R1", target_task_id: "task_1" },
        { requirement_id: "r2", outcome: "failed", evidence: "broken everywhere", description: "R2" },
      ],
    }));

    const [fact] = resolveSettledFacts(repositories, repositories.getTask("task_2")!);
    expect(fact).toMatchObject({ kind: "verification_rework", sourceId: "rework_1", verifierTitle: "Task task_3", round: 1 });
    expect(fact?.kind === "verification_rework" && fact.failedChecks.map((check) => check.requirementId)).toEqual(["r2"]);

    repositories.markReworkRedelivered("rework_1", "task_2");
    expect(resolveSettledFacts(repositories, repositories.getTask("task_2")!)).toEqual([]);
    expect(resolveSettledFacts(repositories, repositories.getTask("task_1")!)).toHaveLength(1);
    client.close();
  });
});

describe("renderSettledFacts", () => {
  it("states each fact with its source under one rule, and nothing when there are none", () => {
    expect(renderSettledFacts([])).toEqual([]);
    const lines = renderSettledFacts([
      { kind: "founder_decision", sourceId: "fd_1", settledAt: "2026-10-01T00:00:00.000Z", decisionKind: "target_market", chosenOption: "Solo founders" },
      {
        kind: "human_action_confirmation", sourceId: "ha_1", settledAt: "2026-10-02T00:00:00.000Z", label: "Look up KD",
        requestedByTaskId: "task_1", requestedByTaskTitle: "Pick keywords", evidence: { kd: "keyword-a: 12" },
      },
    ]).join("\n");
    expect(lines).toContain("## Settled Facts");
    expect(lines).toContain("do not ask for, re-decide, or contradict it");
    expect(lines).toContain("Founder Decision `fd_1` (target_market)");
    expect(lines).toContain("the founder chose \"Solo founders\"");
    expect(lines).toContain("Human Action Confirmation `ha_1` \"Look up KD\", asked for by task \"Pick keywords\"");
    expect(lines).toContain("  - kd: keyword-a: 12");
  });
});

describe("Settled Facts at dispatch", () => {
  // The ADR 0043 scenario: a keyword task the founder already answered runs again (rework, recovery,
  // a revision). Whatever caused the re-run, the run is told what was settled — through the brief as
  // well as the work prompt — and never by reading a file in its workspace.
  it("tells every run of the task, brief and work alike, what was settled for it", async () => {
    const { repositories, client, projectRoot } = createFixture([task("task_1", "queued")]);
    repositories.appendTaskCompletionEvent(completionEvent("event_a", "task_1", [decisionItem("target_market")]));
    resolveDecision(repositories, "event_a_founder_decision_1", "task_1", "resolved", "Solo founders");
    const prompts: Record<string, string> = {};

    const result = await runSchedulerOnce({
      projectRoot,
      repositories,
      adapters: [recordingAdapter(prompts)],
      workerId: "worker_a",
      maxTasks: 1,
      now: () => new Date("2026-10-05T00:00:00.000Z"),
      createId: sequentialIds(),
      approvalRequired: () => false,
      proofCollector: ({ task: running }) => [proofFor(running)],
      emit: () => undefined,
    });

    expect(result.completed).toEqual(["task_1"]);
    for (const phase of ["execution_brief", "work"]) {
      expect(prompts[phase]).toContain("## Settled Facts");
      expect(prompts[phase]).toContain("the founder chose \"Solo founders\"");
    }
    client.close();
  });
});

function recordingAdapter(prompts: Record<string, string>): AgentAdapter {
  return {
    id: "mock-worker",
    name: "Mock Worker",
    capabilities: ["code"],
    contractCapabilities: ["artifact_envelope", "structured_execution_brief"],
    detect: async () => true,
    run: async (request: AgentRunRequest) => {
      if (request.metadata.phase === "execution_brief") {
        prompts.execution_brief = request.prompt;
        return { status: "complete", exitCode: 0, stdout: JSON.stringify({ purpose: "p", approach: "a", expectedOutcome: "e" }), stderr: "" };
      }
      prompts.work = request.prompt;
      request.runtimeActions!.submitArtifactEnvelope(validDelivery(request.taskId));
      return { status: "complete", exitCode: 0, stdout: "done", stderr: "" };
    },
  };
}

function createFixture(tasks: Task[]) {
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-settled-facts-"));
  createdDirs.push(projectRoot);
  const client = createDatabaseClient(":memory:");
  migrate(client);
  const repositories = createRepositories(client);
  repositories.createCompany(company());
  repositories.createDepartment({
    id: "department_1", companyId: "company_1", name: "Research", responsibility: "Research.", leadAgentId: "codex",
    memoryPath: ".auto-crop/companies/company_1/departments/research/Memory.md",
  });
  repositories.createObjective({ id: "objective_1", companyId: "company_1", title: "Find a keyword", status: "active", priority: 1 });
  repositories.createKeyResult({
    id: "key_result_1", objectiveId: "objective_1", title: "Pick one keyword", metricName: "keyword",
    targetValue: "picked", currentValue: "none", status: "active",
  });
  for (const entry of tasks) {
    repositories.createTask(entry);
  }
  return { repositories, client, projectRoot };
}

function company(): Company {
  return {
    id: "company_1", name: "Keyword Studio", founderVision: "Find a low-competition keyword and ship a tool.", locale: "en",
    selectedCeoAgentId: "codex", playbookId: "ai-saas", status: "active",
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function task(id: string, status: Task["status"] = "complete"): Task {
  return {
    id, companyId: "company_1", departmentId: "department_1", keyResultId: "key_result_1", title: `Task ${id}`,
    description: "Run mock work.", assigneeAgentId: "mock-worker", requiredCapabilities: ["code"], proofSchemaId: "test-output",
    workspacePath: null, status, riskLevel: "low", position: Number(id.split("_").at(-1)) - 1,
  };
}

function completionEvent(id: string, taskId: string, nextStepItems: NextStepItem[]): TaskCompletionEvent {
  return {
    id, companyId: "company_1", taskId, departmentId: "department_1", keyResultId: "key_result_1", businessArtifactId: null,
    outcome: "awaiting_founder_decision", dependencyImpact: {}, nextStepItems, visionGaps: [], createdAt: "2026-10-01T00:00:00.000Z",
  } as TaskCompletionEvent;
}

function decisionItem(decisionKind: string): NextStepItem {
  return {
    type: "founder_decision", label: `Founder decision: ${decisionKind}`, ownerDepartmentId: "department_1", relatedTaskId: null,
    relatedBusinessArtifactId: null, severity: "strategic", priority: null, evidenceRequirements: [],
    dependencyImpact: {
      founderDecision: {
        decisionKind,
        options: [{ label: "Option A", tradeoffs: "a" }, { label: "Option B", tradeoffs: "b" }, { label: "Solo founders", tradeoffs: "c" }],
        rationale: "r",
      },
    },
  } as NextStepItem;
}

function humanActionItem(label: string, blockedTaskIds: string[]): NextStepItem {
  return {
    type: "human_action", label, ownerDepartmentId: "department_1", relatedTaskId: null, relatedBusinessArtifactId: null,
    severity: "blocking", priority: null, evidenceRequirements: ["value"], dependencyImpact: { blockedTaskIds },
  } as NextStepItem;
}

function resolveDecision(
  repositories: ReturnType<typeof createRepositories>,
  founderDecisionId: string,
  taskId: string,
  status: "resolved" | "returned",
  chosenOption: string | null,
) {
  repositories.upsertFounderDecisionResolution({
    founderDecisionId, companyId: "company_1", taskId, status, chosenOption,
    returnReason: status === "returned" ? "direction_wrong" : null, note: null, resolvedAt: "2026-10-01T01:00:00.000Z",
  } as Parameters<typeof repositories.upsertFounderDecisionResolution>[0]);
}

function confirm(repositories: ReturnType<typeof createRepositories>, humanActionId: string, evidence: Record<string, string>) {
  repositories.upsertHumanActionConfirmation({
    humanActionId, companyId: "company_1", evidence, status: "confirmed", verifiedAt: `2026-10-02T00:00:0${humanActionId.at(-1)}.000Z`,
    verificationErrors: [],
  });
}

function rework(overrides: { producerTaskIds: string[]; failedChecks: Array<Record<string, string>> }): VerificationRework {
  return {
    id: "rework_1", companyId: "company_1", verifierTaskId: "task_3", failedArtifactId: "artifact_v", round: 1,
    decision: "rework_producers", producerTaskIds: overrides.producerTaskIds, redeliveredTaskIds: [],
    failedChecks: overrides.failedChecks.map((check) => ({
      requirementId: check.requirement_id!, outcome: check.outcome, evidence: check.evidence!, description: check.description!,
      ...(check.target_task_id ? { targetTaskId: check.target_task_id } : {}),
    })) as VerificationRework["failedChecks"],
    createdAt: "2026-10-03T00:00:00.000Z",
  };
}

function proofFor(running: Task): Proof {
  return { id: `proof_${running.id}`, taskId: running.id, type: "command_output", uri: "agent.log", summary: "mock proof", verifiedAt: null };
}

function validDelivery(taskId: string): unknown {
  return {
    artifact_kind: "deliverable",
    artifact_role: "findings",
    artifact_subtype: "keyword_research",
    task_type: "research.keyword",
    payload: {
      execution_report: {
        work_summary: "Compared candidate keywords.", evidence: "Founder-supplied KD values.",
        conclusion: "keyword-a is the pick.", vision_impact: "Gives the tool a target.",
        remaining_gap: "Demand is unvalidated.", recommendation: "Build around keyword-a.",
      },
      outcome_summary: "keyword-a is the pick; demand is still unvalidated.",
      actions: [],
    },
    lineage: { task_id: taskId },
  };
}

function sequentialIds(): (prefix: string) => string {
  let counter = 0;
  return (prefix) => `${prefix}_${++counter}`;
}
