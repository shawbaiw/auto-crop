import type { createRepositories } from "../db/repositories";

type Repositories = ReturnType<typeof createRepositories>;

/**
 * Which part of a run is in flight. A run is not one process: it prepares a brief, does the
 * substantive work, may repair its artifact's syntax (ADR 0028), and then settles. Attributing a
 * budget or a silence to "the run" loses which of those was actually slow.
 */
export type ExecutionPhase = "preparing_brief" | "executing" | "repairing_artifact" | "finalizing";

/** Where observed bytes came from. An agent that only writes to stderr is still working. */
export type ActivityChannel = "stdout" | "stderr";

/**
 * The version of the observation policy a run was recorded under, stored on the run.
 *
 * Thresholds and aggregation rules will change. A run has to be read back under the rules it was
 * recorded with, or old runs silently acquire meanings they never had.
 */
export const OBSERVATION_POLICY_VERSION = "1";

/** How long output is aggregated in memory before a summary row is written. */
export const ACTIVITY_FLUSH_INTERVAL_MS = 10_000;

export type RunInvocation = {
  id: string;
  runId: string;
  phase: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
};

export type RunActivity = {
  id: string;
  runId: string;
  invocationId: string;
  seq: number;
  /**
   * When the first byte in this summary arrived.
   *
   * A summary is written when its window closes, so `observedAt` is a flush time. Measuring "how
   * long before the agent said anything" from a flush time attributes the whole aggregation window
   * to silence — the throttle distorting the very statistic it exists to make affordable.
   */
  windowStartedAt: string;
  /**
   * When the last byte in this summary arrived — not when the summary was written.
   *
   * Together with `windowStartedAt` the row spans real arrival times at both ends, so every
   * statistic derived from it is independent of when the flush happened to land.
   */
  observedAt: string;
  phase: string;
  channel: ActivityChannel;
  bytes: number;
  /** The longest gap between two observations inside this summary's window. */
  maxGapMs: number | null;
};

export type RunActivityStats = {
  /** Null when nothing was ever observed: unknown, which is not the same as silent. */
  firstActivityAfterMs: number | null;
  /** The longest observed silence within the run, across flush windows. */
  longestGapMs: number | null;
  /** How long the run was silent at the end, measured to `until`. */
  trailingSilenceMs: number | null;
  bytesByChannel: Record<ActivityChannel, number>;
  summaryCount: number;
};

export type ObservationFailure = { at: string; message: string };

/**
 * Records what a run is doing, and nothing else.
 *
 * Every method here is observation: none of them ends a run, releases a lock, or changes a task.
 * That separation is the point — the runtime needs to be able to see a run before it is trusted to
 * judge one, and a judgement built on data nobody has looked at is how a fixed timer gets a new name.
 *
 * Two rules the callers depend on:
 *
 * - **A heartbeat is the runner answering, never output arriving.** `beat` is driven by a timer the
 *   runtime owns. If stdout could refresh it, an agent printing into a loop would look healthy
 *   forever and a quiet agent thinking hard would look dead.
 * - **Missing data means unknown.** A run recorded before observation existed, or one whose
 *   observation writes failed, reports null — never zero, and never "no activity".
 *
 * Observation writes are best-effort: a failure to record a log line must not decide whether a task
 * succeeded. Failures are counted and kept (bounded) for the caller to surface, and after
 * `maxFailures` the observer stops trying rather than retrying against a broken database forever.
 */
export class RunObserver {
  private readonly repositories: Repositories;
  private readonly runId: string;
  private readonly ownerId: string;
  private readonly now: () => Date;
  private readonly createId: (prefix: string) => string;
  private readonly flushIntervalMs: number;
  private readonly maxFailures: number;

  private invocationId: string | null = null;
  private phase: ExecutionPhase | null = null;
  private seq = 0;
  /** Bytes seen since the last flush, per channel. */
  private pending = new Map<ActivityChannel, number>();
  private windowOpenedAt: number | null = null;
  private lastObservedAt: number | null = null;
  private windowMaxGapMs = 0;
  private readonly failures: ObservationFailure[] = [];
  private stopped = false;

