import type {
  CeoAttentionRollup,
  CEOOfficeItem,
  FinalFounderReportClassification,
  FinalFounderReportGeneratedBy,
  FounderDecision,
  HumanAction,
  NextStepItem,
  VisionGap,
  WaitState,
} from "@auto-crop/core";

export type { FinalFounderReportClassification } from "@auto-crop/core";

export type AgentSummary = {
  id: string;
  name: string;
  capabilities: string[];
  detected: boolean;
};

export type Locale = "en" | "zh";
export type LocalizedText = Partial<Record<Locale, string>>;
export type CompleteLocalizedText = Record<Locale, string>;

export type CompanySummary = {
  id: string;
  name: string;
  nameText?: CompleteLocalizedText;
  status: string;
  playbookId: string;
  founderVision?: string;
  /** The canonical language the company's generated founder-facing content is authored in. */
  locale?: Locale;
  selectedCeoAgentId?: string;
  permissionMode?: string;
};

export type CompanyOperationResponse = {
  company: CompanySummary;
  /** Tasks whose live run was asked to stop; each settles when its process exits. */
  interruptedTasks: string[];
  /** Tasks recorded as running that this server cannot reach. */
  unreachableTasks: string[];
};

export type CompanyListItem = CompanySummary & {
  createdAt: string;
  updatedAt: string;
  taskCount: number;
};

export type CeoIntakeStatus =
  | "received"
  | "assessing"
  | "assessment_complete"
  | "planning"
  | "planned"
  | "dispatching"
  | "dispatched"
  | "failed";

export type CeoIntakeSummary = {
  id: string;
  companyId: string;
  body: string;
  bodyText?: CompleteLocalizedText;
  status: CeoIntakeStatus;
  createdAt: string;
  updatedAt: string;
  /** Null for CEO Intake; the department a Department Intake was sent to. */
  departmentId?: string | null;
  /** What the assessing agent decided (ADR 0046). Absent until it has assessed the input. */
  outcome?: "create_tasks" | "revise_plan" | "context_only" | "route_department" | "attach_to_task" | "route_to_ceo" | null;
  outcomeSummary?: LocalizedText | null;
  createdTaskIds?: string[];
  targetTaskId?: string | null;
  replanProposalId?: string | null;
  failureReason?: string | null;
  assessedAt?: string | null;
};

export type DepartmentSummary = {
  id: string;
  key?: string;
  name: string;
  nameText?: CompleteLocalizedText;
  responsibility: string;
  responsibilityText?: CompleteLocalizedText;
  leadAgentId?: string;
  memoryPath?: string;
};

export type ObjectiveSummary = {
  id: string;
  title: string;
  titleText?: CompleteLocalizedText;
  priority: number;
};

export type KeyResultSummary = {
  id: string;
  objectiveId: string;
  title: string;
  titleText?: CompleteLocalizedText;
  metricName: string;
  targetValue: string;
  targetValueText?: CompleteLocalizedText;
  currentValue: string;
  currentValueText?: CompleteLocalizedText;
  status: string;
};

export type ExecutionOverview = {
  runId: string; status: string; phase: string | null; policyVersion: string | null;
  health: { state: string; reason: string; action: string; checkedAt: string } | null;
  budget: { authorizedMs: number; consumedMs: number; reservedMs: number; remainingMs: number; availableMs: number; estimated: boolean } | null;
  stop: { reason: string; manualConfirmedAt?: string | null; requestedAt: string | null; terminationWaitMs: number | null; terminationConfirmed: boolean | null } | null;
};
export type BudgetAuthorizationInput = { id: string; additionalMs: number; expectedAuthorizedMs: number; reason: string };
export type TaskSummary = {
  execution?: ExecutionOverview | null;
  id: string;
  title: string;
  titleText?: CompleteLocalizedText;
  status: string;
  departmentId: string;
  /** The key result the task serves (ADR 0048). */
  keyResultId?: string | null;
  departmentKey?: string;
  assigneeAgentId?: string;
  description?: string;
  descriptionText?: CompleteLocalizedText;
  riskLevel?: string;
  failureReason?: string;
  failureMessage?: string;
  executionProfileName?: string;
  requestedTimeoutMs?: number;
  effectiveTimeoutMs?: number;
  dependencyNote?: string;
  artifactWorkspacePath?: string;
  dependsOnTaskIds?: string[];
  parentTaskId?: string;
  taskKind?: "parent" | "department_subtask";
  source?: "ceo" | "department" | "user";
  /** Why the task is stopped and who owns it. Server-computed; never re-derived here (ADR 0020). */
  holds?: TaskHoldSummary[];
  /** What can be done to the task right now. The only source of which actions the UI offers. */
  affordances?: TaskAffordanceSummary[];
};

