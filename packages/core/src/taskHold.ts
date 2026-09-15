import type { LocalizedText } from "./localizedText";
import type { AgentFailureReason, TaskStatus } from "./types";

/**
 * Task Hold — the single, explicit answer to "why is this task not moving, and who can move it".
 *
 * Before Holds, that answer was spread across four unrelated facts that nothing kept in sync:
 * `tasks.status` (where `blocked` was a bucket for five unrelated situations), the current Business
 * Artifact's `reviewStatus`, the status of the matching Human Action / Founder Decision / Approval,
 * and the newest Task Progress Event. Each surface read a different one, so CEO Office could offer
 * an approval the API would reject while the department board showed the same task as blocked, and
 * a founder had no offered action that could actually restart it.
 *
 * A Hold makes that one persisted fact with an owner. The rules that make the model worth having:
 *
 * 1. **Parked implies held.** A task in a Held Task Status has at least one open Hold, and a task in
 *    a self-propelling or terminal status has none. `applyTaskTransition` is the only writer of task
 *    status and enforces both directions, so the two can never drift apart.
 * 2. **Every Hold has a way out.** `resolveTaskAffordances` maps every `TaskHoldKind` to at least one
 *    Resume Affordance other than cancelling, exhaustively over the union. A new Hold kind cannot be
 *    added without declaring how it is resolved — the compiler and `taskHold.test.ts` both refuse it.
 * 3. **Affordances are computed once, server-side.** Surfaces and API guards read the same set, so a
 *    button that a guard would reject cannot be rendered, and a resolvable Hold cannot be invisible.
 */
export type TaskHoldKind =
  /** A reviewable Business Artifact is waiting for a CEO Office approve/return decision. */
  | "awaiting_ceo_review"
  /** A risk policy requires Founder Approval before the task may be dispatched. */
  | "awaiting_founder_approval"
  /** A person must act outside the runtime before the task can proceed. */
  | "awaiting_human_action"
  /** An open Founder Decision governs the task's direction. */
  | "awaiting_founder_decision"
  /** An upstream task owes an accepted Business Artifact this task consumes. */
  | "awaiting_dependency_artifact"
  /** Progress depends on an external delay or result, not on any actor. */
  | "awaiting_external_wait"
  /** The task produced output that is not reviewable proof and needs rework or recapture. */
  | "invalid_business_artifact"
  /** Bounded Recovery hit its attempt ceiling; only new upstream input or a replan resets it. */
  | "recovery_exhausted"
  /** The plan itself is wrong for the goal; the task needs replanning before it can run again. */
  | "needs_replan"
  /**
   * Execution stopped for a reason the runtime could not attribute to any of the above — a timed-out
   * or crashed run, a restart mid-flight, or a status transition that declared no Hold of its own.
   * The deliberate catch-all: it keeps rule 1 true for situations nobody modelled in advance, at the
   * cost of a vaguer reason string, instead of silently producing a task no one can move.
   */
  | "runtime_interrupted";

export const taskHoldKinds = [
  "awaiting_ceo_review",
  "awaiting_founder_approval",
  "awaiting_human_action",
  "awaiting_founder_decision",
  "awaiting_dependency_artifact",
  "awaiting_external_wait",
  "invalid_business_artifact",
  "recovery_exhausted",
  "needs_replan",
  "runtime_interrupted",
] as const satisfies readonly TaskHoldKind[];

/**
 * The one task status each Hold kind is coherent in, or `null` when the kind can outlive any status.
 *
 * Exhaustive over the union on purpose. "A Hold that outlived its status" is the mechanism of the
 * original failure — a CEO review still being offered on a task that had left `review` — so the
 * defence against it must not be a list someone can forget to add to. A new `TaskHoldKind` will not
 * compile until it states which status, if any, it belongs to.
 */
