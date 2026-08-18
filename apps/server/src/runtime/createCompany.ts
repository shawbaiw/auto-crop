import { writeFileSync } from "node:fs";
import type { Company, Department, KeyResult, Objective, Task } from "@auto-crop/core";
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
    throw new Error(`CEO agent failed to create company blueprint: ${agentResult.stderr}`);
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
  const tasks = ceoResponse.blueprint.tasks.map((taskBlueprint) => {
    const departmentId = departmentIdsByName.get(taskBlueprint.departmentName);

    if (!departmentId) {
      throw new Error(`Task references unknown department after parse: ${taskBlueprint.departmentName}`);
    }

    const taskId = createId("task");
    const taskWorkspace = createTaskWorkspace(input.projectRoot, taskId);
    const task: Task = {
      id: taskId,
      companyId: company.id,
      departmentId,
      keyResultId: firstKeyResultId,
      title: taskBlueprint.title,
      description: taskBlueprint.description,
      assigneeAgentId: taskBlueprint.assigneeAgentId,
      requiredCapabilities: taskBlueprint.requiredCapabilities,
      proofSchemaId: taskBlueprint.proofSchemaId,
      workspacePath: taskWorkspace.root,
      status: "queued",
      riskLevel: taskBlueprint.riskLevel,
    };
    input.repositories.createTask(task);
    return task;
  });

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
