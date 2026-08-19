import { writeFileSync } from "node:fs";
import type { Company, Department, KeyResult, Objective, Task, TaskEvent } from "@auto-crop/core";
import type { AgentAdapter } from "../adapters/types";
import type { createRepositories } from "../db/repositories";
import type { PolicyMode } from "../policies/policy";
import { buildCeoPrompt } from "./ceoPrompt";
import { parseCeoOutput } from "./ceoParser";
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
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export type CreateCompanyResult = {
  company: Company;
  departments: Department[];
  objectives: Objective[];
  keyResults: KeyResult[];
  tasks: Task[];
  editable: {
    companyName: string;
    objectives: string[];
    firstTasks: string[];
  };
};

export async function createCompany(input: CreateCompanyInput): Promise<CreateCompanyResult> {
  const companyName = input.companyName.trim();

  if (!companyName) {
    throw new Error("Company name is required.");
  }

  const now = (input.now ?? (() => new Date()))().toISOString();
  const createId = input.createId ?? defaultCreateId;
  const playbook = selectPlaybook(input.founderVision);
  const companyId = createId("company");
  const companyWorkspace = createCompanyWorkspace(input.projectRoot, companyId);
  const prompt = buildCeoPrompt({
    companyName,
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

  const agentResult = await input.selectedCeoAgent.run({
    taskId: `${companyId}_ceo_blueprint`,
    prompt,
    promptPath,
    workspacePath: companyWorkspace.companyRoot,
    metadata: {
      playbookId: playbook.id,
      permissionMode: input.permissionMode,
    },
  });

  if (agentResult.status !== "complete") {
    const failureDetail = agentResult.stderr.trim() || agentResult.stdout.trim() || "No agent output.";
    throw new Error(`CEO agent failed to create company blueprint: ${failureDetail}`);
  }

  const ceoResponse = parseCeoOutput(agentResult.stdout, playbook);
  const company: Company = {
    id: companyId,
    name: companyName,
    founderVision: ceoResponse.blueprint.company.founderVision,
    selectedCeoAgentId: input.selectedCeoAgent.id,
    playbookId: ceoResponse.blueprint.company.playbookId,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };

  input.repositories.createCompany(company);

  const departments = ceoResponse.blueprint.departments.map((departmentBlueprint) => {
    const departmentId = createId("department");
    const departmentWorkspace = createDepartmentWorkspace(
      input.projectRoot,
      company.id,
      slugify(departmentBlueprint.name),
    );
    const department: Department = {
      id: departmentId,
      companyId: company.id,
      name: departmentBlueprint.name,
      responsibility: departmentBlueprint.responsibility,
      leadAgentId: departmentBlueprint.leadAgentId,
      memoryPath: departmentWorkspace.memoryPath,
    };
    input.repositories.createDepartment(department);
    return department;
  });
  const departmentIdsByName = new Map(departments.map((department) => [department.name, department.id]));

  const objectives: Objective[] = [];
  const keyResults: KeyResult[] = [];

  for (const objectiveBlueprint of ceoResponse.blueprint.objectives) {
    const objective: Objective = {
      id: createId("objective"),
      companyId: company.id,
      title: objectiveBlueprint.title,
      status: "active",
      priority: objectiveBlueprint.priority,
    };
    input.repositories.createObjective(objective);
    objectives.push(objective);

    for (const keyResultBlueprint of objectiveBlueprint.keyResults) {
      const keyResult: KeyResult = {
        id: createId("key_result"),
        objectiveId: objective.id,
        title: keyResultBlueprint.title,
        metricName: keyResultBlueprint.metricName,
        targetValue: keyResultBlueprint.targetValue,
        currentValue: keyResultBlueprint.currentValue,
        status: "active",
      };
      input.repositories.createKeyResult(keyResult);
      keyResults.push(keyResult);
    }
  }

  const firstKeyResultId = keyResults[0]?.id ?? null;
  const taskWarnings: TaskEvent[] = [];
  const tasks = ceoResponse.blueprint.tasks.map((taskBlueprint, position) => {
    const departmentId = departmentIdsByName.get(taskBlueprint.departmentName);

    if (!departmentId) {
      throw new Error(`Task references unknown department after parse: ${taskBlueprint.departmentName}`);
    }

    const taskId = createId("task");
    const taskWorkspace = createTaskWorkspace(input.projectRoot, taskId);
    const schemaDecision = applyProofSchemaSanity(taskBlueprint);
    const task: Task = {
      id: taskId,
      companyId: company.id,
      departmentId,
      keyResultId: firstKeyResultId,
      title: taskBlueprint.title,
      description: withPrototypeGuidance(taskBlueprint.description, schemaDecision.proofSchemaId),
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
    };
    input.repositories.createTask(task);
    if (schemaDecision.warning) {
      taskWarnings.push({
        id: createId("task_event"),
        companyId: company.id,
        taskId: task.id,
        type: "task_warning",
        message: schemaDecision.warning,
        createdAt: now,
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

  inferValidationDependencies(tasks).forEach((dependency) => input.repositories.createTaskDependency(dependency));
  taskWarnings.forEach((warning) => input.repositories.appendTaskEvent(warning));

  return {
    company,
    departments,
    objectives,
    keyResults,
    tasks,
    editable: {
      companyName: company.name,
      objectives: objectives.map((objective) => objective.title),
      firstTasks: tasks.map((task) => task.title),
    },
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
  const text = `${task.title} ${task.description}`.toLowerCase();

  if (/\b(validate|test|check|screenshot|local url|local-url)\b/.test(text)) {
    return "test-output";
  }

  if (/\b(research|competitor|customer pain)\b/.test(text)) {
    return "research-report";
  }

  if (/\b(copy|plan|brief|assets|launch)\b/.test(text)) {
    return "product-brief";
  }

  if (/\b(build|prototype|playable|landing-page)\b/.test(text) || /\blanding page\b/.test(text)) {
    return "landing-page-file";
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

  return [
    description,
    "",
    "Prototype guidance: prefer a fast, inspectable browser artifact such as static index.html, src/main.tsx, src/App.tsx, or app/page.tsx. Prefer built-in browser APIs and small local code over installing large scaffolds. Do not initialize Sites, Vinext, or Next unless deployment is explicitly required or an existing .openai/hosting.json requires it. Leave a clear entry file for proof collection.",
  ].join("\n");
}

function isArtifactProducer(proofSchemaId: string): boolean {
  return proofSchemaId === "landing-page-file" || proofSchemaId === "repo-diff";
}

function isValidationTask(task: Task): boolean {
  return task.proofSchemaId === "test-output" || task.proofSchemaId === "local-url" || task.proofSchemaId === "screenshot";
}

function inferValidationDependencies(tasks: Task[]) {
  return tasks.flatMap((task, index) => {
    if (!isValidationTask(task)) {
      return [];
    }

    const producer = [...tasks.slice(0, index)].reverse().find((candidate) => isArtifactProducer(candidate.proofSchemaId));

    return producer ? [{ taskId: task.id, dependsOnTaskId: producer.id }] : [];
  });
}
