# Bounded task recovery and collectable-only proof schemas

## Context

A CEO-planned task with `proofSchemaId: "screenshot"` looped for roughly 30 minutes. The runtime has no screenshot collector, so every run ended `no_proof`; nothing capped re-queues from `POST /api/tasks/:id/refresh` and `POST /api/tasks/:id/recover`; the agent's honest `environment_blocked` blocker artifact was discarded because business-artifact capture is gated on `proof.length > 0`. The `retry_exhausted` failure reason was defined in the type but never wired to any runtime path.

## Decision

1. **Collectable Proof Schema invariant.** A proof schema may only reach CEO planning if the runtime has a collector for one of its accepted types, enforced by a registration test over every playbook's `proofSchemas` and a runtime filter in `ceoPrompt.ts`. `screenshot` is retired from the AI-SaaS playbook menu; screenshot-flavored tasks normalize to `test-output` with a `task_warning`, and the `screenshot` branch is removed from `isProofSchemaCompatible` so the normalization fires. The `screenshot` `ProofType` stays because a real PNG is still valid evidence when one exists.

2. **Bounded recovery ceiling.** After 3 failed agent runs a task terminates as `blocked` / `retry_exhausted` and is routed to the CEO Blocked Queue. `refresh`, `recover`, and the `ignoreCascadeEligibility` re-queue path in `dependencyCascade` refuse it. Only a new accepted upstream Business Artifact or a CEO replan resets the count.

3. **Environment-Blocked Blocker degradation.** An agent may submit a `blocker` of class `environment_blocked` carrying a `capability` and a runtime-checkable claim. For `capability: "browser_screenshot"` the runtime `fetch`es the declared URL (`target_url` -> `server_validation.url` -> a `local-url` proof); on a 2xx response the task degrades to a deliverable with a `validationLimits` caveat rather than failing. Business-artifact capture now runs whenever `.auto-crop/business-artifact.json` exists, not only when proof was collected.

## Consequences

- Render evidence (screenshots) is explicitly optional and is never accepted on the agent's word.
- The one existing stuck task is not migrated; it will exit via degradation or `retry_exhausted` on next interaction.
- A second environment-blocked capability is a small addition to one predicate and one verifier, not a plugin system.
