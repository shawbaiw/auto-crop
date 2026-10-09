# Execution Brief Adapter Incompatibility Degrades, It Does Not Block Work

Status: proposed

## Context

ADR 0022 made a correct move: a reply the runtime must parse is a contract, not a prompt request. The Execution Brief stopped being "please return JSON" and became a Structured Output Contract passed to the adapter. The runtime kept parsing the reply so a CLI that silently ignored the contract would not be treated as valid.

A later real Claude Code run exposed a different failure mode. The task `Research the first SEO keyword opportunity` never reached substantive execution. The execution-brief run exited successfully, but stdout contained adapter/CLI status text:

```text
Structured output submitted.
```

On retry it returned:

```text
Planning brief submitted -- no execution performed.
```

Neither string is the requested JSON object. `prepareExecutionBrief` parsed stdout, raised `invalid_agent_output`, and the scheduler never dispatched the actual research work. Every downstream task then blocked behind a dependency whose producer had not run.

This is not the original ADR 0022 bug. The original bug was model prose breaking JSON syntax. This one is adapter incompatibility: the selected adapter path did not provide the structured brief through the stdout channel the runtime expects.

The current behavior overstates the role of the Execution Brief. The brief is useful founder-facing intent before dispatch, but it is not the task deliverable, not Proof, not a Business Artifact, and not the dependency handoff. A recoverable pre-dispatch brief incompatibility should not be able to stop all substantive work when the final task completion still has artifact, proof, and verification gates.

## Decision

Execution Brief structured output remains the preferred path. A runtime-parsed reply still declares a Structured Output Contract when the adapter can reliably enforce and return it.

When the selected adapter cannot reliably provide a structured execution brief, the scheduler degrades the brief instead of failing the task before dispatch:

1. Record a warning that the execution brief was degraded.
2. Preserve the preparation stdout/stderr in the run log.
3. Synthesize a minimal runtime brief from task and company facts.
4. Dispatch the substantive task to the same selected adapter.
5. Keep artifact, proof, and verification checks as the authority for task completion and downstream readiness.

The runtime must not silently switch adapters. A Claude-assigned task remains a Claude task unless a separate user-visible policy explicitly chooses a fallback adapter.

Terminal preparation failures remain terminal. Process failure, quota exhaustion, unavailable launch isolation, budget exhaustion, and other real launch/runtime stops are still recorded as the step that stopped and do not dispatch substantive work. This preserves ADR 0032.

Adapter support for a structured execution brief is an **adapter contract capability**, not an Agent Capability and not a Runtime Capability:

- Agent Capability (`research`, `writing`, `code`) describes what an adapter is good at for task selection.
- Runtime Capability (`web_research`, `run_command`) describes what the process is permitted to do.
- Adapter contract capability (`structured_execution_brief`) describes whether the adapter path can satisfy a runtime protocol contract.

The initial implementation should model only the capability needed by this change. A broader engine abstraction or Cumora-style runtime action channel is deferred.

## Consequences

- A Claude Code structured-brief incompatibility no longer prevents the real task from running.
- Dashboard events can distinguish "execution brief degraded; work continued" from "task failed before dispatch".
- `invalid_agent_output` remains available for terminal cases where the runtime truly cannot consume a required agent output, but it is not used for a recoverable pre-dispatch adapter incompatibility.
- The generated minimal brief is intentionally modest. It must not claim the agent has done work, verified evidence, or chosen a strategy. It only gives the substantive run enough context to proceed.
- Downstream dependency readiness remains gated on accepted/current artifacts and verification, not on the existence of a high-quality Execution Brief.

## Relationship To Existing Decisions

ADR 0022 remains the principle: structured output contracts are the right default for runtime-parsed replies, and the parse stays. This ADR supersedes only the failure behavior for execution-brief contract incompatibility.

ADR 0032 remains unchanged: terminal preparation failures are reported as preparation failures and spend the preparation budget, not the task execution budget. This ADR adds a non-terminal preparation degradation path.

ADR 0021 remains unchanged: process permissions still flow through Agent Capability Grants. The execution-brief run continues to hold no tools. Adapter contract capability must not be mixed into the runtime grant.

ADR 0028 remains aligned: large Business Artifacts stay file-based and runtime-validated. This ADR does not move task deliverables into structured stdout.

The future Cumora-style direction is separate: agents may eventually submit artifact envelopes and attachments through a server-owned runtime command/API, with stdout treated as observability. That would improve cross-agent handoff, but it is not required for this narrower execution-brief degradation.

## Considered Options

- **Keep failing on unreadable execution-brief stdout.** Preserves the strictest reading of ADR 0022, but lets an auxiliary planning step block all substantive work even when final artifacts would still be verified.
- **Drop the Execution Brief gate entirely.** Avoids this failure, but loses founder-facing pre-dispatch intent for adapters that can provide it correctly.
- **Automatically switch to Codex when Claude Code cannot produce the brief.** Makes the task appear to recover, but hides the adapter incompatibility and violates the selected assignee.
- **Retry the brief.** The observed retry returned a different status string with the same contract failure. Retrying spends budget while leaving the adapter mismatch in place.
- **Move all handoff to a Cumora-style server action channel now.** Directionally attractive, but larger than the current blocker. It belongs in a separate design and implementation slice.

## Implementation Notes

Implementation should follow `docs/execution-brief-adapter-degradation-plan.md`.

The first slice should:

1. Add an adapter contract capability vocabulary.
2. Mark Codex as supporting `structured_execution_brief`.
3. Leave Claude Code unmarked until its current structured-output channel is verified.
4. Change `prepareExecutionBrief` to return `structured`, `degraded`, or `failed`.
5. Teach the scheduler to dispatch substantive work for `degraded`.
6. Add tests for degraded brief dispatch, warning visibility, terminal preparation failure, and existing successful structured output.

Manual validation should use a fresh company and confirm the first Claude Code task reaches substantive execution after the brief degradation warning.
