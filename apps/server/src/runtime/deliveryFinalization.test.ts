import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Company, Department, KeyResult, Objective, Task } from "@auto-crop/core";
import type { AgentAdapter, AgentRunRequest } from "../adapters/types";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { acceptTaskBusinessArtifact } from "./businessAcceptance";
import { finalizeDelivery } from "./deliveryFinalization";
import { runSchedulerOnce } from "./scheduler";
import { refreshTaskDependencyState } from "./taskRefresh";

/**
 * One delivery policy, two entry points. Every case is delivered once by a finished Agent Run and once by
 * proof recovered through refresh, and both must leave the task in the same place. A second copy of this
 * decision is how a recovered subtask once skipped its Founder Decision.
 */

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

type Entry = "agent_run" | "proof_recovery";

const RISKY_TEXT = "Next we go live on a custom domain.";
const DECISION = {
  decisionKind: "pricing_model",
  options: [
    { label: "Flat", tradeoffs: "Predictable." },
    { label: "Usage", tradeoffs: "Scales." },
  ],
  recommended_option_index: 0,
  rationale: "Buyers want a predictable bill.",
  briefing: "Two pricing shapes fit; the founder picks.",
};

type Case = {
  name: string;
  subtask: boolean;
  risky?: boolean;
  decision?: boolean;
  expected: Outcome;
};

type Outcome = {
  status: Task["status"];
  holds: string[];
  reviewStatus: string;
  keyResult: string;
  completionOutcomes: string[];
};

const MATRIX: Case[] = [
  {
    name: "an eligible ordinary deliverable is accepted automatically",
    subtask: false,
    expected: { status: "complete", holds: [], reviewStatus: "accepted", keyResult: "accepted_business_artifact", completionOutcomes: ["accepted"] },
  },
  {
    name: "a risky ordinary deliverable goes to CEO review",
    subtask: false,
    risky: true,
    expected: { status: "review", holds: ["awaiting_ceo_review"], reviewStatus: "unreviewed", keyResult: "not_started", completionOutcomes: [] },
  },
  {
    name: "an ordinary deliverable declaring a Founder Decision waits for the founder",
    subtask: false,
    decision: true,
    expected: { status: "review", holds: ["awaiting_founder_decision"], reviewStatus: "unreviewed", keyResult: "not_started", completionOutcomes: ["awaiting_founder_decision"] },
  },
  {
    name: "for an ordinary deliverable a risk hit outranks a declared decision",
    subtask: false,
    risky: true,
    decision: true,
    expected: { status: "review", holds: ["awaiting_ceo_review"], reviewStatus: "unreviewed", keyResult: "not_started", completionOutcomes: [] },
  },
  {
    name: "a subtask delivery is internal",
    subtask: true,
    expected: { status: "review", holds: ["awaiting_parent_aggregation"], reviewStatus: "unreviewed", keyResult: "not_started", completionOutcomes: [] },
  },
  {
    name: "a subtask delivery is never risk-scanned",
    subtask: true,
    risky: true,
    expected: { status: "review", holds: ["awaiting_parent_aggregation"], reviewStatus: "unreviewed", keyResult: "not_started", completionOutcomes: [] },
  },
  {
    name: "a subtask declaring a Founder Decision waits for the founder",
    subtask: true,
    decision: true,
    expected: { status: "review", holds: ["awaiting_founder_decision"], reviewStatus: "unreviewed", keyResult: "not_started", completionOutcomes: ["awaiting_founder_decision"] },
  },
];

