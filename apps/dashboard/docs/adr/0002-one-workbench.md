# One Workbench Replaces Three Company Pages

Status: proposed

After creation, the founder works in one Workbench. It has a left rail and three-column pages. It replaces Department Workspace, Company Operating Dashboard and Company Operations. The layout of CEO Office was chosen from three prototypes on the `prototype/ceo-office-layout` branch: conversation, three-column and inbox. The three-column layout won, because the things that need the founder stay in view while the conversation with the CEO stays central.

## Context

The three legacy pages overlapped. Counts of blocked work, Human Actions and Wait States appeared on all three. Task lists appeared on all three, but only one page had actions. Replan was split across pages: the founder requested a replan on the department view and confirmed it only on Operations. The Dashboard was mostly read-only. Its proof loaded only after a button press and covered only the first task, and its "Approvals" panel was a placeholder. A shared retro menu bar held commands that the new company lifecycle (ADR 0044) removes or moves.

## Decision

**Structure**

- **Left rail**, from top to bottom:
  - company name and status;
  - CEO Office;
  - each department, with its agent's icon, its pending count, and the agents working in it now;
  - Operations Diagnostics, Deliverables and Settings.
- **Header**: current location, Pause Operating or Resume Operating, and a quick language switch.
- **Removed**: the menu bar, the command palette, fullscreen, skins and CRT. Commands move to the rail, the header or Settings. The Agents menu and the manual Load Proof and Load Review commands go away, because Deliverables loads by itself.
- **Settings**:
  - the current company, with its status and Stop Operating, confirmed by typing the name;
  - all companies, with switching and Create New Company. The Onboarding Wizard opens with a Cancel button when a company already exists;
  - the interface language.
- **Startup**: the app opens the last company, then the most recently updated `active` company, then the Onboarding Wizard when no company exists. There is no company picker page.

**CEO Office (three columns)**

- **Center column**, with tabs:
  - **Timeline**: today's CEO Office Items. Each item links to its department page.
  - **Plan**: a React Flow canvas. Tasks are laid out left to right in dependency order and colored by department. It can be panned and zoomed.
  - **Outcomes**: every outcome card, the same cards that are posted into the timeline as each outcome completes. A stopped company opens on this tab, with the Final Founder Report pinned first.
- **Composer**: docked at the bottom of the center column. It is text only.
- **Right column, "Needs you"**: overview counts, then the cards for reviews, decisions, Human Actions and new plans. On narrow screens it becomes a collapsible section above the timeline.

**Department page (three columns)**

- **Header**: the department's responsibility, and its working agents with icon, current activity and elapsed time.
- **Center column**: each task as an Execution Trace:
  - the plan, which is the Execution Brief;
  - step conclusions;
  - tool calls with their results;
  - the final result.

  Hidden model reasoning is never shown. Replan is requested, reviewed and confirmed here. CEO Office shows a "Needs you" card that links to it, so `confirm_replan` moves from the Operations surface to this page.
- **Department composer**: sends a Department Intake (root ADR 0046).
- **Right column**: this department's "Needs you" items.

**Execution Trace interaction**

- A running run is expanded and updates live.
- The trace collapses only after the final result is settled, that is, when the server has checked the delivery and the task has left `running`. Then a summary line remains, such as "Completed · 5 steps", and the final result stays expanded.
- A failed or cancelled run does not collapse. It opens at the failing step, under a one-line error summary.
- A manual expand or collapse holds for as long as the page is open. Live updates never reset it, and a reload restores the default behavior.
- Only the latest run is shown in full. Earlier runs are one line each, with their outcome, and can be opened.
- Until root ADR 0047 lands, the trace shows only the runtime's progress steps.

**Visual language**

- **Task status colors**:
  - running: blue, with a spinner;
  - waiting: gray;
  - review: violet;
  - needs you or blocked: amber;
  - failed: red;
  - complete: green;
  - cancelled: gray with a strike-through.
- **Company status colors**:
  - active: green;
  - paused: amber;
  - stopped: gray;
  - creating: blue;
  - creation failed: red.
- **Raw codes and execution details** (phase, health, budget, stop reason) are collapsed under "Details" below a plain sentence.
- **Agent icons** come from Simple Icons. An agent without an icon shows a generic bot icon with its initials.
- **Copy** follows root ADR 0045.

**User terms**: internal terms are never shown. These are the founder words:

