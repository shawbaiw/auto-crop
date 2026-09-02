Status: ready-for-agent

# Task Completion Events And CEO Attention Rollups

## Problem Statement

CEO Office is currently shaped around pending review. Departments finish work, submit checkable results, and then CEO Office manually approves or returns the task. This makes the company feel busy but fragmented: the founder can see that a task is waiting for review, but not what changed in the company, which department owns the result, which downstream work depends on it, what still blocks the Founder Vision, or what the next action should be.

The review-centered model also breaks down when Auto-Crop cannot do every required action itself. For example, an agent can build a website or Web product, but a person may still need to deploy it, connect an account, configure a domain, pay for a service, or submit something through a third-party dashboard. Today, when the task ends, CEO Office does not reliably surface the Human Action, downstream dependency impact, or Vision Gap needed to keep moving toward the broader objective.

## Solution

CEO Office becomes a company-state control surface instead of a universal approval inbox. Task outcomes produce Task Completion Events after the task reaches a stable business state such as accepted, blocked, or needs replan. Those events record the task's owning department, Business Artifact, dependency impact, remaining Vision Gaps, and structured Next Step Items.

CEO Office still contains review, decision, and blocked queues, but its home view leads with Founder Vision and objective progress, CEO Attention Rollups, Human Actions, critical dependency chains, Wait States, and Vision Gaps. Routine low-risk internal deliverables can use Automatic Acceptance after deterministic Business Artifact validation and risk checks. Risky, external, public, direction-changing, irreversible, or user-account-dependent work continues to require CEO Review, CEO Decision, or Founder Approval.

Next Step Routing turns each Next Step Item into the correct follow-up surface: a queued downstream task, Human Action, CEO Decision Queue item, Wait State, downstream handoff, or Vision Gap. This makes task completion answer the founder's real question: what changed, what depends on it, and what must happen next for the Founder Vision to progress?

## User Stories

