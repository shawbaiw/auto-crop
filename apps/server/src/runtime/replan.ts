import { writeFileSync } from "node:fs";
import { taskHoldKinds, type ReplanMode, type ReplanProposal, type ReplanTaskDefinition, type Task, type TaskEvent, type TaskHoldKind } from "@auto-crop/core";
import type { AgentAdapter } from "../adapters/types";
import type { createRepositories } from "../db/repositories";
import type { Playbook } from "../playbooks/types";
import { planningCapabilityNeeds, resolveAgentCapabilityGrant, resolveTaskCapabilityNeeds } from "../policies/capabilityGrant";
import { resolvePolicyForPermissionMode } from "../policies/defaults";
import { defaultAgentSessionManager, type AgentSessionManager, type AgentSessionRunEvent } from "./agentSessions";
import { resetTaskAttempts } from "./boundedRecovery";
import { planSnapshot } from "./createCompany";
import { applyTaskTransition } from "./taskTransition";
import { buildReplanPlannerPrompt, parseReplanPlannerOutput, type ReplanPlannerResponse } from "./replanPlanner";
import { isReplanProposalCurrent, resolveReplanBasis, resolveStuckContext, revisableRequirements, verifiersJudging } from "./replanContext";
import { checkTaskAffordance } from "./taskAffordances";
import { resolveAgentSessionPolicy } from "./sessionPolicy";
import { createCompanyWorkspace, createTaskWorkspace } from "./workspace";

type PlannerAttempt =
  | {
      kind: "success";
      agentId: string;
      promptPath: string;
      response: ReplanPlannerResponse;
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
  /** What the founder asked for. Null lets the planner pick. */
  mode?: ReplanMode | null;
  /** The founder's note, for the planner only. */
  note?: string | null;
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
  affectedConsumers: Task[];
};

/**
 * Confirming refused because the task moved after the proposal was made. The founder requests a new
 * proposal; the planner reasoned about a task that no longer exists (ADR 0043).
 */
export class StaleReplanProposalError extends Error {
  constructor(readonly proposal: ReplanProposal) {
    super(`Replan proposal ${proposal.id} was made for a task state that has since changed; request a new proposal.`);
  }
}

/** Replanning asked of a task that does not offer it. The Hold policy is the one place that decides. */
export class ReplanNotOfferedError extends Error {}

