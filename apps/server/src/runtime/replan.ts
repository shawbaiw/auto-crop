import type { ReplanProposal, Task, TaskEvent } from "@auto-crop/core";
import type { createRepositories } from "../db/repositories";
import { createTaskWorkspace } from "./workspace";

export type CreateReplanProposalInput = {
  repositories: ReturnType<typeof createRepositories>;
  taskId: string;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export type ConfirmReplanProposalInput = {
  projectRoot: string;
  repositories: ReturnType<typeof createRepositories>;
  proposalId: string;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export type ConfirmReplanProposalResult = {
  proposal: ReplanProposal;
  sourceTask: Task;
  createdTasks: Task[];
};

export function createReplanProposalForTask(input: CreateReplanProposalInput): ReplanProposal {
  const task = input.repositories.getTask(input.taskId);

  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }

  if (task.status !== "needs_replan") {
    throw new Error(`Task ${task.id} does not need replanning.`);
  }

  const existing = input.repositories
    .listReplanProposalsForTask(task.id)
    .find((proposal) => proposal.status === "proposed");

  if (existing) {
    return existing;
  }

  const now = (input.now ?? (() => new Date()))().toISOString();
  const createId = input.createId ?? defaultCreateId;
  const proposal: ReplanProposal = {
    id: createId("replan_proposal"),
    companyId: task.companyId,
    sourceTaskId: task.id,
    status: "proposed",
    rationale: `${task.title} exceeded the long execution budget and should be split into smaller proof-backed tasks.`,
    replacementTasks: buildReplacementTasks(task),
    createdAt: now,
    confirmedAt: null,
  };

  input.repositories.createReplanProposal(proposal);

  return proposal;
}

export function confirmReplanProposal(input: ConfirmReplanProposalInput): ConfirmReplanProposalResult {
  const proposal = input.repositories.getReplanProposal(input.proposalId);

  if (!proposal) {
    throw new Error(`Replan proposal not found: ${input.proposalId}`);
  }

  if (proposal.status !== "proposed") {
    throw new Error(`Replan proposal ${proposal.id} is not proposed.`);
  }

  const sourceTask = input.repositories.getTask(proposal.sourceTaskId);

  if (!sourceTask) {
    throw new Error(`Source task not found: ${proposal.sourceTaskId}`);
  }

  const now = (input.now ?? (() => new Date()))().toISOString();
  const createId = input.createId ?? defaultCreateId;
  const basePosition = input.repositories.getNextTaskPosition(sourceTask.companyId);
  const createdTasks = proposal.replacementTasks.map((replacement, index) => {
    const taskId = createId("task");
    const taskWorkspace = createTaskWorkspace(input.projectRoot, taskId);
    const task: Task = {
      id: taskId,
      companyId: sourceTask.companyId,
      departmentId: sourceTask.departmentId,
      keyResultId: sourceTask.keyResultId,
      title: replacement.title,
      description: replacement.description,
      assigneeAgentId: sourceTask.assigneeAgentId,
      requiredCapabilities: replacement.requiredCapabilities,
      proofSchemaId: replacement.proofSchemaId,
      workspacePath: taskWorkspace.root,
      artifactWorkspacePath: isArtifactProducer(replacement.proofSchemaId) ? taskWorkspace.root : null,
      status: "queued",
      riskLevel: replacement.riskLevel,
      position: basePosition + index,
      latestFailureReason: null,
      latestFailureMessage: null,
      latestExecutionProfileName: null,
      latestRequestedTimeoutMs: null,
      latestEffectiveTimeoutMs: null,
      dependencyNote: null,
    };
    input.repositories.createTask(task);
    return task;
  });

  for (let index = 1; index < createdTasks.length; index += 1) {
    input.repositories.createTaskDependency({
      taskId: createdTasks[index]!.id,
      dependsOnTaskId: createdTasks[index - 1]!.id,
    });
  }

  const finalTask = createdTasks.at(-1);

  if (finalTask) {
    input.repositories.replaceDependencyConsumers(sourceTask.id, finalTask.id);
  }

  input.repositories.updateTaskStatus(sourceTask.id, "blocked");
  input.repositories.updateTaskExecutionSummary(sourceTask.id, {
    latestFailureReason: "needs_replan",
    latestFailureMessage: `Task replaced by replan proposal ${proposal.id}.`,
    dependencyNote: `Replaced by replan proposal ${proposal.id}.`,
  });
  input.repositories.updateReplanProposalStatus(proposal.id, "confirmed", now);
  input.repositories.appendTaskEvent({
    id: createId("task_event"),
    companyId: sourceTask.companyId,
    taskId: sourceTask.id,
    type: "task_blocked",
    message: `Task replaced by replan proposal ${proposal.id}.`,
    createdAt: now,
    status: "blocked",
    failureReason: "needs_replan",
    failureMessage: `Task replaced by replan proposal ${proposal.id}.`,
    executionProfileName: null,
    requestedTimeoutMs: null,
    effectiveTimeoutMs: null,
    dependencyNote: `Replaced by replan proposal ${proposal.id}.`,
    artifactWorkspacePath: sourceTask.artifactWorkspacePath ?? null,
  } satisfies TaskEvent);

  return {
    proposal: input.repositories.getReplanProposal(proposal.id) ?? proposal,
    sourceTask: input.repositories.getTask(sourceTask.id) ?? sourceTask,
    createdTasks,
  };
}

function buildReplacementTasks(task: Task): ReplanProposal["replacementTasks"] {
  return [
    {
      title: `Plan smaller slice for ${task.title}`,
      description: `Define a narrower, proof-backed slice that can replace: ${task.description}`,
      requiredCapabilities: ["writing", "research"],
      proofSchemaId: "product-brief",
      riskLevel: "low",
    },
    {
      title: `Produce proof for ${task.title}`,
      description: `Execute the narrowed task slice and produce the required deliverable for: ${task.title}`,
      requiredCapabilities: task.requiredCapabilities,
      proofSchemaId: task.proofSchemaId,
      riskLevel: task.riskLevel,
    },
    {
      title: `Validate replacement output for ${task.title}`,
      description: `Validate the replacement output for ${task.title} and capture command output proof.`,
      requiredCapabilities: ["code", "test"],
      proofSchemaId: "test-output",
      riskLevel: task.riskLevel,
    },
  ];
}

function isArtifactProducer(proofSchemaId: string): boolean {
  return proofSchemaId === "landing-page-file" || proofSchemaId === "repo-diff";
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
