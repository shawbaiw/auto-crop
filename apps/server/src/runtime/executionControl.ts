/**
 * The handles that let the runtime actually stop work that is in flight.
 *
 * Stopping a task used to be a status change and nothing more: Emergency Stop wrote `cancelled`,
 * cleared every lock in the database, and left the agent processes running. The founder was told the
 * company had stopped while it went on spending, and the next dispatch of those tasks started in
 * workspaces the abandoned processes were still writing to.
 *
 * A registry is what closes that gap. It maps a task to the run currently executing it and the
 * signal that asks that run to stop, so a stop request reaches a process instead of only a row.
 *
 * Deliberately in-memory and per-process: a handle is only useful to the process that holds the
 * child. A stop for work owned by a different worker is not something this can do, and it reports
 * that rather than pretending — the cross-process case needs the out-of-process Supervisor (P3).
 */
export type ExecutionHandle = {
  taskId: string;
  companyId: string;
  runId: string;
  ownerEpoch: number;
  /** Why it was asked to stop, once it has been. */
  stopReason: string | null;
  requestStop(reason: string): void;
};

export type StopResult =
  /** A live handle was found and asked to stop. Whether it has stopped yet is the run's own report. */
  | { kind: "stop_requested"; runId: string }
  /** Already asked; asking again changes nothing. Stopping is idempotent by design. */
  | { kind: "already_stopping"; runId: string; reason: string }
  /** Nothing in this process is executing that task. It may be finished, or owned elsewhere. */
  | { kind: "not_executing_here" };

/**
 * Live executions this process owns.
 *
 * One entry per task: a task has at most one run with the right to commit (execution-health §3), so
 * a second registration for the same task means the first is over and its entry is stale.
 */
export class ExecutionRegistry {
  private readonly handles = new Map<string, ExecutionHandle>();

  /**
   * Register a run as executing, returning how to unregister it.
   *
   * The returned release is keyed to this exact handle, so a dispatch unwinding late cannot remove
   * the entry belonging to its own successor — the same mistake the task lock used to make.
   */
  register(handle: ExecutionHandle): () => void {
    this.handles.set(handle.taskId, handle);
    return () => {
      if (this.handles.get(handle.taskId) === handle) {
        this.handles.delete(handle.taskId);
      }
    };
  }

  /** Ask the run executing this task to stop. Safe to call repeatedly. */
  requestStop(taskId: string, reason: string): StopResult {
    const handle = this.handles.get(taskId);
    if (!handle) {
      return { kind: "not_executing_here" };
    }
    if (handle.stopReason !== null) {
      return { kind: "already_stopping", runId: handle.runId, reason: handle.stopReason };
    }
    handle.requestStop(reason);
    return { kind: "stop_requested", runId: handle.runId };
  }

  /** Ask everything this process is executing for one company to stop. */
  requestStopForCompany(companyId: string, reason: string): string[] {
    const stopped: string[] = [];
    for (const handle of this.handles.values()) {
      if (handle.companyId !== companyId) {
        continue;
      }
      if (this.requestStop(handle.taskId, reason).kind === "stop_requested") {
        stopped.push(handle.taskId);
      }
    }
    return stopped;
  }

  /** The tasks this process is currently executing, for diagnosis and for scoping a stop. */
  executingTaskIds(companyId?: string): string[] {
    return [...this.handles.values()]
      .filter((handle) => companyId === undefined || handle.companyId === companyId)
      .map((handle) => handle.taskId);
  }
}

/** The registry the server uses when no other is supplied. One per process. */
export const defaultExecutionRegistry = new ExecutionRegistry();
