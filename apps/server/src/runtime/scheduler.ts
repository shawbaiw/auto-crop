import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentAdapter, AgentRunResult } from "../adapters/types";
import type { createRepositories } from "../db/repositories";
import type {
  AgentFailureReason,
  BusinessArtifact,
  Company,
  Proof,
  Task,
  TaskEvent,
  TaskProgressEvent,
  TaskStatus,
} from "@auto-crop/core";
import { evaluateAutomaticAcceptance } from "./automaticAcceptance";
import {
  MAX_TASK_ATTEMPTS,
  retryExhaustedFailureMessage,
  taskAttemptCount,
  terminateAsRetryExhausted as terminateTaskAsRetryExhausted,
} from "./boundedRecovery";
import { acceptDeliverableAutomatically } from "./businessAcceptance";
import {
  captureBusinessArtifact,
  isReviewableBusinessArtifact,
  readEnvironmentBlockerClaim,
  verifyEnvironmentBlockerClaim,
} from "./businessArtifact";
import type { AgentSessionManager } from "./agentSessions";
import { projectCeoAttention } from "./ceoAttention";
import { classifyFinalFounderReport, isCompanyQuiescent } from "./companyQuiescence";
import { resolveDependencyReadiness, type TaskHandoff } from "./dependencyReadiness";
import { generateFinalFounderReport, hasWorkCompletedSinceReport } from "./finalFounderReport";
import { parseOpenDecisions } from "./founderDecision";
import { formatExecutionBudget, resolveEffectiveTimeout, resolveRetryTimeout } from "./executionProfile";
import { propagateParentTaskAggregation } from "./parentTaskAggregation";
import { createHandoffPackage } from "./proof";
import { buildProofContractInstructions } from "./proofContract";
import { reconcileReviewTasksForAutomaticAcceptance } from "./reviewReconciliation";
import { reconcileStaleRunningTasks } from "./taskRecovery";
import { recordTaskCompletionEvent } from "./taskCompletion";
import { buildTaskExecutionPrompt } from "./taskExecutionPrompt";
import { cleanupGeneratedWorkspaceArtifacts, createTaskWorkspace } from "./workspace";

export type SchedulerFailureReason = AgentFailureReason;

export type SchedulerEvent = {
  type: TaskEvent["type"] | "company_report_ready";
  taskId?: string;
  companyId?: string;
  message: string;
  failureReason?: SchedulerFailureReason;
  failureMessage?: string;
  status?: TaskStatus;
  executionProfileName?: string;
  requestedTimeoutMs?: number;
  effectiveTimeoutMs?: number;
  dependencyNote?: string;
  artifactWorkspacePath?: string;
};

export type RunSchedulerOnceInput = {
  projectRoot: string;
  repositories: ReturnType<typeof createRepositories>;
  adapters: AgentAdapter[];
  workerId: string;
  maxTasks: number;
  now?: () => Date;
  createId?: (prefix: string) => string;
  approvalRequired: (task: Task) => boolean;
  proofCollector: (input: { task: Task; stdout: string; stderr: string; logPath: string }) => Proof[];
  /** Injectable fetch used to independently verify Environment-Blocked Blocker claims. Defaults to global fetch. */
  environmentBlockerFetch?: typeof fetch;
  /** Injectable session manager for the CEO Agent run that authors a Final Founder Report. */
  agentSessionManager?: AgentSessionManager;
  agentSessionEnv?: Record<string, string | undefined>;
  emit: (event: SchedulerEvent) => void;
};

export type RunSchedulerOnceResult = {
  started: string[];
  completed: string[];
  blocked: string[];
  failed: string[];
};

