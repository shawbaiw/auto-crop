# Agent Runs Record An Execution Trace

Status: proposed

Every Agent Run records an Execution Trace: an ordered list of steps parsed from the agent CLI's structured stream while the run is live. The runtime persists the steps per run and pushes them over the event stream, so the department page can show the work as it happens.

## Context

Agents are launched with plain-text output. The runtime reads stdout only when the process exits, and while a run is live it records byte counts only. The log is written once per task after the run, so a retry overwrites it. Nothing parses tool calls, file changes, commands or the reasoning summaries the CLIs expose. The dashboard therefore cannot show what an agent is doing, only that it is running.

## Decision

- **Structured streaming launch.** Claude Code runs with `--output-format stream-json`, and Codex runs with `exec --json`. Each adapter parses its stream line by line. A launch-policy probe keeps the plain-text path for CLI versions that lack the flag, and those runs simply have no trace.
- **One step model across agents.** Adapters normalise their events into Trace Steps: `plan` (the Execution Brief), `reasoning_summary`, `tool_call` with its result, `file_change`, `command` with exit status and output excerpt, and `result`. Only text the CLI exposes as a summary is recorded. Hidden model reasoning is never requested or shown.
- **Persistence per run.** Trace steps are stored per Agent Run in their own table, ordered and timestamped. Raw logs are kept per run, not per task, so a retry no longer erases the previous run.
- **Live delivery.** A new `trace_step` event carries each step to the dashboard. A route returns the steps of a run for refresh and history. Retention thins old traces like other execution history (ADR 0039).
- **Not evidence.** A trace shows what happened. It is never Proof, a Business Artifact or a Task Deliverable, and it decides nothing.

## Consequences

The CLI stream formats differ and change with CLI versions, so each parser needs fixtures per version and the probe must fail safe. Until this lands, the dashboard execution trace shows only the runtime's progress steps (dashboard ADR 0002).
