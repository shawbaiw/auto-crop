import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type {
  BusinessArtifact,
  CeoIntake,
  CeoReviewDecision,
  CeoReviewDecisionKind,
  CeoReviewReturnReason,
  Company,
  CompanyEvent,
  Department,
  HumanAction,
  HumanActionConfirmation,
  KeyResult,
  Objective,
  Proof,
  ReplanProposal,
  Task,
  TaskCompletionEvent,
  TaskDependency,
  TaskEvent,
  TaskProgressEvent,
  VisionGap,
  WaitState,
} from "@auto-crop/core";
import type { CompleteLocalizedText, LocalizedText } from "@auto-crop/core";
import { localizedTextFromString } from "@auto-crop/core";
import type { AgentAdapter } from "../adapters/types";
import type { createRepositories, ReviewRecord } from "../db/repositories";
import { EventStream } from "../events/sse";
import type { PolicyMode } from "../policies/policy";
import { generateCompanyBlueprint, writeCompanyBlueprintRecords } from "../runtime/createCompany";
import { defaultAgentSessionManager } from "../runtime/agentSessions";
import { acceptTaskBusinessArtifact } from "../runtime/businessAcceptance";
import { projectCeoAttention } from "../runtime/ceoAttention";
import { createDefaultId } from "../runtime/ids";
import {
  ceoReturnProgressDetailText,
  ceoReturnProgressLabelText,
  ceoReviewDecisionMessageText,
} from "../runtime/localizedRuntimeText";
import { triggerKillSwitch } from "../runtime/killSwitch";
import { confirmReplanProposal, createReplanProposalForTask } from "../runtime/replan";
import { reconcileStaleRunningTasks, recoverTask } from "../runtime/taskRecovery";
import { refreshTaskDependencyState } from "../runtime/taskRefresh";
import { refreshDependencyTasks, type DependencyCascadeResult } from "../runtime/dependencyCascade";
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
  requestSchedulerWake?: (reason: SchedulerWakeReason) => void;
};