export async function runSchedulerOnce(input: RunSchedulerOnceInput): Promise<RunSchedulerOnceResult> {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;
  const result: RunSchedulerOnceResult = {
    started: [],
    completed: [],
    blocked: [],
    failed: [],
  };

  if (input.repositories.isGlobalPaused()) {
    return result;
  }

  for (const company of input.repositories.listCompanies()) {
    reconcileStaleRunningTasks({
      repositories: input.repositories,
      companyId: company.id,
      now,
      createId,
    });
    // One-time migration pass (ADR 0017 §Migration): on the first tick after this company gets the
    // deterministic model, accept the `review` tasks it would have accepted. A per-company marker
    // makes every later call a no-op; any newly-queued downstream is picked up by
    // `fetchQueuedTasks` in this same tick.
    const reconciledReview = reconcileReviewTasksForAutomaticAcceptance({
      repositories: input.repositories,
      companyId: company.id,
      now,
      createId,
      requestSchedulerWake: () => undefined,
    });
    for (const event of reconciledReview.events) {
      emitTaskEvent(input, event);
    }
    // One-time upgrade pass (ADR 0018 §Upgrade regeneration): a company that finished before this
    // feature shipped gets its closing report enqueued once. Also per-company-marked; `runFinal
    // FounderReportJobs` (a later tick) authors it off this path.
    reconcileFinalFounderReportUpgrade(input, company, now, createId);
  }

  const queuedTasks = input.repositories.fetchQueuedTasks(Math.max(input.maxTasks * 5, 20));
  const dispatches: Array<Promise<void>> = [];

  for (const task of queuedTasks) {
    if (dispatches.length >= input.maxTasks) {
      break;
    }

    const dependencyDecision = resolveDependencyReadiness(input.repositories, task);
    if (dependencyDecision.kind === "waiting") {
      if (task.status !== "waiting_dependency") {
        input.repositories.updateTaskStatus(task.id, "waiting_dependency");
      }
      if (task.dependencyNote !== dependencyDecision.note || task.status !== "waiting_dependency") {
        input.repositories.updateTaskExecutionSummary(task.id, { dependencyNote: dependencyDecision.note });
        appendAndEmitTaskEvent(input, {
          task,
          type: "dependency_waiting",
          message: dependencyDecision.note,
          status: "waiting_dependency",
          dependencyNote: dependencyDecision.note,
        });
      }
      continue;
    }

    if (dependencyDecision.kind === "missing_deliverable") {
      blockTaskForMissingDeliverable(input, task, dependencyDecision.dependency, dependencyDecision.note);
      result.blocked.push(task.id);
      continue;
    }

    if (dependencyDecision.kind === "blocked") {
      blockTaskForDependency(input, task, dependencyDecision.dependency, dependencyDecision.reason, dependencyDecision.note);
      result.blocked.push(task.id);
      continue;
    }

    const assessmentDecision = assessDepartmentTask(input, task);
    if (assessmentDecision === "deferred") {
      continue;
    }

    dispatches.push(
      (async (handoffs: TaskHandoff[]) => {
        const acquiredAt = now().toISOString();

        if (!input.repositories.acquireTaskLock(task.id, input.workerId, acquiredAt)) {
          return;
        }

        let taskWorkspaceRoot: string | null = null;
        try {
          if (input.approvalRequired(task)) {
            input.repositories.updateTaskStatus(task.id, "blocked");
            input.repositories.createApproval({
              id: createId("approval"),
              companyId: task.companyId,
              taskId: task.id,
              actionType: "run_safe_command",
              riskLevel: task.riskLevel,
              status: "pending",
              requestedAt: acquiredAt,
            });
            appendAndEmitTaskEvent(input, {
              task,
              type: "task_blocked",
              message: "Task requires approval.",
              status: "blocked",
            });
            result.blocked.push(task.id);
            return;
          }

          // Reached the recovery ceiling without a qualifying reset (a new accepted upstream
          // Business Artifact or a CEO replan): terminate instead of dispatching another run.
          if (endedAtRetryCeiling(input, result, task, null, resolveEffectiveTimeout(task), now, createId)) {
            return;
          }

          const initialTimeoutResolution = resolveEffectiveTimeout(task);
          input.repositories.updateTaskStatus(task.id, "running");
          input.repositories.updateTaskExecutionSummary(task.id, {
            latestFailureReason: null,
            latestFailureMessage: null,
            latestExecutionProfileName: initialTimeoutResolution.executionProfile.name,
            latestRequestedTimeoutMs: initialTimeoutResolution.requestedTimeoutMs,
            latestEffectiveTimeoutMs: initialTimeoutResolution.effectiveTimeoutMs,
            dependencyNote: null,
          });
          result.started.push(task.id);
          for (const warning of initialTimeoutResolution.warnings) {
            appendAndEmitTaskEvent(input, {
              task,
              type: "task_warning",
              message: `Task warning: ${task.title} / ${warning}`,
              status: "queued",
              executionProfileName: initialTimeoutResolution.executionProfile.name,
              requestedTimeoutMs: initialTimeoutResolution.requestedTimeoutMs,
              effectiveTimeoutMs: initialTimeoutResolution.effectiveTimeoutMs,
            });
          }
          appendAndEmitTaskEvent(input, {
            task,
            type: "task_started",
            message: `Task started: ${task.title} (${task.assigneeAgentId}, ${initialTimeoutResolution.executionProfile.name} budget ${formatExecutionBudget(initialTimeoutResolution.effectiveTimeoutMs)}).`,
            status: "running",
            executionProfileName: initialTimeoutResolution.executionProfile.name,
            requestedTimeoutMs: initialTimeoutResolution.requestedTimeoutMs,
            effectiveTimeoutMs: initialTimeoutResolution.effectiveTimeoutMs,
          });
          appendTaskProgressEvent(input, {
            task,
            step: "executing",
            status: "current",
            label: `Task ${task.position + 1} (${task.title}) in progress`,
            subjectTaskId: task.id,
          });

          const taskWorkspace = task.workspacePath
            ? { root: task.workspacePath }
            : createTaskWorkspace(input.projectRoot, task.id);
          taskWorkspaceRoot = taskWorkspace.root;
          if (!task.workspacePath) {
            input.repositories.updateTaskWorkspacePath(task.id, taskWorkspace.root);
          }
          const runWorkspacePath = resolveRunWorkspace(input.repositories, task) ?? taskWorkspace.root;

          const adapter = selectAdapter(input.adapters, task);
          const logPath = createLogPath(input.projectRoot, task);
          let timeoutResolution = initialTimeoutResolution;
          let agentRunId = "";
          let agentResult: AgentRunResult | null = null;

          while (true) {
            agentRunId = createId("agent_run");
            input.repositories.createAgentRun({
              id: agentRunId,
              taskId: task.id,
              agentId: adapter.id,
              status: "running",
              logPath,
              startedAt: now().toISOString(),
              finishedAt: null,
              executionProfileName: timeoutResolution.executionProfile.name,
              requestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
              effectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
              failureReason: null,
              failureMessage: null,
            });

            const company = input.repositories.getCompany(task.companyId);
            if (!company) {
              throw new Error(`Company not found for task ${task.id}: ${task.companyId}`);
            }
            agentResult = await adapter.run({
              taskId: task.id,
              prompt: buildTaskExecutionPrompt({ task, company, handoffs }),
              promptPath: "",
              workspacePath: runWorkspacePath,
              metadata: {
                departmentId: task.departmentId,
                proofSchemaId: task.proofSchemaId,
              },
              timeoutMs: timeoutResolution.effectiveTimeoutMs,
            });
            const logContent = [
              `# Agent Run ${agentRunId}`,
              "",
              `status: ${agentResult.status}`,
              `exitCode: ${agentResult.exitCode ?? ""}`,
              "",
              "## stdout",
              agentResult.stdout,
              "",
              "## stderr",
              agentResult.stderr,
              "",
            ].join("\n");
            writeFileSync(logPath, logContent, "utf8");

            const failureReason =
              agentResult.status !== "complete" ? (agentResult.failureReason ?? "agent_failed") : null;
            const retryTimeoutResolution = failureReason === "timeout" ? resolveRetryTimeout(timeoutResolution) : null;

            if (!retryTimeoutResolution) {
              break;
            }

            const failure = failureMessage(task, "timeout", timeoutResolution.effectiveTimeoutMs);
            const timedOutAfterMs = timeoutResolution.effectiveTimeoutMs;
            input.repositories.updateAgentRunStatus(agentRunId, "failed", now().toISOString(), {
              failureReason: "timeout",
              failureMessage: failure,
            });
            timeoutResolution = retryTimeoutResolution;
            input.repositories.updateTaskStatus(task.id, "retrying");
            input.repositories.updateTaskExecutionSummary(task.id, {
              latestExecutionProfileName: timeoutResolution.executionProfile.name,
              latestRequestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
              latestEffectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
            });
            appendAndEmitTaskEvent(input, {
              task,
              type: "task_retrying",
              message: `Task warning: ${task.title} / timed out after ${formatExecutionBudget(
                timedOutAfterMs,
              )}; retrying with ${timeoutResolution.executionProfile.name} budget ${formatExecutionBudget(
                timeoutResolution.effectiveTimeoutMs,
              )}.`,
              status: "running",
              executionProfileName: timeoutResolution.executionProfile.name,
              requestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
              effectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
            });
          }

          if (!agentResult) {
            throw new Error(`No agent result produced for task ${task.id}`);
          }

          let proof: Proof[] = [];
          if (agentResult.status === "complete") {
            try {
              proof = input.proofCollector({
                task: { ...task, workspacePath: runWorkspacePath },
                stdout: agentResult.stdout,
                stderr: agentResult.stderr,
                logPath,
              });
            } catch (error) {
              if (endedAtRetryCeiling(input, result, task, agentRunId, timeoutResolution, now, createId)) {
                return;
              }
              const failureReason = "proof_capture_failed";
              const failure = `Task failed: ${task.title} / proof_capture_failed / ${(error as Error).message}`;
              input.repositories.updateTaskStatus(task.id, "failed");
              input.repositories.updateTaskExecutionSummary(task.id, {
                latestFailureReason: failureReason,
                latestFailureMessage: failure,
              });
              input.repositories.updateAgentRunStatus(agentRunId, "failed", now().toISOString(), {
                failureReason,
                failureMessage: failure,
              });
              appendAndEmitTaskEvent(input, {
                task,
                type: "task_failed",
                failureReason,
                failureMessage: failure,
                message: failure,
                status: "failed",
              });
              result.blocked.push(...blockDirectDependencyConsumers(input, task));
              emitParentTaskAggregationEvents(input, task);
              result.failed.push(task.id);
              return;
            }
          }

          for (const item of proof) {
            input.repositories.appendProof(item);
          }
          let businessArtifact: BusinessArtifact | null = null;
          let environmentBlockerDegraded = false;
          const hasBusinessArtifactFile = existsSync(
            join(runWorkspacePath, ".auto-crop", "business-artifact.json"),
          );
          if (proof.length > 0 || hasBusinessArtifactFile) {
            // An Environment-Blocked Blocker with a runtime-checkable claim is verified independently
            // (never on the agent's word). A passing check degrades the blocker to a deliverable.
            const environmentBlockerClaim =
              agentResult.status === "complete"
                ? readEnvironmentBlockerClaim(runWorkspacePath, proof)
                : null;
            const environmentBlockerVerification = environmentBlockerClaim
              ? await verifyEnvironmentBlockerClaim({
                  claim: environmentBlockerClaim,
                  fetchImpl: input.environmentBlockerFetch,
                })
              : undefined;
            businessArtifact = captureBusinessArtifact({
              task: { ...task, workspacePath: runWorkspacePath },
              proofs: proof,
              workspacePath: runWorkspacePath,
              environmentBlockerVerification,
              now,
              createId,
            });
            environmentBlockerDegraded = Boolean(
              environmentBlockerVerification?.verified && businessArtifact.artifactKind !== "blocker",
            );
            input.repositories.createBusinessArtifact(businessArtifact);
          }
          createHandoffPackage({
            task: { ...task, workspacePath: runWorkspacePath },
            proofs: proof,
            workspacePath: runWorkspacePath,
            logPath,
          });

          if ((agentResult.status !== "complete" || proof.length === 0) && !environmentBlockerDegraded) {
            const failureReason = agentResult.status !== "complete" ? (agentResult.failureReason ?? "agent_failed") : "no_proof";
            if (failureReason === "timeout" && timeoutResolution.executionProfile.name === "long" && !task.artifactWorkspacePath) {
              const failure = replanMessage(task, timeoutResolution.effectiveTimeoutMs);
              input.repositories.updateTaskStatus(task.id, "needs_replan");
              input.repositories.updateTaskExecutionSummary(task.id, {
                latestFailureReason: "needs_replan",
                latestFailureMessage: failure,
                latestExecutionProfileName: timeoutResolution.executionProfile.name,
                latestRequestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
                latestEffectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
              });
              input.repositories.updateAgentRunStatus(agentRunId, "failed", now().toISOString(), {
                failureReason: "timeout",
                failureMessage: failure,
              });
              appendAndEmitTaskEvent(input, {
                task,
                type: "task_needs_replan",
                failureReason: "needs_replan",
                failureMessage: failure,
                message: failure,
                status: "needs_replan",
                executionProfileName: timeoutResolution.executionProfile.name,
                requestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
                effectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
              });
              recordTaskCompletionEvent({
                repositories: input.repositories,
                task,
                outcome: "needs_replan",
                now,
                createId,
              });
              emitParentTaskAggregationEvents(input, task);
              result.blocked.push(task.id);
              return;
            }
            if (endedAtRetryCeiling(input, result, task, agentRunId, timeoutResolution, now, createId)) {
              return;
            }
            const failure = failureMessage(task, failureReason, timeoutResolution.effectiveTimeoutMs);
            input.repositories.updateTaskStatus(task.id, "failed");
            input.repositories.updateTaskExecutionSummary(task.id, {
              latestFailureReason: failureReason,
              latestFailureMessage: failure,
            });
            input.repositories.updateAgentRunStatus(agentRunId, "failed", now().toISOString(), {
              failureReason,
              failureMessage: failure,
            });
            appendAndEmitTaskEvent(input, {
              task,
              type: "task_failed",
              failureReason,
              failureMessage: failure,
              message: failure,
              status: "failed",
              executionProfileName: timeoutResolution.executionProfile.name,
              requestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
              effectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
            });
            if (task.artifactWorkspacePath) {
              appendAndEmitTaskEvent(input, {
                task,
                type: "partial_output",
                message: `Partial Output: ${task.artifactWorkspacePath} (not Proof).`,
                status: "failed",
                artifactWorkspacePath: task.artifactWorkspacePath,
              });
            }
            const followUpTask = createPartialOutputFollowUpTask(input, task, failureReason, failure, logPath);
            if (!followUpTask) {
              result.blocked.push(...blockDirectDependencyConsumers(input, task));
            }
            emitParentTaskAggregationEvents(input, task);
            result.failed.push(task.id);
            return;
          }

          if (!businessArtifact || !isReviewableBusinessArtifact(businessArtifact)) {
            if (endedAtRetryCeiling(input, result, task, agentRunId, timeoutResolution, now, createId)) {
              return;
            }
            const failureReason = businessArtifactFailureReason(businessArtifact);
            const failure = businessArtifactFailureMessage(task, businessArtifact);
            input.repositories.updateTaskStatus(task.id, "blocked");
            input.repositories.updateTaskExecutionSummary(task.id, {
              latestFailureReason: failureReason,
              latestFailureMessage: failure,
            });
            input.repositories.updateAgentRunStatus(agentRunId, "failed", now().toISOString(), {
              failureReason,
              failureMessage: failure,
            });
            appendAndEmitTaskEvent(input, {
              task,
              type: "task_blocked",
              failureReason,
              failureMessage: failure,
              message: failure,
              status: "blocked",
              executionProfileName: timeoutResolution.executionProfile.name,
              requestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
              effectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
            });
            appendTaskProgressEvent(input, {
              task,
              step: "blocked",
              status: "blocked",
              label: "Business artifact is not reviewable",
              detail: failure,
              subjectTaskId: task.id,
            });
            const blockedConsumerIds = blockDirectDependencyConsumers(input, task);
            recordTaskCompletionEvent({
              repositories: input.repositories,
              task,
              businessArtifact,
              outcome: "failed_to_review",
              dependencyImpact: { blockedTaskIds: blockedConsumerIds },
              now,
              createId,
            });
            result.blocked.push(...blockedConsumerIds);
            emitParentTaskAggregationEvents(input, task);
            result.failed.push(task.id);
            return;
          }

          if (task.artifactWorkspacePath && task.artifactWorkspacePath !== runWorkspacePath) {
            input.repositories.updateTaskArtifactWorkspacePath(task.id, runWorkspacePath);
          }
          input.repositories.updateAgentRunStatus(agentRunId, "complete", now().toISOString());
          const automaticAcceptance = evaluateAutomaticAcceptance({ task, artifact: businessArtifact });
          if (automaticAcceptance.kind === "accept") {
            // A deliverable that would otherwise auto-accept but declares one or more kept Founder
            // Decisions is not accepted and is not routed to manual CEO review: the choice is the
            // founder's to make. Record the Task Completion Event (carrying the founder_decision
            // items and the Task Outcome Summary) and stop. Downstream dependency readiness keeps
            // blocking on the non-accepted upstream. A risk-pattern hit takes precedence — it lands
            // in the `requires_review` branch below before this check runs.
            const founderDecisions = parseOpenDecisions(businessArtifact.payload).kept;
            if (founderDecisions.length > 0) {
              input.repositories.updateTaskStatus(task.id, "review");
              recordTaskCompletionEvent({
                repositories: input.repositories,
                task,
                businessArtifact,
                outcome: "awaiting_founder_decision",
                founderDecisions,
                founderDecisionBlockedTaskIds: input.repositories
                  .listDependencyConsumers(task.id)
                  .map((consumer) => consumer.id),
                now,
                createId,
              });
              appendTaskProgressEvent(input, {
                task,
                step: "awaiting_review",
                status: "current",
                label: "Awaiting founder decision",
                subjectTaskId: task.id,
              });
              emitParentTaskAggregationEvents(input, task);
              result.completed.push(task.id);
              return;
            }

            const accepted = acceptDeliverableAutomatically({
              repositories: input.repositories,
              task,
              artifact: businessArtifact,
              eventMessage: `Automatic Acceptance accepted task: ${task.title}.`,
              requestSchedulerWake: () => undefined,
              now,
              createId,
            });
            for (const event of accepted.events) {
              emitTaskEvent(input, event);
            }
            appendTaskProgressEvent(input, {
              task,
              step: "complete",
              status: "complete",
              label: "Automatically accepted",
              subjectTaskId: task.id,
            });
            emitParentTaskAggregationEvents(input, task);
            result.completed.push(task.id);
            return;
          }

          input.repositories.updateTaskStatus(task.id, "review");
          appendTaskProgressEvent(input, {
            task,
            step: "awaiting_review",
            status: "current",
            label: "Awaiting review",
            subjectTaskId: task.id,
          });
          appendAndEmitTaskEvent(input, {
            task,
            type: "task_review",
            message: "Task is ready for review.",
            status: "review",
          });
          emitParentTaskAggregationEvents(input, task);
          result.completed.push(task.id);
        } finally {
          try {
            if (taskWorkspaceRoot) {
              try {
                cleanupGeneratedWorkspaceArtifacts({
                  projectRoot: input.projectRoot,
                  workspacePath: taskWorkspaceRoot,
                });
              } catch (error) {
                appendAndEmitTaskEvent(input, {
                  task,
                  type: "task_warning",
                  message: `Task warning: ${task.title} / workspace cleanup skipped / ${(error as Error).message}`,
                });
              }
            }
          } finally {
            input.repositories.releaseTaskLock(task.id, input.workerId);
          }
        }
      })(dependencyDecision.handoffs),
    );
  }

  await Promise.all(dispatches);

  // Task state for every company has settled for this tick. Sweep for Company Quiescence and, on the
  // first quiescent tick with no existing report and no in-flight job, enqueue a tracked async
  // generation job. The tick does not run the CEO Agent — `runFinalFounderReportJobs` (a later tick,
  // fire-and-forget from the scheduler loop) authors the report off this tick's path.
  for (const company of input.repositories.listCompanies()) {
    maybeEnqueueFinalFounderReportJob(input, company, now, createId);
  }

  return result;
}

