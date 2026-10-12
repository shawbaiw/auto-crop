import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import type { createRepositories } from "../db/repositories";
import type { OutboxEvent } from "./executionEvents";
import { recordExecutionEvent } from "./executionEvents";
import { isRetryExhausted } from "./boundedRecovery";
import { resolveDependencyReadiness } from "./dependencyReadiness";
import { recoverTask } from "./taskRecovery";
import { createRuntimeActionChannel } from "./runtimeActionChannel";

type Repositories = ReturnType<typeof createRepositories>;
export type RecoveryMode = "report_only" | "brief-only-v1";
export const RECOVERY_DELAY_MS = 30_000;
const MAX_CANDIDATE_FILES = 50;
const MAX_CANDIDATE_FILE_BYTES = 1024 * 1024;
const SKIPPED_RECOVERY_DIRS = new Set([".git", "node_modules", ".auto-crop-handoff"]);

export type RecoveryCandidateFile = {
  workspaceRole: "task_workspace" | "artifact_workspace";
  relativePath: string;
  sizeBytes: number;
  sha256: string;
  status: "unverified";
};

export function recoveryModeFromEnvironment(env = process.env): RecoveryMode {
  const mode = env.AUTO_CROP_RECOVERY_MODE ?? "report_only";
  if (mode !== "report_only" && mode !== "brief-only-v1") throw new Error("AUTO_CROP_RECOVERY_MODE must be report_only or brief-only-v1");
  if (mode !== "report_only" && env.AUTO_CROP_EXECUTION_POLICY !== "budget-v1") throw new Error("Automatic recovery requires budget-v1");
  return mode;
}

/** Re-evaluated in the writer transaction both when scheduling and when the delay expires. */
export function briefRecoveryEligibility(
  r: Repositories,
  event: OutboxEvent,
  candidateFiles = collectRecoveryCandidateFilesForEvent(r, event),
): { reason: string; manifest?: string } {
  const task = event.taskId ? r.getTask(event.taskId) : null;
  const company = task ? r.getCompany(task.companyId) : null;
  if (!task || task.companyId !== event.companyId || company?.status !== "active" || task.status !== "failed") return { reason: "Task or company no longer permits recovery." };
  if (event.type !== "execution_failed" || !event.runId || event.payload.terminationConfirmed !== true
    || event.payload.reason !== "agent_failed") return { reason: "Only confirmed failures before substantive execution can be retried automatically." };
  const source = r.executionRecovery.source(event.runId);
  const latest = r.executionBudget.latestRun(task.id);
  if (!source || source.taskId !== task.id || source.status !== "failed"
    || source.failureReason !== "agent_failed" || source.ownerEpoch === null || source.ownerEpoch !== source.currentEpoch
    || source.ownerEpoch !== event.payload.ownerEpoch || latest?.id !== event.runId) return { reason: "Source execution is stale or inconsistent." };
  const invocations = r.listRunInvocations(event.runId);
  if (source.launchIsolation !== "strong" || !["codex", "claude-code"].includes(source.agentId)) return { reason: "No pinned strong launch isolation for a supported CLI." };
  if (source.priorRuns !== 0) return { reason: "Earlier attempts may have external effects or partial output; manual review is required." };
  if (invocations.filter(i => i.phase === "preparing_brief").length !== 1
    || invocations.some(i => !i.endedAt || !["preparing_brief", "finalizing"].includes(i.phase))) return { reason: "No complete evidence of a brief-only attempt." };
  const holds = r.listOpenTaskHolds(task.id);
  if (holds.length !== 1 || holds[0].kind !== "runtime_interrupted" || isRetryExhausted(r, task.id)) return { reason: "A Hold or the attempt ceiling requires a human decision." };
  const budget = r.executionBudget.getTask(task.id);
  const runBudget = r.executionBudget.getRun(event.runId);
  if (!budget || !runBudget?.settled || r.executionBudget.stopRequest(event.runId) || !r.executionBudget.snapshot(event.runId)
    || budget.reservedMs !== 0 || budget.authorizedMs <= budget.consumedMs) return { reason: "No settled, authorized budget remains." };
  if (r.listTaskLocks().some(lock => lock.taskId === task.id)
    || r.listRunningAgentRuns(task.companyId).some(run => run.taskId === task.id)
    || r.listWorkspaceClaims().some(claim => claim.taskId === task.id
      || claim.workspacePath === task.workspacePath || claim.workspacePath === task.artifactWorkspacePath)) return { reason: "Execution or workspace ownership has not been released." };
  const dependencies = r.listTaskDependencies(task.id);
  if (dependencies.some(d => !r.getTask(d.dependsOnTaskId)) || resolveDependencyReadiness(r, task).kind !== "ready") return { reason: "Upstream inputs are not ready." };
  // Exact source inputs are retained for audit and compared again before queuing. The scheduler
  // still applies its normal permission/approval gate before launching the new run.
  const manifest = JSON.stringify({
    version: 1, resumeFromRunId: event.runId, sourceEventId: event.id,
    lastFailure: event.payload.reason, logPath: event.payload.logPath,
    task: { id: task.id, title: task.title, description: task.description, proofSchemaId: task.proofSchemaId,
      assigneeAgentId: task.assigneeAgentId, requiredCapabilities: task.requiredCapabilities,
      workspacePath: task.workspacePath, artifactWorkspacePath: task.artifactWorkspacePath, riskLevel: task.riskLevel },
    permissionMode: company.permissionMode ?? null, founderVision: company.founderVision,
    inputs: dependencies.map(d => ({ ...d, artifactId: r.getCurrentBusinessArtifactForTask(d.dependsOnTaskId)?.id ?? null })),
    verifiedSteps: [], candidateFiles, externalActions: [],
    unverified: "No substantive invocation occurred. Candidate files are hashed only as resume context; they are not accepted as proof or automatically published.",
    nextStep: "Prepare a fresh brief, then execute under current scheduler approval and capability checks.",
  });
  return { reason: "Confirmed brief-only failure; retry once after 30 seconds using the same Task budget.", manifest };
}

