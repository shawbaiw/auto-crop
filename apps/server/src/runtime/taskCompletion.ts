import type { BusinessArtifact, Task, TaskCompletionEvent, TaskCompletionOutcome } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";

export function recordTaskCompletionEvent(input: {
  repositories: ReturnType<typeof createRepositories>;
  task: Task;
  outcome: TaskCompletionOutcome;
  businessArtifact?: BusinessArtifact | null;
  dependencyImpact?: unknown;
  nextStepItems?: unknown[];
  visionGaps?: unknown[];
  now?: () => Date;
  createId?: (prefix: string) => string;
}): TaskCompletionEvent {
  const event: TaskCompletionEvent = {
    id: input.createId?.("task_completion_event") ?? `task_completion_event_${Date.now()}`,
    companyId: input.task.companyId,
    taskId: input.task.id,
    departmentId: input.task.departmentId,
    keyResultId: input.task.keyResultId,
    businessArtifactId: input.businessArtifact?.id ?? null,
    outcome: input.outcome,
    dependencyImpact: input.dependencyImpact ?? {},
    nextStepItems: input.nextStepItems ?? [],
    visionGaps: input.visionGaps ?? [],
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
  };

  input.repositories.appendTaskCompletionEvent(event);
  return event;
}
