/**
 * Verification Contract — what a verifying task must check, what it checked, and against which
 * producer output.
 *
 * A Business Artifact being `valid` only says its report is well formed. A verification report can be
 * perfectly well formed and say the target failed; before this contract nothing read that verdict,
 * so a validation subtask that found an empty workspace and failed every check was still accepted as
 * a successful delivery. The contract makes the verdict a runtime fact:
 *
 * - The requirements come from an upstream artifact (`verification_requirements` edge), never from the
 *   verifier itself, so a verifier cannot shrink what it is judged against.
 * - The targets are snapshotted by the runtime (`verification_target` edge) and bound by revision, so a
 *   report is about one exact producer output.
 * - The agent reports one check per requirement. The overall outcome is derived here, never authored,
 *   and never read from prose.
 */

/**
 * What a Task Dependency supplies to its consumer.
 *
 * - `context`: ordinary upstream input, the historical meaning of every dependency.
 * - `verification_requirements`: the upstream artifact declares the requirements the consumer must verify.
 * - `verification_target`: the upstream output the consumer verifies; the runtime hands it over as a snapshot.
 */
export type DependencyInputRole = "context" | "verification_requirements" | "verification_target";

export const dependencyInputRoles = [
  "context",
  "verification_requirements",
  "verification_target",
] as const satisfies readonly DependencyInputRole[];

export type VerificationRequirement = {
  id: string;
  description: string;
};

export type VerificationCheckOutcome = "passed" | "failed" | "not_run";

export type VerificationOutcome = "passed" | "failed" | "inconclusive";

export type VerificationCheck = {
  requirementId: string;
  outcome: VerificationCheckOutcome;
  evidence: string;
};

/** One producer output a verification is bound to. `revision` is computed by the runtime from the snapshot. */
export type VerificationTarget = {
  taskId: string;
  artifactId: string;
  revision: string;
};

export type VerificationSnapshotTarget = VerificationTarget & {
  /** Snapshot directory relative to the verifying task's workspace. */
  path: string;
};

/**
 * What the runtime handed one verifying run: the requirements and the snapshotted targets. Persisted by
 * the runtime outside the workspace, because the workspace is the agent's to write — a manifest read back
 * from it would let a verifier drop the requirements it is judged against.
 */
export type VerificationInputs = {
  requirementsTaskId: string | null;
  requirementsArtifactId: string | null;
  requirements: VerificationRequirement[];
  targets: VerificationSnapshotTarget[];
};

/** The runtime-derived verdict recorded on a verifying task's Business Artifact. */
export type ArtifactVerification = {
  outcome: VerificationOutcome;
  requirementsTaskId?: string | null;
  requirementsArtifactId: string | null;
  requirements: VerificationRequirement[];
  targets: VerificationTarget[];
  checks: VerificationCheck[];
  /** Why the outcome is not `passed` when no check failed — a stale target, a missing requirement source. */
  issues: string[];
};

/**
 * Whether an artifact may stand as a successful delivery as far as verification is concerned.
 *
 * An artifact that carries no verification was not produced under the contract and is unaffected. One
 * that does is a success only when every requirement passed against current targets. This is the one
 * predicate every acceptance and readiness path asks, so a failed report cannot be accepted by a route
 * that forgot to look.
 */
export function isVerificationSatisfied(artifact: { verification?: ArtifactVerification | null }): boolean {
  return !artifact.verification || artifact.verification.outcome === "passed";
}

/**
 * Derive the overall outcome from the checks. Every requirement must have exactly one check; the caller
 * validates that shape first. Any failed check fails the verification, and anything short of every check
 * passing with no outstanding issue is inconclusive — never a pass by default.
 */
export function deriveVerificationOutcome(input: {
  requirements: readonly VerificationRequirement[];
  checks: readonly VerificationCheck[];
  issues: readonly string[];
}): VerificationOutcome {
  if (input.checks.some((check) => check.outcome === "failed")) {
    return "failed";
  }

  const passed = new Set(input.checks.filter((check) => check.outcome === "passed").map((check) => check.requirementId));
  const allPassed = input.requirements.length > 0 && input.requirements.every((requirement) => passed.has(requirement.id));

  return allPassed && input.issues.length === 0 ? "passed" : "inconclusive";
}
