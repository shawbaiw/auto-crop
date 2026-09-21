import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import {
  OBSERVATION_POLICY_VERSION,
  RunObserver,
  summarizeRunActivity,
  type RunActivity,
} from "./executionObservation";

describe("RunObserver", () => {
  it("records each phase as its own invocation, in order, and closes the one before", () => {
    const { repositories, observer, client } = createObserverFixture();

    observer.enterPhase("preparing_brief");
    observer.enterPhase("executing", "brief_returned");
    observer.enterPhase("finalizing", "work_complete");
    observer.close("dispatch_ended");

    expect(repositories.listRunInvocations("agent_run_1").map((invocation) => ({
      phase: invocation.phase,
      endReason: invocation.endReason,
    }))).toEqual([
      { phase: "preparing_brief", endReason: "brief_returned" },
      { phase: "executing", endReason: "work_complete" },
      { phase: "finalizing", endReason: "dispatch_ended" },
    ]);
    // The run row carries the phase it is in, and the policy it was recorded under.
    const run = client.prepare("SELECT phase, policy_version, owner_id FROM agent_runs WHERE id = ?").get("agent_run_1");
    expect(run).toMatchObject({ phase: "finalizing", policy_version: OBSERVATION_POLICY_VERSION, owner_id: "worker_a" });
    client.close();
  });

  /**
   * The reason a heartbeat exists at all. An agent printing into a loop must not look healthy, and an
   * agent thinking quietly must not look dead — so the two facts are recorded separately and neither
   * is derived from the other.
   */
  it("keeps the heartbeat and the activity clock apart", () => {
    const { repositories, observer, client, tick } = createObserverFixture();
    observer.enterPhase("executing");

    tick(30_000);
    observer.recordOutput("stdout", 4096);
    observer.flush();

    const afterOutput = client
      .prepare("SELECT last_heartbeat_at, last_activity_at FROM agent_runs WHERE id = ?")
      .get("agent_run_1") as { last_heartbeat_at: string | null; last_activity_at: string | null };
    // Output moved the activity clock and left the heartbeat exactly where the phase beat put it.
    expect(afterOutput.last_activity_at).toBe("2026-09-21T00:00:30.000Z");
    expect(afterOutput.last_heartbeat_at).toBeNull();

    tick(10_000);
    observer.beat();
    const afterBeat = client
      .prepare("SELECT last_heartbeat_at, last_activity_at FROM agent_runs WHERE id = ?")
      .get("agent_run_1") as { last_heartbeat_at: string; last_activity_at: string };
    // And a heartbeat does not pretend the agent said anything.
    expect(afterBeat).toEqual({
      last_heartbeat_at: "2026-09-21T00:00:40.000Z",
      last_activity_at: "2026-09-21T00:00:30.000Z",
    });
    expect(repositories.listRunActivity("agent_run_1")).toHaveLength(1);
    client.close();
  });

  it("aggregates a flood into bounded summaries per channel while keeping the longest gap inside them", () => {
    const { repositories, observer, client, tick } = createObserverFixture({ flushIntervalMs: 10_000 });
    observer.enterPhase("executing");

    // A chatty agent: many chunks, one long pause in the middle of the window.
    for (let chunk = 0; chunk < 50; chunk += 1) {
      observer.recordOutput("stdout", 100);
      tick(chunk === 25 ? 7_000 : 10);
    }
    observer.recordOutput("stderr", 512);
    observer.close("work_returned");

    const activity = repositories.listRunActivity("agent_run_1");
    // Fifty-one chunks became a handful of rows, not fifty-one.
    expect(activity.length).toBeLessThanOrEqual(6);
    expect(activity.reduce((total, row) => total + row.bytes, 0)).toBe(50 * 100 + 512);
    expect(new Set(activity.map((row) => row.channel))).toEqual(new Set(["stdout", "stderr"]));
    // The pause inside the aggregation window survived the aggregation.
    expect(Math.max(...activity.map((row) => row.maxGapMs ?? 0))).toBeGreaterThanOrEqual(7_000);
    client.close();
  });

  /**
   * A database that will not take a log line says the run is unobserved. It must not decide whether
   * the work succeeded, and it must not turn into an unbounded retry against a broken database.
   */
  it("degrades within a bound when observation writes fail, and keeps the failures for the caller", () => {
    const client = createDatabaseClient(":memory:");
    migrate(client);
    const repositories = createRepositories(client);
    seedRun(repositories);
    let attempts = 0;
    const failing = {
      ...repositories,
      appendRunActivity: () => {
        attempts += 1;
        throw new Error("disk is full");
      },
    };
    const observer = new RunObserver({
      repositories: failing,
      runId: "agent_run_1",
      ownerId: "worker_a",
      now: () => new Date("2026-09-21T00:00:00.000Z"),
      createId: sequentialId(),
      flushIntervalMs: 0,
      maxFailures: 3,
    });

    observer.enterPhase("executing");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      observer.recordOutput("stdout", 10);
    }
    observer.close("work_returned");

    // It stopped trying instead of hammering a broken database for the rest of the run…
    expect(attempts).toBe(3);
    expect(observer.observationFailures()).toHaveLength(3);
    expect(observer.observationFailures()[0].message).toBe("disk is full");
    // …and nothing about the run's own outcome was touched.
    expect(client.prepare("SELECT status FROM agent_runs WHERE id = ?").get("agent_run_1")).toEqual({ status: "running" });
    client.close();
  });
});