describe("delivery finalization outcome matrix", () => {
  for (const testCase of MATRIX) {
    it(`${testCase.name}, through both entry points`, async () => {
      const outcomes: Record<Entry, Outcome> = {
        agent_run: await deliver("agent_run", testCase),
        proof_recovery: await deliver("proof_recovery", testCase),
      };

      expect(outcomes.agent_run).toEqual(testCase.expected);
      expect(outcomes.proof_recovery).toEqual(testCase.expected);
    });
  }

  it("keeps a recovered delivery where it is while a Hold it does not answer is open", () => {
    const fixture = createFixture();
    const task = createDeliveringTask(fixture, { subtask: false, status: "failed" });
    fixture.repositories.updateTaskExecutionSummary(task.id, { latestFailureReason: "no_proof", latestFailureMessage: "no proof" });
    openHold(fixture, task, "invalid_business_artifact", "runtime");
    openHold(fixture, task, "awaiting_founder_approval", "founder");
    writeWorkspaceDelivery(task.workspacePath!, {});

    const result = refreshTaskDependencyState({ repositories: fixture.repositories, taskId: task.id, proofSchemas: PROOF_SCHEMAS });

    expect(result.task.status).toBe("failed");
    expect(fixture.repositories.listOpenTaskHolds(task.id).map((hold) => hold.kind)).toEqual(["awaiting_founder_approval"]);
    expect(fixture.repositories.getCurrentBusinessArtifactForTask(task.id)?.reviewStatus).toBe("unreviewed");
    expect(result.recovery?.message).toBe("Found checkable proof, but the task is still held for another reason.");
  });

  it("records an acceptance and a Founder Decision once, however often the same delivery is finalized", () => {
    for (const decision of [false, true]) {
      const fixture = createFixture();
      const task = createDeliveringTask(fixture, { subtask: false, status: "running" });
      fixture.repositories.appendProof({ id: `proof_${task.id}`, taskId: task.id, type: "file", uri: "out.md", summary: "out", verifiedAt: null });
      writeWorkspaceDelivery(task.workspacePath!, decision ? { open_decisions: [DECISION] } : {});
      fixture.repositories.createBusinessArtifact({
        id: `artifact_${task.id}`,
        companyId: "company_1",
        taskId: task.id,
        sourceProofId: `proof_${task.id}`,
        artifactKind: "deliverable",
        artifactRole: "implementation",
        artifactSubtype: "slice",
        artifactType: "implementation_summary",
        taskType: "engineering.slice",
        payload: payloadFor(decision ? { open_decisions: [DECISION] } : {}),
        lineage: {},
        validationStatus: "valid",
        validationErrors: [],
        reviewStatus: "unreviewed",
        isCurrent: true,
        supersedesArtifactId: null,
        createdAt: "2026-09-17T00:00:00.000Z",
        updatedAt: "2026-09-17T00:00:00.000Z",
      });

      for (let attempt = 0; attempt < 2; attempt += 1) {
        finalizeDelivery({
          repositories: fixture.repositories,
          task: fixture.repositories.getTask(task.id)!,
          artifact: fixture.repositories.getCurrentBusinessArtifactForTask(task.id)!,
          source: "agent_run",
        });
        // A decision's own Hold would stop the second pass early; drop it so the pass reaches recording
        // again — the case of a Hold lost to a restart or a repair while the completion event survived.
        fixture.repositories.resolveOpenTaskHolds(task.id, "superseded", "2026-09-17T00:00:00.000Z", ["awaiting_founder_decision"]);
      }

      expect(fixture.repositories.getTask(task.id)?.status).toBe(decision ? "review" : "complete");
      expect(fixture.repositories.listTaskCompletionEventsForTask(task.id)).toHaveLength(1);
      expect(
        fixture.repositories.listTaskEventsForCompany("company_1").filter((event) => event.type === "automatic_acceptance"),
      ).toHaveLength(decision ? 0 : 1);
      expect(
        fixture.repositories.listTaskProgressEventsForCompany("company_1").filter((event) => event.label === "Automatically accepted"),
      ).toHaveLength(decision ? 0 : 1);
    }
  });
});