  constructor(input: {
    repositories: Repositories;
    runId: string;
    ownerId: string;
    now?: () => Date;
    createId?: (prefix: string) => string;
    flushIntervalMs?: number;
    maxFailures?: number;
  }) {
    this.repositories = input.repositories;
    this.runId = input.runId;
    this.ownerId = input.ownerId;
    this.now = input.now ?? (() => new Date());
    this.createId = input.createId ?? ((prefix) => `${prefix}_${crypto.randomUUID()}`);
    this.flushIntervalMs = input.flushIntervalMs ?? ACTIVITY_FLUSH_INTERVAL_MS;
    this.maxFailures = input.maxFailures ?? 5;
  }

  /** Observation problems so far, for the caller to report. Never a reason to fail a task. */
  observationFailures(): readonly ObservationFailure[] {
    return this.failures;
  }

  /**
   * Move the run into a phase, closing any open invocation.
   *
   * Each phase is its own invocation because each is its own launch of an agent process; the run row
   * carries only the current one, and `run_invocations` keeps the sequence.
   */
  enterPhase(phase: ExecutionPhase, endReasonOfPrevious = "phase_change"): void {
    this.endInvocation(endReasonOfPrevious);
    const at = this.now().toISOString();
    this.phase = phase;
    this.invocationId = this.createId("run_invocation");
    this.seq = 0;
    this.windowOpenedAt = null;
    this.lastObservedAt = null;
    this.windowMaxGapMs = 0;
    this.record(() => {
      this.repositories.createRunInvocation({
        id: this.invocationId!,
        runId: this.runId,
        phase,
        startedAt: at,
        endedAt: null,
        endReason: null,
      });
      this.repositories.updateAgentRunObservation(this.runId, {
        ownerId: this.ownerId,
        phase,
        phaseStartedAt: at,
        policyVersion: OBSERVATION_POLICY_VERSION,
      });
    });
  }

  /**
   * Note that bytes arrived on a channel.
   *
   * Aggregated in memory rather than written per chunk: an agent streaming tokens would otherwise
   * turn one run into tens of thousands of rows, and the observation would starve the work it is
   * observing. The window keeps its own longest gap, so throttling cannot hide a silence that
   * happened inside it.
   */
  recordOutput(channel: ActivityChannel, bytes: number): void {
    if (this.stopped || bytes <= 0) {
      return;
    }
    const at = this.now().getTime();
    if (this.windowOpenedAt === null) {
      this.windowOpenedAt = at;
    }
    if (this.lastObservedAt !== null) {
      this.windowMaxGapMs = Math.max(this.windowMaxGapMs, at - this.lastObservedAt);
    }
    this.lastObservedAt = at;
    this.pending.set(channel, (this.pending.get(channel) ?? 0) + bytes);

    if (at - this.windowOpenedAt >= this.flushIntervalMs) {
      this.flush();
    }
  }

  /**
   * The owner runner reporting that it is still here.
   *
   * Driven by the runtime's own timer, never by the agent's output. A fresh heartbeat beside a long
   * silence is exactly the state the health work needs to be able to express: the runner is fine and
   * the agent has said nothing, which is not yet a verdict about either.
   */
  beat(): void {
    if (this.stopped) {
      return;
    }
    this.record(() => {
      this.repositories.updateAgentRunObservation(this.runId, {
        ownerId: this.ownerId,
        lastHeartbeatAt: this.now().toISOString(),
      });
    });
  }

  /** Write the aggregated window, if anything is pending. */
  flush(): void {
    if (this.pending.size === 0 || !this.invocationId || !this.phase) {
      return;
    }
    const now = this.now().getTime();
    // Both ends are byte-arrival times; the flush is merely when we got round to writing them down.
    const observedAt = new Date(this.lastObservedAt ?? now).toISOString();
    const windowStartedAt = new Date(this.windowOpenedAt ?? now).toISOString();
    const entries = [...this.pending];
    this.pending.clear();
    const maxGapMs = this.windowMaxGapMs;
    this.windowOpenedAt = null;
    this.lastObservedAt = null;
    this.windowMaxGapMs = 0;

    this.record(() => {
      for (const [channel, bytes] of entries) {
        this.seq += 1;
        this.repositories.appendRunActivity({
          id: this.createId("run_activity"),
          runId: this.runId,
          invocationId: this.invocationId!,
          seq: this.seq,
          windowStartedAt,
          observedAt,
          phase: this.phase!,
          channel,
          bytes,
          maxGapMs: maxGapMs > 0 ? maxGapMs : null,
        });
      }
      this.repositories.updateAgentRunObservation(this.runId, { lastActivityAt: observedAt });
    });
  }