export type SchedulerWakeReason = "dependency_cascade_queued" | "parent_aggregation_queued";
const creationAttemptTimeoutMs = 10 * 60 * 1000;
const creationAttemptGraceMs = 30 * 1000;

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
    const companyId = url.searchParams.get("companyId");
    if (!companyId) {
      sendJson(response, 400, { error: "companyId is required for event streams." });
      return;
    }
    events.connect(companyId, response);
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
      creationIdempotencyKey?: string;
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

    const creationInput = {
      companyName,
      founderVision: body.founderVision,
      selectedCeoAgentId: body.selectedCeoAgentId,
      permissionMode: body.permissionMode,
      assets: body.assets ?? [],
    };
    const creationIdempotencyKey = body.creationIdempotencyKey?.trim() || createRouteId(options, "creation_key");
    const existingCompany = options.repositories.getCompanyByCreationIdempotencyKey(creationIdempotencyKey);

    if (existingCompany) {
      if (JSON.stringify(existingCompany.creationInput ?? null) !== JSON.stringify(creationInput)) {
        sendJson(response, 409, { error: "Creation Idempotency Key already belongs to different creation input." });
        return;
      }

      sendJson(
        response,
        existingCompany.status === "creating" ? 202 : 200,
        buildCompanyState(existingCompany, options.repositories, {
          now: options.now,
          createId: options.createId,
          requestSchedulerWake: options.requestSchedulerWake,
        }),
      );
      return;
    }

    const timestamp = (options.now ?? (() => new Date()))().toISOString();
    const company: Company = {
      id: createRouteId(options, "company"),
      name: companyName,
      founderVision: body.founderVision,
      selectedCeoAgentId: selectedCeoAgent.id,
      playbookId: selectPlaybook(body.founderVision).id,
      permissionMode: body.permissionMode,
      status: "creating",
      creationIdempotencyKey,
      creationInput,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const attemptId = createRouteId(options, "creation_attempt");
    options.repositories.createCompany(company);
    options.repositories.createCreationAttempt({
      id: attemptId,
      companyId: company.id,
      status: "running",
      startedAt: timestamp,
      finishedAt: null,
      promptPath: null,
      failureMessage: null,
    });
    const acceptedEvent = createCompanyEvent(options, company.id, "company_creation_accepted", "Company Creation accepted.", "creating");
    options.repositories.appendCompanyEvent(acceptedEvent);

    setTimeout(() => {
      void completeCompanyCreation({
        options,
        events,
        companyId: company.id,
        attemptId,
        creationInput,
        selectedCeoAgent,
      });
    }, 0);

    sendJson(response, 202, buildCompanyState(company, options.repositories, {
      now: options.now,
      createId: options.createId,
      requestSchedulerWake: options.requestSchedulerWake,
    }));
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

  const retryCreationMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/retry-creation$/);
  if (method === "POST" && retryCreationMatch) {
    const companyId = retryCreationMatch[1];
    const company = options.repositories.getCompany(companyId);

    if (!company) {
      sendJson(response, 404, { error: `Company not found: ${companyId}` });
      return;
    }

    if (company.status !== "creation_failed") {
      sendJson(response, 409, { error: "Only failed Company Creation can be retried." });
      return;
    }

    const creationInput = company.creationInput;
    if (!isCreationInput(creationInput)) {
      sendJson(response, 409, { error: "Company Creation input is missing and cannot be retried." });
      return;
    }

    const selectedCeoAgent = options.agents.find((agent) => agent.id === creationInput.selectedCeoAgentId);
    if (!selectedCeoAgent) {
      sendJson(response, 404, { error: `Agent not found: ${creationInput.selectedCeoAgentId}` });
      return;
    }

    const timestamp = (options.now ?? (() => new Date()))().toISOString();
    const attemptId = createRouteId(options, "creation_attempt");
    options.repositories.updateCompanyStatus(company.id, "creating", timestamp);
    options.repositories.createCreationAttempt({
      id: attemptId,
      companyId: company.id,
      status: "running",
      startedAt: timestamp,
      finishedAt: null,
      promptPath: null,
      failureMessage: null,
    });
    const acceptedEvent = createCompanyEvent(
      options,
      company.id,
      "company_creation_accepted",
      "Company Creation retry accepted.",
      "creating",
    );
    options.repositories.appendCompanyEvent(acceptedEvent);

    setTimeout(() => {
      void completeCompanyCreation({
        options,
        events,
        companyId: company.id,
        attemptId,
        creationInput,
        selectedCeoAgent,
      });
    }, 0);

    sendJson(response, 202, buildCompanyState(options.repositories.getCompany(company.id) ?? company, options.repositories, {
      now: options.now,
      createId: options.createId,
      requestSchedulerWake: options.requestSchedulerWake,
    }));
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
      requestSchedulerWake: options.requestSchedulerWake,
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
      requestSchedulerWake: () => options.requestSchedulerWake?.("dependency_cascade_queued"),
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

    if (result.kind === "invalid_business_artifact") {
      sendJson(response, 409, { error: "Task has no accepted business artifact candidate and cannot be approved." });
      return;
    }

    const dependencyCascade = result.dependencyCascade;
    for (const cascadeUpdate of dependencyCascade?.updatedTasks ?? []) {
      if (cascadeUpdate.event) {
        events.publish(summarizeTaskEvent(cascadeUpdate.event));
      }
    }

    sendJson(response, 201, {
      decision: summarizeCeoReviewDecision(result.decision),
      task: summarizeTask(result.task, options.repositories.listTaskDependencies(result.task.id).map((dependency) => dependency.dependsOnTaskId)),
      businessArtifacts: options.repositories.listBusinessArtifactsForTask(result.task.id).map(summarizeBusinessArtifact),
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
    requestSchedulerWakeForQueuedUpdates(options, parentAggregation, "parent_aggregation_queued");
    sendJson(response, 200, {
      task: summarizeTask(
        result.task,
        dependencies.map((dependency) => dependency.dependsOnTaskId),
      ),
      event,
      progressEvent: result.progressEvent ? summarizeTaskProgressEvent(result.progressEvent) : undefined,
      proof: result.proof?.map(summarizeProof),
      businessArtifacts: result.businessArtifacts?.map(summarizeBusinessArtifact),
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
    requestSchedulerWakeForQueuedUpdates(options, parentAggregation, "parent_aggregation_queued");
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
      businessArtifacts: options.repositories.listBusinessArtifactsForTask(result.task.id).map(summarizeBusinessArtifact),
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

  const confirmHumanActionMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/human-actions\/([^/]+)\/confirm$/);
  if (method === "POST" && confirmHumanActionMatch) {
    const body = await readJson<{ evidence?: unknown }>(request);
    const result = await confirmHumanAction({
      repositories: options.repositories,
      companyId: confirmHumanActionMatch[1],
      humanActionId: confirmHumanActionMatch[2],
      evidence: body.evidence,
      now: options.now,
      createId: options.createId,
    });

    if (result.kind === "not_found") {
      sendJson(response, 404, { error: "Human Action not found." });
      return;
    }
    if (result.kind === "invalid_evidence") {
      sendJson(response, 400, { error: "Human Action evidence is invalid.", verificationErrors: result.verificationErrors });
      return;
    }

    for (const event of result.events) {
      events.publish(summarizeTaskEvent(event));
    }
    if (result.updatedTasks.some((task) => task.status === "queued")) {
      options.requestSchedulerWake?.("dependency_cascade_queued");
    }
    sendJson(response, 200, {
      humanAction: result.humanAction,
      updatedTasks: summarizeTasks(
        result.updatedTasks,
        result.updatedTasks.flatMap((task) => options.repositories.listTaskDependencies(task.id)),
      ),
      events: result.events.map(summarizeTaskEvent),
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
  options?: { now?: () => Date; createId?: (prefix: string) => string; requestSchedulerWake?: (reason: SchedulerWakeReason) => void },
) {
  const currentCompany = reconcileStaleCompanyCreation(company, repositories, options) ?? company;
  reconcileStaleRunningTasks({
    repositories,
    companyId: currentCompany.id,
    now: options?.now,
    createId: options?.createId,
  });
  let tasks = repositories.listTasksForCompany(currentCompany.id);
  const keyResults = repositories.listKeyResults(currentCompany.id);
  let taskDependencies = repositories.listTaskDependenciesForCompany(currentCompany.id);
  const departments = repositories.listDepartments(currentCompany.id);
  const businessArtifacts = repositories.listBusinessArtifactsForCompany(currentCompany.id).map(summarizeBusinessArtifact);
  const taskCompletionEvents = repositories.listTaskCompletionEventsForCompany(currentCompany.id);
  const humanActionConfirmations = repositories.listHumanActionConfirmationsForCompany(currentCompany.id);
  let ceoAttention = projectCeoAttention({
    company: currentCompany,
    keyResults,
    tasks,
    taskCompletionEvents,
    taskDependencies,
    humanActionConfirmations,
    now: options?.now,
  });
  const humanActionBlockEvents = applyPendingHumanActionBlocks({
    repositories,
    tasks,
    taskDependencies,
    humanActions: ceoAttention.humanActions,
    now: options?.now,
    createId: options?.createId,
  });
  if (humanActionBlockEvents.length > 0) {
    tasks = repositories.listTasksForCompany(currentCompany.id);
    taskDependencies = repositories.listTaskDependenciesForCompany(currentCompany.id);
    ceoAttention = projectCeoAttention({
      company: currentCompany,
      keyResults,
      tasks,
      taskCompletionEvents,
      taskDependencies,
      humanActionConfirmations,
      now: options?.now,
    });
  }
  const waitStateRoutingEvents = applyWaitStateRouting({
    repositories,
    tasks,
    waitStates: ceoAttention.waitStates,
    now: options?.now,
    createId: options?.createId,
  });
  if (waitStateRoutingEvents.some((event) => event.status === "queued")) {
    options?.requestSchedulerWake?.("dependency_cascade_queued");
  }
  if (waitStateRoutingEvents.length > 0) {
    tasks = repositories.listTasksForCompany(currentCompany.id);
    taskDependencies = repositories.listTaskDependenciesForCompany(currentCompany.id);
    ceoAttention = projectCeoAttention({
      company: currentCompany,
      keyResults,
      tasks,
      taskCompletionEvents,
      taskDependencies,
      humanActionConfirmations,
      now: options?.now,
    });
  }

  return {
    company: summarizeCompany(currentCompany),
    departments: departments.map(summarizeDepartment),
    objectives: repositories.listObjectives(currentCompany.id).map(summarizeObjective),
    keyResults,
    tasks: summarizeTasks(tasks, taskDependencies),
    proof: repositories.listProofsForCompany(company.id).map(summarizeProof),
    businessArtifacts,
    taskCompletionEvents: taskCompletionEvents.map(summarizeTaskCompletionEvent),
    visionGaps: ceoAttention.visionGaps,
    humanActions: ceoAttention.humanActions,
    waitStates: ceoAttention.waitStates,
    ceoAttentionRollups: ceoAttention.ceoAttentionRollups,
    founderReport: summarizeFounderReport(
      currentCompany,
      tasks,
      businessArtifacts,
      ceoAttention.waitStates,
      ceoAttention.humanActions,
      ceoAttention.visionGaps,
      taskDependencies,
      departments,
    ),
    reviews: repositories.listReviews(currentCompany.id).map(summarizeReview),
    ceoReviewDecisions: repositories.listCeoReviewDecisionsForCompany(currentCompany.id).map(summarizeCeoReviewDecision),
    replanProposals: repositories.listReplanProposalsForCompany(currentCompany.id).map(summarizeReplanProposal),
    activity: repositories.listTaskEventsForCompany(currentCompany.id).map(summarizeTaskEvent),
    creationEvents: repositories.listCompanyEventsForCompany(currentCompany.id).map(summarizeCompanyEvent),
    creationAttempts: repositories.listCreationAttemptsForCompany(currentCompany.id),
    taskProgressEvents: repositories.listTaskProgressEventsForCompany(currentCompany.id).map(summarizeTaskProgressEvent),
    ceoIntakes: repositories.listCeoIntakesForCompany(currentCompany.id).map(summarizeCeoIntake),
  };
}

function reconcileStaleCompanyCreation(
  company: Company,
  repositories: ReturnType<typeof createRepositories>,
  options?: { now?: () => Date; createId?: (prefix: string) => string },
): Company | null {
  if (company.status !== "creating") {
    return null;
  }

  const activeAttempt = repositories
    .listCreationAttemptsForCompany(company.id)
    .find((attempt) => attempt.status === "running");
  if (!activeAttempt) {
    return null;
  }

  const now = options?.now ?? (() => new Date());
  const nowMs = now().getTime();
  const startedMs = new Date(activeAttempt.startedAt).getTime();
  if (!Number.isFinite(startedMs) || nowMs - startedMs <= creationAttemptTimeoutMs + creationAttemptGraceMs) {
    return null;
  }

  const timestamp = now().toISOString();
  const failureMessage = "Company Creation failed: active creation attempt timed out.";
  repositories.updateCompanyStatus(company.id, "creation_failed", timestamp);
  repositories.updateCreationAttempt(activeAttempt.id, {
    status: "failed",
    finishedAt: timestamp,
    promptPath: activeAttempt.promptPath,
    failureMessage,
  });
  const alreadyRecorded = repositories
    .listCompanyEventsForCompany(company.id)
    .some((event) => event.type === "company_creation_failed" && event.message === failureMessage);
  if (!alreadyRecorded) {
    repositories.appendCompanyEvent({
      id: options?.createId?.("company_event") ?? createDefaultId("company_event"),
      companyId: company.id,
      type: "company_creation_failed",
      message: failureMessage,
      messageText: localizedTextFromString(failureMessage),
      createdAt: timestamp,
      status: "creation_failed",
    });
  }

  return repositories.getCompany(company.id);
}

async function completeCompanyCreation(input: {
  options: ApiServerOptions;
  events: EventStream;
  companyId: string;
  attemptId: string;
  creationInput: {
    companyName: string;
    founderVision: string;
    selectedCeoAgentId: string;
    permissionMode: PolicyMode;
    assets: string[];
  };
  selectedCeoAgent: AgentAdapter;
}): Promise<void> {
  const { options, events, companyId, attemptId, creationInput, selectedCeoAgent } = input;

  try {
    const startedEvent = createCompanyEvent(
      options,
      companyId,
      "company_creation_agent_started",
      "CEO agent started Company Blueprint generation.",
      "creating",
    );
    options.repositories.appendCompanyEvent(startedEvent);
    events.publish(summarizeCompanyEvent(startedEvent));

    const blueprintResult = await generateCompanyBlueprint({
      projectRoot: options.projectRoot,
      companyId,
      companyName: creationInput.companyName,
      founderVision: creationInput.founderVision,
      selectedCeoAgent,
      availableAgents: options.agents,
      permissionMode: creationInput.permissionMode,
      assets: creationInput.assets,
    });
    options.repositories.updateCreationAttempt(attemptId, {
      status: "running",
      finishedAt: null,
      promptPath: blueprintResult.promptPath,
      failureMessage: null,
    });
    const parsedEvent = createCompanyEvent(
      options,
      companyId,
      "company_creation_blueprint_parsed",
      "Company Blueprint parsed.",
      "creating",
    );
    options.repositories.appendCompanyEvent(parsedEvent);
    events.publish(summarizeCompanyEvent(parsedEvent));

    const timestamp = (options.now ?? (() => new Date()))().toISOString();
    const company = options.repositories.getCompany(companyId);
    if (!company) {
      throw new Error(`Company not found: ${companyId}`);
    }
    const draftCompany: Company = {
      ...company,
      status: "draft",
      updatedAt: timestamp,
    };
    options.repositories.updateCompanyStatus(companyId, "draft", timestamp);
    writeCompanyBlueprintRecords({
      projectRoot: options.projectRoot,
      company: draftCompany,
      blueprint: blueprintResult.blueprint,
      repositories: options.repositories,
      createdAt: timestamp,
      createId: options.createId,
      proofSchemaNormalizations: blueprintResult.proofSchemaNormalizations,
    });

    const recordsEvent = createCompanyEvent(
      options,
      companyId,
      "company_creation_records_created",
      "Company departments and tasks created.",
      "draft",
    );
    options.repositories.appendCompanyEvent(recordsEvent);
    events.publish(summarizeCompanyEvent(recordsEvent));
    options.repositories.updateCreationAttempt(attemptId, {
      status: "complete",
      finishedAt: timestamp,
      promptPath: blueprintResult.promptPath,
      failureMessage: null,
    });
    const completedEvent = createCompanyEvent(
      options,
      companyId,
      "company_creation_completed",
      "Company Creation completed.",
      "draft",
    );
    options.repositories.appendCompanyEvent(completedEvent);
    events.publish(summarizeCompanyEvent(completedEvent));
  } catch (error) {
    const timestamp = (options.now ?? (() => new Date()))().toISOString();
    const message = `Company Creation failed: ${(error as Error).message}`;
    options.repositories.updateCompanyStatus(companyId, "creation_failed", timestamp);
    options.repositories.updateCreationAttempt(input.attemptId, {
      status: "failed",
      finishedAt: timestamp,
      failureMessage: message,
    });
    const failedEvent = createCompanyEvent(
      options,
      companyId,
      "company_creation_failed",
      message,
      "creation_failed",
    );
    options.repositories.appendCompanyEvent(failedEvent);
    events.publish(summarizeCompanyEvent(failedEvent));
    options.log?.(message);
  }
}

function createCompanyEvent(
  options: ApiServerOptions,
  companyId: string,
  type: CompanyEvent["type"],
  message: string,
  status: Company["status"],
): CompanyEvent {
  return {
    id: createRouteId(options, "company_event"),
    companyId,
    type,
    message,
    messageText: localizedTextFromString(message),
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    status,
  };
}

function isCreationInput(value: unknown): value is {
  companyName: string;
  founderVision: string;
  selectedCeoAgentId: string;
  permissionMode: PolicyMode;
  assets: string[];
} {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.companyName === "string" &&
    typeof value.founderVision === "string" &&
    typeof value.selectedCeoAgentId === "string" &&
    isPolicyMode(value.permissionMode) &&
    Array.isArray(value.assets) &&
    value.assets.every((asset) => typeof asset === "string")
  );
}

function isPolicyMode(value: unknown): value is PolicyMode {
  return value === "safe" || value === "balanced" || value === "autonomous";
}

type ConfirmHumanActionResult =
  | { kind: "confirmed"; humanAction: HumanAction; updatedTasks: Task[]; events: TaskEvent[] }
  | { kind: "invalid_evidence"; verificationErrors: string[] }
  | { kind: "not_found" };

async function confirmHumanAction(input: {
  repositories: ReturnType<typeof createRepositories>;
  companyId: string;
  humanActionId: string;
  evidence: unknown;
  now?: () => Date;
  createId?: (prefix: string) => string;
}): Promise<ConfirmHumanActionResult> {
  const company = input.repositories.getCompany(input.companyId);
  if (!company) {
    return { kind: "not_found" };
  }

  const tasks = input.repositories.listTasksForCompany(company.id);
  const taskCompletionEvents = input.repositories.listTaskCompletionEventsForCompany(company.id);
  const attention = projectCeoAttention({
    company,
    keyResults: input.repositories.listKeyResults(company.id),
    tasks,
    taskCompletionEvents,
    taskDependencies: input.repositories.listTaskDependenciesForCompany(company.id),
    humanActionConfirmations: input.repositories.listHumanActionConfirmationsForCompany(company.id),
    now: input.now,
  });
  const humanAction = attention.humanActions.find((action) => action.id === input.humanActionId);
  if (!humanAction) {
    return { kind: "not_found" };
  }

  const verification = await verifyHumanActionEvidence(humanAction, input.evidence);
  if (verification.kind === "invalid") {
    return { kind: "invalid_evidence", verificationErrors: verification.errors };
  }

  const verifiedAt = (input.now ?? (() => new Date()))().toISOString();
  input.repositories.upsertHumanActionConfirmation({
    humanActionId: humanAction.id,
    companyId: company.id,
    evidence: verification.evidence,
    status: "confirmed",
    verifiedAt,
    verificationErrors: [],
  } satisfies HumanActionConfirmation);

  const events: TaskEvent[] = [];
  const updatedTasks: Task[] = [];
  const taskIdsToUnblock = new Set(humanAction.blockedTaskIds);
  const createId = input.createId ?? defaultCreateId;

  for (const task of tasks) {
    const dependencies = input.repositories.listTaskDependencies(task.id);
    if (!taskIdsToUnblock.has(task.id) || !isHumanActionBlockedTask(task) || !taskDependenciesRequireHumanAction(dependencies, humanAction)) {
      continue;
    }

    input.repositories.updateTaskStatus(task.id, "queued");
    input.repositories.updateTaskExecutionSummary(task.id, {
      latestFailureReason: null,
      latestFailureMessage: null,
      dependencyNote: null,
    });

    const refreshed = input.repositories.getTask(task.id);
    if (!refreshed) {
      continue;
    }

    const event: TaskEvent = {
      id: createId("task_event"),
      companyId: refreshed.companyId,
      taskId: refreshed.id,
      type: "dependency_ready",
      message: `Human Action confirmed; task queued: ${refreshed.title}.`,
      createdAt: verifiedAt,
      status: "queued",
      failureReason: null,
      failureMessage: null,
      executionProfileName: null,
      requestedTimeoutMs: null,
      effectiveTimeoutMs: null,
      dependencyNote: null,
      artifactWorkspacePath: refreshed.artifactWorkspacePath ?? null,
    };
    input.repositories.appendTaskEvent(event);
    events.push(event);
    updatedTasks.push(refreshed);
  }

  const confirmedHumanAction = projectCeoAttention({
    company,
    keyResults: input.repositories.listKeyResults(company.id),
    tasks: input.repositories.listTasksForCompany(company.id),
    taskCompletionEvents,
    taskDependencies: input.repositories.listTaskDependenciesForCompany(company.id),
    humanActionConfirmations: input.repositories.listHumanActionConfirmationsForCompany(company.id),
    now: input.now,
  }).humanActions.find((action) => action.id === input.humanActionId);

  return {
    kind: "confirmed",
    humanAction: confirmedHumanAction ?? { ...humanAction, evidence: verification.evidence, status: "confirmed", verifiedAt, verificationErrors: [] },
    updatedTasks,
    events,
  };
}

function applyPendingHumanActionBlocks(input: {
  repositories: ReturnType<typeof createRepositories>;
  tasks: Task[];
  taskDependencies: TaskDependency[];
  humanActions: HumanAction[];
  now?: () => Date;
  createId?: (prefix: string) => string;
}): TaskEvent[] {
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const dependenciesByTaskId = groupTaskDependenciesByTaskId(input.taskDependencies);
  const createdAt = (input.now ?? (() => new Date()))().toISOString();
  const createId = input.createId ?? defaultCreateId;
  const events: TaskEvent[] = [];

  for (const humanAction of input.humanActions.filter((action) => action.status === "pending")) {
    for (const taskId of humanAction.blockedTaskIds) {
      const task = tasksById.get(taskId);
      if (!task || !isHumanActionBlockableTask(task)) {
        continue;
      }

      const dependencies = dependenciesByTaskId.get(task.id) ?? [];
      if (!taskDependenciesRequireHumanAction(dependencies, humanAction)) {
        continue;
      }

      const dependencyNote = humanActionDependencyNote(humanAction);
      if (task.status === "blocked" && task.dependencyNote === dependencyNote) {
        continue;
      }

      input.repositories.updateTaskStatus(task.id, "blocked");
      input.repositories.updateTaskExecutionSummary(task.id, {
        latestFailureReason: "missing_deliverable",
        latestFailureMessage: `Human Action required: ${humanAction.label}`,
        dependencyNote,
      });

      const refreshed = input.repositories.getTask(task.id);
      if (!refreshed) {
        continue;
      }

      const event: TaskEvent = {
        id: createId("task_event"),
        companyId: refreshed.companyId,
        taskId: refreshed.id,
        type: "task_blocked",
        message: `Human Action required before this task can proceed: ${humanAction.label}.`,
        createdAt,
        status: "blocked",
        failureReason: "missing_deliverable",
        failureMessage: `Human Action required: ${humanAction.label}`,
        executionProfileName: null,
        requestedTimeoutMs: null,
        effectiveTimeoutMs: null,
        dependencyNote,
        artifactWorkspacePath: refreshed.artifactWorkspacePath ?? null,
      };
      input.repositories.appendTaskEvent(event);
      events.push(event);
      tasksById.set(refreshed.id, refreshed);
    }
  }

  return events;
}

function applyWaitStateRouting(input: {
  repositories: ReturnType<typeof createRepositories>;
  tasks: Task[];
  waitStates: WaitState[];
  now?: () => Date;
  createId?: (prefix: string) => string;
}): TaskEvent[] {
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const timestamp = (input.now ?? (() => new Date()))().toISOString();
  const createId = input.createId ?? defaultCreateId;
  const events: TaskEvent[] = [];

  for (const waitState of input.waitStates) {
    for (const taskId of waitState.affectedTaskIds) {
      const task = tasksById.get(taskId);
      if (!task) {
        continue;
      }

      const dependencyNote = waitStateDependencyNote(waitState);
      if (waitState.status === "waiting" && task.status === "queued") {
        input.repositories.updateTaskStatus(task.id, "waiting_dependency");
        input.repositories.updateTaskExecutionSummary(task.id, {
          latestFailureReason: null,
          latestFailureMessage: null,
          dependencyNote,
        });

        const refreshed = input.repositories.getTask(task.id);
        if (!refreshed) {
          continue;
        }

        const event = waitStateTaskEvent({
          createId,
          task: refreshed,
          type: "dependency_waiting",
          message: `Wait State active until ${waitState.nextCheckAt}: ${waitState.label}.`,
          createdAt: timestamp,
          status: "waiting_dependency",
          dependencyNote,
        });
        input.repositories.appendTaskEvent(event);
        events.push(event);
        tasksById.set(refreshed.id, refreshed);
      }

      if (waitState.status === "ready_for_check_in" && task.status === "waiting_dependency" && task.dependencyNote === dependencyNote) {
        input.repositories.updateTaskStatus(task.id, "queued");
        input.repositories.updateTaskExecutionSummary(task.id, {
          latestFailureReason: null,
          latestFailureMessage: null,
          dependencyNote: null,
        });

        const refreshed = input.repositories.getTask(task.id);
        if (!refreshed) {
          continue;
        }

        const event = waitStateTaskEvent({
          createId,
          task: refreshed,
          type: "dependency_ready",
          message: `Wait State check-in is due; task queued: ${refreshed.title}.`,
          createdAt: timestamp,
          status: "queued",
          dependencyNote: null,
        });
        input.repositories.appendTaskEvent(event);
        events.push(event);
        tasksById.set(refreshed.id, refreshed);
      }
    }
  }

  return events;
}

async function verifyHumanActionEvidence(
  humanAction: HumanAction,
  evidence: unknown,
): Promise<{ kind: "valid"; evidence: Record<string, string> } | { kind: "invalid"; errors: string[] }> {
  if (!isRecord(evidence)) {
    return { kind: "invalid", errors: ["evidence: Expected an object."] };
  }

  const normalized: Record<string, string> = {};
  const errors: string[] = [];
  for (const requirement of humanActionConfirmationRequirements(humanAction)) {
    const value = evidence[requirement];
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(`evidence.${requirement}: Expected a non-empty string.`);
      continue;
    }

    const trimmed = value.trim();
    if (requirement === "url" && !(await isReachableHttpUrl(trimmed))) {
      errors.push("evidence.url: Expected a reachable http(s) URL.");
      continue;
    }
    normalized[requirement] = trimmed;
  }

  return errors.length > 0 ? { kind: "invalid", errors } : { kind: "valid", evidence: normalized };
}

function humanActionConfirmationRequirements(humanAction: HumanAction): string[] {
  return humanAction.confirmationRequirements.length > 0 ? humanAction.confirmationRequirements : ["configuration_value"];
}

function isHumanActionBlockedTask(task: Task): boolean {
  return task.status === "blocked" || task.status === "waiting_dependency";
}

function isHumanActionBlockableTask(task: Task): boolean {
  return task.status === "queued" || task.status === "waiting_dependency";
}

function taskDependenciesRequireHumanAction(dependencies: TaskDependency[], humanAction: HumanAction): boolean {
  return dependencies.some((dependency) => handoffContractRequiresHumanAction(dependency.handoffContract, humanAction));
}

function handoffContractRequiresHumanAction(handoffContract: string | null | undefined, humanAction: HumanAction): boolean {
  const normalizedContract = handoffContract?.trim().toLowerCase();
  if (!normalizedContract) {
    return false;
  }

  const normalizedId = humanAction.id.toLowerCase();
  const normalizedLabel = humanAction.label.toLowerCase();
  return (
    normalizedContract.includes(`human_action:${normalizedId}`) ||
    normalizedContract.includes(`human_action:${normalizedLabel}`) ||
    (normalizedContract.includes("human_action") && normalizedContract.includes(normalizedId))
  );
}

function humanActionDependencyNote(humanAction: HumanAction): string {
  return `Waiting for Human Action confirmation: ${humanAction.id}.`;
}

function groupTaskDependenciesByTaskId(dependencies: TaskDependency[]): Map<string, TaskDependency[]> {
  const grouped = new Map<string, TaskDependency[]>();
  for (const dependency of dependencies) {
    grouped.set(dependency.taskId, [...(grouped.get(dependency.taskId) ?? []), dependency]);
  }
  return grouped;
}

function waitStateDependencyNote(waitState: WaitState): string {
  return `Waiting for Wait State check-in: ${waitState.id} at ${waitState.nextCheckAt}.`;
}

function waitStateTaskEvent(input: {
  createId: (prefix: string) => string;
  task: Task;
  type: "dependency_waiting" | "dependency_ready";
  message: string;
  createdAt: string;
  status: "waiting_dependency" | "queued";
  dependencyNote: string | null;
}): TaskEvent {
  return {
    id: input.createId("task_event"),
    companyId: input.task.companyId,
    taskId: input.task.id,
    type: input.type,
    message: input.message,
    createdAt: input.createdAt,
    status: input.status,
    failureReason: null,
    failureMessage: null,
    executionProfileName: null,
    requestedTimeoutMs: null,
    effectiveTimeoutMs: null,
    dependencyNote: input.dependencyNote,
    artifactWorkspacePath: input.task.artifactWorkspacePath ?? null,
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function isReachableHttpUrl(value: string): Promise<boolean> {
  if (!isHttpUrl(value)) {
    return false;
  }

  if (await fetchUrl(value, "HEAD")) {
    return true;
  }
  return fetchUrl(value, "GET");
}

async function fetchUrl(value: string, method: "GET" | "HEAD"): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch(value, { method, redirect: "follow", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

type CeoReviewDecisionResult =
  | {
      kind: "created";
      decision: CeoReviewDecision;
      task: Task;
      event: TaskEvent;
      progressEvent?: TaskProgressEvent;
      dependencyCascade?: DependencyCascadeResult;
    }
  | { kind: "not_found" }
  | { kind: "not_in_review" }
  | { kind: "missing_proof" }
  | { kind: "invalid_business_artifact" };

function createCeoReviewDecision(input: {
  repositories: ReturnType<typeof createRepositories>;
  taskId: string;
  decision: CeoReviewDecisionKind;
  returnReason: CeoReviewReturnReason | null;
  note: string | null;
  now?: () => Date;
  createId?: (prefix: string) => string;
  requestSchedulerWake?: () => void;
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
  const artifact = input.repositories.getCurrentBusinessArtifactForTask(task.id);
  if (input.decision === "approve" && !isApprovableBusinessArtifact(artifact)) {
    return { kind: "invalid_business_artifact" };
  }

  const decision: CeoReviewDecision = {
    id: input.createId?.("ceo_review_decision") ?? createDefaultId("ceo_review_decision"),
    companyId: task.companyId,
    taskId: task.id,
    departmentId: task.departmentId,
    decision: input.decision,
    returnReason: input.returnReason,
    note: input.note,
    noteText: input.note ? localizedTextFromString(input.note) : null,
    proofId: proof?.id ?? null,
    proofType: proof?.type ?? null,
    proofUri: proof?.uri ?? null,
    actor: "ceo_office",
    createdAt: timestamp,
  };
  input.repositories.createCeoReviewDecision(decision);
  if (input.decision === "approve") {
    const accepted = acceptTaskBusinessArtifact({
      repositories: input.repositories,
      task,
      artifact: artifact!,
      acceptanceProvenance: "manual_ceo_review",
      eventType: "ceo_review_decision",
      eventMessage: `CEO Office approved task: ${task.title}.`,
      keyResultProgress: { currentValue: "accepted_business_artifact", status: "met" },
      dependencyCascade: { maxDepth: 2 },
      requestSchedulerWake: input.requestSchedulerWake,
      now: input.now,
      createId: input.createId,
    });

    return {
      kind: "created",
      decision,
      task: accepted.task,
      event: accepted.event,
      dependencyCascade: accepted.dependencyCascade,
    };
  }

  if (artifact) {
    input.repositories.updateBusinessArtifactReviewStatus(
      artifact.id,
      "returned",
      timestamp,
    );
  }

  input.repositories.updateTaskStatus(task.id, "queued");

  const event: TaskEvent = {
    id: input.createId?.("task_event") ?? createDefaultId("task_event"),
    companyId: task.companyId,
    taskId: task.id,
    type: "ceo_review_decision",
    message: `CEO Office returned task: ${task.title}.`,
    messageText: ceoReviewDecisionMessageText({
      decision: input.decision,
      taskTitle: task.title,
      taskTitleText: task.titleText,
    }),
    createdAt: timestamp,
    status: "queued",
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
  progressEvent = {
    id: input.createId?.("task_progress") ?? createDefaultId("task_progress"),
    companyId: task.companyId,
    departmentId: task.departmentId,
    parentTaskId: task.parentTaskId ?? task.id,
    subjectTaskId: task.id,
    step: "blocked",
    status: "current",
    label: "CEO Office returned this, waiting for the department to rework it.",
    labelText: ceoReturnProgressLabelText(),
    detail: formatCeoReturnProgressDetail(input.returnReason, input.note),
    detailText: ceoReturnProgressDetailText({
      reason: input.returnReason ? formatCeoReturnReason(input.returnReason) : null,
      note: input.note,
      fallback: formatCeoReturnProgressDetail(input.returnReason, input.note),
    }),
    createdAt: timestamp,
  };
  input.repositories.appendTaskProgressEvent(progressEvent);

  return {
    kind: "created",
    decision,
    task: {
      ...task,
      status: "queued",
    },
    event,
    progressEvent,
  };
}

function isApprovableBusinessArtifact(artifact: BusinessArtifact | null): boolean {
  return (
    artifact !== null &&
    artifact.isCurrent &&
    artifact.validationStatus === "valid" &&
    artifact.reviewStatus === "unreviewed" &&
    (artifact.artifactKind === "deliverable" || artifact.artifactKind === "final_report")
  );
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
  return options.createId?.(prefix) ?? createDefaultId(prefix);
}

function summarizeCompany(company: Company) {
  return {
    id: company.id,
    name: company.name,
    nameText: localizedTextFromString(company.name),
    status: company.status,
    playbookId: company.playbookId,
    founderVision: company.founderVision,
    selectedCeoAgentId: company.selectedCeoAgentId,
    permissionMode: company.permissionMode ?? null,
  };
}

function summarizeCompanyListItem(company: Company, repositories: ReturnType<typeof createRepositories>) {
  return {
    ...summarizeCompany(company),
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
    taskCount: company.status === "creating" ? 0 : repositories.listTasksForCompany(company.id).length,
  };
}

function summarizeCeoIntake(intake: CeoIntake) {
  return {
    ...intake,
    bodyText: localizedTextFromString(intake.body),
  };
}

function summarizeCeoReviewDecision(decision: CeoReviewDecision) {
  return {
    ...decision,
    noteText: decision.note ? localizedSummaryText(decision.noteText, decision.note) : undefined,
  };
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

function requestSchedulerWakeForQueuedUpdates(
  options: ApiServerOptions,
  batch: DependencyCascadeResult | ParentTaskAggregationResult | undefined,
  reason: SchedulerWakeReason,
): void {
  if (batch?.updatedTasks.some((update) => update.task.status === "queued")) {
    options.requestSchedulerWake?.(reason);
  }
}

function summarizeDepartment(department: Department) {
  return {
    id: department.id,
    key: department.key ?? undefined,
    name: department.name,
    nameText: localizedSummaryText(department.nameText, department.name),
    responsibility: department.responsibility,
    responsibilityText: localizedSummaryText(department.responsibilityText, department.responsibility),
    leadAgentId: department.leadAgentId,
    memoryPath: department.memoryPath,
  };
}

function summarizeObjective(objective: Objective) {
  return {
    id: objective.id,
    title: objective.title,
    titleText: localizedSummaryText(objective.titleText, objective.title),
    priority: objective.priority,
  };
}

function summarizeKeyResult(keyResult: KeyResult) {
  return {
    id: keyResult.id,
    objectiveId: keyResult.objectiveId,
    title: keyResult.title,
    titleText: localizedSummaryText(keyResult.titleText, keyResult.title),
    metricName: keyResult.metricName,
    targetValue: keyResult.targetValue,
    targetValueText: localizedSummaryText(keyResult.targetValueText, keyResult.targetValue),
    currentValue: keyResult.currentValue,
    currentValueText: localizedSummaryText(keyResult.currentValueText, keyResult.currentValue),
    status: keyResult.status,
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
    titleText: localizedSummaryText(task.titleText, task.title),
    status: task.status,
    departmentId: task.departmentId,
    departmentKey: task.departmentKey ?? undefined,
    assigneeAgentId: task.assigneeAgentId,
    description: task.description,
    descriptionText: localizedSummaryText(task.descriptionText, task.description),
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

function localizedSummaryText(text: LocalizedText | null | undefined, fallback: string): CompleteLocalizedText {
  return {
    ...localizedTextFromString(fallback),
    ...text,
  };
}

function summarizeProof(proof: Proof) {
  return {
    id: proof.id,
    taskId: proof.taskId,
    type: proof.type,
    uri: proof.uri,
    summary: proof.summary,
    summaryText: localizedSummaryText(proof.summaryText, proof.summary),
  };
}

function summarizeBusinessArtifact(artifact: BusinessArtifact) {
  return {
    id: artifact.id,
    companyId: artifact.companyId,
    taskId: artifact.taskId,
    sourceProofId: artifact.sourceProofId,
    artifactKind: artifact.artifactKind,
    artifactRole: artifact.artifactRole,
    artifactSubtype: artifact.artifactSubtype,
    artifactType: artifact.artifactType,
    taskType: artifact.taskType,
    payload: artifact.payload,
    lineage: artifact.lineage,
    validationStatus: artifact.validationStatus,
    validationErrors: artifact.validationErrors,
    reviewStatus: artifact.reviewStatus,
    isCurrent: artifact.isCurrent,
    supersedesArtifactId: artifact.supersedesArtifactId,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
}

function summarizeFounderReport(
  company: Company,
  tasks: Task[],
  artifacts: ReturnType<typeof summarizeBusinessArtifact>[],
  waitStates: WaitState[],
  humanActions: HumanAction[],
  visionGaps: VisionGap[],
  taskDependencies: TaskDependency[],
  departments: Department[],
) {
  const acceptedArtifacts = artifacts.filter((artifact) => artifact.reviewStatus === "accepted" && artifact.isCurrent);
  const blockedTasks = tasks.filter((task) => task.status === "blocked" || task.status === "needs_replan" || task.status === "failed");
  const reviewTasks = tasks.filter((task) => task.status === "review");
  const driftArtifacts = artifacts.filter((artifact) => artifact.validationStatus === "invalid_drift");
  const dependenciesByTaskId = groupTaskDependenciesByTaskId(taskDependencies);
  const departmentById = new Map(departments.map((department) => [department.id, department]));
  const acceptedArtifactsByTaskId = new Map(acceptedArtifacts.map((artifact) => [artifact.taskId, artifact]));

  return {
    founderVision: company.founderVision,
    actualOutputs: acceptedArtifacts.map((artifact) => ({
      taskId: artifact.taskId,
      artifactKind: artifact.artifactKind,
      artifactRole: artifact.artifactRole,
      artifactSubtype: artifact.artifactSubtype,
      artifactType: artifact.artifactType,
      taskType: artifact.taskType,
      payload: artifact.payload,
    })),
    completedTaskCount: tasks.filter((task) => task.status === "complete").length,
    reviewTaskCount: reviewTasks.length,
    blockedTaskCount: blockedTasks.length,
    departmentContributions: departments.map((department) => {
      const departmentTasks = tasks.filter((task) => task.departmentId === department.id);
      const departmentTaskIds = new Set(departmentTasks.map((task) => task.id));
      return {
        departmentId: department.id,
        departmentName: department.name,
        completedTaskCount: departmentTasks.filter((task) => task.status === "complete").length,
        acceptedOutputCount: acceptedArtifacts.filter((artifact) => departmentTaskIds.has(artifact.taskId)).length,
        blockedTaskCount: departmentTasks.filter((task) => task.status === "blocked" || task.status === "needs_replan" || task.status === "failed").length,
        humanActionCount: humanActions.filter((action) => action.departmentId === department.id).length,
        waitStateCount: waitStates.filter((waitState) => waitState.departmentId === department.id).length,
        visionGapCount: visionGaps.filter((gap) => gap.departmentId === department.id).length,
      };
    }),
    dependencyState: tasks.map((task) => ({
      taskId: task.id,
      title: task.title,
      departmentId: task.departmentId,
      departmentName: departmentById.get(task.departmentId)?.name ?? task.departmentId,
      status: task.status,
      dependsOnTaskIds: (dependenciesByTaskId.get(task.id) ?? []).map((dependency) => dependency.dependsOnTaskId),
      hasAcceptedOutput: acceptedArtifactsByTaskId.has(task.id),
      dependencyNote: task.dependencyNote,
    })),
    humanActionCount: humanActions.length,
    humanActions: humanActions.map((action) => ({
      id: action.id,
      label: action.label,
      status: action.status,
      departmentId: action.departmentId,
      blockedTaskIds: action.blockedTaskIds,
      confirmationRequirements: action.confirmationRequirements,
    })),
    waitStateCount: waitStates.length,
    waitStates: waitStates.map((waitState) => ({
      id: waitState.id,
      label: waitState.label,
      status: waitState.status,
      nextCheckAt: waitState.nextCheckAt,
      affectedTaskIds: waitState.affectedTaskIds,
    })),
    visionGapCount: visionGaps.length,
    visionGaps: visionGaps.map((gap) => ({
      id: gap.id,
      label: gap.label,
      severity: gap.severity,
      departmentId: gap.departmentId,
      relatedTaskId: gap.relatedTaskId,
    })),
    directionDriftDetected: driftArtifacts.length > 0,
    nextSteps: [
      ...reviewTasks.map((task) => `Review ${task.title}.`),
      ...humanActions.filter((action) => action.status === "pending").map((action) => `Complete Human Action: ${action.label}`),
      ...visionGaps
        .filter((gap) => gap.severity === "blocking" || gap.severity === "strategic")
        .map((gap) => `Resolve Vision Gap: ${gap.label}`),
      ...blockedTasks.map((task) => task.dependencyNote ?? task.latestFailureMessage ?? `Resolve ${task.title}.`),
      ...waitStates.map(formatWaitStateNextStep),
    ],
  };
}

function formatWaitStateNextStep(waitState: WaitState): string {
  const label = waitState.label.replace(/[.!?]+$/, "");
  return waitState.status === "ready_for_check_in" ? `Check ${label}.` : `Monitor ${label} until ${waitState.nextCheckAt}.`;
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
    rationaleText: localizedTextFromString(proposal.rationale),
    replacementTasks: proposal.replacementTasks.map((task) => ({
      ...task,
      titleText: localizedTextFromString(task.title),
      descriptionText: localizedTextFromString(task.description),
    })),
    createdAt: proposal.createdAt,
    confirmedAt: proposal.confirmedAt ?? undefined,
  };
}

function summarizeTaskEvent(event: TaskEvent) {
  return {
    type: event.type,
    companyId: event.companyId,
    taskId: event.taskId,
    message: event.message,
    messageText: localizedSummaryText(event.messageText, event.message),
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

function summarizeCompanyEvent(event: CompanyEvent) {
  return {
    type: event.type,
    companyId: event.companyId,
    message: event.message,
    messageText: localizedSummaryText(event.messageText, event.message),
    status: event.status ?? undefined,
  };
}

function summarizeTaskProgressEvent(event: TaskProgressEvent) {
  return {
    ...event,
    labelText: localizedSummaryText(event.labelText, event.label),
    detailText: event.detail ? localizedSummaryText(event.detailText, event.detail) : undefined,
  };
}

function summarizeTaskCompletionEvent(event: TaskCompletionEvent) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultCreateId(prefix: string): string {
  return createDefaultId(prefix);
}
