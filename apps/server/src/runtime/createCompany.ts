import { writeFileSync } from "node:fs";
import type {
  BlueprintTask,
  Company,
  CompanyBlueprint,
  Department,
  KeyResult,
  Objective,
  Task,
  TaskDependency,
  TaskEvent,
} from "@auto-crop/core";
import type { AgentAdapter } from "../adapters/types";
import type { createRepositories } from "../db/repositories";
import type { PolicyMode } from "../policies/policy";
import { defaultAgentSessionManager, type AgentSessionManager } from "./agentSessions";
import { buildCeoPrompt } from "./ceoPrompt";
import { parseCeoOutput } from "./ceoParser";
import { receivedCeoTaskText } from "./localizedRuntimeText";
import { resolveAgentSessionPolicy } from "./sessionPolicy";
import { createCompanyWorkspace, createDepartmentWorkspace, createTaskWorkspace } from "./workspace";
import { selectPlaybook } from "../playbooks/selectPlaybook";

export type CreateCompanyInput = {
  projectRoot: string;
  companyName: string;
  founderVision: string;
  selectedCeoAgent: AgentAdapter;
  availableAgents: AgentAdapter[];
  permissionMode: PolicyMode;
  assets: string[];
  repositories: ReturnType<typeof createRepositories>;
  agentSessionManager?: AgentSessionManager;
  agentSessionEnv?: Record<string, string | undefined>;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export type CreateCompanyResult = {
  company: Company;
  departments: Department[];
  objectives: Objective[];
  keyResults: KeyResult[];
  tasks: Task[];
};

export type WriteCompanyBlueprintRecordsInput = {
  projectRoot: string;
  company: Company;
  blueprint: CompanyBlueprint;
  repositories: ReturnType<typeof createRepositories>;
  createdAt: string;
  createId?: (prefix: string) => string;
};

export type GenerateCompanyBlueprintInput = {
  projectRoot: string;
  companyId: string;
  companyName: string;
  founderVision: string;
  selectedCeoAgent: AgentAdapter;
  availableAgents: AgentAdapter[];
  permissionMode: PolicyMode;
  assets: string[];
  agentSessionManager?: AgentSessionManager;
  agentSessionEnv?: Record<string, string | undefined>;
};

export type GenerateCompanyBlueprintResult = {
  blueprint: CompanyBlueprint;
  promptPath: string;
};

export async function createCompany(input: CreateCompanyInput): Promise<CreateCompanyResult> {
  const companyName = input.companyName.trim();

  if (!companyName) {
    throw new Error("Company name is required.");
  }

  const now = (input.now ?? (() => new Date()))().toISOString();
  const createId = input.createId ?? defaultCreateId;
  const companyId = createId("company");
  const blueprintResult = await generateCompanyBlueprint({
    projectRoot: input.projectRoot,
    companyId,
    companyName,
    founderVision: input.founderVision,
    selectedCeoAgent: input.selectedCeoAgent,
    availableAgents: input.availableAgents,
    permissionMode: input.permissionMode,
    assets: input.assets,
    agentSessionManager: input.agentSessionManager,
    agentSessionEnv: input.agentSessionEnv,
  });
  const company: Company = {
    id: companyId,
    name: companyName,
    founderVision: blueprintResult.blueprint.company.founderVision,
    selectedCeoAgentId: input.selectedCeoAgent.id,
    playbookId: blueprintResult.blueprint.company.playbookId,
    permissionMode: input.permissionMode,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };

  input.repositories.createCompany(company);

  return writeCompanyBlueprintRecords({
    projectRoot: input.projectRoot,
    company,
    blueprint: blueprintResult.blueprint,
    repositories: input.repositories,
    createdAt: now,
    createId,
  });
}

export async function generateCompanyBlueprint(input: GenerateCompanyBlueprintInput): Promise<GenerateCompanyBlueprintResult> {
  const playbook = selectPlaybook(input.founderVision);
  const companyWorkspace = createCompanyWorkspace(input.projectRoot, input.companyId);
  const prompt = buildCeoPrompt({
    companyName: input.companyName,
    founderVision: input.founderVision,
    playbook,
    availableAgents: input.availableAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      capabilities: agent.capabilities,
    })),
    permissionMode: input.permissionMode,
    assets: input.assets,
  });
  const promptPath = `${companyWorkspace.companyRoot}/ceo-prompt.md`;
  writeFileSync(promptPath, prompt, "utf8");

  const agentRequest = {
    taskId: `${input.companyId}_ceo_blueprint`,
    prompt,
    promptPath,
    workspacePath: companyWorkspace.companyRoot,
    metadata: {
      playbookId: playbook.id,
      permissionMode: input.permissionMode,
    },
  };
  const sessionPolicy = resolveAgentSessionPolicy({
    companyId: input.companyId,
    agentId: input.selectedCeoAgent.id,
    permissionMode: input.permissionMode,
    purpose: "ceo_blueprint",
    env: input.agentSessionEnv,
  });
  const agentRun = await (input.agentSessionManager ?? defaultAgentSessionManager).run({
    adapter: input.selectedCeoAgent,
    request: agentRequest,
    sessionKey: sessionPolicy.status === "enabled" ? sessionPolicy.key : null,
  });
  const agentResult = agentRun.result;

  if (agentResult.status !== "complete") {
    const failureDetail = agentResult.stderr.trim() || agentResult.stdout.trim() || "No agent output.";
    throw new Error(`CEO agent failed to create company blueprint: ${failureDetail}`);
  }

  return {
    blueprint: parseCeoOutput(agentResult.stdout, playbook).blueprint,
    promptPath,
  };
}

