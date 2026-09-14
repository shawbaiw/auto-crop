import { describe, expect, it } from "vitest";
import {
  deriveTaskHold,
  heldTaskStatuses,
  isAffordanceApplicable,
  isHeldTaskStatus,
  isSelfPropellingTaskStatus,
  isTaskHoldStranded,
  isTerminalTaskStatus,
  resolveTaskAffordances,
  selfPropellingTaskStatuses,
  taskHoldKinds,
  taskHoldStatusBinding,
  terminalTaskStatuses,
  type TaskHold,
  type TaskHoldKind,
} from "./taskHold";
import { taskStatusSchema } from "./schemas";
import type { TaskStatus } from "./types";

function hold(kind: TaskHoldKind, overrides: Partial<TaskHold> = {}): TaskHold {
  return {
    id: `hold_${kind}`,
    companyId: "company",
    taskId: "task",
    kind,
    resolver: "founder",
    subjectKind: null,
    subjectId: null,
    reason: kind,
    reasonText: null,
    openedAt: "2026-09-01T00:00:00Z",
    resolvedAt: null,
    resolution: null,
    ...overrides,
  };
}

describe("task status partition", () => {
  it("classifies every task status as exactly one of self-propelling, held, or terminal", () => {
    const statuses = taskStatusSchema.options as readonly TaskStatus[];

    for (const status of statuses) {
      const memberships = [
        isSelfPropellingTaskStatus(status),
        isHeldTaskStatus(status),
        isTerminalTaskStatus(status),
      ].filter(Boolean);
      expect(memberships, `status ${status} must belong to exactly one class`).toHaveLength(1);
    }

    expect(
      [...selfPropellingTaskStatuses, ...heldTaskStatuses, ...terminalTaskStatuses].sort(),
    ).toEqual([...statuses].sort());
  });
});

describe("taskHoldStatusBinding", () => {
  /**
   * "A Hold that outlived its status" is the mechanism of the original failure. The defence is that
   * every kind states its binding, so the question cannot be skipped for a kind added later.
   */
  it("makes every Hold kind declare whether it is bound to a status", () => {
    expect(Object.keys(taskHoldStatusBinding).sort()).toEqual([...taskHoldKinds].sort());

    for (const [kind, boundTo] of Object.entries(taskHoldStatusBinding)) {
      if (boundTo === null) {
        continue;
      }
      expect(isHeldTaskStatus(boundTo), `${kind} is bound to a status a task cannot be parked in`).toBe(true);
    }
  });

  it("strands a bound Hold in any other status, and never strands an unbound one", () => {
    expect(isTaskHoldStranded("awaiting_ceo_review", "review")).toBe(false);
    expect(isTaskHoldStranded("awaiting_ceo_review", "blocked")).toBe(true);
    expect(isTaskHoldStranded("awaiting_human_action", "blocked")).toBe(false);
    expect(isTaskHoldStranded("awaiting_human_action", "waiting_dependency")).toBe(false);
  });
});

describe("isAffordanceApplicable", () => {
  /**
   * The single declaration of each action's status preconditions. The runtime that performs refresh
   * and recovery reads this same function instead of restating the rule — a second copy next to the
   * implementation is how the offer and the guard drifted apart before.
   */
  it("gates only the actions whose runtime has state preconditions", () => {
    expect(isAffordanceApplicable("refresh_task", "blocked")).toBe(true);
    expect(isAffordanceApplicable("refresh_task", "review")).toBe(false);
    expect(isAffordanceApplicable("recover_task", "needs_replan")).toBe(true);
    expect(isAffordanceApplicable("recover_task", "waiting_dependency")).toBe(false);
    // Everything else is decided by the Hold alone.
    expect(isAffordanceApplicable("request_replan", "review")).toBe(true);
    expect(isAffordanceApplicable("cancel_task", "running")).toBe(true);
  });
});

