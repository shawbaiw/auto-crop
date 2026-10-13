import type { TaskProgressEventSummary, TaskSummary } from "../../api/client";

/** One agent run of a task: the progress steps the runtime recorded for it, oldest first. */
export type TraceRun = { index: number; steps: TaskProgressEventSummary[] };

/**
 * What a task's trace shows by default (dashboard ADR 0002):
 * - `live`: a run is going — expanded, and it updates as steps arrive;
 * - `settled`: the server checked the delivery and the task left `running` — folded to a summary
 *   line, with the final result kept in view;
 * - `stopped`: failed, blocked, needs a new plan or cancelled — expanded at the failing step;
 * - `waiting`: not started, or waiting on something — open, like every trace whose result is not settled.
 */
export type TraceState = "live" | "settled" | "stopped" | "waiting";

export function traceState(task: Pick<TaskSummary, "status">): TraceState {
  switch (task.status) {
    case "running":
    case "retrying":
      return "live";
    case "complete":
    case "review":
      return "settled";
    case "failed":
    case "blocked":
    case "needs_replan":
    case "cancelled":
      return "stopped";
    default:
      return "waiting";
  }
}

/** A trace folds only once its result is settled (dashboard ADR 0002). */
export function expandedByDefault(state: TraceState): boolean {
  return state !== "settled";
}

/**
 * The task's steps, split into runs. A run starts where the runtime marks execution starting again;
 * the steps before the first one (receiving and assessing the task) belong to the first run. Only
 * what the runtime recorded is shown — never an agent's hidden reasoning.
 */
export function traceRuns(task: Pick<TaskSummary, "id">, progressEvents: TaskProgressEventSummary[]): TraceRun[] {
  const steps = progressEvents
    .filter((event) => event.parentTaskId === task.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const runs: TraceRun[] = [];
  let seenExecution = false;
  for (const step of steps) {
    const startsRun = step.step === "executing" && step.status === "current";
    if (runs.length === 0 || (startsRun && seenExecution)) runs.push({ index: runs.length + 1, steps: [] });
    if (startsRun) seenExecution = true;
    runs[runs.length - 1]!.steps.push(step);
  }
  return runs;
}

/** The step a stopped trace opens at: the last one that blocked, or else the last one. */
export function failingStepId(run: TraceRun | undefined): string | null {
  if (!run || run.steps.length === 0) return null;
  return [...run.steps].reverse().find((step) => step.status === "blocked")?.id ?? run.steps[run.steps.length - 1]!.id;
}