describe("summarizeRunActivity", () => {
  const startedAt = "2026-09-21T00:00:00.000Z";

  /**
   * The distinction the whole health model rests on: a run nobody watched is unknown, and reading
   * that as "produced nothing" is how a healthy long task gets declared dead.
   */
  it("reports unknown rather than silent when there is nothing recorded", () => {
    expect(summarizeRunActivity({ activity: [], startedAt, until: "2026-09-21T00:10:00.000Z" })).toEqual({
      firstActivityAfterMs: null,
      longestGapMs: null,
      trailingSilenceMs: null,
      bytesByChannel: { stdout: 0, stderr: 0 },
      summaryCount: 0,
    });
  });

  it("measures the wait before the first output, the longest gap and the trailing silence", () => {
    const stats = summarizeRunActivity({
      activity: [
        activityRow(1, "2026-09-21T00:00:30.000Z", "stdout", 100),
        activityRow(2, "2026-09-21T00:02:30.000Z", "stdout", 200),
        activityRow(3, "2026-09-21T00:03:00.000Z", "stderr", 50),
      ],
      startedAt,
      until: "2026-09-21T00:05:00.000Z",
    });

    expect(stats.firstActivityAfterMs).toBe(30_000);
    // The two-minute gap between the first and second summary, not the 30s head start.
    expect(stats.longestGapMs).toBe(120_000);
    expect(stats.trailingSilenceMs).toBe(120_000);
    expect(stats.bytesByChannel).toEqual({ stdout: 300, stderr: 50 });
  });

  it("counts a silence recorded inside an aggregation window", () => {
    const stats = summarizeRunActivity({
      // Two summaries ten seconds apart, but one of them aggregated a three-minute pause.
      activity: [
        activityRow(1, "2026-09-21T00:00:05.000Z", "stdout", 100),
        { ...activityRow(2, "2026-09-21T00:00:15.000Z", "stdout", 100), maxGapMs: 180_000 },
      ],
      startedAt,
      until: "2026-09-21T00:00:20.000Z",
    });

    // Throttling must not make a run look busier than it was.
    expect(stats.longestGapMs).toBe(180_000);
  });

  /**
   * A summary is written when its aggregation window closes, so its `observedAt` is a flush time.
   * Measuring the wait for first output from that time would charge the whole window to silence —
   * the throttle distorting the statistic it exists to make affordable.
   */
  it("measures the wait for first output from when bytes arrived, not from when the summary landed", () => {
    const stats = summarizeRunActivity({
      activity: [
        {
          ...activityRow(1, "2026-09-21T00:05:00.000Z", "stdout", 100),
          windowStartedAt: "2026-09-21T00:04:00.000Z",
        },
      ],
      startedAt,
      until: "2026-09-21T00:05:00.000Z",
    });

    expect(stats.firstActivityAfterMs).toBe(240_000);
    expect(stats.trailingSilenceMs).toBe(0);
  });

  it("measures the silence between two summaries from last byte to next first byte", () => {
    const stats = summarizeRunActivity({
      activity: [
        { ...activityRow(1, "2026-09-21T00:00:10.000Z", "stdout", 100), windowStartedAt: "2026-09-21T00:00:05.000Z" },
        { ...activityRow(2, "2026-09-21T00:04:10.000Z", "stdout", 100), windowStartedAt: "2026-09-21T00:04:00.000Z" },
      ],
      startedAt,
      until: "2026-09-21T00:04:10.000Z",
    });

    // 00:00:10 → 00:04:00, not the 4m of last-byte-to-last-byte, and not the 5s head start.
    expect(stats.longestGapMs).toBe(230_000);
    expect(stats.firstActivityAfterMs).toBe(5_000);
  });

  it("reports no gap between two channels flushed from the same window", () => {
    const stats = summarizeRunActivity({
      activity: [
        { ...activityRow(1, "2026-09-21T00:00:10.000Z", "stdout", 100), windowStartedAt: "2026-09-21T00:00:00.000Z" },
        { ...activityRow(2, "2026-09-21T00:00:10.000Z", "stderr", 20), windowStartedAt: "2026-09-21T00:00:00.000Z" },
      ],
      startedAt,
      until: "2026-09-21T00:00:10.000Z",
    });

    // Overlapping spans are one window seen twice, never a negative silence.
    expect(stats.longestGapMs).toBe(0);
    expect(stats.bytesByChannel).toEqual({ stdout: 100, stderr: 20 });
  });

  it("counts a run that only ever wrote to stderr as active", () => {
    const stats = summarizeRunActivity({
      activity: [activityRow(1, "2026-09-21T00:00:10.000Z", "stderr", 2048)],
      startedAt,
      until: "2026-09-21T00:00:20.000Z",
    });

    expect(stats.bytesByChannel).toEqual({ stdout: 0, stderr: 2048 });
    expect(stats.firstActivityAfterMs).toBe(10_000);
    expect(stats.summaryCount).toBe(1);
  });
});

