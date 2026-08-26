# Bounded Recursive Dependency Cascade

Auto-Crop will extend Dependency Cascade after CEO approval from direct consumers to a bounded recursive traversal of downstream Task Dependencies. This extends ADR 0009 rather than replacing it: the first recursive version still treats CEO Office approval as the acceptance gate, keeps the scheduler as the only execution mechanism, and limits propagation to dependency-derived task state.

## Considered Options

- **Keep direct consumers only:** lowest risk, but longer dependency chains can keep stale dependency explanations after upstream approval.
- **Run unlimited recursive cascade:** more complete, but cycle handling, event volume, and partial failures become harder to reason about.
- **Wake or call the scheduler after cascade:** faster perceived progress, but it mixes dependency state maintenance with task execution.
- **Bounded Recursive Cascade:** updates short downstream chains while preserving the scheduler boundary and limiting blast radius.

## Decision

Auto-Crop will use Bounded Recursive Cascade for CEO approve decisions with `maxDepth: 2`, breadth-first traversal, visited-task protection, and a hard depth clamp of 5. Direct consumers are depth 1, consumers of those consumers are depth 2, and the source task is not counted.

Propagation continues from a refreshed task only when that task changes to `queued`. Waiting or blocking updates are still written and returned for the current depth, but they do not continue the cascade. Partial failures stop the failing branch, continue other branches, and are returned as non-blocking cascade errors.

## Consequences

The dashboard can show coherent dependency state across common short chains such as `A -> B -> C` without manual Refresh. Recursive cascade still does not execute tasks, wake the scheduler, aggregate parent tasks, or unlock downstream work from unapproved Proof.

