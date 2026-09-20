# Server Context

The API server, its persistence, and the runtime that dispatches work. System-wide vocabulary lives in the root `CONTEXT.md`; this file covers the rules that only apply inside `apps/server`.

Read this before changing anything that moves a task between states, decides what a founder can do to a task, or adds an API route that mutates a task.

## Task State Is Written In Exactly One Place

`applyTaskTransition` (`src/runtime/taskTransition.ts`) is the only code permitted to write `tasks.status`. The repository method it calls is named `writeTaskStatusUnchecked` so a bypass is visible on sight, and `taskTransition.test.ts` fails the build when a new production file calls it.

The seam exists because task status alone never said *why* a task stopped or *who* could restart it. That answer lived in four unrelated facts nothing kept in sync, and they drifted — see ADR 0020 for the failure that produced this design.

Every transition goes through the seam, which enforces:

- **Parked implies held.** Landing in a Held Task Status opens a Task Hold — the declared one, or one derived from the execution summary when the caller declares none. Landing in a self-propelling or terminal status resolves every open Hold.
- **Status-bound Holds cannot outlive their status.** `awaiting_ceo_review` is only coherent in `review`, `needs_replan` only in `needs_replan`. Leaving either resolves the Hold as `superseded` in the same write. Which status a kind binds to is declared *with the kind*, in core's `taskHoldStatusBinding` — exhaustive over the union, so a kind added later cannot skip the question. A Hold outliving its status is the mechanism of the original failure, and the defence against it must not be a list someone can forget to append to.
- **Idempotence.** Re-parking for a reason the task is already held on reuses the open Hold. A Hold per distinct subject, so two concurrent waits stay separately visible.

### Status classes

| Class | Statuses | Open Holds |
| ----- | -------- | ---------- |
| Self-propelling | `queued`, `running`, `retrying` | none — the runtime owns it |
| Held | `waiting_dependency`, `blocked`, `review`, `needs_replan`, `failed` | at least one |
| Terminal | `complete`, `cancelled` | none |

`waiting_dependency` is a Held Task Status on purpose: "waiting on upstream task X" is a Hold with a subject, and modelling it as one is what lets a surface name the task being waited on instead of repeating a generic badge.

## What A Founder Can Do Is Computed, Never Re-Derived

`resolveTaskAffordances` (`packages/core/src/taskHold.ts`) maps open Holds to Resume Affordances. It is pure and exhaustive over `TaskHoldKind`: a new Hold kind will not compile without declaring how it is resolved, and the test suite rejects one whose only offer is cancellation.

Server-side, `resolveTaskAffordanceState` binds it to stored facts and `checkTaskAffordance` guards mutating routes. Both live in `src/runtime/taskAffordances.ts`.

Three rules follow, and breaking any of them reintroduces the ADR 0020 bug:

1. **Guards check affordances, not status.** A route that mutates a task asks whether the task currently offers that affordance. It must be the same computation the surface used to offer it.
2. **Refusals are not dead ends.** An affordance refusal returns 409 with the task's current `holds` and `affordances`, so a founder acting on a stale view is redirected to the real next action.
3. **Clients never decide eligibility.** Every task summary carries `holds` and `affordances`; the dashboard renders from that list alone. An eligibility rule kept on both sides is a rule that drifts.

Two affordances have runtime state preconditions — refresh and recover. Those are declared once, in core's `affordanceStatusGates`, and reached through `isAffordanceApplicable`. `taskRefresh` and `taskRecovery` call that function rather than restating the rule next to the implementation: a second copy of a precondition is how the offer and the guard drifted apart in the first place.

### Adding an affordance

An affordance that no route honours is worse than no affordance: it renders a button that silently does nothing. `taskAffordanceCoverage.test.ts` pins every `TaskAffordanceKind` to a route that actually changes state. A new kind must ship with its route in the same change.

## Reconciliation Passes

The runtime repairs state on read rather than trusting every writer. Three passes run during `buildCompanyState`, and the distinction between them matters:

