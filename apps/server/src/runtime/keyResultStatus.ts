import { deriveKeyResultStatus } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";

/**
 * Record a key result's status from the tasks that serve it: met once every one is complete, active
 * while any is not (ADR 0048). It never writes the key result's current value, which is the
 * plan's measure, not a task's. Called wherever a task's status or a key result's tasks change, so
 * the stored status cannot drift from what the tasks say.
 */
export function settleKeyResultStatus(repositories: ReturnType<typeof createRepositories>, companyId: string, keyResultId: string | null | undefined): void {
  if (!keyResultId) return;
  const status = deriveKeyResultStatus(repositories.listTasksForCompany(companyId), keyResultId);
  repositories.updateKeyResultStatus(keyResultId, status);
}
