import type {
  BusinessArtifact,
  KeyResult,
  LocalizedText,
  Task,
  TaskAcceptanceProvenance,
  TaskEvent,
  TaskEventType,
} from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { propagateDependencyCascade, type DependencyCascadeResult } from "./dependencyCascade";
import type { FounderDecisionDeclaration } from "./founderDecision";
import { createDefaultId } from "./ids";
import { recordTaskCompletionEvent } from "./taskCompletion";

export type BusinessAcceptanceResult = {
  dependencyCascade?: DependencyCascadeResult;
  event: TaskEvent;
  task: Task;
};

export function acceptTaskBusinessArtifact(input: {
  repositories: ReturnType<typeof createRepositories>;
  task: Task;
  artifact: BusinessArtifact;
  acceptanceProvenance: TaskAcceptanceProvenance;
  eventType: TaskEventType;
  eventMessage: string;
  /**
   * Passed straight to {@link recordTaskCompletionEvent}. The Founder Decision resolution path passes
   * `[]` so the accepted deliverable's Task Completion Event carries no `founder_decision` Next Step
   * Items even if a stale `open_decisions` entry lingers in the payload.
   */
  founderDecisions?: FounderDecisionDeclaration[];
  /**
   * Passed straight to {@link recordTaskCompletionEvent}: `undefined` reads the Task Outcome Summary
   * from the artifact payload, an explicit `null` records none. The migration reconciliation passes
   * `null` so a reconciled acceptance fabricates no summary.
   */
  outcomeSummaryText?: LocalizedText | null;
  keyResultProgress?: {
    currentValue: string;
    status: KeyResult["status"];
  };
  dependencyCascade?: {
    maxDepth: number;
  };
  requestSchedulerWake?: () => void;
  now?: () => Date;
  createId?: (prefix: string) => string;
}): BusinessAcceptanceResult {
  const timestamp = (input.now ?? (() => new Date()))().toISOString();

  input.repositories.updateBusinessArtifactReviewStatus(input.artifact.id, "accepted", timestamp);
  input.repositories.updateTaskStatus(input.task.id, "complete");
  if (input.task.keyResultId && input.keyResultProgress) {
    input.repositories.updateKeyResultProgress(
      input.task.keyResultId,
      input.keyResultProgress.currentValue,
      input.keyResultProgress.status,
    );
  }

  const event: TaskEvent = {
    id: input.createId?.("task_event") ?? createDefaultId("task_event"),
    companyId: input.task.companyId,
    taskId: input.task.id,
    type: input.eventType,
    message: input.eventMessage,
    createdAt: timestamp,
    status: "complete",
    failureReason: null,
    failureMessage: null,
    executionProfileName: input.task.latestExecutionProfileName ?? null,
    requestedTimeoutMs: input.task.latestRequestedTimeoutMs ?? null,
    effectiveTimeoutMs: input.task.latestEffectiveTimeoutMs ?? null,
    dependencyNote: input.task.dependencyNote ?? null,
    artifactWorkspacePath: input.task.artifactWorkspacePath ?? null,
  };
  input.repositories.appendTaskEvent(event);
  const dependencyCascade = input.dependencyCascade
    ? propagateDependencyCascade({
      repositories: input.repositories,
      sourceTaskId: input.task.id,
      maxDepth: input.dependencyCascade.maxDepth,
      now: input.now,
      createId: input.createId,
    })
    : undefined;
  if (dependencyCascade?.updatedTasks.some((update) => update.task.status === "queued")) {
    input.requestSchedulerWake?.();
  }
  recordTaskCompletionEvent({
    repositories: input.repositories,
    task: input.task,
    businessArtifact: input.artifact,
    outcome: "accepted",
    acceptanceProvenance: input.acceptanceProvenance,
    ...(input.founderDecisions ? { founderDecisions: input.founderDecisions } : {}),
    ...(input.outcomeSummaryText !== undefined ? { outcomeSummaryText: input.outcomeSummaryText } : {}),
    dependencyImpact: {
      updatedTasks: dependencyCascade?.updatedTasks.map((update) => ({
        taskId: update.task.id,
        status: update.task.status,
      })) ?? [],
      errors: dependencyCascade?.errors ?? [],
    },
    now: input.now,
    createId: input.createId,
  });

  return {
    dependencyCascade,
    event,
    task: {
      ...input.task,
      status: "complete",
    },
  };
}

/**
 * Accept a deliverable on the Automatic Acceptance path: {@link acceptTaskBusinessArtifact} with
 * provenance and event type `automatic_acceptance`, the key result marked met, and a bounded
 * dependency cascade. Shared by the scheduler's completion branch and the ADR 0017 migration
 * reconciliation so the two cannot drift. Returns the acceptance result plus its acceptance event
 * and every cascade event, flattened in order, ready to emit or collect.
 */
export function acceptDeliverableAutomatically(input: {
  repositories: ReturnType<typeof createRepositories>;
  task: Task;
  artifact: BusinessArtifact;
  eventMessage: string;
  /** `undefined` reads the Task Outcome Summary from the payload; `null` records none (reconciliation). */
  outcomeSummaryText?: LocalizedText | null;
  requestSchedulerWake?: () => void;
  now?: () => Date;
  createId?: (prefix: string) => string;
}): { acceptance: BusinessAcceptanceResult; events: TaskEvent[] } {
  const acceptance = acceptTaskBusinessArtifact({
    repositories: input.repositories,
    task: input.task,
    artifact: input.artifact,
    acceptanceProvenance: "automatic_acceptance",
    eventType: "automatic_acceptance",
    eventMessage: input.eventMessage,
    ...(input.outcomeSummaryText !== undefined ? { outcomeSummaryText: input.outcomeSummaryText } : {}),
    keyResultProgress: { currentValue: "accepted_business_artifact", status: "met" },
    dependencyCascade: { maxDepth: 2 },
    requestSchedulerWake: input.requestSchedulerWake,
    now: input.now,
    createId: input.createId,
  });
  const events: TaskEvent[] = [
    acceptance.event,
    ...(acceptance.dependencyCascade?.updatedTasks ?? []).flatMap((update) =>
      update.event ? [update.event] : [],
    ),
  ];
  return { acceptance, events };
}
