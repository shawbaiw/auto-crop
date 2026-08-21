import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Company, Department, Objective, Proof, ReplanProposal, Task, TaskEvent } from "@auto-crop/core";
import type { AgentAdapter } from "../adapters/types";
import type { createRepositories, ReviewRecord } from "../db/repositories";
import { EventStream } from "../events/sse";
import type { PolicyMode } from "../policies/policy";
import { createCompany } from "../runtime/createCompany";
import { triggerKillSwitch } from "../runtime/killSwitch";
import { confirmReplanProposal, createReplanProposalForTask } from "../runtime/replan";
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

    sendJson(response, 200, buildCompanyState(company, options.repositories));
    return;
  }

  const blueprintMatch = url.pathname.match(/^\/api\/companies\/([^/]+)\/blueprint$/);
  if (method === "PATCH" && blueprintMatch) {
    const companyId = blueprintMatch[1];
    const body = await readJson<{ companyName?: string }>(request);
    const company = options.repositories.getCompany(companyId);

    if (!company) {
      sendJson(response, 404, { error: `Company not found: ${companyId}` });
      return;
    }

    sendJson(response, 200, {
      company: {
        ...company,
        name: body.companyName ?? company.name,
      },
    });
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

  const cancelMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/cancel$/);
  if (method === "POST" && cancelMatch) {
    const taskId = cancelMatch[1];
    options.repositories.updateTaskStatus(taskId, "cancelled");
    sendJson(response, 200, { task: options.repositories.getTask(taskId) });
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
    sendJson(response, 200, {
      proposal: summarizeReplanProposal(result.proposal),
      sourceTask: summarizeTask(result.sourceTask, []),
      createdTasks: summarizeTasks(result.createdTasks, []),
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

function buildCompanyState(company: Company, repositories: ReturnType<typeof createRepositories>) {
  const tasks = repositories.listTasksForCompany(company.id);

  return {
    company: summarizeCompany(company),
    departments: repositories.listDepartments(company.id).map(summarizeDepartment),
    objectives: repositories.listObjectives(company.id).map(summarizeObjective),
    keyResults: repositories.listKeyResults(company.id),
    tasks: summarizeTasks(tasks, repositories.listTaskDependenciesForCompany(company.id)),
    proof: repositories.listProofsForCompany(company.id).map(summarizeProof),
    reviews: repositories.listReviews(company.id).map(summarizeReview),
    replanProposals: repositories.listReplanProposalsForCompany(company.id).map(summarizeReplanProposal),
    activity: repositories.listTaskEventsForCompany(company.id).map(summarizeTaskEvent),
    editable: {
      companyName: company.name,
      objectives: repositories.listObjectives(company.id).map((objective) => objective.title),
      firstTasks: tasks.map((task) => task.title),
    },
  };
}

function summarizeCompany(company: Company) {
  return {
    id: company.id,
    name: company.name,
    status: company.status,
    playbookId: company.playbookId,
    selectedCeoAgentId: company.selectedCeoAgentId,
  };
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
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
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
