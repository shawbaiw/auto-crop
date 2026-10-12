import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Company, Task } from "@auto-crop/core";
import type { AgentAdapter, AgentRunRequest } from "../adapters/types";
import { createApiServer } from "../api/routes";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { artifactEnvelopeContractErrors } from "./businessArtifact";
import { MAX_TASK_ATTEMPTS } from "./boundedRecovery";
import { runSchedulerOnce } from "./scheduler";
import { credentialLikeValue, parseUnblockRequest } from "./unblockRequest";

/**
 * ADR 0042. The scenario is the first real e2e run's: a keyword task needs Ahrefs KD values its
 * `web_research` grant cannot reach, files an honest Environment-Blocked Blocker, and asks the founder
 * to look the values up. Nothing could carry that answer back; now a Human Action does.
 */

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const KD_REQUEST = {
  needed: "Ahrefs KD for the two candidate keywords",
  why: "Every KD source needs a login or passes a JavaScript challenge this run cannot.",
  evidence_requirements: ["KD keyword-a", "KD keyword-b"],
};

describe("the Unblock Request contract", () => {
  it("is optional on a blocker, and checked by the one envelope contract function when present", () => {
    const contract = { locale: "en" as const, requireDetails: true };
    expect(artifactEnvelopeContractErrors({ artifactKind: "blocker", payload: { reason: "no KD source" } }, contract)).toEqual([]);
    expect(artifactEnvelopeContractErrors({ artifactKind: "blocker", payload: { unblock_request: KD_REQUEST } }, contract)).toEqual([]);
    expect(artifactEnvelopeContractErrors(
      { artifactKind: "blocker", payload: { unblock_request: { needed: "KD", evidence_requirements: [] } } },
      contract,
    )).toEqual([
      expect.stringContaining("unblock_request.why"),
      expect.stringContaining("unblock_request.evidence_requirements"),
    ]);
  });

  it("rejects a request for credentials, in what is needed or in what must be supplied", () => {
    for (const request of [
      { ...KD_REQUEST, needed: "The Ahrefs API key" },
      { ...KD_REQUEST, evidence_requirements: ["Ahrefs password"] },
      { ...KD_REQUEST, evidence_requirements: ["Session cookie for ahrefs.com"] },
      { ...KD_REQUEST, evidence_requirements: ["Ahrefs 登录密码"] },
    ]) {
      expect(parseUnblockRequest({ unblock_request: request }).errors, JSON.stringify(request))
        .toEqual([expect.stringContaining("Must not ask for credentials")]);
    }
    // Saying why a source is out of reach is not asking for a login.
    expect(parseUnblockRequest({ unblock_request: KD_REQUEST }).errors).toEqual([]);
  });

  it("recognises secret-shaped confirmation values and leaves data alone", () => {
    expect(credentialLikeValue("sk-proj-abcdefghijklmnop1234")).toBe("an API key");
    expect(credentialLikeValue("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJl")).toBe("a JSON Web Token");
    expect(credentialLikeValue("password: hunter2")).toBe("a credential assignment");
    expect(credentialLikeValue("12")).toBeNull();
    expect(credentialLikeValue("keyword-a: 12, keyword-b: 31 (Ahrefs, 2026-10-12)")).toBeNull();
  });
});

