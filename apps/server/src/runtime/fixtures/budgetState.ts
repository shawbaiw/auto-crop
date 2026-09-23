import { join } from "node:path";
import type { Company, Department, KeyResult, Objective, Task } from "@auto-crop/core";
import { createDatabaseClient } from "../../db/client";
import { createRepositories } from "../../db/repositories";
import { migrate } from "../../db/schema";

export function openState(projectRoot: string) {
  const client = createDatabaseClient(join(projectRoot, ".auto-crop", "state.sqlite"));
  migrate(client);
  const repositories = createRepositories(client);
  repositories.createCompany({
    id: "company_1", name: "Pricing Page Studio", founderVision: "Build an AI SaaS.", locale: "en",
    selectedCeoAgentId: "codex", playbookId: "ai-saas", status: "active",
    createdAt: "2026-09-21T00:00:00.000Z", updatedAt: "2026-09-21T00:00:00.000Z",
  } satisfies Company);
  repositories.createDepartment({
    id: "department_1", companyId: "company_1", name: "Engineering",
    responsibility: "Build prototypes.", leadAgentId: "codex", memoryPath: "memory.md",
  } satisfies Department);
  repositories.createObjective({
    id: "objective_1", companyId: "company_1", title: "Validate", status: "active", priority: 1,
  } satisfies Objective);
  repositories.createKeyResult({
    id: "key_result_1", objectiveId: "objective_1", title: "Ship", metricName: "proof_status",
    targetValue: "proof_received", currentValue: "not_started", status: "active",
  } satisfies KeyResult);
  repositories.createTask({
    id: "task_1", companyId: "company_1", departmentId: "department_1", keyResultId: "key_result_1",
    title: "Record implementation changes", description: "Record implementation changes.",
    assigneeAgentId: "codex", requiredCapabilities: ["code"], proofSchemaId: "repo-diff",
    workspacePath: join(projectRoot, ".auto-crop", "workspaces", "task_1"), status: "queued", riskLevel: "medium", position: 0,
  } satisfies Task);
  return { repositories, client };
}