/** Inputs for {@link runFinalFounderReportJobs} — the report-authoring half of the scheduler. */
export type RunFinalFounderReportJobsInput = Pick<
  RunSchedulerOnceInput,
  | "projectRoot"
  | "repositories"
  | "adapters"
  | "now"
  | "createId"
  | "agentSessionManager"
  | "agentSessionEnv"
  | "emit"
>;

type FinalFounderReportContext = {
  quiescent: boolean;
  /** Build the full authoring input. Only called once the company is confirmed quiescent. */
  buildGenerateInput: () => Parameters<typeof generateFinalFounderReport>[0];
};

/**
 * Decide whether the company is quiescent and, if so, how to author its Final Founder Report. Shared
 * by the enqueue check on the scheduler tick and the job runner, so both see the same derivation.
 * Returns `null` when a report can never be authored for this company right now (not `active`, no
 * tasks, or no CEO Agent adapter available). The heavy repository reads for the authoring input are
 * deferred to `buildGenerateInput` so the common not-quiescent sweep stays cheap.
 */
function gatherFinalFounderReportContext(
  input: RunFinalFounderReportJobsInput,
  company: Company,
  now: () => Date,
  createId: (prefix: string) => string,
): FinalFounderReportContext | null {
  const repositories = input.repositories;
  // Only a running company with real work can be quiescent. A `creating` / `creation_failed` /
  // `draft` / `paused` company is not "done", it just is not going yet.
  if (company.status !== "active") {
    return null;
  }

  const tasks = repositories.listTasksForCompany(company.id);
  if (tasks.length === 0) {
    return null;
  }
  const ceoAgent = input.adapters.find((adapter) => adapter.id === company.selectedCeoAgentId);
  if (!ceoAgent) {
    // The company's selected CEO Agent adapter is not registered with this runtime. Neither the
    // authored run nor the deterministic fallback can execute without it, so no job is enqueued and
    // no "preparing" indicator shows. In practice the scheduler loop always carries the same adapter
    // set the company was created against, so this is a misconfiguration guard, not a normal path.
    return null;
  }

  const keyResults = repositories.listKeyResults(company.id);
  const taskDependencies = repositories.listTaskDependenciesForCompany(company.id);
  const taskCompletionEvents = repositories.listTaskCompletionEventsForCompany(company.id);

  const attention = projectCeoAttention({
    company,
    keyResults,
    tasks,
    taskCompletionEvents,
    taskDependencies,
    humanActionConfirmations: repositories.listHumanActionConfirmationsForCompany(company.id),
    founderDecisionResolutions: repositories.listFounderDecisionResolutionsForCompany(company.id),
    now,
  });

  const quiescent = isCompanyQuiescent({
    tasks,
    waitStates: attention.waitStates,
    humanActions: attention.humanActions,
    founderDecisions: attention.founderDecisions,
    now,
  });

  return {
    quiescent,
    buildGenerateInput: () => ({
      projectRoot: input.projectRoot,
      repositories,
      company,
      classification: classifyFinalFounderReport({
        keyResults,
        waitStates: attention.waitStates,
        humanActions: attention.humanActions,
        founderDecisions: attention.founderDecisions,
      }),
      ceoAgent,
      tasks,
      departments: repositories.listDepartments(company.id),
      objectives: repositories.listObjectives(company.id),
      keyResults,
      taskCompletionEvents,
      businessArtifacts: repositories.listBusinessArtifactsForCompany(company.id),
      taskDependencies,
      visionGaps: attention.visionGaps,
      waitStates: attention.waitStates,
      humanActions: attention.humanActions,
      founderDecisions: attention.founderDecisions,
      agentSessionManager: input.agentSessionManager,
      agentSessionEnv: input.agentSessionEnv,
      now,
      createId,
    }),
  };
}

