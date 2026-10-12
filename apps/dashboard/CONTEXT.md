# Dashboard Context

Browser UI, the API client, and how server state becomes something a founder can act on. System-wide vocabulary lives in the root `CONTEXT.md`; the runtime rules behind task state live in `apps/server/CONTEXT.md`.

Read this before adding any control that acts on a task, or any rule that decides whether a control appears.

## The Dashboard Decides Nothing About Eligibility

Whether an action is available to a task is computed server-side and arrives on the task as `affordances`. The dashboard reads that list. It does not consult `status`, `failureReason`, or anything else to reach its own conclusion.

This is not a style preference. The board used to keep its own predicates, and they drifted from the server's guards in both directions:

- `isRecoverableTask` refused recovery for `blocked` tasks the API accepted, so those tasks showed no way forward;
- the Operations page listed replannable tasks as `status === "needs_replan"`, which misses a task at the Bounded Recovery ceiling — `blocked`, with replanning as its **only** way forward. That task had no button anywhere in the product.

An eligibility rule kept on both sides is a rule that drifts. See ADR 0020.

### Every affordance declares where it is rendered

`ui/tasks/affordanceControls.ts` maps every `TaskAffordanceKind` to one of:

- `inline` — drawn on the task row itself, with its label keys and the handler that performs it;
- `surface` — drawn by a named surface elsewhere (the CEO Office cards, the Human Action panel, the Operations replan list);
- `unsurfaced` — nothing draws it, **and the reason is written down**.

The registry is exhaustive over the union, so a new affordance cannot be added without someone deciding where it appears. `unsurfaced` is a legitimate answer but never a silent one: an affordance nothing renders because nobody thought about it is how the replan gap survived; one that nothing renders because someone argued for it is a decision. `affordanceControls.test.ts` enforces all three shapes.

Adding an `inline` affordance also requires a handler keyed in `TaskStatusAction`, which is a compile error to omit.

## Workbench Commands Are Decided Once

Company-level founder commands (Create Company, Pause and Resume Operating, page navigation, the proof commands, fullscreen) are defined in `components/workbench/workbenchCommands.ts`, each with its label key, whether it can run now, and its handler. Every surface that offers one renders it from there: the legacy menu bar until P2, then the Workbench header. A surface lays commands out; it never decides on its own when one is available, so the two surfaces cannot disagree during the migration. Task actions are not commands: they come from server affordances, as above.

## Server State Is Never Synthesised

A task's `holds` and `affordances` were computed for the status the server saw. When a live event moves a task locally, that pairing is broken, so the client **drops** them rather than carrying them onto a status they were not computed for — otherwise the board offers an action for a state the server never offered it for.

They return with the next snapshot that agrees: `adoptSettledTasks` takes the server's version of a task only where its status matches what the live stream already showed. Where the two disagree the snapshot is simply in flight, and mixing the two is the same fabrication in a subtler place.

### The event stream does not replay

An event published while no subscriber is connected is gone. The dashboard subscribes only after `Create Company` returns, and a fast CEO Agent can finish the blueprint before that, so `company_creation_completed` reaches no one and the Creation Loading Page would wait forever. The same happens to task events during a reconnect: the board keeps showing a task as `queued` that the server has already blocked.

Two rules follow:

- **The stream is per company, not per view.** Changing views must not close and reopen it — every reopen is a window in which events are lost. Callbacks read the current view from a ref instead of resubscribing.
- **Every (re)connection resyncs from a snapshot.** `subscribeEvents` reports each open, and the App adopts the server's state there wholesale. This is the one place a snapshot overrides the live stream rather than waiting to agree with it (see Settled Task): after a gap, the live view is the one known to be stale. A reload for any later event bumps the revision and supersedes it.

## Modern UI Direction

New dashboard UI uses a modern workbench direction: clean surfaces, low visual noise, soft borders, restrained shadows, and product-specific affordances. Tailwind is the default styling path for new components. shadcn/Radix-derived components are acceptable for basic accessible interactions, but the product-defining surfaces stay owned by Auto-Crop components. See `docs/adr/0001-modern-dashboard-ui-foundation.md`.

Cumora is the primary reference for overall page language. DeepWiki is a focused reference for the Composer Input, not a page-wide glass effect. The first migration slice is Company Picker, Onboarding, and Creation Loading. shadcn configuration and generated UI components belong inside `apps/dashboard` until another frontend exists.

The modern theme uses shadcn-compatible token names. `src/components/ui` is reserved for low-level primitives; product components belong in semantic component areas. New complex accessible interactions should prefer shadcn/Radix-derived primitives over hand-rolled menu, dialog, select, and popover behavior. Onboarding remains a step-by-step wizard, and Creation Loading becomes a calm progress surface.

Implement the redesign foundation before page migration: dashboard-local Tailwind/shadcn setup, modern tokens, primitive UI, and a reusable modern AppShell skeleton. The first page migration is done only when the pages keep their behavior, stop rendering CRT/Retro UI, and pass desktop/mobile visual inspection. Light theme ships first; dark mode waits. Existing localization rules still apply.

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
