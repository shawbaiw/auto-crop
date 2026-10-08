import type { createRepositories } from "../db/repositories";
import type { RetentionCounts } from "../db/executionRetention";
import { summarizeRunActivity } from "./executionObservation";

type Repositories = ReturnType<typeof createRepositories>;

/**
 * How long execution history is kept, and how much of it may accumulate (execution-health §10,
 * "持续运行门槛"). Observation detail, delivered events and intermediate metering grow with every
 * run; without a bound a long-running installation's database grows without limit.
 *
 * Retention thins history, it never decides anything: what it deletes is either summarized first
 * (activity windows), redundant with a durable record (metering rows, delivered events), or old
 * enough that nothing reads it. What a live mechanism still reads is protected by the store's
 * eligibility rules, and those protections outrank both age and capacity.
 */
export const RETENTION_POLICY_VERSION = "retention-v1";

const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionPolicy = {
  /** Activity windows of a finished run are compacted into per-invocation statistics after this. */
  activityMs: number;
  /** Intermediate `consumed` metering rows of a settled run are dropped after this. */
  ledgerMs: number;
  /** Delivered, consumed events are dropped this long after delivery. */
  deliveredEventMs: number;
  /** Invocation rows, with their compacted statistics, are dropped after this. */
  invocationMs: number;
  /** Row ceilings. Above one, the oldest eligible rows go early, but never protected ones. */
  maxActivityRows: number;
  maxInvocationRows: number;
  maxOutboxRows: number;
  /** A capacity pass never touches anything younger than this, however full the table. */
  capacityMinAgeMs: number;
  /** Items per transaction, so the writer lock is held only briefly. */
  batchSize: number;
  /** Transactions per sweep. A sweep that hits this reports itself truncated and continues next time. */
  maxBatches: number;
  sweepIntervalMs: number;
};

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  activityMs: 14 * DAY_MS,
  ledgerMs: 14 * DAY_MS,
  deliveredEventMs: 30 * DAY_MS,
  invocationMs: 180 * DAY_MS,
  maxActivityRows: 1_000_000,
  maxInvocationRows: 200_000,
  maxOutboxRows: 100_000,
  capacityMinAgeMs: 60 * 60 * 1000,
  batchSize: 100,
  maxBatches: 50,
  sweepIntervalMs: 60 * 60 * 1000,
};

/**
 * Retention is on unless `AUTO_CROP_RETENTION=off`. Unlike the budget and recovery policies, the
 * default is the bounded behaviour: the unbounded one is the defect. Overrides come from
 * `AUTO_CROP_RETENTION_JSON`; anything invalid refuses to start rather than falling back.
 */
export function retentionPolicyFromEnvironment(env = process.env): RetentionPolicy | null {
  const mode = env.AUTO_CROP_RETENTION ?? RETENTION_POLICY_VERSION;
  if (mode === "off") return null;
  if (mode !== RETENTION_POLICY_VERSION) throw new Error(`AUTO_CROP_RETENTION must be off or ${RETENTION_POLICY_VERSION}`);
  const configured: unknown = JSON.parse(env.AUTO_CROP_RETENTION_JSON ?? "{}");
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) throw new Error("Retention configuration must be a JSON object");
  const policy = { ...DEFAULT_RETENTION_POLICY };
  for (const [key, value] of Object.entries(configured)) {
    if (!(key in DEFAULT_RETENTION_POLICY)) throw new Error(`Unknown retention configuration field: ${key}`);
    if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`Retention field ${key} must be a positive safe integer`);
    policy[key as keyof RetentionPolicy] = value as number;
  }
  // A summary outlives the windows it was computed from; dropping the invocation first would lose it.
  if (policy.invocationMs < policy.activityMs) throw new Error("Retention invocationMs must not be shorter than activityMs");
  return policy;
}

export type RetentionSweep = {
  version: typeof RETENTION_POLICY_VERSION;
  at: string;
  policy: RetentionPolicy;
  compactedInvocations: number;
  deletedActivityRows: number;
  deletedLedgerRows: number;
  deletedEvents: number;
  deletedInvocations: number;
  batches: number;
  /** The batch ceiling stopped this sweep with eligible work left; the next one continues. */
  truncated: boolean;
  /** Null when the sweep failed before it could count. */
  remaining: RetentionCounts | null;
  /** Tables still above their ceiling: what is left there is protected or too recent to remove. */
  overCapacity: Array<keyof RetentionCounts>;
  error?: string;
};

/**
 * One bounded sweep: age passes first, then capacity passes over whatever is still above a ceiling.
 * Each batch is its own short transaction that takes the writer lock before reading eligibility.
 */