describe("a blocker that asks a person for input", () => {
  it("parks the task on a Human Action, re-runs it with the answer once confirmed, and the re-run completes", async () => {
    const harness = await createHarness([askForKd, deliverWithKd]);

    await harness.tick();
    const parked = harness.task();
    expect(parked.status).toBe("blocked");
    expect(parked.latestFailureReason).toBe("awaiting_human_action");
    // An honest request is not a broken delivery: no invalid-artifact Hold, and no Proof was owed.
    const holds = harness.repositories.listOpenTaskHolds(parked.id);
    expect(holds.map((hold) => hold.kind)).toEqual(["awaiting_human_action"]);
    const state = await harness.state();
    const humanAction = state.humanActions.find((action: { taskId: string }) => action.taskId === parked.id);
    expect(humanAction).toMatchObject({
      id: holds[0]!.subjectId,
      label: KD_REQUEST.needed,
      status: "pending",
      confirmationRequirements: KD_REQUEST.evidence_requirements,
      blockedTaskIds: [],
    });
    expect(state.taskCompletionEvents.at(-1)?.outcome).toBe("awaiting_human_action");
    const summary = state.tasks.find((task: { id: string }) => task.id === parked.id);
    expect(summary.affordances.map((affordance: { kind: string }) => affordance.kind).sort()).toEqual(["cancel_task", "confirm_human_action", "request_replan"]);
    // CEO Office shows something the founder can do, not a blocked issue.
    const officeItems = state.ceoOfficeItems.filter((item: { taskId: string }) => item.taskId === parked.id);
    expect(officeItems.filter((item: { type: string; actionBearing: boolean }) => item.type === "human_action" && item.actionBearing)).toHaveLength(1);
    expect(officeItems.filter((item: { type: string; actionBearing: boolean }) => item.type === "blocked_issue" && item.actionBearing)).toEqual([]);

    const confirmed = await harness.confirm(humanAction.id, { "KD keyword-a": "12", "KD keyword-b": "31" });
    expect(confirmed.status).toBe(200);
    expect(harness.task().status).toBe("queued");
    expect(harness.repositories.listOpenTaskHolds(parked.id)).toEqual([]);
    expect(harness.wakes).toContain("dependency_cascade_queued");

    await harness.tick();
    expect(harness.prompts[1]).toContain("## Settled Facts");
    expect(harness.prompts[1]).toContain(`Human Action Confirmation \`${humanAction.id}\``);
    expect(harness.prompts[1]).toContain("  - KD keyword-a: 12");
    expect(harness.task().status).toBe("complete");
    await harness.close();
  });

  it("refuses an incomplete confirmation or one carrying a credential, and leaves the task parked", async () => {
    const harness = await createHarness([askForKd]);
    await harness.tick();
    const humanActionId = harness.repositories.listOpenTaskHolds("task_1")[0]!.subjectId!;

    const partial = await harness.confirm(humanActionId, { "KD keyword-a": "12" });
    expect(partial.status).toBe(400);
    expect((await partial.json()).verificationErrors).toEqual(["evidence.KD keyword-b: Expected a non-empty string."]);

    const secret = await harness.confirm(humanActionId, { "KD keyword-a": "12", "KD keyword-b": "api_key=abc123" });
    expect(secret.status).toBe(400);
    expect((await secret.json()).verificationErrors).toEqual([expect.stringContaining("Do not submit credentials")]);

    expect(harness.task().status).toBe("blocked");
    expect(harness.repositories.listOpenTaskHolds("task_1").map((hold) => hold.kind)).toEqual(["awaiting_human_action"]);
    await harness.close();
  });

  it("counts every re-run toward the Bounded Recovery ceiling, so an agent that keeps asking stops", async () => {
    const harness = await createHarness(Array.from({ length: MAX_TASK_ATTEMPTS + 1 }, () => askForKd));

    for (let attempt = 1; attempt < MAX_TASK_ATTEMPTS; attempt += 1) {
      await harness.tick();
      const humanActionId = harness.repositories.listOpenTaskHolds("task_1")[0]!.subjectId!;
      expect((await harness.confirm(humanActionId, { "KD keyword-a": "12", "KD keyword-b": "31" })).status).toBe(200);
    }
    await harness.tick();

    expect(harness.prompts).toHaveLength(MAX_TASK_ATTEMPTS);
    expect(harness.task()).toMatchObject({ status: "blocked", latestFailureReason: "retry_exhausted" });
    expect(harness.repositories.listOpenTaskHolds("task_1").map((hold) => hold.kind)).toEqual(["recovery_exhausted"]);
    await harness.close();
  });

  it("asks nobody when the blocker claims a capability the run was granted", async () => {
    const harness = await createHarness([(request) => ({
      ...askForKd(request),
      payload: { ...(askForKd(request).payload as object), capability: grantedRefutableCapability(request) },
    })], { requiredCapabilities: ["research", "code"] }, { blockersLeaveProof: true });

    await harness.tick();

    // It settles as the invalid delivery it is, and its completion event projects no Human Action
    // that no Hold stands behind.
    expect(harness.repositories.listOpenTaskHolds("task_1").map((hold) => hold.kind)).toEqual(["invalid_business_artifact"]);
    expect(harness.repositories.listTaskCompletionEventsForTask("task_1").map((event) => event.outcome)).toEqual(["failed_to_review"]);
    expect((await harness.state()).humanActions).toEqual([]);
    await harness.close();
  });

  it("tells the agent at submit time when its Unblock Request is malformed, so it can fix it in the same run", async () => {
    let rejection: unknown = null;
    const harness = await createHarness([(request) => {
      rejection = request.runtimeActions!.submitArtifactEnvelope({
        ...askForKd(request),
        payload: { unblock_request: { needed: "Ahrefs API key", why: "x", evidence_requirements: ["api key"] } },
      });
      return askForKd(request);
    }]);

    await harness.tick();

    expect(rejection).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringContaining("Must not ask for credentials")]) });
    // The corrected call is the delivery.
    expect(harness.repositories.listOpenTaskHolds("task_1").map((hold) => hold.kind)).toEqual(["awaiting_human_action"]);
    await harness.close();
  });
});

