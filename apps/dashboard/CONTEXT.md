# Dashboard Context

Browser UI, the API client, and how server state becomes something a founder can act on. System-wide vocabulary lives in the root `CONTEXT.md`; the runtime rules behind task state live in `apps/server/CONTEXT.md`.

Read this before adding any control that acts on a task, or any rule that decides whether a control appears.

## The Dashboard Decides Nothing About Eligibility

Whether an action is available to a task is computed server-side and arrives on the task as `affordances`. The dashboard reads that list. It does not consult `status`, `failureReason`, or anything else to reach its own conclusion.

This is not a style preference. The board used to keep its own predicates, and they drifted from the server's guards in both directions:

- `isRecoverableTask` refused recovery for `blocked` tasks the API accepted, so those tasks showed no way forward;
- the old Operations page listed replannable tasks as `status === "needs_replan"`, which misses a task at the Bounded Recovery ceiling — `blocked`, with replanning as its **only** way forward. That task had no button anywhere in the product.

An eligibility rule kept on both sides is a rule that drifts. See ADR 0020.

### Every affordance declares where it is rendered

`ui/tasks/affordanceControls.ts` maps every `TaskAffordanceKind` to one of:

- `inline` — drawn on the task row itself, with its label keys and the handler that performs it;
- `surface` — drawn by a named surface elsewhere (the forms in a CEO Office or department page item's dialog, the new plan on a task's Execution Trace, the task execution panel);
- `unsurfaced` — nothing draws it, **and the reason is written down**.

The registry is exhaustive over the union, so a new affordance cannot be added without someone deciding where it appears. `unsurfaced` is a legitimate answer but never a silent one: an affordance nothing renders because nobody thought about it is how the replan gap survived; one that nothing renders because someone argued for it is a decision. `affordanceControls.test.ts` enforces all three shapes.

Adding an `inline` affordance also requires a handler keyed in `TaskStatusAction`, which is a compile error to omit.

## Workbench Commands Are Decided Once

Company-level founder commands (Create Company, Pause, Resume and Stop Operating) are defined in `components/workbench/workbenchCommands.ts`, each with its label key, whether it can run now, and its handler. Every place that offers one reads it from there: the Workbench header, Settings, and the two keyboard shortcuts (Cmd+Enter in the Onboarding Wizard, Shift+Cmd+K for Pause and Resume). A surface lays commands out; it never decides on its own when one is available. Page navigation is the rail's, not a command. Task actions are not commands either: they come from server affordances, as above.

## A Response Is Checked Where It Becomes Typed

`api/client.ts` is the one place a server response becomes typed data, so it checks there that each body has the fields the dashboard reads from it straight away (a task's id and status, a company snapshot's company, departments and tasks). A body without them, from a server of another version or another service on the port, fails as a request error that the caller already shows. It does not travel on and crash a render. Fields the check does not name, including ones a newer server adds, pass through untouched.

A render crash that still happens stays on the Workbench page it happened on: `PageErrorBoundary` shows a retry there, keeps the rail and header usable, and starts afresh when the founder opens another page.

## Server State Is Never Synthesised

A task's `holds` and `affordances` were computed for the status the server saw. When a live event moves a task locally, that pairing is broken, so the client **drops** them rather than carrying them onto a status they were not computed for — otherwise the board offers an action for a state the server never offered it for.

They return with the next snapshot that agrees: `adoptSettledTasks` takes the server's version of a task only where its status matches what the live stream already showed. Where the two disagree the snapshot is simply in flight, and mixing the two is the same fabrication in a subtler place. A task the live view has never seen, such as one a CEO Intake planned, has nothing to disagree with, so the snapshot's version is adopted as it is.

### The event stream does not replay

An event published while no subscriber is connected is gone. The dashboard subscribes only after `Create Company` returns, and a fast CEO Agent can finish the blueprint before that, so `company_creation_completed` reaches no one and the Creation Loading Page would wait forever. The same happens to task events during a reconnect: the board keeps showing a task as `queued` that the server has already blocked.

Two rules follow:

- **The stream is per company, not per view.** Changing views must not close and reopen it — every reopen is a window in which events are lost. Callbacks read the current view from a ref instead of resubscribing.
- **Every (re)connection resyncs from a snapshot.** `subscribeEvents` reports each open, and the App adopts the server's state there wholesale. This is the one place a snapshot overrides the live stream rather than waiting to agree with it (see Settled Task): after a gap, the live view is the one known to be stale. A reload for any later event bumps the revision and supersedes it.

## CEO Office Acts In One Place

Every CEO Office card opens its item in one dialog, and that dialog holds the only form for acting on it: a review, a decision, or a Human Action. Timeline cards and "Needs you" cards open the same dialog, so the founder never meets two forms for one decision that could disagree. A review form appears only while the server offers `ceo_review_decision`; when it does not, the dialog says so and points to the department page.