/**
 * Does the company's standing `isCurrent` Final Founder Report still cover everything, so a fresh one
 * would be redundant? True when a report exists and no Task Completion Event post-dates it — a
 * repeated quiescent tick or a bare Wait State check-in. Non-Wait-State work completing since the
 * report is what releases this, so the next report supersedes the standing one. Shared by the enqueue
 * check and the job runner so both gate on the same rule.
 */
function standingReportCoversCompany(
  repositories: ReturnType<typeof createRepositories>,
  companyId: string,
): boolean {
  const currentReport = repositories.getCurrentFinalFounderReport(companyId);
  return (
    currentReport !== null &&
    !hasWorkCompletedSinceReport(
      repositories.listTaskCompletionEventsForCompany(companyId),
      currentReport,
    )
  );
}

/**
 * One-time upgrade pass (ADR 0018 §Upgrade regeneration), run on the scheduler tick alongside the
 * ADR 0017 review reconciliation. A company that finished before the Final Founder Report shipped —
 * quiescent, every task `complete`, no report — gets exactly one report generation job enqueued
 * here. `runFinalFounderReportJobs` then authors it from the accepted Business Artifacts that already
 * exist, falling back deterministically if the CEO Agent run fails. No task is re-run and no per-task
 * Task Outcome Summary is synthesized for old work. A per-company marker in `runtime_state` makes
 * every later tick a no-op.
 *
 * Companies with a non-`complete` task are left to `maybeEnqueueFinalFounderReportJob`, which gives
 * them a normal report on their next quiescent tick; companies that already have a report (or an
 * in-flight job) are left alone. Safe to run more than once before the marker is set — the standing
 * report / job checks stop a duplicate.
 */
