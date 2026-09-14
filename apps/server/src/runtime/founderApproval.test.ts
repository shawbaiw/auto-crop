import { afterEach, describe, expect, it } from "vitest";
import type { Approval, Company, Department, PermissionMode, Task } from "@auto-crop/core";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { decideFounderApproval } from "./founderApproval";
import { requiresFounderApproval } from "./scheduler";
import { resolveTaskAffordanceState } from "./taskAffordances";
import { applyTaskTransition } from "./taskTransition";

const openClients: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const client of openClients.splice(0)) {
    client.close();
  }
});

describe("requiresFounderApproval", () => {
  /**
   * Permission Mode was stored on the company and displayed, but the only caller passed a hardcoded
   * `balanced` policy, so a `safe` company never actually asked. The setting has to reach here.
   */
  it.each([
    ["safe", true],
    ["balanced", false],
    ["autonomous", false],
  ] satisfies Array<[PermissionMode, boolean]>)(
    "reads the company's own %s Permission Mode",
    (permissionMode, expected) => {
      const { repositories, task } = createFixture({ permissionMode });

      expect(requiresFounderApproval(repositories, task)).toBe(expected);
    },
  );

  it("falls back to the default policy for a company that declares no mode", () => {
    const { repositories, task } = createFixture({ permissionMode: undefined });

    expect(requiresFounderApproval(repositories, task)).toBe(false);
  });
});

describe("decideFounderApproval", () => {
  it("offers the decision on a task held for approval, and clears the Hold when granted", () => {
    const { repositories, task, approvalId } = createBlockedOnApproval();

    const offered = resolveTaskAffordanceState(repositories, repositories.getTask(task.id)!);
    expect(offered.affordances.map((affordance) => affordance.kind)).toContain("decide_founder_approval");
    // The Approval id travels on the affordance, so the UI needs no lookup of its own.
    expect(offered.affordances.find((affordance) => affordance.kind === "decide_founder_approval")?.subjectId)
      .toBe(approvalId);

    const result = decideFounderApproval({
      repositories,
      approvalId,
      decision: "approved",
      note: "Fine to run.",
      createId: sequentialId(),
    });

    expect(result.kind).toBe("decided");
    expect(repositories.getTask(task.id)?.status).toBe("queued");
    expect(repositories.listOpenTaskHolds(task.id)).toHaveLength(0);
    expect(repositories.getApproval(approvalId)).toMatchObject({
      status: "approved",
      note: "Fine to run.",
    });
    expect(repositories.getApproval(approvalId)?.decidedAt).not.toBeNull();
  });

  /**
   * Denying does not put the task back where it was. A task whose required action the founder has
   * refused cannot run as specified, so it moves to `needs_replan` — which offers replanning as the
   * way forward instead of re-presenting the same approval request the founder just declined.
   */
  it("routes a denied task to replanning rather than back to the same request", () => {
    const { repositories, task, approvalId } = createBlockedOnApproval();

    const result = decideFounderApproval({
      repositories,
      approvalId,
      decision: "denied",
      note: "Not spending on this.",
      createId: sequentialId(),
    });

    expect(result.kind).toBe("decided");
    expect(repositories.getTask(task.id)?.status).toBe("needs_replan");
    expect(repositories.listOpenTaskHolds(task.id).map((hold) => hold.kind)).toEqual(["needs_replan"]);

    const after = resolveTaskAffordanceState(repositories, repositories.getTask(task.id)!);
    expect(after.affordances.map((affordance) => affordance.kind)).toContain("request_replan");
    expect(after.affordances.map((affordance) => affordance.kind)).not.toContain("decide_founder_approval");
  });

  it("records an answer only once", () => {
    const { repositories, approvalId } = createBlockedOnApproval();
    decideFounderApproval({ repositories, approvalId, decision: "approved", note: null, createId: sequentialId() });

    const second = decideFounderApproval({
      repositories,
      approvalId,
      decision: "denied",
      note: null,
      createId: sequentialId(),
    });

    expect(second.kind).toBe("already_decided");
    expect(repositories.getApproval(approvalId)?.status).toBe("approved");
  });

  /**
   * A founder who recovers the task out of its approval Hold, then clicks the approval button they
   * were still looking at. The approval is stale even though nobody answered it.
   */
  it("refuses an approval whose task stopped waiting on it, and says what can be done instead", () => {
    const { repositories, task, approvalId } = createBlockedOnApproval();
    // Recovered out of the approval Hold by another path, which accounts for it explicitly.
    applyTaskTransition({
      repositories,
      task,
      status: "queued",
      resolvesHoldKinds: ["awaiting_founder_approval"],
      resolution: "cleared",
      createId: sequentialId(),
    });

    const result = decideFounderApproval({
      repositories,
      approvalId,
      decision: "approved",
      note: null,
      createId: sequentialId(),
    });

    expect(result.kind).toBe("not_offered");
    if (result.kind !== "not_offered") {
      throw new Error("expected a stale refusal");
    }
    expect(result.state.affordances.map((affordance) => affordance.kind)).toEqual(["cancel_task"]);
    expect(repositories.getApproval(approvalId)?.status).toBe("pending");
  });

  /**
   * An approval is not the only reason a task can be stopped. Answering it must clear that Hold
   * without touching the others, and the task keeps whatever way forward those others offer.
   */
  it("clears only the answered Hold when the task is also held for another reason", () => {
    const { repositories, task, approvalId } = createBlockedOnApproval();
    applyTaskTransition({
      repositories,
      task,
      status: "blocked",
      hold: {
        kind: "awaiting_dependency_artifact",
        subjectKind: "task",
        subjectId: "upstream_task",
        reason: "Upstream still owes a deliverable.",
      },
      createId: sequentialId(),
    });
    expect(repositories.listOpenTaskHolds(task.id)).toHaveLength(2);

    decideFounderApproval({ repositories, approvalId, decision: "approved", note: null, createId: sequentialId() });

    expect(repositories.listOpenTaskHolds(task.id).map((hold) => hold.kind)).toEqual([
      "awaiting_dependency_artifact",
    ]);
  });

  it("reports a missing approval rather than pretending to act", () => {
    const { repositories } = createFixture({ permissionMode: "safe" });

    expect(decideFounderApproval({
      repositories,
      approvalId: "approval_missing",
      decision: "approved",
      note: null,
    })).toEqual({ kind: "not_found" });
  });
});

