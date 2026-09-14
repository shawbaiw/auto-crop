import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  isHeldTaskStatus,
  isTerminalTaskStatus,
  resolveTaskAffordances,
  selfPropellingTaskStatuses,
  taskStatusSchema,
  terminalTaskStatuses,
  type Company,
  type Department,
  type Task,
  type TaskHold,
  type TaskHoldKind,
  type TaskStatus,
} from "@auto-crop/core";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { resolveTaskAffordanceState } from "./taskAffordances";
import { reconcileTaskHolds } from "./taskHoldReconciliation";
import { applyTaskTransition, findOpenTaskHold, releaseTaskHold } from "./taskTransition";

const openClients: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const client of openClients.splice(0)) {
    client.close();
  }
});

describe("applyTaskTransition", () => {
  it("parks every held status on an open Hold, even when the caller declares none", () => {
    const { repositories, task } = createFixture();

    for (const status of taskStatusSchema.options as readonly TaskStatus[]) {
      if (!isHeldTaskStatus(status)) {
        continue;
      }

      applyTaskTransition({ repositories, task: task.id, status, createId: sequentialId() });
      const holds = repositories.listOpenTaskHolds(task.id);

      expect(holds, `status ${status} parked with no Hold`).not.toHaveLength(0);
      expect(resolveTaskAffordances({ status, holds }).filter((item) => item.kind !== "cancel_task"))
        .not.toHaveLength(0);
    }
  });

  it("resolves every open Hold once the task is finished", () => {
    const { repositories, task } = createFixture();

    for (const status of terminalTaskStatuses) {
      applyTaskTransition({ repositories, task: task.id, status: "blocked", createId: sequentialId() });
      expect(repositories.listOpenTaskHolds(task.id)).not.toHaveLength(0);

      applyTaskTransition({ repositories, task: task.id, status, createId: sequentialId() });
      expect(repositories.listOpenTaskHolds(task.id), `status ${status} left a Hold open`).toHaveLength(0);
    }
  });

  /**
   * Default-safe. A caller that does not say why the task may run does not get to start it — which
   * is what makes "clearing one Hold is not unblocking a task" a property of the seam rather than
   * something every answer path has to remember.
   */
  it.each(selfPropellingTaskStatuses)("refuses to move a held task to %s without accounting for its Holds", (status) => {
    const { repositories, task } = createFixture();
    applyTaskTransition({ repositories, task: task.id, status: "blocked", createId: sequentialId() });

    const refused = applyTaskTransition({ repositories, task: task.id, status, createId: sequentialId() });

    expect(refused.moved).toBe(false);
    expect(repositories.getTask(task.id)?.status).toBe("blocked");
    expect(repositories.listOpenTaskHolds(task.id)).toHaveLength(1);
  });

  it("moves the task once the caller accounts for the Holds by kind", () => {
    const { repositories, task } = createFixture();
    applyTaskTransition({
      repositories,
      task: task.id,
      status: "blocked",
      hold: { kind: "awaiting_dependency_artifact", subjectId: "upstream" },
      createId: sequentialId(),
    });

    const moved = applyTaskTransition({
      repositories,
      task: task.id,
      status: "queued",
      resolvesHoldKinds: ["awaiting_dependency_artifact"],
      createId: sequentialId(),
    });

    expect(moved.moved).toBe(true);
    expect(repositories.getTask(task.id)?.status).toBe("queued");
  });

  /**
   * The reported failure, reduced: a task in `review` is moved elsewhere by some other path. The
   * review Hold must not survive that, because CEO Office offers the decision from the Hold — this
   * is what stops an approval being offered that the API would then refuse.
   */
  it("withdraws the CEO review Hold as soon as the task leaves review", () => {
    const { repositories, task } = createFixture();

    applyTaskTransition({
      repositories,
      task: task.id,
      status: "review",
      hold: { kind: "awaiting_ceo_review", subjectKind: "business_artifact", subjectId: "artifact_1" },
      createId: sequentialId(),
    });
    expect(repositories.listOpenTaskHolds(task.id).map((hold) => hold.kind)).toEqual(["awaiting_ceo_review"]);

    applyTaskTransition({
      repositories,
      task: task.id,
      status: "blocked",
      executionSummary: { latestFailureReason: "retry_exhausted", latestFailureMessage: "Ceiling reached." },
      createId: sequentialId(),
    });

    const open = repositories.listOpenTaskHolds(task.id);
    expect(open.map((hold) => hold.kind)).toEqual(["recovery_exhausted"]);
    expect(repositories.listTaskHoldsForTask(task.id).find((hold) => hold.kind === "awaiting_ceo_review"))
      .toMatchObject({ resolution: "superseded" });
    expect(resolveTaskAffordances({ status: "blocked", holds: open }).map((item) => item.kind))
      .not.toContain("ceo_review_decision");
  });

  it("reuses an open Hold instead of stacking duplicates when the same path re-enters", () => {
    const { repositories, task } = createFixture();
    const hold = { kind: "awaiting_dependency_artifact", subjectKind: "task", subjectId: "upstream" } as const;

    applyTaskTransition({ repositories, task: task.id, status: "blocked", hold, createId: sequentialId() });
    applyTaskTransition({ repositories, task: task.id, status: "blocked", hold, createId: sequentialId() });

    expect(repositories.listOpenTaskHolds(task.id)).toHaveLength(1);
  });

  it("opens a distinct Hold per subject so concurrent waits are both visible", () => {
    const { repositories, task } = createFixture();

    applyTaskTransition({
      repositories, task: task.id, status: "blocked", createId: sequentialId(),
      hold: { kind: "awaiting_dependency_artifact", subjectKind: "task", subjectId: "upstream_a" },
    });
    applyTaskTransition({
      repositories, task: task.id, status: "blocked", createId: sequentialId(),
      hold: { kind: "awaiting_dependency_artifact", subjectKind: "task", subjectId: "upstream_b" },
    });

    expect(repositories.listOpenTaskHolds(task.id).map((hold) => hold.subjectId).sort()).toEqual([
      "upstream_a",
      "upstream_b",
    ]);
  });
});

