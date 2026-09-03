import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusinessArtifact, Proof, Task, TaskEvent } from "@auto-crop/core";
import type { AgentAdapter, AgentRunRequest } from "../adapters/types";
import { createMockAgentAdapter } from "../adapters/mockAgent";
import { createDatabaseClient } from "../db/client";
import { createRepositories, type ReviewRecord } from "../db/repositories";
import { migrate } from "../db/schema";
import { aiSaasPlaybook } from "../playbooks/aiSaas";
import { acceptTaskBusinessArtifact } from "../runtime/businessAcceptance";
import { createApiServer, type SchedulerWakeReason } from "./routes";

const createdDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
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

    const created = await postJson<{ company: { id: string; name: string; status: string } }>(
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
    expect(created.company.name).toBe("Pricing Page Studio");

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
      proof: Array<Proof & { summaryText: { en: string; zh: string } }>;
      reviews: ReviewRecord[];
      activity: Array<{ type: string; failureReason?: string }>;
      departments: Array<{
        name: string;
        nameText: { en: string; zh: string };
        responsibility: string;
        responsibilityText: { en: string; zh: string };
      }>;
      objectives: Array<{ title: string; titleText: { en: string; zh: string } }>;
      tasks: Array<{
        title: string;
        titleText: { en: string; zh: string };
        description: string;
        descriptionText: { en: string; zh: string };
        dependsOnTaskIds: string[];
      }>;
      taskProgressEvents: Array<{ label: string; labelText: { en: string; zh: string }; detailText?: { en: string; zh: string } }>;
    }>(`${fixture.baseUrl}/api/companies/${created.company.id}/state`);
    expect(state.proof).toHaveLength(1);
    expect(state.reviews).toHaveLength(1);
    expect(state.activity).toContainEqual(expect.objectContaining({ type: "task_failed", failureReason: "agent_failed" }));
    expect(state.tasks.some((stateTask) => stateTask.dependsOnTaskIds.length > 0)).toBe(true);
    expect(state.departments[0]?.nameText).toEqual({
      en: state.departments[0]?.name,
      zh: "产品",
    });
    expect(state.departments[0]?.responsibilityText).toEqual({
      en: state.departments[0]?.responsibility,
      zh: "定义目标客户、切入点、MVP 范围和第一条收入路径。",
    });
    expect(state.objectives[0]?.titleText).toEqual({
      en: state.objectives[0]?.title,
      zh: "验证第一个 AI SaaS 切入点",
    });
    expect(state.tasks[0]?.titleText).toEqual({ en: state.tasks[0]?.title, zh: "撰写第一份产品简报" });
    expect(state.tasks[0]?.descriptionText).toEqual({
      en: state.tasks[0]?.description,
      zh: "围绕创始人愿景定义目标客户、切入点、核心用例、MVP 范围和第一条收入路径。",
    });
    expect(state.taskProgressEvents[0]?.labelText).toEqual({
      en: state.taskProgressEvents[0]?.label,
      zh: "已接收 CEO 任务",
    });
    expect(state.proof[0]?.summaryText).toEqual({ en: state.proof[0]?.summary, zh: state.proof[0]?.summary });

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

  it("accepts slow company creation without waiting for the CEO agent", async () => {
    let releaseAgent!: () => void;
    const agentStarted = new Promise<void>((resolve) => {
      const agentReleased = new Promise<void>((release) => {
        releaseAgent = release;
      });
      void agentReleased.then(resolve);
    });
    const fixture = await startFixtureServer({
      ceoAgent: createDelayedBlueprintAgent(agentStarted),
    });

    const response = await fetch(`${fixture.baseUrl}/api/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName: "Pricing Page Studio",
        founderVision: "Build an AI SaaS that creates pricing pages.",
        selectedCeoAgentId: "codex",
        permissionMode: "balanced",
        assets: [],
        creationIdempotencyKey: "create-key-1",
      }),
    });
    const body = (await response.json()) as { company: { id: string; status: string }; tasks: unknown[]; creationEvents: unknown[] };

    expect(response.status).toBe(202);
    expect(body.company).toMatchObject({ id: "company_1", status: "creating" });
    expect(body.tasks).toEqual([]);
    expect(body.creationEvents).toEqual([
      expect.objectContaining({ type: "company_creation_accepted", message: "Company Creation accepted." }),
    ]);
    expect(fixture.repositories.listTasksForCompany(body.company.id)).toEqual([]);

    const duplicateResponse = await fetch(`${fixture.baseUrl}/api/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName: "Pricing Page Studio",
        founderVision: "Build an AI SaaS that creates pricing pages.",
        selectedCeoAgentId: "codex",
        permissionMode: "balanced",
        assets: [],
        creationIdempotencyKey: "create-key-1",
      }),
    });
    const duplicateBody = (await duplicateResponse.json()) as { company: { id: string; status: string } };
    expect(duplicateResponse.status).toBe(202);
    expect(duplicateBody.company.id).toBe(body.company.id);
    expect(fixture.repositories.listCompanies()).toHaveLength(1);

    releaseAgent();
    await waitForCompanyStatus(fixture, body.company.id, "draft");
    expect(fixture.repositories.listTasksForCompany(body.company.id).length).toBeGreaterThan(0);

    await fixture.close();
  });

  it("uses collision-resistant default ids for async company creation events", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_788_400_651_315);
    const fixture = await startFixtureServer({ useDefaultCreateId: true });

    const created = await postCreatingCompany(fixture, "default-id-key-1");
    await waitForCompanyStatus(fixture, created.company.id, "draft");

    expect(fixture.repositories.listCreationAttemptsForCompany(created.company.id)).toEqual([
      expect.objectContaining({ status: "complete", failureMessage: null }),
    ]);
    const creationEvents = fixture.repositories.listCompanyEventsForCompany(created.company.id);
    expect(creationEvents.map((event) => event.type)).toEqual(expect.arrayContaining([
      "company_creation_accepted",
      "company_creation_agent_started",
      "company_creation_blueprint_parsed",
      "company_creation_records_created",
      "company_creation_completed",
    ]));
    expect(creationEvents).toHaveLength(5);
    expect(new Set(creationEvents.map((event) => event.id)).size).toBe(creationEvents.length);

    await fixture.close();
  });

  it("marks failed creation as retryable and retries on the same company", async () => {
    const fixture = await startFixtureServer({
      ceoAgent: createFlakyCreationAgent(),
    });

    const created = await postCreatingCompany(fixture, "retry-key-1");
    await waitForCompanyStatus(fixture, created.company.id, "creation_failed");

    const failedState = await getJson<{
      company: { id: string; status: string };
      creationEvents: Array<{ type: string; message: string }>;
    }>(`${fixture.baseUrl}/api/companies/${created.company.id}/state`);
    expect(failedState.company.status).toBe("creation_failed");
    expect(failedState.creationEvents).toContainEqual(
      expect.objectContaining({ type: "company_creation_failed" }),
    );

    const retried = await postJson<{
      company: { id: string; status: string };
      tasks: unknown[];
    }>(`${fixture.baseUrl}/api/companies/${created.company.id}/retry-creation`, {});
    expect(retried.company.id).toBe(created.company.id);
    expect(retried.company.status).toBe("draft");
    expect(retried.tasks.length).toBeGreaterThan(0);
    expect(fixture.repositories.listCreationAttemptsForCompany(created.company.id)).toHaveLength(2);

    await fixture.close();
  });

  it("reconciles stale creating companies when reading company state", async () => {
    const fixture = await startFixtureServer({
      now: () => new Date("2026-08-17T00:20:00.000Z"),
    });
    fixture.repositories.createCompany({
      id: "company_1",
      name: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      playbookId: "ai-saas",
      permissionMode: "balanced",
      status: "creating",
      creationIdempotencyKey: "stuck-key",
      creationInput: {
        companyName: "Pricing Page Studio",
        founderVision: "Build an AI SaaS that creates pricing pages.",
        selectedCeoAgentId: "codex",
        permissionMode: "balanced",
        assets: [],
      },
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
    });
    fixture.repositories.createCreationAttempt({
      id: "creation_attempt_1",
      companyId: "company_1",
      status: "running",
      startedAt: "2026-08-17T00:00:00.000Z",
      finishedAt: null,
      promptPath: ".auto-crop/companies/company_1/ceo-prompt.md",
      failureMessage: null,
    });

    const state = await getJson<{
      company: { status: string };
      creationEvents: Array<{ type: string; message: string }>;
      creationAttempts: Array<{ status: string; failureMessage: string | null }>;
    }>(`${fixture.baseUrl}/api/companies/company_1/state`);

    expect(state.company.status).toBe("creation_failed");
    expect(state.creationAttempts).toEqual([
      expect.objectContaining({
        status: "failed",
        failureMessage: "Company Creation failed: active creation attempt timed out.",
      }),
    ]);
    expect(state.creationEvents).toContainEqual(
      expect.objectContaining({ type: "company_creation_failed" }),
    );

    await fixture.close();
  });

  it("streams server-sent events", async () => {
    const fixture = await startFixtureServer();
    const response = await fetch(`${fixture.baseUrl}/api/events?companyId=company_1`);
    const firstChunk = response.body?.getReader();
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    fixture.events.publish({ type: "task_log", taskId: "task_1", message: "hello" });

    const text = await readUntil(firstChunk, "event: task_log");
    expect(text).toContain("event: task_log");
    expect(text).toContain("hello");

    await firstChunk?.cancel();
    await fixture.close();
  });

  it("rejects event streams without a company id", async () => {
    const fixture = await startFixtureServer();
    const response = await fetch(`${fixture.baseUrl}/api/events`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/companyId is required/i);

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
    fixture.repositories.updateTaskStatus(consumerTask.id, "blocked");
    fixture.repositories.updateTaskExecutionSummary(consumerTask.id, {
      latestFailureReason: "needs_replan",
      latestFailureMessage: `Task blocked: ${consumerTask.title} / needs_replan / ${sourceTask.title} is needs_replan.`,
      dependencyNote: `Waiting for dependency to be replanned: ${sourceTask.title}.`,
    });

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
      dependencyCascade: {
        updatedTasks: Array<{ id: string; status: string; failureReason?: string; dependencyNote?: string; dependsOnTaskIds?: string[] }>;
        events: Array<{ type: string; taskId?: string; status?: string; dependencyNote?: string }>;
        progressEvents: Array<{ subjectTaskId: string | null; label: string; detail: string | null }>;
      };
    }>(`${fixture.baseUrl}/api/replan-proposals/${proposed.proposal.id}/confirm`, {});

    expect(confirmed.proposal.status).toBe("confirmed");
    expect(confirmed.createdTasks).toHaveLength(3);
    expect(fixture.repositories.listTaskDependencies(consumerTask.id)).toEqual([
      { taskId: consumerTask.id, dependsOnTaskId: confirmed.createdTasks[2]!.id },
    ]);
    expect(confirmed.dependencyCascade.updatedTasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: consumerTask.id,
        status: "waiting_dependency",
        dependsOnTaskIds: [confirmed.createdTasks[2]!.id],
        dependencyNote: `Waiting for dependency deliverable: Validate replacement output for ${sourceTask.title} (queued).`,
      }),
    ]));
    expect(confirmed.dependencyCascade.updatedTasks.find((task) => task.id === consumerTask.id)?.failureReason).toBeUndefined();
    expect(confirmed.dependencyCascade.events).toContainEqual(
      expect.objectContaining({
        type: "dependency_waiting",
        taskId: consumerTask.id,
        status: "waiting_dependency",
      }),
    );
    expect(confirmed.dependencyCascade.progressEvents).toContainEqual(
      expect.objectContaining({
        subjectTaskId: consumerTask.id,
        label: "Dependency path updated after replan; waiting for replacement deliverable.",
      }),
    );
    expect(fixture.repositories.getTask(consumerTask.id)).toMatchObject({
      status: "waiting_dependency",
      latestFailureReason: null,
      dependencyNote: `Waiting for dependency deliverable: Validate replacement output for ${sourceTask.title} (queued).`,
    });

    await fixture.close();
  });

  it("returns queued affected consumers after replan dependency rewiring without writing dependency events", async () => {
    const fixture = await startFixtureServer();
    await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
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

    const proposed = await postJson<{ proposal: { id: string } }>(
      `${fixture.baseUrl}/api/tasks/${sourceTask.id}/replan-proposals`,
      {},
    );
    const confirmed = await postJson<{
      createdTasks: Array<{ id: string }>;
      dependencyCascade: {
        updatedTasks: Array<{ id: string; status: string; dependsOnTaskIds?: string[] }>;
        events: Array<{ type: string; taskId?: string }>;
        progressEvents: Array<{ subjectTaskId: string | null }>;
      };
    }>(`${fixture.baseUrl}/api/replan-proposals/${proposed.proposal.id}/confirm`, {});

    expect(confirmed.dependencyCascade.updatedTasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: consumerTask.id,
        status: "queued",
        dependsOnTaskIds: [confirmed.createdTasks[2]!.id],
      }),
    ]));
    expect(confirmed.dependencyCascade.events).toEqual([]);
    expect(confirmed.dependencyCascade.progressEvents).toEqual([]);

    await fixture.close();
  });

  it("keeps replan confirmation successful when affected consumer refresh fails", async () => {
    const fixture = await startFixtureServer();
    await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
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
    fixture.repositories.updateTaskStatus(consumerTask.id, "blocked");
    fixture.repositories.updateTaskExecutionSummary(consumerTask.id, {
      latestFailureReason: "needs_replan",
      latestFailureMessage: `Task blocked: ${consumerTask.title} / needs_replan / ${sourceTask.title} is needs_replan.`,
      dependencyNote: `Waiting for dependency to be replanned: ${sourceTask.title}.`,
    });

    const proposed = await postJson<{ proposal: { id: string } }>(
      `${fixture.baseUrl}/api/tasks/${sourceTask.id}/replan-proposals`,
      {},
    );
    const originalUpdateTaskStatus = fixture.repositories.updateTaskStatus;
    fixture.repositories.updateTaskStatus = (taskId, status) => {
      if (taskId === consumerTask.id) {
        throw new Error("consumer refresh failed");
      }
      originalUpdateTaskStatus(taskId, status);
    };

    const confirmed = await postJson<{
      proposal: { status: string };
      createdTasks: Array<{ id: string }>;
      dependencyCascade: {
        updatedTasks: Array<{ id: string; status: string }>;
        events: Array<{ type: string; taskId?: string }>;
        errors?: Array<{ taskId: string; message: string }>;
      };
    }>(`${fixture.baseUrl}/api/replan-proposals/${proposed.proposal.id}/confirm`, {});

    expect(confirmed.proposal.status).toBe("confirmed");
    expect(confirmed.createdTasks).toHaveLength(3);
    expect(confirmed.dependencyCascade.updatedTasks).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: consumerTask.id }),
    ]));
    expect(confirmed.dependencyCascade.events).toEqual([]);
    expect(confirmed.dependencyCascade.errors).toEqual([
      { taskId: consumerTask.id, message: "consumer refresh failed" },
    ]);
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
      status: "waiting_dependency",
      dependencyNote: `Waiting for dependency acceptance: ${producerTask.title} (review).`,
    });
    expect(refreshed.task.failureReason).toBeUndefined();
    expect(refreshed.event).toMatchObject({
      type: "dependency_waiting",
      status: "waiting_dependency",
    });

    const state = await getJson<{ activity: Array<{ type: string; taskId?: string }> }>(
      `${fixture.baseUrl}/api/companies/${created.company.id}/state`,
    );
    expect(state.activity).toContainEqual(expect.objectContaining({ type: "dependency_waiting", taskId: consumerTask.id }));

    await fixture.close();
  });

  it("returns parent aggregation when a department subtask proof recovery reaches review", async () => {
    const schedulerWakeRequests: SchedulerWakeReason[] = [];
    const fixture = await startFixtureServer({ schedulerWakeRequests });
    await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const templateTask = fixture.repositories.fetchQueuedTasks(1)[0]!;
    const parentTask = {
      ...createIsolatedTask(templateTask, "parent_task", "Build the playable prototype", "waiting_dependency", 100),
      dependencyNote: "Waiting for department subtasks.",
      taskKind: "parent" as const,
    };
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-subtask-proof-"));
    createdDirs.push(workspacePath);
    writeFileSync(join(workspacePath, "prototype-audit-trail.patch"), "diff --git a/app/page.tsx b/app/page.tsx\n", "utf8");
    writeValidBusinessArtifactFile(workspacePath, "department_subtask_1");
    const subtask = {
      ...createIsolatedTask(templateTask, "department_subtask_1", "Execute prototype slice", "failed", 101),
      latestFailureReason: "no_proof" as const,
      latestFailureMessage: "Task failed: Execute prototype slice / no_proof.",
      parentTaskId: parentTask.id,
      taskKind: "department_subtask" as const,
      source: "department" as const,
      proofSchemaId: "repo-diff",
      workspacePath,
    };
    fixture.repositories.createTask(parentTask);
    fixture.repositories.createTask(subtask);
    fixture.repositories.createTaskDependency({ taskId: parentTask.id, dependsOnTaskId: subtask.id });

    const refreshed = await postJson<{
      task: { id: string; status: string };
      parentAggregation?: {
        updatedTasks: Array<{ id: string; status: string; dependencyNote?: string }>;
        events: Array<{ type: string; taskId?: string; status?: string }>;
        progressEvents: Array<{ parentTaskId: string; step: string; status: string; label: string }>;
      };
    }>(`${fixture.baseUrl}/api/tasks/${subtask.id}/refresh`, {});

    expect(refreshed.task).toMatchObject({
      id: subtask.id,
      status: "review",
    });
    expect(refreshed.parentAggregation?.updatedTasks).toEqual([
      expect.objectContaining({
        id: parentTask.id,
        status: "queued",
      }),
    ]);
    expect(refreshed.parentAggregation?.events).toEqual([
      expect.objectContaining({
        type: "dependency_ready",
        taskId: parentTask.id,
        status: "queued",
      }),
    ]);
    expect(refreshed.parentAggregation?.progressEvents).toEqual([
      expect.objectContaining({
        parentTaskId: parentTask.id,
        step: "summarizing_proof",
        status: "current",
        label: "Ready to summarize department subtask proof.",
      }),
    ]);
    expect(fixture.repositories.getTask(parentTask.id)?.status).toBe("queued");
    expect(schedulerWakeRequests).toEqual(["parent_aggregation_queued"]);

    await fixture.close();
  });

  it("reconciles stale running tasks when reading company state", async () => {
    const fixture = await startFixtureServer();
    const created = await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const task = fixture.repositories.fetchQueuedTasks(1)[0]!;
    fixture.repositories.updateTaskStatus(task.id, "running");
    fixture.repositories.acquireTaskLock(task.id, "worker_1", "2026-08-16T23:59:00.000Z");
    fixture.repositories.createAgentRun({
      id: "agent_run_1",
      taskId: task.id,
      agentId: "codex",
      status: "running",
      logPath: "agent.log",
      startedAt: "2026-08-16T23:59:00.000Z",
      finishedAt: null,
      executionProfileName: "short",
      requestedTimeoutMs: 1_000,
      effectiveTimeoutMs: 1_000,
      failureReason: null,
      failureMessage: null,
    });

    const state = await getJson<{
      tasks: Array<{ id: string; status: string; failureReason?: string }>;
      activity: Array<{ type: string; taskId?: string; failureReason?: string }>;
    }>(`${fixture.baseUrl}/api/companies/${created.company.id}/state`);

    expect(state.tasks).toContainEqual(expect.objectContaining({ id: task.id, status: "failed", failureReason: "timeout" }));
    expect(state.activity).toContainEqual(expect.objectContaining({ type: "task_failed", taskId: task.id, failureReason: "timeout" }));
    expect(fixture.repositories.listTaskLocks()).toEqual([]);

    await fixture.close();
  });

  it("recovers failed timeout tasks through the API", async () => {
    const fixture = await startFixtureServer();
    await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const task = fixture.repositories.fetchQueuedTasks(1)[0]!;
    fixture.repositories.updateTaskStatus(task.id, "failed");
    fixture.repositories.updateTaskExecutionSummary(task.id, {
      latestFailureReason: "timeout",
      latestFailureMessage: "Task failed: Create landing page / timeout after 3m.",
    });

    const recovered = await postJson<{
      task: { id: string; status: string; failureReason?: string };
      event: { type: string; status: string };
      recovery: { status: string; message: string };
    }>(`${fixture.baseUrl}/api/tasks/${task.id}/recover`, {});

    expect(recovered.task).toMatchObject({ id: task.id, status: "queued" });
    expect(recovered.task.failureReason).toBeUndefined();
    expect(recovered.event).toMatchObject({ type: "task_recovered", status: "queued" });
    expect(recovered.recovery).toEqual({
      status: "queued",
      message: "Task recovered and queued for another run.",
    });

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

  it("records CEO review decisions and applies approve or return effects", async () => {
    const fixture = await startFixtureServer();
    const created = await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const [approvedTask, returnedTask] = fixture.repositories.fetchQueuedTasks(2);
    expect(approvedTask).toBeDefined();
    expect(returnedTask).toBeDefined();
    fixture.repositories.updateTaskStatus(approvedTask!.id, "review");
    fixture.repositories.updateTaskStatus(returnedTask!.id, "review");
    fixture.repositories.appendProof({
      id: "proof_1",
      taskId: approvedTask!.id,
      type: "file",
      uri: "proof.md",
      summary: "Playable prototype exists.",
      verifiedAt: null,
    } satisfies Proof);
    fixture.repositories.createBusinessArtifact({
      ...createBusinessArtifactRecord("business_artifact_1", approvedTask!.id, "proof_1"),
      payload: {
        result: "Playable prototype exists.",
        next_steps: ["Freeform legacy next step should stay inside the payload."],
        nextStepItems: [
          {
            type: "human_action",
            label: "Deploy the prototype to a public URL.",
            ownerDepartmentId: approvedTask!.departmentId,
            relatedTaskId: approvedTask!.id,
            relatedBusinessArtifactId: "business_artifact_1",
            dependencyImpact: { blocks: ["launch"] },
            severity: "blocking",
            priority: 1,
            evidenceRequirements: ["url"],
          },
          {
            type: "human_action",
            label: "",
            ownerDepartmentId: approvedTask!.departmentId,
            relatedTaskId: approvedTask!.id,
            dependencyImpact: {},
            severity: "blocking",
            evidenceRequirements: ["url"],
          },
        ],
      },
    });

    const approved = await postJson<{
      decision: { id: string; taskId: string; decision: string; proofId?: string };
      task: { id: string; status: string };
      businessArtifacts: Array<{ id: string; taskId: string; reviewStatus: string }>;
    }>(`${fixture.baseUrl}/api/ceo-review-decisions`, {
      taskId: approvedTask!.id,
      decision: "approve",
      note: "Looks good.",
    });

    expect(approved.decision).toMatchObject({
      id: "ceo_review_decision_1",
      taskId: approvedTask!.id,
      decision: "approve",
      proofId: "proof_1",
    });
    expect(approved.task.status).toBe("complete");
    expect(approved.businessArtifacts).toContainEqual(
      expect.objectContaining({ id: "business_artifact_1", taskId: approvedTask!.id, reviewStatus: "accepted" }),
    );
    expect(fixture.repositories.getTask(approvedTask!.id)?.status).toBe("complete");

    const returned = await postJson<{
      decision: { id: string; taskId: string; decision: string; returnReason: string; note: string; noteText: { en: string; zh: string } };
      task: { id: string; status: string };
      event: { message: string; messageText: { en: string; zh: string } };
      progressEvent: { label: string; labelText: { en: string; zh: string }; detail: string; detailText: { en: string; zh: string } };
    }>(`${fixture.baseUrl}/api/ceo-review-decisions`, {
      taskId: returnedTask!.id,
      decision: "return",
      returnReason: "needs_changes",
      note: "Add proof and explain the next step.",
    });

    expect(returned.decision).toMatchObject({
      id: "ceo_review_decision_2",
      taskId: returnedTask!.id,
      decision: "return",
      returnReason: "needs_changes",
      note: "Add proof and explain the next step.",
    });
    expect(returned.task.status).toBe("queued");
    expect(returned.progressEvent.label).toBe("CEO Office returned this, waiting for the department to rework it.");
    expect(returned.progressEvent.labelText.zh).toBe("CEO 办公室已退回，等待部门返工。");
    expect(returned.progressEvent.detail).toContain("Add proof and explain the next step.");
    expect(returned.progressEvent.detailText.zh).toContain("原因：需要修改。");
    expect(returned.progressEvent.detailText.zh).toContain("Add proof and explain the next step.");
    expect(returned.event.messageText.zh).toContain("CEO 办公室退回任务");
    expect(returned.decision.noteText.zh).toBe("Add proof and explain the next step.");

    const stale = await fetch(`${fixture.baseUrl}/api/ceo-review-decisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: returnedTask!.id, decision: "approve" }),
    });
    expect(stale.status).toBe(409);

    const state = await getJson<{
      ceoReviewDecisions: Array<{ id: string; taskId: string; decision: string; returnReason?: string }>;
      keyResults: Array<{ currentValue: string; status: string }>;
      taskProgressEvents: Array<{ label: string; labelText: { en: string; zh: string }; detail?: string; detailText?: { en: string; zh: string } }>;
      businessArtifacts: Array<{ id: string; taskId: string; reviewStatus: string }>;
      founderReport: { actualOutputs: Array<{ taskId: string }>; nextSteps: string[] };
      taskCompletionEvents: Array<{
        taskId: string;
        departmentId: string;
        businessArtifactId: string | null;
        outcome: string;
        acceptanceProvenance: string | null;
        dependencyImpact: { nextStepValidationErrors?: string[] };
        nextStepItems: Array<{ type: string; label: string; ownerDepartmentId: string | null }>;
        createdAt: string;
      }>;
    }>(`${fixture.baseUrl}/api/companies/${created.company.id}/state`);
    expect(state.ceoReviewDecisions).toEqual([
      expect.objectContaining({ id: "ceo_review_decision_1", taskId: approvedTask!.id, decision: "approve" }),
      expect.objectContaining({ id: "ceo_review_decision_2", taskId: returnedTask!.id, decision: "return", returnReason: "needs_changes" }),
    ]);
    expect(state.keyResults).toContainEqual(expect.objectContaining({ currentValue: "accepted_business_artifact", status: "met" }));
    expect(state.businessArtifacts).toContainEqual(
      expect.objectContaining({ id: "business_artifact_1", taskId: approvedTask!.id, reviewStatus: "accepted" }),
    );
    expect(state.taskCompletionEvents).toEqual([
      expect.objectContaining({
        taskId: approvedTask!.id,
        departmentId: approvedTask!.departmentId,
        businessArtifactId: "business_artifact_1",
        outcome: "accepted",
        acceptanceProvenance: "manual_ceo_review",
        nextStepItems: [
          expect.objectContaining({
            type: "human_action",
            label: "Deploy the prototype to a public URL.",
            ownerDepartmentId: approvedTask!.departmentId,
          }),
        ],
        createdAt: "2026-08-17T00:00:00.000Z",
      }),
    ]);
    expect(state.taskCompletionEvents[0]?.dependencyImpact.nextStepValidationErrors).toEqual([
      "nextStepItems[1].label: Expected a non-empty string.",
    ]);
    expect(state.founderReport.actualOutputs).toContainEqual(expect.objectContaining({ taskId: approvedTask!.id }));
    expect(Array.isArray(state.founderReport.nextSteps)).toBe(true);
    expect(state.taskProgressEvents).toContainEqual(
      expect.objectContaining({
        label: "CEO Office returned this, waiting for the department to rework it.",
        labelText: { en: "CEO Office returned this, waiting for the department to rework it.", zh: "CEO 办公室已退回，等待部门返工。" },
      }),
    );

    await fixture.close();
  });

  it("reports malformed structured next-step containers without using freeform next-step prose", async () => {
    const fixture = await startFixtureServer();
    const created = await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const task = fixture.repositories.fetchQueuedTasks(1)[0];
    expect(task).toBeDefined();
    fixture.repositories.updateTaskStatus(task!.id, "review");
    fixture.repositories.appendProof({
      id: "proof_1",
      taskId: task!.id,
      type: "file",
      uri: "proof.md",
      summary: "Proof exists.",
      verifiedAt: null,
    } satisfies Proof);
    fixture.repositories.createBusinessArtifact({
      ...createBusinessArtifactRecord("business_artifact_1", task!.id, "proof_1"),
      payload: {
        next_steps: ["Deploy this manually."],
        nextStepItems: { type: "human_action", label: "Deploy this manually." },
      },
    });

    const approved = await postJson<{ task: { id: string; status: string } }>(
      `${fixture.baseUrl}/api/ceo-review-decisions`,
      {
        taskId: task!.id,
        decision: "approve",
      },
    );
    expect(approved.task.status).toBe("complete");

    const state = await getJson<{
      taskCompletionEvents: Array<{
        taskId: string;
        dependencyImpact: { nextStepValidationErrors?: string[] };
        nextStepItems: unknown[];
      }>;
    }>(`${fixture.baseUrl}/api/companies/${created.company.id}/state`);
    expect(state.taskCompletionEvents).toEqual([
      expect.objectContaining({
        taskId: task!.id,
        nextStepItems: [],
      }),
    ]);
    expect(state.taskCompletionEvents[0]?.dependencyImpact.nextStepValidationErrors).toEqual([
      "nextStepItems: Expected an array.",
    ]);

    await fixture.close();
  });

  it("projects vision gaps and CEO attention rollups from task completion events", async () => {
    const fixture = await startFixtureServer();
    const created = await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const templateTask = fixture.repositories.fetchQueuedTasks(1)[0]!;
    const departments = fixture.repositories.listDepartments(created.company.id);
    const ownerDepartment = departments[0]!;
    const downstreamDepartment = departments.find((department) => department.id !== ownerDepartment.id)!;
    const ordinaryTask = {
      ...createIsolatedTask(templateTask, "attention_ordinary", "Ordinary accepted work", "complete", 200),
      departmentId: ownerDepartment.id,
    };
    const sourceTask = {
      ...createIsolatedTask(templateTask, "attention_source", "Build launchable prototype", "complete", 201),
      departmentId: ownerDepartment.id,
    };
    const downstreamTask = {
      ...createIsolatedTask(templateTask, "attention_downstream", "Prepare launch indexing", "queued", 202),
      departmentId: downstreamDepartment.id,
    };
    fixture.repositories.createTask(ordinaryTask);
    fixture.repositories.createTask(sourceTask);
    fixture.repositories.createTask(downstreamTask);
    fixture.repositories.createTaskDependency({ taskId: downstreamTask.id, dependsOnTaskId: sourceTask.id });
    fixture.repositories.appendTaskCompletionEvent({
      id: "task_completion_event_ordinary",
      companyId: created.company.id,
      taskId: ordinaryTask.id,
      departmentId: ordinaryTask.departmentId,
      keyResultId: ordinaryTask.keyResultId,
      businessArtifactId: null,
      outcome: "accepted",
      outcomeSummaryText: { en: "Ordinary work is done and on-plan.", zh: "常规工作已完成，符合计划。" },
      dependencyImpact: {},
      nextStepItems: [],
      visionGaps: [],
      createdAt: "2026-08-17T00:00:00.000Z",
    });
    fixture.repositories.appendTaskCompletionEvent({
      id: "task_completion_event_info",
      companyId: created.company.id,
      taskId: ordinaryTask.id,
      departmentId: ordinaryTask.departmentId,
      keyResultId: ordinaryTask.keyResultId,
      businessArtifactId: null,
      outcome: "accepted",
      dependencyImpact: {},
      nextStepItems: [
        {
          type: "vision_gap",
          label: "More customer interviews would improve confidence.",
          ownerDepartmentId: ordinaryTask.departmentId,
          relatedTaskId: ordinaryTask.id,
          relatedBusinessArtifactId: null,
          dependencyImpact: {},
          severity: "informational",
          priority: null,
          evidenceRequirements: [],
        },
      ],
      visionGaps: [],
      createdAt: "2026-08-17T00:01:00.000Z",
    });
    fixture.repositories.appendTaskCompletionEvent({
      id: "task_completion_event_attention",
      companyId: created.company.id,
      taskId: sourceTask.id,
      departmentId: sourceTask.departmentId,
      keyResultId: sourceTask.keyResultId,
      businessArtifactId: null,
      outcome: "accepted",
      dependencyImpact: { updatedTasks: [{ taskId: downstreamTask.id, status: "queued" }] },
      nextStepItems: [
        {
          type: "vision_gap",
          label: "Deployment is still missing before launch.",
          ownerDepartmentId: sourceTask.departmentId,
          relatedTaskId: sourceTask.id,
          relatedBusinessArtifactId: null,
          dependencyImpact: { blocks: [downstreamTask.id] },
          severity: "blocking",
          priority: 1,
          evidenceRequirements: [],
        },
        {
          type: "vision_gap",
          label: "Launch positioning still needs an executive call.",
          ownerDepartmentId: sourceTask.departmentId,
          relatedTaskId: sourceTask.id,
          relatedBusinessArtifactId: null,
          dependencyImpact: {},
          severity: "strategic",
          priority: 2,
          evidenceRequirements: [],
        },
        {
          type: "ceo_decision",
          label: "Choose whether to launch publicly or keep this private.",
          ownerDepartmentId: sourceTask.departmentId,
          relatedTaskId: sourceTask.id,
          relatedBusinessArtifactId: null,
          dependencyImpact: { affects: [downstreamTask.id] },
          severity: "strategic",
          priority: 1,
          evidenceRequirements: [],
        },
      ],
      visionGaps: [],
      createdAt: "2026-08-17T00:02:00.000Z",
    });
    fixture.repositories.appendTaskCompletionEvent({
      id: "task_completion_event_wait",
      companyId: created.company.id,
      taskId: sourceTask.id,
      departmentId: sourceTask.departmentId,
      keyResultId: sourceTask.keyResultId,
      businessArtifactId: null,
      outcome: "accepted",
      dependencyImpact: {},
      nextStepItems: [
        {
          type: "wait_state",
          label: "Wait for indexing signals after deployment.",
          ownerDepartmentId: sourceTask.departmentId,
          relatedTaskId: downstreamTask.id,
          relatedBusinessArtifactId: null,
          dependencyImpact: { affects: [downstreamTask.id] },
          severity: "informational",
          priority: 3,
          evidenceRequirements: [],
        },
        {
          type: "human_action",
          label: "Publish the prototype URL.",
          ownerDepartmentId: sourceTask.departmentId,
          relatedTaskId: downstreamTask.id,
          relatedBusinessArtifactId: null,
          dependencyImpact: { blocks: [downstreamTask.id] },
          severity: "blocking",
          priority: 1,
          evidenceRequirements: ["url"],
        },
      ],
      visionGaps: [],
      createdAt: "2026-08-17T00:03:00.000Z",
    });

    const state = await getJson<{
      taskCompletionEvents: Array<{ id: string; outcomeSummaryText: { en?: string; zh?: string } | null }>;
      visionGaps: Array<{ label: string; severity: string; sourceTaskCompletionEventId: string }>;
      ceoAttentionRollups: Array<{
        sourceTaskCompletionEventIds: string[];
        ownerDepartmentId: string;
        downstreamDepartmentIds: string[];
        affectedTaskIds: string[];
        currentBlocker: string | null;
        recommendedNextAction: string;
        severity: string;
        reasons: string[];
        group: { type: string; taskId?: string };
        relevantHumanActions: Array<{ label: string }>;
        relevantWaitStates: Array<{ label: string }>;
        relevantVisionGaps: Array<{ label: string }>;
      }>;
    }>(`${fixture.baseUrl}/api/companies/${created.company.id}/state`);

    expect(state.taskCompletionEvents).toContainEqual(
      expect.objectContaining({
        id: "task_completion_event_ordinary",
        outcomeSummaryText: { en: "Ordinary work is done and on-plan.", zh: "常规工作已完成，符合计划。" },
      }),
    );
    expect(
      state.taskCompletionEvents.find((event) => event.id === "task_completion_event_wait")?.outcomeSummaryText,
    ).toBeNull();
    expect(state.visionGaps).toEqual([
      expect.objectContaining({ label: "More customer interviews would improve confidence.", severity: "informational" }),
      expect.objectContaining({ label: "Deployment is still missing before launch.", severity: "blocking" }),
      expect.objectContaining({ label: "Launch positioning still needs an executive call.", severity: "strategic" }),
    ]);
    expect(state.ceoAttentionRollups).toEqual([
      expect.objectContaining({
        sourceTaskCompletionEventIds: ["task_completion_event_attention", "task_completion_event_wait"],
        ownerDepartmentId: sourceTask.departmentId,
        downstreamDepartmentIds: [downstreamTask.departmentId],
        affectedTaskIds: expect.arrayContaining([sourceTask.id, downstreamTask.id]),
        currentBlocker: "Deployment is still missing before launch.",
        recommendedNextAction: "Publish the prototype URL.",
        severity: "strategic",
        group: { type: "dependency_chain", taskId: sourceTask.id },
        reasons: expect.arrayContaining(["vision_gap", "ceo_decision", "human_action", "wait_state", "cross_department_impact"]),
        relevantHumanActions: [expect.objectContaining({ label: "Publish the prototype URL." })],
        relevantWaitStates: [expect.objectContaining({ label: "Wait for indexing signals after deployment." })],
        relevantVisionGaps: [
          expect.objectContaining({ label: "Deployment is still missing before launch." }),
          expect.objectContaining({ label: "Launch positioning still needs an executive call." }),
        ],
      }),
    ]);

    await fixture.close();
  });

  it("serializes projected Founder Decisions with their options, recommendation, status, and blocked task ids", async () => {
    const fixture = await startFixtureServer();
    const created = await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const templateTask = fixture.repositories.fetchQueuedTasks(1)[0]!;
    const departments = fixture.repositories.listDepartments(created.company.id);
    const ownerDepartment = departments[0]!;
    const sourceTask = createIsolatedTask(templateTask, "founder_decision_source", "Draft the MVP brief", "review", 260);
    const downstreamTask = createIsolatedTask(templateTask, "founder_decision_downstream", "Build the pricing page", "blocked", 261);
    sourceTask.departmentId = ownerDepartment.id;
    fixture.repositories.createTask(sourceTask);
    fixture.repositories.createTask(downstreamTask);
    fixture.repositories.createTaskDependency({ taskId: downstreamTask.id, dependsOnTaskId: sourceTask.id });
    fixture.repositories.appendTaskCompletionEvent({
      id: "task_completion_event_founder_decision",
      companyId: created.company.id,
      taskId: sourceTask.id,
      departmentId: sourceTask.departmentId,
      keyResultId: sourceTask.keyResultId,
      businessArtifactId: null,
      outcome: "accepted",
      outcomeSummaryText: { en: "The brief leaves the pricing model open." },
      dependencyImpact: {},
      nextStepItems: [
        {
          type: "founder_decision",
          label: "Founder decision: pricing model",
          ownerDepartmentId: sourceTask.departmentId,
          relatedTaskId: sourceTask.id,
          relatedBusinessArtifactId: null,
          dependencyImpact: {
            founderDecision: {
              decisionKind: "pricing_model",
              options: [
                { label: "Flat monthly fee", tradeoffs: "Predictable revenue; underprices heavy users.", recommended: true },
                { label: "Usage-based", tradeoffs: "Scales with value; harder to forecast.", recommended: false },
              ],
              rationale: "Early buyers want a predictable bill.",
              blockedTaskIds: [downstreamTask.id],
            },
          },
          severity: "strategic",
          priority: null,
          evidenceRequirements: [],
        },
      ],
      visionGaps: [],
      createdAt: "2026-08-17T00:00:00.000Z",
    });

    const state = await getJson<{
      founderDecisions: Array<{
        id: string;
        taskId: string;
        departmentId: string;
        decisionKind: string;
        options: Array<{ label: string; tradeoffs: string; recommended: boolean }>;
        rationale: string;
        status: string;
        resolvedOption: string | null;
        resolvedAt: string | null;
        blockedTaskIds: string[];
      }>;
    }>(`${fixture.baseUrl}/api/companies/${created.company.id}/state`);

    expect(state.founderDecisions).toEqual([
      expect.objectContaining({
        taskId: sourceTask.id,
        departmentId: ownerDepartment.id,
        decisionKind: "pricing_model",
        options: [
          { label: "Flat monthly fee", tradeoffs: "Predictable revenue; underprices heavy users.", recommended: true },
          { label: "Usage-based", tradeoffs: "Scales with value; harder to forecast.", recommended: false },
        ],
        rationale: "Early buyers want a predictable bill.",
        status: "pending",
        resolvedOption: null,
        resolvedAt: null,
        blockedTaskIds: [downstreamTask.id],
      }),
    ]);

    await fixture.close();
  });

  it("routes Wait States into timed check-ins without treating them as failures", async () => {
    const schedulerWakeRequests: SchedulerWakeReason[] = [];
    let now = new Date("2026-08-17T00:00:00.000Z");
    const fixture = await startFixtureServer({
      schedulerWakeRequests,
      now: () => now,
    });
    const created = await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const templateTask = fixture.repositories.fetchQueuedTasks(1)[0]!;
    const sourceTask = createIsolatedTask(templateTask, "wait_state_source", "Publish private prototype", "complete", 250);
    const indexingTask = createIsolatedTask(templateTask, "wait_state_indexing", "Check indexing signals", "queued", 251);
    const prepTask = createIsolatedTask(templateTask, "wait_state_prep", "Prepare comparison copy", "queued", 252);
    fixture.repositories.createTask(sourceTask);
    fixture.repositories.createTask(indexingTask);
    fixture.repositories.createTask(prepTask);
    fixture.repositories.appendTaskCompletionEvent({
      id: "task_completion_event_wait_check",
      companyId: created.company.id,
      taskId: sourceTask.id,
      departmentId: sourceTask.departmentId,
      keyResultId: sourceTask.keyResultId,
      businessArtifactId: null,
      outcome: "accepted",
      dependencyImpact: {},
      nextStepItems: [
        {
          type: "wait_state",
          label: "Wait for search indexing signals.",
          ownerDepartmentId: sourceTask.departmentId,
          relatedTaskId: indexingTask.id,
          relatedBusinessArtifactId: null,
          dependencyImpact: { blocks: [indexingTask.id], nextCheckAt: "2026-08-17T01:00:00.000Z" },
          severity: "informational",
          priority: 3,
          evidenceRequirements: [],
        },
      ],
      visionGaps: [],
      createdAt: "2026-08-17T00:00:00.000Z",
    });

    const before = await getJson<{
      waitStates: Array<{ id: string; status: string; nextCheckAt: string; affectedTaskIds: string[]; departmentId: string }>;
      tasks: Array<{ id: string; status: string; failureReason?: string; dependencyNote?: string }>;
      founderReport: { waitStateCount: number; waitStates: Array<{ id: string }>; nextSteps: string[] };
      ceoAttentionRollups: Array<{ reasons: string[]; relevantWaitStates: Array<{ label: string; status: string }> }>;
    }>(`${fixture.baseUrl}/api/companies/${created.company.id}/state`);

    expect(before.waitStates).toEqual([
      expect.objectContaining({
        id: "task_completion_event_wait_check_wait_state_1",
        status: "waiting",
        nextCheckAt: "2026-08-17T01:00:00.000Z",
        affectedTaskIds: [indexingTask.id],
        departmentId: sourceTask.departmentId,
      }),
    ]);
    expect(before.tasks).toContainEqual(
      expect.objectContaining({
        id: indexingTask.id,
        status: "waiting_dependency",
        dependencyNote: "Waiting for Wait State check-in: task_completion_event_wait_check_wait_state_1 at 2026-08-17T01:00:00.000Z.",
      }),
    );
    expect(before.tasks).toContainEqual(expect.objectContaining({ id: prepTask.id, status: "queued" }));
    expect(before.founderReport.waitStateCount).toBe(1);
    expect(before.founderReport.waitStates).toEqual([expect.objectContaining({ id: "task_completion_event_wait_check_wait_state_1" })]);
    expect(before.founderReport.nextSteps).toContain("Monitor Wait for search indexing signals until 2026-08-17T01:00:00.000Z.");
    expect(before.ceoAttentionRollups).toEqual([
      expect.objectContaining({
        reasons: expect.arrayContaining(["wait_state"]),
        relevantWaitStates: [expect.objectContaining({ label: "Wait for search indexing signals.", status: "waiting" })],
      }),
    ]);
    expect(schedulerWakeRequests).toEqual([]);

    now = new Date("2026-08-17T01:01:00.000Z");
    const after = await getJson<{
      waitStates: Array<{ id: string; status: string }>;
      tasks: Array<{ id: string; status: string; dependencyNote?: string }>;
      activity: Array<{ type: string; taskId?: string; status?: string }>;
      founderReport: { nextSteps: string[] };
    }>(`${fixture.baseUrl}/api/companies/${created.company.id}/state`);

    expect(after.waitStates).toEqual([
      expect.objectContaining({ id: "task_completion_event_wait_check_wait_state_1", status: "ready_for_check_in" }),
    ]);
    expect(after.tasks).toContainEqual(expect.objectContaining({ id: indexingTask.id, status: "queued" }));
    expect(after.tasks).toContainEqual(expect.objectContaining({ id: prepTask.id, status: "queued" }));
    expect(after.activity).toContainEqual(expect.objectContaining({ type: "dependency_ready", taskId: indexingTask.id, status: "queued" }));
    expect(after.founderReport.nextSteps).toContain("Check Wait for search indexing signals.");
    expect(schedulerWakeRequests).toEqual(["dependency_cascade_queued"]);

    await fixture.close();
  });

  it("confirms Human Actions with evidence and unblocks only explicitly blocked downstream tasks", async () => {
    const schedulerWakeRequests: SchedulerWakeReason[] = [];
    const fixture = await startFixtureServer({ schedulerWakeRequests });
    const created = await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const templateTask = fixture.repositories.fetchQueuedTasks(1)[0]!;
    const sourceTask = createIsolatedTask(templateTask, "human_action_source", "Build private prototype", "complete", 300);
    const launchTask = createIsolatedTask(templateTask, "human_action_launch", "Launch public prototype", "queued", 301);
    const prepTask = createIsolatedTask(templateTask, "human_action_prep", "Prepare launch notes", "queued", 302);
    const unrelatedBlockedTask = createIsolatedTask(templateTask, "human_action_unrelated", "Recover unrelated analytics access", "blocked", 303);
    const humanActionId = "task_completion_event_human_action_human_action_1";
    fixture.repositories.createTask(sourceTask);
    fixture.repositories.createTask(launchTask);
    fixture.repositories.createTask(prepTask);
    fixture.repositories.createTask({
      ...unrelatedBlockedTask,
      latestFailureReason: "missing_deliverable",
      latestFailureMessage: "Waiting for account access.",
      dependencyNote: "Waiting for an unrelated account recovery.",
    });
    fixture.repositories.createTaskDependency({
      taskId: launchTask.id,
      dependsOnTaskId: sourceTask.id,
      handoffContract: `human_action:${humanActionId}`,
    });
    fixture.repositories.createTaskDependency({
      taskId: unrelatedBlockedTask.id,
      dependsOnTaskId: sourceTask.id,
      handoffContract: "manual account recovery outside this Human Action",
    });
    fixture.repositories.appendTaskCompletionEvent({
      id: "task_completion_event_human_action",
      companyId: created.company.id,
      taskId: sourceTask.id,
      departmentId: sourceTask.departmentId,
      keyResultId: sourceTask.keyResultId,
      businessArtifactId: null,
      outcome: "accepted",
      dependencyImpact: {},
      nextStepItems: [
        {
          type: "human_action",
          label: "Add the public deployment URL.",
          ownerDepartmentId: sourceTask.departmentId,
          relatedTaskId: launchTask.id,
          relatedBusinessArtifactId: null,
          dependencyImpact: { blocks: [launchTask.id, unrelatedBlockedTask.id] },
          severity: "blocking",
          priority: 1,
          evidenceRequirements: ["configuration_value"],
        },
      ],
      visionGaps: [],
      createdAt: "2026-08-17T00:00:00.000Z",
    });

    const before = await getJson<{
      humanActions: Array<{ id: string; status: string; departmentId: string; blockedTaskIds: string[]; confirmationRequirements: string[] }>;
      tasks: Array<{ id: string; status: string; dependencyNote?: string }>;
    }>(`${fixture.baseUrl}/api/companies/${created.company.id}/state`);
    expect(before.humanActions).toEqual([
      expect.objectContaining({
        id: humanActionId,
        status: "pending",
        departmentId: sourceTask.departmentId,
        blockedTaskIds: [launchTask.id, unrelatedBlockedTask.id],
        confirmationRequirements: ["configuration_value"],
      }),
    ]);
    expect(before.tasks).toContainEqual(
      expect.objectContaining({
        id: launchTask.id,
        status: "blocked",
        dependencyNote: `Waiting for Human Action confirmation: ${humanActionId}.`,
      }),
    );
    expect(before.tasks).toContainEqual(expect.objectContaining({ id: prepTask.id, status: "queued" }));
    expect(before.tasks).toContainEqual(expect.objectContaining({ id: unrelatedBlockedTask.id, status: "blocked" }));
    expect(schedulerWakeRequests).toEqual([]);

    const invalid = await fetch(
      `${fixture.baseUrl}/api/companies/${created.company.id}/human-actions/${humanActionId}/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidence: {} }),
      },
    );
    expect(invalid.status).toBe(400);

    const confirmed = await postJson<{
      humanAction: { status: string; evidence: Record<string, string>; verifiedAt: string | null };
      updatedTasks: Array<{ id: string; status: string }>;
      events: Array<{ type: string; taskId?: string }>;
    }>(
      `${fixture.baseUrl}/api/companies/${created.company.id}/human-actions/${humanActionId}/confirm`,
      { evidence: { configuration_value: "DEPLOYMENT_URL=https://example.test" } },
    );

    expect(confirmed.humanAction).toMatchObject({
      status: "confirmed",
      evidence: { configuration_value: "DEPLOYMENT_URL=https://example.test" },
      verifiedAt: "2026-08-17T00:00:00.000Z",
    });
    expect(confirmed.updatedTasks).toEqual([expect.objectContaining({ id: launchTask.id, status: "queued" })]);
    expect(confirmed.events).toContainEqual(expect.objectContaining({ type: "dependency_ready", taskId: launchTask.id }));
    expect(fixture.repositories.getTask(launchTask.id)?.status).toBe("queued");
    expect(fixture.repositories.getTask(prepTask.id)?.status).toBe("queued");
    expect(fixture.repositories.getTask(unrelatedBlockedTask.id)?.status).toBe("blocked");
    expect(schedulerWakeRequests).toEqual(["dependency_cascade_queued"]);

    const after = await getJson<{
      humanActions: Array<{ id: string; status: string; evidence: Record<string, string> }>;
      ceoAttentionRollups: Array<{ relevantHumanActions: Array<{ status: string }> }>;
    }>(`${fixture.baseUrl}/api/companies/${created.company.id}/state`);
    expect(after.humanActions).toEqual([
      expect.objectContaining({
        id: humanActionId,
        status: "confirmed",
        evidence: { configuration_value: "DEPLOYMENT_URL=https://example.test" },
      }),
    ]);
    expect(after.ceoAttentionRollups).toEqual([]);

    await fixture.close();
  });

  it("proves the operating model with playbook-neutral task completion events", async () => {
    const schedulerWakeRequests: SchedulerWakeReason[] = [];
    const fixture = await startFixtureServer({ schedulerWakeRequests });
    const created = await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Launch Readiness Studio",
      founderVision: "Publish an educational checklist and learn whether teams want it.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const templateTask = fixture.repositories.fetchQueuedTasks(1)[0]!;
    const departments = fixture.repositories.listDepartments(created.company.id);
    const ownerDepartment = departments[0]!;
    const downstreamDepartment = departments.find((department) => department.id !== ownerDepartment.id) ?? ownerDepartment;
    const internalProducer = {
      ...createIsolatedTask(templateTask, "operating_model_internal_source", "Prepare reusable checklist outline", "review", 350),
      departmentId: ownerDepartment.id,
      riskLevel: "low" as const,
    };
    const internalConsumer = {
      ...createIsolatedTask(templateTask, "operating_model_internal_consumer", "Use accepted outline for next draft", "blocked", 351),
      departmentId: downstreamDepartment.id,
      latestFailureReason: "missing_deliverable" as const,
      latestFailureMessage: "Waiting for accepted outline.",
      dependencyNote: "Waiting for accepted outline.",
      riskLevel: "low" as const,
    };
    const webProducer = {
      ...createIsolatedTask(templateTask, "operating_model_web_package", "Build public checklist package", "complete", 352),
      departmentId: ownerDepartment.id,
      riskLevel: "medium" as const,
    };
    const indexingTask = {
      ...createIsolatedTask(templateTask, "operating_model_indexing", "Prepare public indexing handoff", "queued", 353),
      departmentId: downstreamDepartment.id,
      riskLevel: "low" as const,
    };
    const contentPrepTask = {
      ...createIsolatedTask(templateTask, "operating_model_content_prep", "Prepare launch comparison copy", "queued", 354),
      departmentId: downstreamDepartment.id,
      riskLevel: "low" as const,
    };
    const observationTask = {
      ...createIsolatedTask(templateTask, "operating_model_observation", "Observe public listing signals", "queued", 355),
      departmentId: downstreamDepartment.id,
      riskLevel: "low" as const,
    };
    fixture.repositories.createTask(internalProducer);
    fixture.repositories.createTask(internalConsumer);
    fixture.repositories.createTask(webProducer);
    fixture.repositories.createTask(indexingTask);
    fixture.repositories.createTask(contentPrepTask);
    fixture.repositories.createTask(observationTask);
    fixture.repositories.createTaskDependency({ taskId: internalConsumer.id, dependsOnTaskId: internalProducer.id });
    const webCompletionEventId = "task_completion_event_operating_model_web_package";
    const deploymentHumanActionId = `${webCompletionEventId}_human_action_1`;
    fixture.repositories.createTaskDependency({
      taskId: indexingTask.id,
      dependsOnTaskId: webProducer.id,
      handoffContract: `human_action:${deploymentHumanActionId}`,
    });
    fixture.repositories.createTaskDependency({
      taskId: contentPrepTask.id,
      dependsOnTaskId: webProducer.id,
      handoffContract: "accepted package can be used for preparation",
    });
    fixture.repositories.createTaskDependency({
      taskId: observationTask.id,
      dependsOnTaskId: webProducer.id,
      handoffContract: "wait_state:public_listing_observation",
    });
    fixture.repositories.appendProof({
      id: "proof_operating_model_internal",
      taskId: internalProducer.id,
      type: "file",
      uri: "outline.md",
      summary: "Reusable outline exists.",
      verifiedAt: null,
    } satisfies Proof);
    const internalArtifact = {
      ...createBusinessArtifactRecord("business_artifact_operating_model_internal", internalProducer.id, "proof_operating_model_internal"),
      payload: {
        acceptance: { mode: "automatic", scope: "internal" },
        result: "Reusable checklist outline is ready for downstream drafting.",
      },
      lineage: {
        founder_vision: "Publish an educational checklist and learn whether teams want it.",
        objective: "Prove a useful launch path",
      },
    } satisfies BusinessArtifact;
    fixture.repositories.createBusinessArtifact(internalArtifact);

    acceptTaskBusinessArtifact({
      repositories: fixture.repositories,
      task: internalProducer,
      artifact: internalArtifact,
      acceptanceProvenance: "automatic_acceptance",
      eventType: "automatic_acceptance",
      eventMessage: "Automatically accepted low-risk internal outline.",
      dependencyCascade: { maxDepth: 2 },
      requestSchedulerWake: () => schedulerWakeRequests.push("dependency_cascade_queued"),
      now: () => new Date("2026-08-17T00:00:00.000Z"),
      createId: createOperatingModelIdFactory(),
    });
    fixture.repositories.appendProof({
      id: "proof_operating_model_web",
      taskId: webProducer.id,
      type: "file",
      uri: "dist/index.html",
      summary: "Public checklist package exists.",
      verifiedAt: null,
    } satisfies Proof);
    fixture.repositories.createBusinessArtifact({
      ...createBusinessArtifactRecord("business_artifact_operating_model_web", webProducer.id, "proof_operating_model_web"),
      artifactRole: "implementation",
      artifactSubtype: "web_package",
      payload: { result: "Public checklist package is built, but not yet deployed." },
      lineage: {
        founder_vision: "Publish an educational checklist and learn whether teams want it.",
        objective: "Prove a useful launch path",
      },
      reviewStatus: "accepted",
    });
    fixture.repositories.appendTaskCompletionEvent({
      id: webCompletionEventId,
      companyId: created.company.id,
      taskId: webProducer.id,
      departmentId: webProducer.departmentId,
      keyResultId: webProducer.keyResultId,
      businessArtifactId: "business_artifact_operating_model_web",
      outcome: "accepted",
      acceptanceProvenance: "manual_ceo_review",
      dependencyImpact: { producedArtifact: "business_artifact_operating_model_web" },
      nextStepItems: [
        {
          type: "human_action",
          label: "Deploy the built site package to a reachable URL.",
          ownerDepartmentId: webProducer.departmentId,
          relatedTaskId: indexingTask.id,
          relatedBusinessArtifactId: "business_artifact_operating_model_web",
          dependencyImpact: { blocks: [indexingTask.id] },
          severity: "blocking",
          priority: 1,
          evidenceRequirements: ["url"],
        },
        {
          type: "wait_state",
          label: "Observe public listing signals.",
          ownerDepartmentId: downstreamDepartment.id,
          relatedTaskId: observationTask.id,
          relatedBusinessArtifactId: "business_artifact_operating_model_web",
          dependencyImpact: { blocks: [observationTask.id], nextCheckAt: "2026-08-18T00:00:00.000Z" },
          severity: "informational",
          priority: 2,
          evidenceRequirements: [],
        },
        {
          type: "vision_gap",
          label: "Validated offer and conversion signal are still unknown.",
          ownerDepartmentId: downstreamDepartment.id,
          relatedTaskId: contentPrepTask.id,
          relatedBusinessArtifactId: "business_artifact_operating_model_web",
          dependencyImpact: {},
          severity: "strategic",
          priority: 3,
          evidenceRequirements: [],
        },
      ],
      visionGaps: [],
      createdAt: "2026-08-17T00:00:00.000Z",
    });

    const state = await getJson<{
      tasks: Array<{ id: string; status: string; dependencyNote?: string | null }>;
      taskCompletionEvents: Array<{ taskId: string; acceptanceProvenance: string | null; nextStepItems: Array<{ type: string; label: string }> }>;
      humanActions: Array<{ id: string; label: string; status: string; blockedTaskIds: string[] }>;
      waitStates: Array<{ label: string; affectedTaskIds: string[]; status: string }>;
      visionGaps: Array<{ label: string; severity: string; departmentId: string }>;
      ceoAttentionRollups: Array<{
        title: string;
        reasons: string[];
        recommendedNextAction: string;
        relevantHumanActions: Array<{ id: string }>;
        relevantWaitStates: Array<{ label: string }>;
        relevantVisionGaps: Array<{ label: string }>;
      }>;
      founderReport: {
        actualOutputs: Array<{ taskId: string; payload: unknown }>;
        departmentContributions: Array<{ departmentId: string; completedTaskCount: number; acceptedOutputCount: number; humanActionCount: number; waitStateCount: number; visionGapCount: number }>;
        dependencyState: Array<{ taskId: string; status: string; dependsOnTaskIds: string[]; hasAcceptedOutput: boolean; dependencyNote?: string | null }>;
        humanActionCount: number;
        humanActions: Array<{ id: string; label: string; blockedTaskIds: string[] }>;
        waitStateCount: number;
        waitStates: Array<{ label: string; affectedTaskIds: string[] }>;
        visionGapCount: number;
        visionGaps: Array<{ label: string; severity: string }>;
        directionDriftDetected: boolean;
        nextSteps: string[];
      };
    }>(`${fixture.baseUrl}/api/companies/${created.company.id}/state`);

    expect(state.taskCompletionEvents).toContainEqual(
      expect.objectContaining({
        taskId: internalProducer.id,
        acceptanceProvenance: "automatic_acceptance",
        nextStepItems: [],
      }),
    );
    expect(state.tasks).toContainEqual(expect.objectContaining({ id: internalProducer.id, status: "complete" }));
    expect(state.tasks).toContainEqual(expect.objectContaining({ id: internalConsumer.id, status: "queued" }));
    expect(schedulerWakeRequests).toEqual(["dependency_cascade_queued"]);
    expect(state.humanActions).toEqual([
      expect.objectContaining({
        id: deploymentHumanActionId,
        label: "Deploy the built site package to a reachable URL.",
        status: "pending",
        blockedTaskIds: [indexingTask.id],
      }),
    ]);
    expect(state.tasks).toContainEqual(
      expect.objectContaining({
        id: indexingTask.id,
        status: "blocked",
        dependencyNote: `Waiting for Human Action confirmation: ${deploymentHumanActionId}.`,
      }),
    );
    expect(state.tasks).toContainEqual(expect.objectContaining({ id: contentPrepTask.id, status: "queued" }));
    expect(state.waitStates).toEqual([
      expect.objectContaining({
        label: "Observe public listing signals.",
        affectedTaskIds: [observationTask.id],
        status: "waiting",
      }),
    ]);
    expect(state.tasks).toContainEqual(expect.objectContaining({ id: observationTask.id, status: "waiting_dependency" }));
    expect(state.visionGaps).toEqual([
      expect.objectContaining({
        label: "Validated offer and conversion signal are still unknown.",
        severity: "strategic",
        departmentId: downstreamDepartment.id,
      }),
    ]);
    expect(state.ceoAttentionRollups).toContainEqual(
      expect.objectContaining({
        reasons: expect.arrayContaining(["human_action", "wait_state", "vision_gap", "cross_department_impact"]),
        relevantHumanActions: [expect.objectContaining({ id: deploymentHumanActionId })],
        relevantWaitStates: [expect.objectContaining({ label: "Observe public listing signals." })],
        relevantVisionGaps: [expect.objectContaining({ label: "Validated offer and conversion signal are still unknown." })],
      }),
    );
    expect(state.founderReport.actualOutputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: internalProducer.id }),
        expect.objectContaining({ taskId: webProducer.id }),
      ]),
    );
    expect(state.founderReport.departmentContributions).toContainEqual(
      expect.objectContaining({
        departmentId: ownerDepartment.id,
        completedTaskCount: 2,
        acceptedOutputCount: 2,
        humanActionCount: 1,
      }),
    );
    expect(state.founderReport.departmentContributions).toContainEqual(
      expect.objectContaining({
        departmentId: downstreamDepartment.id,
        waitStateCount: 1,
        visionGapCount: 1,
      }),
    );
    expect(state.founderReport.dependencyState).toContainEqual(
      expect.objectContaining({
        taskId: indexingTask.id,
        status: "blocked",
        dependsOnTaskIds: [webProducer.id],
        hasAcceptedOutput: false,
      }),
    );
    expect(state.founderReport.humanActionCount).toBe(1);
    expect(state.founderReport.humanActions).toEqual([
      expect.objectContaining({ id: deploymentHumanActionId, blockedTaskIds: [indexingTask.id] }),
    ]);
    expect(state.founderReport.waitStateCount).toBe(1);
    expect(state.founderReport.waitStates).toEqual([
      expect.objectContaining({ label: "Observe public listing signals.", affectedTaskIds: [observationTask.id] }),
    ]);
    expect(state.founderReport.visionGapCount).toBe(1);
    expect(state.founderReport.visionGaps).toEqual([
      expect.objectContaining({ label: "Validated offer and conversion signal are still unknown.", severity: "strategic" }),
    ]);
    expect(state.founderReport.directionDriftDetected).toBe(false);
    expect(state.founderReport.nextSteps).toEqual(
      expect.arrayContaining([
        "Complete Human Action: Deploy the built site package to a reachable URL.",
        "Resolve Vision Gap: Validated offer and conversion signal are still unknown.",
        `Waiting for Human Action confirmation: ${deploymentHumanActionId}.`,
        "Monitor Observe public listing signals until 2026-08-18T00:00:00.000Z.",
      ]),
    );

    await fixture.close();
  });

  it("cascades dependency readiness after CEO approves an upstream task with proof", async () => {
    const schedulerWakeRequests: SchedulerWakeReason[] = [];
    const fixture = await startFixtureServer({ schedulerWakeRequests });
    const created = await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const [producerTask, consumerTask] = fixture.repositories.fetchQueuedTasks(2);
    expect(producerTask).toBeDefined();
    expect(consumerTask).toBeDefined();
    fixture.repositories.createTaskDependency({ taskId: consumerTask!.id, dependsOnTaskId: producerTask!.id });
    fixture.repositories.updateTaskStatus(producerTask!.id, "review");
    fixture.repositories.appendProof({
      id: "proof_1",
      taskId: producerTask!.id,
      type: "file",
      uri: "proof.md",
      summary: "Prototype validation proof exists.",
      verifiedAt: null,
    } satisfies Proof);
    fixture.repositories.createBusinessArtifact(createBusinessArtifactRecord("business_artifact_1", producerTask!.id, "proof_1"));
    fixture.repositories.updateTaskStatus(consumerTask!.id, "blocked");
    fixture.repositories.updateTaskExecutionSummary(consumerTask!.id, {
      latestFailureReason: "missing_deliverable",
      latestFailureMessage: "Task blocked by missing upstream proof.",
      dependencyNote: `Missing consumable proof from dependency: ${producerTask!.title}.`,
    });

    const approved = await postJson<{
      task: { id: string; status: string };
      dependencyCascade: {
        updatedTasks: Array<{ id: string; status: string; failureReason?: string; dependencyNote?: string }>;
        events: Array<{ type: string; taskId?: string; status?: string }>;
      };
    }>(`${fixture.baseUrl}/api/ceo-review-decisions`, {
      taskId: producerTask!.id,
      decision: "approve",
    });

    expect(approved.task).toMatchObject({ id: producerTask!.id, status: "complete" });
    expect(approved.dependencyCascade.updatedTasks).toEqual([
      expect.objectContaining({
        id: consumerTask!.id,
        status: "queued",
      }),
    ]);
    expect(approved.dependencyCascade.updatedTasks[0]?.failureReason).toBeUndefined();
    expect(approved.dependencyCascade.updatedTasks[0]?.dependencyNote).toBeUndefined();
    expect(approved.dependencyCascade.events).toContainEqual(
      expect.objectContaining({
        type: "dependency_ready",
        taskId: consumerTask!.id,
        status: "queued",
      }),
    );
    expect(fixture.repositories.getTask(consumerTask!.id)?.status).toBe("queued");
    expect(schedulerWakeRequests).toEqual(["dependency_cascade_queued"]);

    const state = await getJson<{
      tasks: Array<{ id: string; status: string }>;
      activity: Array<{ type: string; taskId?: string }>;
      taskCompletionEvents: Array<{ taskId: string; outcome: string; dependencyImpact: unknown }>;
    }>(
      `${fixture.baseUrl}/api/companies/${created.company.id}/state`,
    );
    expect(state.tasks).toContainEqual(expect.objectContaining({ id: consumerTask!.id, status: "queued" }));
    expect(state.activity).toContainEqual(expect.objectContaining({ type: "dependency_ready", taskId: consumerTask!.id }));
    expect(state.taskCompletionEvents).toContainEqual(
      expect.objectContaining({
        taskId: producerTask!.id,
        outcome: "accepted",
        dependencyImpact: {
          updatedTasks: [{ taskId: consumerTask!.id, status: "queued" }],
          errors: [],
        },
      }),
    );

    await fixture.close();
  });

  it("cascades dependency readiness to a second-level consumer after CEO approval", async () => {
    const fixture = await startFixtureServer();
    await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const templateTask = fixture.repositories.fetchQueuedTasks(1)[0]!;
    const sourceTask = createIsolatedTask(templateTask, "cascade_source", "Source cascade task", "review", 100);
    const firstConsumer = createIsolatedTask(templateTask, "cascade_first", "First cascade consumer", "blocked", 101);
    const secondConsumer = createIsolatedTask(templateTask, "cascade_second", "Second cascade consumer", "blocked", 102);
    fixture.repositories.createTask(sourceTask);
    fixture.repositories.createTask(firstConsumer);
    fixture.repositories.createTask(secondConsumer);
    fixture.repositories.createTaskDependency({ taskId: firstConsumer.id, dependsOnTaskId: sourceTask.id });
    fixture.repositories.createTaskDependency({ taskId: secondConsumer.id, dependsOnTaskId: firstConsumer.id });
    fixture.repositories.appendProof({
      id: "proof_1",
      taskId: sourceTask.id,
      type: "file",
      uri: "proof.md",
      summary: "Source proof exists.",
      verifiedAt: null,
    } satisfies Proof);
    fixture.repositories.createBusinessArtifact(createBusinessArtifactRecord("business_artifact_1", sourceTask.id, "proof_1"));
    fixture.repositories.updateTaskExecutionSummary(firstConsumer.id, {
      latestFailureReason: "missing_deliverable",
      latestFailureMessage: "Task blocked by missing upstream proof.",
      dependencyNote: `Missing consumable proof from dependency: ${sourceTask.title}.`,
    });
    fixture.repositories.updateTaskExecutionSummary(secondConsumer.id, {
      latestFailureReason: "dependency_failed",
      latestFailureMessage: "Task blocked by stale upstream dependency state.",
      dependencyNote: `Blocked by failed dependency: ${firstConsumer.title}.`,
    });

    const approved = await postJson<{
      dependencyCascade: {
        updatedTasks: Array<{ id: string; status: string; dependencyNote?: string }>;
        events: Array<{ type: string; taskId?: string; status?: string }>;
        progressEvents: Array<{ subjectTaskId: string | null; label: string }>;
      };
    }>(`${fixture.baseUrl}/api/ceo-review-decisions`, {
      taskId: sourceTask.id,
      decision: "approve",
    });

    expect(approved.dependencyCascade.updatedTasks).toEqual([
      expect.objectContaining({
        id: firstConsumer.id,
        status: "queued",
      }),
      expect.objectContaining({
        id: secondConsumer.id,
        status: "waiting_dependency",
        dependencyNote: `Waiting for dependency deliverable: ${firstConsumer.title} (queued).`,
      }),
    ]);
    expect(approved.dependencyCascade.events).toEqual([
      expect.objectContaining({ type: "dependency_ready", taskId: firstConsumer.id, status: "queued" }),
      expect.objectContaining({ type: "dependency_waiting", taskId: secondConsumer.id, status: "waiting_dependency" }),
    ]);
    expect(approved.dependencyCascade.progressEvents).toEqual([
      expect.objectContaining({
        subjectTaskId: firstConsumer.id,
        label: "Dependency ready after upstream approval; queued for scheduler.",
      }),
    ]);

    await fixture.close();
  });

  it("keeps a direct consumer blocked when another dependency is still missing proof", async () => {
    const schedulerWakeRequests: SchedulerWakeReason[] = [];
    const fixture = await startFixtureServer({ schedulerWakeRequests });
    await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const [approvedDependency, missingDependency, consumerTask] = fixture.repositories.fetchQueuedTasks(3);
    expect(approvedDependency).toBeDefined();
    expect(missingDependency).toBeDefined();
    expect(consumerTask).toBeDefined();
    fixture.repositories.createTaskDependency({ taskId: consumerTask!.id, dependsOnTaskId: approvedDependency!.id });
    fixture.repositories.createTaskDependency({ taskId: consumerTask!.id, dependsOnTaskId: missingDependency!.id });
    fixture.repositories.updateTaskStatus(approvedDependency!.id, "review");
    fixture.repositories.updateTaskStatus(missingDependency!.id, "complete");
    fixture.repositories.appendProof({
      id: "proof_1",
      taskId: approvedDependency!.id,
      type: "file",
      uri: "proof.md",
      summary: "Approved dependency proof exists.",
      verifiedAt: null,
    } satisfies Proof);
    fixture.repositories.createBusinessArtifact(createBusinessArtifactRecord("business_artifact_1", approvedDependency!.id, "proof_1"));
    fixture.repositories.updateTaskStatus(consumerTask!.id, "blocked");
    fixture.repositories.updateTaskExecutionSummary(consumerTask!.id, {
      latestFailureReason: "missing_deliverable",
      latestFailureMessage: "Task blocked by missing upstream proof.",
      dependencyNote: `Missing consumable proof from dependency: ${approvedDependency!.title}.`,
    });

    const approved = await postJson<{
      dependencyCascade: {
        updatedTasks: Array<{ id: string; status: string; failureReason?: string; dependencyNote?: string }>;
        events: Array<{ type: string; taskId?: string; status?: string }>;
      };
    }>(`${fixture.baseUrl}/api/ceo-review-decisions`, {
      taskId: approvedDependency!.id,
      decision: "approve",
    });

    expect(approved.dependencyCascade.updatedTasks).toEqual([
      expect.objectContaining({
        id: consumerTask!.id,
        status: "blocked",
        failureReason: "missing_deliverable",
        dependencyNote: `Missing accepted business artifact from dependency: ${missingDependency!.title}.`,
      }),
    ]);
    expect(approved.dependencyCascade.events).toContainEqual(
      expect.objectContaining({
        type: "deliverable_missing",
        taskId: consumerTask!.id,
        status: "blocked",
      }),
    );
    expect(fixture.repositories.getTask(consumerTask!.id)?.status).toBe("blocked");
    expect(schedulerWakeRequests).toEqual([]);

    await fixture.close();
  });

  it("does not cascade non-dependency failed consumers", async () => {
    const fixture = await startFixtureServer();
    await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const [producerTask, consumerTask] = fixture.repositories.fetchQueuedTasks(2);
    expect(producerTask).toBeDefined();
    expect(consumerTask).toBeDefined();
    fixture.repositories.createTaskDependency({ taskId: consumerTask!.id, dependsOnTaskId: producerTask!.id });
    fixture.repositories.updateTaskStatus(producerTask!.id, "review");
    fixture.repositories.appendProof({
      id: "proof_1",
      taskId: producerTask!.id,
      type: "file",
      uri: "proof.md",
      summary: "Producer proof exists.",
      verifiedAt: null,
    } satisfies Proof);
    fixture.repositories.createBusinessArtifact(createBusinessArtifactRecord("business_artifact_1", producerTask!.id, "proof_1"));
    fixture.repositories.updateTaskStatus(consumerTask!.id, "failed");
    fixture.repositories.updateTaskExecutionSummary(consumerTask!.id, {
      latestFailureReason: "no_proof",
      latestFailureMessage: "Task failed: downstream work / no_proof.",
      dependencyNote: null,
    });

    const approved = await postJson<{
      dependencyCascade: {
        updatedTasks: Array<{ id: string; status: string }>;
        events: Array<{ type: string; taskId?: string }>;
      };
    }>(`${fixture.baseUrl}/api/ceo-review-decisions`, {
      taskId: producerTask!.id,
      decision: "approve",
    });

    expect(approved.dependencyCascade.updatedTasks).toEqual([]);
    expect(approved.dependencyCascade.events).toEqual([]);
    expect(fixture.repositories.getTask(consumerTask!.id)?.status).toBe("failed");

    await fixture.close();
  });

  it("does not duplicate cascade events when a consumer state does not change", async () => {
    const fixture = await startFixtureServer();
    await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const [producerTask, consumerTask] = fixture.repositories.fetchQueuedTasks(2);
    expect(producerTask).toBeDefined();
    expect(consumerTask).toBeDefined();
    fixture.repositories.createTaskDependency({ taskId: consumerTask!.id, dependsOnTaskId: producerTask!.id });
    fixture.repositories.updateTaskStatus(producerTask!.id, "review");
    fixture.repositories.appendProof({
      id: "proof_1",
      taskId: producerTask!.id,
      type: "file",
      uri: "proof.md",
      summary: "Producer proof exists.",
      verifiedAt: null,
    } satisfies Proof);
    fixture.repositories.createBusinessArtifact(createBusinessArtifactRecord("business_artifact_1", producerTask!.id, "proof_1"));
    fixture.repositories.updateTaskStatus(consumerTask!.id, "waiting_dependency");
    fixture.repositories.updateTaskExecutionSummary(consumerTask!.id, {
      latestFailureReason: null,
      latestFailureMessage: null,
      dependencyNote: `Waiting for dependency deliverable: ${producerTask!.title} (review).`,
    });

    const first = await postJson<{
      dependencyCascade: {
        updatedTasks: Array<{ id: string; status: string }>;
        events: Array<{ type: string; taskId?: string }>;
      };
    }>(`${fixture.baseUrl}/api/ceo-review-decisions`, {
      taskId: producerTask!.id,
      decision: "approve",
    });
    const second = await fetch(`${fixture.baseUrl}/api/ceo-review-decisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: producerTask!.id, decision: "approve" }),
    });

    expect(first.dependencyCascade.updatedTasks).toHaveLength(1);
    expect(first.dependencyCascade.events).toHaveLength(1);
    expect(second.status).toBe(409);
    expect(fixture.repositories.listTaskEventsForCompany(producerTask!.companyId).filter((event) => event.type === "dependency_ready")).toHaveLength(1);

    await fixture.close();
  });

  it("rejects CEO approval when a review task has no proof", async () => {
    const fixture = await startFixtureServer();
    await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const task = fixture.repositories.fetchQueuedTasks(1)[0]!;
    fixture.repositories.updateTaskStatus(task.id, "review");

    const response = await fetch(`${fixture.baseUrl}/api/ceo-review-decisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: task.id, decision: "approve" }),
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/no checkable proof/i);
    expect(fixture.repositories.getTask(task.id)?.status).toBe("review");

    await fixture.close();
  });

  it("rejects CEO approval when a review task has proof but no valid business artifact", async () => {
    const fixture = await startFixtureServer();
    await postJson<{ company: { id: string } }>(`${fixture.baseUrl}/api/companies`, {
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
    });
    const task = fixture.repositories.fetchQueuedTasks(1)[0]!;
    fixture.repositories.updateTaskStatus(task.id, "review");
    fixture.repositories.appendProof({
      id: "proof_1",
      taskId: task.id,
      type: "file",
      uri: "proof.md",
      summary: "Proof exists.",
      verifiedAt: null,
    } satisfies Proof);

    const response = await fetch(`${fixture.baseUrl}/api/ceo-review-decisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: task.id, decision: "approve" }),
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/business artifact/i);
    expect(fixture.repositories.getTask(task.id)?.status).toBe("review");

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

async function startFixtureServer(options: {
  now?: () => Date;
  ceoAgent?: AgentAdapter;
  plannerOutput?: string;
  schedulerWakeRequests?: SchedulerWakeReason[];
  useDefaultCreateId?: boolean;
} = {}) {
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
  const codex = options.ceoAgent ?? (options.plannerOutput
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
      }));
  const serverOptions = {
    projectRoot,
    repositories,
    agents: [codex],
    now: options.now ?? (() => new Date("2026-08-17T00:00:00.000Z")),
    requestSchedulerWake: (reason: SchedulerWakeReason) => options.schedulerWakeRequests?.push(reason),
  };
  const server = createApiServer(options.useDefaultCreateId
    ? serverOptions
    : { ...serverOptions, createId: createSequentialIdFactory() });

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

function createDelayedBlueprintAgent(release: Promise<void>): AgentAdapter {
  const blueprint = aiSaasPlaybook.createBlueprint({
    companyName: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    preferredEngineeringAgentId: "codex",
    preferredStrategyAgentId: "codex",
  });

  return {
    id: "codex",
    name: "Codex",
    capabilities: ["code", "frontend", "test"],
    async detect() {
      return true;
    },
    async run() {
      await release;
      return {
        status: "complete",
        exitCode: 0,
        stdout: ["## Human CEO Brief", "Validate.", "```json", JSON.stringify({ brief: "Validate.", blueprint }), "```"].join("\n"),
        stderr: "",
      };
    },
  };
}

function createFlakyCreationAgent(): AgentAdapter {
  const blueprint = aiSaasPlaybook.createBlueprint({
    companyName: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    preferredEngineeringAgentId: "codex",
    preferredStrategyAgentId: "codex",
  });
  let attempts = 0;

  return {
    id: "codex",
    name: "Codex",
    capabilities: ["code", "frontend", "test"],
    async detect() {
      return true;
    },
    async run() {
      attempts += 1;
      if (attempts === 1) {
        return {
          status: "failed",
          exitCode: 1,
          stdout: "",
          stderr: "temporary model failure",
        };
      }

      return {
        status: "complete",
        exitCode: 0,
        stdout: ["## Human CEO Brief", "Validate.", "```json", JSON.stringify({ brief: "Validate.", blueprint }), "```"].join("\n"),
        stderr: "",
      };
    },
  };
}

async function postCreatingCompany(
  fixture: Awaited<ReturnType<typeof startFixtureServer>>,
  creationIdempotencyKey: string,
): Promise<{ company: { id: string; status: string } }> {
  const response = await fetch(`${fixture.baseUrl}/api/companies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      companyName: "Pricing Page Studio",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
      permissionMode: "balanced",
      assets: [],
      creationIdempotencyKey,
    }),
  });
  expect(response.status).toBe(202);
  return (await response.json()) as { company: { id: string; status: string } };
}

