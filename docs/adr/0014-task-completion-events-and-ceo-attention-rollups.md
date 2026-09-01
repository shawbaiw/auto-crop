# Task Completion Events And CEO Attention Rollups

Auto-Crop will move CEO Office away from a review-queue-centered operating model and toward a company-state model based on Task Completion Events, Next Step Routing, and CEO Attention Rollups. Every completed or blocked task should produce a durable business-state change that records department ownership, dependency impact, remaining Vision Gaps, and proposed Next Step Items, but only exceptions, decision points, Human Actions, cross-department impacts, goal-stage changes, and executive summaries should interrupt CEO Office.

## Considered Options

- **Notify CEO Office for every completed task:** maximizes visibility, but turns CEO Office into a noisy message stream and keeps the user in a low-leverage approval posture.
- **Keep CEO Review as the default gate for every deliverable:** preserves the earlier safety model, but makes routine internal handoffs depend on manual acceptance even when the runtime can validate the artifact and risk is low.
- **Only generate a Final Founder Report:** gives a clean end summary, but leaves the user blind while the company is moving, blocked, waiting, or requiring human action.
- **Use Task Completion Events with selective CEO Attention Rollups:** records every business-state change while surfacing only the situations that need executive awareness or intervention.

## Decision

Use Task Completion Events with selective CEO Attention Rollups.

A task should generate a Task Completion Event only after it reaches a stable business state such as accepted, blocked, or needs replan. Agent Output, raw Proof, and schema validation alone are not enough to create the company-state event.

Low-risk internal tasks may use Automatic Acceptance when their Business Artifact is valid, aligned with accepted direction, and does not require Founder Approval. Automatic Acceptance must not be allowed for public launch, account permissions, spending, legal or compliance exposure, direction changes, user data exposure, or irreversible external actions.

Every Task Completion Event may include Next Step Items. Next Step Routing decides whether each item becomes a queued downstream task, Human Action, CEO Decision Queue item, Wait State, downstream handoff, or Vision Gap. Departments may propose these next steps, but runtime validation and routing decide their effect on company state.

CEO Office should lead with Founder Vision and objective progress, critical dependency chains, Human Actions, exceptions, and Vision Gaps. Review Queue, Decision Queue, and Blocked Queue remain available, but they are not the primary shape of the CEO home view.

Human Actions belong to the relevant business owner, such as a department, while also appearing in CEO Office. They block only downstream work that truly depends on them. When a user completes a Human Action, the user should provide confirmation evidence that the runtime can verify when possible before unblocking dependent work.

Wait States should create timed checks or monitoring work where possible, so long-running external delays such as indexing, review, response collection, or traffic observation do not disappear from the operating model.

## Consequences

CEO Office becomes an executive control surface rather than a universal approval inbox. The user should be able to understand which department owns each task, how tasks depend on each other, what changed when a task completed, what remains to reach the Founder Vision, and which next actions require human intervention.

This revises the practical meaning of earlier CEO Review decisions. CEO Review remains necessary for risky, exceptional, external, or direction-changing work, but it is no longer the default path for every valid low-risk deliverable. Downstream dependency readiness must therefore support both manual CEO Review Decisions and Automatic Acceptance as accepted business states, while preserving Founder Approval for high-impact actions.

Final Founder Reports should be generated when the Founder Vision is achieved, blocked, or enters a long-running Wait State, not merely when a set of tasks reaches `complete`.
