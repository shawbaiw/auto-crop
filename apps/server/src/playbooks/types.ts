import type { CompanyBlueprint, ProofSchema } from "@auto-crop/core";

export type DepartmentTemplate = {
  name: string;
  responsibility: string;
  defaultLeadCapability: string;
};

export type OkrTemplate = {
  objectiveTitle: string;
  priority: number;
  keyResults: Array<{
    title: string;
    metricName: string;
    targetValue: string;
    currentValue: string;
  }>;
};

export type TaskTemplate = {
  departmentName: string;
  title: string;
  description: string;
  requiredCapabilities: string[];
  proofSchemaId: string;
  riskLevel: "low" | "medium" | "high";
};

export type CreateBlueprintInput = {
  companyName: string;
  founderVision: string;
  preferredEngineeringAgentId: string;
  preferredStrategyAgentId: string;
};

export type Playbook = {
  id: string;
  name: string;
  suitableFor: string[];
  defaultDepartments: DepartmentTemplate[];
  okrTemplates: OkrTemplate[];
  taskTemplates: TaskTemplate[];
  proofSchemas: ProofSchema[];
  reviewCriteria: string[];
  createBlueprint(input: CreateBlueprintInput): CompanyBlueprint;
};
