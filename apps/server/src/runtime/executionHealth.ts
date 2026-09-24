import type { createRepositories } from "../db/repositories";
import { systemExecutionClock, type BudgetSnapshot, type ExecutionClock } from "./budgetPolicy";
import { recordExecutionEvent } from "./executionEvents";
import { requestBudgetStop } from "./budgetStop";

export type ExecutionHealth = { state: "responsive" | "unknown" | "suspect" | "lost"; reason: string; action: "continue" | "probe" | "stop_and_isolate" };
/** Silence is not proof of failure. Only owner liveness authorizes containment. */
export function assessExecutionHealth(input: {
  heartbeatAgeMs: number; activityAgeMs: number | null; inResumeGrace: boolean;
  policy: Pick<BudgetSnapshot, "suspectAfterMs" | "lostAfterMs" | "quietAfterMs">;
}): ExecutionHealth {
  if (input.inResumeGrace) return { state: "unknown", reason: "Supervisor restarted or clock/suspend changed; probing owner during recovery grace.", action: "probe" };
  if (input.heartbeatAgeMs >= input.policy.lostAfterMs) return { state: "lost", reason: "Owner heartbeat expired; process termination is not confirmed.", action: "stop_and_isolate" };
  if (input.heartbeatAgeMs >= input.policy.suspectAfterMs) return { state: "suspect", reason: "Owner heartbeat is late; probing without releasing claims.", action: "probe" };
  if (input.activityAgeMs === null || input.activityAgeMs >= input.policy.quietAfterMs) return { state: "unknown", reason: "Owner heartbeat is fresh; agent progress is unknown. Silence does not end the run.", action: "continue" };
  return { state: "responsive", reason: "Owner heartbeat and output activity are fresh; progress remains unverified.", action: "continue" };
}

type Repositories = ReturnType<typeof createRepositories>;
/** Driven only by the independent Supervisor, never by GET or the execution dispatch loop. */
export class ExecutionHealthMonitor {
  private previous: { mono: number; utc: number } | undefined;
  private graceAt: number | undefined;
  private seen = new Map<string, { heartbeat: string | null; since: number }>();
  constructor(private readonly input: { repositories: Repositories; clock?: ExecutionClock;
    probeOwner?: (ownerId: string) => void; stopOwner?: (ownerId: string) => void }) {}
  scan(): void {
    const clock = this.input.clock ?? systemExecutionClock;
    const mono = clock.monotonicMs(), utc = clock.utcNow().getTime();
    const prior = this.previous;
    this.previous = { mono, utc };
    this.graceAt ??= mono;
    const r = this.input.repositories;
    const active = new Set<string>();
    for (const company of r.listCompanies()) for (const run of r.listRunningAgentRuns(company.id)) {
      const policy = r.executionBudget.snapshot(run.id);
      if (!policy) continue; // Legacy runs have exactly their legacy adjudicator.
      active.add(run.id);
      const anomalous = !prior || mono < prior.mono || mono - prior.mono > 30_000
        || Math.abs((utc - prior.utc) - (mono - prior.mono)) > policy.clockToleranceMs;
      if (anomalous) { this.graceAt = mono; this.seen.delete(run.id); }
      const observation = r.getAgentRunObservation(run.id)!;
      let sample = this.seen.get(run.id);
      if (!sample || sample.heartbeat !== observation.lastHeartbeatAt) {
        sample = { heartbeat: observation.lastHeartbeatAt, since: mono }; this.seen.set(run.id, sample);
      }
      const grace = this.graceAt === undefined || mono - this.graceAt < (policy.resumeGraceMs ?? 30_000);
      const heartbeatAt = Date.parse(observation.lastHeartbeatAt ?? "");
      const activityAt = Date.parse(observation.lastActivityAt ?? "");
      const wallAge = Number.isFinite(heartbeatAt) ? utc - heartbeatAt : 0;
      const health = assessExecutionHealth({ heartbeatAgeMs: grace ? 0 : Math.max(mono - sample.since, wallAge),
        activityAgeMs: Number.isFinite(activityAt) ? Math.max(0, utc - activityAt) : null,
        inResumeGrace: grace, policy: { suspectAfterMs: policy.suspectAfterMs ?? 45_000, lostAfterMs: policy.lostAfterMs ?? 90_000, quietAfterMs: policy.quietAfterMs ?? 60_000 } });
      const at = new Date(utc).toISOString();
      const stillRunning = r.transaction(() => {
        r.executionBudget.lockAuthorization(run.taskId);
        if (r.executionBudget.getRun(run.id)?.settled
          || r.getAgentRunObservation(run.id)?.lastHeartbeatAt !== observation.lastHeartbeatAt) return false;
        const previous = r.executionBudget.health(run.id);
        r.executionBudget.recordHealth(run.id, health, at);
        if (previous?.state !== health.state && (health.state === "suspect" || health.state === "lost"
          || ((previous?.state === "suspect" || previous?.state === "lost") && health.state === "responsive"))) {
          recordExecutionEvent(r, { ...observation, runId: run.id, id: `health:${crypto.randomUUID()}`,
            type: health.state === "responsive" ? "execution_responsive" : "execution_suspected", reason: health.reason, observedAt: at });
        }
        if (health.action === "stop_and_isolate") {
          r.executionBudget.blockOwner(run.id, at);
          requestBudgetStop({ repositories: r, runId: run.id, phase: observation.phase ?? "unknown", reason: "worker_lost", at,
            usedMs: r.executionBudget.getRun(run.id)!.consumed_ms });
        }
        return true;
      });
      if (!stillRunning) continue;
      const ownerId = r.executionBudget.owner(run.id);
      if (ownerId && health.action === "probe") this.input.probeOwner?.(ownerId);
      if (ownerId && health.action === "stop_and_isolate") this.input.stopOwner?.(ownerId);
    }
    for (const id of this.seen.keys()) if (!active.has(id)) this.seen.delete(id);
  }
}