describe("releaseTaskHold", () => {
  /**
   * The rule every "an actor answered something" path depends on. Answering one Hold says nothing
   * about the others, so releasing one must never be read as "this task can run now" — otherwise the
   * task claims it is about to run while something it still waits on is invisible, which is exactly
   * the unreadable progress ADR 0020 set out to fix.
   */
  it("keeps the task parked while any other Hold is still open", () => {
    const { repositories, task } = createFixture();
    const answered = openHold(repositories, task, "awaiting_human_action", "action_1");
    openHold(repositories, task, "awaiting_dependency_artifact", "upstream_1");

    const result = releaseTaskHold({ repositories, task, holdId: answered.id, createId: sequentialId() });

    expect(result.task.status).toBe("blocked");
    expect(repositories.listOpenTaskHolds(task.id).map((hold) => hold.subjectId)).toEqual(["upstream_1"]);
    expect(result.resolvedHolds.map((hold) => hold.id)).toEqual([answered.id]);
  });

  it("releases the task once the answered Hold was the last one", () => {
    const { repositories, task } = createFixture();
    const answered = openHold(repositories, task, "awaiting_human_action", "action_1");

    const result = releaseTaskHold({ repositories, task, holdId: answered.id, createId: sequentialId() });

    expect(result.task.status).toBe("queued");
    expect(repositories.listOpenTaskHolds(task.id)).toHaveLength(0);
  });

  /**
   * Holds of the same kind but different subjects are separate waits. Confirming one Human Action
   * must not be read as confirming another.
   */
  it("releases only the named Hold when several share a kind", () => {
    const { repositories, task } = createFixture();
    const answered = openHold(repositories, task, "awaiting_human_action", "action_1");
    openHold(repositories, task, "awaiting_human_action", "action_2");

    releaseTaskHold({ repositories, task, holdId: answered.id, createId: sequentialId() });

    expect(repositories.listOpenTaskHolds(task.id).map((hold) => hold.subjectId)).toEqual(["action_2"]);
    expect(repositories.getTask(task.id)?.status).toBe("blocked");
  });

  it("finds the Hold an actor is about to answer by what it waits on", () => {
    const { repositories, task } = createFixture();
    const target = openHold(repositories, task, "awaiting_human_action", "action_2");
    openHold(repositories, task, "awaiting_dependency_artifact", "upstream_1");

    expect(findOpenTaskHold(repositories, task.id, "awaiting_human_action", "action_2")?.id).toBe(target.id);
    expect(findOpenTaskHold(repositories, task.id, "awaiting_human_action", "action_9")).toBeNull();
    expect(findOpenTaskHold(repositories, task.id, "awaiting_ceo_review")).toBeNull();
  });
});