export function reconcileFinalFounderReportUpgrade(
  input: RunSchedulerOnceInput,
  company: Company,
  now: () => Date,
  createId: (prefix: string) => string,
): void {
  const repositories = input.repositories;
  if (repositories.hasFinalFounderReportUpgradeRun(company.id)) {
    return;
  }

  const tasks = repositories.listTasksForCompany(company.id);
  const everyTaskComplete = tasks.length > 0 && tasks.every((task) => task.status === "complete");
  const alreadyReported =
    repositories.getCurrentFinalFounderReport(company.id) !== null ||
    repositories.getActiveFinalFounderReportJob(company.id) !== null;

  if (everyTaskComplete && !alreadyReported) {
    const context = gatherFinalFounderReportContext(input, company, now, createId);
    if (context?.quiescent) {
      const timestamp = now().toISOString();
      repositories.createFinalFounderReportJob({
        id: createId("founder_report_job"),
        companyId: company.id,
        status: "preparing",
        createdAt: timestamp,
        updatedAt: timestamp,
        finishedAt: null,
        failureMessage: null,
      });
    }
  }

  repositories.markFinalFounderReportUpgradeRun(company.id, now().toISOString());
}

function maybeEnqueueFinalFounderReportJob(
  input: RunSchedulerOnceInput,
  company: Company,
  now: () => Date,
  createId: (prefix: string) => string,
): void {
  const repositories = input.repositories;
  if (standingReportCoversCompany(repositories, company.id)) {
    return;
  }
  if (repositories.getActiveFinalFounderReportJob(company.id)) {
    return;
  }

  const context = gatherFinalFounderReportContext(input, company, now, createId);
  if (!context || !context.quiescent) {
    return;
  }

  const timestamp = now().toISOString();
  repositories.createFinalFounderReportJob({
    id: createId("founder_report_job"),
    companyId: company.id,
    status: "preparing",
    createdAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
    failureMessage: null,
  });
}

/**
 * Author the Final Founder Report for every `preparing` job. Runs the CEO Agent authoring path
 * (`generateFinalFounderReport`, which retries to a ceiling then falls back to a deterministic
 * report) off the scheduler tick that enqueued the job, then marks the job `complete` and publishes
 * a `company_report_ready` event so the dashboard refetches. A job whose company is no longer
 * quiescent, or an unexpected failure, marks the job `failed`; the next quiescent tick re-enqueues.
 */
export async function runFinalFounderReportJobs(input: RunFinalFounderReportJobsInput): Promise<void> {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;
  const repositories = input.repositories;

  for (const job of repositories.listPendingFinalFounderReportJobs()) {
    const company = repositories.getCompany(job.companyId);

    if (company && standingReportCoversCompany(repositories, company.id)) {
      // A report already stands and nothing has completed since (two jobs raced, or one was enqueued
      // twice). Close this one without regenerating. When work has completed the job falls through
      // and `generateFinalFounderReport` supersedes the standing report.
      repositories.updateFinalFounderReportJobStatus(job.id, "complete", now().toISOString());
      continue;
    }

    const context = company ? gatherFinalFounderReportContext(input, company, now, createId) : null;
    if (!context || !context.quiescent) {
      repositories.updateFinalFounderReportJobStatus(
        job.id,
        "failed",
        now().toISOString(),
        "Company was no longer quiescent when the report job ran.",
      );
      continue;
    }

    try {
      await generateFinalFounderReport(context.buildGenerateInput());
      repositories.updateFinalFounderReportJobStatus(job.id, "complete", now().toISOString());
      input.emit({
        type: "company_report_ready",
        companyId: job.companyId,
        message: "Final Founder Report ready.",
      });
    } catch (error) {
      // `generateFinalFounderReport` persists a report on any agent outcome (retry then deterministic
      // fallback), so this only fires on an unexpected failure such as the DB write.
      repositories.updateFinalFounderReportJobStatus(
        job.id,
        "failed",
        now().toISOString(),
        (error as Error).message,
      );
    }
  }
}

