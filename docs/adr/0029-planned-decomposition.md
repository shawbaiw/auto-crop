# Whether A Task Is Split Is Declared By The Plan

Status: accepted

## Context

`isLargeDepartmentTask` decided whether a department split a task into Define / Execute / Validate stages by matching text: the proof schema had to be `landing-page-file` or `deployment`, the title or description had to contain "prototype", and either had to contain "validate" or "deployment".

Company creation then appended guidance to every artifact-producing task's description — "Prototype guidance: prefer a fast, inspectable browser artifact…" — text containing the very words the trigger matched. The decision was therefore neither the plan's nor the runtime's: a landing-page task was split because the runtime had written "prototype" into its own description. A real smoke showed both sides of that: a task meant to expose a local URL was split into three stages, while nothing in the plan said so.

The same file held two more inferences of the same kind. `inferValidationDependencies` gave every `test-output`, `local-url` or `screenshot` task a dependency on the nearest earlier artifact producer — guessing who verifies whom, which ADR 0025 removed from the verification contract but left standing here. And proof-schema normalization still matched `validate|test|check|screenshot|local url` in titles.

This is the pattern ADR 0021, 0022, 0025 and 0027 each removed from a different decision: the runtime acting on what output *reads like* instead of what the plan *states*.

## Decision

A blueprint task declares **`decomposition`**: `null`, or `{ "template": "define_execute_validate" }`, the one split shape the runtime implements — one parent, three stages, one level deep. It is required on every task, like `verification` (ADR 0025), so a plan cannot leave it unsaid.

- **The scheduler splits only what declares a decomposition.** `isLargeDepartmentTask` is deleted; wording decides nothing.
- **A verification task can never declare a decomposition**, and the blueprint schema refuses a plan where one does. ADR 0025 enforced this in the scheduler; it now fails at planning time, where it is a plan defect rather than a dispatch-time special case. The scheduler keeps the check as a floor.
- **An unknown template is a planning error**, so a template added later cannot be silently ignored.
- **`inferValidationDependencies` is deleted.** Verification targets come from the declared `verification`, as ADR 0025 decided; nothing else guesses a dependency from a proof schema.

The prototype guidance stays in the task description. With the trigger gone it is what it always claimed to be — advice about the shape of proof — rather than a hidden switch.

## Considered options

- **Keep the trigger, stop appending the guidance.** Removes the self-fulfilling loop, leaves the runtime reading intent out of prose.
- **Let the department decide at dispatch.** Moves the guess later without making it visible to the plan or the founder.
- **Have the plan declare the stages themselves** (titles, contracts, per-stage requirements). More expressive, and more for a planner to get wrong, for a template the runtime implements exactly one way. The template name can grow into this if a second shape ever exists.

## Consequences

- What a department does with a task is visible in the plan, and a founder reading it can see which tasks become three.
- A CEO Agent has one more required field to get right. The planning contract smoke (`pnpm smoke:real-planning`) is the check for that, as it was for `verification`.
- A blueprint from before this change no longer parses. Only new plans are affected.
- Known limitation: the runtime still implements exactly one template, so a task needing a different split has to be planned as separate tasks.
- Known limitation: proof-schema normalization still matches words in titles when a plan names a schema that does not fit its deliverable. That inference decides which schema to record, not what the runtime does with a task, and is left for its own change.