export async function createReplanProposalForTask(input: CreateReplanProposalInput): Promise<ReplanProposal> {
  const task = input.repositories.getTask(input.taskId);

  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }

  // The precondition is the affordance, not a status: the Hold policy that offers the exit is the one
  // place that decides whether it exists. A status check here once made every replan offered outside
  // `needs_replan` fail with "does not need replanning" (ADR 0043).
  if (!checkTaskAffordance(input.repositories, task, "request_replan").ok) {
    throw new ReplanNotOfferedError(`Task ${task.id} does not offer replanning in its current state.`);
  }

  const requestedMode = input.mode ?? null;
  const founderNote = input.note?.trim() ? input.note.trim() : null;
  const now = (input.now ?? (() => new Date()))().toISOString();
  const createId = input.createId ?? defaultCreateId;
  const existing = input.repositories
    .listReplanProposalsForTask(task.id)
    .find((proposal) => proposal.status === "proposed");

  if (existing) {
    // Asking twice for the same thing is answered by the proposal already waiting. Anything else — a
    // different mode or note, or a task that has moved since — replaces it.
    if (existing.requestedMode === requestedMode && existing.founderNote === founderNote && isReplanProposalCurrent(input.repositories, existing)) {
      return existing;
    }
    input.repositories.updateReplanProposalStatus(existing.id, "dismissed", null);
  }

  // Recorded before the planner runs: the proposal is bound to the state the planner was shown.
  const basis = resolveReplanBasis(input.repositories, task);
  const revisable = revisableRequirements(input.repositories, task);
  const plannerAttempt = await tryCreatePlannerResponse(input, task, { requestedMode, founderNote, revisable });
  const base = {
    id: createId("replan_proposal"),
    companyId: task.companyId,
    sourceTaskId: task.id,
    plannerAgentId: plannerAttempt.kind === "not_configured" ? null : plannerAttempt.agentId,
    plannerPromptPath: plannerAttempt.kind === "not_configured" ? null : plannerAttempt.promptPath,
    requestedMode,
    founderNote,
    basis,
    rejectionNote: null,
    createdAt: now,
    confirmedAt: null,
    rejectedAt: null,
  };
  const empty = {
    replacementTasks: [],
    taskBefore: null,
    taskAfter: null,
    capabilitiesChanged: false,
    requirementChanges: [],
    requirementSourceNotes: [],
  };
  const response = plannerAttempt.kind === "success" ? plannerAttempt.response : null;
  const revisionRefusal = response?.mode === "revision" ? permissionModeRefusal(input.repositories, task, response.revisedTask) : null;

  let proposal: ReplanProposal;
  if (response && !revisionRefusal) {
    proposal = response.mode === "split"
      ? {
          ...base, ...empty, status: "proposed", proposalSource: "planner_agent", mode: "split",
          plannerFailureReason: null, plannerFailureMessage: null, rationale: response.rationale,
          replacementTasks: response.replacementTasks,
        }
      : {
          ...base, ...empty, status: "proposed", proposalSource: "planner_agent", mode: "revision",
          plannerFailureReason: null, plannerFailureMessage: null, rationale: response.rationale,
          taskBefore: taskDefinition(task),
          taskAfter: response.revisedTask,
          capabilitiesChanged: !sameMembers(task.requiredCapabilities, response.revisedTask.requiredCapabilities),
          requirementChanges: response.requirementChanges.map((change) => ({
            verifierTaskId: change.verifierTaskId,
            before: revisable.editable.find((entry) => entry.verifier.id === change.verifierTaskId)?.requirements ?? [],
            after: change.requirements,
          })),
          requirementSourceNotes: revisable.sourced.map(({ verifier, producer }) => ({ verifierTaskId: verifier.id, producerTaskId: producer.id })),
        };
  } else if (requestedMode === "split") {
    // Only an explicit Split falls back to the runtime's own template. A Revision is a judgement about
    // what the task should be asked instead, and there is no template for that.
    proposal = {
      ...base, ...empty, status: "proposed", proposalSource: "deterministic_template", mode: "split",
      plannerFailureReason: plannerAttempt.kind === "failed" ? plannerAttempt.reason : revisionRefusal ? "parse_failed" : null,
      plannerFailureMessage: plannerAttempt.kind === "failed" ? plannerAttempt.message : revisionRefusal,
      rationale: `${task.title} should be split into smaller proof-backed tasks.`,
      replacementTasks: buildReplacementTasks(task),
    };
  } else {
    const message = revisionRefusal
      ?? (plannerAttempt.kind === "failed" ? plannerAttempt.message : "No planner agent is configured for this company.");
    proposal = {
      ...base, ...empty, status: "failed", proposalSource: plannerAttempt.kind === "not_configured" ? "deterministic_template" : "planner_agent", mode: null,
      plannerFailureReason: plannerAttempt.kind === "failed" ? plannerAttempt.reason : revisionRefusal ? "parse_failed" : null,
      plannerFailureMessage: message,
      rationale: `No applicable proposal: ${message}`,
    };
  }

  input.repositories.createReplanProposal(proposal);

  return proposal;
}

/**
 * A Revision's capabilities stay bounded by the company's Permission Mode: one that needs a capability
 * the mode refuses, which the task did not already need, would be confirmed into a run that cannot use it.
 */
function permissionModeRefusal(
  repositories: ReturnType<typeof createRepositories>,
  task: Task,
  revised: ReplanTaskDefinition,
): string | null {
  const company = repositories.getCompany(task.companyId);
  const refused = company ? capabilitiesNewlyRefused(task, revised, resolvePolicyForPermissionMode(company.permissionMode)) : [];
  return refused.length > 0
    ? `The revision needs ${refused.join(", ")}, which this company's Permission Mode refuses.`
    : null;
}

/** Runtime capabilities the revised task needs that `policy` refuses and the current task did not need. */
export function capabilitiesNewlyRefused(
  current: Pick<Task, "proofSchemaId" | "requiredCapabilities">,
  revised: Pick<ReplanTaskDefinition, "proofSchemaId" | "requiredCapabilities">,
  policy: ReturnType<typeof resolvePolicyForPermissionMode>,
): string[] {
  const before = resolveAgentCapabilityGrant({ needs: resolveTaskCapabilityNeeds(current), policy }).withheld;
  const after = resolveAgentCapabilityGrant({ needs: resolveTaskCapabilityNeeds(revised), policy }).withheld;
  return after.filter((capability) => !before.includes(capability));
}

