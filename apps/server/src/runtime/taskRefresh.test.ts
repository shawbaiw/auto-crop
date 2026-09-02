import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Company, Department, KeyResult, Objective, ProofSchema, Task } from "@auto-crop/core";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { refreshTaskDependencyState } from "./taskRefresh";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("refreshTaskDependencyState proof recovery", () => {
  it("keeps a parent task blocked when manual refresh sees a blocked department subtask before review subtasks", () => {
    const parent = {
      ...createTaskRecord(),
      id: "parent_task",
      title: "Provide local prototype access",
      status: "blocked" as const,
      latestFailureReason: "dependency_failed" as const,
      latestFailureMessage:
        "Parent task blocked: Provide local prototype access / dependency_failed / Execute Provide local prototype access is blocked.",
      dependencyNote: "Blocked by department subtask: Execute Provide local prototype access (blocked).",
      taskKind: "parent" as const,
    };
    const reviewSubtask = {
      ...createTaskRecord(),
      id: "a_review_subtask",
      title: "Validate proof for Provide local prototype access",
      status: "review" as const,
      parentTaskId: parent.id,
      taskKind: "department_subtask" as const,
      source: "department" as const,
    };
    const blockedSubtask = {
      ...createTaskRecord(),
      id: "z_blocked_subtask",
      title: "Execute Provide local prototype access",
      status: "blocked" as const,
      latestFailureReason: "non_reviewable_artifact" as const,
      latestFailureMessage:
        "Task blocked: Execute Provide local prototype access / non_reviewable_artifact / blocker/validation/prototype_screenshot_validation.",
      parentTaskId: parent.id,
      taskKind: "department_subtask" as const,
      source: "department" as const,
    };
    const fixture = createFixture([parent, reviewSubtask, blockedSubtask]);
    fixture.repositories.createTaskDependency({ taskId: parent.id, dependsOnTaskId: reviewSubtask.id });
    fixture.repositories.createTaskDependency({ taskId: parent.id, dependsOnTaskId: blockedSubtask.id });
    fixture.repositories.appendProof({
      id: "proof_review",
      taskId: reviewSubtask.id,
      type: "file",
      uri: "review.md",
      summary: "Review proof.",
      verifiedAt: null,
    });

    const result = refreshTaskDependencyState({
      repositories: fixture.repositories,
      taskId: parent.id,
      proofSchemas: [{ id: "repo-diff", description: "diff proof", acceptedTypes: ["diff"] }],
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(result.task.status).toBe("blocked");
    expect(result.task.latestFailureReason).toBe("dependency_failed");
    expect(result.task.dependencyNote).toBe("Blocked by department subtask: Execute Provide local prototype access (blocked).");
    expect(result.event).toMatchObject({
      type: "task_blocked",
      status: "blocked",
      failureReason: "dependency_failed",
    });
  });

  it("recovers controlled repo-diff output from failed no-proof tasks and submits them to review", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-refresh-proof-"));
    createdDirs.push(workspacePath);
    writeFileSync(join(workspacePath, "prototype-audit-trail.patch"), "diff --git a/app/page.tsx b/app/page.tsx\n", "utf8");
    writeValidBusinessArtifact(workspacePath);
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        workspacePath,
        status: "failed",
        proofSchemaId: "repo-diff",
      },
    ]);
    fixture.repositories.updateTaskExecutionSummary("task_1", {
      latestFailureReason: "no_proof",
      latestFailureMessage: "Task failed: Record implementation changes / no_proof.",
    });

    const result = refreshTaskDependencyState({
      repositories: fixture.repositories,
      taskId: "task_1",
      proofSchemas: [{ id: "repo-diff", description: "diff proof", acceptedTypes: ["diff"] }],
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(result.task.status).toBe("review");
    expect(result.recovery).toEqual({
      status: "recovered",
      message: "Found checkable proof and submitted it to CEO Office for review.",
    });
    expect(result.proof).toHaveLength(1);
    expect(fixture.repositories.listProofsForTask("task_1")[0]).toMatchObject({
      type: "diff",
      summary: "Diff proof recovered from prototype-audit-trail.patch.",
    });
    expect(result.event).toMatchObject({
      type: "proof_recovered",
      status: "review",
      message: "Proof recovered: Record implementation changes submitted to CEO Office for review.",
    });
    expect(result.progressEvent).toMatchObject({
      step: "awaiting_review",
      status: "current",
      label: "Found checkable proof and submitted it to CEO Office for review.",
    });
    expect(result.businessArtifacts).toHaveLength(1);
    expect(fixture.repositories.getCurrentBusinessArtifactForTask("task_1")).toMatchObject({
      artifactKind: "deliverable",
      artifactRole: "implementation",
      reviewStatus: "unreviewed",
      validationStatus: "valid",
    });
  });

  it("recovers controlled repo-diff output from missing-business-artifact refreshes", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-refresh-proof-"));
    createdDirs.push(workspacePath);
    writeFileSync(join(workspacePath, "implementation-changes.diff"), "diff --git a/index.html b/index.html\n", "utf8");
    writeValidBusinessArtifact(workspacePath);
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        workspacePath,
        status: "blocked",
        proofSchemaId: "repo-diff",
        latestFailureReason: "missing_business_artifact",
        latestFailureMessage:
          "Task blocked: Record implementation changes / missing_business_artifact / blocker/none/missing_business_artifact_file.",
      },
    ]);

    const result = refreshTaskDependencyState({
      repositories: fixture.repositories,
      taskId: "task_1",
      proofSchemas: [{ id: "repo-diff", description: "diff proof", acceptedTypes: ["diff"] }],
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(result.task.status).toBe("review");
    expect(result.recovery).toEqual({
      status: "recovered",
      message: "Found checkable proof and submitted it to CEO Office for review.",
    });
    expect(fixture.repositories.listProofsForTask("task_1")[0]).toMatchObject({
      type: "diff",
      summary: "Diff proof recovered from implementation-changes.diff.",
    });
    expect(fixture.repositories.getCurrentBusinessArtifactForTask("task_1")).toMatchObject({
      artifactKind: "deliverable",
      artifactRole: "implementation",
      reviewStatus: "unreviewed",
      validationStatus: "valid",
    });
  });

  it("recovers proof from an upstream artifact workspace during refresh", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-refresh-empty-"));
    const upstreamWorkspacePath = mkdtempSync(join(tmpdir(), "auto-crop-refresh-upstream-"));
    createdDirs.push(workspacePath, upstreamWorkspacePath);
    writeFileSync(
      join(upstreamWorkspacePath, "implementation-changes.diff"),
      "diff --git a/index.html b/index.html\n",
      "utf8",
    );
    writeValidBusinessArtifact(upstreamWorkspacePath);
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        workspacePath,
        status: "blocked",
        proofSchemaId: "repo-diff",
        latestFailureReason: "missing_business_artifact",
        latestFailureMessage:
          "Task blocked: Record implementation changes / missing_business_artifact / blocker/none/missing_business_artifact_file.",
      },
      {
        ...createTaskRecord(),
        id: "upstream_task",
        title: "Build the SEO-ready MVP prototype",
        workspacePath: upstreamWorkspacePath,
        artifactWorkspacePath: upstreamWorkspacePath,
        status: "complete",
        proofSchemaId: "landing-page-file",
      },
    ]);
    fixture.repositories.createTaskDependency({
      taskId: "task_1",
      dependsOnTaskId: "upstream_task",
      handoffContract: "Use the prototype workspace.",
    });

    const result = refreshTaskDependencyState({
      repositories: fixture.repositories,
      taskId: "task_1",
      proofSchemas: [{ id: "repo-diff", description: "diff proof", acceptedTypes: ["diff"] }],
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(result.task.status).toBe("review");
    expect(fixture.repositories.listProofsForTask("task_1")[0]).toMatchObject({
      type: "diff",
      uri: join(upstreamWorkspacePath, ".auto-crop-proof", "task_1.diff"),
      summary: "Diff proof recovered from implementation-changes.diff.",
    });
    expect(result.event).toMatchObject({
      type: "proof_recovered",
      status: "review",
      artifactWorkspacePath: upstreamWorkspacePath,
    });
    expect(fixture.repositories.getCurrentBusinessArtifactForTask("task_1")).toMatchObject({
      artifactKind: "deliverable",
      reviewStatus: "unreviewed",
      validationStatus: "valid",
    });
  });

  it("blocks recovered proof before CEO review when the business artifact is missing", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-refresh-proof-"));
    createdDirs.push(workspacePath);
    writeFileSync(join(workspacePath, "prototype-audit-trail.patch"), "diff --git a/app/page.tsx b/app/page.tsx\n", "utf8");
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        workspacePath,
        status: "failed",
        proofSchemaId: "repo-diff",
      },
    ]);
    fixture.repositories.updateTaskExecutionSummary("task_1", {
      latestFailureReason: "no_proof",
      latestFailureMessage: "Task failed: Record implementation changes / no_proof.",
    });

    const result = refreshTaskDependencyState({
      repositories: fixture.repositories,
      taskId: "task_1",
      proofSchemas: [{ id: "repo-diff", description: "diff proof", acceptedTypes: ["diff"] }],
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(result.task.status).toBe("blocked");
    expect(result.task.latestFailureReason).toBe("missing_business_artifact");
    expect(result.recovery).toEqual({
      status: "recovered",
      message: "Found checkable proof, but blocked before CEO review because the business artifact is not reviewable.",
    });
    expect(result.proof).toHaveLength(1);
    expect(result.businessArtifacts).toHaveLength(1);
    expect(result.businessArtifacts?.[0]).toMatchObject({
      artifactKind: "blocker",
      artifactRole: "none",
      artifactSubtype: "missing_business_artifact_file",
      validationStatus: "invalid_schema",
      reviewStatus: "not_reviewable",
    });
    expect(result.event).toMatchObject({
      type: "task_blocked",
      status: "blocked",
      failureReason: "missing_business_artifact",
    });
    expect(result.progressEvent).toMatchObject({
      step: "blocked",
      status: "blocked",
    });
  });

  it("does not degrade an unverified screenshot sandbox blocker during proof recovery", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-refresh-proof-"));
    createdDirs.push(workspacePath);
    writeFileSync(join(workspacePath, "index.html"), "<main>Auto Crop Workspace</main>", "utf8");
    writeScreenshotSandboxBlockerArtifact(workspacePath);
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        workspacePath,
        status: "blocked",
        proofSchemaId: "landing-page-file",
        latestFailureReason: "non_reviewable_artifact",
        latestFailureMessage:
          "Task blocked: Execute Provide local prototype access / non_reviewable_artifact / blocker/validation/prototype_screenshot_validation.",
      },
    ]);

    const result = refreshTaskDependencyState({
      repositories: fixture.repositories,
      taskId: "task_1",
      proofSchemas: [{ id: "landing-page-file", description: "landing page file proof", acceptedTypes: ["file"] }],
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    // Render evidence is never accepted on the agent's word: without an independent runtime check
    // the blocker stands and the task stays blocked instead of reaching CEO review.
    expect(result.task.status).toBe("blocked");
    expect(result.businessArtifacts?.[0]?.artifactKind).toBe("blocker");
  });

  it("does not recover unrelated failed tasks", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-refresh-proof-"));
    createdDirs.push(workspacePath);
    writeFileSync(join(workspacePath, "prototype-audit-trail.patch"), "diff --git a/app/page.tsx b/app/page.tsx\n", "utf8");
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        workspacePath,
        status: "failed",
        proofSchemaId: "repo-diff",
      },
    ]);
    fixture.repositories.updateTaskExecutionSummary("task_1", {
      latestFailureReason: "timeout",
      latestFailureMessage: "Task failed: Record implementation changes / timeout.",
    });

    const result = refreshTaskDependencyState({
      repositories: fixture.repositories,
      taskId: "task_1",
      proofSchemas: [{ id: "repo-diff", description: "diff proof", acceptedTypes: ["diff"] }],
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(result.task.status).toBe("queued");
    expect(result.recovery).toEqual({
      status: "not_applicable",
      message: "Proof recovery does not apply to this task.",
    });
    expect(fixture.repositories.listProofsForTask("task_1")).toEqual([]);
  });

  it("explains expected repo-diff proof locations when refresh cannot recover proof", () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "auto-crop-refresh-proof-"));
    createdDirs.push(workspacePath);
    writeValidBusinessArtifact(workspacePath);
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        workspacePath,
        status: "failed",
        proofSchemaId: "repo-diff",
      },
    ]);
    fixture.repositories.updateTaskExecutionSummary("task_1", {
      latestFailureReason: "no_proof",
      latestFailureMessage: "Task failed: Record implementation changes / no_proof.",
    });

    const result = refreshTaskDependencyState({
      repositories: fixture.repositories,
      taskId: "task_1",
      proofSchemas: [{ id: "repo-diff", description: "diff proof", acceptedTypes: ["diff"] }],
      now: () => new Date("2026-08-25T00:00:00.000Z"),
      createId: createSequentialIdFactory(),
    });

    expect(result.recovery?.status).toBe("not_found");
    expect(result.recovery?.message).toContain("repo-diff proof missing");
    expect(result.recovery?.message).toContain(".auto-crop-proof/*.diff");
    expect(result.recovery?.message).toContain("top-level workspace *.diff/*.patch");
    expect(result.recovery?.message).toContain(".auto-crop/business-artifact.json is not diff proof");
    expect(fixture.repositories.listProofsForTask("task_1")).toEqual([]);
  });

  it("refuses to refresh a task that has reached the recovery ceiling", () => {
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        status: "blocked",
        latestFailureReason: "retry_exhausted",
        latestFailureMessage: "Task blocked: Record implementation changes / retry_exhausted.",
      },
    ]);
    for (const id of ["run_1", "run_2", "run_3"]) {
      fixture.repositories.createAgentRun({
        id,
        taskId: "task_1",
        agentId: "codex",
        status: "failed",
        logPath: "agent.log",
        startedAt: "2026-08-25T00:00:00.000Z",
        finishedAt: "2026-08-25T00:01:00.000Z",
        executionProfileName: "short",
        requestedTimeoutMs: 1_000,
        effectiveTimeoutMs: 1_000,
        failureReason: "no_proof",
        failureMessage: "no_proof",
      });
    }

    expect(() =>
      refreshTaskDependencyState({
        repositories: fixture.repositories,
        taskId: "task_1",
        now: () => new Date("2026-08-25T00:00:00.000Z"),
        createId: createSequentialIdFactory(),
      }),
    ).toThrow(/retry_exhausted/i);
  });

  it("routes a still-failed exhausted task into the CEO Blocked Queue before refusing", () => {
    const fixture = createFixture([
      {
        ...createTaskRecord(),
        status: "failed",
        latestFailureReason: "no_proof",
        latestFailureMessage: "Task failed: Record implementation changes / no_proof.",
      },
    ]);
    for (const id of ["run_1", "run_2", "run_3"]) {
      fixture.repositories.createAgentRun({
        id,
        taskId: "task_1",
        agentId: "codex",
        status: "failed",
        logPath: "agent.log",
        startedAt: "2026-08-25T00:00:00.000Z",
        finishedAt: "2026-08-25T00:01:00.000Z",
        executionProfileName: "short",
        requestedTimeoutMs: 1_000,
        effectiveTimeoutMs: 1_000,
        failureReason: "no_proof",
        failureMessage: "no_proof",
      });
    }

    expect(() =>
      refreshTaskDependencyState({
        repositories: fixture.repositories,
        taskId: "task_1",
        now: () => new Date("2026-08-25T00:00:00.000Z"),
        createId: createSequentialIdFactory(),
      }),
    ).toThrow(/retry_exhausted/i);

    const task = fixture.repositories.getTask("task_1");
    expect(task?.status).toBe("blocked");
    expect(task?.latestFailureReason).toBe("retry_exhausted");
    expect(fixture.repositories.listTaskEventsForCompany("company_1")).toContainEqual(
      expect.objectContaining({ taskId: "task_1", type: "task_blocked", failureReason: "retry_exhausted" }),
    );
  });
});

