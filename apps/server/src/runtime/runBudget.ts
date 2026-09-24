import type { AgentFailureReason } from "@auto-crop/core";
import type { AgentRunResult } from "../adapters/types";
import type { createRepositories } from "../db/repositories";
import { recordExecutionEvent } from "./executionEvents";
import { type BudgetPhase, type BudgetSnapshot, type ExecutionClock } from "./budgetPolicy";
import { requestBudgetStop } from "./budgetStop";

type Repositories = ReturnType<typeof createRepositories>;
export class BudgetInterrupted extends Error {}

/** A single owner's meter. No monotonic timestamp is compared across processes. */
export class RunBudget {
  private phase: BudgetPhase = "starting";
  private phaseAt: number;
  private previousMono: number;
  private previousUtc: number;
  private nextReview: number | null = null;
  private persistedAt: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopAt: number | null = null;
  private confirmed: boolean | undefined;
  private stoppedReason: AgentFailureReason | null = null;
  private unknown = false;
  private used = 0;
  private closed = false;
  private invocationActive = false;
  private unconfirmed = false;

  constructor(private readonly input: {
    repositories: Repositories; runId: string; snapshot: BudgetSnapshot; reservedMs: number;
    clock: ExecutionClock; originMono: number; originUtc: number; abort: () => void; renewOwnership: () => void;
  }) {
    this.phaseAt = this.previousMono = this.persistedAt = input.originMono;
    this.previousUtc = input.originUtc;
    this.arm();
  }
  get reason() { return this.stoppedReason; }
  get terminationConfirmed() { return this.confirmed; }
  get activeInvocation() { return this.invocationActive || this.unconfirmed; }
  get estimated() { return this.unknown; }
  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.closed) return;
    const mono = this.input.clock.monotonicMs();
    const remaining = this.stoppedReason ? this.input.snapshot.persistMs : Math.min(
      this.input.snapshot.persistMs, this.input.reservedMs - (mono - this.input.originMono),
      this.phaseLimit() - (mono - this.phaseAt), this.nextReview === null ? Infinity : this.nextReview - this.used);
    this.timer = setTimeout(() => {
      try { this.poll(); } catch { this.stop("clock_untrusted", true); }
      this.arm();
    }, Math.max(1, Math.ceil(remaining)));
    this.timer.unref();
  }
  private stop(reason: AgentFailureReason, unknown = false) {
    this.stoppedReason ??= reason;
    this.stopAt ??= this.input.clock.monotonicMs();
    this.unknown ||= unknown;
    try { this.persistStop(); } catch { this.unknown = true; }
    // On storage failure the local owner still fails closed. It cannot claim success; reconciliation
    // retains/estimates the reservation and will retry the durable write when storage recovers.
    this.input.abort();
  }
  persistStop(): void {
    if (!this.stoppedReason) return;
    requestBudgetStop({ repositories: this.input.repositories, runId: this.input.runId,
      reason: this.stoppedReason, phase: this.phase, at: this.input.clock.utcNow().toISOString(), usedMs: this.used });
  }
  private phaseLimit() {
    const s = this.input.snapshot;
    return this.phase === "preparing_brief" ? s.briefMs : this.phase === "repairing_artifact" ? s.repairMs
      : this.phase === "finalizing" ? s.finalizeMs : s.runHardMs;
  }
  /** Poll is also called before every spawn and immediately inside the settlement transaction. */
  poll(persist = true): void {
    if (this.closed) return;
    const { clock, snapshot: s, repositories, runId } = this.input;
    const mono = clock.monotonicMs();
    const utc = clock.utcNow().getTime();
    const delta = mono - this.previousMono;
    const wallDelta = utc - this.previousUtc;
    this.previousMono = mono;
    this.previousUtc = utc;
    if (!this.stoppedReason && (!Number.isFinite(mono) || !Number.isFinite(utc) || delta < 0
      || Math.abs(wallDelta - delta) > s.clockToleranceMs
      || delta > Math.max(s.persistMs * 3, s.clockToleranceMs))) {
      // Sleep/clock anomalies are uncertainty, never evidence of a deadlock. Revalidate ownership
      // below, withdraw continuation permission and retain the entire reservation on settlement.
      this.stop("clock_untrusted", true);
    }
    if (!this.stoppedReason && Number.isFinite(mono)) this.used = Math.min(this.input.reservedMs, Math.max(this.used, mono - this.input.originMono));
    if (this.used >= this.input.reservedMs) this.stop(this.input.reservedMs < s.runHardMs ? "task_budget_exhausted" : "run_budget_exhausted");
    else if (mono - this.phaseAt >= this.phaseLimit()) this.stop("phase_budget_exhausted");
    const durableStop = repositories.executionBudget.stopRequest(runId);
    if (durableStop && !this.stoppedReason) {
      this.used = Math.min(this.input.reservedMs, durableStop.consumed_ms);
      this.stop(durableStop.reason as AgentFailureReason);
    }
    if (!persist) return;
    const review = this.phase === "executing" && this.nextReview !== null && this.used >= this.nextReview && !this.stoppedReason;
    if (!review && mono - this.persistedAt < s.persistMs && !this.stoppedReason) return;
    const next = review ? Math.min(this.input.reservedMs, this.used + s.checkpointMs) : this.nextReview;
    try {
      const active = repositories.transaction(() => {
        if (this.unknown) repositories.executionBudget.blockOwner(runId, clock.utcNow().toISOString());
        if (!repositories.executionBudget.checkpoint(runId, this.used, clock.utcNow().toISOString(), next, review)) return false;
        this.input.renewOwnership();
        if (review) {
          const facts = repositories.getAgentRunObservation(runId)!;
          recordExecutionEvent(repositories, {
            ...facts, id: `${runId}:budget-review:${this.nextReview}`, type: "execution_budget_review", runId,
            reason: "Owner responsive; progress unknown. Continuing within the pinned reservation.", observedAt: clock.utcNow().toISOString(),
          });
        }
        return true;
      });
      if (!active) this.stop("worker_lost", true);
      this.nextReview = next;
      this.persistedAt = mono;
    } catch {
      // Accounting is mandatory, unlike best-effort activity observation. Do not keep spending
      // while writes fail, and do not refund consumption that cannot be reconstructed.
      this.stop("clock_untrusted", true);
    }
  }
  ensure(): void {
    this.poll(false);
    if (this.stoppedReason) throw new BudgetInterrupted(`Execution stopped: ${this.stoppedReason}`);
  }
  enter(phase: BudgetPhase): void {
    this.ensure();
    this.phase = phase;
    this.phaseAt = this.input.clock.monotonicMs();
    this.nextReview = phase === "executing" ? this.used + this.input.snapshot.softMs : null;
    // Persist every phase boundary even if it is shorter than the periodic write cadence.
    this.persistedAt = -Infinity;
    this.poll();
    this.ensure();
    this.arm();
  }
  remainingMs(): number {
    this.ensure();
    return Math.max(1, Math.ceil(Math.min(this.input.reservedMs - this.used,
      this.phaseLimit() - (this.input.clock.monotonicMs() - this.phaseAt))));
  }
  beginInvocation(): number {
    const remaining = this.remainingMs();
    this.invocationActive = true;
    return remaining;
  }
  returned(result: AgentRunResult, cancelled: boolean): AgentRunResult {
    this.invocationActive = false;
    this.confirmed = result.terminationConfirmed;
    this.poll();
    if (result.failureReason === "timeout" && !this.stoppedReason) {
      // The adapter's timer is pinned to the minimum remaining stage/run allowance. Millisecond
      // rounding can make it fire just before the next meter sample, but it is still a budget stop.
      const runRemaining = this.input.reservedMs - this.used;
      const phaseRemaining = this.phaseLimit() - (this.input.clock.monotonicMs() - this.phaseAt);
      this.stop(phaseRemaining < runRemaining ? "phase_budget_exhausted"
        : this.input.reservedMs < this.input.snapshot.runHardMs ? "task_budget_exhausted" : "run_budget_exhausted");
    }
    if (result.terminationConfirmed === false) { this.unconfirmed = true; this.stop("termination_unconfirmed", true); }
    if (!this.stoppedReason || cancelled) return result;
    return { ...result, status: "failed", failureReason: this.stoppedReason,
      stderr: `Execution stopped: ${this.stoppedReason}. ${result.stderr}` };
  }
  settlementUsage(success: boolean): number | undefined {
    this.poll(false);
    if (success) this.ensure();
    if (this.stopAt !== null) this.input.repositories.executionBudget.recordTerminationWait(this.input.runId,
      this.input.clock.monotonicMs() - this.stopAt, this.confirmed);
    return this.unknown ? undefined : Math.ceil(this.used);
  }
  close(): void { this.closed = true; clearTimeout(this.timer); }
}
