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

**The supervisor is a parent process, and the worker is its child** (`auto-crop supervise`). Considered against a standalone `watch` command driven by a system process manager, and chosen because it delivers a working start/stop/restart today with no supervisor of its own to install: the parent sees the child's exit directly rather than inferring it from a lease, so a crashed worker is reconciled in the same second rather than ninety of them later. `start` is unchanged and still runs alone, which is what the tests and the existing workflow use.

## Considered options

- **Keep monitoring inside the worker.** Free, and it cannot observe the case it exists for. A monitor that dies with the thing it monitors is not a monitor.
- **A standalone `watch` command plus launchd/systemd.** The right answer for a real deployment, and it makes the first honest version depend on the operator installing and configuring something. Nothing stops it later: the supervisor is a module, and the process shape around it is thin.
- **Deliver from the worker's event bus.** What the runtime already had. It loses every event produced by the crash it most needs to report.
- **Exactly-once delivery.** Not available across a process boundary. Claiming it would replace an honest "act twice, harmlessly" with a dishonest "acts once".
- **Recover automatically by default.** What a reader might expect "recovery coordinator" to mean. On the evidence available today it would re-run work into workspaces whose previous writer was not confirmed gone, and re-queue failures the founder is already looking at.

## Consequences

- A worker that dies is noticed by something that did not die with it, and its abandoned tasks are recovered and reported in the same pass.
- The supervisor cannot stop a process owned by a different worker — it has no control channel to one — and reports those as unreachable rather than as stopped. It also cannot survive its own machine going down; no part of this claims otherwise, and the docs say so where a founder will read it.
- Two supervisors on one database are safe with respect to the outbox, because claims are conditional. Nothing yet elects a leader between them, so they would both reconcile; that is idempotent but wasteful, and it is the next thing to fix if a second supervisor ever becomes real.
- The outbox grows without bound. Delivered events are kept deliberately — they are the audit trail for what was decided and when — but there is no retention policy yet, the same gap `run_activity` has.
