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
  selectedCeoAgentId?: string;
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
};

export type DepartmentSummary = {
  id: string;
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

export type TaskSummary = {
  id: string;
  title: string;
  titleText?: CompleteLocalizedText;
  status: string;
  departmentId: string;
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
  directionDriftDetected: boolean;
  nextSteps: string[];
};

export type TaskRefreshRecoverySummary = {
  status: "recovered" | "not_found" | "not_applicable";
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

export type ReplanProposalSummary = {
  id: string;
  companyId: string;
  sourceTaskId: string;
  status: string;
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
  tasks: TaskSummary[];
  proof?: ProofSummary[];
  businessArtifacts?: BusinessArtifactSummary[];
  founderReport?: FounderReportSummary;
  reviews?: ReviewSummary[];
  activity?: ServerEvent[];
  replanProposals?: ReplanProposalSummary[];
  taskProgressEvents?: TaskProgressEventSummary[];
  ceoIntakes?: CeoIntakeSummary[];
  ceoReviewDecisions?: CeoReviewDecisionSummary[];
};

export type ServerEvent = {
  type: string;
  taskId?: string;
  message: string;
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
  proof: ProofSummary[];
  businessArtifacts?: BusinessArtifactSummary[];
  founderReport?: FounderReportSummary;
  reviews: ReviewSummary[];
  activity: ServerEvent[];
  replanProposals: ReplanProposalSummary[];
  taskProgressEvents?: TaskProgressEventSummary[];
  ceoIntakes?: CeoIntakeSummary[];
  ceoReviewDecisions?: CeoReviewDecisionSummary[];
};

export type ApiClient = {
  listAgents(): Promise<{ agents: AgentSummary[] }>;
  listCompanies(): Promise<{ companies: CompanyListItem[] }>;
  createCompany(input: {
    companyName: string;
    founderVision: string;
    selectedCeoAgentId: string;
    permissionMode: string;
    assets: string[];
  }): Promise<CreateCompanyResponse>;
  getCompanyState(companyId: string): Promise<CompanyStateResponse>;
  createCeoIntake(companyId: string, input: { body: string }): Promise<{ intake: CeoIntakeSummary }>;
  createCeoReviewDecision(input: {
    taskId: string;
    decision: "approve" | "return";
    returnReason?: CeoReviewReturnReason;
    note?: string;
  }): Promise<CeoReviewDecisionResponse>;
  activateCompany(companyId: string): Promise<{ company: CompanySummary }>;
  getTaskProof(taskId: string): Promise<{ proof: ProofSummary[] }>;
  getCompanyReviews(companyId: string): Promise<{ reviews: ReviewSummary[] }>;
  refreshTask(taskId: string): Promise<TaskRefreshResponse>;
  recoverTask(taskId: string): Promise<TaskRecoveryResponse>;
  createReplanProposal(taskId: string): Promise<{ proposal: ReplanProposalSummary }>;
  confirmReplanProposal(proposalId: string): Promise<{
    proposal: ReplanProposalSummary;
    sourceTask: TaskSummary;
    createdTasks: TaskSummary[];
    dependencyCascade?: TaskUpdateBatchSummary;
  }>;
  triggerKillSwitch(companyId: string): Promise<{ paused: boolean; company: CompanySummary }>;
  subscribeEvents(companyId: string, handler: (event: ServerEvent) => void): () => void;
};

export function createApiClient(baseUrl = "", options: { requestTimeoutMs?: number } = {}): ApiClient {
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;

  return {
    async listAgents() {
      return getJson(`${baseUrl}/api/agents`, requestTimeoutMs);
    },
    async listCompanies() {
      return getJson(`${baseUrl}/api/companies`, requestTimeoutMs);
    },
    async createCompany(input) {
      return postJson(`${baseUrl}/api/companies`, input, requestTimeoutMs);
    },
    async getCompanyState(companyId) {
      return getJson(`${baseUrl}/api/companies/${companyId}/state`, requestTimeoutMs);
    },
    async createCeoIntake(companyId, input) {
      return postJson(`${baseUrl}/api/companies/${companyId}/ceo-intakes`, input, requestTimeoutMs);
    },
    async createCeoReviewDecision(input) {
      return postJson(`${baseUrl}/api/ceo-review-decisions`, input, requestTimeoutMs);
    },
    async activateCompany(companyId) {
      return postJson(`${baseUrl}/api/companies/${companyId}/activate`, {}, requestTimeoutMs);
    },
    async getTaskProof(taskId) {
      return getJson(`${baseUrl}/api/tasks/${taskId}/proof`, requestTimeoutMs);
    },
    async getCompanyReviews(companyId) {
      return getJson(`${baseUrl}/api/companies/${companyId}/reviews`, requestTimeoutMs);
    },
    async refreshTask(taskId) {
      return postJson(`${baseUrl}/api/tasks/${taskId}/refresh`, {}, requestTimeoutMs);
    },
    async recoverTask(taskId) {
      return postJson(`${baseUrl}/api/tasks/${taskId}/recover`, {}, requestTimeoutMs);
    },
    async createReplanProposal(taskId) {
      return postJson(`${baseUrl}/api/tasks/${taskId}/replan-proposals`, {}, requestTimeoutMs);
    },
    async confirmReplanProposal(proposalId) {
      return postJson(`${baseUrl}/api/replan-proposals/${proposalId}/confirm`, {}, requestTimeoutMs);
    },
    async triggerKillSwitch(companyId) {
      return postJson(`${baseUrl}/api/kill-switch`, { companyId }, requestTimeoutMs);
    },
    subscribeEvents(companyId, handler) {
      const events = new EventSource(`${baseUrl}/api/events?companyId=${encodeURIComponent(companyId)}`);
      const listener = (event: MessageEvent) => {
        handler(JSON.parse(event.data) as ServerEvent);
      };
      events.addEventListener("task_log", listener);
      events.addEventListener("task_started", listener);
      events.addEventListener("task_review", listener);
      events.addEventListener("task_failed", listener);
      events.addEventListener("task_blocked", listener);
      events.addEventListener("task_warning", listener);
      events.addEventListener("partial_output", listener);
      events.addEventListener("dependency_waiting", listener);
      events.addEventListener("dependency_ready", listener);
      events.addEventListener("task_retrying", listener);
      events.addEventListener("task_recovered", listener);
      events.addEventListener("task_needs_replan", listener);
      events.addEventListener("deliverable_missing", listener);
      return () => events.close();
    },
  };
}

async function getJson<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await fetchWithTimeout(url, undefined, timeoutMs);

  if (!response.ok) {
    throw new Error(await formatRequestError(response));
  }

  return parseJsonResponse<T>(response, url);
}

async function postJson<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, timeoutMs);

  if (!response.ok) {
    throw new Error(await formatRequestError(response));
  }

  return parseJsonResponse<T>(response, url);
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
