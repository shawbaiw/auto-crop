import {
  deriveTaskHold,
  isHeldTaskStatus,
  isSelfPropellingTaskStatus,
  isTaskHoldStranded,
  taskHoldKinds,
  localizedTextFromString,
  type AgentFailureReason,
  type LocalizedText,
  type Task,
  type TaskHold,
  type TaskHoldKind,
  type TaskHoldResolution,
  type TaskHoldResolver,
  type TaskHoldSubjectKind,
  type TaskStatus,
} from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";

/**
 * The one seam every task-status change goes through (ADR 0020).
 *
 * Before it, thirteen call sites wrote `tasks.status` directly and each was separately responsible
 * for whatever else had to change with it. Nothing checked, so a task could leave `review` while
 * CEO Office still offered an approval for it, and land in `blocked` with no actor able to move it.
 *
 * The seam owns the part no call site should have to remember:
 *
 * - **Parked implies held.** A transition into a Held Task Status opens a Task Hold — the declared
 *   one, or one derived from the execution summary when the caller declares none. A transition into
 *   a self-propelling or terminal status resolves every open Hold on the task. A task therefore
 *   cannot end a transition stopped-but-unowned, whatever the caller forgot to say.
 * - **Status-bound Holds cannot outlive their status.** `awaiting_ceo_review` is only coherent while
 *   the task is in `review`; `needs_replan` only while it is `needs_replan`. Leaving either status
 *   resolves the Hold as `superseded` in the same write, which is what stops CEO Office from
 *   offering a decision the API would then reject.
 * - **Idempotence.** Re-parking a task for a reason it is already held on reuses the open Hold
 *   rather than stacking duplicates, so a retried or re-entered code path is harmless.
 */
export type TaskHoldDeclaration = {
  kind: TaskHoldKind;
  /** Defaults to the resolver `deriveTaskHold` assigns this kind. */
  resolver?: TaskHoldResolver;
  subjectKind?: TaskHoldSubjectKind | null;
  subjectId?: string | null;
  /** Defaults to the task's latest failure message, then to a statement of the kind. */
  reason?: string;
  reasonText?: LocalizedText | null;
};

export type TaskExecutionSummaryUpdate = {
  latestFailureReason?: AgentFailureReason | null;
  latestFailureMessage?: string | null;
  latestExecutionProfileName?: string | null;
  latestRequestedTimeoutMs?: number | null;
  latestEffectiveTimeoutMs?: number | null;
  dependencyNote?: string | null;
  artifactWorkspacePath?: string | null;
};

