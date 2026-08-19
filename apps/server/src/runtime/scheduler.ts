import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentAdapter } from "../adapters/types";
import type { createRepositories } from "../db/repositories";
import type { AgentFailureReason, Proof, Task, TaskEvent, TaskStatus } from "@auto-crop/core";
import { formatExecutionBudget, resolveEffectiveTimeout } from "./executionProfile";
import { createTaskWorkspace } from "./workspace";

export type SchedulerFailureReason = AgentFailureReason;

export type SchedulerEvent = {
  type: "task_started" | "task_review" | "task_failed" | "task_blocked" | "task_warning" | "partial_output";
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

    const dependencyDecision = resolveDependencyDecision(input.repositories, task);
    if (dependencyDecision.kind === "waiting") {
      if (task.dependencyNote !== dependencyDecision.note) {
        input.repositories.updateTaskExecutionSummary(task.id, { dependencyNote: dependencyDecision.note });
        appendAndEmitTaskEvent(input, {
          task,
          type: "task_warning",
          message: dependencyDecision.note,
          status: "queued",
          dependencyNote: dependencyDecision.note,
        });
      }
      continue;
    }

    if (dependencyDecision.kind === "failed") {
      blockTaskForDependency(input, task, dependencyDecision.dependency);
      result.blocked.push(task.id);
      continue;
    }

    dispatches.push(
      (async () => {
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

          const timeoutResolution = resolveEffectiveTimeout(task);
          input.repositories.updateTaskStatus(task.id, "running");
          input.repositories.updateTaskExecutionSummary(task.id, {
            latestFailureReason: null,
            latestFailureMessage: null,
            latestExecutionProfileName: timeoutResolution.executionProfile.name,
            latestRequestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
            latestEffectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
            dependencyNote: null,
          });
          result.started.push(task.id);
          for (const warning of timeoutResolution.warnings) {
            appendAndEmitTaskEvent(input, {
              task,
              type: "task_warning",
              message: `Task warning: ${task.title} / ${warning}`,
              status: "queued",
              executionProfileName: timeoutResolution.executionProfile.name,
              requestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
              effectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
            });
          }
          appendAndEmitTaskEvent(input, {
            task,
            type: "task_started",
            message: `Task started: ${task.title} (${task.assigneeAgentId}, ${timeoutResolution.executionProfile.name} budget ${formatExecutionBudget(timeoutResolution.effectiveTimeoutMs)}).`,
            status: "running",
            executionProfileName: timeoutResolution.executionProfile.name,
            requestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
            effectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
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
          const agentRunId = createId("agent_run");
          input.repositories.createAgentRun({
            id: agentRunId,
            taskId: task.id,
            agentId: adapter.id,
            status: "running",
            logPath,
            startedAt: acquiredAt,
            finishedAt: null,
            executionProfileName: timeoutResolution.executionProfile.name,
            requestedTimeoutMs: timeoutResolution.requestedTimeoutMs,
            effectiveTimeoutMs: timeoutResolution.effectiveTimeoutMs,
            failureReason: null,
            failureMessage: null,
          });

          const agentResult = await adapter.run({
            taskId: task.id,
            prompt: task.description,
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
            result.blocked.push(...blockDirectDependencyConsumers(input, task));
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
      })(),
    );
  }

  await Promise.all(dispatches);

  return result;
}

type DependencyDecision =
  | { kind: "ready" }
  | { kind: "waiting"; note: string }
  | { kind: "failed"; dependency: Task };

function resolveDependencyDecision(
  repositories: ReturnType<typeof createRepositories>,
  task: Task,
): DependencyDecision {
  const dependencies = repositories.listTaskDependencies(task.id);

  for (const dependency of dependencies) {
    const upstream = repositories.getTask(dependency.dependsOnTaskId);
    if (!upstream) {
      continue;
    }

    if (upstream.status === "failed" || upstream.status === "blocked" || upstream.status === "cancelled") {
      return { kind: "failed", dependency: upstream };
    }

    if (upstream.status !== "review" && upstream.status !== "complete") {
      return { kind: "waiting", note: `Waiting for dependency: ${upstream.title} (${upstream.status}).` };
    }
  }

  return { kind: "ready" };
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
    blockTaskForDependency(input, consumer, failedTask);
    blocked.push(consumer.id);
  }
  return blocked;
}

function blockTaskForDependency(input: RunSchedulerOnceInput, task: Task, dependency: Task): void {
  const failureReason = "dependency_failed";
  const failureMessage = `Task blocked: ${task.title} / dependency_failed / ${dependency.title} is ${dependency.status}.`;
  input.repositories.updateTaskStatus(task.id, "blocked");
  input.repositories.updateTaskExecutionSummary(task.id, {
    latestFailureReason: failureReason,
    latestFailureMessage: failureMessage,
    dependencyNote: `Blocked by failed dependency: ${dependency.title}.`,
  });
  appendAndEmitTaskEvent(input, {
    task,
    type: "task_blocked",
    message: failureMessage,
    status: "blocked",
    failureReason,
    failureMessage,
    dependencyNote: `Blocked by failed dependency: ${dependency.title}.`,
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
