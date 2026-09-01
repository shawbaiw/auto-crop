# 05: Route Human Actions With Confirmation Evidence

**What to build:** Next Step Routing should create Human Actions for work Auto-Crop cannot complete itself. Human Actions should keep their owner department, appear in CEO Office and the owning Department Workspace, state which downstream tasks they block, and allow the user to submit confirmation evidence that the runtime can verify where possible.

Blocked by: 03: Accept Structured Next Step Items From Business Artifacts.

Status: ready-for-agent

- [x] Human Action Next Step Items become Human Actions in Company State Snapshot.
- [x] Human Actions include owner department, blocked downstream tasks, confirmation requirements, and display copy.
- [x] Human Actions appear in CEO Office and in the owning Department Workspace.
- [x] User confirmation requires evidence rather than only a done checkbox.
- [x] A narrow deterministic verifier can accept at least one evidence kind, such as a reachable URL or present configuration value.
- [x] Confirmed Human Actions unblock only downstream tasks whose dependency contract requires that action.
- [x] Unrelated preparation work remains eligible while a Human Action blocks launch-dependent work.
