export type CompanyStatus = "draft" | "active" | "paused" | "review";
export type ObjectiveStatus = "active" | "complete" | "paused";
export type KeyResultStatus = "active" | "met" | "missed";
export type TaskStatus =
  | "queued"
  | "waiting_dependency"
  | "running"
  | "retrying"
  | "blocked"
  | "review"
  | "complete"
  | "needs_replan"
  | "failed"
  | "cancelled";
export type RiskLevel = "low" | "medium" | "high";
export type ProofType =
  | "file"
  | "diff"
  | "url"
  | "screenshot"
  | "command_output"
  | "test_result"
  | "deployment";
export type AgentRunStatus = "queued" | "running" | "complete" | "failed" | "cancelled";
export type ApprovalStatus = "pending" | "approved" | "denied";
export type AgentFailureReason =
  | "timeout"
  | "agent_failed"
  | "no_proof"
  | "proof_capture_failed"
  | "dependency_failed"
  | "missing_deliverable"
  | "retry_exhausted"
  | "needs_replan"
  | "rate_limited";
export type TaskEventType =
  | "task_started"
  | "task_review"
  | "task_failed"
  | "task_blocked"
  | "task_warning"
  | "partial_output"
  | "dependency_waiting"
  | "dependency_ready"
  | "task_retrying"
  | "task_needs_replan"
  | "deliverable_missing";

export type Company = {
  id: string;
  name: string;
  founderVision: string;
  selectedCeoAgentId: string;
  playbookId: string;
  status: CompanyStatus;
  createdAt: string;
  updatedAt: string;
};

export type Department = {
  id: string;
  companyId: string;
  name: string;
  responsibility: string;
  leadAgentId: string;
  memoryPath: string;
};

export type Objective = {
  id: string;
  companyId: string;
  title: string;
  status: ObjectiveStatus;
  priority: number;
};

export type KeyResult = {
  id: string;
  objectiveId: string;
  title: string;
  metricName: string;
  targetValue: string;
  currentValue: string;
  status: KeyResultStatus;
};

export type Task = {
  id: string;
  companyId: string;
  departmentId: string;
  keyResultId: string | null;
  position: number;
  title: string;
  description: string;
  assigneeAgentId: string;
  requiredCapabilities: string[];
  proofSchemaId: string;
  workspacePath: string | null;
  artifactWorkspacePath?: string | null;
  status: TaskStatus;
  riskLevel: RiskLevel;
  latestFailureReason?: AgentFailureReason | null;
  latestFailureMessage?: string | null;
  latestExecutionProfileName?: string | null;
  latestRequestedTimeoutMs?: number | null;
  latestEffectiveTimeoutMs?: number | null;
  dependencyNote?: string | null;
};

export type Proof = {
  id: string;
  taskId: string;
  type: ProofType;
  uri: string;
  summary: string;
  verifiedAt: string | null;
};

export type AgentRun = {
  id: string;
  taskId: string;
  agentId: string;
  status: AgentRunStatus;
  logPath: string;
  startedAt: string | null;
  finishedAt: string | null;
  executionProfileName?: string | null;
  requestedTimeoutMs?: number | null;
  effectiveTimeoutMs?: number | null;
  failureReason?: AgentFailureReason | null;
  failureMessage?: string | null;
};

export type TaskDependency = {
  taskId: string;
  dependsOnTaskId: string;
};

export type TaskEvent = {
  id: string;
  companyId: string;
  taskId: string;
  type: TaskEventType;
  message: string;
  createdAt: string;
  status: TaskStatus | null;
  failureReason: AgentFailureReason | null;
  failureMessage: string | null;
  executionProfileName: string | null;
  requestedTimeoutMs: number | null;
  effectiveTimeoutMs: number | null;
  dependencyNote: string | null;
  artifactWorkspacePath: string | null;
};

export type Approval = {
  id: string;
  companyId: string;
  taskId: string | null;
  actionType: string;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  requestedAt: string;
};

export type ProofSchema = {
  id: string;
  description: string;
  acceptedTypes: ProofType[];
};

export type BlueprintTask = {
  departmentName: string;
  title: string;
  description: string;
  assigneeAgentId: string;
  requiredCapabilities: string[];
  proofSchemaId: string;
  riskLevel: RiskLevel;
};

export type CompanyBlueprint = {
  company: {
    name: string;
    founderVision: string;
    playbookId: string;
  };
  departments: Array<{
    name: string;
    responsibility: string;
    leadAgentId: string;
  }>;
  objectives: Array<{
    title: string;
    priority: number;
    keyResults: Array<{
      title: string;
      metricName: string;
      targetValue: string;
      currentValue: string;
    }>;
  }>;
  proofSchemas: ProofSchema[];
  tasks: BlueprintTask[];
};

export type CeoResponse = {
  brief: string;
  blueprint: CompanyBlueprint;
};
