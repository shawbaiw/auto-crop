import { writeFileSync } from "node:fs";
import type {
  CeoIntake,
  CeoIntakeFailureReason,
  CeoIntakeOutcome,
  Company,
  Department,
  ProofSchema,
  RiskLevel,
  Task,
  TaskDependency,
  TaskEvent,
} from "@auto-crop/core";
import type { AgentAdapter, AgentRunResult } from "../adapters/types";
import type { createRepositories } from "../db/repositories";
import { selectPlaybook } from "../playbooks/selectPlaybook";
import type { Playbook } from "../playbooks/types";
import { noToolGrant } from "../policies/capabilityGrant";
import { createPlannedTask } from "./createCompany";
import { resolveEffectiveTimeoutForProfileName } from "./executionProfile";
import { FOUNDER_WRITING_RULES, LOCALE_LANGUAGE_NAME } from "./localePromptText";
import { isCollectableSchema } from "./proof";
import { createReplanProposalForTask, ReplanNotOfferedError } from "./replan";
import { checkTaskAffordance } from "./taskAffordances";
import { createCompanyWorkspace } from "./workspace";

type Repositories = ReturnType<typeof createRepositories>;

/**
 * How many assessment runs an intake gets. One retry covers a flaky run; a second failure is shown to
 * the founder, who can send the input again.
 */
export const CEO_INTAKE_MAX_ATTEMPTS = 2;
/** The most tasks one intake may add. Larger requests are a sign the input needs a conversation, not a batch. */
export const CEO_INTAKE_MAX_TASKS = 5;
/** How often a running assessment checks that its company is still `active`. */
const COMPANY_STATUS_POLL_MS = 2_000;
/** The proof schema a non-collectable choice falls back to, as in blueprint parsing. */
const FALLBACK_PROOF_SCHEMA_ID = "test-output";

/**
 * The Structured Output Contract of an intake assessment (ADR 0022). Every field is required and
 * nullable where it does not apply, which both CLIs accept.
 */
export const ceoIntakeOutputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "summary", "tasks", "targetTaskId", "replanNote"],
  properties: {
    outcome: { type: "string", enum: ["create_tasks", "revise_plan", "context_only"] },
    summary: { type: "string" },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "key", "departmentId", "title", "description", "proofSchemaId", "requiredCapabilities",
          "riskLevel", "dependsOnTaskIds", "dependsOnTaskKeys", "handoffContract",
        ],
        properties: {
          key: { type: "string" },
          departmentId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          proofSchemaId: { type: "string" },
          requiredCapabilities: { type: "array", items: { type: "string" } },
          riskLevel: { type: "string", enum: ["low", "medium", "high"] },
          dependsOnTaskIds: { type: "array", items: { type: "string" } },
          dependsOnTaskKeys: { type: "array", items: { type: "string" } },
          handoffContract: { type: "string" },
        },
      },
    },
    targetTaskId: { type: ["string", "null"] },
    replanNote: { type: ["string", "null"] },
  },
};

export type CeoIntakeAssessmentContext = {
  company: Company;
  departments: Department[];
  tasks: Task[];
  /** Tasks whose Holds offer `request_replan` now. Only these can get a new plan (ADR 0043). */
  replannableTaskIds: Set<string>;
  proofSchemas: ProofSchema[];
  /** Earlier founder input the CEO kept as company context. */
  contextNotes: string[];
  capabilities: string[];
};

export type CeoIntakeDecision =
  | { outcome: "context_only"; summary: string }
  | { outcome: "revise_plan"; summary: string; targetTaskId: string; replanNote: string | null }
  | { outcome: "create_tasks"; summary: string; tasks: CeoIntakePlannedTask[] };

export type CeoIntakePlannedTask = {
  key: string;
  departmentId: string;
  title: string;
  description: string;
  proofSchemaId: string;
  requiredCapabilities: string[];
  riskLevel: RiskLevel;
  dependsOnTaskIds: string[];
  dependsOnTaskKeys: string[];
  handoffContract: string;
};

