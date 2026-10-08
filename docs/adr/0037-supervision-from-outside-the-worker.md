# Supervision From Outside The Worker

Status: accepted. Delivers P3 of [the execution health plan](../execution-health-and-recovery-plan.md).

## Context

P1 gave the runtime the ability to watch a run. It watches from inside the worker — the same process that runs the scheduler, serves the API, and holds the child processes. That covers a run that hangs, and covers nothing about the worker itself. A worker that is OOM-killed, or whose event loop wedges, stops observing at the same instant it stops working: the heartbeats simply end, and there is nobody left to notice that they did.

That is the failure the whole plan is about. A task whose worker died looked, from the database, exactly like a task being worked on — and after P2b it looks like one until its lease expires, which is better but still requires someone to run the reconcile. Until now the only thing that ran it was the scheduler tick, which lives in the worker that died.

Delivery has the same shape. A failure that nothing is told about is a failure nobody acts on, and every notification path so far has been an in-memory callback from the process that produced the event. The plan is explicit that this is not delivery: "已有任务事件记录和运行时通知不等于可靠恢复投递."

Two constraints shaped the answer. A supervisor must not depend on anything the worker serves — asking a wedged worker's HTTP endpoint whether it is healthy is asking the patient. And delivery must be at-least-once rather than exactly-once, because nothing spanning a process boundary and a network can promise otherwise; what can be promised is that acting on the same event twice has the same effect as acting on it once.

## Decision

**Supervision is a separate process with its own database connection, and events are durable before anyone tries to deliver them.**

- An **outbox** row is written in the same transaction as the state change it describes. Outside that transaction there are two real failures and both were reachable: a settlement that commits with no event, so nothing downstream ever hears; and an event that outlives a settlement that rolled back, so recovery acts on something that never happened.
- A **dispatcher** claims events persistently, with a claim that **expires**. A dispatcher killed mid-delivery does not take its events with it — the next one picks them up. Failed deliveries back off exponentially and are **dead-lettered** rather than dropped, so an operator can fix a consumer and replay.
- Delivery is **at-least-once**, and the **recovery coordinator** is idempotent on the source event id, enforced by a unique constraint rather than by a check. This is the mechanism that keeps one failure from producing two replacement executions (plan invariant 12), and it has to be in the database because the thing it defends against is a crash.
- The coordinator **re-reads the task inside the transaction that records its decision**. The event describes the world when the run ended; by the time anyone acts the founder may have cancelled the task, a replan may have replaced it, or another run may own it.
- Local decision comes **before** external forwarding, and does not depend on it. An operator's webhook being down must not stop the runtime deciding what to do about its own failed run.
- The coordinator's default is **`report_only`**: it says what it sees and records that, and schedules nothing. The Hold model already guarantees a stopped task carries a way forward; automatic recovery is a narrower, evidenced subset (P5), and enabling it before the observation exists to justify it is how a recovery storm starts.

**The supervisor is a parent process, and the worker is its child.** As of K1, both `auto-crop start` and `auto-crop supervise` enter supervision. The child uses an internal IPC-gated `__worker` command, preserving Node loader arguments and the resolved project root. The parent observes exit directly and reconciles that startup identity before scheduling its replacement (K3).

**One local supervised launch per state directory.** Before opening/migrating the application database, startup claims a row in `.auto-crop/supervisor.sqlite` under `BEGIN IMMEDIATE`. It records the hostname, Supervisor PID and Worker PID; the Worker receives permission to start only after its PID is persisted. A competing starter refuses while either recorded local PID is present. Stale claims are reclaimed only after both are confirmed absent. PID reuse, permission errors and a different hostname cause conservative refusal instead of takeover. This avoids time-based takeover of a paused process and file-unlink races without adding distributed leader election.

SIGINT/SIGTERM waits for Worker exit before releasing ownership. A Worker exits when its parent IPC channel closes. If it is stuck and cannot handle disconnect, its recorded PID continues blocking another supervised launch. This is local process admission, not proof that detached Agent descendants have stopped. K3 isolates the departed owner's active run workspaces rather than claiming its process tree has stopped. Direct library calls to `startAutoCrop` remain a low-level unsupervised API for embedding and tests.

