import type { DatabaseClient } from "./client";

/**
 * Whether run `r` is history that retention may thin out, given a finish cutoff bound to `?`.
 *
 * Everything here protects something a live mechanism still reads. A run that is not terminal is
 * still being observed. A lock, workspace claim (released or isolated) or unsettled budget means
 * ownership has not been given back — an isolated claim in particular is the evidence a person needs
 * before confirming termination. A pending or queued automatic recovery re-reads its source run's
 * invocations when it fires. The latest run of a Task with an open Hold is what the founder is being
 * asked to look at. Runs with no finish time are kept: their age cannot be known.
 */
const RETAINABLE_RUN = `r.status IN ('complete', 'failed', 'cancelled')
  AND r.finished_at IS NOT NULL AND r.finished_at <= ?
  AND NOT EXISTS (SELECT 1 FROM task_locks l WHERE l.run_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM workspace_claims w WHERE w.run_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM run_budgets b WHERE b.run_id = r.id AND b.settled = 0)
  AND NOT EXISTS (SELECT 1 FROM execution_recoveries e WHERE e.source_run_id = r.id AND e.state IN ('pending', 'queued'))
  AND NOT (r.id = (SELECT x.id FROM agent_runs x WHERE x.task_id = r.task_id ORDER BY x.rowid DESC LIMIT 1)
    AND EXISTS (SELECT 1 FROM task_holds h WHERE h.task_id = r.task_id AND h.resolved_at IS NULL))`;

const LAST_SWEEP_KEY = "execution_retention_last_sweep";

export type CompactableInvocation = {
  id: string; runId: string; startedAt: string; endedAt: string | null; runFinishedAt: string;
};

export type RetentionCounts = { activityRows: number; invocations: number; outboxEvents: number; ledgerRows: number };

/**
 * The SQL half of execution retention. Callers run each batch inside one transaction that takes the
 * writer lock first (`lock`), so the eligibility a batch reads cannot change before it deletes.
 */
