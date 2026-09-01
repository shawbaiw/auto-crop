import type { CompanyBlueprint, CompleteLocalizedText, ProofSchema } from "@auto-crop/core";

export type DepartmentTemplate = {
  key: string;
  name: string;
  nameText: CompleteLocalizedText;
  responsibility: string;
  responsibilityText: CompleteLocalizedText;
  defaultLeadCapability: string;
};

export type OkrTemplate = {
  objectiveTitle: string;
  objectiveTitleText: CompleteLocalizedText;
  priority: number;
  keyResults: Array<{
    title: string;
    titleText: CompleteLocalizedText;
    metricName: string;
    targetValue: string;
    targetValueText: CompleteLocalizedText;
    currentValue: string;
    currentValueText: CompleteLocalizedText;
  }>;
};

export type TaskTemplate = {
  key: string;
  departmentKey: string;
  departmentName: string;
  title: string;
  titleText: CompleteLocalizedText;
  description: string;
  descriptionText: CompleteLocalizedText;
  requiredCapabilities: string[];
  proofSchemaId: string;
  riskLevel: "low" | "medium" | "high";
  dependsOnTaskKeys: string[];
  handoffContract: string;
  handoffContractText: CompleteLocalizedText;
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
  reviewCriteriaText: CompleteLocalizedText[];
  createBlueprint(input: CreateBlueprintInput): CompanyBlueprint;
};
