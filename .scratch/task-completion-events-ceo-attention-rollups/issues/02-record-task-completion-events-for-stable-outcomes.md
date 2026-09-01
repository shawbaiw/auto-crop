# 02: Record Task Completion Events For Stable Outcomes

**What to build:** When a task reaches a stable business state, Auto-Crop should record a Task Completion Event that explains what changed in company state. The event should be included in Company State Snapshot and should cover accepted, blocked, failed-to-review, and needs-replan outcomes without treating raw Agent Output, Proof capture, or schema validation alone as completion.

Blocked by: 01: Extract Shared Business Acceptance Path.

Status: ready-for-agent

- [ ] Accepted manual CEO approval creates a Task Completion Event.
- [ ] Blocked review-ineligible Business Artifacts create Task Completion Events.
- [ ] Needs-replan outcomes create Task Completion Events.
- [ ] Task Completion Events include company, task, owning department, stable outcome, Business Artifact when available, and timestamp.
- [ ] Company State Snapshot returns Task Completion Events in stable order.
- [ ] Raw Proof capture without stable business outcome does not create a Task Completion Event.