- `reconcileStaleRunningTasks` — a run whose deadline passed while nobody was watching.
- `reconcileReviewTasksForAutomaticAcceptance` — **one-time per company**, marked in `runtime_state`. It exists for a single model change (ADR 0017) and every later call is a no-op.
- `reconcileTaskHolds` — **standing, never marked**. It repairs the Hold invariant from current facts on every read, and also runs whenever one task's affordances are resolved, because a founder can act on a task without loading the board first. It is deliberately not a migration: the drift it repairs is a recurring class of mistake, not a one-time schema change.

`reconcileTaskHolds` may sharpen the unattributed `runtime_interrupted` fallback using facts the pure rule cannot see — an upstream that still owes a deliverable makes it a dependency wait, not an unknown interruption. Refinement only ever narrows the fallback; an attributed Hold is left exactly as derived.

## Permission Mode Reaches The Agent Process, Not Just The Scheduler

An Agent Run executes under an **Agent Capability Grant**: what the task needs, intersected with what the company's Permission Mode allows. `resolveAgentCapabilityGrant` (`src/policies/capabilityGrant.ts`) is the only place that decides it, and an adapter translates a grant into its own launch flags without looking at the task.

Before this existed, the launch was one constant — `claude -p --permission-mode acceptEdits` — which auto-approves file edits and nothing else. A research task's `WebSearch` was denied by a prompt no non-interactive run can answer; the agent called that a sandbox and shipped estimates as a deliverable. See ADR 0021.

Three rules follow:

1. **Fail closed, then grant back.** The base launch removes shell and code-running tools, ignores user/project/local settings files, skips host MCP servers, confines file tools to the working directory, and denies anything that would prompt. A capability exists only because the grant named it. A run must never depend on what the operator's machine happens to have configured.
2. **The prompt states the grant.** `buildTaskExecutionPrompt` emits a `## Granted Capabilities` section. An agent that discovers a denial mid-run has no vocabulary for it and invents one.
3. **A capability blocker is refutable.** `verifyEnvironmentBlockerClaim` rejects an Environment-Blocked Blocker naming a capability the run was granted. This is the mirror of ADR 0016: there, runtime-held evidence confirms a claim the agent cannot prove; here it refutes one the agent should not have filed. A capability the runtime does not grant (`browser_screenshot`, `keyword_data`) is never refuted — see `GRANTABLE_CAPABILITY_ALIASES`.

The same principle governs what comes back. A run whose reply the runtime parses declares a **Structured Output Contract** — a JSON Schema on the request, which Claude Code takes inline via `--json-schema` and Codex takes as a file via `--output-schema`. The prompt still explains the shape; it no longer guarantees it. A reply that misses the contract fails as `invalid_agent_output`, not `agent_failed`, because the process answered and the expectation was the runtime's. See ADR 0022, and add a contract to any new runtime-parsed reply.

The Business Artifact is the exception: the agent writes it as a file and its payload is free-form, which Codex's strict `--output-schema` cannot express. A completed run whose artifact file does not parse gets one **Artifact Syntax Repair** before capture — the same agent, a workspace-only grant, told the parse error — and the runtime keeps the result only if it parses and says the same thing once syntax is set aside; otherwise the original file is restored. See ADR 0028.

Do not ask an agent to repeat one generated field as another generated field. Founder Decisions use `recommended_option_index` to point into `open_decisions[].options`; the runtime derives the display recommendation label from that index. A string `recommendation` is legacy compatibility only. This is the same design rule as capability grants and structured output: turn prompt obligations into structure when the runtime can express them.

`approvalRequired` decides whether a task needs Founder Approval before dispatch. It resolves the **company's** Permission Mode through `resolvePolicyForPermissionMode`, not a hardcoded default — a company set to `safe` must actually ask — and asks when any capability the run needs carries an `ask` decision.

A task blocked this way gets an `awaiting_founder_approval` Hold naming its Approval record, and `POST /api/approvals/:id` is what clears it. Denying moves the task to `needs_replan`, because a task whose required action the founder refuses cannot run as specified. Granting goes through `releaseTaskHold`, not a direct transition — see below.

