export type CompanyStatus = "draft" | "active" | "paused" | "review";
export type PermissionMode = "safe" | "balanced" | "autonomous";
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
export type TaskKind = "parent" | "department_subtask";
export type TaskSource = "ceo" | "department" | "user";
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
export type ReplanProposalStatus = "proposed" | "confirmed" | "dismissed";
export type ReplanProposalSource = "planner_agent" | "deterministic_template";
export type CeoIntakeStatus =
  | "received"
  | "assessing"
  | "assessment_complete"
  | "planning"
  | "planned"
  | "dispatching"
  | "dispatched"
  | "failed";
export type CeoReviewDecisionKind = "approve" | "return";
export type CeoReviewReturnReason = "needs_changes" | "unclear_task_definition" | "scope_too_large" | "wrong_direction";
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
  | "ceo_review_decision"
  | "proof_recovered"
  | "task_failed"
  | "task_blocked"
  | "task_warning"
  | "partial_output"
  | "dependency_waiting"
  | "dependency_ready"
  | "task_retrying"
  | "task_recovered"
  | "task_needs_replan"
  | "deliverable_missing";
export type TaskProgressStep =
  | "received"
  | "assessing"
  | "assessment_complete"
  | "splitting"
  | "split_complete"
  | "no_split_needed"
  | "executing"
  | "summarizing_proof"
  | "awaiting_review"
  | "complete"
  | "blocked"
  | "needs_ceo_reassignment";
export type TaskProgressStatus = "complete" | "current" | "waiting" | "blocked";

export type Company = {
  id: string;
  name: string;
  founderVision: string;
  selectedCeoAgentId: string;
  playbookId: string;
  permissionMode?: PermissionMode | null;
  status: CompanyStatus;
  createdAt: string;
  updatedAt: string;
};

export type CeoIntake = {
  id: string;
  companyId: string;
  body: string;
  status: CeoIntakeStatus;
  createdAt: string;
  updatedAt: string;
};

export type CeoReviewDecision = {
  id: string;
  companyId: string;
  taskId: string;
  departmentId: string;
  decision: CeoReviewDecisionKind;
  returnReason: CeoReviewReturnReason | null;
  note: string | null;
  proofId: string | null;
  proofType: ProofType | null;
  proofUri: string | null;
  actor: string;
  createdAt: string;
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
  parentTaskId?: string | null;
  taskKind?: TaskKind;
  source?: TaskSource;
};

export type TaskProgressEvent = {
  id: string;
  companyId: string;
  departmentId: string;
  parentTaskId: string;
  subjectTaskId: string | null;
  step: TaskProgressStep;
  status: TaskProgressStatus;
  label: string;
  detail: string | null;
  createdAt: string;
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
  handoffContract?: string | null;
};

export type ReplanReplacementTask = {
  title: string;
  description: string;
  requiredCapabilities: string[];
  proofSchemaId: string;
  riskLevel: RiskLevel;
};

export type ReplanProposal = {
  id: string;
  companyId: string;
  sourceTaskId: string;
  status: ReplanProposalStatus;
  proposalSource: ReplanProposalSource;
  plannerAgentId: string | null;
  plannerPromptPath: string | null;
  plannerFailureReason: string | null;
  plannerFailureMessage: string | null;
  rationale: string;
  replacementTasks: ReplanReplacementTask[];
  createdAt: string;
  confirmedAt: string | null;
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
  key: string;
  departmentName: string;
  title: string;
  description: string;
  assigneeAgentId: string;
  requiredCapabilities: string[];
  proofSchemaId: string;
  riskLevel: RiskLevel;
  dependsOnTaskKeys: string[];
  handoffContract: string;
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
