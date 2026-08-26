import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type {
  CeoIntake,
  CeoReviewDecision,
  CeoReviewDecisionKind,
  CeoReviewReturnReason,
  Company,
  Department,
  Objective,
  Proof,
  ReplanProposal,
  Task,
  TaskEvent,
  TaskProgressEvent,
} from "@auto-crop/core";
import type { AgentAdapter } from "../adapters/types";
import type { createRepositories, ReviewRecord } from "../db/repositories";
import { EventStream } from "../events/sse";
import type { PolicyMode } from "../policies/policy";
import { createCompany } from "../runtime/createCompany";
import { defaultAgentSessionManager } from "../runtime/agentSessions";
import { triggerKillSwitch } from "../runtime/killSwitch";
import { confirmReplanProposal, createReplanProposalForTask } from "../runtime/replan";
import { reconcileStaleRunningTasks, recoverTask } from "../runtime/taskRecovery";
import { refreshTaskDependencyState } from "../runtime/taskRefresh";
import { propagateDependencyCascade, refreshDependencyTasks, type DependencyCascadeResult } from "../runtime/dependencyCascade";
import { propagateParentTaskAggregation, type ParentTaskAggregationResult } from "../runtime/parentTaskAggregation";
import { aiSaasPlaybook } from "../playbooks/aiSaas";
import { selectPlaybook } from "../playbooks/selectPlaybook";

