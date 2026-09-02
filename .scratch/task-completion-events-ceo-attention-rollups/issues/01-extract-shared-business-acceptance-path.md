# 01: Extract Shared Business Acceptance Path

**What to build:** Manual CEO approval should keep the same user-visible behavior, but its post-approval effects should run through one shared business acceptance path. That path is the future seam for Automatic Acceptance and owns accepting the current Business Artifact, completing the task, updating linked key result progress, recording the task event, running dependency cascade, and requesting scheduler wake when downstream work becomes queued.

Blocked by: None (can start immediately).

Status: resolved

- [x] Manual CEO approval still accepts the current valid Business Artifact and marks the task complete.
- [x] Manual CEO approval still rejects stale, missing-proof, and invalid-artifact approval attempts.
- [x] Manual CEO approval still updates linked key result progress when present.
- [x] Manual CEO approval still triggers dependency cascade and scheduler wake when downstream tasks become queued.
- [x] CEO return behavior remains unchanged and does not use the acceptance path.
- [x] The acceptance path is reusable by a later Automatic Acceptance caller without creating a fake CEO Review Decision.
