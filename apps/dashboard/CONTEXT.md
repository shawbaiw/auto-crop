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

## Server State Is Never Synthesised

A task's `holds` and `affordances` were computed for the status the server saw. When a live event moves a task locally, that pairing is broken, so the client **drops** them rather than carrying them onto a status they were not computed for — otherwise the board offers an action for a state the server never offered it for.

They return with the next snapshot that agrees: `adoptSettledTasks` takes the server's version of a task only where its status matches what the live stream already showed. Where the two disagree the snapshot is simply in flight, and mixing the two is the same fabrication in a subtler place.

## Glossary

- **Resume Affordance**: see the root `CONTEXT.md`. In this app it is the *only* input to whether an action is shown. _Avoid_: enabled state, eligibility rule.
- **Inline Affordance**: a Resume Affordance drawn on the task row, as opposed to one a dedicated surface owns. _Avoid_: task button.
- **Settled Task**: a task whose server snapshot agrees with the status the live stream last showed, and whose server-computed fields may therefore be adopted. _Avoid_: fresh task, synced task.