export function collectRecoveryCandidateFilesForEvent(r: Repositories, event: OutboxEvent): RecoveryCandidateFile[] {
  if (!event.taskId) return [];
  const task = r.getTask(event.taskId);
  return task ? collectRecoveryCandidateFiles(task) : [];
}

function collectRecoveryCandidateFiles(task: { workspacePath: string | null; artifactWorkspacePath?: string | null }): RecoveryCandidateFile[] {
  const roots: Array<{ role: RecoveryCandidateFile["workspaceRole"]; path: string | null | undefined }> = [
    { role: "task_workspace", path: task.workspacePath },
    { role: "artifact_workspace", path: task.artifactWorkspacePath },
  ];
  const seenRoots = new Set<string>();
  const files: RecoveryCandidateFile[] = [];
  for (const root of roots) {
    if (!root.path || files.length >= MAX_CANDIDATE_FILES) continue;
    const rootPath = resolve(root.path);
    if (seenRoots.has(rootPath) || !existsSync(rootPath)) continue;
    seenRoots.add(rootPath);
    collectFilesFromRoot({ rootPath, role: root.role, files });
  }
  return files;
}

function collectFilesFromRoot(input: { rootPath: string; role: RecoveryCandidateFile["workspaceRole"]; files: RecoveryCandidateFile[] }) {
  const pending = [input.rootPath];
  while (pending.length > 0 && input.files.length < MAX_CANDIDATE_FILES) {
    const current = pending.shift()!;
    let stat;
    try { stat = lstatSync(current); } catch { continue; }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (current !== input.rootPath && SKIPPED_RECOVERY_DIRS.has(basename(current))) continue;
      let entries: string[];
      try { entries = readdirSync(current).sort(); } catch { continue; }
      for (const entry of entries) pending.push(join(current, entry));
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_CANDIDATE_FILE_BYTES) continue;
    const relativePath = relative(input.rootPath, current).split(sep).join("/");
    if (!relativePath || relativePath.startsWith("..")) continue;
    const content = readFileSync(current);
    input.files.push({ workspaceRole: input.role, relativePath, sizeBytes: stat.size,
      sha256: createHash("sha256").update(content).digest("hex"), status: "unverified" });
  }
}

export function drainAutomaticRecoveries(input: {
  repositories: Repositories; mode?: RecoveryMode; now?: () => Date;
}) {
  if (input.mode !== "brief-only-v1") return;
  const r = input.repositories;
  const at = (input.now?.() ?? new Date()).toISOString();
  for (const entry of r.executionRecovery.pending(at)) {
    const sourceEvent = r.getOutboxEvent(entry.sourceEventId);
    const candidateFiles = sourceEvent ? collectRecoveryCandidateFilesForEvent(r, sourceEvent) : [];
    r.transaction(() => {
      r.executionRecovery.lock();
      if (r.executionRecovery.get(entry.taskId)?.state !== "pending") return;
      const event = r.getOutboxEvent(entry.sourceEventId);
      const result = event ? briefRecoveryEligibility(r, event, candidateFiles) : { reason: "Source event unavailable." };
      const eligible = Boolean(result.manifest && result.manifest === entry.manifest);
      const reason = result.manifest && !eligible ? "Recovery inputs or permissions changed during backoff." : result.reason;
      // Brief-only recovery re-runs work that was never dispatched, so there is no delivery to
      // recapture: no proof schemas, and an empty channel rather than the project's candidates.
      if (eligible) recoverTask({ repositories: r, taskId: entry.taskId, runtimeActionChannel: createRuntimeActionChannel(), now: () => new Date(at) });
      r.executionRecovery.finish(entry.taskId, eligible ? "queued" : "blocked", reason);
      const task = r.getTask(entry.taskId);
      if (task) recordExecutionEvent(r, { id: `recovery-result:${entry.sourceEventId}`,
        type: eligible ? "recovery_scheduled" : "recovery_blocked", companyId: task.companyId,
        taskId: task.id, runId: entry.sourceRunId, reason, observedAt: at });
    });
  }
}