function assessDepartmentTask(input: RunSchedulerOnceInput, task: Task): "ready" | "deferred" {
  if ((task.taskKind ?? "parent") !== "parent" || hasAssessment(input.repositories, task.id)) {
    return "ready";
  }

  appendTaskProgressEvent(input, {
    task,
    step: "received",
    status: "complete",
    label: "Received CEO task",
    subjectTaskId: null,
  });
  appendTaskProgressEvent(input, {
    task,
    step: "assessment_complete",
    status: "complete",
    label: "Assessment complete",
    subjectTaskId: null,
  });

  if (!isLargeDepartmentTask(task)) {
    appendTaskProgressEvent(input, {
      task,
      step: "no_split_needed",
      status: "complete",
      label: "No split needed",
      subjectTaskId: task.id,
    });
    return "ready";
  }

  const subtasks = createDepartmentSubtasks(input, task);
  input.repositories.updateTaskStatus(task.id, "waiting_dependency");
  input.repositories.updateTaskExecutionSummary(task.id, {
    dependencyNote: `Waiting for department subtasks: ${subtasks.map((subtask) => subtask.title).join(", ")}.`,
  });
  appendTaskProgressEvent(input, {
    task,
    step: "split_complete",
    status: "complete",
    label: "Split complete",
    subjectTaskId: null,
  });
  appendTaskProgressEvent(input, {
    task,
    step: "executing",
    status: "current",
    label: `Task 1 (${subtasks[0].title}) waiting`,
    subjectTaskId: subtasks[0].id,
  });

  return "deferred";
}

function hasAssessment(repositories: ReturnType<typeof createRepositories>, taskId: string): boolean {
  return repositories
    .listTaskProgressEventsForParentTask(taskId)
    .some((event) => event.step === "assessment_complete");
}

function isLargeDepartmentTask(task: Task): boolean {
  const text = `${task.title} ${task.description}`.toLowerCase();
  return (
    (task.proofSchemaId === "landing-page-file" || task.proofSchemaId === "deployment") &&
    text.includes("prototype") &&
    (text.includes("validate") || text.includes("deployment"))
  );
}

function createDepartmentSubtasks(input: RunSchedulerOnceInput, parentTask: Task): Task[] {
  const createId = input.createId ?? defaultCreateId;
  const inheritedDependencies = input.repositories.listTaskDependencies(parentTask.id);
  const subtaskBlueprints = [
    {
      title: `Define executable slice for ${parentTask.title}`,
      description: `Assess scope, dependencies, and proof criteria for the parent task: ${parentTask.title}.`,
      proofSchemaId: "product-brief",
    },
    {
      title: `Execute ${parentTask.title}`,
      description: parentTask.description,
      proofSchemaId: parentTask.proofSchemaId,
    },
    {
      title: `Validate proof for ${parentTask.title}`,
      description: `Validate the output and prepare parent-task proof for: ${parentTask.title}.`,
      proofSchemaId: "test-output",
    },
  ];

  return subtaskBlueprints.map((blueprint) => {
    const subtaskId = createId("department_subtask");
    const taskWorkspace = createTaskWorkspace(input.projectRoot, subtaskId);
    const subtask: Task = {
      id: subtaskId,
      companyId: parentTask.companyId,
      departmentId: parentTask.departmentId,
      keyResultId: parentTask.keyResultId,
      title: blueprint.title,
      description: blueprint.description,
      assigneeAgentId: parentTask.assigneeAgentId,
      requiredCapabilities: parentTask.requiredCapabilities,
      proofSchemaId: blueprint.proofSchemaId,
      workspacePath: taskWorkspace.root,
      artifactWorkspacePath: blueprint.proofSchemaId === parentTask.proofSchemaId ? taskWorkspace.root : null,
      status: "queued",
      riskLevel: parentTask.riskLevel,
      position: input.repositories.getNextTaskPosition(parentTask.companyId),
      latestFailureReason: null,
      latestFailureMessage: null,
      latestExecutionProfileName: null,
      latestRequestedTimeoutMs: null,
      latestEffectiveTimeoutMs: null,
      dependencyNote: null,
      parentTaskId: parentTask.id,
      taskKind: "department_subtask",
      source: "department",
    };
    input.repositories.createTask(subtask);
    for (const dependency of inheritedDependencies) {
      input.repositories.createTaskDependency({
        taskId: subtask.id,
        dependsOnTaskId: dependency.dependsOnTaskId,
        handoffContract: dependency.handoffContract,
        handoffContractText: dependency.handoffContractText,
      });
    }
    input.repositories.createTaskDependency({
      taskId: parentTask.id,
      dependsOnTaskId: subtask.id,
      handoffContract: "Contribute to the parent task proof summary.",
    });
    return subtask;
  });
}

function appendTaskProgressEvent(
  input: RunSchedulerOnceInput,
  event: {
    task: Task;
    step: TaskProgressEvent["step"];
    status: TaskProgressEvent["status"];
    label: string;
    detail?: string | null;
    subjectTaskId: string | null;
  },
): void {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;
  const parentTaskId = event.task.parentTaskId ?? event.task.id;
  const existing = input.repositories
    .listTaskProgressEventsForParentTask(parentTaskId)
    .some(
      (candidate) =>
        candidate.step === event.step &&
        candidate.subjectTaskId === event.subjectTaskId &&
        candidate.label === event.label,
    );

  if (existing) {
    return;
  }

  input.repositories.appendTaskProgressEvent({
    id: createId("task_progress"),
    companyId: event.task.companyId,
    departmentId: event.task.departmentId,
    parentTaskId,
    subjectTaskId: event.subjectTaskId,
    step: event.step,
    status: event.status,
    label: event.label,
    detail: event.detail ?? null,
    createdAt: now().toISOString(),
  });
}

function resolveRunWorkspace(repositories: ReturnType<typeof createRepositories>, task: Task): string | null {
  const dependencies = repositories.listTaskDependencies(task.id);
  const producer = dependencies
    .map((dependency) => repositories.getTask(dependency.dependsOnTaskId))
    .find((dependency): dependency is Task => Boolean(dependency?.artifactWorkspacePath));

  return producer?.artifactWorkspacePath ?? null;
}

function blockDirectDependencyConsumers(input: RunSchedulerOnceInput, failedTask: Task): string[] {
  const blocked: string[] = [];
  for (const consumer of input.repositories.listDependencyConsumers(failedTask.id)) {
    if (consumer.status !== "queued") {
      continue;
    }
    blockTaskForDependency(input, consumer, failedTask, "dependency_failed", `Blocked by failed dependency: ${failedTask.title}.`);
    blocked.push(consumer.id);
  }
  return blocked;
}