export type ApiServerOptions = {
  projectRoot: string;
  repositories: ReturnType<typeof createRepositories>;
  agents: AgentAdapter[];
  log?: (line: string) => void;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export type ApiServer = {
  httpServer: Server;
  events: EventStream;
};

export function createApiServer(options: ApiServerOptions): ApiServer {
  const events = new EventStream();
  const httpServer = createServer(async (request, response) => {
    try {
      applyCors(response);
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.url !== "/api/events") {
        options.log?.(`${request.method ?? "GET"} ${request.url ?? "/"}`);
      }
      await routeRequest(request, response, options, events);
    } catch (error) {
      options.log?.(`Request failed: ${(error as Error).message}`);
      sendJson(response, 500, { error: (error as Error).message });
    }
  });

  return { httpServer, events };
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ApiServerOptions,
  events: EventStream,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = request.method ?? "GET";

  if (method === "GET" && url.pathname === "/api/events") {
    events.connect(response);
    return;
  }

  if (method === "GET" && url.pathname === "/api/agents") {
    const agents = await Promise.all(
      options.agents.map(async (agent) => ({
        id: agent.id,
        name: agent.name,
        capabilities: agent.capabilities,
        detected: await agent.detect(),
      })),
    );
    sendJson(response, 200, { agents });
    return;
  }

  if (method === "GET" && url.pathname === "/api/companies") {
    sendJson(response, 200, {
      companies: options.repositories
        .listCompanies()
        .map((company) => summarizeCompanyListItem(company, options.repositories)),
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/companies") {
    const body = await readJson<{
      companyName?: string;
      founderVision: string;
      selectedCeoAgentId: string;
      permissionMode: PolicyMode;
      assets?: string[];
    }>(request);
    const companyName = body.companyName?.trim() ?? "";

    if (!companyName) {
      sendJson(response, 400, { error: "Company name is required." });
      return;
    }

    const selectedCeoAgent = options.agents.find((agent) => agent.id === body.selectedCeoAgentId);

    if (!selectedCeoAgent) {
      sendJson(response, 404, { error: `Agent not found: ${body.selectedCeoAgentId}` });
      return;
    }

    options.log?.(`Creating company with CEO agent ${selectedCeoAgent.name}`);
    const result = await createCompany({
      projectRoot: options.projectRoot,
      companyName,
      founderVision: body.founderVision,
      selectedCeoAgent,
      availableAgents: options.agents,
      permissionMode: body.permissionMode,
      assets: body.assets ?? [],
      repositories: options.repositories,
      now: options.now,
      createId: options.createId,
    });
    sendJson(response, 201, {
      ...result,
      tasks: summarizeTasks(result.tasks, options.repositories.listTaskDependenciesForCompany(result.company.id)),
      proof: [],
      reviews: [],
      activity: options.repositories.listTaskEventsForCompany(result.company.id).map(summarizeTaskEvent),
      taskProgressEvents: options.repositories.listTaskProgressEventsForCompany(result.company.id).map(summarizeTaskProgressEvent),
      ceoIntakes: [],
    });
    return;
  }

  const activateMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/activate$/);
  if (method === "POST" && activateMatch) {
    const companyId = activateMatch[1];
    options.repositories.updateCompanyStatus(
      companyId,
      "active",
      (options.now ?? (() => new Date()))().toISOString(),
    );
    sendJson(response, 200, { company: options.repositories.getCompany(companyId) });
    return;
  }

  const stateMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/state$/);
  if (method === "GET" && stateMatch) {
    const companyId = stateMatch[1];
    const company = options.repositories.getCompany(companyId);

    if (!company) {
      sendJson(response, 404, { error: `Company not found: ${companyId}` });
      return;
    }

    sendJson(response, 200, buildCompanyState(company, options.repositories, {
      now: options.now,
      createId: options.createId,
    }));
    return;
  }

  const ceoIntakeMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/ceo-intakes$/);
  if (method === "POST" && ceoIntakeMatch) {
    const companyId = ceoIntakeMatch[1];
    const company = options.repositories.getCompany(companyId);

    if (!company) {
      sendJson(response, 404, { error: `Company not found: ${companyId}` });
      return;
    }

    const body = await readJson<{ body?: string }>(request);
    const intakeBody = body.body?.trim() ?? "";

    if (!intakeBody) {
      sendJson(response, 400, { error: "CEO intake body is required." });
      return;
    }

    const timestamp = (options.now ?? (() => new Date()))().toISOString();
    const intake: CeoIntake = {
      id: createRouteId(options, "ceo_intake"),
      companyId,
      body: intakeBody,
      status: "received",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    options.repositories.createCeoIntake(intake);
    sendJson(response, 201, { intake: summarizeCeoIntake(intake) });
    return;
  }

  const reviewsMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/reviews$/);
  if (method === "GET" && reviewsMatch) {
    sendJson(response, 200, { reviews: options.repositories.listReviews(reviewsMatch[1]) });
    return;
  }

  const proofMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/proof$/);
  if (method === "GET" && proofMatch) {
    sendJson(response, 200, { proof: options.repositories.listProofsForTask(proofMatch[1]) });
    return;
  }

  if (method === "POST" && url.pathname === "/api/ceo-review-decisions") {
    const body = await readJson<{
      taskId?: string;
      decision?: CeoReviewDecisionKind;
      returnReason?: CeoReviewReturnReason;
      note?: string;
    }>(request);
    const taskId = body.taskId?.trim() ?? "";
    const decisionKind = body.decision;

    if (!taskId) {
      sendJson(response, 400, { error: "Task id is required." });
      return;
    }

    if (decisionKind !== "approve" && decisionKind !== "return") {
      sendJson(response, 400, { error: "Decision must be approve or return." });
      return;
    }

    if (decisionKind === "return" && !isCeoReviewReturnReason(body.returnReason)) {
      sendJson(response, 400, { error: "Return reason is required." });
      return;
    }

    const result = createCeoReviewDecision({
      repositories: options.repositories,
      taskId,
      decision: decisionKind,
      returnReason: decisionKind === "return" ? body.returnReason! : null,
      note: body.note?.trim() ? body.note.trim() : null,
      now: options.now,
      createId: options.createId,
    });

    if (result.kind === "not_found") {
      sendJson(response, 404, { error: `Task not found: ${taskId}` });
      return;
    }

    if (result.kind === "not_in_review") {
      sendJson(response, 409, { error: "Task is no longer waiting for CEO review." });
      return;
    }

    if (result.kind === "missing_proof") {
      sendJson(response, 409, { error: "Task has no checkable proof and cannot be approved." });
      return;
    }

    const dependencyCascade =
      result.decision.decision === "approve"
        ? propagateDependencyCascade({
          repositories: options.repositories,
          sourceTaskId: result.task.id,
          maxDepth: 2,
          now: options.now,
          createId: options.createId,
        })
        : undefined;
    for (const cascadeUpdate of dependencyCascade?.updatedTasks ?? []) {
      if (cascadeUpdate.event) {
        events.publish(summarizeTaskEvent(cascadeUpdate.event));
      }
    }

    sendJson(response, 201, {
      decision: summarizeCeoReviewDecision(result.decision),
      task: summarizeTask(result.task, options.repositories.listTaskDependencies(result.task.id).map((dependency) => dependency.dependsOnTaskId)),
      event: summarizeTaskEvent(result.event),
      progressEvent: result.progressEvent ? summarizeTaskProgressEvent(result.progressEvent) : undefined,
      dependencyCascade: dependencyCascade ? summarizeDependencyCascade(dependencyCascade, options.repositories) : undefined,
    });
    return;
  }

  const cancelMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/cancel$/);
  if (method === "POST" && cancelMatch) {
    const taskId = cancelMatch[1];
    options.repositories.updateTaskStatus(taskId, "cancelled");
    sendJson(response, 200, { task: options.repositories.getTask(taskId) });
    return;
  }

  const refreshTaskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/refresh$/);
  if (method === "POST" && refreshTaskMatch) {
    const result = refreshTaskDependencyState({
      repositories: options.repositories,
      taskId: refreshTaskMatch[1],
      proofSchemas: aiSaasPlaybook.proofSchemas,
      now: options.now,
      createId: options.createId,
    });
    const dependencies = options.repositories.listTaskDependencies(result.task.id);
    const event = summarizeTaskEvent(result.event);
    const parentAggregation = propagateParentAggregationIfReady({
      repositories: options.repositories,
      task: result.task,
      now: options.now,
      createId: options.createId,
    });
    events.publish(event);
    publishParentAggregationEvents(parentAggregation, events);
    sendJson(response, 200, {
      task: summarizeTask(
        result.task,
        dependencies.map((dependency) => dependency.dependsOnTaskId),
      ),
      event,
      progressEvent: result.progressEvent ? summarizeTaskProgressEvent(result.progressEvent) : undefined,
      proof: result.proof?.map(summarizeProof),
      recovery: result.recovery,
      parentAggregation: parentAggregation ? summarizeParentAggregation(parentAggregation, options.repositories) : undefined,
    });
    return;
  }

  const recoverTaskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/recover$/);
  if (method === "POST" && recoverTaskMatch) {
    const result = recoverTask({
      repositories: options.repositories,
      taskId: recoverTaskMatch[1],
      proofSchemas: aiSaasPlaybook.proofSchemas,
      now: options.now,
      createId: options.createId,
    });
    const event = summarizeTaskEvent(result.event);
    const parentAggregation = propagateParentAggregationIfReady({
      repositories: options.repositories,
      task: result.task,
      now: options.now,
      createId: options.createId,
    });
    events.publish(event);
    publishParentAggregationEvents(parentAggregation, events);
    sendJson(response, 200, {
      task: summarizeTask(
        result.task,
        options.repositories.listTaskDependencies(result.task.id).map((dependency) => dependency.dependsOnTaskId),
      ),
      followUpTask: result.followUpTask
        ? summarizeTask(
          result.followUpTask,
          options.repositories.listTaskDependencies(result.followUpTask.id).map((dependency) => dependency.dependsOnTaskId),
        )
        : undefined,
      event,
      progressEvent: result.progressEvent ? summarizeTaskProgressEvent(result.progressEvent) : undefined,
      proof: result.proof?.map(summarizeProof),
      recovery: result.recovery,
      parentAggregation: parentAggregation ? summarizeParentAggregation(parentAggregation, options.repositories) : undefined,
    });
    return;
  }

  const replanTaskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/replan-proposals$/);
  if (method === "POST" && replanTaskMatch) {
    const task = options.repositories.getTask(replanTaskMatch[1]);
    const company = task ? options.repositories.getCompany(task.companyId) : null;
    const plannerAgent = company ? options.agents.find((agent) => agent.id === company.selectedCeoAgentId) : undefined;
    const proposal = await createReplanProposalForTask({
      repositories: options.repositories,
      taskId: replanTaskMatch[1],
      projectRoot: options.projectRoot,
      plannerAgent,
      playbook: company ? selectPlaybook(company.founderVision) : undefined,
      now: options.now,
      createId: options.createId,
    });
    sendJson(response, 201, { proposal: summarizeReplanProposal(proposal) });
    return;
  }

  const confirmReplanMatch = url.pathname.match(/^\/api\/replan-proposals\/([^/]+)\/confirm$/);
  if (method === "POST" && confirmReplanMatch) {
    const result = confirmReplanProposal({
      projectRoot: options.projectRoot,
      repositories: options.repositories,
      proposalId: confirmReplanMatch[1],
      now: options.now,
      createId: options.createId,
    });
    const affectedConsumers = result.affectedConsumers
      .map((consumer) => options.repositories.getTask(consumer.id))
      .filter((consumer): consumer is Task => Boolean(consumer));
    const dependencyCascade = refreshDependencyTasks({
      repositories: options.repositories,
      tasks: affectedConsumers,
      includeUnchangedTasks: true,
      progressLabel: "Dependency path updated after replan; waiting for replacement deliverable.",
      now: options.now,
      createId: options.createId,
    });
    for (const cascadeUpdate of dependencyCascade.updatedTasks) {
      if (cascadeUpdate.event) {
        events.publish(summarizeTaskEvent(cascadeUpdate.event));
      }
    }
    sendJson(response, 200, {
      proposal: summarizeReplanProposal(result.proposal),
      sourceTask: summarizeTask(result.sourceTask, []),
      createdTasks: summarizeTasks(result.createdTasks, []),
      dependencyCascade: summarizeDependencyCascade(dependencyCascade, options.repositories),
    });
    return;
  }

  const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
  if (method === "POST" && approvalMatch) {
    const body = await readJson<{ decision: "approved" | "denied" }>(request);
    sendJson(response, 200, { approval: { id: approvalMatch[1], status: body.decision } });
    return;
  }

  if (method === "POST" && url.pathname === "/api/kill-switch") {
    const body = await readJson<{ companyId: string }>(request);
    const result = triggerKillSwitch({
      companyId: body.companyId,
      repositories: options.repositories,
      now: options.now,
      cancelActiveRun: () => undefined,
      stopCompanySessions: (companyId, reason) => defaultAgentSessionManager.stopCompanySessions(companyId, reason),
    });
    sendJson(response, 200, {
      ...result,
      paused: options.repositories.isGlobalPaused(),
      company: options.repositories.getCompany(body.companyId),
    });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

function buildCompanyState(
  company: Company,
  repositories: ReturnType<typeof createRepositories>,
  options?: { now?: () => Date; createId?: (prefix: string) => string },
) {
  reconcileStaleRunningTasks({
    repositories,
    companyId: company.id,
    now: options?.now,
    createId: options?.createId,
  });
  const tasks = repositories.listTasksForCompany(company.id);

  return {
    company: summarizeCompany(company),
    departments: repositories.listDepartments(company.id).map(summarizeDepartment),
    objectives: repositories.listObjectives(company.id).map(summarizeObjective),
    keyResults: repositories.listKeyResults(company.id),
    tasks: summarizeTasks(tasks, repositories.listTaskDependenciesForCompany(company.id)),
    proof: repositories.listProofsForCompany(company.id).map(summarizeProof),
    reviews: repositories.listReviews(company.id).map(summarizeReview),
    ceoReviewDecisions: repositories.listCeoReviewDecisionsForCompany(company.id).map(summarizeCeoReviewDecision),
    replanProposals: repositories.listReplanProposalsForCompany(company.id).map(summarizeReplanProposal),
    activity: repositories.listTaskEventsForCompany(company.id).map(summarizeTaskEvent),
    taskProgressEvents: repositories.listTaskProgressEventsForCompany(company.id).map(summarizeTaskProgressEvent),
    ceoIntakes: repositories.listCeoIntakesForCompany(company.id).map(summarizeCeoIntake),
  };
}

type CeoReviewDecisionResult =
  | { kind: "created"; decision: CeoReviewDecision; task: Task; event: TaskEvent; progressEvent?: TaskProgressEvent }
  | { kind: "not_found" }
  | { kind: "not_in_review" }
  | { kind: "missing_proof" };

function createCeoReviewDecision(input: {
  repositories: ReturnType<typeof createRepositories>;
  taskId: string;
  decision: CeoReviewDecisionKind;
  returnReason: CeoReviewReturnReason | null;
  note: string | null;
  now?: () => Date;
  createId?: (prefix: string) => string;
}): CeoReviewDecisionResult {
  const task = input.repositories.getTask(input.taskId);

  if (!task) {
    return { kind: "not_found" };
  }

  if (task.status !== "review") {
    return { kind: "not_in_review" };
  }

  const proofs = input.repositories.listProofsForTask(task.id);
  const proof = proofs[0] ?? null;

  if (input.decision === "approve" && !proof) {
    return { kind: "missing_proof" };
  }

  const timestamp = (input.now ?? (() => new Date()))().toISOString();
  const decision: CeoReviewDecision = {
    id: input.createId?.("ceo_review_decision") ?? `ceo_review_decision_${Date.now()}`,
    companyId: task.companyId,
    taskId: task.id,
    departmentId: task.departmentId,
    decision: input.decision,
    returnReason: input.returnReason,
    note: input.note,
    proofId: proof?.id ?? null,
    proofType: proof?.type ?? null,
    proofUri: proof?.uri ?? null,
    actor: "ceo_office",
    createdAt: timestamp,
  };
  input.repositories.createCeoReviewDecision(decision);

  const nextStatus = input.decision === "approve" ? "complete" : "queued";
  input.repositories.updateTaskStatus(task.id, nextStatus);
  if (input.decision === "approve" && task.keyResultId) {
    input.repositories.updateKeyResultProgress(task.keyResultId, "proof_received", "met");
  }

  const event: TaskEvent = {
    id: input.createId?.("task_event") ?? `task_event_${Date.now()}`,
    companyId: task.companyId,
    taskId: task.id,
    type: "ceo_review_decision",
    message:
      input.decision === "approve"
        ? `CEO Office approved task: ${task.title}.`
        : `CEO Office returned task: ${task.title}.`,
    createdAt: timestamp,
    status: nextStatus,
    failureReason: null,
    failureMessage: null,
    executionProfileName: task.latestExecutionProfileName ?? null,
    requestedTimeoutMs: task.latestRequestedTimeoutMs ?? null,
    effectiveTimeoutMs: task.latestEffectiveTimeoutMs ?? null,
    dependencyNote: task.dependencyNote ?? null,
    artifactWorkspacePath: task.artifactWorkspacePath ?? null,
  };
  input.repositories.appendTaskEvent(event);

  let progressEvent: TaskProgressEvent | undefined;
  if (input.decision === "return") {
    progressEvent = {
      id: input.createId?.("task_progress") ?? `task_progress_${Date.now()}`,
      companyId: task.companyId,
      departmentId: task.departmentId,
      parentTaskId: task.parentTaskId ?? task.id,
      subjectTaskId: task.id,
      step: "blocked",
      status: "current",
      label: "CEO Office returned this, waiting for the department to rework it.",
      detail: formatCeoReturnProgressDetail(input.returnReason, input.note),
      createdAt: timestamp,
    };
    input.repositories.appendTaskProgressEvent(progressEvent);
  }

  return {
    kind: "created",
    decision,
    task: {
      ...task,
      status: nextStatus,
    },
    event,
    progressEvent,
  };
}

function isCeoReviewReturnReason(reason: unknown): reason is CeoReviewReturnReason {
  return (
    reason === "needs_changes" ||
    reason === "unclear_task_definition" ||
    reason === "scope_too_large" ||
    reason === "wrong_direction"
  );
}

function formatCeoReturnProgressDetail(reason: CeoReviewReturnReason | null, note: string | null): string {
  const reasonText = reason ? formatCeoReturnReason(reason) : "returned";
  const nextStep = note?.trim() ? note.trim() : "Please rework the task and submit checkable proof.";
  return `Reason: ${reasonText}. Next step: ${nextStep}`;
}

function formatCeoReturnReason(reason: CeoReviewReturnReason): string {
  switch (reason) {
    case "needs_changes":
      return "needs changes";
    case "unclear_task_definition":
      return "task is unclear";
    case "scope_too_large":
      return "task is too large";
    case "wrong_direction":
      return "direction is wrong";
  }
}

function createRouteId(options: ApiServerOptions, prefix: string): string {
  return options.createId?.(prefix) ?? `${prefix}_${Date.now()}`;
}

function summarizeCompany(company: Company) {
  return {
    id: company.id,
    name: company.name,
    status: company.status,
    playbookId: company.playbookId,
    selectedCeoAgentId: company.selectedCeoAgentId,
    permissionMode: company.permissionMode ?? null,
  };
}

function summarizeCompanyListItem(company: Company, repositories: ReturnType<typeof createRepositories>) {
  return {
    ...summarizeCompany(company),
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
    taskCount: repositories.listTasksForCompany(company.id).length,
  };
}

function summarizeCeoIntake(intake: CeoIntake) {
  return intake;
}

function summarizeCeoReviewDecision(decision: CeoReviewDecision) {
  return decision;
}

function summarizeDependencyCascade(
  cascade: DependencyCascadeResult,
  repositories: ReturnType<typeof createRepositories>,
) {
  return {
    updatedTasks: cascade.updatedTasks.map((update) =>
      summarizeTask(
        update.task,
        repositories.listTaskDependencies(update.task.id).map((dependency) => dependency.dependsOnTaskId),
      ),
    ),
    events: cascade.updatedTasks
      .map((update) => update.event)
      .filter((event): event is TaskEvent => Boolean(event))
      .map(summarizeTaskEvent),
    progressEvents: cascade.updatedTasks
      .map((update) => update.progressEvent)
      .filter((event): event is TaskProgressEvent => Boolean(event))
      .map(summarizeTaskProgressEvent),
    errors: cascade.errors.length > 0 ? cascade.errors : undefined,
  };
}

function summarizeParentAggregation(
  aggregation: ParentTaskAggregationResult,
  repositories: ReturnType<typeof createRepositories>,
) {
  return {
    updatedTasks: aggregation.updatedTasks.map((update) =>
      summarizeTask(
        update.task,
        repositories.listTaskDependencies(update.task.id).map((dependency) => dependency.dependsOnTaskId),
      ),
    ),
    events: aggregation.updatedTasks
      .map((update) => update.event)
      .filter((event): event is TaskEvent => Boolean(event))
      .map(summarizeTaskEvent),
    progressEvents: aggregation.updatedTasks
      .map((update) => update.progressEvent)
      .filter((event): event is TaskProgressEvent => Boolean(event))
      .map(summarizeTaskProgressEvent),
    errors: aggregation.errors.length > 0 ? aggregation.errors : undefined,
  };
}

function propagateParentAggregationIfReady(input: {
  repositories: ReturnType<typeof createRepositories>;
  task: Task;
  now?: () => Date;
  createId?: (prefix: string) => string;
}): ParentTaskAggregationResult | undefined {
  if ((input.task.taskKind ?? "parent") !== "department_subtask" || input.task.status !== "review") {
    return undefined;
  }

  if (input.repositories.listProofsForTask(input.task.id).length === 0) {
    return undefined;
  }

  return propagateParentTaskAggregation({
    repositories: input.repositories,
    sourceSubtaskId: input.task.id,
    now: input.now,
    createId: input.createId,
  });
}

function publishParentAggregationEvents(aggregation: ParentTaskAggregationResult | undefined, events: EventStream): void {
  for (const update of aggregation?.updatedTasks ?? []) {
    if (update.event) {
      events.publish(summarizeTaskEvent(update.event));
    }
  }
}

function summarizeDepartment(department: Department) {
  return {
    id: department.id,
    name: department.name,
    responsibility: department.responsibility,
    leadAgentId: department.leadAgentId,
    memoryPath: department.memoryPath,
  };
}

function summarizeObjective(objective: Objective) {
  return {
    id: objective.id,
    title: objective.title,
    priority: objective.priority,
  };
}

function summarizeTasks(tasks: Task[], dependencies: Array<{ taskId: string; dependsOnTaskId: string }>) {
  const dependenciesByTask = new Map<string, string[]>();
  for (const dependency of dependencies) {
    dependenciesByTask.set(dependency.taskId, [
      ...(dependenciesByTask.get(dependency.taskId) ?? []),
      dependency.dependsOnTaskId,
    ]);
  }

  return tasks.map((task) => summarizeTask(task, dependenciesByTask.get(task.id) ?? []));
}

function summarizeTask(task: Task, dependsOnTaskIds: string[]) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    departmentId: task.departmentId,
    assigneeAgentId: task.assigneeAgentId,
    description: task.description,
    riskLevel: task.riskLevel,
    failureReason: task.latestFailureReason ?? undefined,
    failureMessage: task.latestFailureMessage ?? undefined,
    executionProfileName: task.latestExecutionProfileName ?? undefined,
    requestedTimeoutMs: task.latestRequestedTimeoutMs ?? undefined,
    effectiveTimeoutMs: task.latestEffectiveTimeoutMs ?? undefined,
    dependencyNote: task.dependencyNote ?? undefined,
    artifactWorkspacePath: task.artifactWorkspacePath ?? undefined,
    dependsOnTaskIds,
    parentTaskId: task.parentTaskId ?? undefined,
    taskKind: task.taskKind ?? "parent",
    source: task.source ?? "ceo",
  };
}

