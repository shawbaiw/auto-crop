# A Reply The Runtime Must Parse Is A Contract, Not A Prompt Request

Status: accepted

## Context

A keyword research task failed with `agent_failed` on an agent run that exited 0. The whole company stalled behind it: four downstream tasks went to `dependency_failed`, and the objective reported every task terminal with no outcome summaries.

The agent had done nothing wrong. `prepareExecutionBrief` asks for JSON in the prompt — "Return only JSON with non-empty string fields: purpose, approach, expectedOutcome" — and parses the reply with `JSON.parse`. The reply was in Chinese, and one prose field quoted a phrase:

```
…且给出的理由能直接支持"做哪个网站"的决策。
```

Those are bare ASCII quotes inside a JSON string value. `JSON.parse` threw at column 197, the catch marked the run failed, and the substantive research prompt was never dispatched. The 300-second budget the task had just earned went unused.

Two things make this worse than an unlucky sample:

- **It is locale-correlated.** Chinese prose quotes phrases as a matter of course. Every `zh` company runs this hazard on every task, and the run before it survived only because the model happened to reach for `'` instead of `"`. Treating it as flakiness would have meant re-running until the dice came up right.
- **The failure named the wrong party.** `agent_failed` on an `exitCode: 0` run sends the next person to read the agent's output looking for what the agent got wrong. What broke was the runtime's own expectation.

The repository already holds the principle this violates. `docs/persistent-agent-sessions-plan.md` lists "Code mechanisms over prompt rules" among the lessons to borrow: correctness must come from runtime contracts, not from asking the agent to remember boundaries. ADR 0021 applied it to capabilities — an Execution Brief run holds no tools rather than being told not to use any. The output shape was the remaining place where the runtime asked nicely and hoped.

## Decision

A run whose reply the runtime must parse carries a **Structured Output Contract**: a JSON Schema on the `AgentRunRequest` that the CLI enforces, rather than an instruction in the prompt that the model may satisfy in spirit. The prompt still explains the shape, because explaining it improves the content; it is no longer what guarantees it.

The two CLIs take the contract in opposite shapes, and neither accepts the other's — verified against both:

| Adapter | Flag | Accepts |
| --- | --- | --- |
| Claude Code | `--json-schema` | inline JSON only (a path fails: `--json-schema is not valid JSON`) |
| Codex | `--output-schema` | a file path only |

So the runtime holds the contract as an object and each adapter converts. For Codex the adapter materializes a temp file for the duration of the run and removes it afterwards, outside the workspace so it can never be mistaken for Proof. One consequence is deliberate and tested: `commandPreview` creates no files, so a Codex preview shows the launch without the flag. A preview that wrote to disk would be a worse trade than a preview that is honest about what it cannot show.

**The parse stays.** A CLI that silently ignored the schema must not read as a valid brief, and the contract does not check that required strings are non-empty. What changes is that reaching the catch is now a surprise rather than a coin flip.

**Unreadable output gets its own failure reason.** `invalid_agent_output` joins `AgentFailureReason`, distinct from `agent_failed`: the process ran and answered, and the contract it missed was the runtime's. It maps explicitly to a `runtime_interrupted` Hold — whose Resume Affordance, running the task again, is the right way forward — rather than falling through to that Hold as the unmodelled-stop catch-all. ADR 0020's catch-all should keep meaning "nobody modelled this".

## Considered options

- **Repair the JSON before parsing.** Escape stray quotes, or fall back to a lenient parser. It guesses at the model's intent, silently corrupts any field where the guess is wrong, and grows a new special case per locale.
- **Tell the prompt to avoid quotation marks.** A rule the model must remember, about punctuation, in prose it is simultaneously being asked to write well. The same class of instruction that failed here.
- **Retry the brief once on a parse failure.** Halves the failure rate and doubles the cost, while leaving the cause in place.
- **Drop the Execution Brief gate** so a parse failure cannot block the work. The brief is durable evidence of intent before dispatch; losing it to fix a parser is the wrong trade.

## Consequences

- A brief written in any language survives quoted prose. Verified against the real CLI with the exact production launch (`--restricted --tools "" --json-schema`): a Chinese reply containing two quoted phrases came back with both correctly escaped.
- A failure here now says the runtime could not read the reply, in the task's failure message and on both dashboard surfaces, so the next person does not start by reading the agent's output.
- Any future runtime-parsed reply should declare a contract. The CEO blueprint and the replan planner both parse model output today and do not yet have one; they parse a fenced block with their own tolerance, and moving them over is a follow-up rather than part of this change.
- Known limitation: the contract constrains shape, not substance. A schema-valid brief whose `approach` is empty or generic still has to be caught by the parse and by review.
