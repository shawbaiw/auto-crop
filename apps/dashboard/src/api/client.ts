export type AgentSummary = {
  id: string;
  name: string;
  capabilities: string[];
  detected: boolean;
};

export type CompanySummary = {
  id: string;
  name: string;
  status: string;
  playbookId: string;
};

export type DepartmentSummary = {
  id: string;
  name: string;
  responsibility: string;
  leadAgentId?: string;
  memoryPath?: string;
};

export type ObjectiveSummary = {
  id: string;
  title: string;
  priority: number;
};

export type TaskSummary = {
  id: string;
  title: string;
  status: string;
  departmentId: string;
  assigneeAgentId?: string;
  description?: string;
  riskLevel?: string;
  failureReason?: string;
};

export type ProofSummary = {
  id: string;
  taskId: string;
  type: string;
  uri: string;
  summary: string;
};

export type ReviewSummary = {
  id: string;
  companyId: string;
  summary: string;
  reviewPath: string;
  createdAt: string;
};

export type EditableBlueprint = {
  companyName: string;
  objectives: string[];
  firstTasks: string[];
};

export type CreateCompanyResponse = {
  company: CompanySummary;
  departments: DepartmentSummary[];
  objectives: ObjectiveSummary[];
  tasks: TaskSummary[];
  editable: EditableBlueprint;
};

export type ServerEvent = {
  type: string;
  taskId?: string;
  message: string;
  failureReason?: string;
};

export type ApiClient = {
  listAgents(): Promise<{ agents: AgentSummary[] }>;
  createCompany(input: {
    companyName: string;
    founderVision: string;
    selectedCeoAgentId: string;
    permissionMode: string;
    assets: string[];
  }): Promise<CreateCompanyResponse>;
  activateCompany(companyId: string): Promise<{ company: CompanySummary }>;
  getTaskProof(taskId: string): Promise<{ proof: ProofSummary[] }>;
  getCompanyReviews(companyId: string): Promise<{ reviews: ReviewSummary[] }>;
  triggerKillSwitch(companyId: string): Promise<{ paused: boolean; company: CompanySummary }>;
  subscribeEvents(handler: (event: ServerEvent) => void): () => void;
};

export function createApiClient(baseUrl = ""): ApiClient {
  return {
    async listAgents() {
      return getJson(`${baseUrl}/api/agents`);
    },
    async createCompany(input) {
      return postJson(`${baseUrl}/api/companies`, input);
    },
    async activateCompany(companyId) {
      return postJson(`${baseUrl}/api/companies/${companyId}/activate`, {});
    },
    async getTaskProof(taskId) {
      return getJson(`${baseUrl}/api/tasks/${taskId}/proof`);
    },
    async getCompanyReviews(companyId) {
      return getJson(`${baseUrl}/api/companies/${companyId}/reviews`);
    },
    async triggerKillSwitch(companyId) {
      return postJson(`${baseUrl}/api/kill-switch`, { companyId });
    },
    subscribeEvents(handler) {
      const events = new EventSource(`${baseUrl}/api/events`);
      const listener = (event: MessageEvent) => {
        handler(JSON.parse(event.data) as ServerEvent);
      };
      events.addEventListener("task_log", listener);
      events.addEventListener("task_started", listener);
      events.addEventListener("task_review", listener);
      events.addEventListener("task_failed", listener);
      events.addEventListener("task_blocked", listener);
      return () => events.close();
    },
  };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(await formatRequestError(response));
  }

  return (await response.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await formatRequestError(response));
  }

  return (await response.json()) as T;
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