function createPartialOutputFollowUpTask(
  input: RunSchedulerOnceInput,
  failedTask: Task,
  failureReason: SchedulerFailureReason,
  failureMessage: string,
  logPath: string,
): Task | null {
  if (!failedTask.artifactWorkspacePath || isPartialOutputFollowUpTask(failedTask)) {
    return null;
  }

  const existingFollowUp = input.repositories
    .listTasksForCompany(failedTask.companyId)
    .find((task) => task.description.includes(partialOutputSourceMarker(failedTask.id)));

  if (existingFollowUp) {
    input.repositories.replaceDependencyConsumers(failedTask.id, existingFollowUp.id);
    return existingFollowUp;
  }

  const createId = input.createId ?? defaultCreateId;
  const followUpTask: Task = {
    id: createId("follow_up_task"),
    companyId: failedTask.companyId,
    departmentId: failedTask.departmentId,
    keyResultId: failedTask.keyResultId,
    title: `Continue from Partial Output: ${failedTask.title}`,
    description: buildPartialOutputFollowUpDescription(failedTask, failureReason, failureMessage, logPath),
    assigneeAgentId: failedTask.assigneeAgentId,
    requiredCapabilities: failedTask.requiredCapabilities,
    proofSchemaId: failedTask.proofSchemaId,
    workspacePath: failedTask.artifactWorkspacePath,
    artifactWorkspacePath: failedTask.artifactWorkspacePath,
    status: "queued",
    riskLevel: failedTask.riskLevel,
    position: input.repositories.getNextTaskPosition(failedTask.companyId),
    latestFailureReason: null,
    latestFailureMessage: null,
    latestExecutionProfileName: null,
    latestRequestedTimeoutMs: null,
    latestEffectiveTimeoutMs: null,
    dependencyNote: null,
  };

  input.repositories.createTask(followUpTask);
  input.repositories.replaceDependencyConsumers(failedTask.id, followUpTask.id);
  appendAndEmitTaskEvent(input, {
    task: failedTask,
    type: "task_warning",
    message: `Follow-up task created: ${followUpTask.title} will continue from Partial Output at ${failedTask.artifactWorkspacePath}.`,
    status: "failed",
    artifactWorkspacePath: failedTask.artifactWorkspacePath,
  });

  return followUpTask;
}

function isPartialOutputFollowUpTask(task: Task): boolean {
  return task.description.includes("Partial Output Source Task:");
}

function partialOutputSourceMarker(taskId: string): string {
  return `Partial Output Source Task: ${taskId}`;
}

function buildPartialOutputFollowUpDescription(
  failedTask: Task,
  failureReason: SchedulerFailureReason,
  failureMessage: string,
  logPath: string,
): string {
  return [
    "Continue the failed task from its Partial Output and produce valid Proof for the original proof schema.",
    "",
    partialOutputSourceMarker(failedTask.id),
    `Original Task: ${failedTask.title}`,
    `Original Proof Schema: ${failedTask.proofSchemaId}`,
    `Failure Reason: ${failureReason}`,
    `Failure Message: ${failureMessage}`,
    `Partial Output Workspace: ${failedTask.artifactWorkspacePath}`,
    `Agent Log: ${logPath}`,
    "",
    "Partial Output is not Proof. Inspect and improve the existing files, keep useful work, and finish the missing deliverable.",
    ...buildProofContractInstructions(failedTask),
    "Do not mark the task complete unless you leave proof that satisfies the original proof schema.",
  ].join("\n");
}

function blockTaskForDependency(
  input: RunSchedulerOnceInput,
  task: Task,
  dependency: Task,
  failureReason: Extract<SchedulerFailureReason, "dependency_failed" | "needs_replan">,
  dependencyNote: string,
): void {
  const failureMessage = `Task blocked: ${task.title} / ${failureReason} / ${dependency.title} is ${dependency.status}.`;
  input.repositories.updateTaskStatus(task.id, "blocked");
  input.repositories.updateTaskExecutionSummary(task.id, {
    latestFailureReason: failureReason,
    latestFailureMessage: failureMessage,
    dependencyNote,
  });
  appendAndEmitTaskEvent(input, {
    task,
    type: "task_blocked",
    message: failureMessage,
    status: "blocked",
    failureReason,
    failureMessage,
    dependencyNote,
  });
  recordTaskCompletionEvent({
    repositories: input.repositories,
    task,
    outcome: "blocked",
    dependencyImpact: {
      blockedByTaskId: dependency.id,
      reason: failureReason,
    },
    now: input.now,
    createId: input.createId,
  });
}

function blockTaskForMissingDeliverable(
  input: RunSchedulerOnceInput,
  task: Task,
  dependency: Task,
  dependencyNote: string,
): void {
  const failureReason = "missing_deliverable";
  const failureMessage = `Task blocked: ${task.title} / missing_deliverable / ${dependency.title} has no accepted business artifact.`;
  input.repositories.updateTaskStatus(task.id, "blocked");
  input.repositories.updateTaskExecutionSummary(task.id, {
    latestFailureReason: failureReason,
    latestFailureMessage: failureMessage,
    dependencyNote,
  });
  appendAndEmitTaskEvent(input, {
    task,
    type: "deliverable_missing",
    message: failureMessage,
    status: "blocked",
    failureReason,
    failureMessage,
    dependencyNote,
  });
  recordTaskCompletionEvent({
    repositories: input.repositories,
    task,
    outcome: "blocked",
    dependencyImpact: {
      blockedByTaskId: dependency.id,
      reason: failureReason,
    },
    now: input.now,
    createId: input.createId,
  });
}

/**
 * If the task has reached the Bounded Recovery ceiling, terminate it as `blocked` / `retry_exhausted`,
 * route it to the CEO Blocked Queue, record the outcome, and return true so the caller can stop.
 */
function endedAtRetryCeiling(
  input: RunSchedulerOnceInput,
  result: RunSchedulerOnceResult,
  task: Task,
  agentRunId: string | null,
  timeoutResolution: ReturnType<typeof resolveEffectiveTimeout>,
  now: () => Date,
  createId: (prefix: string) => string,
): boolean {
  if (taskAttemptCount(input.repositories, task.id) < MAX_TASK_ATTEMPTS) {
    return false;
  }
  result.blocked.push(
    task.id,
    ...terminateAsRetryExhausted(input, task, agentRunId, timeoutResolution, now, createId),
  );
  return true;
}