function createFixture(tasks: Task[]) {
  const client = createDatabaseClient(":memory:");
  migrate(client);
  const repositories = createRepositories(client);

  repositories.createCompany(createCompanyRecord());
  repositories.createDepartment(createDepartmentRecord());
  repositories.createObjective(createObjectiveRecord());
  repositories.createKeyResult(createKeyResultRecord());
  for (const task of tasks) {
    repositories.createTask(task);
  }

  return { repositories, client };
}

function createCompanyRecord(): Company {
  return {
    id: "company_1",
    name: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    selectedCeoAgentId: "codex",
    playbookId: "ai-saas",
    status: "active",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  };
}

function createDepartmentRecord(): Department {
  return {
    id: "department_1",
    companyId: "company_1",
    name: "Engineering",
    responsibility: "Build prototypes.",
    leadAgentId: "codex",
    memoryPath: ".auto-crop/companies/company_1/departments/engineering/memory.md",
  };
}

function createObjectiveRecord(): Objective {
  return {
    id: "objective_1",
    companyId: "company_1",
    title: "Validate first wedge",
    status: "active",
    priority: 1,
  };
}

function createKeyResultRecord(): KeyResult {
  return {
    id: "key_result_1",
    objectiveId: "objective_1",
    title: "Ship proof-backed prototype",
    metricName: "proof_status",
    targetValue: "proof_received",
    currentValue: "not_started",
    status: "active",
  };
}