export function resolveCeoIntakeAssessmentContext(repositories: Repositories, company: Company, playbook: Playbook, adapters: AgentAdapter[]): CeoIntakeAssessmentContext {
  const tasks = repositories.listTasksForCompany(company.id);
  return {
    company,
    departments: repositories.listDepartments(company.id),
    tasks,
    replannableTaskIds: new Set(tasks.filter((task) => checkTaskAffordance(repositories, task, "request_replan").ok).map((task) => task.id)),
    proofSchemas: playbook.proofSchemas.filter(isCollectableSchema),
    contextNotes: listCompanyContextNotes(repositories, company.id),
    capabilities: [...new Set(adapters.flatMap((adapter) => adapter.capabilities))].sort(),
  };
}

/**
 * Founder input the CEO kept as company context. Every later task run and intake assessment is
 * given these, so "record as context" changes what the company knows (ADR 0046).
 */
export function listCompanyContextNotes(repositories: Repositories, companyId: string): string[] {
  return repositories
    .listCeoIntakesForCompany(companyId)
    .filter((intake) => intake.outcome === "context_only" && intake.status === "dispatched")
    .map((intake) => intake.body);
}

export function buildCeoIntakePrompt(context: CeoIntakeAssessmentContext, intake: CeoIntake): string {
  const { company } = context;
  const language = LOCALE_LANGUAGE_NAME[company.locale];
  const departmentsById = new Map(context.departments.map((department) => [department.id, department]));
  return [
    "# Assess Founder Input",
    "",
    "You are the CEO Agent of an Auto-Crop company. The founder sent new input to CEO Office.",
    "Decide what it needs. Do not do the work yourself, and do not use tools. Choose exactly one outcome:",
    "- `create_tasks`: the input asks for new work. Plan 1 to 5 tasks, placed in existing departments.",
    "- `revise_plan`: the input changes a task that is stuck. Only tasks listed as \"can get a new plan\" qualify. The founder confirms the new plan before it applies.",
    "- `context_only`: the input is information, a constraint or a preference. Keep it as company context. Later tasks will read it.",
    "Prefer `context_only` when the input does not clearly ask for new work. Do not create a task that repeats a task that already exists.",
    "",
    "## Company",
    `Name: ${company.name}`,
    `Founder vision: ${company.founderVision}`,
    ...(context.contextNotes.length > 0
      ? ["", "Earlier founder input kept as context:", ...context.contextNotes.map((note) => `- ${note}`)]
      : []),
    "",
    "## Departments",
    ...context.departments.map((department) => `- \`${department.id}\` ${department.name}: ${department.responsibility}`),
    "",
    "## Current Tasks",
    ...(context.tasks.length > 0
      ? context.tasks.map((task) => {
        const department = departmentsById.get(task.departmentId)?.name ?? task.departmentId;
        const replan = context.replannableTaskIds.has(task.id) ? " — stuck, can get a new plan" : "";
        return `- \`${task.id}\` [${department}] ${task.title} (status: ${task.status})${replan}`;
      })
      : ["- None."]),
    "",
    "## Deliverable Types",
    "Each new task needs one `proofSchemaId` from this list:",
    ...context.proofSchemas.map((schema) => `- \`${schema.id}\`: ${schema.description}`),
    "",
    "## Capabilities",
    `Each new task lists the capabilities it needs, from: ${context.capabilities.join(", ") || "research"}.`,
    "",
    "## Reply",
    "Return JSON with these fields:",
    "- `outcome`: one of `create_tasks`, `revise_plan`, `context_only`.",
    `- \`summary\`: your answer to the founder, in ${language}. Say what you decided and what happens next, in one to three short sentences. Name the tasks you create or the task you replan by their titles.`,
    "- `tasks`: for `create_tasks`, the new tasks; otherwise an empty array. Each has a unique short `key`, a `departmentId` from the list above, a `title` and `description` in the company language, a `proofSchemaId`, `requiredCapabilities`, a `riskLevel`, `dependsOnTaskIds` (existing task ids it needs first), `dependsOnTaskKeys` (keys of earlier new tasks it needs first) and a `handoffContract` (what it hands to tasks that depend on it).",
    "- `targetTaskId`: for `revise_plan`, the id of the stuck task; otherwise null.",
    "- `replanNote`: for `revise_plan`, what the new plan must change, for the planner; otherwise null.",
    "",
    FOUNDER_WRITING_RULES[company.locale],
    "",
    "## Founder Input",
    intake.body,
  ].join("\n");
}

