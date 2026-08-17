import { readFileSync } from "node:fs";
import type { Task } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";

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

  input.repositories.updateTaskStatus(input.failedTask.id, "failed");

  if (input.decision === "mark_blocked") {
    input.repositories.updateTaskStatus(input.failedTask.id, "blocked");
    return { kind: "blocked", taskId: input.failedTask.id, logExcerpt };
  }

  if (input.decision === "escalate_to_ceo") {
    input.repositories.updateTaskStatus(input.failedTask.id, "review");
    return { kind: "escalated_to_ceo", taskId: input.failedTask.id, logExcerpt };
  }

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