"Needs you" is defined once, in `deriveNeedsYou`: open reviews, decisions and Human Actions, new plans to confirm, and tasks only the founder can move. The CEO Office column, its phone summary and the rail's counts all read it, so they cannot disagree. A task waits on the founder when its server affordances include a founder action no other card covers and no runtime action — read from the affordances, never from a status rule of the dashboard's own. A task that already has a card is not listed again: a new plan offered beside a Human Action is that action's way out. Waits, and stuck tasks the runtime can still handle, are counted in the overview but not listed.

The composer sends a CEO Intake. Its card comes from the server's projection, read back at once, never synthesised in the browser.

## A Trace Folds Only When Its Result Is Settled

Each task on a department page is an Execution Trace built from the runtime's progress steps; a run starts where execution starts again. A trace is open while its task runs, waits or is stuck, and folds to a summary only when the task is complete or in review, keeping its result in view. A founder's own open or fold holds while the page is open; live updates never reset it. Task actions stay mounted when a trace folds, so the outcome of an action just taken stays in view.

## Modern UI Direction

New dashboard UI uses a modern workbench direction: clean surfaces, low visual noise, soft borders, restrained shadows, and product-specific affordances. Tailwind is the default styling path for new components. shadcn/Radix-derived components are acceptable for basic accessible interactions, but the product-defining surfaces stay owned by Auto-Crop components. See `docs/adr/0001-modern-dashboard-ui-foundation.md`.

Cumora is the primary reference for overall page language. DeepWiki is a focused reference for the Composer Input, not a page-wide glass effect. The first migration slice is Company Picker, Onboarding, and Creation Loading. shadcn configuration and generated UI components belong inside `apps/dashboard` until another frontend exists.

The modern theme uses shadcn-compatible token names and Geist as the dashboard's primary sans font; monospace remains reserved for code, paths, terminal-adjacent UI, and literal values. `src/components/ui` is reserved for low-level primitives; product components belong in semantic component areas. New complex accessible interactions should prefer shadcn/Radix-derived primitives over hand-rolled menu, dialog, select, and popover behavior. Onboarding remains a step-by-step wizard, and Creation Loading becomes a calm progress surface.

Implement the redesign foundation before page migration: dashboard-local Tailwind/shadcn setup, modern tokens, primitive UI, and a reusable modern AppShell skeleton. The first page migration is done only when the pages keep their behavior, stop rendering CRT/Retro UI, and pass desktop/mobile visual inspection. Light theme ships first; dark mode waits. Existing localization rules still apply.

Creation Loading shows a Creation Trace: an ordered projection of Creation Progress Events that makes the wait feel active without inventing work the server did not report. It uses centered step cards over a soft blurred background; the current step breathes through border or shadow emphasis, completed steps use a green checked dot, pending steps stay muted, and completion fades into the Workbench after a brief visible completed state. Failed creation keeps the trace context: completed steps stay green, the failed step is highlighted with the failure reason and retry/abandon actions, and retry starts a fresh visible trace. The narrow-screen layout keeps the same vertical card model with tighter spacing. It may borrow the visual rhythm of Execution Trace, but it must not call itself one or fake task activity before departments and tasks exist.

After creation the founder works in one Workbench with three-column pages; its structure, CEO Office tabs, Execution Trace behaviour, status colours and the founder term list are in `docs/adr/0002-one-workbench.md`. Never show an internal term from that list's left column.

Assemble the foundation manually rather than relying on shadcn CLI defaults. Start with Button, Input, Textarea, and Label primitives only; add heavier Radix-backed primitives when a migrated page needs them. A delivered page slice must not mix modern and Retro UI, even though temporary mixing is acceptable while developing that slice.

## Glossary

- **Resume Affordance**: see the root `CONTEXT.md`. In this app it is the *only* input to whether an action is shown. _Avoid_: enabled state, eligibility rule.
- **Inline Affordance**: a Resume Affordance drawn on the task row, as opposed to one a dedicated surface owns. _Avoid_: task button.
- **Settled Task**: a task whose server snapshot agrees with the status the live stream last showed, and whose server-computed fields may therefore be adopted. _Avoid_: fresh task, synced task.
- **Modern Dashboard UI**: The target dashboard visual system: Tailwind-first, modern workbench surfaces with low visual noise and no CRT treatment. It replaces Retro UI as the direction for new dashboard work. _Avoid_: CRT redesign, retro skin.
- **Composer Input**: The product-specific natural-language input surface for founder prompts and CEO Office direction. It may use translucent or backdrop-blur styling, but it is not a generic textarea. _Avoid_: Textarea, chat box.
- **Primitive UI Component**: A low-level reusable control under `src/components/ui`, typically shadcn/Radix-derived, that provides accessible interaction or basic visual structure. _Avoid_: product component, page section.
- **Product Component**: A dashboard-specific component named after Auto-Crop workflow language, such as workbench, composer, company flow, task flow, or CEO Office. Product Components compose Primitive UI Components but own product meaning. _Avoid_: primitive, shadcn component.