export function writeCompanyBlueprintRecords(input: WriteCompanyBlueprintRecordsInput): CreateCompanyResult {
  const createId = input.createId ?? defaultCreateId;
  const { company, repositories } = input;

  const departments = input.blueprint.departments.map((departmentBlueprint) => {
    const departmentId = createId("department");
    const departmentWorkspace = createDepartmentWorkspace(
      input.projectRoot,
      company.id,
      slugify(departmentBlueprint.key ?? departmentBlueprint.name),
    );
    const department: Department = {
      id: departmentId,
      companyId: company.id,
      key: departmentBlueprint.key ?? null,
      name: departmentBlueprint.name,
      nameText: departmentBlueprint.nameText ?? null,
      responsibility: departmentBlueprint.responsibility,
      responsibilityText: departmentBlueprint.responsibilityText ?? null,
      leadAgentId: departmentBlueprint.leadAgentId,
      memoryPath: departmentWorkspace.memoryPath,
    };
    repositories.createDepartment(department);
    return department;
  });
  const departmentIdsByName = new Map(departments.map((department) => [department.name, department.id]));
  const departmentIdsByKey = new Map(
    departments.flatMap((department) => (department.key ? [[department.key, department.id] as const] : [])),
  );

  const objectives: Objective[] = [];
  const keyResults: KeyResult[] = [];

  for (const objectiveBlueprint of input.blueprint.objectives) {
    const objective: Objective = {
      id: createId("objective"),
      companyId: company.id,
      title: objectiveBlueprint.title,
      titleText: objectiveBlueprint.titleText ?? null,
      status: "active",
      priority: objectiveBlueprint.priority,
    };
    repositories.createObjective(objective);
    objectives.push(objective);

    for (const keyResultBlueprint of objectiveBlueprint.keyResults) {
      const keyResult: KeyResult = {
        id: createId("key_result"),
        objectiveId: objective.id,
        title: keyResultBlueprint.title,
        titleText: keyResultBlueprint.titleText ?? null,
        metricName: keyResultBlueprint.metricName,
        targetValue: keyResultBlueprint.targetValue,
        targetValueText: keyResultBlueprint.targetValueText ?? null,
        currentValue: keyResultBlueprint.currentValue,
        currentValueText: keyResultBlueprint.currentValueText ?? null,
        status: "active",
      };
      repositories.createKeyResult(keyResult);
      keyResults.push(keyResult);
    }
  }

  const firstKeyResultId = keyResults[0]?.id ?? null;
  const taskWarnings: TaskEvent[] = [];
  const taskIdsByBlueprintKey = new Map<string, string>();
  const handoffContractsByBlueprintKey = new Map<string, string>();
  const handoffContractTextsByBlueprintKey = new Map<string, BlueprintTask["handoffContractText"]>();
  const tasks = input.blueprint.tasks.map((taskBlueprint, position) => {
    const departmentId = taskBlueprint.departmentKey
      ? departmentIdsByKey.get(taskBlueprint.departmentKey)
      : departmentIdsByName.get(taskBlueprint.departmentName);

    if (!departmentId) {
      throw new Error(`Task references unknown department after parse: ${taskBlueprint.departmentKey ?? taskBlueprint.departmentName}`);
    }

    const taskId = createId("task");
    const taskWorkspace = createTaskWorkspace(input.projectRoot, taskId);
    const schemaDecision = applyProofSchemaSanity(taskBlueprint);
    const task: Task = {
      id: taskId,
      companyId: company.id,
      departmentId,
      departmentKey: taskBlueprint.departmentKey ?? null,
      keyResultId: firstKeyResultId,
      title: taskBlueprint.title,
      titleText: taskBlueprint.titleText ?? null,
      description: withPrototypeGuidance(taskBlueprint.description, schemaDecision.proofSchemaId),
      descriptionText: taskBlueprint.descriptionText ?? null,
      assigneeAgentId: taskBlueprint.assigneeAgentId,
      requiredCapabilities: taskBlueprint.requiredCapabilities,
      proofSchemaId: schemaDecision.proofSchemaId,
      workspacePath: taskWorkspace.root,
      artifactWorkspacePath: isArtifactProducer(schemaDecision.proofSchemaId) ? taskWorkspace.root : null,
      status: "queued",
      riskLevel: taskBlueprint.riskLevel,
      position,
      latestFailureReason: null,
      latestFailureMessage: null,
      latestExecutionProfileName: null,
      latestRequestedTimeoutMs: null,
      latestEffectiveTimeoutMs: null,
      dependencyNote: null,
      parentTaskId: null,
      taskKind: "parent",
      source: "ceo",
    };
    repositories.createTask(task);
    repositories.appendTaskProgressEvent({
      id: createId("task_progress"),
      companyId: company.id,
      departmentId,
      parentTaskId: task.id,
      subjectTaskId: null,
      step: "received",
      status: "complete",
      label: "Received CEO task",
      labelText: receivedCeoTaskText(),
      detail: null,
      createdAt: input.createdAt,
    });
    taskIdsByBlueprintKey.set(taskBlueprint.key, task.id);
    handoffContractsByBlueprintKey.set(taskBlueprint.key, taskBlueprint.handoffContract);
    handoffContractTextsByBlueprintKey.set(taskBlueprint.key, taskBlueprint.handoffContractText);
    if (schemaDecision.warning) {
      taskWarnings.push({
        id: createId("task_event"),
        companyId: company.id,
        taskId: task.id,
        type: "task_warning",
        message: schemaDecision.warning,
        createdAt: input.createdAt,
        status: task.status,
        failureReason: null,
        failureMessage: null,
        executionProfileName: null,
        requestedTimeoutMs: null,
        effectiveTimeoutMs: null,
        dependencyNote: null,
        artifactWorkspacePath: task.artifactWorkspacePath ?? null,
      });
    }
    return task;
  });

  createBlueprintDependencies(
    input.blueprint.tasks,
    taskIdsByBlueprintKey,
    handoffContractsByBlueprintKey,
    handoffContractTextsByBlueprintKey,
  ).forEach((dependency) => repositories.createTaskDependency(dependency));
  inferValidationDependencies(tasks).forEach((dependency) => repositories.createTaskDependency(dependency));
  taskWarnings.forEach((warning) => repositories.appendTaskEvent(warning));

  return {
    company,
    departments,
    objectives,
    keyResults,
    tasks,
  };
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

type TaskBlueprintLike = {
  title: string;
  description: string;
  requiredCapabilities: string[];
  proofSchemaId: string;
};

function applyProofSchemaSanity(task: TaskBlueprintLike): { proofSchemaId: string; warning: string | null } {
  const expected = expectedProofSchema(task);

  if (!expected || isProofSchemaCompatible(task.proofSchemaId, expected)) {
    return { proofSchemaId: task.proofSchemaId, warning: null };
  }

  return {
    proofSchemaId: expected,
    warning: `Task warning: ${task.title} proof schema changed from ${task.proofSchemaId} to ${expected}.`,
  };
}

function expectedProofSchema(task: TaskBlueprintLike): string | null {
  const title = task.title.toLowerCase();
  const description = task.description.toLowerCase();
  const text = `${title} ${description}`;
  const capabilities = new Set(task.requiredCapabilities.map((capability) => capability.toLowerCase()));

  if (hasValidationIntent(title, capabilities)) {
    return "test-output";
  }

  if (hasImplementationIntent(title, capabilities)) {
    return "landing-page-file";
  }

  if (hasResearchIntent(title, capabilities)) {
    return "research-report";
  }

  if (hasBriefIntent(title, description, capabilities)) {
    return "product-brief";
  }

  return expectedProofSchemaFromFallbackText(text);
}

function hasValidationIntent(title: string, capabilities: Set<string>): boolean {
  return (
    /\b(validate|validation|test|check|screenshot|local url|local-url)\b/.test(title) &&
    (capabilities.has("test") || capabilities.has("frontend") || capabilities.has("code"))
  );
}

function hasImplementationIntent(title: string, capabilities: Set<string>): boolean {
  const hasImplementationCapability = capabilities.has("code") || capabilities.has("frontend");

  return hasImplementationCapability && (
    /\b(build|implement|ship|prototype|playable)\b/.test(title) ||
    /\blanding[- ]page\b/.test(title) ||
    /\brunnable\b/.test(title)
  );
}

function hasResearchIntent(title: string, capabilities: Set<string>): boolean {
  if (capabilities.has("research") && /\b(research|find|identify|analyze|analyse|evaluate|scan)\b/.test(title)) {
    return true;
  }

  return /\b(research|competitor|customer pain)\b/.test(title) && !/\bwrite|draft|define\b/.test(title);
}

function hasBriefIntent(title: string, description: string, capabilities: Set<string>): boolean {
  const hasBriefCapability = capabilities.has("writing") || capabilities.has("growth") || capabilities.has("research");

  if (hasBriefCapability && /\b(write|draft|define|plan|brief|spec|copy|assets|launch)\b/.test(title)) {
    return true;
  }

  return (
    !capabilities.has("code") &&
    /\b(copy|plan|brief|assets|launch)\b/.test(`${title} ${description}`)
  );
}

function expectedProofSchemaFromFallbackText(text: string): string | null {
  if (/\b(validate|test|check|screenshot|local url|local-url)\b/.test(text)) {
    return "test-output";
  }

  if (/\b(build|implement|ship|prototype|playable|landing-page)\b/.test(text) || /\blanding page\b/.test(text)) {
    return "landing-page-file";
  }

  if (/\b(research|competitor|customer pain)\b/.test(text)) {
    return "research-report";
  }

  if (/\b(copy|plan|brief|assets|launch)\b/.test(text)) {
    return "product-brief";
  }

  return null;
}

function isProofSchemaCompatible(actual: string, expected: string): boolean {
  if (actual === expected) {
    return true;
  }

  if (expected === "test-output") {
    return actual === "local-url" || actual === "screenshot";
  }

  if (expected === "landing-page-file") {
    return actual === "repo-diff";
  }

  return false;
}

function withPrototypeGuidance(description: string, proofSchemaId: string): string {
  if (!isArtifactProducer(proofSchemaId)) {
    return description;
  }

  const guidance = [
    "Prototype guidance: prefer a fast, inspectable browser artifact such as static index.html, src/main.tsx, src/App.tsx, or app/page.tsx. Prefer built-in browser APIs and small local code over installing large scaffolds. Do not initialize Sites, Vinext, or Next unless deployment is explicitly required or an existing .openai/hosting.json requires it. Leave a clear entry file for proof collection.",
  ];

  if (proofSchemaId === "repo-diff") {
    guidance.push(
      "Repo diff proof guidance: leave registerable diff proof at `.auto-crop-proof/<task-id>.diff` or as a top-level workspace `.diff`/`.patch` file. Files under `.auto-crop/` are not diff proof.",
    );
  }

  return [
    description,
    "",
    ...guidance,
  ].join("\n");
}

function isArtifactProducer(proofSchemaId: string): boolean {
  return proofSchemaId === "landing-page-file" || proofSchemaId === "repo-diff";
}

function isValidationTask(task: Task): boolean {
  return task.proofSchemaId === "test-output" || task.proofSchemaId === "local-url" || task.proofSchemaId === "screenshot";
}

function createBlueprintDependencies(
  taskBlueprints: BlueprintTask[],
  taskIdsByBlueprintKey: Map<string, string>,
  handoffContractsByBlueprintKey: Map<string, string>,
  handoffContractTextsByBlueprintKey: Map<string, BlueprintTask["handoffContractText"]>,
): TaskDependency[] {
  return taskBlueprints.flatMap((taskBlueprint) => {
    const taskId = taskIdsByBlueprintKey.get(taskBlueprint.key);

    if (!taskId) {
      throw new Error(`Task references unknown key after parse: ${taskBlueprint.key}`);
    }

    return taskBlueprint.dependsOnTaskKeys.map((dependencyKey) => {
      const dependsOnTaskId = taskIdsByBlueprintKey.get(dependencyKey);

      if (!dependsOnTaskId) {
        throw new Error(`Task references unknown dependency key after parse: ${dependencyKey}`);
      }

      return {
        taskId,
        dependsOnTaskId,
        handoffContract: handoffContractsByBlueprintKey.get(dependencyKey) ?? null,
        handoffContractText: handoffContractTextsByBlueprintKey.get(dependencyKey) ?? null,
      };
    });
  });
}

function inferValidationDependencies(tasks: Task[]): TaskDependency[] {
  return tasks.flatMap((task, index) => {
    if (!isValidationTask(task)) {
      return [];
    }

    const producer = [...tasks.slice(0, index)].reverse().find((candidate) => isArtifactProducer(candidate.proofSchemaId));

    return producer ? [{ taskId: task.id, dependsOnTaskId: producer.id }] : [];
  });
}
