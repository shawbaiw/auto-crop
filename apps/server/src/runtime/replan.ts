import { writeFileSync } from "node:fs";
import type { ReplanProposal, Task, TaskEvent } from "@auto-crop/core";
import type { AgentAdapter } from "../adapters/types";
import type { createRepositories } from "../db/repositories";
import type { Playbook } from "../playbooks/types";
import { defaultAgentSessionManager, type AgentSessionManager, type AgentSessionRunEvent } from "./agentSessions";
import { buildReplanPlannerPrompt, parseReplanPlannerOutput } from "./replanPlanner";
import { resolveAgentSessionPolicy } from "./sessionPolicy";
import { createCompanyWorkspace, createTaskWorkspace } from "./workspace";

type PlannerAttempt =
  | {
      kind: "success";
      agentId: string;
      promptPath: string;
      rationale: string;
      replacementTasks: ReplanProposal["replacementTasks"];
    }
  | {
      kind: "failed";
      agentId: string | null;
      promptPath: string | null;
      reason: "agent_failed" | "parse_failed";
      message: string;
    }
  | {
      kind: "not_configured";
    };

export type CreateReplanProposalInput = {
  repositories: ReturnType<typeof createRepositories>;
  taskId: string;
  projectRoot?: string;
  plannerAgent?: AgentAdapter;
  playbook?: Playbook;
  agentSessionManager?: AgentSessionManager;
  agentSessionEnv?: Record<string, string | undefined>;
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

export async function createReplanProposalForTask(input: CreateReplanProposalInput): Promise<ReplanProposal> {
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
  const plannerAttempt = await tryCreatePlannerResponse(input, task);
  const plannerSucceeded = plannerAttempt.kind === "success";
  const proposal: ReplanProposal = {
    id: createId("replan_proposal"),
    companyId: task.companyId,
    sourceTaskId: task.id,
    status: "proposed",
    proposalSource: plannerSucceeded ? "planner_agent" : "deterministic_template",
    plannerAgentId: plannerAttempt.kind === "not_configured" ? null : plannerAttempt.agentId,
    plannerPromptPath: plannerAttempt.kind === "not_configured" ? null : plannerAttempt.promptPath,
    plannerFailureReason: plannerAttempt.kind === "failed" ? plannerAttempt.reason : null,
    plannerFailureMessage: plannerAttempt.kind === "failed" ? plannerAttempt.message : null,
    rationale:
      (plannerSucceeded ? plannerAttempt.rationale : null) ??
      `${task.title} exceeded the long execution budget and should be split into smaller proof-backed tasks.`,
    replacementTasks: (plannerSucceeded ? plannerAttempt.replacementTasks : null) ?? buildReplacementTasks(task),
    createdAt: now,
    confirmedAt: null,
  };

  input.repositories.createReplanProposal(proposal);

  return proposal;
}

async function tryCreatePlannerResponse(input: CreateReplanProposalInput, task: Task): Promise<PlannerAttempt> {
  if (!input.projectRoot || !input.plannerAgent || !input.playbook) {
    return { kind: "not_configured" };
  }

  const company = input.repositories.getCompany(task.companyId);

  if (!company) {
    return { kind: "not_configured" };
  }

  const dependencies = input.repositories.listTaskDependenciesForCompany(task.companyId);
  const downstreamTasks = dependencies
    .filter((dependency) => dependency.dependsOnTaskId === task.id)
    .map((dependency) => input.repositories.getTask(dependency.taskId))
    .filter((downstream): downstream is Task => Boolean(downstream));
  const prompt = buildReplanPlannerPrompt({
    company,
    sourceTask: task,
    downstreamTasks,
    proofSchemas: input.playbook.proofSchemas,
  });
  const companyWorkspace = createCompanyWorkspace(input.projectRoot, task.companyId);
  const promptPath = `${companyWorkspace.companyRoot}/replan-${task.id}-prompt.md`;
  writeFileSync(promptPath, prompt, "utf8");
  const agentRequest = {
    taskId: `${task.id}_replan_planner`,
    prompt,
    promptPath,
    workspacePath: companyWorkspace.companyRoot,
    metadata: {
      companyId: task.companyId,
      sourceTaskId: task.id,
      playbookId: input.playbook.id,
      purpose: "replan_proposal",
    },
  };
  const sessionPolicy = resolveAgentSessionPolicy({
    companyId: task.companyId,
    agentId: input.plannerAgent.id,
    permissionMode: company.permissionMode,
    purpose: "replan_planner",
    env: input.agentSessionEnv,
  });
  const run = await (input.agentSessionManager ?? defaultAgentSessionManager).run({
    adapter: input.plannerAgent,
    request: agentRequest,
    sessionKey: sessionPolicy.status === "enabled" ? sessionPolicy.key : null,
    onSessionEvent: (event) => appendPlannerSessionEvent(input, task, event),
  });
  const result = run.result;

  if (result.status !== "complete") {
    return {
      kind: "failed",
      agentId: input.plannerAgent.id,
      promptPath,
      reason: "agent_failed",
      message: result.stderr.trim() || result.stdout.trim() || "Planner agent failed without output.",
    };
  }

  try {
    return {
      kind: "success",
      agentId: input.plannerAgent.id,
      promptPath,
      ...parseReplanPlannerOutput(result.stdout, input.playbook),
    };
  } catch (error) {
    return {
      kind: "failed",
      agentId: input.plannerAgent.id,
      promptPath,
      reason: "parse_failed",
      message: (error as Error).message,
    };
  }
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

function appendPlannerSessionEvent(
  input: CreateReplanProposalInput,
  task: Task,
  event: AgentSessionRunEvent,
): void {
  if (event.mode === "one_shot") {
    return;
  }

  const createId = input.createId ?? defaultCreateId;
  const createdAt = (input.now ?? (() => new Date()))().toISOString();
  const message =
    event.mode === "persistent_used"
      ? "Planner agent used a persistent session for this replan proposal."
      : `Planner agent persistent session was unavailable (${event.reason ?? "unknown"}); used a one-shot run.`;

  input.repositories.appendTaskEvent({
    id: createId("task_event"),
    companyId: task.companyId,
    taskId: task.id,
    type: "task_warning",
    message,
    createdAt,
    status: task.status,
    failureReason: null,
    failureMessage: null,
    executionProfileName: null,
    requestedTimeoutMs: null,
    effectiveTimeoutMs: null,
    dependencyNote: task.dependencyNote ?? null,
    artifactWorkspacePath: task.artifactWorkspacePath ?? null,
  } satisfies TaskEvent);
}

function isArtifactProducer(proofSchemaId: string): boolean {
  return proofSchemaId === "landing-page-file" || proofSchemaId === "repo-diff";
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
