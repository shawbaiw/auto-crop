# A Business Artifact That Does Not Parse Gets One Checked Syntax Repair

Status: accepted

## Context

A real-agent smoke of a `zh` company blocked on a competitor analysis whose work was done. The run researched nine competitors, wrote its report, and wrote `.auto-crop/business-artifact.json` — which did not parse:

```
…，"免登录"已非差异化点；…
```

Bare ASCII quotes inside a JSON string, the same hazard ADR 0022 closed for the Execution Brief. Every consumer downstream of the analysis blocked on `invalid_business_artifact`, and the only way out was to recover the task, which re-runs all of it — the research included — to fix two characters.

ADR 0022's remedy does not reach this file. The brief is a reply, so the CLI can enforce a schema on it. The Business Artifact is a file the agent writes with its own tools, and its `payload` is free-form: its shape depends on the task. Moving it to a reply under a contract fails on Codex, whose `--output-schema` is strict — verified against the real CLI, a schema with a free-form `payload` object is rejected with `'additionalProperties' is required to be supplied and to be false`. Carrying the payload as a JSON string instead moves the escaping problem inside the string.

## Decision

When a run completes and its Business Artifact file does not parse, the scheduler dispatches **one Artifact Syntax Repair** before capturing anything:

- **The same agent edits the file**, told the exact parse error, and told to change syntax only. It runs on a grant cut down to `workspace_read` and `workspace_write` — never more than the delivery held — and on a two-minute budget sized for editing one file.
- **The runtime checks the result instead of trusting it.** The repaired file must parse, and must say the same thing as the original once whitespace, JSON punctuation, quote marks and backslash escapes are set aside. A repair that changes a word is discarded.
- **Anything but a clean repair restores the original file** — content changed, still broken, or the repair run did not finish. The capture that follows then records the delivery as the agent left it, and the task parks on `invalid_business_artifact` exactly as it did before; recovering it re-runs the task.
- Whether a file is broken is read from the file (`JSON.parse`), not from a capture's validation messages. The outcome is recorded as a `task_warning` event and appended to the run log.

One repair per delivery is structural: it happens once, inline, before capture. It is not a retry loop.

## Considered options

- **Put the artifact under a Structured Output Contract** (ADR 0022). Right in principle, blocked in practice: Codex's strict mode cannot express a free-form payload, and writing full per-artifact-type schemas is a larger change than the defect.
- **Repair the JSON in the runtime** — escape quotes that look stray. ADR 0022 rejected this for the brief and the reason holds: it guesses at intent. A quote that closes a string and a quote inside prose are not distinguishable by position alone.
- **Tell the prompt to use `「」`.** A punctuation rule the model must remember while writing prose; the class of instruction that failed in the first place.
- **Re-run the whole task.** Already available as `recover_task`. It redoes the work — including web research that a second run may not reproduce — to fix the envelope.

ADR 0022 also rejected "retry once on a parse failure" for the brief: that retry re-asked the whole question and left the cause in place. This repair does not re-ask anything. It edits the existing output under a check that rules out changing it, and it applies where the contract that removes the cause is not available.

## Consequences

- A delivery broken only by its syntax is kept without redoing the work. Verified with a real Claude Code repair of the smoke's broken artifact: 22 seconds, `repaired`, and the only change was a backslash before each of the two quotes.
- A syntax repair can never smuggle in content: the check is on the text, not on the agent's account of what it did.
- Every broken delivery costs one short extra run, and the task's own execution budget does not cover it.
- Known limitation: the content check sets aside every quote mark, comma, colon and bracket, so a repair that moves one of those between fields — changing structure without changing words — passes the check. The capture's schema validation still applies to the result.
- Known limitation: only the Business Artifact file is repaired. Other files the delivery references are captured as they are.
