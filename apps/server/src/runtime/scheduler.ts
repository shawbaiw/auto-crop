import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentAdapter } from "../adapters/types";
import type { createRepositories } from "../db/repositories";
import type { Proof, Task } from "@auto-crop/core";
import { formatExecutionBudget, resolveTaskExecutionProfile } from "./executionProfile";
import { createTaskWorkspace } from "./workspace";

export type SchedulerFailureReason = "timeout" | "agent_failed" | "no_proof" | "proof_capture_failed";

export type SchedulerEvent = {
  type: "task_started" | "task_log" | "task_review" | "task_failed" | "task_blocked";
  taskId: string;
  message: string;
  failureReason?: SchedulerFailureReason;
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

  const queuedTasks = input.repositories.fetchQueuedTasks(input.maxTasks);

  await Promise.all(
    queuedTasks.map(async (task) => {
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
          input.emit({ type: "task_blocked", taskId: task.id, message: "Task requires approval." });
          result.blocked.push(task.id);
          return;
        }

        input.repositories.updateTaskStatus(task.id, "running");
        result.started.push(task.id);
        const executionProfile = resolveTaskExecutionProfile(task);
        input.emit({
          type: "task_started",
          taskId: task.id,
          message: `Task started: ${task.title} (${task.assigneeAgentId}, ${executionProfile.name} budget ${formatExecutionBudget(executionProfile.timeoutMs)}).`,
        });

        const workspace = task.workspacePath
          ? { root: task.workspacePath }
          : createTaskWorkspace(input.projectRoot, task.id);
        if (!task.workspacePath) {
          input.repositories.updateTaskWorkspacePath(task.id, workspace.root);
        }

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
        });

        const agentResult = await adapter.run({
          taskId: task.id,
          prompt: task.description,
          promptPath: "",
          workspacePath: workspace.root,
          metadata: {
            departmentId: task.departmentId,
            proofSchemaId: task.proofSchemaId,
          },
          timeoutMs: executionProfile.timeoutMs,
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
        input.emit({ type: "task_log", taskId: task.id, message: agentResult.stdout });

        let proof: Proof[] = [];
        if (agentResult.status === "complete") {
          try {
            proof = input.proofCollector({
              task: { ...task, workspacePath: workspace.root },
              stdout: agentResult.stdout,
              stderr: agentResult.stderr,
              logPath,
            });
          } catch (error) {
            input.repositories.updateTaskStatus(task.id, "failed");
            input.repositories.updateAgentRunStatus(agentRunId, "failed", now().toISOString());
            input.emit({
              type: "task_failed",
              taskId: task.id,
              failureReason: "proof_capture_failed",
              message: `Task failed: ${task.title} / proof_capture_failed / ${(error as Error).message}`,
            });
            result.failed.push(task.id);
            return;
          }
        }

        for (const item of proof) {
          input.repositories.appendProof(item);
        }

        if (agentResult.status !== "complete" || proof.length === 0) {
          const failureReason = agentResult.status !== "complete" ? (agentResult.failureReason ?? "agent_failed") : "no_proof";
          input.repositories.updateTaskStatus(task.id, "failed");
          input.repositories.updateAgentRunStatus(agentRunId, "failed", now().toISOString());
          input.emit({
            type: "task_failed",
            taskId: task.id,
            failureReason,
            message: failureMessage(task, failureReason, executionProfile.timeoutMs),
          });
          result.failed.push(task.id);
          return;
        }

        input.repositories.updateTaskStatus(task.id, "review");
        input.repositories.updateAgentRunStatus(agentRunId, "complete", now().toISOString());
        input.emit({ type: "task_review", taskId: task.id, message: "Task is ready for review." });
        result.completed.push(task.id);
      } finally {
        input.repositories.releaseTaskLock(task.id, input.workerId);
      }
    }),
  );

  return result;
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