type Script = (request: AgentRunRequest) => Record<string, unknown>;

function askForKd(_request: AgentRunRequest): Record<string, unknown> {
  return {
    artifact_kind: "blocker",
    artifact_role: "none",
    artifact_subtype: "keyword_data_unavailable",
    task_type: "research.keyword",
    payload: {
      blocker_class: "environment_blocked",
      capability: "keyword_data",
      reason: "Tried nine KD sources; none is reachable without a login.",
      unblock_request: KD_REQUEST,
    },
    lineage: {},
  };
}

function deliverWithKd(request: AgentRunRequest): Record<string, unknown> {
  return {
    artifact_kind: "deliverable",
    artifact_role: "findings",
    artifact_subtype: "keyword_research",
    task_type: "research.keyword",
    payload: {
      execution_report: {
        work_summary: "Ranked the candidates on founder-supplied KD.", evidence: "KD keyword-a 12, keyword-b 31.",
        conclusion: "keyword-a meets KD <= 15.", vision_impact: "Gives the tool its target keyword.",
        remaining_gap: "Demand is unvalidated.", recommendation: "Build around keyword-a.",
      },
      outcome_summary: "keyword-a meets the KD threshold; demand is still unvalidated.",
      actions: [],
    },
    lineage: { task_id: request.taskId },
  };
}

/** A capability this run actually holds and that a blocker can name, so the runtime refutes the claim. */
function grantedRefutableCapability(request: AgentRunRequest): string {
  const capability = request.grant?.granted.find((granted) => granted === "web_research" || granted === "run_command");
  if (!capability) {
    throw new Error(`Expected the run to be granted web_research or run_command, got ${request.grant?.granted.join(", ")}`);
  }
  return capability;
}

async function createHarness(scripts: Script[], taskOverrides: Partial<Task> = {}, options: { blockersLeaveProof?: boolean } = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-unblock-"));
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
  repositories.createTask({
    id: "task_1", companyId: "company_1", departmentId: "department_1", keyResultId: "key_result_1",
    title: "Pick a low-KD keyword", description: "Find a keyword with Ahrefs KD <= 15.", assigneeAgentId: "mock-worker",
    requiredCapabilities: ["code"], proofSchemaId: "test-output", workspacePath: null, status: "queued", riskLevel: "low", position: 0,
    ...taskOverrides,
  });

  let counter = 0;
  const createId = (prefix: string) => `${prefix}_${++counter}`;
  const now = () => new Date("2026-10-12T00:00:00.000Z");
  const prompts: string[] = [];
  const wakes: string[] = [];
  const remaining = [...scripts];
  const adapter: AgentAdapter = {
    id: "mock-worker",
    name: "Mock Worker",
    capabilities: ["code"],
    contractCapabilities: ["artifact_envelope"],
    detect: async () => true,
    run: async (request) => {
      prompts.push(request.prompt);
      const script = remaining.shift();
      if (!script) throw new Error("No scripted run left.");
      const envelope = script(request);
      request.runtimeActions!.submitArtifactEnvelope(envelope);
      // Only a deliverable leaves Proof behind; a blocker asking for input owes none.
      return { status: "complete", exitCode: 0, stdout: envelope.artifact_kind === "deliverable" || options.blockersLeaveProof ? "deliverable" : "asked", stderr: "" };
    },
  };

  const server = createApiServer({ projectRoot, repositories, agents: [], now, createId, requestSchedulerWake: (reason) => wakes.push(reason) });
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server address.");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    repositories,
    prompts,
    wakes,
    task: () => repositories.getTask("task_1")!,
    tick: () => runSchedulerOnce({
      projectRoot, repositories, adapters: [adapter], workerId: "worker_a", maxTasks: 1, now, createId,
      approvalRequired: () => false, emit: () => undefined,
      proofCollector: ({ task, stdout }) => stdout === "deliverable"
        ? [{ id: createId("proof"), taskId: task.id, type: "command_output", uri: "agent.log", summary: "keyword ranking", verifiedAt: null }]
        : [],
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state: async (): Promise<any> => (await fetch(`${baseUrl}/api/companies/company_1/state`)).json(),
    confirm: (humanActionId: string, evidence: Record<string, string>) => fetch(
      `${baseUrl}/api/companies/company_1/human-actions/${humanActionId}/confirm`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ evidence }) },
    ),
    close: async () => {
      await new Promise<void>((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())));
      client.close();
    },
  };
}

function company(): Company {
  return {
    id: "company_1", name: "Keyword Studio", founderVision: "Find a low-competition keyword and ship a tool.", locale: "en",
    selectedCeoAgentId: "codex", playbookId: "ai-saas", status: "active",
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
  };
}