export const taskHoldStatusBinding: Record<TaskHoldKind, TaskStatus | null> = {
  awaiting_ceo_review: "review",
  needs_replan: "needs_replan",
  // The rest survive a change of status: an unanswered approval, an unconfirmed Human Action or an
  // upstream that still owes a deliverable stays true however the task itself was re-parked.
  awaiting_founder_approval: null,
  awaiting_human_action: null,
  awaiting_founder_decision: null,
  awaiting_dependency_artifact: null,
  awaiting_external_wait: null,
  invalid_business_artifact: null,
  recovery_exhausted: null,
  runtime_interrupted: null,
};

/** Whether this Hold has been made untrue by the task being in `status`. */
export function isTaskHoldStranded(kind: TaskHoldKind, status: TaskStatus): boolean {
  const boundTo = taskHoldStatusBinding[kind];
  return boundTo !== null && boundTo !== status;
}

/** Who can clear a Hold. `upstream_task` and `time` clear without anyone acting on this task. */
export type TaskHoldResolver = "ceo_office" | "founder" | "upstream_task" | "runtime" | "time";

/** The record a Hold is waiting on, so a surface can link to it instead of restating it. */
export type TaskHoldSubjectKind =
  | "business_artifact"
  | "human_action"
  | "founder_decision"
  | "approval"
  | "task"
  | "wait_state"
  | "agent_run";

/** How an open Hold ended. `superseded` means the fact behind it changed, not that anyone acted. */
export type TaskHoldResolution = "cleared" | "superseded" | "cancelled";

export type TaskHold = {
  id: string;
  companyId: string;
  taskId: string;
  kind: TaskHoldKind;
  resolver: TaskHoldResolver;
  subjectKind: TaskHoldSubjectKind | null;
  subjectId: string | null;
  /** Runtime-authored English reason; `reasonText` carries the founder-facing company locale. */
  reason: string;
  reasonText: LocalizedText | null;
  openedAt: string;
  resolvedAt: string | null;
  resolution: TaskHoldResolution | null;
};

/**
 * Statuses in which the runtime will move the task on its own. A task in one of these must have no
 * open Hold: if something is genuinely waiting, it belongs in a Held Task Status with a Hold.
 */
export const selfPropellingTaskStatuses = ["queued", "running", "retrying"] as const satisfies readonly TaskStatus[];

/** Statuses from which the task never moves again. No Hold survives a transition into one. */
export const terminalTaskStatuses = ["complete", "cancelled"] as const satisfies readonly TaskStatus[];

/**
 * Statuses that mean "stopped, waiting on something". Every one of these requires an open Hold —
 * `waiting_dependency` included, because "waiting on upstream task X" is exactly a Hold with a
 * subject, and modelling it as one is what lets a surface name the task being waited on.
 */
export const heldTaskStatuses = [
  "waiting_dependency",
  "blocked",
  "review",
  "needs_replan",
  "failed",
] as const satisfies readonly TaskStatus[];

export function isSelfPropellingTaskStatus(status: TaskStatus): boolean {
  return (selfPropellingTaskStatuses as readonly TaskStatus[]).includes(status);
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return (terminalTaskStatuses as readonly TaskStatus[]).includes(status);
}

export function isHeldTaskStatus(status: TaskStatus): boolean {
  return (heldTaskStatuses as readonly TaskStatus[]).includes(status);
}

/** A Resume Affordance: an action some actor can take right now to move this task forward. */
export type TaskAffordanceKind =
  | "ceo_review_decision"
  | "decide_founder_approval"
  | "confirm_human_action"
  | "resolve_founder_decision"
  | "refresh_task"
  | "recover_task"
  | "request_replan"
  | "confirm_replan"
  | "cancel_task";

export type TaskAffordance = {
  kind: TaskAffordanceKind;
  /** Who is expected to take it. Surfaces route by this; guards do not check it. */
  actor: TaskHoldResolver;
  /** The Hold this clears, or `null` for an affordance available regardless of why the task stopped. */
  holdId: string | null;
  holdKind: TaskHoldKind | null;
  subjectKind: TaskHoldSubjectKind | null;
  subjectId: string | null;
};

