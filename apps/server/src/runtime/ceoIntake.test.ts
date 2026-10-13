import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectCeoOfficeItems, type CeoIntake, type Company, type Task } from "@auto-crop/core";
import type { AgentAdapter, AgentRunRequest, AgentRunResult } from "../adapters/types";
import { createDatabaseClient } from "../db/client";
import { createRepositories } from "../db/repositories";
import { migrate } from "../db/schema";
import { CEO_INTAKE_MAX_ATTEMPTS, recoverInterruptedCeoIntakes, runCeoIntakeJobs, type RunCeoIntakeJobsInput } from "./ceoIntake";
import { buildTaskExecutionPrompt } from "./taskExecutionPrompt";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("CEO Intake assessment (ADR 0046)", () => {
  it("keeps context-only input as company context that later task runs read", async () => {
    const fixture = createFixture();
    fixture.send("Our first customers are indie game studios.");
    const ceo = createCeo(() => reply({ outcome: "context_only", summary: "I noted that your first customers are indie game studios." }));

    await fixture.run(ceo);

    const intake = fixture.intake();
    expect(intake).toMatchObject({
      status: "dispatched",
      outcome: "context_only",
      outcomeSummary: { en: "I noted that your first customers are indie game studios." },
      attempts: 1,
      assessedAt: "2026-10-13T09:00:00.000Z",
    });
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: "ceo_intake_updated", companyId: "company_1" }));
    const prompt = buildTaskExecutionPrompt({
      company: fixture.company(),
      task: fixture.repositories.getTask("task_research")!,
      handoffs: [],
      companyContextNotes: ["Our first customers are indie game studios."],
    });
    expect(prompt).toContain("- Our first customers are indie game studios.");
  });

  it("assesses with no tools, under a Structured Output Contract, in the company's words", async () => {
    const fixture = createFixture();
    fixture.send("Add annual plans.");
    const ceo = createCeo(() => reply({ outcome: "context_only", summary: "Noted." }));

    await fixture.run(ceo);

    const request = ceo.requests[0]!;
    expect(request.grant).toEqual({ granted: [], withheld: [], id: "none" });
    expect(request.outputSchema).toMatchObject({ required: ["outcome", "summary", "tasks", "targetTaskId", "replanNote"] });
    expect(request.metadata.phase).toBe("ceo_intake");
    expect(request.prompt).toContain("Add annual plans.");
    expect(request.prompt).toContain("`department_research` Research");
    expect(request.prompt).toContain("## Founder Writing Rules");
    expect(request.prompt).toContain("- Goal: Validate the first offer");
    expect(request.prompt).toContain("`key_result_1` Pick a pricing model (target: chosen; not met yet)");
  });

  it("places each new task under the key result it names, and reopens a met key result that gains a task", async () => {
    const fixture = createFixture();
    fixture.repositories.writeTaskStatusUnchecked("task_research", "complete");
    fixture.repositories.updateKeyResultStatus("key_result_1", "met");
    fixture.send("Also compare yearly pricing.");
    const ceo = createCeo(() => reply({ outcome: "create_tasks", summary: "I added one task.", tasks: [plannedTask({ key: "yearly", title: "Compare yearly pricing" })] }));

    await fixture.run(ceo);

    const [taskId] = fixture.intake().createdTaskIds!;
    expect(fixture.repositories.getTask(taskId!)?.keyResultId).toBe("key_result_1");
    expect(fixture.repositories.listKeyResults("company_1")[0]?.status).toBe("active");
  });

  it("refuses a new task that names no key result of the company", async () => {
    const fixture = createFixture();
    fixture.send("Add a task.");
    const ceo = createCeo(() => reply({ outcome: "create_tasks", summary: "Added.", tasks: [plannedTask({ keyResultId: "key_result_9" })] }));

    await fixture.run(ceo);

    expect(fixture.intake()).toMatchObject({ status: "received", failureReason: "invalid_agent_output" });
    expect(fixture.intake().failureMessage).toContain("tasks[0].keyResultId key_result_9 is not a key result");
  });

  it("creates tasks placed like blueprint tasks, after the existing ones, and wakes the scheduler", async () => {
    const fixture = createFixture();
    fixture.send("Also support annual plans with a discount.");
    let wakes = 0;
    const ceo = createCeo(() => reply({
      outcome: "create_tasks",
      summary: "I added two tasks for annual plans.",
      tasks: [
        plannedTask({ key: "annual_research", title: "Compare annual discounts", dependsOnTaskIds: ["task_research"], proofSchemaId: "screenshot", handoffContract: "Discount levels with sources" }),
        plannedTask({ key: "annual_brief", title: "Write the annual plan brief", proofSchemaId: "product-brief", dependsOnTaskKeys: ["annual_research"] }),
      ],
    }));

    await fixture.run(ceo, { requestSchedulerWake: () => wakes++ });

    const intake = fixture.intake();
    expect(intake.status).toBe("dispatched");
    expect(intake.outcome).toBe("create_tasks");
    expect(intake.createdTaskIds).toHaveLength(2);
    const [research, brief] = intake.createdTaskIds!.map((id) => fixture.repositories.getTask(id)!);
    expect(research).toMatchObject({ title: "Compare annual discounts", status: "queued", departmentId: "department_research", assigneeAgentId: "claude-code", position: 1, source: "ceo", proofSchemaId: "test-output" });
    expect(brief).toMatchObject({ title: "Write the annual plan brief", position: 2, proofSchemaId: "product-brief" });
    expect(fixture.repositories.listTaskDependencies(research!.id).map((dependency) => dependency.dependsOnTaskId)).toEqual(["task_research"]);
    expect(fixture.repositories.listTaskDependenciesForCompany("company_1").filter((dependency) => dependency.taskId === brief!.id)).toEqual([
      expect.objectContaining({ dependsOnTaskId: research!.id, handoffContract: "Discount levels with sources" }),
    ]);
    // A deliverable type the runtime cannot collect is replaced, as in the blueprint, and says so.
    expect(fixture.repositories.listTaskEventsForCompany("company_1")).toContainEqual(expect.objectContaining({ taskId: research!.id, type: "task_warning" }));
    expect(wakes).toBe(1);
  });

  it("asks for a new plan only for a task that offers one, with the founder's words as the note", async () => {
    const fixture = createFixture([taskRecord("task_stuck", "needs_replan", 1)]);
    fixture.send("Drop the KD requirement for keywords.");
    const ceo = createCeo((request) => request.metadata.phase === "ceo_intake"
      ? reply({ outcome: "revise_plan", summary: "I asked for a new plan for the keyword task.", targetTaskId: "task_stuck", replanNote: "Remove the numeric KD threshold." })
      : complete(["```json", JSON.stringify({ mode: "revision", rationale: "Remove the KD threshold.", revisedTask: { title: "Find keywords", description: "Find keywords without KD.", requiredCapabilities: ["research"], proofSchemaId: "research-report", riskLevel: "low" }, requirementChanges: [] }), "```"].join("\n")));

    await fixture.run(ceo);

    expect(ceo.requests[0]!.prompt).toContain("`task_stuck` [Research] Task task_stuck (status: needs_replan) — stuck, can get a new plan");
    const intake = fixture.intake();
    expect(intake).toMatchObject({ status: "dispatched", outcome: "revise_plan", targetTaskId: "task_stuck" });
    const proposal = fixture.repositories.getReplanProposal(intake.replanProposalId!);
    expect(proposal).toMatchObject({ sourceTaskId: "task_stuck", status: "proposed" });
    expect(proposal!.founderNote).toBe("Founder input: Drop the KD requirement for keywords.\nCEO: Remove the numeric KD threshold.");
  });

  it("refuses a new plan for a task that does not offer one, retries once, then fails the intake", async () => {
    const fixture = createFixture();
    fixture.send("Change the research task.");
    const ceo = createCeo(() => reply({ outcome: "revise_plan", summary: "New plan.", targetTaskId: "task_research", replanNote: null }));

    await fixture.run(ceo);
    expect(fixture.intake()).toMatchObject({ status: "received", attempts: 1, failureReason: "invalid_agent_output", assessedAt: null });

    await fixture.run(ceo);
    expect(fixture.intake()).toMatchObject({ status: "failed", attempts: CEO_INTAKE_MAX_ATTEMPTS, failureReason: "invalid_agent_output" });
    expect(fixture.repositories.listReplanProposalsForCompany("company_1")).toEqual([]);
  });

  it("retries a failed run once and keeps the second answer", async () => {
    const fixture = createFixture();
    fixture.send("Note this.");
    let calls = 0;
    const ceo = createCeo(() => (++calls === 1 ? { status: "failed", exitCode: 1, stdout: "", stderr: "crashed" } : reply({ outcome: "context_only", summary: "Noted." })));

    await fixture.run(ceo);
    await fixture.run(ceo);

    expect(fixture.intake()).toMatchObject({ status: "dispatched", attempts: 2, failureReason: null });
  });

  it("lets input to a paused company wait, and assesses it after the company resumes", async () => {
    const fixture = createFixture();
    fixture.setStatus("paused");
    fixture.send("Note this.");
    const ceo = createCeo(() => reply({ outcome: "context_only", summary: "Noted." }));

    await fixture.run(ceo);
    expect(ceo.requests).toHaveLength(0);
    expect(fixture.intake().status).toBe("received");

    fixture.setStatus("active");
    await fixture.run(ceo);
    expect(fixture.intake().status).toBe("dispatched");
  });

  it("stops an assessment when the company is paused mid-run, and does not count the attempt", async () => {
    const fixture = createFixture();
    fixture.send("Note this.");
    const ceo = createCeo(async (request) => {
      fixture.setStatus("paused");
      await new Promise<void>((resolve) => request.signal?.addEventListener("abort", () => resolve()));
      return { status: "failed", exitCode: null, stdout: "", stderr: "stopped" };
    });

    await fixture.run(ceo, { companyStatusPollMs: 5 });

    expect(fixture.intake()).toMatchObject({ status: "received", attempts: 0, assessedAt: null });
  });

  it("fails input that waits for a company which is then stopped", async () => {
    const fixture = createFixture();
    fixture.send("Note this.");
    fixture.setStatus("stopped");
    const ceo = createCeo(() => reply({ outcome: "context_only", summary: "Noted." }));

    await fixture.run(ceo);

    expect(ceo.requests).toHaveLength(0);
    expect(fixture.intake()).toMatchObject({ status: "failed", failureReason: "company_stopped" });
  });

  it("puts an assessment that a restart abandoned back in the queue", () => {
    const fixture = createFixture();
    fixture.send("Note this.");
    fixture.repositories.saveCeoIntakeAssessment({ ...fixture.intake(), status: "assessing", attempts: 1 });

    recoverInterruptedCeoIntakes(fixture.repositories, () => new Date("2026-10-13T09:00:00.000Z"));

    expect(fixture.intake()).toMatchObject({ status: "received", attempts: 1 });
  });

  it("projects the founder's words and the CEO's answer as two timeline cards", async () => {
    const fixture = createFixture();
    fixture.send("Note this.");
    await fixture.run(createCeo(() => reply({ outcome: "context_only", summary: "Noted." })));

    const items = projectCeoOfficeItems({
      company: fixture.company(),
      tasks: fixture.repositories.listTasksForCompany("company_1"),
      taskCompletionEvents: [],
      ceoIntakes: fixture.repositories.listCeoIntakesForCompany("company_1"),
    });
    expect(items.filter((item) => item.type.includes("intake")).map((item) => [item.type, item.occurredAt])).toEqual([
      ["founder_intake", "2026-10-13T08:00:00.000Z"],
      ["intake_outcome", "2026-10-13T09:00:00.000Z"],
    ]);
    expect(items.find((item) => item.type === "intake_outcome")).toMatchObject({ actionBearing: false, data: { outcome: "context_only", summary: { en: "Noted." } } });
  });
});

