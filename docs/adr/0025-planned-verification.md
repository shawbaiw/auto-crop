# A Plan Declares Which Tasks Verify, And Against What

Status: accepted

## Context

ADR 0023 put a verdict behind every success path, but only for tasks whose dependencies say they verify something: a `verification_target` edge makes a task a verifier, and its requirements come from a `verification_requirements` edge. Only the department split template created those edges.

The CEO blueprint is how most tasks come to exist, and it had no way to say either thing. A task carried `dependsOnTaskKeys` and nothing else; `createCompany` wrote every dependency as `context`. So a company whose plan verified work through a task like "Run local validation checks" — the shape of the company whose stall started this — was not protected at all: that task ran inside the producer's workspace, had no requirements, and was not judged. Changing the founder's vision to one that produces a different task graph would route around the contract entirely.

The runtime cannot recover the missing facts on its own. Verification duty is not visible in the proof schema: the same `test-output` schema served "Run local validation checks" and "Design the first monetization experiment". `inferValidationDependencies` already guesses dependencies from proof schemas; guessing duty the same way would protect some verifiers, falsely judge some producers, and make the outcome depend on which schema a model happened to pick.

## Decision

**Every planned task declares its verification duty.** `blueprint.tasks[].verification` is required: `null`, or `{ targetTaskKeys, requirements }`. It has no default, so a plan that says nothing is a parse error, not an unprotected verifier. The CEO prompt explains the field and shows both forms.

**A declared verification is a planning contract, checked when the plan is parsed.** Targets must be earlier task keys, not the task itself; requirements must be a non-empty list with unique ids. A violation fails company creation before any record is written.

**Creation turns the declaration into runtime structure.** Each target becomes a dependency in the `verification_target` role, whether or not the plan also listed it in `dependsOnTaskKeys`. The requirements are stored on the task (`tasks.verification_requirements`) as a second requirement source. `prepareVerificationInputs` takes requirements from exactly one source — an upstream artifact, as a department's Define stage provides, or the task's planned list — and treats two sources as a handoff failure rather than choosing one.

**Duty survives the paths that rewrite the plan.**

- A verifying task is never split into department subtasks; its targets and requirements belong to it, and the split template would pass them on as plain context.
- A replan that replaces a verifier gives the final replacement task the source's verification edges and planned requirements. Without that, confirming a replan would silently remove a verification from the plan.

## Considered options

- **Infer verifiers from the proof schema.** The schema does not carry the meaning, as the two `test-output` tasks show.
- **Make `verification` optional, defaulting to `null`.** A model that forgets the field produces an unprotected verifier with no error — the exact failure this closes.
- **Always insert a runtime-authored requirements step before a planned verifier**, mirroring the Define stage. The plan still has to say which tasks verify, so the blueprint changes anyway, and every verifier costs an extra agent run.

## Consequences

- Company creation is tested from the founder's input for three kinds of business — a website, a data-cleaning job, and written content in Chinese that is carried in the artifact rather than a workspace. Each runs through the real scheduler to a verdict, with a sound and a defective delivery. The website's producer is split by its department, so that case also covers a planned verifier whose target is aggregated from subtasks, and a defect caught by the department's own Validate stage first.
- A blueprint from before this change no longer parses. Only new plans are affected; existing companies keep their records.
- Known limitations:
  - Replan planner output (`ReplanReplacementTask`) cannot declare new verification of its own; replacements only inherit the duty of the task they replace.
  - The trigger for splitting a task still matches title and description text; `createCompany` appends guidance that makes every `landing-page-file` task match it.
  - A task whose plan declares `verification: null` but in practice verifies something is not protected. The contract makes the declaration explicit; it cannot make it correct.