export type ResolveTaskAffordancesInput = {
  status: TaskStatus;
  /** Open Holds only. Resolved Holds never contribute an affordance. */
  holds: readonly TaskHold[];
  /** A `proposed` Replan Proposal exists for this task, so it can be confirmed rather than re-requested. */
  hasProposedReplan?: boolean;
};

/**
 * The one computation of "what can be done to this task right now", shared by API guards, CEO
 * Office, and the department board. Pure: same facts in, same answer everywhere.
 *
 * Guarantees, both asserted in `taskHold.test.ts`:
 * - A task with any open Hold gets a non-empty set that is not only `cancel_task` — there is always
 *   a real way forward, never just an escape hatch.
 * - A task with no open Hold gets no Hold-derived affordances; a self-propelling task needs none
 *   because the runtime already owns it.
 */
/**
 * Statuses in which an affordance is actually applicable, for the two actions whose runtime can only
 * operate from certain states. Declared here so the offer and the runtime's own precondition are the
 * same rule: an action that is offered must be one the runtime will accept.
 */
const affordanceStatusGates: Partial<Record<TaskAffordanceKind, readonly TaskStatus[]>> = {
  // Refreshing re-derives dependency readiness or recaptures proof left in the workspace.
  refresh_task: ["blocked", "failed", "waiting_dependency"],
  // Recovery re-runs the work, or continues it from Partial Output.
  recover_task: ["blocked", "failed", "needs_replan"],
};

/**
 * Whether an action is applicable to a task in this status at all.
 *
 * The single declaration of these preconditions, read both by the offer (`resolveTaskAffordances`)
 * and by the runtime that performs the action. Keeping a second copy next to the implementation is
 * how the offer and the guard drifted apart in the first place, so the runtime imports this rather
 * than restating it.
 */
export function isAffordanceApplicable(kind: TaskAffordanceKind, status: TaskStatus): boolean {
  const gate = affordanceStatusGates[kind];
  return !gate || gate.includes(status);
}