type Ceo = AgentAdapter & { requests: AgentRunRequest[] };

function createCeo(answer: (request: AgentRunRequest) => AgentRunResult | Promise<AgentRunResult>): Ceo {
  const requests: AgentRunRequest[] = [];
  return {
    id: "codex",
    name: "Codex",
    capabilities: ["code", "research", "writing"],
    requests,
    async detect() {
      return true;
    },
    async run(request) {
      requests.push(request);
      return answer(request);
    },
  };
}

function complete(stdout: string): AgentRunResult {
  return { status: "complete", exitCode: 0, stdout, stderr: "" };
}

function reply(value: { outcome: string; summary: string; tasks?: unknown[]; targetTaskId?: string | null; replanNote?: string | null }): AgentRunResult {
  return complete(JSON.stringify({ tasks: [], targetTaskId: null, replanNote: null, ...value }));
}

function plannedTask(overrides: Record<string, unknown>) {
  return {
    key: "task",
    departmentId: "department_research",
    keyResultId: "key_result_1",
    title: "Task",
    description: "Do the work.",
    proofSchemaId: "research-report",
    requiredCapabilities: ["research"],
    riskLevel: "low",
    dependsOnTaskIds: [],
    dependsOnTaskKeys: [],
    handoffContract: "",
    ...overrides,
  };
}