/** Read the reply against the company's real state. Anything the runtime cannot act on is refused, not guessed. */
export function parseCeoIntakeOutput(stdout: string, context: CeoIntakeAssessmentContext): CeoIntakeDecision {
  const source = stdout.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? stdout.trim();
  const value = JSON.parse(source) as Record<string, unknown>;
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  if (!summary) throw new Error("summary is empty");
  const outcome = value.outcome as CeoIntakeOutcome;

  if (outcome === "context_only") return { outcome, summary };

  if (outcome === "revise_plan") {
    const targetTaskId = typeof value.targetTaskId === "string" ? value.targetTaskId : "";
    if (!context.replannableTaskIds.has(targetTaskId)) {
      throw new Error(`targetTaskId ${targetTaskId || "(none)"} is not a task that can get a new plan`);
    }
    const replanNote = typeof value.replanNote === "string" && value.replanNote.trim() ? value.replanNote.trim() : null;
    return { outcome, summary, targetTaskId, replanNote };
  }

  if (outcome !== "create_tasks") throw new Error(`unknown outcome ${String(value.outcome)}`);
  if (!Array.isArray(value.tasks) || value.tasks.length === 0) throw new Error("create_tasks needs at least one task");
  if (value.tasks.length > CEO_INTAKE_MAX_TASKS) throw new Error(`create_tasks may add at most ${CEO_INTAKE_MAX_TASKS} tasks`);

  const departmentIds = new Set(context.departments.map((department) => department.id));
  const existingTaskIds = new Set(context.tasks.filter((task) => task.status !== "cancelled").map((task) => task.id));
  const seenKeys = new Set<string>();
  const tasks = value.tasks.map((raw, index): CeoIntakePlannedTask => {
    const task = raw as Record<string, unknown>;
    const text = (field: string) => {
      const fieldValue = typeof task[field] === "string" ? (task[field] as string).trim() : "";
      if (!fieldValue) throw new Error(`tasks[${index}].${field} is empty`);
      return fieldValue;
    };
    const strings = (field: string) => (Array.isArray(task[field]) ? (task[field] as unknown[]).filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []);
    const key = text("key");
    if (seenKeys.has(key)) throw new Error(`tasks[${index}].key ${key} is repeated`);
    const departmentId = text("departmentId");
    if (!departmentIds.has(departmentId)) throw new Error(`tasks[${index}].departmentId ${departmentId} is not a department`);
    const dependsOnTaskIds = strings("dependsOnTaskIds");
    for (const id of dependsOnTaskIds) {
      if (!existingTaskIds.has(id)) throw new Error(`tasks[${index}] depends on unknown task ${id}`);
    }
    // Only earlier keys: the new tasks cannot form a cycle among themselves.
    const dependsOnTaskKeys = strings("dependsOnTaskKeys");
    for (const dependencyKey of dependsOnTaskKeys) {
      if (!seenKeys.has(dependencyKey)) throw new Error(`tasks[${index}] depends on ${dependencyKey}, which is not an earlier new task`);
    }
    const requiredCapabilities = strings("requiredCapabilities");
    if (requiredCapabilities.length === 0) throw new Error(`tasks[${index}].requiredCapabilities is empty`);
    const riskLevel = task.riskLevel === "low" || task.riskLevel === "medium" || task.riskLevel === "high" ? task.riskLevel : "medium";
    seenKeys.add(key);
    return {
      key,
      departmentId,
      title: text("title"),
      description: text("description"),
      proofSchemaId: text("proofSchemaId"),
      requiredCapabilities,
      riskLevel,
      dependsOnTaskIds,
      dependsOnTaskKeys,
      handoffContract: typeof task.handoffContract === "string" ? task.handoffContract.trim() : "",
    };
  });
  return { outcome, summary, tasks };
}

/**
 * Place the tasks an intake planned, as the blueprint places its own (ADR 0046): same workspace, proof
 * schema checks and progress marker, appended after the company's existing tasks. One transaction, so
 * a crash never leaves half a plan.
 */