function createTaskRecord(): Task {
  return {
    id: "task_1",
    companyId: "company_1",
    departmentId: "department_1",
    keyResultId: "key_result_1",
    title: "Record implementation changes",
    description: "Record implementation changes.",
    assigneeAgentId: "codex",
    requiredCapabilities: ["code"],
    proofSchemaId: "repo-diff",
    workspacePath: ".auto-crop/workspaces/task_1",
    status: "queued",
    riskLevel: "medium",
    position: 0,
  };
}

function createSequentialIdFactory(): (prefix: string) => string {
  const counts = new Map<string, number>();

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `${prefix}_${next}`;
  };
}

function writeValidBusinessArtifact(workspacePath: string): void {
  mkdirSync(join(workspacePath, ".auto-crop"), { recursive: true });
  writeFileSync(
    join(workspacePath, ".auto-crop", "business-artifact.json"),
    JSON.stringify({
      artifactKind: "deliverable",
      artifactRole: "implementation",
      artifactSubtype: "prototype_implementation",
      taskType: "engineering.prototype_implementation",
      payload: {
        summary: "Implementation completed.",
        nextSteps: ["CEO review"],
      },
      lineage: { taskId: "task_1" },
    }),
    "utf8",
  );
}

function writeScreenshotSandboxBlockerArtifact(workspacePath: string): void {
  mkdirSync(join(workspacePath, ".auto-crop"), { recursive: true });
  writeFileSync(
    join(workspacePath, ".auto-crop", "business-artifact.json"),
    JSON.stringify({
      artifact_kind: "blocker",
      artifact_role: "validation",
      artifact_subtype: "prototype_screenshot_validation",
      task_type: "local_prototype_exposure",
      payload: {
        proof: {
          status: "blocked_by_browser_sandbox",
          screenshot_path: null,
        },
      },
      lineage: {
        proof_schema: "landing-page-file",
      },
    }),
    "utf8",
  );
}
