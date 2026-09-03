# 03: Founder Decision — declaration and acceptance gating

**What to build:** When a completing agent makes a choice on a strategic business decision whose first value is the founder's to set, it declares that choice rather than letting its pick stand as direction. A deliverable carrying such an unresolved **Founder Decision** does not auto-accept and is not sent to manual CEO review — it records a Task Completion Event describing the choice and stops. Company state then shows the pending Founder Decision with its options and the agent's recommendation, and downstream work stays blocked until the founder decides (resolution itself is ticket 04).

Governing decision: `docs/adr/0017-ceo-office-surfaces-business-outcomes.md`. Spec: `.scratch/ceo-office-business-outcomes/spec.md`.

**Blocked by:** 01 (Deterministic Automatic Acceptance), 02 (Task Outcome Summary)

**Status:** ready-for-agent

- [ ] `NextStepItemType` gains `founder_decision` (core type and zod schema). The source task's Business Artifact stays kind `deliverable`.
- [ ] A `StrategicDecisionKind` enum is added to core with a zod schema. Seed values: `target_market`, `product_direction`, `mvp_type`, `pricing_model`, `launch_target`. Playbook-neutral; extended only by code change.
- [ ] Business Artifact parsing reads an optional `open_decisions` array; each entry has `decisionKind`, `options` (more than one, each with a label and its trade-offs), `recommendation`, and `rationale`.
- [ ] Entries whose `decisionKind` is in the enum and that carry more than one option are kept; entries with an unknown `decisionKind` are dropped silently; a malformed entry on a known `decisionKind` is a structural validation failure.
- [ ] Each kept entry becomes a `founder_decision` Next Step Item on the Task Completion Event and is projected into a first-class `FounderDecision` object (mirroring the Human Action projection): identity, source Task Completion Event, task, owning department, `decisionKind`, ordered options with trade-offs and a recommended flag, rationale, status (`pending` / `resolved` / `returned`), resolved option, resolved timestamp, blocked task ids.
- [ ] A completed deliverable declaring one or more kept `open_decisions` is not auto-accepted and not routed to manual review: the runtime emits the Task Completion Event (carrying the `founder_decision` items and the Task Outcome Summary) and stops. Downstream dependency readiness continues to block on the non-accepted upstream.
- [ ] The task prompt instructs the agent to declare, in `open_decisions`, any choice it makes on a Strategic Decision Kind, and that such a choice is the founder's to make.
- [ ] Company state serializes the projected `founderDecisions`.
- [ ] Tests: the acceptance seam for parsing, gating, and drop/fail behaviour; the company-state / CEO attention projection seam for the `FounderDecision` projection and serialization — following existing prior art.