export type TaskHoldSummary = {
  id: string;
  kind: string;
  resolver: "ceo_office" | "founder" | "upstream_task" | "runtime" | "time";
  subjectKind?: string;
  subjectId?: string;
  reason: string;
  reasonText?: CompleteLocalizedText;
  openedAt: string;
};

export type TaskAffordanceKind =
  | "ceo_review_decision"
  | "decide_founder_approval"
  | "confirm_human_action"
  | "resolve_founder_decision"
  | "refresh_task"
  | "recover_task"
  | "request_replan"
  | "confirm_replan"
  | "authorize_execution_budget"
  | "confirm_termination"
  | "cancel_task";

export type TaskAffordanceSummary = {
  kind: TaskAffordanceKind;
  actor: "ceo_office" | "founder" | "upstream_task" | "runtime" | "time";
  holdId: string | null;
  holdKind: string | null;
  subjectKind: string | null;
  subjectId: string | null;
};

export type TaskProgressEventSummary = {
  id: string;
  companyId: string;
  departmentId: string;
  parentTaskId: string;
  subjectTaskId: string | null;
  step:
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
  status: "complete" | "current" | "waiting" | "blocked";
  label: string;
  labelText?: CompleteLocalizedText;
  detail: string | null;
  detailText?: CompleteLocalizedText;
  createdAt: string;
};

export type NextStepItemSummary = NextStepItem;

export type TaskCompletionEventSummary = {
  id: string;
  companyId: string;
  taskId: string;
  departmentId: string;
  keyResultId: string | null;
  businessArtifactId: string | null;
  outcome: "accepted" | "blocked" | "failed_to_review" | "needs_replan" | "awaiting_founder_decision" | "awaiting_human_action";
  acceptanceProvenance: "manual_ceo_review" | "automatic_acceptance" | null;
  outcomeSummaryText?: LocalizedText | null;
  executionReport?: {
    conclusion: LocalizedText;
    visionImpact: LocalizedText;
    remainingGap: LocalizedText;
    recommendation: LocalizedText;
  } | null;
  dependencyImpact: unknown;
  nextStepItems: NextStepItemSummary[];
  visionGaps: unknown[];
  createdAt: string;
};
export type CompanyEventSummary = {
  type: string;
  companyId: string;
  message: string;
  messageText?: CompleteLocalizedText;
  status?: string;
};
export type VisionGapSummary = VisionGap;
export type HumanActionSummary = HumanAction;
export type WaitStateSummary = WaitState;
export type FounderDecisionSummary = FounderDecision;
export type CeoAttentionRollupSummary = CeoAttentionRollup;
export type CeoOfficeItemSummary = CEOOfficeItem;

export type ProofSummary = {
  id: string;
  taskId: string;
  type: string;
  uri: string;
  summary: string;
  summaryText?: CompleteLocalizedText;
};

