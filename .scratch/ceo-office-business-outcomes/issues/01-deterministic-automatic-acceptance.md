# 01: Deterministic Automatic Acceptance

**What to build:** A valid internal deliverable is accepted automatically, with no CEO click, even when the CEO Agent labelled its task `medium` and the artifact carries no opt-in marker. Acceptance runs through the existing shared business acceptance path, so the Task Completion Event, Next Step Routing, dependency cascade, key-result updates, and scheduler wake all behave exactly as manual CEO approval does today. The only remaining route into manual CEO review is a deliverable whose text trips a tightened external-or-sensitive risk-pattern scan; ordinary product-brief and research-report language must not trip it.

Governing decision: `docs/adr/0017-ceo-office-surfaces-business-outcomes.md`. Spec: `.scratch/ceo-office-business-outcomes/spec.md`.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The Automatic Acceptance evaluation no longer checks for an `autoAccept` / `acceptance` payload marker and no longer early-returns on task risk level; risk level is not consulted in the acceptance decision.
- [ ] A valid, current, unreviewed `deliverable` / `final_report` Business Artifact on a `medium`-risk task, with no marker, is automatically accepted: artifact status becomes accepted, task completes, a Task Completion Event is recorded, and direct downstream dependencies cascade.
- [ ] The risk-pattern scan is narrowed from broad single words to precise phrases covering public launch, deployment to production, custom/production domains, Search Console/sitemap submission, connecting ad or affiliate accounts, spending/billing/subscriptions, legal or compliance exposure, user or personal data exposure, credentials/API keys/secrets, account permissions or OAuth grants, and irreversible external actions.
- [ ] A deliverable whose text involves one of those sensitive actions is still routed to manual CEO review.
- [ ] Regression fixtures: representative ordinary product-brief and research-report text does not trip the scan and is auto-accepted.
- [ ] Manual CEO approval of a risk-pattern-caught deliverable still works unchanged.
- [ ] Blocked and needs-replan outcomes still create Task Completion Events without unlocking ordinary downstream dependencies.
- [ ] Tests at the task business acceptance seam (`apps/server/src/runtime` business acceptance + automatic acceptance + scheduler), following the existing business-acceptance and scheduler dispatch tests as prior art.
