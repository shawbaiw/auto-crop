# 03: Accept Structured Next Step Items From Business Artifacts

**What to build:** Departments and agents should be able to propose structured Next Step Items in Business Artifact payloads. Runtime validation should record accepted proposals on the Task Completion Event while ignoring or rejecting invalid structure. Freeform next-step prose must not directly mutate company state.

Blocked by: 02: Record Task Completion Events For Stable Outcomes.

Status: ready-for-agent

- [ ] Business Artifact payloads may include structured Next Step Item proposals.
- [ ] Valid Next Step Item proposals are copied into the Task Completion Event.
- [ ] Invalid Next Step Item proposals are reported without crashing task completion.
- [ ] Freeform text does not create routable Next Step Items.
- [ ] Next Step Items carry type, owner department where applicable, related task or artifact, dependency impact, severity or priority, evidence requirements when applicable, and display copy.
- [ ] Company State Snapshot exposes recorded Next Step Items through Task Completion Events.
