import { readFileSync } from "node:fs";
import type { Task } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { applyTaskTransition, type TaskHoldDeclaration } from "./taskTransition";

export type FailureDecision = "create_fix_task" | "mark_blocked" | "escalate_to_ceo";

export type RouteWorkerFailureInput = {
  repositories: ReturnType<typeof createRepositories>;
  failedTask: Task;
  logPath: string;
  decision: FailureDecision;
  createId?: (prefix: string) => string;
};

export type RouteWorkerFailureResult =
  | { kind: "fix_task_created"; taskId: string; routedToAgentId: string; logExcerpt: string }
  | { kind: "blocked"; taskId: string; logExcerpt: string }
  | { kind: "escalated_to_ceo"; taskId: string; logExcerpt: string };

export function routeWorkerFailure(input: RouteWorkerFailureInput): RouteWorkerFailureResult {
  const logExcerpt = readLogExcerpt(input.logPath);

  const transition = (status: "failed" | "blocked" | "review", hold: TaskHoldDeclaration) =>
    applyTaskTransition({
      repositories: input.repositories,
      task: input.failedTask,
      status,
      hold,
      createId: input.createId,
    });

  if (input.decision === "mark_blocked") {
    transition("blocked", {
      kind: "invalid_business_artifact",
      reason: `Worker failure on ${input.failedTask.title} was routed to the CEO Blocked Queue.`,
    });
    return { kind: "blocked", taskId: input.failedTask.id, logExcerpt };
  }

  if (input.decision === "escalate_to_ceo") {
    transition("review", {
      kind: "awaiting_ceo_review",
      subjectKind: "task",
      subjectId: input.failedTask.id,
      reason: `Worker failure on ${input.failedTask.title} was escalated to CEO Office.`,
    });
    return { kind: "escalated_to_ceo", taskId: input.failedTask.id, logExcerpt };
  }

  transition("failed", {
    kind: "runtime_interrupted",
    reason: `Worker run for ${input.failedTask.title} failed; a fix task carries the work forward.`,
  });

  const createId = input.createId ?? defaultCreateId;
  const fixTaskId = `${input.failedTask.id}_fix_${extractNumericSuffix(createId("fix"))}`;
  const fixTask: Task = {
    ...input.failedTask,
    id: fixTaskId,
    title: `Fix failed task: ${input.failedTask.title}`,
    description: [
      "Review the failed worker log and produce corrected proof.",
      "",
      "Failure log excerpt:",
      logExcerpt,
    ].join("\n"),
    status: "queued",
    position: input.repositories.getNextTaskPosition(input.failedTask.companyId),
  };

  input.repositories.createTask(fixTask);

  return {
    kind: "fix_task_created",
    taskId: fixTask.id,
    routedToAgentId: fixTask.assigneeAgentId,
    logExcerpt,
  };
}

function readLogExcerpt(logPath: string): string {
  const content = readFileSync(logPath, "utf8");
  return content.trim().slice(0, 2000);
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function extractNumericSuffix(id: string): string {
  return id.split("_").at(-1) ?? "1";
}
