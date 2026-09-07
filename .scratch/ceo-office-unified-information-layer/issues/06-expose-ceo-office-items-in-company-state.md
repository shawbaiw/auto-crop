# 06: Expose CEO Office Items In Company State

**What to build:** Company state includes the projected CEO Office Items while preserving the existing fields used by current CEO Office sections. The dashboard can begin consuming the unified projection without breaking Outcomes, CEO Pending, Attention Rollups, Human Actions, Wait States, review details, or Final Founder Reports.

**Blocked by:** 03 (Project Task Brief And Execution Report Timeline Items), 04 (Project Action-Bearing CEO Office Items), 05 (Project Stage Changes, Final Reports, And Decision Resolutions)

**Status:** ready-for-agent

- [ ] Company state includes the projected CEO Office Items.
- [ ] Existing company state fields remain available for backward-compatible UI sections.
- [ ] Repeated company state reads return stable item IDs and stable ordering.
- [ ] API tests cover the presence of CEO Office Items and preservation of existing fields.
- [ ] Tests include at least one company state fixture where ordinary completions appear in the Timeline but not in CEO Pending.