export function sweepExecutionRetention(input: {
  repositories: Repositories; policy: RetentionPolicy; now?: () => Date;
}): RetentionSweep {
  const { repositories: r, policy } = input;
  const store = r.executionRetention;
  const now = (input.now?.() ?? new Date()).getTime();
  const at = new Date(now).toISOString();
  const before = (ms: number) => new Date(now - ms).toISOString();
  const capacityCutoff = before(policy.capacityMinAgeMs);
  const sweep: RetentionSweep = {
    version: RETENTION_POLICY_VERSION, at, policy, compactedInvocations: 0, deletedActivityRows: 0,
    deletedLedgerRows: 0, deletedEvents: 0, deletedInvocations: 0, batches: 0, truncated: false,
    remaining: null, overCapacity: [],
  };

  /**
   * Repeat one batch kind until it finds nothing or `more` says stop. Returns false when out of
   * batches. Only batches that removed something count, so an empty probe never truncates a sweep.
   */
  const drain = (batch: () => number, more: () => boolean = () => true): boolean => {
    while (more()) {
      if (sweep.batches >= policy.maxBatches) {
        sweep.truncated = true;
        return false;
      }
      if (r.transaction(() => { store.lock(); return batch(); }) === 0) return true;
      sweep.batches += 1;
    }
    return true;
  };

  const compactActivity = (cutoff: string) => () => {
    let removed = store.deleteOrphanActivity(cutoff, policy.batchSize);
    const invocations = store.compactableInvocations(cutoff, policy.batchSize);
    for (const invocation of invocations) {
      const stats = summarizeRunActivity({
        activity: r.listRunActivity(invocation.runId).filter((row) => row.invocationId === invocation.id),
        startedAt: invocation.startedAt,
        until: invocation.endedAt ?? invocation.runFinishedAt,
      });
      removed += store.compactInvocation(invocation.id, stats, at);
    }
    sweep.compactedInvocations += invocations.length;
    sweep.deletedActivityRows += removed;
    return removed;
  };
  const counted = (key: "deletedLedgerRows" | "deletedEvents" | "deletedInvocations", remove: () => number) => () => {
    const removed = remove();
    sweep[key] += removed;
    return removed;
  };
  const above = (table: keyof RetentionCounts, ceiling: number) => () => store.counts()[table] > ceiling;

  // Order matters only for invocations: they are dropped after their activity has been compacted.
  const passes: Array<() => boolean> = [
    () => drain(compactActivity(before(policy.activityMs))),
    () => drain(compactActivity(capacityCutoff), above("activityRows", policy.maxActivityRows)),
    () => drain(counted("deletedLedgerRows", () => store.compactLedger(before(policy.ledgerMs), policy.batchSize))),
    () => drain(counted("deletedEvents", () => store.deleteDeliveredEvents(before(policy.deliveredEventMs), policy.batchSize))),
    () => drain(counted("deletedEvents", () => store.deleteDeliveredEvents(capacityCutoff, policy.batchSize)),
      above("outboxEvents", policy.maxOutboxRows)),
    () => drain(counted("deletedInvocations", () => store.deleteInvocations(before(policy.invocationMs), policy.batchSize))),
    () => drain(counted("deletedInvocations", () => store.deleteInvocations(capacityCutoff, policy.batchSize)),
      above("invocations", policy.maxInvocationRows)),
  ];
  for (const pass of passes) {
    if (!pass()) break;
  }

  const remaining = store.counts();
  sweep.remaining = remaining;
  const ceilings: Array<[keyof RetentionCounts, number]> = [
    ["activityRows", policy.maxActivityRows], ["invocations", policy.maxInvocationRows], ["outboxEvents", policy.maxOutboxRows],
  ];
  sweep.overCapacity = ceilings.filter(([table, ceiling]) => remaining[table] > ceiling).map(([table]) => table);
  return sweep;
}

/**
 * Sweep when one is due, record the outcome, and never let a failure escape: retention is
 * housekeeping, and a supervisor scan that throws can keep a Worker from starting.
 */
export function runDueRetentionSweep(input: {
  repositories: Repositories; policy: RetentionPolicy | null; now?: () => Date; log?: (line: string) => void;
}): RetentionSweep | null {
  if (!input.policy) return null;
  const store = input.repositories.executionRetention;
  const now = input.now?.() ?? new Date();
  const last = store.lastSweep<RetentionSweep>();
  if (last && Date.parse(last.at) + input.policy.sweepIntervalMs > now.getTime()) return null;
  let sweep: RetentionSweep;
  try {
    sweep = sweepExecutionRetention({ ...input, policy: input.policy, now: () => now });
  } catch (error) {
    // Batches that committed before the failure stay committed; the next sweep picks up the rest.
    sweep = {
      version: RETENTION_POLICY_VERSION, at: now.toISOString(), policy: input.policy, compactedInvocations: 0,
      deletedActivityRows: 0, deletedLedgerRows: 0, deletedEvents: 0, deletedInvocations: 0, batches: 0,
      truncated: false, remaining: null,
      overCapacity: [], error: (error as Error).message,
    };
  }
  try {
    store.recordSweep(sweep);
  } catch (error) {
    input.log?.(`Retention sweep could not be recorded: ${(error as Error).message}`);
  }
  const removed = sweep.deletedActivityRows + sweep.deletedLedgerRows + sweep.deletedEvents + sweep.deletedInvocations;
  if (sweep.error || removed > 0 || sweep.truncated || sweep.overCapacity.length > 0) {
    input.log?.(`Retention sweep: ${sweep.error ? `failed (${sweep.error})` : `removed ${removed} rows`}`
      + `${sweep.truncated ? ", truncated" : ""}${sweep.overCapacity.length ? `, over capacity: ${sweep.overCapacity.join(", ")}` : ""}`);
  }
  return sweep;
}