describe("business acceptance seam", () => {
  it("accepts the same artifact once when asked twice", () => {
    const fixture = createFixture();
    const task = createDeliveringTask(fixture, { subtask: false, status: "review" });
    fixture.repositories.appendProof({ id: "proof_twice", taskId: task.id, type: "file", uri: "out.md", summary: "out", verifiedAt: null });
    fixture.repositories.createBusinessArtifact({
      id: "artifact_twice",
      companyId: "company_1",
      taskId: task.id,
      sourceProofId: "proof_twice",
      artifactKind: "deliverable",
      artifactRole: "implementation",
      artifactSubtype: "slice",
      artifactType: "implementation_summary",
      taskType: "engineering.slice",
      payload: payloadFor({}),
      lineage: {},
      validationStatus: "valid",
      validationErrors: [],
      reviewStatus: "unreviewed",
      isCurrent: true,
      supersedesArtifactId: null,
      createdAt: "2026-09-17T00:00:00.000Z",
      updatedAt: "2026-09-17T00:00:00.000Z",
    });

    const results = [0, 1].map(() =>
      acceptTaskBusinessArtifact({
        repositories: fixture.repositories,
        task: fixture.repositories.getTask(task.id)!,
        artifact: fixture.repositories.getCurrentBusinessArtifactForTask(task.id)!,
        acceptanceProvenance: "manual_ceo_review",
        eventType: "ceo_review_decision",
        eventMessage: "CEO Office approved task.",
        keyResultProgress: { currentValue: "accepted_business_artifact", status: "met" },
      }),
    );

    expect(results[1]?.alreadyAccepted).toBe(true);
    expect(fixture.repositories.listTaskCompletionEventsForTask(task.id)).toHaveLength(1);
    expect(fixture.repositories.listTaskEventsForCompany("company_1").filter((event) => event.type === "ceo_review_decision")).toHaveLength(1);
  });
});

const PROOF_SCHEMAS = [{ id: "repo-diff", description: "diff proof", acceptedTypes: ["diff" as const] }];

async function deliver(entry: Entry, testCase: Case): Promise<Outcome> {
  const fixture = createFixture();
  const extra = {
    ...(testCase.risky ? { risk_note: RISKY_TEXT } : {}),
    ...(testCase.decision ? { open_decisions: [DECISION] } : {}),
  };

  if (entry === "agent_run") {
    const task = createDeliveringTask(fixture, { subtask: testCase.subtask, status: "queued" });
    const adapter: AgentAdapter = {
      id: "mock-worker",
      name: "Mock Worker",
      capabilities: ["code"],
      detect: async () => true,
      run: async (request: AgentRunRequest) => {
        if (request.metadata.phase === "execution_brief") {
          return { status: "complete", exitCode: 0, stderr: "", stdout: JSON.stringify({ purpose: "p", approach: "a", expectedOutcome: "e" }) };
        }
        writeWorkspaceDelivery(request.workspacePath, extra);
        return { status: "complete", exitCode: 0, stdout: "done", stderr: "" };
      },
    };
    await runSchedulerOnce({
      projectRoot: fixture.projectRoot,
      repositories: fixture.repositories,
      adapters: [adapter],
      workerId: "worker_a",
      maxTasks: 1,
      approvalRequired: () => false,
      proofCollector: ({ task: running }) => [
        { id: `proof_${running.id}`, taskId: running.id, type: "diff", uri: "delivery.diff", summary: "diff", verifiedAt: null },
      ],
      emit: () => undefined,
    });
    return summarize(fixture, task.id);
  }

  const task = createDeliveringTask(fixture, { subtask: testCase.subtask, status: "failed" });
  fixture.repositories.updateTaskExecutionSummary(task.id, { latestFailureReason: "no_proof", latestFailureMessage: "no proof" });
  writeWorkspaceDelivery(task.workspacePath!, extra);
  refreshTaskDependencyState({ repositories: fixture.repositories, taskId: task.id, proofSchemas: PROOF_SCHEMAS });
  return summarize(fixture, task.id);
}

function summarize(fixture: ReturnType<typeof createFixture>, taskId: string): Outcome {
  const { repositories } = fixture;
  return {
    status: repositories.getTask(taskId)!.status,
    holds: repositories.listOpenTaskHolds(taskId).map((hold) => hold.kind),
    reviewStatus: repositories.getCurrentBusinessArtifactForTask(taskId)?.reviewStatus ?? "none",
    keyResult: repositories.listKeyResults("company_1")[0]!.currentValue,
    completionOutcomes: repositories.listTaskCompletionEventsForTask(taskId).map((event) => event.outcome),
  };
}

function createFixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-finalize-"));
  createdDirs.push(projectRoot);
  const client = createDatabaseClient(":memory:");
  migrate(client);
  const repositories = createRepositories(client);
  repositories.createCompany(companyRecord());
  repositories.createDepartment(departmentRecord());
  repositories.createObjective(objectiveRecord());
  repositories.createKeyResult(keyResultRecord());
  return { projectRoot, repositories };
}

function createDeliveringTask(fixture: ReturnType<typeof createFixture>, options: { subtask: boolean; status: Task["status"] }): Task {
  const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-finalize-ws-"));
  createdDirs.push(workspacePath);
  if (options.subtask) {
    fixture.repositories.createTask({ ...baseTask("parent_1", "waiting_dependency"), taskKind: "parent" });
  }
  const task: Task = {
    ...baseTask("task_1", options.status),
    workspacePath,
    ...(options.subtask ? { parentTaskId: "parent_1", taskKind: "department_subtask" as const, source: "department" as const } : {}),
  };
  fixture.repositories.createTask(task);
  if (options.subtask) {
    fixture.repositories.createTaskDependency({ taskId: "parent_1", dependsOnTaskId: task.id });
  }
  return task;
}

function openHold(fixture: ReturnType<typeof createFixture>, task: Task, kind: "invalid_business_artifact" | "awaiting_founder_approval", resolver: "runtime" | "founder") {
  fixture.repositories.openTaskHold({
    id: `hold_${kind}`,
    companyId: task.companyId,
    taskId: task.id,
    kind,
    resolver,
    subjectKind: null,
    subjectId: null,
    reason: kind,
    reasonText: null,
    openedAt: "2026-09-17T00:00:00.000Z",
    resolvedAt: null,
    resolution: null,
  });
}

function payloadFor(extra: Record<string, unknown>) {
  return {
    ...extra,
    report_version: 2,
    execution_report: {
      work_summary: "Did the work.",
      evidence: "Recorded output.",
      conclusion: "The work is done.",
      vision_impact: "It moves the objective forward.",
      remaining_gap: "Later stages remain.",
      recommendation: "Continue.",
    },
    outcome_summary: "The work is done; later stages remain.",
  };
}

function writeWorkspaceDelivery(workspacePath: string, extra: Record<string, unknown>) {
  writeFileSync(join(workspacePath, "delivery.diff"), "diff --git a/index.html b/index.html\n", "utf8");
  mkdirSync(join(workspacePath, ".auto-crop"), { recursive: true });
  writeFileSync(
    join(workspacePath, ".auto-crop", "business-artifact.json"),
    JSON.stringify({
      artifact_kind: "deliverable",
      artifact_role: "implementation",
      artifact_subtype: "slice",
      task_type: "engineering.slice",
      payload: payloadFor(extra),
      lineage: {},
    }),
    "utf8",
  );
}

function baseTask(id: string, status: Task["status"]): Task {
  return {
    id,
    companyId: "company_1",
    departmentId: "department_1",
    keyResultId: "key_result_1",
    title: `Deliver ${id}`,
    description: "Deliver the slice.",
    assigneeAgentId: "mock-worker",
    requiredCapabilities: ["code"],
    proofSchemaId: "repo-diff",
    workspacePath: null,
    status,
    riskLevel: "low",
    position: id === "parent_1" ? 0 : 1,
  };
}

function companyRecord(): Company {
  return {
    id: "company_1",
    name: "Finalize Test Co",
    founderVision: "Ship a small product.",
    locale: "en",
    selectedCeoAgentId: "codex",
    playbookId: "ai-saas",
    status: "active",
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
  };
}

function departmentRecord(): Department {
  return {
    id: "department_1",
    companyId: "company_1",
    name: "Engineering",
    responsibility: "Build the product.",
    leadAgentId: "codex",
    memoryPath: ".auto-crop/companies/company_1/departments/engineering/Memory.md",
  };
}

function objectiveRecord(): Objective {
  return { id: "objective_1", companyId: "company_1", title: "Ship", status: "active", priority: 1 };
}

function keyResultRecord(): KeyResult {
  return {
    id: "key_result_1",
    objectiveId: "objective_1",
    title: "Product shipped",
    metricName: "status",
    targetValue: "shipped",
    currentValue: "not_started",
    status: "active",
  };
}