export function writeCeoIntakeTasks(input: {
  projectRoot: string;
  repositories: Repositories;
  company: Company;
  context: CeoIntakeAssessmentContext;
  tasks: CeoIntakePlannedTask[];
  createdAt: string;
  createId: (prefix: string) => string;
}): Task[] {
  const { repositories, company } = input;
  const departmentsById = new Map(input.context.departments.map((department) => [department.id, department]));
  const allowedSchemas = new Set(input.context.proofSchemas.map((schema) => schema.id));
  const nextPosition = input.context.tasks.reduce((max, task) => Math.max(max, task.position), -1) + 1;
  const keyResultId = input.context.tasks.find((task) => task.keyResultId)?.keyResultId ?? null;
  const idsByKey = new Map<string, string>();
  const handoffsByKey = new Map<string, string>();
  const warnings: TaskEvent[] = [];
  const created = input.tasks.map((planned, index) => {
    const department = departmentsById.get(planned.departmentId)!;
    const proofSchemaId = allowedSchemas.has(planned.proofSchemaId) ? planned.proofSchemaId : FALLBACK_PROOF_SCHEMA_ID;
    const { task, warning } = createPlannedTask({
      projectRoot: input.projectRoot,
      company,
      repositories,
      createdAt: input.createdAt,
      createId: input.createId,
      position: nextPosition + index,
      departmentId: department.id,
      keyResultId,
      planned: {
        title: planned.title,
        description: planned.description,
        assigneeAgentId: department.leadAgentId,
        departmentKey: department.key ?? null,
        requiredCapabilities: planned.requiredCapabilities,
        proofSchemaId,
        riskLevel: planned.riskLevel,
      },
      proofSchemaNormalization: proofSchemaId === planned.proofSchemaId
        ? null
        : { taskKey: planned.key, from: planned.proofSchemaId, to: proofSchemaId, reason: "not_collectable" },
    });
    if (warning) warnings.push(warning);
    idsByKey.set(planned.key, task.id);
    handoffsByKey.set(planned.key, planned.handoffContract);
    return task;
  });
  input.tasks.forEach((planned) => {
    const taskId = idsByKey.get(planned.key)!;
    const dependencies: TaskDependency[] = [
      ...planned.dependsOnTaskIds.map((dependsOnTaskId) => ({ taskId, dependsOnTaskId, handoffContract: null })),
      ...planned.dependsOnTaskKeys.map((key) => ({ taskId, dependsOnTaskId: idsByKey.get(key)!, handoffContract: handoffsByKey.get(key) || null })),
    ];
    dependencies.forEach((dependency) => repositories.createTaskDependency(dependency));
  });
  warnings.forEach((warning) => repositories.appendTaskEvent(warning));
  return created;
}

export type RunCeoIntakeJobsInput = {
  projectRoot: string;
  repositories: Repositories;
  adapters: AgentAdapter[];
  now?: () => Date;
  createId?: (prefix: string) => string;
  /** Tells the dashboard an intake changed, so it reads the company again. */
  emit: (event: { type: "ceo_intake_updated"; companyId: string; message: string }) => void;
  /** Asks the scheduler to look at new queued tasks soon. */
  requestSchedulerWake?: () => void;
  /** Overrides how the status of a running assessment's company is checked. Tests only. */
  companyStatusPollMs?: number;
};

/**
 * Assess every intake that waits, oldest first (ADR 0046). An intake waits while its company is
 * paused, and fails when its company is stopped. One intake runs at a time: a later input may refer
 * to what an earlier one decided.
 */
export async function runCeoIntakeJobs(input: RunCeoIntakeJobsInput): Promise<void> {
  const now = input.now ?? (() => new Date());
  for (const intake of input.repositories.listReceivedCeoIntakes()) {
    const company = input.repositories.getCompany(intake.companyId);
    if (!company) continue;
    if (company.status === "stopped") {
      finish(input, intake, { status: "failed", failureReason: "company_stopped", failureMessage: "The company was stopped before this input was assessed." }, now);
      continue;
    }
    if (company.status !== "active") continue;
    await assessCeoIntake(input, intake, company, now);
  }
}

