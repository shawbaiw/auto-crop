# 07: Render The Timeline As A Broadcast Card Feed

**What to build:** The CEO Office timeline becomes a feed of summary cards — newest at the bottom, pushing history up — where each card shows the point of the item and clicking it opens a modal with the full detail. Action-bearing cards look distinct from routine ones.

**Blocked by:** 04 (Add A Briefing To The Founder Decision Contract), 05 (Project Execution Reports Only For Accepted Outcomes), 06 (Localize Timeline Enums And Runtime Strings)

**Status:** complete

- [x] Each timeline item renders as a summary card: type tag + department + relative time + title + one key line (conclusion / reason / purpose / decision ask). The 3–7 row `VideotexKeyValue` table is no longer shown inline.
- [x] Clicking a card opens a modal with the full item detail, options, and evidence, plus a "查看任务详情" affordance. The modal mirrors what `ceo-task-review-detail` shows (including its collapsed evidence section). No new route.
- [x] The type tag carries semantic weight: `decision_request` / `approval_request` / `blocked_issue` render as action-state (accent stripe); `execution_report` / `stage_change` / `decision_resolution` / `final_report` render quiet.
- [x] The `task_brief` card renders as one announcement line: task title + one-sentence purpose (`task.descriptionText`, company locale) + objective / key result on one line + dependency task titles. Purpose-source label, metric name, and target value move into the modal.
- [x] Founder vision is shown once in the company-state header, not on each `task_brief` card.
- [x] The Decision card leads with `briefing`; options and rationale are secondary.
- [x] Cards keep ascending (oldest-first) order; a newly arrived card briefly highlights, gated by `prefers-reduced-motion`.
- [x] The `line()` helper's untranslated marker (issue 03) is visible on cards and in the modal.
- [x] The Outcomes / CEO Pending / Attention sections are left in place.
- [x] Tests in `App.test.tsx` / `DepartmentWorkspace` tests: a card renders as a summary; the detail table, options, and evidence appear only after the card is activated; action-bearing cards are distinguishable; the `task_brief` card is one line; the Decision card leads with the briefing.

**Implementation note:** Styling work in `styles.css` for the card, tag, modal, and highlight. `CeoOfficeItemSummary` already carries the data; this is a render/interaction change, not a projection change.