## Clearing One Hold Is Not Unblocking A Task

A task can be held for several reasons at once: waiting on Founder Approval *and* on an upstream deliverable. An actor who answers one of them has said nothing about the others.

The seam is **default-safe** about this, rather than relying on each caller to remember it: a transition into a self-propelling status resolves only the Holds the caller named, and if any Hold is still open the task **does not move**. The caller says what its reason actually answers — `resolvesHoldIds` for a specific Hold, `resolvesHoldKinds` for a reason that addresses a class of them, such as a dependency cascade that just found the upstream ready. Anything it did not account for keeps the task where it is.

That matters more than it sounds: every caller that had to remember this got it wrong. All four answer paths forced `queued`, so answering one Hold read as "nothing is in the way", and the task then advertised itself as about to run while what it still waited on was invisible.

`releaseTaskHold` is a readable shorthand over the same rule, not a different one. A path that ignores it and calls the seam directly still cannot start a task something else is holding.

Any path where an actor answers one specific Hold uses it rather than assuming their answer was the only thing in the way. Today that is all four answer paths:

| Answered | Where | Hold it closes |
| -------- | ----- | -------------- |
| Founder Approval | `runtime/founderApproval.ts` | `awaiting_founder_approval` |
| Human Action confirmed | `confirmHumanAction` in `api/routes.ts` | `awaiting_human_action` |
| Wait State elapsed | `applyWaitStateRouting` in `api/routes.ts` | `awaiting_external_wait` |
| CEO review returned | `createCeoReviewDecision` in `api/routes.ts` | `awaiting_ceo_review` |

Find the Hold with `findOpenTaskHold(repositories, taskId, kind, subjectId)` — by subject, because two Holds of the same kind on one task are two separate waits, and confirming one Human Action must not be read as confirming another.

`applyTaskTransition` also takes `resolvesHoldIds`, for the case where the actor's answer *and* a new blocking fact land together: a denied approval closes the approval Hold and opens a replan Hold in one write.

The event a released path emits must report the task's **actual** resulting status, not `queued`. "Human Action confirmed; task queued" on a task that is still waiting on an upstream is the same lie in a different place.

The granularity is deliberately coarse: one pre-dispatch question for the whole run, not one per action. That is also why an `ask` decision *grants* the capability rather than withholding it — the consent was already collected, once, before dispatch. Per-action approval during execution, and the per-action grant narrowing that belongs with it, are a separate and larger change.

## Readiness Is Asked Of One Resolver

`resolveDependencyReadiness` is the only answer to "can this task consume its upstream?". Dispatch, parent aggregation, the dependency cascade and Hold reconciliation all call it; a second copy is how aggregation once queued a parent the scheduler parked four seconds later. It classifies each dependency as internal (a subtask consumed by its parent or a sibling) or ordinary, and applies that relation's rule (ADR 0024).

A department subtask never goes through acceptance. Its delivery parks in `review` under `awaiting_parent_aggregation`, and `deriveTaskHold` maps a subtask in `review` to that kind so reconciliation cannot rebuild a CEO review. The parent's acceptance ends those Holds.

## Acceptance Reads Declarations, Not Prose

`evaluateAutomaticAcceptance` decides from the delivery's Action Intent declaration (`payload.actions`): `performed` or `requested` goes to CEO Office, `considered` and `[]` do not. The text patterns remain only for artifacts written before the contract, which declare nothing. Do not add a keyword to that list to fix a routing problem — describing a risk is not taking one, which is the bug the list caused (ADR 0027).

## A Failed Verdict Is Reworked, Not Retried

`applyVerificationRework` decides what follows a verdict that did not pass and records it in `verification_reworks`, one row per failed report. The round budget (`MAX_VERIFICATION_ROUNDS`) counts those rows, not Agent Runs — every run in a rework loop succeeds, so the Bounded Recovery counter never sees it. Rework reaches a producer as prompt feedback read at dispatch, never as a dependency on its verifier (ADR 0026).

