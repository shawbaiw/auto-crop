import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Proof, TaskEvent } from "@auto-crop/core";
import type { AgentAdapter, AgentRunRequest } from "../adapters/types";
import { createMockAgentAdapter } from "../adapters/mockAgent";
import { createDatabaseClient } from "../db/client";
import { createRepositories, type ReviewRecord } from "../db/repositories";
import { migrate } from "../db/schema";
import { aiSaasPlaybook } from "../playbooks/aiSaas";
import { createApiServer } from "./routes";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("API routes", () => {
  it("detects agents, creates a company, activates it, exposes proof/reviews, cancels tasks, and triggers kill switch", async () => {
    const fixture = await startFixtureServer();

    const agents = await getJson<{ agents: Array<{ id: string; detected: boolean }> }>(
      `${fixture.baseUrl}/api/agents`,
    );
    expect(agents.agents).toContainEqual({ id: "codex", name: "Codex", capabilities: ["code", "frontend", "test"], detected: true });

    const created = await postJson<{ company: { id: string; status: string }; editable: { companyName: string } }>(
      `${fixture.baseUrl}/api/companies`,
      {
        companyName: "Pricing Page Studio",
        founderVision: "Build an AI SaaS that creates pricing pages.",
        selectedCeoAgentId: "codex",
        permissionMode: "balanced",
        assets: ["README.md"],
      },
    );
    expect(created.company.status).toBe("draft");
    expect(created.editable.companyName).toBe("Pricing Page Studio");

    const companies = await getJson<{
      companies: Array<{ id: string; name: string; taskCount: number; updatedAt: string }>;
    }>(`${fixture.baseUrl}/api/companies`);
    expect(companies.companies).toEqual([
      expect.objectContaining({
        id: created.company.id,
        name: "Pricing Page Studio",
        taskCount: expect.any(Number),
        updatedAt: expect.any(String),
      }),
    ]);

    const activated = await postJson<{ company: { status: string } }>(
      `${fixture.baseUrl}/api/companies/${created.company.id}/activate`,
      {},
    );
    expect(activated.company.status).toBe("active");

    const task = fixture.repositories.fetchQueuedTasks(1)[0];
    expect(task).toBeDefined();
    fixture.repositories.appendProof({
      id: "proof_1",
      taskId: task.id,
      type: "file",
      uri: "README.md",
      summary: "Proof exists.",
      verifiedAt: null,
    } satisfies Proof);
    fixture.repositories.createReview({
      id: "review_1",
      companyId: created.company.id,
      summary: "Review exists.",
      reviewPath: ".auto-crop/reviews/review_1.md",
      createdAt: "2026-08-17T00:00:00.000Z",
    } satisfies ReviewRecord);
    fixture.repositories.appendTaskEvent({
      id: "task_event_1",
      companyId: created.company.id,
      taskId: task.id,
      type: "task_failed",
      message: "Task failed: sample.",
      createdAt: "2026-08-17T00:00:00.000Z",
      status: "failed",
      failureReason: "agent_failed",
      failureMessage: "Task failed: sample.",
      executionProfileName: "short",
      requestedTimeoutMs: 120_000,
      effectiveTimeoutMs: 120_000,
      dependencyNote: null,
      artifactWorkspacePath: null,
    } satisfies TaskEvent);

    const proofs = await getJson<{ proof: Proof[] }>(`${fixture.baseUrl}/api/tasks/${task.id}/proof`);
    expect(proofs.proof).toHaveLength(1);

    const reviews = await getJson<{ reviews: ReviewRecord[] }>(
      `${fixture.baseUrl}/api/companies/${created.company.id}/reviews`,
    );
    expect(reviews.reviews).toHaveLength(1);

    const state = await getJson<{
      proof: Proof[];
      reviews: ReviewRecord[];
      activity: Array<{ type: string; failureReason?: string }>;
      tasks: Array<{ dependsOnTaskIds: string[] }>;
    }>(`${fixture.baseUrl}/api/companies/${created.company.id}/state`);
    expect(state.proof).toHaveLength(1);
    expect(state.reviews).toHaveLength(1);
    expect(state.activity).toContainEqual(expect.objectContaining({ type: "task_failed", failureReason: "agent_failed" }));
    expect(state.tasks.some((stateTask) => stateTask.dependsOnTaskIds.length > 0)).toBe(true);

    const cancelled = await postJson<{ task: { status: string } }>(
      `${fixture.baseUrl}/api/tasks/${task.id}/cancel`,
      {},
    );
    expect(cancelled.task.status).toBe("cancelled");

    fixture.repositories.updateTaskStatus(task.id, "running");
    fixture.repositories.createAgentRun({
      id: "agent_run_1",
      taskId: task.id,
      agentId: "codex",
      status: "running",
      logPath: "agent.log",
      startedAt: "2026-08-17T00:00:00.000Z",
      finishedAt: null,
    });
    const killed = await postJson<{ paused: boolean; company: { status: string } }>(
      `${fixture.baseUrl}/api/kill-switch`,
      { companyId: created.company.id },
    );
    expect(killed.paused).toBe(true);
    expect(killed.company.status).toBe("review");

    await fixture.close();
  });

  it("requires companyName when creating a company", async () => {
    const fixture = await startFixtureServer();
    const response = await fetch(`${fixture.baseUrl}/api/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        founderVision: "Build an AI SaaS that creates pricing pages.",
        selectedCeoAgentId: "codex",
        permissionMode: "balanced",
        assets: [],
      }),
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/company name is required/i);

    await fixture.close();
  });

  it("streams server-sent events", async () => {
    const fixture = await startFixtureServer();
    const response = await fetch(`${fixture.baseUrl}/api/events`);
    const firstChunk = response.body?.getReader();
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    fixture.events.publish({ type: "task_log", taskId: "task_1", message: "hello" });

    const text = await readUntil(firstChunk, "event: task_log");
    expect(text).toContain("event: task_log");
    expect(text).toContain("hello");

    await firstChunk?.cancel();
    await fixture.close();
  });

  it("creates and confirms replan proposals through the API", async () => {
    const fixture = await startFixtureServer();
    const created = await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const sourceTask = fixture.repositories.fetchQueuedTasks(1)[0]!;
    const consumerTask = fixture.repositories.fetchQueuedTasks(2)[1]!;
    fixture.repositories.updateTaskStatus(sourceTask.id, "needs_replan");
    fixture.repositories.updateTaskExecutionSummary(sourceTask.id, {
      latestFailureReason: "needs_replan",
      latestFailureMessage: "Task needs replanning.",
    });
    fixture.repositories.createTaskDependency({ taskId: consumerTask.id, dependsOnTaskId: sourceTask.id });

    const proposed = await postJson<{
      proposal: { id: string; sourceTaskId: string; status: string; replacementTasks: Array<{ title: string }> };
    }>(`${fixture.baseUrl}/api/tasks/${sourceTask.id}/replan-proposals`, {});

    expect(proposed.proposal).toMatchObject({
      id: "replan_proposal_1",
      sourceTaskId: sourceTask.id,
      status: "proposed",
    });
    expect(proposed.proposal.replacementTasks).toHaveLength(3);

    const state = await getJson<{ replanProposals: Array<{ id: string }> }>(
      `${fixture.baseUrl}/api/companies/${created.company.id}/state`,
    );
    expect(state.replanProposals).toEqual([expect.objectContaining({ id: proposed.proposal.id })]);

    const confirmed = await postJson<{
      proposal: { status: string };
      createdTasks: Array<{ id: string }>;
    }>(`${fixture.baseUrl}/api/replan-proposals/${proposed.proposal.id}/confirm`, {});

    expect(confirmed.proposal.status).toBe("confirmed");
    expect(confirmed.createdTasks).toHaveLength(3);
    expect(fixture.repositories.listTaskDependencies(consumerTask.id)).toEqual([
      { taskId: consumerTask.id, dependsOnTaskId: confirmed.createdTasks[2]!.id },
    ]);

    await fixture.close();
  });

  it("refreshes a blocked task after upstream dependency recovery", async () => {
    const fixture = await startFixtureServer();
    const created = await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const producerTask = fixture.repositories.fetchQueuedTasks(1)[0]!;
    const consumerTask = fixture.repositories.fetchQueuedTasks(2)[1]!;
    fixture.repositories.createTaskDependency({ taskId: consumerTask.id, dependsOnTaskId: producerTask.id });
    fixture.repositories.updateTaskStatus(producerTask.id, "failed");
    fixture.repositories.updateTaskStatus(consumerTask.id, "blocked");
    fixture.repositories.updateTaskExecutionSummary(consumerTask.id, {
      latestFailureReason: "dependency_failed",
      latestFailureMessage: "Task blocked by failed dependency.",
      dependencyNote: `Blocked by failed dependency: ${producerTask.title}.`,
    });
    fixture.repositories.updateTaskStatus(producerTask.id, "review");
    fixture.repositories.appendProof({
      id: "proof_1",
      taskId: producerTask.id,
      type: "file",
      uri: "proof.md",
      summary: "Recovered proof.",
      verifiedAt: null,
    });

    const refreshed = await postJson<{
      task: { id: string; status: string; failureReason?: string; dependencyNote?: string };
      event: { type: string; status: string };
    }>(`${fixture.baseUrl}/api/tasks/${consumerTask.id}/refresh`, {});

    expect(refreshed.task).toMatchObject({
      id: consumerTask.id,
      status: "queued",
    });
    expect(refreshed.task.failureReason).toBeUndefined();
    expect(refreshed.task.dependencyNote).toBeUndefined();
    expect(refreshed.event).toMatchObject({
      type: "dependency_ready",
      status: "queued",
    });

    const state = await getJson<{ activity: Array<{ type: string; taskId?: string }> }>(
      `${fixture.baseUrl}/api/companies/${created.company.id}/state`,
    );
    expect(state.activity).toContainEqual(expect.objectContaining({ type: "dependency_ready", taskId: consumerTask.id }));

    await fixture.close();
  });

  it("creates CEO intakes and returns them in company state", async () => {
    const fixture = await startFixtureServer();
    const created = await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });

    const submitted = await postJson<{
      intake: { id: string; companyId: string; body: string; status: string; createdAt: string };
    }>(`${fixture.baseUrl}/api/companies/${created.company.id}/ceo-intakes`, {
      body: "Add a multiplayer competitive mode and build a prototype first.",
    });

    expect(submitted.intake).toMatchObject({
      id: "ceo_intake_1",
      companyId: created.company.id,
      body: "Add a multiplayer competitive mode and build a prototype first.",
      status: "received",
      createdAt: "2026-08-17T00:00:00.000Z",
    });

    const state = await getJson<{ ceoIntakes: Array<{ id: string; body: string; status: string }> }>(
      `${fixture.baseUrl}/api/companies/${created.company.id}/state`,
    );
    expect(state.ceoIntakes).toEqual([expect.objectContaining({ id: submitted.intake.id, status: "received" })]);

    await fixture.close();
  });

  it("uses the selected CEO agent to generate replan proposals through the API", async () => {
    const fixture = await startFixtureServer({
      plannerOutput: [
        "```json",
        JSON.stringify({
          rationale: "API planner split the task into a handoff and implementation.",
          replacementTasks: [
            {
              title: "Write API handoff",
              description: "Define the replacement scope and proof contract.",
              requiredCapabilities: ["writing", "research"],
              proofSchemaId: "product-brief",
              riskLevel: "low",
            },
            {
              title: "Build API replacement",
              description: "Implement the replacement from the approved handoff.",
              requiredCapabilities: ["code", "frontend"],
              proofSchemaId: "landing-page-file",
              riskLevel: "medium",
            },
          ],
        }),
        "```",
      ].join("\n"),
    });
    await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const sourceTask = fixture.repositories.fetchQueuedTasks(1)[0]!;
    fixture.repositories.updateTaskStatus(sourceTask.id, "needs_replan");
    fixture.repositories.updateTaskExecutionSummary(sourceTask.id, {
      latestFailureReason: "needs_replan",
      latestFailureMessage: "Task needs replanning.",
    });

    const proposed = await postJson<{
      proposal: {
        rationale: string;
        proposalSource: string;
        plannerAgentId?: string;
        plannerPromptPath?: string;
        replacementTasks: Array<{ title: string }>;
      };
    }>(`${fixture.baseUrl}/api/tasks/${sourceTask.id}/replan-proposals`, {});

    expect(proposed.proposal.rationale).toBe("API planner split the task into a handoff and implementation.");
    expect(proposed.proposal.proposalSource).toBe("planner_agent");
    expect(proposed.proposal.plannerAgentId).toBe("codex");
    expect(proposed.proposal.plannerPromptPath).toContain(`replan-${sourceTask.id}-prompt.md`);
    expect(proposed.proposal.replacementTasks.map((task) => task.title)).toEqual([
      "Write API handoff",
      "Build API replacement",
    ]);
    expect(fixture.plannerRequests).toHaveLength(1);
    expect(fixture.plannerRequests[0]?.taskId).toBe(`${sourceTask.id}_replan_planner`);

    await fixture.close();
  });
});

