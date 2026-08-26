import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Proof, Task, TaskEvent } from "@auto-crop/core";
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

  it("returns parent aggregation when a department subtask proof recovery reaches review", async () => {
    const fixture = await startFixtureServer();
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

    const approved = await postJson<{
      decision: { id: string; taskId: string; decision: string; proofId?: string };
      task: { id: string; status: string };
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
    expect(fixture.repositories.getTask(approvedTask!.id)?.status).toBe("complete");

    const returned = await postJson<{
      decision: { id: string; taskId: string; decision: string; returnReason: string; note: string };
      task: { id: string; status: string };
      progressEvent: { label: string; detail: string };
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
    expect(returned.progressEvent.detail).toContain("Add proof and explain the next step.");

    const stale = await fetch(`${fixture.baseUrl}/api/ceo-review-decisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: returnedTask!.id, decision: "approve" }),
    });
    expect(stale.status).toBe(409);

    const state = await getJson<{
      ceoReviewDecisions: Array<{ id: string; taskId: string; decision: string; returnReason?: string }>;
      keyResults: Array<{ currentValue: string; status: string }>;
      taskProgressEvents: Array<{ label: string; detail?: string }>;
    }>(`${fixture.baseUrl}/api/companies/${created.company.id}/state`);
    expect(state.ceoReviewDecisions).toEqual([
      expect.objectContaining({ id: "ceo_review_decision_1", taskId: approvedTask!.id, decision: "approve" }),
      expect.objectContaining({ id: "ceo_review_decision_2", taskId: returnedTask!.id, decision: "return", returnReason: "needs_changes" }),
    ]);
    expect(state.keyResults).toContainEqual(expect.objectContaining({ currentValue: "proof_received", status: "met" }));
    expect(state.taskProgressEvents).toContainEqual(
      expect.objectContaining({ label: "CEO Office returned this, waiting for the department to rework it." }),
    );

    await fixture.close();
  });

  it("cascades dependency readiness after CEO approves an upstream task with proof", async () => {
    const fixture = await startFixtureServer();
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

    const state = await getJson<{ tasks: Array<{ id: string; status: string }>; activity: Array<{ type: string; taskId?: string }> }>(
      `${fixture.baseUrl}/api/companies/${created.company.id}/state`,
    );
    expect(state.tasks).toContainEqual(expect.objectContaining({ id: consumerTask!.id, status: "queued" }));
    expect(state.activity).toContainEqual(expect.objectContaining({ type: "dependency_ready", taskId: consumerTask!.id }));

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
    const fixture = await startFixtureServer();
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
        dependencyNote: `Missing consumable proof from dependency: ${missingDependency!.title}.`,
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
