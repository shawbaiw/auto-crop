# 01: Deterministic Automatic Acceptance

**What to build:** A valid internal deliverable is accepted automatically, with no CEO click, even when the CEO Agent labelled its task `medium` and the artifact carries no opt-in marker. Acceptance runs through the existing shared business acceptance path, so the Task Completion Event, Next Step Routing, dependency cascade, key-result updates, and scheduler wake all behave exactly as manual CEO approval does today. The only remaining route into manual CEO review is a deliverable whose text trips a tightened external-or-sensitive risk-pattern scan; ordinary product-brief and research-report language must not trip it.

Governing decision: `docs/adr/0017-ceo-office-surfaces-business-outcomes.md`. Spec: `.scratch/ceo-office-business-outcomes/spec.md`.

**Blocked by:** None (can start immediately)

**Status:** done (commit fa9a119)

- [x] The Automatic Acceptance evaluation no longer checks for an `autoAccept` / `acceptance` payload marker and no longer early-returns on task risk level; risk level is not consulted in the acceptance decision.
- [x] A valid, current, unreviewed `deliverable` / `final_report` Business Artifact on a `medium`-risk task, with no marker, is automatically accepted: artifact status becomes accepted, task completes, a Task Completion Event is recorded, and direct downstream dependencies cascade.
- [x] The risk-pattern scan is narrowed from broad single words to precise phrases covering public launch, deployment to production, custom/production domains, Search Console/sitemap submission, connecting ad or affiliate accounts, spending/billing/subscriptions, legal or compliance exposure, user or personal data exposure, credentials/API keys/secrets, account permissions or OAuth grants, and irreversible external actions.
- [x] A deliverable whose text involves one of those sensitive actions is still routed to manual CEO review.
- [x] Regression fixtures: representative ordinary product-brief and research-report text does not trip the scan and is auto-accepted.
- [x] Manual CEO approval of a risk-pattern-caught deliverable still works unchanged.
- [x] Blocked and needs-replan outcomes still create Task Completion Events without unlocking ordinary downstream dependencies.
- [x] Tests at the task business acceptance seam (`apps/server/src/runtime` business acceptance + automatic acceptance + scheduler), following the existing business-acceptance and scheduler dispatch tests as prior art.

Notes for later issues: the `Automatic Acceptance` glossary entry and ADR 0017 describe the Phase-A end state (no Founder Approval action, no unresolved Founder Decision). `evaluateAutomaticAcceptance` does not yet enforce those two conditions — issues 03/04 add the Founder Decision gate. `isApprovableBusinessArtifact` in `apps/server/src/api/routes.ts` is still a private near-duplicate of `isReviewableBusinessArtifact`; fold it in when the CEO review route is next touched.