1. As a founder, I want CEO Office to show the current state of the Founder Vision, so that I can understand whether the company is moving toward the outcome I asked for.
2. As a founder, I want each completed task to explain which department owned it, so that I can understand responsibility without opening every department.
3. As a founder, I want each completed task to explain which objective or key result it serves, so that task activity does not feel detached from the company plan.
4. As a founder, I want each completed task to explain what Business Artifact was produced, so that I can inspect the concrete result behind the summary.
5. As a founder, I want each completed task to explain what changed in the dependency chain, so that I can see who can move next.
6. As a founder, I want each completed task to identify remaining Vision Gaps, so that I do not mistake task completion for business success.
7. As a founder, I want CEO Office to avoid notifying me for every ordinary task completion, so that I am not buried in low-value messages.
8. As a founder, I want CEO Office to interrupt me for exceptions, decisions, Human Actions, cross-department impact, goal-stage changes, and executive summaries, so that my attention goes where it matters.
9. As a founder, I want related attention items grouped by Founder Vision, objective, or dependency chain, so that I see the business situation instead of isolated notifications.
10. As a founder, I want a Human Action list in CEO Office, so that I know what Auto-Crop cannot do without my help.
11. As a founder, I want Human Actions to keep their department ownership, so that I know whether Engineering, Growth, Product, Finance, or another department is responsible for the business action.
12. As a founder, I want a Human Action to say which downstream work it blocks, so that I can judge urgency.
13. As a founder, I want a Human Action to block only the downstream work that truly depends on it, so that unrelated preparation work can continue.
14. As a founder, I want to submit evidence when I complete a Human Action, so that Auto-Crop can verify and continue the workflow.
15. As a founder, I want Auto-Crop to verify Human Action evidence when possible, so that a mistaken "done" click does not unlock downstream work incorrectly.
16. As a founder, I want deployment-like work to become a Human Action when Auto-Crop cannot deploy itself, so that a built artifact does not silently stall before launch.
17. As a founder, I want public launch, spending, account permissions, credentials, legal exposure, user data exposure, and irreversible external actions to require explicit attention, so that the system does not overstep.
18. As a founder, I want direction changes to remain gated by Founder Approval, so that departments cannot silently pivot away from the accepted plan.
19. As a founder, I want low-risk internal handoffs to continue automatically, so that CEO Office does not become a bottleneck for routine work.
20. As a founder, I want automatically accepted work to remain visible in the company state, so that automation does not reduce accountability.
21. As a founder, I want to see automatically accepted work in dependency chains and summaries, so that I can audit what happened later.
22. As a founder, I want to mark an automatically accepted result for attention or follow-up, so that I can intervene without forcing every result through manual review.
23. As a founder, I want to request rework or replanning when an accepted result looks strategically wrong, so that the company can correct course without deleting history.
24. As a founder, I want Wait States to be visible, so that external delays such as search indexing, third-party review, customer response, or traffic observation do not disappear.
25. As a founder, I want Wait States to create timed checks where possible, so that Auto-Crop comes back to the fact instead of relying on me to remember.
26. As a founder, I want CEO Office to show the critical path through departments, so that I can see where the company is bottlenecked.
27. As a founder, I want CEO Office to show which department is waiting on which upstream task, so that dependency problems are obvious.
28. As a founder, I want CEO Office to show cross-department handoffs, so that I can understand how Research, Product, Engineering, Growth, and other departments are collaborating.
29. As a founder, I want CEO Office to show blocked dependency chains, so that I know whether one Human Action or failed artifact is holding back the broader objective.
30. As a founder, I want CEO Office to show task chains grouped around objectives, so that the company reads as progress toward goals rather than a pile of tasks.
31. As a founder, I want the Review Queue to remain available, so that risky or manually gated deliverables can still be approved or returned.
32. As a founder, I want the Decision Queue to remain available, so that decision requests and direction change requests do not mix with ordinary review.
33. As a founder, I want the Blocked Queue to remain available, so that invalid, stale, missing, blocked, or drifted artifacts are visible.
34. As a founder, I want CEO Office home to prioritize attention rollups over queues, so that the first screen answers "what needs executive awareness?"
35. As a founder, I want a Final Founder Report when the Founder Vision is achieved, so that I can understand the final result and department contributions.
36. As a founder, I want a Final Founder Report when the Founder Vision becomes blocked, so that I can understand what stopped and what to do next.
37. As a founder, I want a Final Founder Report when the Founder Vision enters a long-running Wait State, so that I know why the company is waiting rather than failing.
38. As a founder, I want final reports to include actual outputs, department inputs, dependency chain, drift status, remaining gaps, and recommended next step, so that I do not reconstruct the story from logs.
39. As a department lead, I want my department's completed work to generate structured next-step proposals, so that downstream coordination does not depend on freeform notes.
40. As a department lead, I want my department's Human Actions to remain visible in my department flow, so that my workspace still reflects what I own.
41. As a department lead, I want low-risk accepted work to flow downstream automatically, so that routine handoffs do not wait for manual CEO review.
42. As a department lead, I want high-risk work to route to CEO Office or Founder Approval, so that my department does not accidentally publish, spend, or change direction.
43. As a department lead, I want returned or blocked next steps to include structured reasons, so that I know whether to rework, replan, wait, or ask for a decision.
44. As a downstream department, I want to receive accepted upstream Business Artifacts through the existing dependency handoff model, so that my work starts from trusted inputs.
45. As a downstream department, I want Human Actions and Wait States to be represented as dependency facts, so that I do not run on missing external prerequisites.
46. As a downstream department, I want unaffected preparation tasks to continue even when another downstream branch is waiting on a Human Action, so that the company keeps moving.
47. As a CEO Agent, I want company state to include Task Completion Events and Next Step Items, so that future planning can use the actual business trajectory.
48. As a CEO Agent, I want Automatic Acceptance to leave durable records, so that I can reason from accepted business states rather than hidden automation.
49. As a CEO Agent, I want Vision Gaps to be explicit, so that I can generate useful follow-up plans instead of assuming the last task achieved the Founder Vision.
50. As a developer, I want task acceptance to have one runtime seam, so that CEO Review and Automatic Acceptance do not duplicate dependency cascade behavior.
51. As a developer, I want Company State Snapshot to project CEO Attention Rollups, Human Actions, Wait States, and Vision Gaps, so that dashboard code does not reconstruct business state ad hoc.
52. As a developer, I want Next Step Routing to be structured and validated, so that freeform agent text cannot directly mutate company state.
53. As a developer, I want Business Artifact validation to remain the semantic gate, so that Automatic Acceptance does not turn into unchecked completion.
54. As a developer, I want external launch and account actions to remain under Founder Approval, so that the system respects user control and local safety.
55. As a developer, I want existing task dependency graph behavior reused where possible, so that the CEO Office projection builds on real Task Dependencies.
56. As a developer, I want tests to verify API and dashboard behavior, so that the feature is protected at user-visible seams.

## Implementation Decisions

