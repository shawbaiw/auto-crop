# 06: Route Wait States Into Timed Check-Ins

**What to build:** Next Step Routing should represent external delays as Wait States instead of failures or disappearing work. Wait States should be visible in Company State Snapshot and CEO Office, and they should support a first timed check-in path so Auto-Crop can revisit the fact later.

Blocked by: 03: Accept Structured Next Step Items From Business Artifacts.

Status: ready-for-agent

- [ ] Wait State Next Step Items become Wait States in Company State Snapshot.
- [ ] Wait States are not treated as task failures.
- [ ] Wait States include owner department where applicable, reason, related objective or dependency chain, and next check timing.
- [ ] CEO Office displays Wait States as waiting or monitoring states.
- [ ] The first timed check-in path can requeue or surface follow-up work when the wait expires.
- [ ] Final founder-facing report inputs can include long-running Wait States.