  /** Close the current invocation, flushing whatever it observed. */
  endInvocation(endReason: string): void {
    this.flush();
    const invocationId = this.invocationId;
    if (!invocationId) {
      return;
    }
    this.invocationId = null;
    this.record(() => {
      this.repositories.endRunInvocation(invocationId, this.now().toISOString(), endReason);
    });
  }

  /** Final flush. After this the observer records nothing further. */
  close(endReason: string): void {
    this.endInvocation(endReason);
    this.stopped = true;
  }

  /**
   * Run one observation write, absorbing failures.
   *
   * A database that will not take a log line is a problem to report, not a verdict on the work. After
   * `maxFailures` the observer gives up rather than hammering a broken database for the rest of the
   * run; the recorded failures say that observation is incomplete, so a later reader treats this
   * run's activity as unknown rather than as silence.
   */
  private record(write: () => void): void {
    if (this.stopped || this.failures.length >= this.maxFailures) {
      return;
    }
    try {
      write();
    } catch (error) {
      this.failures.push({ at: new Date().toISOString(), message: (error as Error).message });
    }
  }
}

/**
 * What the recorded activity says about a run's silences.
 *
 * Pure, so it can be read from stored rows long after the run is over, and so the health policy that
 * eventually consumes it can be tested without a database. Returns nulls rather than zeroes when
 * there is nothing recorded: a run nobody observed is unknown, and reading it as "never produced
 * anything" is how a healthy long task gets declared dead.
 */
export function summarizeRunActivity(input: {
  activity: readonly RunActivity[];
  startedAt: string;
  until: string;
}): RunActivityStats {
  const startedAt = Date.parse(input.startedAt);
  const until = Date.parse(input.until);
  const bytesByChannel: Record<ActivityChannel, number> = { stdout: 0, stderr: 0 };

  if (input.activity.length === 0 || Number.isNaN(startedAt)) {
    return {
      firstActivityAfterMs: null,
      longestGapMs: null,
      trailingSilenceMs: null,
      bytesByChannel,
      summaryCount: 0,
    };
  }

  const ordered = [...input.activity].sort((left, right) => left.seq - right.seq);
  // Each summary spans real arrival times: when its first byte came and when its last one did.
  const spans: Array<{ start: number; end: number }> = [];
  let longestGapMs = 0;

  for (const entry of ordered) {
    bytesByChannel[entry.channel] += entry.bytes;
    // A silence recorded inside an aggregation window is kept on the summary, so throttling cannot
    // make a silence shorter than it was.
    longestGapMs = Math.max(longestGapMs, entry.maxGapMs ?? 0);
    const start = Date.parse(entry.windowStartedAt);
    const end = Date.parse(entry.observedAt);
    if (!Number.isNaN(start) && !Number.isNaN(end)) {
      spans.push({ start, end });
    }
  }

  if (spans.length === 0) {
    return {
      firstActivityAfterMs: null,
      longestGapMs: null,
      trailingSilenceMs: null,
      bytesByChannel,
      summaryCount: ordered.length,
    };
  }

  spans.sort((left, right) => left.start - right.start);
  const first = spans[0].start;
  const last = Math.max(...spans.map((span) => span.end));
  for (let index = 1; index < spans.length; index += 1) {
    // The silence between one summary's last byte and the next summary's first. Two channels
    // flushed from the same window overlap, so a negative difference means no gap at all.
    longestGapMs = Math.max(longestGapMs, spans[index].start - spans[index - 1].end, 0);
  }
  // The wait before anything was heard is a silence like any other.
  longestGapMs = Math.max(longestGapMs, first - startedAt);

  return {
    firstActivityAfterMs: first - startedAt,
    longestGapMs,
    trailingSilenceMs: Number.isNaN(until) ? null : Math.max(0, until - last),
    bytesByChannel,
    summaryCount: ordered.length,
  };
}