describe("resolveTaskAffordances", () => {
  // Rule 2: a Hold nobody can clear is the failure this model exists to prevent, so every kind in
  // the union — including ones added later — must offer a real way forward, not just cancellation.
  it("offers every Hold kind at least one way forward besides cancelling", () => {
    for (const kind of taskHoldKinds) {
      const affordances = resolveTaskAffordances({ status: "blocked", holds: [hold(kind)] });
      const forwardMoves = affordances.filter((affordance) => affordance.kind !== "cancel_task");

      expect(forwardMoves, `Hold kind ${kind} has no way forward`).not.toHaveLength(0);
      expect(affordances.map((affordance) => affordance.kind)).toContain("cancel_task");
    }
  });

  it("attributes each affordance to the Hold that produced it", () => {
    const ceoHold = hold("awaiting_ceo_review", {
      id: "hold_review",
      resolver: "ceo_office",
      subjectKind: "business_artifact",
      subjectId: "artifact_1",
    });

    const affordances = resolveTaskAffordances({ status: "review", holds: [ceoHold] });
    const decision = affordances.find((affordance) => affordance.kind === "ceo_review_decision");

    expect(decision).toMatchObject({
      actor: "ceo_office",
      holdId: "hold_review",
      holdKind: "awaiting_ceo_review",
      subjectKind: "business_artifact",
      subjectId: "artifact_1",
    });
  });

  it("offers a task the runtime already owns nothing but cancellation", () => {
    for (const status of selfPropellingTaskStatuses) {
      expect(resolveTaskAffordances({ status, holds: [] }).map((item) => item.kind)).toEqual(["cancel_task"]);
    }
  });

  it("offers nothing at all on a task that has finished", () => {
    for (const status of terminalTaskStatuses) {
      expect(resolveTaskAffordances({ status, holds: [] })).toEqual([]);
    }
  });

  it("still offers cancellation for a held task whose Holds were all resolved", () => {
    const resolved = hold("awaiting_ceo_review", { resolvedAt: "2026-09-02T00:00:00Z", resolution: "cleared" });

    expect(resolveTaskAffordances({ status: "blocked", holds: [resolved] }).map((item) => item.kind)).toEqual([
      "cancel_task",
    ]);
  });

  it("prefers confirming an existing replan proposal over requesting another", () => {
    const withProposal = resolveTaskAffordances({
      status: "needs_replan",
      holds: [hold("needs_replan")],
      hasProposedReplan: true,
    }).map((affordance) => affordance.kind);

    expect(withProposal).toContain("confirm_replan");
    expect(withProposal.indexOf("confirm_replan")).toBeLessThan(withProposal.indexOf("request_replan"));
  });

  it("does not offer blind re-runs once Bounded Recovery is exhausted", () => {
    const affordances = resolveTaskAffordances({
      status: "blocked",
      holds: [hold("recovery_exhausted")],
    }).map((affordance) => affordance.kind);

    expect(affordances).not.toContain("recover_task");
    expect(affordances).toContain("request_replan");
  });

  it("merges affordances across concurrent Holds without losing either subject", () => {
    const affordances = resolveTaskAffordances({
      status: "blocked",
      holds: [
        hold("awaiting_human_action", { id: "hold_a", subjectKind: "human_action", subjectId: "action_1" }),
        hold("awaiting_dependency_artifact", { id: "hold_b", subjectKind: "task", subjectId: "task_upstream" }),
      ],
    });

    expect(affordances.filter((item) => item.holdId === "hold_a").map((item) => item.kind)).toEqual([
      "confirm_human_action",
    ]);
    expect(affordances.filter((item) => item.holdId === "hold_b").map((item) => item.kind)).toEqual([
      "refresh_task",
      "request_replan",
    ]);
  });
});

describe("deriveTaskHold", () => {
  it("derives a Hold for every held status so an undeclared transition still parks with an owner", () => {
    for (const status of heldTaskStatuses) {
      expect(deriveTaskHold({ status }), `status ${status} must derive a Hold`).not.toBeNull();
    }
  });

  it("derives no Hold for statuses that carry their own motion", () => {
    for (const status of [...selfPropellingTaskStatuses, ...terminalTaskStatuses]) {
      expect(deriveTaskHold({ status })).toBeNull();
    }
  });

  it("routes each failure reason to the actor who can actually clear it", () => {
    expect(deriveTaskHold({ status: "blocked", failureReason: "retry_exhausted" })).toEqual({
      kind: "recovery_exhausted",
      resolver: "founder",
    });
    expect(deriveTaskHold({ status: "blocked", failureReason: "missing_deliverable" })).toEqual({
      kind: "awaiting_dependency_artifact",
      resolver: "upstream_task",
    });
    expect(deriveTaskHold({ status: "failed", failureReason: "non_reviewable_artifact" })).toEqual({
      kind: "invalid_business_artifact",
      resolver: "runtime",
    });
  });

  it("falls back to an owned interruption for a failure nobody modelled", () => {
    expect(deriveTaskHold({ status: "failed", failureReason: "timeout" })).toEqual({
      kind: "runtime_interrupted",
      resolver: "runtime",
    });
    expect(deriveTaskHold({ status: "blocked" })).toEqual({
      kind: "runtime_interrupted",
      resolver: "runtime",
    });
  });
});