describe("task Hold invariant", () => {
  /**
   * The guarantee the whole model is for: whatever state a task is in, someone can move it. Asserted
   * over every task status rather than over the situations we happened to think of, because the next
   * stall will come from a situation nobody modelled.
   */
  it("leaves no unfinished task without an offered way forward", () => {
    const { repositories, company, task } = createFixture();

    for (const status of taskStatusSchema.options as readonly TaskStatus[]) {
      // Written past the seam on purpose: this simulates a path that does not know about Holds.
      repositories.writeTaskStatusUnchecked(task.id, status);
      reconcileTaskHolds({ repositories, companyId: company.id, createId: sequentialId() });

      const { affordances } = resolveTaskAffordanceState(repositories, repositories.getTask(task.id)!);

      if (isTerminalTaskStatus(status)) {
        expect(affordances, `terminal status ${status} should offer nothing`).toHaveLength(0);
        continue;
      }

      expect(affordances, `status ${status} offers nothing`).not.toHaveLength(0);
      if (isHeldTaskStatus(status)) {
        expect(
          affordances.filter((affordance) => affordance.kind !== "cancel_task"),
          `status ${status} offers only cancellation`,
        ).not.toHaveLength(0);
      }
    }
  });

  it("repairs a task parked before Holds existed without inventing a resolution", () => {
    const { repositories, company, task } = createFixture();
    repositories.writeTaskStatusUnchecked(task.id, "blocked");
    repositories.updateTaskExecutionSummary(task.id, {
      latestFailureReason: "missing_deliverable",
      latestFailureMessage: "Upstream never delivered.",
    });

    const first = reconcileTaskHolds({ repositories, companyId: company.id, createId: sequentialId() });
    expect(first.repairs).toHaveLength(1);
    expect(repositories.listOpenTaskHolds(task.id)[0]).toMatchObject({
      kind: "awaiting_dependency_artifact",
      resolver: "upstream_task",
      reason: "Upstream never delivered.",
    });

    // Idempotent: a company already satisfying the invariant is left alone.
    expect(reconcileTaskHolds({ repositories, companyId: company.id, createId: sequentialId() }).repairs)
      .toHaveLength(0);
  });

  it("closes a Hold left open on a task that has since moved on", () => {
    const { repositories, company, task } = createFixture();
    applyTaskTransition({ repositories, task: task.id, status: "blocked", createId: sequentialId() });
    repositories.writeTaskStatusUnchecked(task.id, "queued");

    reconcileTaskHolds({ repositories, companyId: company.id, createId: sequentialId() });

    expect(repositories.listOpenTaskHolds(task.id)).toHaveLength(0);
  });
});

describe("task status write seam", () => {
  /**
   * `applyTaskTransition` can only keep status and Holds in step if it is the sole writer. A new
   * direct write is how this class of bug came back last time, so it fails the build here rather
   * than surfacing later as a task nobody can move.
   */
  it("is the only production caller of the raw status write", () => {
    const roots = [
      fileURLToPath(new URL("..", import.meta.url)),
      fileURLToPath(new URL("../../../../packages/core/src", import.meta.url)),
    ];
    const allowed = new Set(["taskTransition.ts", "repositories.ts"]);
    const offenders: string[] = [];

    for (const root of roots) {
      for (const file of walkTypeScriptFiles(root)) {
        const name = file.split("/").pop()!;
        if (allowed.has(name) || name.endsWith(".test.ts")) {
          continue;
        }
        if (readFileSync(file, "utf8").includes("writeTaskStatusUnchecked")) {
          offenders.push(file);
        }
      }
    }

    expect(offenders, "route task status changes through applyTaskTransition").toEqual([]);
  });
});

function walkTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return walkTypeScriptFiles(path);
    }
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}

/** Park the task on one more Hold, the way a blocking path does. */
function openHold(
  repositories: ReturnType<typeof createRepositories>,
  task: Task,
  kind: TaskHoldKind,
  subjectId: string,
): TaskHold {
  const opened = applyTaskTransition({
    repositories,
    task,
    status: "blocked",
    hold: { kind, subjectId, reason: `waiting on ${subjectId}` },
    createId: sequentialId(),
  });

  return opened.openedHolds[0]!;
}

let idCounter = 0;

/** Shared counter: ids must stay unique across every transition a single test makes. */
function sequentialId(): (prefix: string) => string {
  return (prefix: string) => `${prefix}_${(idCounter += 1)}`;
}

function createFixture(): {
  repositories: ReturnType<typeof createRepositories>;
  company: Company;
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
    title: "Task task_1",
    description: "Do the work.",
    assigneeAgentId: "codex",
    requiredCapabilities: ["code"],
    proofSchemaId: "test-output",
    workspacePath: null,
    status: "queued",
    riskLevel: "low",
  };

  repositories.createCompany(company);
  repositories.createDepartment(department);
  repositories.createTask(task);

  return { repositories, company, task };
}