| Internal term | Founder words (zh / en) |
| --- | --- |
| Business Artifact, Task Deliverable | 交付文件 / deliverable file, or the specific thing, such as "产品简介" |
| Human Action | 需要你操作 / needs your action |
| Founder Decision | 需要你决定 / needs your decision |
| CEO review | 需要你审核 / needs your review |
| Replan Proposal | 新计划 / new plan |
| Wait State | 在等待 + what it waits for / waiting for … |
| Evidence surface | 交付物 / Deliverables |
| Operations surface | 运营诊断 / Operations Diagnostics |
| Hold, Affordance, Envelope | never shown |

**Delivery**

- The order is:
  1. P1, a refactor with no visual change, together with root ADR 0044;
  2. P2: the shell, Settings, Operations Diagnostics and Deliverables;
  3. P4 CEO Office, together with root ADR 0046 for CEO Intake;
  4. P4 department pages, together with Department Intake;
  5. P5, which removes CRT, skins, Retro UI and legacy CSS, together with root ADR 0047.
- Root ADR 0045 can land at any point.
- P2 delivered, as the founder decided on 2026-10-12:
  - The modern shell frames CEO Office and the department pages, whose content stays Retro UI until P4. Each page is either all legacy or all modern; the shell is a frame around them, and it has no CRT.
  - CRT, skins and fullscreen were removed in P2, ahead of P5. One fixed palette remains for the Retro components that P4 replaces.
  - Two keyboard shortcuts remain, Cmd+Enter in the Onboarding Wizard and Shift+Cmd+K for Pause and Resume, and both read the shared command model. The menu shortcuts went with the menu.
  - The Operating Dashboard was removed in P2. Its proof and reviews moved to Deliverables, and its task states moved to Operations Diagnostics.
  - New plans are requested and confirmed on Operations Diagnostics until P4 moves them to the department page.
  - At startup, with no remembered company, companies are ranked by status (`active`, `paused`, `creating`, `stopped`, then `creation_failed`) and then by most recent update. The Onboarding Wizard opens only when there is no company.
  - A failed creation is never a dead end. Its page offers Stop and abandon, confirmed by the company name, and a way back to another company, or Create New Company when there is none.
- P4 CEO Office delivered, as the founder decided on 2026-10-13:
  - The timeline shows the latest day with any item, which is today while the company works. Earlier days fold into one line each and open on demand, so the page is never empty.
  - "Needs you" has cards for reviews, decisions, Human Actions, new plans, and tasks only the founder can move ("Waits on you", opening the department page). Waits, and stuck tasks the runtime can still handle, are counted in the overview but have no card. The rail counts the same list.
  - The plan card names the goals and key results. The Plan tab shows them above the canvas, and a card is posted when a key result is met (root ADR 0048). The Outcomes tab lists what is still missing from the vision.
  - The Chinese name of CEO Office is "CEO 办公室".
  - A card opens the item in a dialog, which is the one place to act on it. Timeline cards and "Needs you" cards open the same dialog.
  - A new plan card links to Operations Diagnostics until the department page takes new plans.
  - Business content is shown in the company locale. The interface language changes only the chrome (root ADR 0013).
  - The founder's own message and the CEO's answer are their own timeline cards (root ADR 0046).
  - The Founder Vision is shown once, above the tabs.
- P4 department pages delivered, as the founder decided on 2026-10-13:
  - A trace stays open until its result is settled; a waiting task's trace is open too. A settled trace folds to "status · N steps" and keeps its result in view.
  - Department subtasks show inside their parent's trace with their status and actions.
  - A task's wait shows on its trace as "Waiting: reason, next check".
  - New plans are requested, reviewed and confirmed on the task's trace. Operations Diagnostics no longer lists them, and CEO Office's new plan cards open the task on its department page.
  - The department's "Needs you" is the CEO Office list filtered to the department.
  - The answers to a Department Intake are cards under the traces.
  - No Retro component, theme or CSS rule is left. The legacy element rules and tokens in `styles.css` remain for P5.
- The P4 steps run on a short-lived branch that is rebased often and merged once, so no page is delivered half legacy and half modern (ADR 0001).

## Considered Options

- **Migrate the three pages one to one.** Rejected: it rebuilds the Dashboard only to delete it.
- **Conversation layout** for CEO Office. Rejected: items that need the founder scroll away.
- **Inbox layout** for CEO Office. Rejected: it hides the CEO conversation behind a tab.