function summarizeProof(proof: Proof) {
  return {
    id: proof.id,
    taskId: proof.taskId,
    type: proof.type,
    uri: proof.uri,
    summary: proof.summary,
  };
}

function summarizeReview(review: ReviewRecord) {
  return review;
}

function summarizeReplanProposal(proposal: ReplanProposal) {
  return {
    id: proposal.id,
    companyId: proposal.companyId,
    sourceTaskId: proposal.sourceTaskId,
    status: proposal.status,
    proposalSource: proposal.proposalSource,
    plannerAgentId: proposal.plannerAgentId ?? undefined,
    plannerPromptPath: proposal.plannerPromptPath ?? undefined,
    plannerFailureReason: proposal.plannerFailureReason ?? undefined,
    plannerFailureMessage: proposal.plannerFailureMessage ?? undefined,
    rationale: proposal.rationale,
    replacementTasks: proposal.replacementTasks,
    createdAt: proposal.createdAt,
    confirmedAt: proposal.confirmedAt ?? undefined,
  };
}

function summarizeTaskEvent(event: TaskEvent) {
  return {
    type: event.type,
    taskId: event.taskId,
    message: event.message,
    status: event.status ?? undefined,
    failureReason: event.failureReason ?? undefined,
    failureMessage: event.failureMessage ?? undefined,
    executionProfileName: event.executionProfileName ?? undefined,
    requestedTimeoutMs: event.requestedTimeoutMs ?? undefined,
    effectiveTimeoutMs: event.effectiveTimeoutMs ?? undefined,
    dependencyNote: event.dependencyNote ?? undefined,
    artifactWorkspacePath: event.artifactWorkspacePath ?? undefined,
  };
}

function summarizeTaskProgressEvent(event: TaskProgressEvent) {
  return event;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json", ...corsHeaders() });
  response.end(JSON.stringify(body));
}

function applyCors(response: ServerResponse): void {
  for (const [key, value] of Object.entries(corsHeaders())) {
    response.setHeader(key, value);
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-origin": "*",
  };
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}
