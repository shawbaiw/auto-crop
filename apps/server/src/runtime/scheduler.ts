import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentAdapter, AgentRunResult } from "../adapters/types";
import type { createRepositories } from "../db/repositories";
import type {
  AgentFailureReason,
  BusinessArtifact,
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
import { acceptTaskBusinessArtifact } from "./businessAcceptance";
import {
  captureBusinessArtifact,
  isReviewableBusinessArtifact,
  readEnvironmentBlockerClaim,
  verifyEnvironmentBlockerClaim,
} from "./businessArtifact";
import { resolveDependencyReadiness, type TaskHandoff } from "./dependencyReadiness";
import { parseOpenDecisions } from "./founderDecision";
import { formatExecutionBudget, resolveEffectiveTimeout, resolveRetryTimeout } from "./executionProfile";
import { propagateParentTaskAggregation } from "./parentTaskAggregation";
import { createHandoffPackage } from "./proof";
import { buildProofContractInstructions } from "./proofContract";
import { reconcileReviewTasksForAutomaticAcceptance } from "./reviewReconciliation";
import { reconcileStaleRunningTasks } from "./taskRecovery";
import { recordTaskCompletionEvent } from "./taskCompletion";
import { cleanupGeneratedWorkspaceArtifacts, createTaskWorkspace } from "./workspace";

export type SchedulerFailureReason = AgentFailureReason;

export type SchedulerEvent = {
  type: TaskEvent["type"];
  taskId: string;
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
    // One-time, idempotent migration pass (ADR 0017 §Migration): accept `review` tasks the
    // deterministic model would have accepted. A no-op once every such task is `complete`; any
    // newly-queued downstream is picked up by `fetchQueuedTasks` in this same tick.
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

            agentResult = await adapter.run({
              taskId: task.id,
              prompt: buildAgentPrompt(task, handoffs),
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

            const accepted = acceptTaskBusinessArtifact({
              repositories: input.repositories,
              task,
              artifact: businessArtifact,
              acceptanceProvenance: "automatic_acceptance",
              eventType: "automatic_acceptance",
              eventMessage: `Automatic Acceptance accepted task: ${task.title}.`,
              keyResultProgress: { currentValue: "accepted_business_artifact", status: "met" },
              dependencyCascade: { maxDepth: 2 },
              requestSchedulerWake: () => undefined,
              now,
              createId,
            });
            emitTaskEvent(input, accepted.event);
            for (const update of accepted.dependencyCascade?.updatedTasks ?? []) {
              if (update.event) {
                emitTaskEvent(input, update.event);
              }
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

  return result;
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

function buildAgentPrompt(task: Task, handoffs: TaskHandoff[]): string {
  const artifactInstructions = [
    "## Business Artifact",
    "",
    "Write a structured business artifact to `.auto-crop/business-artifact.json` before finishing.",
    "Use this JSON shape:",
    JSON.stringify(
      {
        artifact_kind: "deliverable",
        artifact_role: "implementation",
        artifact_subtype: "prototype_implementation",
        task_type: "task-specific-type",
        payload: { outcome_summary: "..." },
        lineage: {},
      },
      null,
      2,
    ),
    "Choose artifact_kind from: deliverable, blocker, decision_request, direction_change_request, final_report.",
    "Choose artifact_role from: findings, plan, spec, implementation, validation, launch, report, none.",
    "Put use-case-specific names such as keyword_research, mvp_brief, or seo_launch_plan in artifact_subtype, not in artifact_kind or artifact_role.",
    "Use payload for the task-specific structured result and lineage for the upstream objective chain you used.",
    "",
    "## Task Outcome Summary",
    "",
    "Every `deliverable` and `final_report` payload must include an `outcome_summary` field: a plain-language",
    "string (or a `{ \"en\": \"...\", \"zh\": \"...\" }` object) the founder reads instead of your raw output. State, in order:",
    "1. The conclusion you reached.",
    "2. What that conclusion means for the objective or vision this task serves.",
    "3. What gap still remains toward the vision (in prose) — completing the task is not the same as reaching the goal.",
    "Add a fourth part only when you are leaving a strategic choice that is the founder's to make: list the",
    "viable options with their trade-offs and say which one you recommend.",
    "Write business judgement, not process notes; a missing `outcome_summary` fails validation.",
    "",
    "## Open Decisions",
    "",
    "If you make a choice on a strategic business decision whose first value is the founder's to set —",
    "one of: target_market, product_direction, mvp_type, pricing_model, launch_target — do NOT let your",
    "pick stand as direction. Declare it in a `payload.open_decisions` array so the runtime routes it to",
    "the founder. Each entry:",
    JSON.stringify(
      {
        decisionKind: "pricing_model",
        options: [
          { label: "Flat monthly fee", tradeoffs: "Predictable revenue; leaves heavy users underpriced." },
          { label: "Usage-based", tradeoffs: "Scales with value delivered; harder for buyers to forecast." },
        ],
        recommendation: "Flat monthly fee",
        rationale: "Early buyers want a predictable bill and the usage spread is still narrow.",
      },
      null,
      2,
    ),
    "`decisionKind` must be one of the five kinds above (any other choice is your own call and is ignored).",
    "Give more than one option, each with its trade-offs; name the recommended option and give your rationale.",
    "A choice on one of these kinds is the founder's to make, not yours.",
  ];
  const proofInstructions = buildProofContractInstructions(task);

  if (handoffs.length === 0) {
    return [task.description, "", ...artifactInstructions, "", ...proofInstructions].join("\n");
  }

  return [
    task.description,
    "",
    ...artifactInstructions,
    "",
    ...proofInstructions,
    "",
    "## Upstream Handoffs",
    "",
    ...handoffs.flatMap((handoff, index) => [
      `${index + 1}. Task: ${handoff.upstreamTaskTitle}`,
      `   Business Artifact: ${handoff.artifactKind} / ${handoff.artifactRole} / ${handoff.artifactSubtype} / ${handoff.businessArtifactId}`,
      `   Task Type: ${handoff.taskType}`,
      `   Payload: ${JSON.stringify(handoff.payload)}`,
      `   Lineage: ${JSON.stringify(handoff.lineage)}`,
      ...(handoff.proofId ? [`   Source Proof: ${handoff.proofType} / ${handoff.proofId}`] : []),
      ...(handoff.uri ? [`   Source URI: ${handoff.uri}`] : []),
      ...(handoff.summary ? [`   Summary: ${handoff.summary}`] : []),
      ...(handoff.handoffContract ? [`   Handoff Contract: ${handoff.handoffContract}`] : []),
      ...(handoff.handoffPackagePath ? [`   Handoff Package: ${handoff.handoffPackagePath}`] : []),
      ...(handoff.artifactWorkspacePath ? [`   Artifact Workspace: ${handoff.artifactWorkspacePath}`] : []),
    ]),
  ].join("\n");
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