- Respect ADR 0014 as the governing decision for this work.
- Preserve the separation between Proof and Business Artifact. Raw Agent Output and Proof are not enough to create downstream-consumable business state.
- Introduce Task Completion Event as the durable company-state record created after a task reaches a stable business state: accepted, blocked, or needs replan.
- Do not generate Task Completion Events from Agent Output alone, Proof capture alone, or schema validation alone.
- Add persisted state for Task Completion Events. Each event should identify company, task, owning department, related objective or key result when known, current Business Artifact when present, stable outcome, dependency impact, Vision Gaps, Next Step Items, and timestamp.
- Treat blocked and needs-replan outcomes as valid Task Completion Event sources. A blocked workflow should still tell CEO Office what changed and what is needed next.
- Introduce Next Step Item as structured state, not as a freeform summary. A Next Step Item should include type, owner department where applicable, related task or artifact, dependency impact, severity or priority, evidence requirements when applicable, and display copy.
- The first Next Step Item categories are automatic downstream task, Human Action, CEO decision, Wait State, downstream handoff, and Vision Gap.
- Add Next Step Routing as runtime behavior after Task Completion Event creation. Routing decides whether each Next Step Item becomes a queued task, Human Action, CEO Decision Queue item, Wait State, dependency handoff, or Vision Gap projection.
- Departments and agents may propose Next Step Items in Business Artifact payloads, but runtime validation and routing decide whether those proposals affect company state.
- Extend Business Artifact capture or validation to tolerate structured next-step proposals in payloads without making freeform text authoritative.
- Add Automatic Acceptance for low-risk internal tasks whose current Business Artifact is valid, reviewable, aligned with accepted direction, and does not require Founder Approval.
- Automatic Acceptance should set the Business Artifact review status to accepted, move the task to complete, create a Task Completion Event, route Next Step Items, and trigger dependency cascade behavior through the same acceptance path used by manual CEO Review approval.
- Automatic Acceptance must be forbidden for public launch, account permissions, spending, legal or compliance exposure, direction changes, user data exposure, credentials, and irreversible external actions.
- Automatic Acceptance should also be forbidden when the Business Artifact is missing, invalid, stale, blocked, drifted, not reviewable, or not current.
- Automatic Acceptance should be conservative for medium-risk and high-risk tasks. The first implementation may restrict it to low-risk tasks only.
- CEO Review remains the path for risky, exceptional, external, direction-changing, or manually gated deliverables.
- Founder Approval remains required for high-impact business decisions and external actions, including changing selected market or keyword, changing MVP type, publishing publicly, submitting Search Console or sitemap actions, spending money, and connecting ads, affiliate accounts, API keys, or credentials.
- Replace duplicated post-approval behavior with a shared business acceptance module or equivalent high-level seam. Manual CEO approval and Automatic Acceptance should both call this seam.
- The business acceptance seam owns accepted artifact status changes, task completion, Task Completion Event creation, Next Step Routing, dependency cascade triggering, key result updates, and scheduler wake requests.
- Dependency Readiness should continue to require accepted, current, valid Business Artifacts. It should not care whether acceptance came from manual CEO Review or Automatic Acceptance.
- Add acceptance provenance to persisted state or projection so CEO Office can distinguish manual CEO approval from Automatic Acceptance.
- Preserve CEO Review Decision records for manual approve and return actions. Do not fake CEO Review Decisions for Automatic Acceptance unless a later ADR chooses that audit model.
- Add a durable or projected CEO Attention Item model for events that should interrupt or prominently surface in CEO Office.
- CEO Attention Items should be created or projected for exceptions, decision points, Human Actions, cross-department impacts, goal-stage changes, blocked Vision Gaps, strategic Vision Gaps, and executive summaries.
- Do not create CEO Attention Items for every ordinary Task Completion Event.
- Add CEO Attention Rollups as a Company State Snapshot projection. Rollups group related CEO Attention Items by Founder Vision, objective, or dependency chain, while preserving department ownership and affected tasks.
- CEO Attention Rollups should summarize the situation, owner department, downstream departments, current blocker, relevant Human Actions, Wait States, Vision Gaps, and recommended next action.
- Add Human Action as a structured Next Step Item surface. Human Actions belong to a department or business owner while also appearing in CEO Office.
- Human Actions should include confirmation requirements, such as URL, account state, receipt, approval note, configuration value, or other evidence.
- Add a user-facing Human Action confirmation flow. The user submits evidence rather than only clicking "done".
- Add runtime verification hooks for Human Action confirmation where possible. Verification can be deterministic and narrow in the first version, such as checking that a URL is reachable or that a required value is present.
- A confirmed Human Action should become a Task Completion Event, Business Artifact, dependency state update, or unblocking event as appropriate.
- Human Actions should block only downstream tasks whose dependency contract requires that action. Other preparation work should remain eligible.
- Add Wait State as a structured Next Step Item surface for external delays or observation windows.
- Wait States should not be treated as failures.
- Wait States should support timed checks or monitoring work where possible. The first implementation can model the check as a future queued task or a scheduler-recognized wake condition, whichever fits the existing runtime best.
- Vision Gaps should be projected from Task Completion Events and Next Step Items. They should be classified as informational, blocking, or strategic.
- Blocking Vision Gaps should appear in CEO Attention Rollups and Final Founder Report inputs.
- Strategic Vision Gaps should require CEO awareness and may create decision or replan work.
- Informational Vision Gaps can appear in context without interrupting the user.
- Update Company State Snapshot to include Task Completion Events, CEO Attention Rollups, Human Actions, Wait States, Vision Gaps, and acceptance provenance.
- Keep task lists, proof, Business Artifacts, CEO Review Decisions, dependency edges, and task progress events in Company State Snapshot.
- Update the existing founder report projection so final reports are based on accepted outputs, department contributions, dependency state, Vision Gaps, Human Actions, Wait States, blocked tasks, and drift status.
- Generate or expose a final founder-facing report when the Founder Vision is achieved, blocked, or enters a long-running Wait State. Do not rely only on all tasks being complete.
- Update CEO Office dashboard home to lead with Founder Vision and objective progress, CEO Attention Rollups, Human Actions, critical dependency chains, Wait States, and Vision Gaps.
- Keep Review Queue, Decision Queue, and Blocked Queue available below or beside the executive overview.
- Reuse the existing CEO Task Dependency Graph as the base for critical dependency chain display.
- The dependency graph should continue to render parent tasks by default and should not expose department subtasks unless the user drills down.
- The dependency graph should highlight active blockers, Human Actions, Wait States, review-required tasks, and cross-department handoffs.
- CEO Office should show department ownership for every task, Human Action, Vision Gap, Wait State, and rollup item.
- Department Workspace should show department-owned Human Actions and relevant blocked or waiting states, while CEO Office shows them in global context.
- Do not remove CEO Pending Review. Reposition it as one queue inside the CEO Office control surface.
- Do not duplicate approve and return controls inside the dependency graph. Keep manual review actions in the review detail flow.
- Add user actions for CEO Office to inspect an automatically accepted result, mark attention, create follow-up work, pause or replan a chain, or request review where the existing runtime supports those actions.
- Avoid destructive "undo history" semantics. Corrections should be represented through direction change, replan, return, pause, or follow-up task records.
- Use existing retro dashboard primitives and current workspace layout conventions.
- Use user-facing labels that avoid raw internal statuses where possible. CEO Office should read as business situation, not database state.
- Do not hard-code the SEO-to-website-to-Google-to-monetization example. Use it as a test scenario, but keep Task Completion Events, Next Step Items, Human Actions, Wait States, and Vision Gaps playbook-neutral.

