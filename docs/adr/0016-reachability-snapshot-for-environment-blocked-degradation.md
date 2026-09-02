---
status: accepted
---

# Reachability Snapshot backstops environment-blocked screenshot degradation

## Context

ADR 0015 §3 lets a render-evidence task degrade to a deliverable when the agent submits an Environment-Blocked Blocker carrying a runtime-checkable URL claim and the runtime `fetch`es that URL for a 2xx response. The URL points at a **Local Prototype Server** the agent started inside the task workspace (`python3 -m http.server`, or a framework preview server). Nothing in the runtime owns that process. It is routinely gone by the time the claim is checked, so `verifyEnvironmentBlockerClaim` returns `fetch_failed`, the blocker stands, and the task fails `no_proof` again even though the prototype was reachable moments earlier (observed in the `matt` test company across three runs). Issue #3.

Two facts narrow the design space:

- **Verification only ever runs inside a runtime-controlled Agent Run.** `readEnvironmentBlockerClaim` / `verifyEnvironmentBlockerClaim` are called from one place — the scheduler, guarded by `agentResult.status === "complete"`. `/refresh`, `/recover`, and replan do not verify; they re-queue, and a fresh Agent Run verifies. So at the moment of verification the runtime always has the agent's own same-run `server_validation` record available. The live fetch is racing the teardown of a process the current run just started.
- **`local-url` proof is never fetched.** It is stored with `verifiedAt: null` (`proof.ts`). An accepted upstream `local-url` deliverable attests only that an agent typed a URL and the task was accepted — not that the route ever served.

Options weighed (issue #3): (1) runtime-managed dev server, (2) accept a prior accepted `local-url` proof, (3) re-serve on demand from the upstream workspace, (4) accept the agent's capture-time `server_validation` snapshot.

## Decision

**Layered confirmation for the environment-blocked degradation path.** `verifyEnvironmentBlockerClaim` confirms the claim in order of evidence strength and records which path won:

1. **Live check** — fetch the claimed URL; a 2xx response confirms with `validationLimits.verifiedVia: "runtime_url_check"`. Unchanged from ADR 0015 §3, now best-evidence rather than the only path.
2. **Reachability Snapshot** — when the URL cannot be reached *at all* (the fetch throws, or there is no URL), confirm against the `server_validation.http_status` 2xx that the agent recorded **in the same runtime-controlled Agent Run**, as `validationLimits.verifiedVia: "capture_time_snapshot"` with that status. A live *non-2xx* response is an affirmative "the route is broken now" signal and keeps the blocker — the snapshot backstops the absence of a live signal, never a contradicting one.

A dead Local Prototype Server is no longer a task failure when a same-run Reachability Snapshot shows the route served.

**Trust boundary (amends ADR 0015 §3's "never accepted on the agent's word").** A `server_validation` snapshot is Proof-grade **only when it was produced inside a runtime-controlled Agent Run** — the same basis on which the runtime already trusts agent-recorded command output, file contents, and diffs (ADR 0008, Proof Recovery). The runtime enforces this by reading the claim only after `agentResult.status === "complete"`, from that run's workspace. Recognition of the blocker shape stays generous; confirmation stays strict.

**Not adopted:** runtime-managed dev-server supervision (option 1) and re-serve-on-demand (option 3) — both add machinery to win a race that exists only because of a redundant re-fetch, and option 3 is fragile for any prototype past a raw static directory. Option 2 as stated is too weak (`local-url` is unverified); the upstream URL task remains the right owner of "does this route exist," and strengthening its collector to record its own Reachability Snapshot at capture time is a reasonable follow-up but is out of scope here.

## Consequences

- The degradation path no longer depends on an unmanaged child process still listening. It depends on evidence captured while the runtime controlled the agent.
- A screenshot task degrades to a deliverable when the prototype was genuinely reachable during the run even if the agent's `http.server` has since exited. Test: a `fetchImpl` that throws (dead server) plus a business artifact carrying `server_validation.http_status: 200` degrades the task, with `verifiedVia: "capture_time_snapshot"`.
- `validationLimits.verifiedVia` now distinguishes how a degraded task was confirmed, so CEO review can weigh a snapshot-confirmed deliverable differently from a live-confirmed one.
- Scenario not covered: an agent records a 2xx early, then the Local Prototype Server dies (not just exits — stops answering) before the blocker is emitted, and the URL is unreachable at verification. The snapshot still confirms. Accepted because render evidence is optional (ADR 0015 §1), the caveat surfaces it, and the upstream URL artifact is the authority on route existence.
- Known limitation: the run-scoping guard is `agentResult.status === "complete"` plus reading from the run's workspace. It does not detect a `business-artifact.json` left behind in a *reused* Artifact Workspace by an earlier producer task — the same staleness the live-fetch URL resolution already carries. Tightening this (a per-run write marker) is deferred until reused-workspace runs actually produce a screenshot blocker.
