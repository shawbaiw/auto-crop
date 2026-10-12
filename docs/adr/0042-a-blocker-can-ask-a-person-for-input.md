# A Blocker Can Ask A Person For Input

Status: proposed

A Blocker Report may carry an **Unblock Request**: the one thing a person must bring back from outside the runtime before the same task can continue. Settlement turns it into a Human Action on the blocked task itself, and confirming that Human Action re-runs the task with the confirmation as runtime-held input. The task graph does not change: this is the task pausing to ask for something, not the plan being rewritten.

## Context

The first real e2e run asked a research task to prove a keyword met "Ahrefs KD ≤ 10–15". Every KD source needs a login or a JavaScript challenge, which the run's `web_research` grant cannot pass. The agent tried nine sources, refused to pass an estimate off as a KD value, and filed an honest Environment-Blocked Blocker asking the founder to look up five values in a browser.

Nothing could carry the answer back. The blocker settled as an invalid delivery, so the task's only exits were refresh, recover (which re-runs into the same wall), replan (see ADR 0043) and cancel. A Human Action already means "a person must act outside the runtime and confirm it with evidence", but Human Actions were only created from a delivered artifact's next steps, never from a blocker. A CEO Intake is company-level, unscoped to any task, and nothing consumes it yet (ADR 0006).

## Decision

- A Blocker Report's payload may declare an `unblock_request`: what is needed, why, and the evidence requirements a confirmation must meet. It is part of the Artifact Envelope contract, so a malformed request is rejected when the agent submits (ADR 0041).
- Settlement of a blocker that carries a valid Unblock Request opens a Human Action on the blocked task and parks the task on an `awaiting_human_action` Hold naming it — not an `invalid_business_artifact` Hold. CEO Office shows it as something the founder can do, not as a broken delivery.
- A Human Action Confirmation that meets every evidence requirement releases that Hold and re-queues the task automatically. Submitting is already a deliberate act; a confirmation that is incomplete is rejected rather than half-accepted, so data that arrives in parts is the agent's evidence requirements to state, not a second founder click.
- The confirmation becomes one of the task's Settled Facts, which every later run of the task is given at dispatch with its source, from runtime state — never as a file the agent is told to read from its workspace (see ADR 0043's Consequences).
- The re-run counts toward Bounded Recovery's attempt ceiling, so an agent that keeps asking cannot loop forever.
- The `awaiting_human_action` Hold also offers `request_replan`, so the founder may decline and replan instead; the Unblock Request is part of what the replan planner is told (ADR 0043).
- Secrets are out of scope. An Unblock Request must not ask for credentials or API keys, and a Human Action Confirmation must not carry them; giving a run a capability is an Agent Capability Grant, decided elsewhere.

## Considered Options

- **Route it through CEO Intake.** Intake is company-level direction with no task, no evidence requirements and no Hold semantics; bolting task input onto it would merge two concepts and still leave the blocked task without an exit.
- **Insert a new human task into the graph.** That is planning, with dependency rewiring and its own review, for what is one question and one answer on an existing task.
- **Stop after the confirmation and wait for the founder to resume.** One more click for every answer, to cover partial data that evidence requirements already cover.
