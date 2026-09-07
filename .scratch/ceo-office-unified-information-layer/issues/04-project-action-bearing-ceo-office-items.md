# 04: Project Action-Bearing CEO Office Items

**What to build:** CEO-facing action items use the same CEO Office Item model as the Timeline. Founder Decisions, CEO review approvals, Human Actions, Wait States, and Blocked Issues are projected generically, and CEO Pending is derivable from action-bearing items rather than from separate queue-specific logic.

**Blocked by:** 01 (Define CEO Office Item Projection Contract)

**Status:** ready-for-agent

- [ ] Unresolved Founder Decisions project as action-bearing decision request items.
- [ ] Reviewable CEO approval or return gates project as action-bearing approval request items.
- [ ] Human Actions project as action-bearing CEO Office Items with their external action requirements.
- [ ] Wait States project as CEO Office Items but are not presented as failures.
- [ ] Blocked, retry-exhausted, missing-deliverable, needs-replan, and unrecoverable failure states project as Blocked Issue items.
- [ ] CEO Pending can be computed from action-bearing CEO Office Items while excluding ordinary Task Briefs and Execution Reports.
- [ ] Tests cover action-bearing projection and pending derivation without depending on a specific business topic.