async function waitForCompanyStatus(
  fixture: Awaited<ReturnType<typeof startFixtureServer>>,
  companyId: string,
  status: string,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (fixture.repositories.getCompany(companyId)?.status === status) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Company ${companyId} did not reach ${status}.`);
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

function createIsolatedTask(
  template: Task,
  id: string,
  title: string,
  status: Task["status"],
  position: number,
): Task {
  return {
    ...template,
    id,
    title,
    description: `${title}.`,
    status,
    position,
    latestFailureReason: null,
    latestFailureMessage: null,
    latestExecutionProfileName: null,
    latestRequestedTimeoutMs: null,
    latestEffectiveTimeoutMs: null,
    dependencyNote: null,
    artifactWorkspacePath: null,
  };
}

function createBusinessArtifactRecord(id: string, taskId: string, sourceProofId: string): BusinessArtifact {
  return {
    id,
    companyId: "company_1",
    taskId,
    sourceProofId,
    artifactKind: "deliverable",
    artifactRole: "implementation",
    artifactSubtype: "prototype_implementation",
    artifactType: "implementation_summary",
    taskType: "test_task",
    payload: { result: `Accepted artifact for ${taskId}.` },
    lineage: {
      founder_vision: "Build an AI SaaS that creates pricing pages.",
      objective: "Validate the first wedge",
    },
    validationStatus: "valid",
    validationErrors: [],
    reviewStatus: "unreviewed",
    isCurrent: true,
    supersedesArtifactId: null,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  };
}

function writeValidBusinessArtifactFile(workspacePath: string, taskId: string): void {
  mkdirSync(join(workspacePath, ".auto-crop"), { recursive: true });
  writeFileSync(
    join(workspacePath, ".auto-crop", "business-artifact.json"),
    JSON.stringify({
      artifactKind: "deliverable",
      artifactRole: "implementation",
      artifactSubtype: "prototype_implementation",
      taskType: "engineering.prototype_implementation",
      payload: {
        result: `Recovered artifact for ${taskId}.`,
        outcome_summary: `Recovered deliverable for ${taskId} is complete and ready for review. It keeps the objective on track; the remaining gap is downstream integration.`,
      },
      lineage: {
        founderVision: "Build an AI SaaS that creates pricing pages.",
        taskId,
      },
    }),
    "utf8",
  );
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
  const json = await response.json() as { company?: { id?: string; status?: string } };
  if (json.company?.id && json.company.status === "creating") {
    const companiesUrl = url.endsWith("/api/companies") ? url : url.replace(/\/[^/]+\/retry-creation$/, "");
    return (await waitForCompanyStateUrl(companiesUrl, json.company.id, "draft")) as T;
  }
  return json as T;
}

async function waitForCompanyStateUrl(createUrl: string, companyId: string, status: string): Promise<unknown> {
  const stateUrl = `${createUrl}/${companyId}/state`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(stateUrl);
    expect(response.ok).toBe(true);
    const state = await response.json() as { company?: { status?: string } };
    if (state.company?.status === status) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Company ${companyId} did not reach ${status}.`);
}

function createSequentialIdFactory(): (prefix: string) => string {
  const counts = new Map<string, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

function createOperatingModelIdFactory(): (prefix: string) => string {
  const counts = new Map<string, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_operating_model_${next}`;
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
