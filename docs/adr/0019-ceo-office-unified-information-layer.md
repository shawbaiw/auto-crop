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

## Amendment (2026-09-10): Broadcast Timeline

The CEO Office Broadcast Timeline work (`.scratch/ceo-office-broadcast-timeline/`) refines how the timeline items above are surfaced. The two-item guarantee still holds — every task produces a Task Brief before execution and an Execution Report after acceptance — but the shape of each changes:

- **The Task Brief is a one-line announcement**, not a key-value table. It carries only what is specific to the task: title, a one-sentence purpose, the objective / key result on one line, and dependency **task titles**. The founder vision moves to the company-state header and is shown once, not repeated on every card. Everything else moves into a click-to-expand modal.
- **The Decision card ("说明") is the post-task substance surface.** It is an enriched `decision_request` (not a new CEO Office Item type) carrying a `briefing` — what was explored, where the opportunity is, what is differentiated, the monetization angle and why the options exist — plus the options, trade-offs, recommendation, and rationale. While a completed task awaits the founder's decision, the Decision card stands alone: the founder sees it and not an Execution Report. A completed task with no strategic decision produces only a Report, never a Decision card.
- **Execution Reports are projected only for `accepted` completion outcomes.** A completion event that is `blocked`, `needs_replan`, `failed_to_review`, or `awaiting_founder_decision` is represented by its own card type (`blocked_issue`, or the `decision_request` for a pending founder decision), not by a misleading "Execution Report" for work the founder does not consider finished. When a founder resolves a decision and the shared acceptance seam records a second, `accepted` completion event, the accepted-only filter renders exactly one Execution Report with no dedup logic.

Cards arrive newest-at-bottom and push history up, like an agent's execution-step feed; each card is a summary that opens its full detail in a modal. Action-bearing cards (`decision_request`, `approval_request`, `blocked_issue`) render visually distinct from routine cards (`execution_report`, `stage_change`, `decision_resolution`, `final_report`).
