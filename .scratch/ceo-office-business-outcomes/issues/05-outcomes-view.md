# 05: Outcomes view and CEO Office surface

**What to build:** CEO Office leads with an **Outcomes view**: recent Task Completion Events grouped by objective, each showing its Task Outcome Summary in business language, with unresolved Founder Decisions pinned at the top as the actionable items — options, trade-offs, recommendation, and working pick / return controls. The Review, Decision, and Blocked queues remain reachable but sit below the overview. The founder can see which downstream work is held by an outstanding decision of theirs.

Governing decision: `docs/adr/0017-ceo-office-surfaces-business-outcomes.md`. Spec: `.scratch/ceo-office-business-outcomes/spec.md`.

**Blocked by:** 02 (Task Outcome Summary) — done; 04 (Founder Decision — resolution) — done. Unblocked; 06 (Upgrade reconciliation) is also done, so the whole ADR 0017 series except this ticket has landed.

**Status:** ready-for-agent

- [ ] The dashboard holds `taskCompletionEvents` in app state (currently fetched but unused) and passes them and the projected `founderDecisions` to the CEO surface.
- [ ] The Outcomes view lists recent Task Completion Events grouped by objective, each rendering its Task Outcome Summary and dependency impact in business language, not raw status.
- [ ] Unresolved Founder Decisions are pinned at the top of the Outcomes view with their options, trade-offs, and recommendation, and pick / return controls that call the resolution endpoint; picking closes the item and reflects that the deliverable was accepted.
- [ ] The Review, Decision, and Blocked queues move below the Outcomes overview and remain reachable and functional. Approve and return controls stay in the review detail flow, not duplicated elsewhere.
- [ ] The CEO Task Dependency Graph shows a "waiting on decision" state for a downstream node blocked on an unresolved Founder Decision.
- [ ] The agent-activity log renders `automatic_acceptance`, `founder_decision`, and `ceo_review_decision` events as readable business language instead of a generic status label.
- [ ] Tests at the dashboard CEO Workspace seam (App-level flows, CEO Workspace, dependency graph), following existing CEO Pending / dependency-graph / App-flow tests as prior art.