function terminateAsRetryExhausted(
  input: RunSchedulerOnceInput,
  task: Task,
  agentRunId: string | null,
  timeoutResolution: ReturnType<typeof resolveEffectiveTimeout>,
  now: () => Date,
  createId: (prefix: string) => string,
): string[] {
  if (agentRunId) {
    input.repositories.updateAgentRunStatus(agentRunId, "failed", now().toISOString(), {
      failureReason: "retry_exhausted",
      failureMessage: retryExhaustedFailureMessage(task),
    });
  }
  const blockedConsumerIds = blockDirectDependencyConsumers(input, task);
  const termination = terminateTaskAsRetryExhausted({
    repositories: input.repositories,
    task,
    executionProfileName: timeoutResolution.executionProfile.name,
    requestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
    effectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
    dependencyImpact: { blockedTaskIds: blockedConsumerIds, reason: "retry_exhausted" },
    now,
    createId,
  });
  if (termination) {
    emitTaskEvent(input, termination.taskEvent);
  }
  emitParentTaskAggregationEvents(input, task);
  return blockedConsumerIds;
}

function appendAndEmitTaskEvent(
  input: RunSchedulerOnceInput,
  event: {
    task: Task;
    type: TaskEvent["type"];
    message: string;
    status?: TaskStatus;
    failureReason?: SchedulerFailureReason;
    failureMessage?: string;
    executionProfileName?: string;
    requestedTimeoutMs?: number;
    effectiveTimeoutMs?: number;
    dependencyNote?: string;
    artifactWorkspacePath?: string;
  },
): void {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? defaultCreateId;
  const record: TaskEvent = {
    id: createId("task_event"),
    companyId: event.task.companyId,
    taskId: event.task.id,
    type: event.type,
    message: event.message,
    createdAt: now().toISOString(),
    status: event.status ?? null,
    failureReason: event.failureReason ?? null,
    failureMessage: event.failureMessage ?? null,
    executionProfileName: event.executionProfileName ?? null,
    requestedTimeoutMs: event.requestedTimeoutMs ?? null,
    effectiveTimeoutMs: event.effectiveTimeoutMs ?? null,
    dependencyNote: event.dependencyNote ?? null,
    artifactWorkspacePath: event.artifactWorkspacePath ?? null,
  };
  input.repositories.appendTaskEvent(record);
  emitTaskEvent(input, record);
}

function emitParentTaskAggregationEvents(input: RunSchedulerOnceInput, task: Task): void {
  if ((task.taskKind ?? "parent") !== "department_subtask") {
    return;
  }

  const aggregation = propagateParentTaskAggregation({
    repositories: input.repositories,
    sourceSubtaskId: task.id,
    now: input.now,
    createId: input.createId,
  });
  for (const update of aggregation.updatedTasks) {
    if (update.event) {
      emitTaskEvent(input, update.event);
    }
  }
}

function emitTaskEvent(input: RunSchedulerOnceInput, record: TaskEvent): void {
  input.emit({
    type: record.type,
    taskId: record.taskId,
    message: record.message,
    status: record.status ?? undefined,
    failureReason: record.failureReason ?? undefined,
    failureMessage: record.failureMessage ?? undefined,
    executionProfileName: record.executionProfileName ?? undefined,
    requestedTimeoutMs: record.requestedTimeoutMs ?? undefined,
    effectiveTimeoutMs: record.effectiveTimeoutMs ?? undefined,
    dependencyNote: record.dependencyNote ?? undefined,
    artifactWorkspacePath: record.artifactWorkspacePath ?? undefined,
  });
}

function selectAdapter(adapters: AgentAdapter[], task: Task): AgentAdapter {
  const byAssignee = adapters.find((adapter) => adapter.id === task.assigneeAgentId);

  if (byAssignee) {
    return byAssignee;
  }

  const requiredCapabilities = new Set(task.requiredCapabilities);
  const byCapability = adapters.find((adapter) =>
    [...requiredCapabilities].every((capability) => adapter.capabilities.includes(capability)),
  );

  if (byCapability) {
    return byCapability;
  }

  throw new Error(`No adapter available for task ${task.id}`);
}

function createLogPath(projectRoot: string, task: Task): string {
  const logsDir = join(projectRoot, ".auto-crop", "companies", task.companyId, "logs");
  mkdirSync(logsDir, { recursive: true });
  return join(logsDir, `${task.id}.log`);
}

function businessArtifactFailureReason(artifact: BusinessArtifact | null): SchedulerFailureReason {
  if (!artifact) {
    return "missing_business_artifact";
  }
  if (artifact.validationStatus === "invalid_drift") {
    return "direction_drift";
  }
  if (artifact.validationStatus === "stale" || !artifact.isCurrent) {
    return "stale_business_artifact";
  }
  if (artifact.validationStatus !== "valid") {
    return hasArtifactReason(artifact, "missing_business_artifact_file")
      ? "missing_business_artifact"
      : "invalid_business_artifact";
  }
  return "non_reviewable_artifact";
}

function businessArtifactFailureMessage(task: Task, artifact: BusinessArtifact | null): string {
  if (!artifact) {
    return `Task blocked: ${task.title} / missing_business_artifact.`;
  }
  const errors = artifact.validationErrors.length > 0 ? ` / ${JSON.stringify(artifact.validationErrors)}` : "";
  return `Task blocked: ${task.title} / ${businessArtifactFailureReason(artifact)} / ${artifact.artifactKind}/${artifact.artifactRole}/${artifact.artifactSubtype}${errors}.`;
}

function hasArtifactReason(artifact: BusinessArtifact, reason: string): boolean {
  return (
    typeof artifact.payload === "object" &&
    artifact.payload !== null &&
    !Array.isArray(artifact.payload) &&
    "reason" in artifact.payload &&
    artifact.payload.reason === reason
  );
}

function replanMessage(task: Task, timeoutMs: number): string {
  return `Task needs replanning: ${task.title} / exceeded long budget ${formatExecutionBudget(timeoutMs)}.`;
}

function failureMessage(task: Task, failureReason: SchedulerFailureReason, timeoutMs: number): string {
  if (failureReason === "timeout") {
    return `Task failed: ${task.title} / timeout after ${formatExecutionBudget(timeoutMs)}.`;
  }

  if (failureReason === "no_proof") {
    if (task.proofSchemaId === "repo-diff") {
      return `Task failed: ${task.title} / no_proof / repo-diff proof missing: expected .auto-crop-proof/*.diff or a top-level workspace *.diff/*.patch file; .auto-crop/business-artifact.json is not diff proof.`;
    }
    return `Task failed: ${task.title} / no_proof.`;
  }

  if (failureReason === "proof_capture_failed") {
    return `Task failed: ${task.title} / proof_capture_failed.`;
  }

  return `Task failed: ${task.title} / agent_failed.`;
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
