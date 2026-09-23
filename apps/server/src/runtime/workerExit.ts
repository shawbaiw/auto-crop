import type { createRepositories } from "../db/repositories";
import { settleAgentRun } from "./executionSettlement";
import { applyTaskTransition } from "./taskTransition";

/** The caller supplies a startup UUID whose Worker it has observed exiting. That proves only the
 * Worker died, not its detached agents. Until containment proves otherwise, retain every workspace
 * behind the existing manual termination-confirmation gate. No PID is guessed or signalled here.
 */
export function reconcileExitedWorker(input: {
  repositories: ReturnType<typeof createRepositories>;
  ownerId: string;
  now?: () => Date;
  createId?: (prefix: string) => string;
}): string[] {
  const { repositories } = input;
  const at = (input.now?.() ?? new Date()).toISOString();
  const createId = input.createId ?? ((prefix: string) => `${prefix}_${crypto.randomUUID()}`);
  const reconciled: string[] = [];
  for (const run of repositories.listRunningAgentRunsForOwner(input.ownerId)) {
    const message = "The Worker exited; its Agent descendants have not been confirmed stopped. Confirm termination before reusing this workspace.";
    const won = settleAgentRun({
      repositories, runId: run.id, at, createId,
      outcome: { status: "failed", failureReason: "worker_lost", failureMessage: message, terminationConfirmed: null },
      expectedOwnerId: input.ownerId,
      expectedTaskStatus: repositories.getTask(run.taskId)?.status === "retrying" ? "retrying" : "running",
      commit: () => {
        const claims = repositories.listWorkspaceClaims().filter((claim) => claim.runId === run.id && claim.ownerId === input.ownerId);
        if (claims.length === 0) throw new Error(`Cannot safely isolate ${run.id}: its workspace claim is missing.`);
        for (const claim of claims) {
          if (!repositories.isolateWorkspaceClaim(claim.workspacePath, run.id, message)) {
            throw new Error(`Workspace ownership changed while isolating ${run.id}.`);
          }
        }
        const task = repositories.getTask(run.taskId)!;
        applyTaskTransition({
          repositories, task, status: "blocked",
          executionSummary: { latestFailureReason: "termination_unconfirmed", latestFailureMessage: message },
          hold: { kind: "termination_unconfirmed", subjectKind: "agent_run", subjectId: run.id, reason: message },
          now: () => new Date(at), createId,
        });
        repositories.appendTaskEvent({
          id: createId("task_event"), companyId: task.companyId, taskId: task.id,
          type: "task_blocked", status: "blocked", message, createdAt: at,
          failureReason: "termination_unconfirmed", failureMessage: message,
          executionProfileName: run.executionProfileName ?? null, requestedTimeoutMs: run.requestedTimeoutMs ?? null,
          effectiveTimeoutMs: run.effectiveTimeoutMs ?? null, dependencyNote: null,
          artifactWorkspacePath: task.artifactWorkspacePath ?? null,
        });
      },
    });
    if (won) reconciled.push(run.taskId);
    else throw new Error(`Cannot reconcile exited Worker ${input.ownerId}: run ${run.id} no longer matches its Task ownership.`);
  }
  // A crash can also land after run settlement but before the final workspace release. Without
  // termination evidence, silently forgetting that owner would let a later lease takeover overlap
  // an unknown writer. Keep startup gated for explicit reconciliation of this inconsistent state.
  const residual = repositories.listWorkspaceClaims().find((claim) => claim.ownerId === input.ownerId && !claim.isolatedReason);
  if (residual) throw new Error(`Exited Worker ${input.ownerId} still owns an unclassified workspace claim: ${residual.workspacePath}. Confirm termination and reconcile the claim before restarting.`);
  return reconciled;
}