async function startFixtureServer(options: { plannerOutput?: string } = {}) {
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-api-"));
  createdDirs.push(projectRoot);
  const client = createDatabaseClient(":memory:");
  migrate(client);
  const repositories = createRepositories(client);
  const blueprint = aiSaasPlaybook.createBlueprint({
    companyName: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    preferredEngineeringAgentId: "codex",
    preferredStrategyAgentId: "codex",
  });
  const plannerRequests: AgentRunRequest[] = [];
  const codex = options.plannerOutput
    ? createRoutedAgent({
        blueprintOutput: ["## Human CEO Brief", "Validate.", "```json", JSON.stringify({ brief: "Validate.", blueprint }), "```"].join("\n"),
        plannerOutput: options.plannerOutput,
        plannerRequests,
      })
    : createMockAgentAdapter({
        id: "codex",
        name: "Codex",
        capabilities: ["code", "frontend", "test"],
        output: ["## Human CEO Brief", "Validate.", "```json", JSON.stringify({ brief: "Validate.", blueprint }), "```"].join("\n"),
      });
  const server = createApiServer({
    projectRoot,
    repositories,
    agents: [codex],
    now: () => new Date("2026-08-17T00:00:00.000Z"),
    createId: createSequentialIdFactory(),
  });

  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  const address = server.httpServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    repositories,
    events: server.events,
    plannerRequests,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      client.close();
    },
  };
}

function createRoutedAgent(options: {
  blueprintOutput: string;
  plannerOutput: string;
  plannerRequests: AgentRunRequest[];
}): AgentAdapter {
  return {
    id: "codex",
    name: "Codex",
    capabilities: ["code", "frontend", "test", "writing", "research"],
    async detect() {
      return true;
    },
    async run(request) {
      if (request.metadata.purpose === "replan_proposal") {
        options.plannerRequests.push(request);
        return {
          status: "complete",
          exitCode: 0,
          stdout: options.plannerOutput,
          stderr: "",
        };
      }

      return {
        status: "complete",
        exitCode: 0,
        stdout: options.blueprintOutput,
        stderr: "",
      };
    },
  };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return (await response.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as T;
}

function createSequentialIdFactory(): (prefix: string) => string {
  const counts = new Map<string, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
  pattern: string,
): Promise<string> {
  if (!reader) {
    throw new Error("Missing stream reader.");
  }

  let text = "";

  while (!text.includes(pattern)) {
    const chunk = await reader.read();

    if (chunk.done) {
      break;
    }

    text += new TextDecoder().decode(chunk.value);
  }

  return text;
}