let idCounter = 0;

function sequentialId(): (prefix: string) => string {
  return (prefix: string) => `${prefix}_${(idCounter += 1)}`;
}

/** A task parked exactly the way the scheduler parks one that needs Founder Approval. */
function createBlockedOnApproval() {
  const { repositories, task } = createFixture({ permissionMode: "safe" });
  const approvalId = "approval_1";
  const approval: Approval = {
    id: approvalId,
    companyId: task.companyId,
    taskId: task.id,
    actionType: "run_safe_command",
    riskLevel: task.riskLevel,
    status: "pending",
    requestedAt: "2026-09-14T00:00:00.000Z",
  };
  repositories.createApproval(approval);
  applyTaskTransition({
    repositories,
    task,
    status: "blocked",
    hold: {
      kind: "awaiting_founder_approval",
      resolver: "founder",
      subjectKind: "approval",
      subjectId: approvalId,
      reason: `${task.title} needs Founder Approval before it can run.`,
    },
    createId: sequentialId(),
  });

  return { repositories, task, approvalId };
}

function createFixture(options: { permissionMode?: PermissionMode }): {
  repositories: ReturnType<typeof createRepositories>;
  task: Task;
} {
  const client = createDatabaseClient(":memory:");
  openClients.push(client);
  migrate(client);
  const repositories = createRepositories(client);

  const company: Company = {
    id: "company_1",
    name: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    locale: "en",
    selectedCeoAgentId: "codex",
    playbookId: "ai-saas",
    permissionMode: options.permissionMode,
    status: "active",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  const department: Department = {
    id: "department_1",
    companyId: company.id,
    name: "Engineering",
    responsibility: "Build and validate the product.",
    leadAgentId: "codex",
    memoryPath: ".auto-crop/companies/company_1/departments/engineering/Memory.md",
  };
  const task: Task = {
    id: "task_1",
    companyId: company.id,
    departmentId: department.id,
    keyResultId: null,
    position: 0,
    title: "Deploy the pricing page",
    description: "Publish it.",
    assigneeAgentId: "codex",
    requiredCapabilities: ["code"],
    proofSchemaId: "test-output",
    workspacePath: null,
    status: "queued",
    riskLevel: "high",
  };

  repositories.createCompany(company);
  repositories.createDepartment(department);
  repositories.createTask(task);

  return { repositories, task };
}
