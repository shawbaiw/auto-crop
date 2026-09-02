import { describe, expect, it } from "vitest";
import type { AgentRun } from "@auto-crop/core";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { MAX_TASK_ATTEMPTS, isRetryExhausted, resetTaskAttempts, taskAttemptCount } from "./boundedRecovery";

function fixture() {
  const client = createDatabaseClient(":memory:");
  migrate(client);
  const repositories = createRepositories(client);
  repositories.createCompany({
    id: "company_1",
    name: "Co",
    founderVision: "v",
    selectedCeoAgentId: "codex",
    playbookId: "ai-saas",
    status: "active",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
  repositories.createDepartment({
    id: "department_1",
    companyId: "company_1",
    name: "Engineering",
    responsibility: "r",
    leadAgentId: "codex",
    memoryPath: "m",
  });
  repositories.createTask({
    id: "task_1",
    companyId: "company_1",
    departmentId: "department_1",
    keyResultId: null,
    title: "T",
    description: "d",
    assigneeAgentId: "codex",
    requiredCapabilities: ["code"],
    proofSchemaId: "test-output",
    workspacePath: null,
    status: "queued",
    riskLevel: "low",
    position: 0,
  });
  return { client, repositories };
}

function run(id: string, status: AgentRun["status"], startedAt: string): AgentRun {
  return {
    id,
    taskId: "task_1",
    agentId: "codex",
    status,
    logPath: "log",
    startedAt,
    finishedAt: null,
    executionProfileName: "short",
    requestedTimeoutMs: 1_000,
    effectiveTimeoutMs: 1_000,
    failureReason: null,
    failureMessage: null,
  };
}

describe("bounded recovery", () => {
  it("counts failed/running attempts and ignores completed ones", () => {
    const { repositories, client } = fixture();
    repositories.createAgentRun(run("r1", "failed", "2026-09-01T00:01:00.000Z"));
    repositories.createAgentRun(run("r2", "complete", "2026-09-01T00:02:00.000Z"));
    repositories.createAgentRun(run("r3", "failed", "2026-09-01T00:03:00.000Z"));

    expect(taskAttemptCount(repositories, "task_1")).toBe(2);
    expect(isRetryExhausted(repositories, "task_1")).toBe(false);

    repositories.createAgentRun(run("r4", "failed", "2026-09-01T00:04:00.000Z"));
    expect(taskAttemptCount(repositories, "task_1")).toBe(MAX_TASK_ATTEMPTS);
    expect(isRetryExhausted(repositories, "task_1")).toBe(true);
    client.close();
  });

  it("reset preserves agent-run history but drops attempts before the marker", () => {
    const { repositories, client } = fixture();
    for (const id of ["r1", "r2", "r3"]) {
      repositories.createAgentRun(run(id, "failed", "2026-09-01T00:01:00.000Z"));
    }
    expect(isRetryExhausted(repositories, "task_1")).toBe(true);

    resetTaskAttempts(repositories, "task_1", "2026-09-01T00:05:00.000Z");

    expect(taskAttemptCount(repositories, "task_1")).toBe(0);
    repositories.createAgentRun(run("r4", "failed", "2026-09-01T00:06:00.000Z"));
    expect(taskAttemptCount(repositories, "task_1")).toBe(1);
    client.close();
  });
});
