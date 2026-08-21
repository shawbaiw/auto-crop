import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentAdapter, AgentRunResult } from "../adapters/types";
import type { createRepositories } from "../db/repositories";
import type { AgentFailureReason, Proof, Task, TaskEvent, TaskStatus } from "@auto-crop/core";
import { resolveDependencyReadiness, type TaskHandoff } from "./dependencyReadiness";
import { formatExecutionBudget, resolveEffectiveTimeout, resolveRetryTimeout } from "./executionProfile";
import { createTaskWorkspace } from "./workspace";

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

    dispatches.push(
      (async (handoffs: TaskHandoff[]) => {
        const acquiredAt = now().toISOString();

        if (!input.repositories.acquireTaskLock(task.id, input.workerId, acquiredAt)) {
          return;
        }

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

          const taskWorkspace = task.workspacePath
            ? { root: task.workspacePath }
            : createTaskWorkspace(input.projectRoot, task.id);
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
              prompt: buildAgentPrompt(task.description, handoffs),
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
                task: { ...task, workspacePath: taskWorkspace.root },
                stdout: agentResult.stdout,
                stderr: agentResult.stderr,
                logPath,
              });
            } catch (error) {
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
              result.failed.push(task.id);
              return;
            }
          }

          for (const item of proof) {
            input.repositories.appendProof(item);
          }

          if (agentResult.status !== "complete" || proof.length === 0) {
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
              result.blocked.push(task.id);
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
            result.failed.push(task.id);
            return;
          }

          input.repositories.updateTaskStatus(task.id, "review");
          input.repositories.updateAgentRunStatus(agentRunId, "complete", now().toISOString());
          appendAndEmitTaskEvent(input, {
            task,
            type: "task_review",
            message: "Task is ready for review.",
            status: "review",
          });
          result.completed.push(task.id);
        } finally {
          input.repositories.releaseTaskLock(task.id, input.workerId);
        }
      })(dependencyDecision.handoffs),
    );
  }

  await Promise.all(dispatches);

  return result;
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
}

function blockTaskForMissingDeliverable(
  input: RunSchedulerOnceInput,
  task: Task,
  dependency: Task,
  dependencyNote: string,
): void {
  const failureReason = "missing_deliverable";
  const failureMessage = `Task blocked: ${task.title} / missing_deliverable / ${dependency.title} has no consumable proof.`;
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

function buildAgentPrompt(description: string, handoffs: TaskHandoff[]): string {
  if (handoffs.length === 0) {
    return description;
  }

  return [
    description,
    "",
    "## Upstream Handoffs",
    "",
    ...handoffs.flatMap((handoff, index) => [
      `${index + 1}. Task: ${handoff.upstreamTaskTitle}`,
      `   Proof: ${handoff.proofType} / ${handoff.proofId}`,
      `   URI: ${handoff.uri}`,
      `   Summary: ${handoff.summary}`,
      ...(handoff.handoffContract ? [`   Handoff Contract: ${handoff.handoffContract}`] : []),
      ...(handoff.artifactWorkspacePath ? [`   Artifact Workspace: ${handoff.artifactWorkspacePath}`] : []),
    ]),
  ].join("\n");
}

function replanMessage(task: Task, timeoutMs: number): string {
  return `Task needs replanning: ${task.title} / exceeded long budget ${formatExecutionBudget(timeoutMs)}.`;
}

function failureMessage(task: Task, failureReason: SchedulerFailureReason, timeoutMs: number): string {
  if (failureReason === "timeout") {
    return `Task failed: ${task.title} / timeout after ${formatExecutionBudget(timeoutMs)}.`;
  }

  if (failureReason === "no_proof") {
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
