# 04: Founder Decision — resolution

**What to build:** The founder resolves a Founder Decision by picking one of its options, and that pick *is* the acceptance of the deliverable — there is no separate approve step. When a task surfaced more than one Founder Decision, the deliverable is accepted only once every one is resolved. The founder can instead reject every option and send the task back to the department with a reason. An unresolved Founder Decision surfaces prominently in CEO Office and its downstream tasks read as "waiting on decision", not as generic dependency waits.

Governing decision: `docs/adr/0017-ceo-office-surfaces-business-outcomes.md`. Spec: `.scratch/ceo-office-business-outcomes/spec.md`.

**Blocked by:** 03 (Founder Decision — declaration and acceptance gating)

**Status:** done

- [x] `TaskAcceptanceProvenance` gains `founder_decision` (core type and zod schema); `manual_ceo_review` and `automatic_acceptance` unchanged.
- [x] A new API endpoint accepts either a pick (`founderDecisionId`, chosen option) or a return (`founderDecisionId`, note, structured return reason).
- [x] On a pick: the resolution is recorded; the chosen value is written into the accepted artifact's payload under its `decisionKind`; when every Founder Decision on the task is resolved, the shared business acceptance path runs with `acceptanceProvenance = founder_decision`; resolved values flow downstream through the normal Task Completion Event, cascade, and handoff context.
- [x] On a return: the task goes back to the department through the existing CEO-review return path, recorded picks for that task are discarded, and a department progress event is written.
- [x] A resolution for a task no longer awaiting the decision returns `409`; a return without a reason is a validation error.
- [x] An unresolved Founder Decision produces a CEO Attention Item — `founder_decision` is added as a CEO Attention Rollup reason, preserving owning department and affected tasks. A resolved Founder Decision produces none.
- [x] Dependency readiness reports a "waiting on decision" state when a downstream block is due to an unresolved Founder Decision, distinct from an ordinary dependency wait. This is derived, not a new persisted task status.
- [x] Tests: the acceptance seam for pick-resolves-and-accepts, multi-decision gating, and return-discards-picks; the company-state / API seam for the endpoint status codes, the attention rollup reason, and the readiness state — following existing prior art.