/**
 * A server restart abandons an assessment in flight. Before the first run, put such intakes back in
 * the queue, or forward to `dispatched` when what they did is already written.
 */
export function recoverInterruptedCeoIntakes(repositories: Repositories, now: () => Date = () => new Date()): void {
  for (const company of repositories.listCompanies()) {
    for (const intake of repositories.listCeoIntakesForCompany(company.id)) {
      if (intake.status === "assessing" || intake.status === "assessment_complete" || intake.status === "planning") {
        repositories.saveCeoIntakeAssessment({ ...intake, status: "received", outcome: null, outcomeSummary: null, updatedAt: now().toISOString() });
      } else if (intake.status === "planned" || intake.status === "dispatching") {
        repositories.saveCeoIntakeAssessment({ ...intake, status: "dispatched", updatedAt: now().toISOString() });
      }
    }
  }
}

async function assessCeoIntake(input: RunCeoIntakeJobsInput, intake: CeoIntake, company: Company, now: () => Date): Promise<void> {
  const { repositories } = input;
  const createId = input.createId ?? ((prefix: string) => `${prefix}_${crypto.randomUUID()}`);
  const adapter = input.adapters.find((candidate) => candidate.id === company.selectedCeoAgentId);
  if (!adapter) {
    finish(input, intake, { status: "failed", failureReason: "no_ceo_agent", failureMessage: `CEO Agent ${company.selectedCeoAgentId} is not available.` }, now);
    return;
  }

  const attempts = (intake.attempts ?? 0) + 1;
  let current: CeoIntake = { ...intake, status: "assessing", attempts, updatedAt: now().toISOString() };
  repositories.saveCeoIntakeAssessment(current);
  input.emit({ type: "ceo_intake_updated", companyId: company.id, message: "CEO is assessing founder input." });

  const playbook = selectPlaybook(company.founderVision);
  const context = resolveCeoIntakeAssessmentContext(repositories, company, playbook, input.adapters);
  const result = await runAssessment(input, adapter, company, current, context);

  // The company may have been paused or stopped while the CEO was thinking. A paused company's input
  // waits, and the attempt does not count; a stopped company takes no input (ADR 0044).
  const after = repositories.getCompany(company.id);
  if (after?.status === "stopped") {
    finish(input, current, { status: "failed", failureReason: "company_stopped", failureMessage: "The company was stopped while this input was assessed." }, now);
    return;
  }
  if (after?.status !== "active") {
    repositories.saveCeoIntakeAssessment({ ...current, status: "received", attempts: attempts - 1, updatedAt: now().toISOString() });
    input.emit({ type: "ceo_intake_updated", companyId: company.id, message: "Founder input waits until the company resumes." });
    return;
  }

  let decision: CeoIntakeDecision;
  try {
    if (result.status !== "complete") throw new AssessmentFailure("agent_failed", result.stderr.trim() || result.stdout.trim() || "The CEO Agent run did not complete.");
    try {
      decision = parseCeoIntakeOutput(result.stdout, context);
    } catch (error) {
      throw new AssessmentFailure("invalid_agent_output", `The CEO's reply did not satisfy the runtime's output contract: ${(error as Error).message}`);
    }
  } catch (error) {
    const failure = error as AssessmentFailure;
    if (attempts < CEO_INTAKE_MAX_ATTEMPTS) {
      repositories.saveCeoIntakeAssessment({ ...current, status: "received", failureReason: failure.reason, failureMessage: failure.message, updatedAt: now().toISOString() });
      return;
    }
    finish(input, current, { status: "failed", failureReason: failure.reason, failureMessage: failure.message }, now);
    return;
  }

  current = {
    ...current,
    status: "assessment_complete",
    outcome: decision.outcome,
    outcomeSummary: { [company.locale]: decision.summary },
    failureReason: null,
    failureMessage: null,
    updatedAt: now().toISOString(),
  };
  repositories.saveCeoIntakeAssessment(current);

  if (decision.outcome === "context_only") {
    finish(input, current, { status: "dispatched" }, now);
    return;
  }

  if (decision.outcome === "create_tasks") {
    repositories.transaction(() => {
      const created = writeCeoIntakeTasks({
        projectRoot: input.projectRoot,
        repositories,
        company,
        context,
        tasks: decision.tasks,
        createdAt: now().toISOString(),
        createId,
      });
      current = { ...current, status: "planned", createdTaskIds: created.map((task) => task.id), updatedAt: now().toISOString() };
      repositories.saveCeoIntakeAssessment(current);
    });
    input.requestSchedulerWake?.();
    finish(input, current, { status: "dispatched" }, now);
    return;
  }

  current = { ...current, status: "planning", targetTaskId: decision.targetTaskId, updatedAt: now().toISOString() };
  repositories.saveCeoIntakeAssessment(current);
  try {
    const proposal = await createReplanProposalForTask({
      repositories,
      taskId: decision.targetTaskId,
      mode: null,
      note: [`Founder input: ${intake.body}`, ...(decision.replanNote ? [`CEO: ${decision.replanNote}`] : [])].join("\n"),
      projectRoot: input.projectRoot,
      plannerAgent: adapter,
      playbook,
      now,
      createId,
    });
    if (proposal.status === "failed") {
      finish(input, { ...current, replanProposalId: proposal.id }, { status: "failed", failureReason: "plan_not_made", failureMessage: "The planner could not make a new plan." }, now);
      return;
    }
    finish(input, { ...current, replanProposalId: proposal.id }, { status: "dispatched" }, now);
  } catch (error) {
    if (!(error instanceof ReplanNotOfferedError)) throw error;
    // The task moved while the CEO was thinking and no longer offers a new plan.
    finish(input, current, { status: "failed", failureReason: "plan_not_made", failureMessage: error.message }, now);
  }
}