## A Delivery Is Finalized In One Place

`finalizeDelivery` (`src/runtime/deliveryFinalization.ts`) decides where a valid delivered artifact leaves its task: held, verification failed, CEO review, Founder Decision, internal delivery, or accepted. The scheduler and proof recovery both call it. A path that delivers an artifact and then chooses a status or Hold itself is a second copy of this policy — the shape of the bug where a recovered subtask skipped its Founder Decision (ADR 0024). Acceptance and completion recording are idempotent, so reaching the same delivery twice writes nothing twice.

## A Verdict Is Asked Of One Predicate

A Business Artifact can be `valid` and still record a Verification Verdict that is not `passed` — a well-formed report that the verified work failed. `isVerificationSatisfied` (core) is the only question every success path asks: `isReviewableBusinessArtifact`, CEO Office's pending projection, CEO approval, dependency readiness, parent aggregation, and `acceptTaskBusinessArtifact`, which throws rather than accept. A new acceptance or readiness path must ask it too. Checking `validationStatus` alone is how a failed verification report was one click from approval (ADR 0023).

A verifier never runs in a producer's workspace. `resolveRunWorkspace` follows only `context` dependencies; `prepareVerificationInputs` gives the verifier snapshots in its own workspace, and a snapshot that cannot be made blocks the run before it starts. A snapshot's files come from `BusinessArtifact.deliveryWorkspacePath` — the workspace the runtime captured that delivery from — not from the producer task, which carries an artifact workspace only when a department split it. A delivery recording no workspace fails the handoff by name; handing over the artifact record alone let verifiers report on files they never got (ADR 0023).

Never read a runtime fact back from an agent's workspace. What a verifier was handed lives in `verification_handoffs`; a manifest in the workspace is a file the agent can rewrite. And decide verification duty from the task's dependencies, never from the artifact kind the agent filed — both were real bypasses (ADR 0023).

## Glossary

- **Task Transition Seam**: `applyTaskTransition`. The only writer of task status. _Avoid_: status update, state setter.
- **Held Task Status**: A status meaning "stopped, waiting on something". See the table above. _Avoid_: blocked, paused.
- **Runtime-settled**: A task status the runtime will not advance on its own (`complete`, `blocked`, `failed`, `cancelled`). Used by quiescence and Objective Stage Change. It is not the same as core Terminal (`complete`, `cancelled`): `blocked` and `failed` still carry Holds and affordances.
- **Resume Affordance**: An action an actor can take right now to move a stopped task forward, computed server-side and checked by the route that performs it. _Avoid_: button, enabled action, recovery eligibility.
- **Standing Reconciliation**: A repair pass that runs on every read and is never marked as done, because the drift it repairs can recur. Contrast with the one-time, marker-guarded migration passes. _Avoid_: migration, backfill.
- **Hold Release**: Answering one Task Hold and letting the remaining open Holds decide whether the task may move. Distinct from unblocking a task, which only happens when the released Hold was the last one. _Avoid_: unblock, resume.
- **Agent Capability Grant**: The set of Runtime Capabilities one Agent Run is launched with, resolved by `resolveAgentCapabilityGrant` from the task's needs and the company's Permission Mode. Passed to the adapter as launch flags; never inherited from the operator's machine. _Avoid_: permission mode, allowed tools, sandbox.
- **Structured Output Contract**: A JSON Schema on `AgentRunRequest.outputSchema` that the CLI enforces on the reply. Held as an object by the runtime; each adapter converts to its CLI's shape. _Avoid_: output format instruction, prompt rule.
- **Artifact Syntax Repair**: One narrow agent run that fixes the syntax of a Business Artifact file that does not parse, checked by the runtime for unchanged content before it is kept. _Avoid_: JSON repair, retry.
- **Grant Refutation**: Rejecting an Environment-Blocked Blocker because it names a capability the run actually held. The runtime is the authority on what it granted, so that claim is checkable rather than testimony. _Avoid_: blocker validation, agent distrust.