## K3 amendment (2026-09-23)

Each Worker launch gets a fresh owner UUID. The Supervisor persists it in `pending_workers` in its ownership database before spawn, and grants the Worker that identity through the existing IPC handshake after PID registration. Scheduler run creation records the owner in the same transaction as the run and its workspace claim, before the first observation or Agent invocation. A missing invocation PID therefore cannot hide a run from exit reconciliation.

The parent listens to `exit`, not pipe `close`, and queues an owner-specific scan behind any in-flight scan. A fresh run or retrying Task is handled without waiting for its budget or lease. SQL checks owner identity and epoch before settlement. The event records `worker_lost`; the Task receives the existing `termination_unconfirmed` Hold and its workspace claim is isolated without expiry. A pre-run orphan belonging to the known-dead owner can be reconciled before its lock expires. Other owners are not treated as dead because this Worker exited.

Startup scan errors propagate before any Worker is spawned. Replacement startup waits for successful reconciliation, then uses the restart delay; failures remain gated and retry with delay. Pending owner rows are deleted only after the scan succeeds and survive Supervisor shutdown/reopen. Shutdown also reconciles the departing Worker. Missing workspace claims, unclassified residual claims after a terminal run, or inconsistent Task ownership cause a conservative startup/restart refusal instead of releasing unknown execution rights.

This version deliberately uses the manual confirmation path for active runs after Worker loss. It neither guesses Agent PIDs nor claims to kill detached descendants, on Unix or Windows. The founder must verify those processes have stopped before confirming termination; only then can the existing route release isolation. Legacy Workers without persisted startup identities remain outside this mechanism. P4.3 adds live-but-wedged detection for pinned budget runs: an independent scan records suspect/lost evidence, requests stop durably, and the CLI terminates only its exact owned Worker. K3 still isolates unconfirmed Agent descendants before replacement.

Evidence: a local fixture runs the real scheduler, creates a fresh run and lease, then spawns a detached writer and exits before any Agent PID is persisted. The writer keeps changing its file while isolation rejects a different Task's claim even beyond lease expiry. Injected outbox failure blocks replacement until reconciliation succeeds, including after Supervisor close/reopen. Separate tests cover startup refusal, owner scoping, retrying Tasks, pre-run orphans and duplicate delivery.

## Considered options

- **Keep monitoring inside the worker.** Free, and it cannot observe the case it exists for. A monitor that dies with the thing it monitors is not a monitor.
- **A standalone `watch` command plus launchd/systemd.** The right answer for a real deployment, and it makes the first honest version depend on the operator installing and configuring something. Nothing stops it later: the supervisor is a module, and the process shape around it is thin.
- **Deliver from the worker's event bus.** What the runtime already had. It loses every event produced by the crash it most needs to report.
- **Exactly-once delivery.** Not available across a process boundary. Claiming it would replace an honest "act twice, harmlessly" with a dishonest "acts once".
- **Recover automatically by default.** What a reader might expect "recovery coordinator" to mean. On the evidence available today it would re-run work into workspaces whose previous writer was not confirmed gone, and re-queue failures the founder is already looking at.

## Consequences

- A worker exit triggers a scan outside the worker. K2 persists reconciliation and its event together. K3 associates exit with a startup UUID and isolates active workspaces; it does not implement cross-process Agent termination. This ADR is not proof that all P3 acceptance criteria passed.
- The supervisor cannot stop a process owned by a different worker — it has no control channel to one — and reports those as unreachable rather than as stopped. It also cannot survive its own machine going down; no part of this claims otherwise, and the docs say so where a founder will read it.
- A second local supervised launch is refused before spawning. Cross-host leadership and control remain outside this local startup guard.
- The outbox grows without bound. Delivered events are kept deliberately — they are the audit trail for what was decided and when — but there is no retention policy yet, the same gap `run_activity` has.
