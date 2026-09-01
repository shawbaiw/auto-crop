import type {
  BusinessArtifact,
  KeyResult,
  Task,
  TaskEvent,
  TaskEventType,
} from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { propagateDependencyCascade, type DependencyCascadeResult } from "./dependencyCascade";
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
  eventType: TaskEventType;
  eventMessage: string;
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
    id: input.createId?.("task_event") ?? `task_event_${Date.now()}`,
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