export function createExecutionRetentionStore(database: DatabaseClient) {
  return {
    lock(): void {
      // Take the SQLite writer before reading eligibility; a deferred read-then-write can fail to
      // upgrade once another connection has committed (see db/multiConnection.test.ts).
      database.prepare("UPDATE runtime_state SET value = value WHERE 0").run();
    },

    compactableInvocations(cutoff: string, limit: number): CompactableInvocation[] {
      return database.prepare(`SELECT i.id, i.run_id AS runId, i.started_at AS startedAt, i.ended_at AS endedAt,
          r.finished_at AS runFinishedAt
        FROM run_invocations i JOIN agent_runs r ON r.id = i.run_id
        WHERE ${RETAINABLE_RUN} AND EXISTS (SELECT 1 FROM run_activity a WHERE a.invocation_id = i.id)
        ORDER BY r.finished_at ASC, i.rowid ASC LIMIT ?`).all(cutoff, limit) as CompactableInvocation[];
    },

    /** Activity windows whose invocation row is missing cannot be summarized anywhere; drop them with their run. */
    deleteOrphanActivity(cutoff: string, limit: number): number {
      return Number(database.prepare(`DELETE FROM run_activity WHERE rowid IN (
        SELECT a.rowid FROM run_activity a JOIN agent_runs r ON r.id = a.run_id
        WHERE ${RETAINABLE_RUN} AND NOT EXISTS (SELECT 1 FROM run_invocations i WHERE i.id = a.invocation_id)
        LIMIT ?)`).run(cutoff, limit).changes);
    },

    /** Write the summary and drop the windows it was computed from, as one step. Returns windows removed. */
    compactInvocation(invocationId: string, stats: {
      firstActivityAfterMs: number | null; longestGapMs: number | null; trailingSilenceMs: number | null;
      bytesByChannel: { stdout: number; stderr: number }; summaryCount: number;
    }, at: string): number {
      database.prepare(`UPDATE run_invocations SET activity_compacted_at = ?, activity_summary_count = ?,
          first_activity_after_ms = ?, longest_gap_ms = ?, trailing_silence_ms = ?, stdout_bytes = ?, stderr_bytes = ?
        WHERE id = ?`).run(at, stats.summaryCount, stats.firstActivityAfterMs, stats.longestGapMs,
        stats.trailingSilenceMs, stats.bytesByChannel.stdout, stats.bytesByChannel.stderr, invocationId);
      return Number(database.prepare("DELETE FROM run_activity WHERE invocation_id = ?").run(invocationId).changes);
    },

    /** Invocations go only after their activity has been compacted away. */
    deleteInvocations(cutoff: string, limit: number): number {
      return Number(database.prepare(`DELETE FROM run_invocations WHERE id IN (
        SELECT i.id FROM run_invocations i JOIN agent_runs r ON r.id = i.run_id
        WHERE ${RETAINABLE_RUN} AND NOT EXISTS (SELECT 1 FROM run_activity a WHERE a.invocation_id = i.id)
        ORDER BY r.finished_at ASC, i.rowid ASC LIMIT ?)`).run(cutoff, limit).changes);
    },

    /**
     * Intermediate metering rows of settled runs. Reservation, review, settlement and authorization
     * records stay, and cumulative budget is computed from `run_budgets`, never from this ledger.
     */
    compactLedger(cutoff: string, limit: number): number {
      return Number(database.prepare(`DELETE FROM budget_ledger WHERE rowid IN (
        SELECT l.rowid FROM budget_ledger l
          JOIN run_budgets b ON b.run_id = l.run_id AND b.settled = 1
          JOIN agent_runs r ON r.id = l.run_id
        WHERE l.kind = 'consumed' AND ${RETAINABLE_RUN}
        ORDER BY r.finished_at ASC LIMIT ?)`).run(cutoff, limit).changes);
    },

    /**
     * Delivered events whose consumption is on record. Pending, claimed and dead-lettered events stay,
     * as does the source of any recovery still waiting to re-read it, and any event about a run that is
     * not over — the only runs that can still emit an event under a deterministic id. Recovery
     * decisions are never deleted: they, not these rows, are what keep a redelivery from acting twice.
     */
    deleteDeliveredEvents(cutoff: string, limit: number): number {
      return Number(database.prepare(`DELETE FROM outbox_events WHERE id IN (
        SELECT o.id FROM outbox_events o
        WHERE o.delivered_at IS NOT NULL AND o.delivered_at <= ?
          AND o.dead_lettered_at IS NULL AND o.claimed_by IS NULL
          AND EXISTS (SELECT 1 FROM recovery_decisions d WHERE d.source_event_id = o.id)
          AND NOT EXISTS (SELECT 1 FROM execution_recoveries e WHERE e.source_event_id = o.id AND e.state IN ('pending', 'queued'))
          AND (o.run_id IS NULL OR EXISTS (SELECT 1 FROM agent_runs r WHERE r.id = o.run_id
            AND r.status IN ('complete', 'failed', 'cancelled')))
        ORDER BY o.delivered_at ASC, o.rowid ASC LIMIT ?)`).run(cutoff, limit).changes);
    },

    counts(): RetentionCounts {
      const count = (table: string) => (database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      return {
        activityRows: count("run_activity"), invocations: count("run_invocations"),
        outboxEvents: count("outbox_events"), ledgerRows: count("budget_ledger"),
      };
    },

    recordSweep(sweep: unknown): void {
      database.prepare(`INSERT INTO runtime_state (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(LAST_SWEEP_KEY, JSON.stringify(sweep));
    },

    lastSweep<T>(): T | null {
      const row = database.prepare("SELECT value FROM runtime_state WHERE key = ?").get(LAST_SWEEP_KEY) as { value: string } | undefined;
      return row ? JSON.parse(row.value) as T : null;
    },
  };
}