export type BusinessArtifactSummary = {
  id: string;
  companyId: string;
  taskId: string;
  sourceProofId?: string | null;
  artifactKind: string;
  artifactRole: string;
  artifactSubtype: string;
  artifactType: string;
  taskType: string;
  payload: unknown;
  lineage: unknown;
  validationStatus: string;
  validationErrors: unknown[];
  reviewStatus: string;
  isCurrent: boolean;
  supersedesArtifactId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FinalFounderReportSummary = {
  id: string;
  classification: FinalFounderReportClassification;
  generatedBy: FinalFounderReportGeneratedBy;
  sections: {
    vision: LocalizedText;
    actualResult: LocalizedText;
    departmentContributions: LocalizedText[];
    goalFit: LocalizedText;
    remainingGaps: LocalizedText;
    recommendedNextStep: LocalizedText;
  };
  supersedesReportId?: string | null;
  createdAt?: string;
};

export type FounderReportSummary = {
  founderVision: string;
  actualOutputs: Array<{
    taskId: string;
    artifactKind: string;
    artifactRole: string;
    artifactSubtype: string;
    artifactType: string;
    taskType: string;
    payload: unknown;
  }>;
  completedTaskCount: number;
  reviewTaskCount: number;
  blockedTaskCount: number;
  departmentContributions?: Array<{
    departmentId: string;
    departmentName: string;
    completedTaskCount: number;
    acceptedOutputCount: number;
    blockedTaskCount: number;
    humanActionCount: number;
    waitStateCount: number;
    visionGapCount: number;
  }>;
  dependencyState?: Array<{
    taskId: string;
    title: string;
    departmentId: string;
    departmentName: string;
    status: string;
    dependsOnTaskIds: string[];
    hasAcceptedOutput: boolean;
    dependencyNote?: string | null;
  }>;
  humanActionCount?: number;
  humanActions?: Array<{
    id: string;
    label: string;
    status: string;
    departmentId: string;
    blockedTaskIds: string[];
    confirmationRequirements: string[];
  }>;
  waitStateCount?: number;
  waitStates?: Array<{
    id: string;
    label: string;
    status: string;
    nextCheckAt: string;
    affectedTaskIds: string[];
  }>;
  visionGapCount?: number;
  visionGaps?: Array<{
    id: string;
    label: string;
    severity: string;
    departmentId: string;
    relatedTaskId: string | null;
  }>;
  directionDriftDetected: boolean;
  nextSteps: string[];
};

export type TaskRefreshRecoverySummary = {
  status: "recovered" | "still_unreviewable" | "not_found" | "not_applicable";
  message: string;
};

export type TaskRefreshResponse = {
  task: TaskSummary;
  event: ServerEvent;
  progressEvent?: TaskProgressEventSummary;
  proof?: ProofSummary[];
  businessArtifacts?: BusinessArtifactSummary[];
  recovery?: TaskRefreshRecoverySummary;
  parentAggregation?: TaskUpdateBatchSummary;
};

export type TaskRecoverySummary = {
  status: "queued" | "follow_up_created" | "proof_recovered";
  message: string;
};

export type TaskRecoveryResponse = {
  task: TaskSummary;
  followUpTask?: TaskSummary;
  event: ServerEvent;
  progressEvent?: TaskProgressEventSummary;
  proof?: ProofSummary[];
  businessArtifacts?: BusinessArtifactSummary[];
  recovery: TaskRecoverySummary;
  parentAggregation?: TaskUpdateBatchSummary;
};

export type ApprovalSummary = {
  id: string;
  companyId: string;
  taskId: string | null;
  actionType: string;
  riskLevel: string;
  status: "pending" | "approved" | "denied";
  requestedAt: string;
  decidedAt?: string | null;
  note?: string | null;
};

export type FounderApprovalResponse = {
  approval: ApprovalSummary;
  task?: TaskSummary;
  event?: ServerEvent;
};

export type ReviewSummary = {
  id: string;
  companyId: string;
  summary: string;
  reviewPath: string;
  createdAt: string;
};

export type ReplanReplacementTaskSummary = {
  title: string;
  titleText?: CompleteLocalizedText;
  description: string;
  descriptionText?: CompleteLocalizedText;
  requiredCapabilities: string[];
  proofSchemaId: string;
  riskLevel: string;
};

export type ReplanMode = "split" | "revision";

/** The parts of a task a Revision may rewrite. */
export type ReplanTaskDefinitionSummary = {
  title: string;
  description: string;
  proofSchemaId: string;
  requiredCapabilities: string[];
};

export type ReplanRequirementSummary = { id: string; description: string };

export type ReplanProposalSummary = {
  id: string;
  companyId: string;
  sourceTaskId: string;
  /** `proposed`, `confirmed`, `rejected`, `dismissed` (replaced by a newer request) or `failed` (nothing applicable). */
  status: string;
  /** Null for a `failed` proposal. Absent on proposals from servers before ADR 0043, which were all Splits. */
  mode?: ReplanMode | null;
  requestedMode?: ReplanMode | null;
  founderNote?: string | null;
  taskBefore?: ReplanTaskDefinitionSummary | null;
  taskAfter?: ReplanTaskDefinitionSummary | null;
  capabilitiesChanged?: boolean;
  requirementChanges?: Array<{ verifierTaskId: string; before: ReplanRequirementSummary[]; after: ReplanRequirementSummary[] }>;
  requirementSourceNotes?: Array<{ verifierTaskId: string; producerTaskId: string }>;
  rejectionNote?: string | null;
  rejectedAt?: string;
  /** Derived by the server: the task has moved since the proposal was made, so confirming it is refused. */
  stale?: boolean;
  proposalSource?: "planner_agent" | "deterministic_template";
  plannerAgentId?: string;
  plannerPromptPath?: string;
  plannerFailureReason?: string;
  plannerFailureMessage?: string;
  rationale: string;
  rationaleText?: CompleteLocalizedText;
  replacementTasks: ReplanReplacementTaskSummary[];
  createdAt: string;
  confirmedAt?: string;
};

export type CeoReviewReturnReason = "needs_changes" | "unclear_task_definition" | "scope_too_large" | "wrong_direction";

export type CeoReviewDecisionSummary = {
  id: string;
  companyId?: string;
  taskId: string;
  departmentId?: string;
  decision: "approve" | "return";
  returnReason?: CeoReviewReturnReason | null;
  note?: string | null;
  noteText?: CompleteLocalizedText;
  proofId?: string | null;
  proofType?: string | null;
  proofUri?: string | null;
  actor?: string;
  createdAt: string;
};

export type CeoReviewDecisionResponse = {
  decision: CeoReviewDecisionSummary;
  task: TaskSummary;
  businessArtifacts?: BusinessArtifactSummary[];
  event?: ServerEvent;
  progressEvent?: TaskProgressEventSummary;
  dependencyCascade?: TaskUpdateBatchSummary;
};

export type FounderDecisionResolutionResponse = {
  founderDecision: FounderDecisionSummary;
  accepted: boolean;
  task: TaskSummary;
  businessArtifacts?: BusinessArtifactSummary[];
  event?: ServerEvent;
  progressEvent?: TaskProgressEventSummary;
  dependencyCascade?: TaskUpdateBatchSummary;
};

export type TaskUpdateBatchSummary = {
  updatedTasks: TaskSummary[];
  events: ServerEvent[];
  progressEvents: TaskProgressEventSummary[];
  errors?: Array<{
    taskId: string;
    message: string;
  }>;
};

export type CreateCompanyResponse = {
  company: CompanySummary;
  departments: DepartmentSummary[];
  objectives: ObjectiveSummary[];
  keyResults?: KeyResultSummary[];
  tasks: TaskSummary[];
  proof?: ProofSummary[];
  businessArtifacts?: BusinessArtifactSummary[];
  ceoOfficeItems?: CeoOfficeItemSummary[];
  founderReport?: FounderReportSummary;
  finalFounderReport?: FinalFounderReportSummary | null;
  finalFounderReportPreparing?: boolean;
  supersededFinalFounderReports?: FinalFounderReportSummary[];
  reviews?: ReviewSummary[];
  activity?: ServerEvent[];
  creationEvents?: CompanyEventSummary[];
  creationAttempts?: Array<{
    id: string;
    companyId: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    promptPath: string | null;
    failureMessage: string | null;
  }>;
  replanProposals?: ReplanProposalSummary[];
  taskProgressEvents?: TaskProgressEventSummary[];
  taskCompletionEvents?: TaskCompletionEventSummary[];
  visionGaps?: VisionGapSummary[];
  humanActions?: HumanActionSummary[];
  waitStates?: WaitStateSummary[];
  founderDecisions?: FounderDecisionSummary[];
  ceoAttentionRollups?: CeoAttentionRollupSummary[];
  ceoIntakes?: CeoIntakeSummary[];
  ceoReviewDecisions?: CeoReviewDecisionSummary[];
};

export type ServerEvent = {
  type: string;
  companyId?: string;
  taskId?: string;
  message: string;
  messageText?: CompleteLocalizedText;
  failureReason?: string;
  failureMessage?: string;
  status?: string;
  executionProfileName?: string;
  requestedTimeoutMs?: number;
  effectiveTimeoutMs?: number;
  dependencyNote?: string;
  artifactWorkspacePath?: string;
};

export type CompanyStateResponse = CreateCompanyResponse & {
  keyResults?: KeyResultSummary[];
  proof: ProofSummary[];
  businessArtifacts?: BusinessArtifactSummary[];
  ceoOfficeItems?: CeoOfficeItemSummary[];
  founderReport?: FounderReportSummary;
  finalFounderReport?: FinalFounderReportSummary | null;
  finalFounderReportPreparing?: boolean;
  supersededFinalFounderReports?: FinalFounderReportSummary[];
  reviews: ReviewSummary[];
  activity: ServerEvent[];
  replanProposals: ReplanProposalSummary[];
  taskProgressEvents?: TaskProgressEventSummary[];
  taskCompletionEvents?: TaskCompletionEventSummary[];
  visionGaps?: VisionGapSummary[];
  humanActions?: HumanActionSummary[];
  waitStates?: WaitStateSummary[];
  founderDecisions?: FounderDecisionSummary[];
  ceoAttentionRollups?: CeoAttentionRollupSummary[];
  ceoIntakes?: CeoIntakeSummary[];
  ceoReviewDecisions?: CeoReviewDecisionSummary[];
};

export type ApiClient = {
  listAgents(): Promise<{ agents: AgentSummary[] }>;
  listCompanies(): Promise<{ companies: CompanyListItem[] }>;
  createCompany(input: {
    companyName: string;
    founderVision: string;
    locale?: Locale;
    selectedCeoAgentId: string;
    permissionMode: string;
    assets: string[];
    creationIdempotencyKey?: string;
  }): Promise<CreateCompanyResponse>;
  retryCompanyCreation(companyId: string): Promise<CreateCompanyResponse>;
  getCompanyState(companyId: string): Promise<CompanyStateResponse>;
  createCeoIntake(companyId: string, input: { body: string }): Promise<{ intake: CeoIntakeSummary }>;
  /** Founder input to one department, assessed by that department's agent (ADR 0046). */
  createDepartmentIntake(companyId: string, departmentId: string, input: { body: string }): Promise<{ intake: CeoIntakeSummary }>;
  createCeoReviewDecision(input: {
    taskId: string;
    decision: "approve" | "return";
    returnReason?: CeoReviewReturnReason;
    note?: string;
  }): Promise<CeoReviewDecisionResponse>;
  resolveFounderDecision(input: {
    founderDecisionId: string;
    chosenOption?: string;
    action?: "return";
    returnReason?: CeoReviewReturnReason;
    note?: string;
  }): Promise<FounderDecisionResolutionResponse>;
  getTaskProof(taskId: string): Promise<{ proof: ProofSummary[] }>;
  getCompanyReviews(companyId: string): Promise<{ reviews: ReviewSummary[] }>;
  refreshTask(taskId: string): Promise<TaskRefreshResponse>;
  getTaskExecution(taskId: string): Promise<{ task: TaskSummary }>;
  authorizeExecutionBudget(taskId: string, input: BudgetAuthorizationInput): Promise<{ task: TaskSummary; replayed: boolean }>;
  cancelTask(taskId: string): Promise<{ task: TaskSummary }>;
  recoverTask(taskId: string): Promise<TaskRecoveryResponse>;
  /** The founder attests the process holding this task's workspace is gone, releasing its isolation. */
  confirmTaskTermination(taskId: string): Promise<{ task: TaskSummary; releasedWorkspaces: string[] }>;
  decideFounderApproval(approvalId: string, input: { decision: "approved" | "denied"; note?: string }): Promise<FounderApprovalResponse>;
  createReplanProposal(taskId: string, request?: { mode?: ReplanMode | null; note?: string | null }): Promise<{ proposal: ReplanProposalSummary }>;
  rejectReplanProposal(proposalId: string, note?: string | null): Promise<{ proposal: ReplanProposalSummary }>;
  confirmReplanProposal(proposalId: string): Promise<{
    proposal: ReplanProposalSummary;
    sourceTask: TaskSummary;
    createdTasks: TaskSummary[];
    dependencyCascade?: TaskUpdateBatchSummary;
  }>;
  confirmHumanAction(companyId: string, humanActionId: string, input: { evidence: Record<string, string> }): Promise<{
    humanAction: HumanActionSummary;
    updatedTasks: TaskSummary[];
    events: ServerEvent[];
  }>;
  /** Pause Operating, Resume Operating and Stop Operating (ADR 0044). A stop is final. */
  pauseCompany(companyId: string): Promise<CompanyOperationResponse>;
  resumeCompany(companyId: string): Promise<CompanyOperationResponse>;
  stopCompany(companyId: string): Promise<CompanyOperationResponse>;
  /**
   * `onOpen` runs on the first connection and on every reconnect. The stream does not replay
   * events published while no subscriber was connected, so callers resync from a snapshot there.
   */
  subscribeEvents(companyId: string, handler: (event: ServerEvent) => void, onOpen?: () => void): () => void;
};

export function createApiClient(baseUrl = "", options: { requestTimeoutMs?: number } = {}): ApiClient {
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;

  return {
    async listAgents() {
      return getJson(`${baseUrl}/api/agents`, requestTimeoutMs);
    },
    async listCompanies() {
      return getJson(`${baseUrl}/api/companies`, requestTimeoutMs, hasCompanies);
    },
    async createCompany(input) {
      return postJson(`${baseUrl}/api/companies`, input, requestTimeoutMs, hasCompanyState);
    },
    async retryCompanyCreation(companyId) {
      return postJson(`${baseUrl}/api/companies/${companyId}/retry-creation`, {}, requestTimeoutMs, hasCompanyState);
    },
    async getCompanyState(companyId) {
      return getJson(`${baseUrl}/api/companies/${companyId}/state`, requestTimeoutMs, hasCompanyState);
    },
    async createCeoIntake(companyId, input) {
      return postJson(`${baseUrl}/api/companies/${companyId}/ceo-intakes`, input, requestTimeoutMs);
    },
    async createDepartmentIntake(companyId, departmentId, input) {
      return postJson(`${baseUrl}/api/companies/${companyId}/departments/${departmentId}/intakes`, input, requestTimeoutMs);
    },
    async createCeoReviewDecision(input) {
      return postJson(`${baseUrl}/api/ceo-review-decisions`, input, requestTimeoutMs, hasTask);
    },
    async resolveFounderDecision(input) {
      return postJson(`${baseUrl}/api/founder-decisions`, input, requestTimeoutMs, hasTask);
    },
    async getTaskProof(taskId) {
      return getJson(`${baseUrl}/api/tasks/${taskId}/proof`, requestTimeoutMs);
    },
    async getCompanyReviews(companyId) {
      return getJson(`${baseUrl}/api/companies/${companyId}/reviews`, requestTimeoutMs);
    },
    async refreshTask(taskId) {
      return postJson(`${baseUrl}/api/tasks/${taskId}/refresh`, {}, requestTimeoutMs, hasTask);
    },
    async getTaskExecution(taskId) { return getJson(`${baseUrl}/api/tasks/${taskId}/execution`, requestTimeoutMs, hasTask); },
    async authorizeExecutionBudget(taskId, input) { return postJson(`${baseUrl}/api/tasks/${taskId}/execution-budget`, input, requestTimeoutMs, hasTask); },
    async cancelTask(taskId) { return postJson(`${baseUrl}/api/tasks/${taskId}/cancel`, {}, requestTimeoutMs, hasTask); },
    async recoverTask(taskId) {
      return postJson(`${baseUrl}/api/tasks/${taskId}/recover`, {}, requestTimeoutMs, hasTask);
    },
    async confirmTaskTermination(taskId) {
      return postJson(`${baseUrl}/api/tasks/${taskId}/confirm-termination`, {}, requestTimeoutMs, hasTask);
    },
    async decideFounderApproval(approvalId, input) {
      return postJson(`${baseUrl}/api/approvals/${approvalId}`, input, requestTimeoutMs);
    },
    async createReplanProposal(taskId, request) {
      return postJson(`${baseUrl}/api/tasks/${taskId}/replan-proposals`, { mode: request?.mode ?? null, note: request?.note ?? null }, requestTimeoutMs);
    },
    async rejectReplanProposal(proposalId, note) {
      return postJson(`${baseUrl}/api/replan-proposals/${proposalId}/reject`, { note: note ?? null }, requestTimeoutMs);
    },
    async confirmReplanProposal(proposalId) {
      return postJson(`${baseUrl}/api/replan-proposals/${proposalId}/confirm`, {}, requestTimeoutMs);
    },
    async confirmHumanAction(companyId, humanActionId, input) {
      return postJson(`${baseUrl}/api/companies/${companyId}/human-actions/${humanActionId}/confirm`, input, requestTimeoutMs);
    },
    async pauseCompany(companyId) {
      return postJson(`${baseUrl}/api/companies/${companyId}/pause`, {}, requestTimeoutMs, hasCompany);
    },
    async resumeCompany(companyId) {
      return postJson(`${baseUrl}/api/companies/${companyId}/resume`, {}, requestTimeoutMs, hasCompany);
    },
    async stopCompany(companyId) {
      return postJson(`${baseUrl}/api/companies/${companyId}/stop`, {}, requestTimeoutMs, hasCompany);
    },
    subscribeEvents(companyId, handler, onOpen) {
      const events = new EventSource(`${baseUrl}/api/events?companyId=${encodeURIComponent(companyId)}`);
      if (onOpen) {
        events.addEventListener("open", () => onOpen());
      }
      const listener = (event: MessageEvent) => {
        handler(JSON.parse(event.data) as ServerEvent);
      };
      events.addEventListener("task_log", listener);
      events.addEventListener("task_started", listener);
      events.addEventListener("task_review", listener);
      events.addEventListener("automatic_acceptance", listener);
      events.addEventListener("ceo_review_decision", listener);
      events.addEventListener("founder_decision", listener);
      events.addEventListener("task_failed", listener);
      events.addEventListener("task_blocked", listener);
      events.addEventListener("task_warning", listener);
      events.addEventListener("partial_output", listener);
      events.addEventListener("dependency_waiting", listener);
      events.addEventListener("dependency_ready", listener);
      events.addEventListener("task_retrying", listener);
      events.addEventListener("task_recovered", listener);
      events.addEventListener("task_needs_replan", listener);
      events.addEventListener("task_replanned", listener);
      events.addEventListener("deliverable_missing", listener);
      events.addEventListener("company_creation_accepted", listener);
      events.addEventListener("company_creation_agent_started", listener);
      events.addEventListener("company_creation_completed", listener);
      events.addEventListener("company_creation_failed", listener);
      events.addEventListener("company_report_ready", listener);
      events.addEventListener("ceo_intake_updated", listener);
      return () => events.close();
    },
  };
}

/**
 * Names the field a response body is missing, or null when it has every field the dashboard reads
 * from it straight away. Fields it does not check, including ones a newer server adds, pass through.
 */
type ResponseCheck = (body: unknown) => string | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCompanySummary(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.status === "string";
}

const hasTask: ResponseCheck = (body) =>
  isRecord(body) && isRecord(body.task) && typeof body.task.id === "string" && typeof body.task.status === "string" ? null : "task";
const hasCompany: ResponseCheck = (body) => (isRecord(body) && hasCompanySummary(body.company) ? null : "company");
const hasCompanies: ResponseCheck = (body) => (isRecord(body) && Array.isArray(body.companies) ? null : "companies");
const hasCompanyState: ResponseCheck = (body) => {
  if (!isRecord(body) || !hasCompanySummary(body.company)) return "company";
  if (!Array.isArray(body.departments)) return "departments";
  if (!Array.isArray(body.tasks)) return "tasks";
  return null;
};

async function getJson<T>(url: string, timeoutMs: number, check?: ResponseCheck): Promise<T> {
  const response = await fetchWithTimeout(url, undefined, timeoutMs);

  if (!response.ok) {
    throw new Error(await formatRequestError(response));
  }

  return checkResponse(await parseJsonResponse<T>(response, url), url, check);
}

async function postJson<T>(url: string, body: unknown, timeoutMs: number, check?: ResponseCheck): Promise<T> {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, timeoutMs);

  if (!response.ok) {
    throw new Error(await formatRequestError(response));
  }

  return checkResponse(await parseJsonResponse<T>(response, url), url, check);
}

/**
 * The API client is the one place a response becomes typed data. A body without the fields its type
 * promises (a server of another version, another service on the port) fails here as a request error
 * the caller already shows, not later as a render crash that blanks the page.
 */
function checkResponse<T>(body: T, url: string, check: ResponseCheck | undefined): T {
  const missing = check?.(body);
  if (missing) {
    throw new Error(`Unexpected response from ${url}: missing "${missing}".`);
  }
  return body;
}

async function parseJsonResponse<T>(response: Response, url: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    const contentType = response.headers.get("content-type") ?? "unknown";
    throw new Error(`Expected JSON from ${url} but received ${contentType}: ${formatUnknownError(error)}`);
  }
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithTimeout(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function formatRequestError(response: Response): Promise<string> {
  const fallback = `Request failed: ${response.status}`;

  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" && body.error.length > 0 ? body.error : fallback;
  } catch {
    return fallback;
  }
}