## Testing Decisions

- Tests should verify external behavior at the highest useful seam. Prefer API responses, persisted runtime state, Company State Snapshot projections, dependency cascade outcomes, and dashboard user flows over private helper tests.
- The first testing seam is task business acceptance. Existing CEO Review Decision behavior and new Automatic Acceptance behavior should both exercise the same externally observable outcome: accepted Business Artifact, completed task, Task Completion Event, routed Next Step Items, dependency cascade updates, and scheduler wake when downstream work becomes queued.
- Task business acceptance tests should cover manual CEO approval still working for review items.
- Task business acceptance tests should cover Automatic Acceptance for a low-risk internal valid deliverable.
- Task business acceptance tests should cover Automatic Acceptance refusing public launch, spending, account permissions, credentials, direction changes, user data exposure, legal exposure, irreversible external actions, invalid artifacts, stale artifacts, blocker artifacts, and drifted artifacts.
- Task business acceptance tests should cover dependency readiness accepting downstream work regardless of whether upstream acceptance came from manual CEO Review or Automatic Acceptance.
- Task business acceptance tests should cover blocked and needs-replan outcomes creating Task Completion Events without unlocking ordinary downstream dependencies.
- Task business acceptance tests should cover Human Actions blocking only the downstream tasks that depend on the action.
- Task business acceptance tests should cover Wait States not being treated as task failures.
- Task business acceptance tests should use existing patterns from runtime tests for Business Artifact validation, dependency readiness, dependency cascade, scheduler, task recovery, and CEO Review Decisions.
- The second testing seam is Company State Snapshot and CEO Office projection. Tests should verify that the company state includes Task Completion Events, CEO Attention Rollups, Human Actions, Wait States, Vision Gaps, dependency edges, and acceptance provenance.
- Company State Snapshot tests should verify that ordinary task completions are recorded without becoming CEO Attention Items.
- Company State Snapshot tests should verify that exceptions, decision points, Human Actions, cross-department impacts, goal-stage changes, blocking Vision Gaps, and strategic Vision Gaps appear in CEO Attention Rollups.
- Company State Snapshot tests should verify rollups group by Founder Vision, objective, or dependency chain and preserve department ownership.
- Company State Snapshot tests should verify founder report input includes accepted outputs, blocked tasks, Human Actions, Wait States, Vision Gaps, and drift status.
- Company State Snapshot tests should use existing route tests around the state endpoint as prior art.
- The third testing seam is Dashboard CEO Workspace. Tests should verify the founder sees the executive overview before the review queue.
- Dashboard tests should verify CEO Attention Rollups render the business situation, department ownership, downstream impact, and recommended next action.
- Dashboard tests should verify Human Actions appear in CEO Office and in the owning Department Workspace.
- Dashboard tests should verify Human Action confirmation asks for evidence and reflects verification outcome where the backend exposes it.
- Dashboard tests should verify Wait States appear as waiting or monitoring states, not as failures.
- Dashboard tests should verify Vision Gaps render with informational, blocking, and strategic severity.
- Dashboard tests should verify critical dependency chains highlight blockers and cross-department handoffs.
- Dashboard tests should verify Review Queue, Decision Queue, and Blocked Queue remain available after the new overview is added.
- Dashboard tests should verify approval and return controls remain in review detail, not duplicated in graph nodes.
- Dashboard tests should use existing dashboard tests for Department Workspace, CEO Pending, CEO Task Dependency Graph, and App-level flows as prior art.
- Smoke tests should include a playbook-neutral scenario where a valid low-risk task auto-accepts and unblocks downstream work.
- Smoke tests should include a scenario where a built Web artifact creates a Human Action for deployment and blocks only launch-dependent SEO or indexing work.
- Tests should not assert internal helper names, graph layout pixel positions, exact rollup sorting beyond user-visible priority rules, or private implementation order.