export function resolveTaskAffordances(input: ResolveTaskAffordancesInput): TaskAffordance[] {
  const affordances: TaskAffordance[] = [];
  const seen = new Set<string>();

  const offer = (hold: TaskHold | null, kind: TaskAffordanceKind, actor: TaskHoldResolver) => {
    if (!isAffordanceApplicable(kind, input.status)) {
      return;
    }

    const key = `${kind}:${hold?.id ?? ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    affordances.push({
      kind,
      actor,
      holdId: hold?.id ?? null,
      holdKind: hold?.kind ?? null,
      subjectKind: hold?.subjectKind ?? null,
      subjectId: hold?.subjectId ?? null,
    });
  };

  for (const hold of input.holds) {
    if (hold.resolvedAt) {
      continue;
    }

    switch (hold.kind) {
      case "awaiting_ceo_review":
        offer(hold, "ceo_review_decision", "ceo_office");
        break;
      case "awaiting_founder_approval":
        offer(hold, "decide_founder_approval", "founder");
        break;
      case "awaiting_human_action":
        offer(hold, "confirm_human_action", "founder");
        break;
      case "awaiting_founder_decision":
        offer(hold, "resolve_founder_decision", "founder");
        // A downstream task parked on someone else's decision can also just be re-derived; the
        // status gate keeps this off the upstream task sitting in `review`.
        offer(hold, "refresh_task", "runtime");
        break;
      case "awaiting_dependency_artifact":
        // Re-derive readiness against current facts; if the upstream path is genuinely dead, the
        // founder replans rather than waiting on a task that will never deliver.
        offer(hold, "refresh_task", "runtime");
        offer(hold, "request_replan", "founder");
        break;
      case "awaiting_external_wait":
        // Nobody owns the wait, but the founder may force the check instead of waiting for the tick.
        offer(hold, "refresh_task", "runtime");
        break;
      case "invalid_business_artifact":
        // Cheapest first: a refresh recaptures proof the run already left in the workspace. Recovery
        // re-runs the work, and replanning is the way out when the task as specified cannot produce
        // reviewable proof at all.
        offer(hold, "refresh_task", "runtime");
        offer(hold, "recover_task", "runtime");
        offer(hold, "request_replan", "founder");
        break;
      case "recovery_exhausted":
        // Deliberately no `recover_task`: Bounded Recovery's ceiling exists to stop blind re-runs.
        offer(hold, "request_replan", "founder");
        break;
      case "needs_replan":
        if (input.hasProposedReplan) {
          offer(hold, "confirm_replan", "founder");
        }
        offer(hold, "request_replan", "founder");
        break;
      case "runtime_interrupted":
        // Nothing is known about why the run stopped, so the way back is to run it again; a refresh
        // would only re-derive state that is not what went wrong.
        offer(hold, "recover_task", "runtime");
        offer(hold, "request_replan", "founder");
        break;
      default: {
        // Exhaustiveness guard: a new Hold kind must declare how it is resolved (rule 2).
        const unreachable: never = hold.kind;
        throw new Error(`Task Hold kind has no Resume Affordance: ${String(unreachable)}`);
      }
    }
  }

  if (!isTerminalTaskStatus(input.status)) {
    // The founder's escape hatch, available on any task that has not finished — including one the
    // runtime is actively working. For a held task it is offered alongside real ways forward and
    // never instead of them: a set that is only `cancel_task` is the dead end this model prevents.
    offer(null, "cancel_task", "founder");
  }

  return affordances;
}

/**
 * The Hold a status transition implies when the caller does not declare one.
 *
 * Call sites that know why they are parking a task should pass an explicit Hold with its subject;
 * this is the floor that keeps rule 1 true for the ones that do not, including code written later
 * that never heard of Holds. It reads the same execution summary the old surfaces read, so a
 * mechanically converted call site keeps its meaning.
 */
export function deriveTaskHold(input: {
  status: TaskStatus;
  failureReason?: AgentFailureReason | null;
  dependencyNote?: string | null;
}): { kind: TaskHoldKind; resolver: TaskHoldResolver } | null {
  if (!isHeldTaskStatus(input.status)) {
    return null;
  }

  if (input.status === "review") {
    return { kind: "awaiting_ceo_review", resolver: "ceo_office" };
  }

  if (input.status === "needs_replan") {
    return { kind: "needs_replan", resolver: "founder" };
  }

  if (input.status === "waiting_dependency") {
    return { kind: "awaiting_dependency_artifact", resolver: "upstream_task" };
  }

  switch (input.failureReason) {
    case "retry_exhausted":
      return { kind: "recovery_exhausted", resolver: "founder" };
    case "needs_replan":
      return { kind: "needs_replan", resolver: "founder" };
    case "dependency_failed":
    case "missing_deliverable":
    case "upstream_artifact_not_accepted":
      return { kind: "awaiting_dependency_artifact", resolver: "upstream_task" };
    case "missing_business_artifact":
    case "invalid_business_artifact":
    case "non_reviewable_artifact":
    case "stale_business_artifact":
    case "direction_drift":
    case "no_proof":
    case "proof_capture_failed":
      return { kind: "invalid_business_artifact", resolver: "runtime" };
    // Unreadable output is not an artifact problem — nothing got as far as producing one — and the
    // only way forward is to run it again, which is what this Hold offers. Stated explicitly rather
    // than left to the catch-all below: this stop is modelled, and `runtime_interrupted` should keep
    // meaning "nobody modelled this" (ADR 0020).
    case "invalid_agent_output":
      return { kind: "runtime_interrupted", resolver: "runtime" };
    default:
      return { kind: "runtime_interrupted", resolver: "runtime" };
  }
}