function createFixture(extraTasks: Task[] = []) {
  const client = createDatabaseClient(":memory:");
  migrate(client);
  const repositories = createRepositories(client);
  const projectRoot = mkdtempSync(join(tmpdir(), "auto-crop-intake-"));
  createdDirs.push(projectRoot);
  const company: Company = {
    id: "company_1",
    name: "Pricing Page Studio",
    founderVision: "Build an AI SaaS that creates pricing pages.",
    locale: "en",
    selectedCeoAgentId: "codex",
    playbookId: "ai-saas",
    permissionMode: "balanced",
    status: "active",
    createdAt: "2026-10-13T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
  };
  repositories.createCompany(company);
  repositories.createDepartment({
    id: "department_research",
    companyId: company.id,
    name: "Research",
    responsibility: "Find what buyers pay for.",
    leadAgentId: "claude-code",
    memoryPath: ".auto-crop/companies/company_1/departments/research/Memory.md",
  });
  repositories.createObjective({ id: "objective_1", companyId: company.id, title: "Validate the first offer", status: "active", priority: 1 });
  repositories.createKeyResult({
    id: "key_result_1", objectiveId: "objective_1", title: "Pick a pricing model", metricName: "pricing_model",
    targetValue: "chosen", currentValue: "open", status: "active",
  });
  repositories.createTask(taskRecord("task_research", "running", 0));
  extraTasks.forEach((task) => repositories.createTask(task));
  const events: Array<{ type: string; companyId: string }> = [];
  let ids = 0;

  return {
    repositories,
    events,
    company: () => repositories.getCompany(company.id)!,
    setStatus: (status: Company["status"]) => repositories.updateCompanyStatus(company.id, status, "2026-10-13T08:30:00.000Z"),
    send(body: string) {
      const intake: CeoIntake = { id: "intake_1", companyId: company.id, body, status: "received", createdAt: "2026-10-13T08:00:00.000Z", updatedAt: "2026-10-13T08:00:00.000Z" };
      repositories.createCeoIntake(intake);
    },
    intake: () => repositories.getCeoIntake("intake_1")!,
    run(ceo: Ceo, overrides: Partial<RunCeoIntakeJobsInput> = {}) {
      return runCeoIntakeJobs({
        projectRoot,
        repositories,
        adapters: [ceo],
        now: () => new Date("2026-10-13T09:00:00.000Z"),
        createId: (prefix) => `${prefix}_${++ids}`,
        emit: (event) => events.push(event),
        ...overrides,
      });
    },
  };
}

function taskRecord(id: string, status: Task["status"], position: number): Task {
  return {
    id,
    companyId: "company_1",
    departmentId: "department_research",
    keyResultId: "key_result_1",
    title: `Task ${id}`,
    description: "Run mock work.",
    assigneeAgentId: "claude-code",
    requiredCapabilities: ["research"],
    proofSchemaId: "research-report",
    workspacePath: null,
    status,
    riskLevel: "medium",
    position,
    latestFailureReason: status === "needs_replan" ? "needs_replan" : null,
  };
}