export type ApplyTaskTransitionInput = {
  repositories: ReturnType<typeof createRepositories>;
  task: Task | string;
  status: TaskStatus;
  /** Why the task is stopping. Ignored for statuses that are not held. */
  hold?: TaskHoldDeclaration | null;
  /** Applied before the Hold is derived, so derivation sees the failure reason being recorded. */
  executionSummary?: TaskExecutionSummaryUpdate;
  /** How Holds this transition ends were resolved. Defaults to `superseded` — no actor cleared them. */
  resolution?: TaskHoldResolution;
  /**
   * Holds whose resolver actually answered them. These close even when the task stays parked for
   * some other reason — a founder who answers an approval has answered it, whether or not the task
   * is also blocked on a dependency. Without this the answered Hold would linger and keep offering
   * an action that has already been taken.
   */
  resolvesHoldIds?: readonly string[];
  /**
   * Holds this transition's *reason* addresses, by kind — for callers that know what they resolved
   * but not which Hold rows carry it, such as a dependency cascade that just found the upstream
   * ready. Same effect as naming the ids.
   */
  resolvesHoldKinds?: readonly TaskHoldKind[];
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export type TaskTransitionResult = {
  task: Task;
  openedHolds: TaskHold[];
  resolvedHolds: TaskHold[];
  /**
   * `false` when the transition was refused because Holds this caller did not account for are still
   * open. The named Holds are still resolved; the task simply did not move.
   */
  moved: boolean;
};

export function applyTaskTransition(input: ApplyTaskTransitionInput): TaskTransitionResult {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;
  const timestamp = now().toISOString();
  const taskId = typeof input.task === "string" ? input.task : input.task.id;
  const resolution = input.resolution ?? "superseded";

  const before = input.repositories.getTask(taskId);
  if (!before) {
    throw new Error(`Task not found for transition: ${taskId}`);
  }

  const answeredHolds = resolveNamedHolds(input, taskId, resolution, timestamp);

  // Default-safe: a task only starts moving again when *nothing* is left holding it. A caller that
  // knows why the task can run says so with `resolvesHoldIds` / `resolvesHoldKinds`; anything it did
  // not account for keeps the task where it is. This is the rule rather than a convention each
  // caller has to remember, because every caller that had to remember it got it wrong — clearing one
  // Hold was read as "nothing is in the way", and the task then advertised itself as about to run
  // while the thing it still waited on was invisible (ADR 0020 amendment).
  if (isSelfPropellingTaskStatus(input.status) && input.repositories.listOpenTaskHolds(taskId).length > 0) {
    return { task: before, openedHolds: [], resolvedHolds: answeredHolds, moved: false };
  }

  input.repositories.writeTaskStatusUnchecked(taskId, input.status);
  if (input.executionSummary) {
    input.repositories.updateTaskExecutionSummary(taskId, input.executionSummary);
  }

  const task = input.repositories.getTask(taskId);
  if (!task) {
    throw new Error(`Task disappeared during transition: ${taskId}`);
  }

  const resolvedHolds = [
    ...answeredHolds,
    ...resolveContradictedHolds(input.repositories, task, resolution, timestamp),
  ];
  const openedHolds = openHoldForStatus(input, task, createId, timestamp);

  return { task: input.repositories.getTask(taskId) ?? task, openedHolds, resolvedHolds, moved: true };
}

/** Close the Holds the caller says this transition answers, whether named by id or by kind. */
function resolveNamedHolds(
  input: ApplyTaskTransitionInput,
  taskId: string,
  resolution: TaskHoldResolution,
  timestamp: string,
): TaskHold[] {
  const byId = (input.resolvesHoldIds ?? [])
    .map((holdId) => input.repositories.resolveTaskHoldById(holdId, resolution, timestamp))
    .filter((hold): hold is TaskHold => hold !== null);

  if (!input.resolvesHoldKinds || input.resolvesHoldKinds.length === 0) {
    return byId;
  }

  return [
    ...byId,
    ...input.repositories.resolveOpenTaskHolds(taskId, resolution, timestamp, input.resolvesHoldKinds),
  ];
}

/**
 * The open Hold an actor is about to answer, found by what it waits on. Two Holds of the same kind
 * on one task are two separate waits, so the subject — an Approval id, a Human Action id, an upstream
 * task id — is what identifies the one being answered.
 */
export function findOpenTaskHold(
  repositories: ReturnType<typeof createRepositories>,
  taskId: string,
  kind: TaskHoldKind,
  subjectId?: string | null,
): TaskHold | null {
  return repositories
    .listOpenTaskHolds(taskId)
    .find((hold) => hold.kind === kind && (subjectId === undefined || hold.subjectId === subjectId))
    ?? null;
}

/**
 * Answer one Hold on behalf of the actor who resolved it.
 *
 * A thin reading of {@link applyTaskTransition}: name the Hold, and the seam's default-safe rule
 * does the rest — the task moves only if that was the last thing holding it, and otherwise stays put
 * one Hold lighter. Callers use this for readability, not for different behaviour; a path that
 * forgets it and calls the seam directly still cannot start a task something else is holding.
 */
export function releaseTaskHold(input: {
  repositories: ReturnType<typeof createRepositories>;
  task: Task;
  holdId: string;
  /** Where the task goes when this was the last Hold. Defaults to `queued`. */
  released?: TaskStatus;
  executionSummary?: TaskExecutionSummaryUpdate;
  now?: () => Date;
  createId?: (prefix: string) => string;
}): TaskTransitionResult {
  return applyTaskTransition({
    repositories: input.repositories,
    task: input.task,
    status: input.released ?? "queued",
    executionSummary: input.executionSummary,
    resolution: "cleared",
    resolvesHoldIds: [input.holdId],
    now: input.now,
    createId: input.createId,
  });
}

/**
 * Close the Holds the new status makes untrue: all of them once the task is moving or finished, and
 * the status-bound ones whenever the task is no longer in the status they belong to.
 */
function resolveContradictedHolds(
  repositories: ReturnType<typeof createRepositories>,
  task: Task,
  resolution: TaskHoldResolution,
  timestamp: string,
): TaskHold[] {
  if (!isHeldTaskStatus(task.status)) {
    return repositories.resolveOpenTaskHolds(task.id, resolution, timestamp);
  }

  // Holds the new status has made untrue — the general form of "a CEO review that is no longer
  // pending must stop being offered". The binding lives with the Hold kind itself (core), so a new
  // kind cannot be added without saying whether it is status-bound.
  const stranded = taskHoldKinds.filter((kind) => isTaskHoldStranded(kind, task.status));

  return repositories.resolveOpenTaskHolds(task.id, resolution, timestamp, stranded);
}

/**
 * Open the Hold for a task that just parked. Reuses an equivalent open Hold instead of stacking a
 * duplicate, so re-entering the same blocking path does not multiply the founder's queue.
 */
function openHoldForStatus(
  input: ApplyTaskTransitionInput,
  task: Task,
  createId: (prefix: string) => string,
  timestamp: string,
): TaskHold[] {
  if (!isHeldTaskStatus(task.status)) {
    return [];
  }

  const derived = deriveTaskHold({
    status: task.status,
    taskKind: task.taskKind,
    failureReason: task.latestFailureReason,
    dependencyNote: task.dependencyNote,
  });
  const declaration = input.hold ?? (derived ? { kind: derived.kind } : null);

  if (!declaration) {
    // Unreachable while `deriveTaskHold` covers every held status, which `taskHold.test.ts` asserts.
    throw new Error(`No Task Hold could be derived for status ${task.status} on task ${task.id}`);
  }

  // A declared kind that matches what the facts imply keeps the derived resolver; a caller that
  // declares something different gets that kind's own default owner.
  const resolver = declaration.resolver
    ?? (derived?.kind === declaration.kind ? derived.resolver : defaultResolverForKind(declaration.kind));
  const reason = declaration.reason
    ?? task.latestFailureMessage
    ?? task.dependencyNote
    ?? defaultReasonForKind(declaration.kind, task);

  const existing = input.repositories
    .listOpenTaskHolds(task.id)
    .find((hold) => hold.kind === declaration.kind && (hold.subjectId ?? null) === (declaration.subjectId ?? null));

  if (existing) {
    return [existing];
  }

  const hold: TaskHold = {
    id: createId("task_hold"),
    companyId: task.companyId,
    taskId: task.id,
    kind: declaration.kind,
    resolver,
    subjectKind: declaration.subjectKind ?? null,
    subjectId: declaration.subjectId ?? null,
    reason,
    reasonText: declaration.reasonText ?? localizedTextFromString(reason),
    openedAt: timestamp,
    resolvedAt: null,
    resolution: null,
  };
  input.repositories.openTaskHold(hold);

  return [hold];
}

function defaultResolverForKind(kind: TaskHoldKind): TaskHoldResolver {
  switch (kind) {
    case "awaiting_ceo_review":
      return "ceo_office";
    case "awaiting_dependency_artifact":
      return "upstream_task";
    case "awaiting_external_wait":
      return "time";
    case "invalid_business_artifact":
    case "verification_failed":
    case "awaiting_parent_aggregation":
    case "runtime_interrupted":
      return "runtime";
    default:
      return "founder";
  }
}

function defaultReasonForKind(kind: TaskHoldKind, task: Task): string {
  switch (kind) {
    case "awaiting_ceo_review":
      return `Waiting for a CEO Office review decision on ${task.title}.`;
    case "awaiting_parent_aggregation":
      return `${task.title} is delivered and waiting for its parent task to aggregate it.`;
    case "awaiting_founder_approval":
      return `Waiting for Founder Approval before ${task.title} can run.`;
    case "awaiting_human_action":
      return `Waiting for a Human Action before ${task.title} can proceed.`;
    case "awaiting_founder_decision":
      return `Waiting for a Founder Decision that governs ${task.title}.`;
    case "awaiting_dependency_artifact":
      return `Waiting for an accepted upstream Business Artifact that ${task.title} consumes.`;
    case "awaiting_external_wait":
      return `Waiting on an external result before ${task.title} can proceed.`;
    case "invalid_business_artifact":
      return `${task.title} has no reviewable Business Artifact yet.`;
    case "recovery_exhausted":
      return `${task.title} reached the Bounded Recovery ceiling and needs a replan.`;
    case "needs_replan":
      return `${task.title} needs replanning before it can run again.`;
    case "verification_failed":
      return `${task.title} verified its target and the verification did not pass.`;
    case "runtime_interrupted":
      return `${task.title} stopped without an attributed reason and needs a decision.`;
    default: {
      const unreachable: never = kind;
      throw new Error(`Unhandled Task Hold kind: ${String(unreachable)}`);
    }
  }
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