class AssessmentFailure extends Error {
  constructor(readonly reason: CeoIntakeFailureReason, message: string) {
    super(message);
  }
}

async function runAssessment(
  input: RunCeoIntakeJobsInput,
  adapter: AgentAdapter,
  company: Company,
  intake: CeoIntake,
  context: CeoIntakeAssessmentContext,
): Promise<AgentRunResult> {
  const workspace = createCompanyWorkspace(input.projectRoot, company.id);
  const prompt = buildCeoIntakePrompt(context, intake);
  const promptPath = `${workspace.companyRoot}/ceo-intake-${intake.id}.md`;
  writeFileSync(promptPath, prompt, "utf8");
  // Pausing a company stops its live runs (ADR 0044). This run is not a task run, so it watches its
  // company itself and stops when the company leaves `active`.
  const controller = new AbortController();
  const watcher = setInterval(() => {
    if (input.repositories.getCompany(company.id)?.status !== "active") controller.abort();
  }, input.companyStatusPollMs ?? COMPANY_STATUS_POLL_MS);
  try {
    return await adapter.run({
      taskId: `${company.id}_ceo_intake_${intake.id}`,
      prompt,
      promptPath,
      workspacePath: workspace.companyRoot,
      metadata: { phase: "ceo_intake", intakeId: intake.id, locale: company.locale },
      timeoutMs: resolveEffectiveTimeoutForProfileName("medium").effectiveTimeoutMs,
      // "Do not use tools" is enforced: the assessment holds none. The reply shape is a contract.
      grant: noToolGrant,
      outputSchema: ceoIntakeOutputSchema,
      signal: controller.signal,
    });
  } catch (error) {
    return { status: "failed", exitCode: null, stdout: "", stderr: (error as Error).message, failureReason: "agent_failed" };
  } finally {
    clearInterval(watcher);
  }
}

function finish(
  input: RunCeoIntakeJobsInput,
  intake: CeoIntake,
  change: Pick<CeoIntake, "status"> & Partial<Pick<CeoIntake, "failureReason" | "failureMessage">>,
  now: () => Date,
): void {
  const timestamp = now().toISOString();
  input.repositories.saveCeoIntakeAssessment({ ...intake, ...change, updatedAt: timestamp, assessedAt: timestamp });
  input.emit({
    type: "ceo_intake_updated",
    companyId: intake.companyId,
    message: change.status === "failed" ? "CEO could not assess founder input." : "CEO answered founder input.",
  });
}
