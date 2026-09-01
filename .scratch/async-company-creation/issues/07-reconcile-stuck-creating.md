# 07: Reconcile Stuck Creating Companies

**What to build:** If the local runtime stops during Company Creation, the next startup or company state read should detect stale `creating` companies whose active attempt exceeded its budget plus grace, mark them `creation_failed`, and make them explicitly retryable.

**Blocked by:** 06: Handle Creation Failure And Explicit Retry.

**Status:** ready-for-agent

- [ ] A creating company with an active attempt inside its allowed budget remains `creating`.
- [ ] A creating company whose active attempt exceeded its effective timeout plus grace becomes `creation_failed`.
- [ ] Stuck reconciliation records a failed Creation Attempt outcome and failed Company Event.
- [ ] Stuck reconciliation runs on local runtime startup or company state reads.
- [ ] Reconciliation is idempotent and does not append duplicate failure events for the same stuck attempt.
- [ ] The dashboard shows the reconciled failure state and retry action after refresh.