describe("observation is only observation", () => {
  /**
   * P1 adds the ability to see a run, deliberately without the ability to judge one. The distinction
   * is the whole point of doing them in that order: a verdict built on data nobody has looked at is
   * how a fixed timer gets a new name.
   *
   * Checked mechanically because the temptation is real and local — the observer already knows the
   * run is silent, and ending it from there would be two lines.
   */
  it("cannot end a run, move a task, or touch a lock", () => {
    const source = readFileSync(fileURLToPath(new URL("./executionObservation.ts", import.meta.url)), "utf8");
    const forbidden = [
      "updateAgentRunStatus",
      "applyTaskTransition",
      "writeTaskStatusUnchecked",
      "releaseTaskLock",
      "acquireTaskLock",
      "createBusinessArtifact",
      "appendTaskEvent",
    ];

    expect(
      forbidden.filter((writer) => source.includes(writer)),
      "observation records what happened; deciding what it means belongs to the health policy",
    ).toEqual([]);
  });
});

function activityRow(seq: number, observedAt: string, channel: RunActivity["channel"], bytes: number): RunActivity {
  return {
    id: `run_activity_${seq}`,
    runId: "agent_run_1",
    invocationId: "run_invocation_1",
    seq,
    // These fixtures flush the instant they observe, so the window is a point.
    windowStartedAt: observedAt,
    observedAt,
    phase: "executing",
    channel,
    bytes,
    maxGapMs: null,
  };
}

function createObserverFixture(options: { flushIntervalMs?: number } = {}) {
  const client = createDatabaseClient(":memory:");
  migrate(client);
  const repositories = createRepositories(client);
  seedRun(repositories);

  let at = Date.parse("2026-09-21T00:00:00.000Z");
  const observer = new RunObserver({
    repositories,
    runId: "agent_run_1",
    ownerId: "worker_a",
    now: () => new Date(at),
    createId: sequentialId(),
    flushIntervalMs: options.flushIntervalMs ?? 10_000,
  });

  return { repositories, observer, client, tick: (ms: number) => { at += ms; } };
}

function seedRun(repositories: ReturnType<typeof createRepositories>): void {
  repositories.createCompany({
    id: "company_1", name: "Pricing Page Studio", founderVision: "Build an AI SaaS.", locale: "en",
    selectedCeoAgentId: "codex", playbookId: "ai-saas", status: "active",
    createdAt: "2026-09-21T00:00:00.000Z", updatedAt: "2026-09-21T00:00:00.000Z",
  });
  repositories.createDepartment({
    id: "department_1", companyId: "company_1", name: "Engineering",
    responsibility: "Build prototypes.", leadAgentId: "codex", memoryPath: "memory.md",
  });
  repositories.createObjective({ id: "objective_1", companyId: "company_1", title: "Validate", status: "active", priority: 1 });
  repositories.createKeyResult({
    id: "key_result_1", objectiveId: "objective_1", title: "Ship", metricName: "proof_status",
    targetValue: "proof_received", currentValue: "not_started", status: "active",
  });
  repositories.createTask({
    id: "task_1", companyId: "company_1", departmentId: "department_1", keyResultId: "key_result_1",
    title: "Record implementation changes", description: "Record implementation changes.",
    assigneeAgentId: "codex", requiredCapabilities: ["code"], proofSchemaId: "repo-diff",
    workspacePath: ".auto-crop/workspaces/task_1", status: "running", riskLevel: "medium", position: 0,
  });
  repositories.createAgentRun({
    id: "agent_run_1", taskId: "task_1", agentId: "codex", status: "running", logPath: "agent.log",
    startedAt: "2026-09-21T00:00:00.000Z", finishedAt: null, executionProfileName: "short",
    requestedTimeoutMs: 180_000, effectiveTimeoutMs: 180_000, failureReason: null, failureMessage: null,
  });
}

function sequentialId(): (prefix: string) => string {
  const counts = new Map<string, number>();
  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}