## Out of Scope

- Do not build a full durable CEO Review Request table as part of this spec.
- Do not build a full durable CEO Reassignment Request table as part of this spec.
- Do not replace all task statuses with separate execution, review, and business status columns.
- Do not add an AI semantic judge for all Business Artifacts.
- Do not make every Next Step Item into a task.
- Do not automatically perform public deployment, Search Console submission, ad setup, account connection, paid purchase, legal action, or credential provisioning.
- Do not remove Founder Approval for high-impact decisions or external actions.
- Do not infer dependencies from task titles, task order, progress text, or freeform next-step prose.
- Do not show department subtasks in CEO Office dependency graph by default.
- Do not turn the dependency graph into an editable graph.
- Do not add drag-and-drop task ownership or dependency editing.
- Do not remove CEO Review, CEO Decision, or Blocked queues.
- Do not delete or rewrite the existing CEO Review Decision audit trail.
- Do not hard-code SEO, Google, website deployment, subscriptions, ads, affiliate marketing, or any one playbook into the core model.
- Do not require the first implementation to support every possible Human Action verifier.
- Do not require Wait States to integrate with external calendars, cron services, or third-party monitoring systems in the first version.

## Further Notes

This spec intentionally changes the operating model rather than only rearranging the dashboard. The desired product feeling is that the founder can understand the company as a moving system: which departments own the work, how tasks depend on one another, what changed when work completed, where human intervention is required, and what remains before the Founder Vision is achieved.

The most important implementation discipline is to keep Business Artifact acceptance as the semantic gate. Automatic Acceptance should reduce low-value CEO clicks, not weaken the handoff model that protects against invalid artifacts, blockers, stale proof, and direction drift.

The SEO-to-Web-product example should remain a proving scenario: after a website is built, the system should be able to say that deployment is a Human Action, SEO indexing is downstream of deployment, content preparation may continue, Search Console submission may require Founder Approval, and monetization remains a Vision Gap until the relevant launch and revenue steps exist.
