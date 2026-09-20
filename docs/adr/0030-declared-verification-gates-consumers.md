# A Declared Verification Gates Everyone Who Consumes The Output

Status: accepted

## Context

ADR 0025 made every planned task declare its verification duty, and ADR 0023 made a failed verdict impossible to accept. Both bind the verifier and the verified task. Nothing bound the *other* consumers.

A real smoke showed what that costs. The plan declared a verifier for the MVP brief, and made the prototype depend on the brief. The verifier could not read the brief and returned `inconclusive`; the brief's verification stopped there — and the prototype was built from that brief anyway, because its own dependency was satisfied the moment the brief was accepted. Three tasks ran on an input the plan itself said was not yet checked. Ordering saved an earlier run of the same shape: the scheduler happened to dispatch the verifier first.

The plan had stated the relationship. `verification.targetTaskKeys` is a declaration that this output is not usable until someone has checked it; the runtime read that edge only from the verifier's side.

## Decision

**`resolveDependencyReadiness` treats a declared verification as part of what makes an output consumable.** A task depending on a producer that some task is declared to verify is ready only when that verifier's current verdict passed, judged the artifact the consumer is about to consume, and is still current.

- **The verdict must name the artifact being consumed.** A verdict that judged an earlier version does not release a consumer of the reworked one — the same version binding ADR 0026 already applies to the verifier.
- **The verifier is exempt from its own gate.** It consumes its target to judge it.
- **A verifier that is blocked or needs replanning blocks its target's consumers by name**, so the Hold points at the verification that has stopped rather than at the producer that finished.
- It lives in the one readiness resolver (ADR 0024), so dispatch, the dependency cascade, parent aggregation and Hold reconciliation cannot disagree about it.

## Considered options

- **Make the plan add the dependency.** The CEO Agent would list the verifier in every consumer's `dependsOnTaskKeys`. It puts the same fact in two places and fails silently when a planner forgets one — the reason ADR 0025 rejected inference in the first place, mirrored.
- **Gate at acceptance instead of readiness.** Refusing to accept an unverified producer would stop consumers too, but it would also park a delivery that is fine until its verifier gets a turn, and it confuses "this output is finished" with "this output has been checked".
- **Leave it to ordering.** What the first smoke relied on by accident.

## Consequences

- A plan's verification edge now has the effect a founder reading the plan would expect: nothing downstream proceeds on unchecked output.
- A stuck verification stops more of the company than before — deliberately. The way forward is the verifier's own Hold (rework, replan), not consuming past it.
- A verifier that is never dispatched parks its target's consumers. That is the same failure as any upstream that never delivers, and it surfaces as a named wait on the verifier.
- Known limitation: department-internal consumption is unchanged. A subtask's siblings are gated by the department's own Validate stage through `finalizeDelivery`, and the parent aggregates only when every stage is delivered.
- Known limitation: the gate is per declared verifier. A plan that declares no verifier for an output still lets consumers proceed — the plan's choice, now visible as one.
