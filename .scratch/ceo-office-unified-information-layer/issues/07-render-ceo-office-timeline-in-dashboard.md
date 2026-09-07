# 07: Render CEO Office Timeline In Dashboard

**What to build:** CEO Office shows company state summary, CEO pending summary, and a global CEO Office Timeline in that order. The Timeline renders CEO Office Items generically by item type, keeps task details and diagnostics out of the default read, and preserves existing sections during the first pass.

**Blocked by:** 06 (Expose CEO Office Items In Company State)

**Status:** ready-for-agent

- [ ] CEO Office first screen presents company state summary, CEO pending summary, and CEO Office Timeline in order.
- [ ] Timeline renders Task Briefs, action items, Execution Reports, stage changes, Decision Resolutions, Wait States, Human Actions, Blocked Issues, and final reports generically from the CEO Office Item contract.
- [ ] Timeline does not show task started, retry, proof capture, workspace path, raw logs, or diagnostic-only execution events.
- [ ] Pending summary links to or highlights only action-bearing items.
- [ ] Existing Outcomes, Pending, Attention, Human Action, Wait State, and Final Founder Report sections remain available during this pass.
- [ ] Dashboard tests use SEO plus multiple non-SEO fixtures and fail if rendering depends on SEO-specific copy, task titles, or artifact subtypes.
