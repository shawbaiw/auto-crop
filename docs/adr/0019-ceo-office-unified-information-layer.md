# CEO Office Uses A Unified Information Layer

Status: accepted

Auto-Crop will introduce a unified CEO Office Item layer so CEO Office reads as a chronological business control surface rather than a set of disconnected queues and raw department reports. The first implementation should project CEO Office Items from existing company facts instead of adding a `ceo_office_items` table, and it must stay test-case neutral: SEO keyword research, pricing, MVP definition, launch planning, and other task types all flow through the same item model.

## Decision

CEO Office should lead with company state, then pending actions, then a global timeline of macro business events. The timeline contains only large-grain CEO-readable nodes: Task Briefs, action-bearing items such as decision requests or approval requests, Execution Reports, Objective Stage Changes, Decision Resolutions, Wait States, Human Actions, Blocked Issues, and Final Founder Reports. It must not show low-level execution events such as task started, retrying, proof capture, workspace paths, raw logs, or agent diagnostics.

Every task should produce at least two CEO Office Items: a Task Brief before execution and an Execution Report after completion. Execution-time action items are optional and appear only when the task actually needs CEO or founder attention. A task that completes with both an Execution Report and a Founder Decision should show the Execution Report first, then the decision request, so the user sees the business conclusion before being asked to choose. When a decision is resolved, CEO Office should update the original pending item and also add a Decision Resolution to the timeline so the history remains readable.

Routine task completions no longer mean "silent" in the sense of disappearing from CEO Office. They stay out of CEO Pending and do not create high-priority interruption, but they must enter the CEO Office Timeline as Execution Reports so the user can understand what each task did, why it mattered, what gap remains, and what should happen next.

## Considered Options

- **Patch the current SEO test case UI:** rejected because it would repeat the current failure mode. The next pricing, MVP, customer research, or launch test case would need another patch.
- **Make CEO Office Pending contain every task event:** rejected because CEO Pending would become an unread report inbox instead of a list of actions that need CEO movement.
- **Persist every CEO Office Item in a new table immediately:** rejected for the first implementation because Task, Task Completion Event, Founder Decision, Human Action, Wait State, CEO Attention Rollup, and Final Founder Report already provide durable facts. A projection avoids duplicated state and synchronization bugs.
- **Keep existing sections separate with no unified layer:** rejected because each UI section would keep making its own interpretation of CEO-facing information, preventing consistent behavior across task types.

## Consequences

The implementation should add a projection seam such as `projectCeoOfficeItems(companyState)`, then have CEO Office, CEO Pending, and CEO decision surfaces consume that shared result. The shared projection is the abstraction under test; any display rule that depends on SEO-specific labels, task titles, artifact subtypes, or a single fixture is a design failure.

New Execution Reports should be structured around `conclusion`, `visionImpact`, `remainingGap`, and `recommendation`, with compatibility for older Task Outcome Summary prose. Task Briefs may initially be projected from the existing task definition plus department assessment state, but the intended direction is for department assessment to produce structured brief fields later.

The first implementation remains a projection. If future CEO Office features need user-authored standalone items, durable read/acknowledgement state, cross-session manual edits, or retention of items whose source facts can disappear, a `ceo_office_items` record can be reconsidered.
