# 07: Outcomes view shows the brief next to the outcome, and marks what's new

**What to build:** The founder can read each Outcomes entry as "you asked for X → here's what came back," and can see at a glance whether anything is new. Each Outcomes entry additionally shows the task's original description/objective next to its Task Outcome Summary (the 4-part Task Outcome Summary contract is unchanged — this is display only, pulling `task.description` already in state). A quiet "N new outcomes since your last visit" marker sits on the Outcomes view, and unseen state is shown on the Final Founder Report banner and on `goal_stage_change` rollups, all computed against a per-company last-seen timestamp in `localStorage`. Storage reads/writes are wrapped so a private window or cleared storage degrades to "nothing new" rather than erroring.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Each Outcomes entry renders the task description/objective alongside its Task Outcome Summary.
- [ ] A per-company `localStorage` last-seen timestamp, written on view; a "N new outcomes since your last visit" marker on the Outcomes view derived from it.
- [ ] Unseen affordance on the Final Founder Report banner and on `goal_stage_change` rollups from the same last-seen value.
- [ ] All `localStorage` access wrapped in try/catch; absent/blocked storage renders "nothing new" and does not throw.
- [ ] Tests — Seam 3 (`App.test.tsx`): entries show the description beside the summary; the marker reflects a stubbed last-seen value and clears after a visit; with no/blocked storage nothing-new is shown and no error is thrown.