function taskDefinition(task: Task): ReplanTaskDefinition {
  return {
    title: task.title,
    description: task.description,
    proofSchemaId: task.proofSchemaId,
    requiredCapabilities: [...task.requiredCapabilities],
  };
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

async function tryCreatePlannerResponse(
  input: CreateReplanProposalInput,
  task: Task,
  request: {
    requestedMode: ReplanMode | null;
    founderNote: string | null;
    revisable: ReturnType<typeof revisableRequirements>;
  },
): Promise<PlannerAttempt> {
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
    stuck: resolveStuckContext(input.repositories, task),
    requestedMode: request.requestedMode,
    founderNote: request.founderNote,
    revisable: request.revisable,
  });
  const companyWorkspace = createCompanyWorkspace(input.projectRoot, task.companyId);
  const promptPath = `${companyWorkspace.companyRoot}/replan-${task.id}-prompt.md`;
  writeFileSync(promptPath, prompt, "utf8");
  const plannerGrant = resolveAgentCapabilityGrant({
    needs: planningCapabilityNeeds,
    policy: resolvePolicyForPermissionMode(company.permissionMode),
  });
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
    grant: plannerGrant,
  };
  const sessionPolicy = resolveAgentSessionPolicy({
    companyId: task.companyId,
    agentId: input.plannerAgent.id,
    permissionMode: company.permissionMode,
    purpose: "replan_planner",
    grantId: plannerGrant.id,
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
      response: parseReplanPlannerOutput(result.stdout, input.playbook, {
        requestedMode: request.requestedMode,
        editableVerifierIds: request.revisable.editable.map((entry) => entry.verifier.id),
      }),
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
  return input.repositories.transaction(() => {
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

    // Bound to the state it was made from: a Human Action confirmed, a recovery run or an upstream
    // redelivered since means the planner reasoned about a task that no longer exists.
    if (!isReplanProposalCurrent(input.repositories, proposal)) {
      throw new StaleReplanProposalError(proposal);
    }

    return proposal.mode === "revision"
      ? confirmRevision(input, proposal, sourceTask)
      : confirmSplit(input, proposal, sourceTask);
  });
}

/**
 * Reject a proposal, with the founder's reason. The reason reaches the planner on the next request,
 * never the task's agent (ADR 0043).
 */
export function rejectReplanProposal(input: {
  repositories: ReturnType<typeof createRepositories>;
  proposalId: string;
  note?: string | null;
  now?: () => Date;
}): ReplanProposal {
  const proposal = input.repositories.getReplanProposal(input.proposalId);
  if (!proposal) {
    throw new Error(`Replan proposal not found: ${input.proposalId}`);
  }
  if (proposal.status !== "proposed") {
    throw new Error(`Replan proposal ${proposal.id} is not proposed.`);
  }
  input.repositories.rejectReplanProposal(proposal.id, input.note?.trim() || null, (input.now ?? (() => new Date()))().toISOString());
  return input.repositories.getReplanProposal(proposal.id)!;
}

/**
 * Hold kinds a verifier is released from when the work it judges is revised: they all say its last
 * verdict, or its last attempt at one, was the problem. A Hold on anything else — an approval, a
 * person, an exhausted recovery budget — is not answered by a revision and stays.
 */
const VERDICT_HOLDS: readonly TaskHoldKind[] = ["verification_failed", "invalid_business_artifact", "runtime_interrupted", "awaiting_dependency_artifact"];

/**
 * Apply a confirmed Revision: the task keeps its identity, dependencies, department and assignee, and
 * is asked to do something else (ADR 0043).
 *
 * - The task always runs again, and every open Hold on it is superseded: it usually holds a blocker or
 *   a failed delivery, and judging whether old output meets the new standard would itself take an agent.
 * - Its Bounded Recovery attempts restart, and an amended verifier's round budget restarts. Only this
 *   confirmation resets either; the ceilings still apply from here.
 * - Every verifier judging it waits for its new delivery. A verdict's currency is derived from its
 *   requirement fingerprint and targets, so the amended verifier's whole verdict — for every target —
 *   is no longer current without anything marking it; its next run judges all of them again.
 */
function confirmRevision(input: ConfirmReplanProposalInput, proposal: ReplanProposal, task: Task): ConfirmReplanProposalResult {
  const now = (input.now ?? (() => new Date()))().toISOString();
  const createId = input.createId ?? defaultCreateId;
  const at = () => new Date(now);
  const after = proposal.taskAfter!;
  const locale = input.repositories.getCompany(task.companyId)?.locale ?? "en";

  input.repositories.updateTaskDefinition(task.id, {
    title: after.title,
    titleText: { [locale]: after.title },
    description: after.description,
    descriptionText: { [locale]: after.description },
    proofSchemaId: after.proofSchemaId,
    requiredCapabilities: after.requiredCapabilities,
  });
  for (const change of proposal.requirementChanges) {
    input.repositories.updateTaskVerificationRequirements(change.verifierTaskId, change.after);
    input.repositories.markVerificationRoundsReset(change.verifierTaskId);
  }
  resetTaskAttempts(input.repositories, task.id, now);

  const revised = applyTaskTransition({
    repositories: input.repositories,
    task: task.id,
    status: "queued",
    executionSummary: { latestFailureReason: null, latestFailureMessage: null, dependencyNote: null },
    resolvesHoldKinds: taskHoldKinds,
    resolution: "superseded",
    now: at,
    createId,
  }).task;

  const note = `Re-verifying after ${after.title} was revised by replan proposal ${proposal.id}.`;
  for (const verifier of verifiersJudging(input.repositories, revised)) {
    const current = input.repositories.getTask(verifier.id);
    if (!current || current.id === revised.id || !["complete", "blocked", "failed", "review"].includes(current.status)) {
      continue;
    }
    applyTaskTransition({
      repositories: input.repositories,
      task: current,
      status: "waiting_dependency",
      executionSummary: { latestFailureReason: null, latestFailureMessage: null, dependencyNote: note },
      hold: { kind: "awaiting_dependency_artifact", resolver: "upstream_task", subjectKind: "task", subjectId: revised.id, reason: note },
      resolvesHoldKinds: VERDICT_HOLDS,
      resolution: "superseded",
      now: at,
      createId,
    });
  }

  input.repositories.updateReplanProposalStatus(proposal.id, "confirmed", now);
  input.repositories.appendTaskEvent({
    id: createId("task_event"),
    companyId: revised.companyId,
    taskId: revised.id,
    type: "task_replanned",
    message: `Task revised by replan proposal ${proposal.id}: ${proposal.rationale}`,
    createdAt: now,
    status: revised.status,
    failureReason: null,
    failureMessage: null,
    executionProfileName: null,
    requestedTimeoutMs: null,
    effectiveTimeoutMs: null,
    dependencyNote: null,
    artifactWorkspacePath: revised.artifactWorkspacePath ?? null,
  } satisfies TaskEvent);

  return {
    proposal: input.repositories.getReplanProposal(proposal.id) ?? proposal,
    sourceTask: input.repositories.getTask(revised.id) ?? revised,
    createdTasks: [],
    affectedConsumers: input.repositories.listDependencyConsumers(revised.id),
  };
}

function confirmSplit(input: ConfirmReplanProposalInput, proposal: ReplanProposal, sourceTask: Task): ConfirmReplanProposalResult {

  const affectedConsumers = input.repositories.listDependencyConsumers(sourceTask.id);
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
    inheritVerificationDuty(input.repositories, sourceTask, finalTask);
  }

  // The source task is retired in favour of the replacement chain, so its Hold names the task that
  // now owes the deliverable rather than leaving it blocked on nothing.
  applyTaskTransition({
    repositories: input.repositories,
    task: sourceTask,
    status: "blocked",
    executionSummary: {
      latestFailureReason: "needs_replan",
      latestFailureMessage: `Task replaced by replan proposal ${proposal.id}.`,
      dependencyNote: `Replaced by replan proposal ${proposal.id}.`,
    },
    hold: {
      kind: "awaiting_dependency_artifact",
      resolver: "upstream_task",
      subjectKind: "task",
      subjectId: finalTask?.id ?? null,
      reason: `Replaced by replan proposal ${proposal.id}; the replacement tasks now carry this work.`,
    },
    resolution: "cleared",
    now: () => new Date(now),
    createId,
  });
  input.repositories.appendCompanyEvent({
    id: createId("company_event"), companyId: sourceTask.companyId, type: "company_plan_created",
    message: proposal.rationale, createdAt: now,
    planSnapshot: planSnapshot(input.repositories, input.repositories.getCompany(sourceTask.companyId)!, createdTasks),
  });
  // A CEO replan resets the source task's Bounded Recovery budget so it can be recovered again.
  resetTaskAttempts(input.repositories, sourceTask.id, now);
  input.repositories.updateReplanProposalStatus(proposal.id, "confirmed", now);
  input.repositories.appendTaskEvent({
    id: createId("task_event"),
    companyId: sourceTask.companyId,
    taskId: sourceTask.id,
    type: "task_replanned",
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
    affectedConsumers,
  };
}

/**
 * A replacement chain carries the work its source task owed, and a verifying task owed a verdict. The
 * final replacement inherits the source's verification targets, requirement source and planned
 * requirements; without them the replacement would be an ordinary task and the verification would
 * silently disappear from the plan (ADR 0025).
 */
function inheritVerificationDuty(
  repositories: ReturnType<typeof createRepositories>,
  sourceTask: Task,
  finalTask: Task,
): void {
  for (const dependency of repositories.listTaskDependencies(sourceTask.id)) {
    if ((dependency.inputRole ?? "context") === "context") {
      continue;
    }
    repositories.createTaskDependency({ ...dependency, taskId: finalTask.id });
  }
  if (sourceTask.verificationRequirements && sourceTask.verificationRequirements.length > 0) {
    repositories.updateTaskVerificationRequirements(finalTask.id, sourceTask.verificationRequirements);
  }
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
