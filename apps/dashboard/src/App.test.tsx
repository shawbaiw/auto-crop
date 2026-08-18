// @vitest-environment jsdom
import "./test/setup";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import type { ApiClient, ServerEvent } from "./api/client";

describe("Dashboard App", () => {
  it("starts on the company-name step only", async () => {
    const api = createMockApiClient();

    render(<App apiClient={api} />);

    expect(await screen.findByRole("heading", { name: "CEO Office" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Step 1 / Company Name" })).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Step 2 / Choose CEO" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Founder vision")).not.toBeInTheDocument();
    expect(api.listAgents).not.toHaveBeenCalled();
  });

  it("blocks Next on Step 1 until a company name is entered", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await user.click(await screen.findByRole("button", { name: /next/i }));

    expect(screen.getByRole("alert")).toHaveTextContent("Company name is required.");
    expect(screen.getByRole("heading", { name: "Step 1 / Company Name" })).toBeInTheDocument();
    expect(api.listAgents).not.toHaveBeenCalled();
  });

  it("detects agents automatically when entering Step 2", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await user.type(await screen.findByLabelText("Company name"), "Pricing Page Studio");
    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(await screen.findByRole("heading", { name: "Step 2 / Choose CEO" })).toBeInTheDocument();
    expect(api.listAgents).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: /codex/i })).toBeInTheDocument();
  });

  it("shows Step 2 loading and empty states", async () => {
    const api = createMockApiClient();
    const agents = createDeferred<{ agents: [] }>();
    api.listAgents = vi.fn(() => agents.promise);
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await user.type(await screen.findByLabelText("Company name"), "Pricing Page Studio");
    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(await screen.findByText("Scanning local agent registry...")).toBeInTheDocument();
    agents.resolve({ agents: [] });
    expect(await screen.findByText("No local agents reported by the API.")).toBeInTheDocument();
  });

  it("requires a detected CEO before Step 3 appears", async () => {
    const api = createMockApiClient();
    api.listAgents = vi.fn(async () => ({
      agents: [
        {
          id: "codex",
          name: "Codex",
          capabilities: ["code", "frontend", "test"],
          detected: false,
        },
      ],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await user.type(await screen.findByLabelText("Company name"), "Pricing Page Studio");
    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByRole("heading", { name: "Step 2 / Choose CEO" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByRole("alert")).toHaveTextContent("Select one detected CEO Agent.");
    expect(screen.queryByLabelText("Founder vision")).not.toBeInTheDocument();
  });

  it("creates a company from onboarding and can open the operating dashboard from the menu", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompanyAndOpenDashboard(user);

    expect(screen.getByRole("heading", { name: "Company Operating Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("CEO Office")).toBeInTheDocument();
    expect(screen.getByText("OKR System")).toBeInTheDocument();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("Active Tasks")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Proof" })).toBeInTheDocument();
    expect(screen.getByText("Approvals")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("shows the creation loading page immediately after Create Company", async () => {
    const api = createMockApiClient();
    const created = createDeferred<Awaited<ReturnType<ApiClient["createCompany"]>>>();
    api.createCompany = vi.fn(() => created.promise);
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await fillReadyToCreate(user);
    await user.click(screen.getByRole("button", { name: /create company/i }));

    expect(await screen.findByRole("heading", { name: "CEO Office" })).toBeInTheDocument();
    expect(screen.getByText("Creating Company")).toBeInTheDocument();
    expect(screen.getAllByText("Pricing Page Studio").length).toBeGreaterThan(0);
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Sending founder vision")).toBeInTheDocument();
    expect(screen.getByText("CEO agent generating blueprint")).toBeInTheDocument();
    expect(screen.getByText("Validating strict JSON")).toBeInTheDocument();
    expect(screen.getByText("Creating departments and tasks")).toBeInTheDocument();

    created.resolve(createCompanyResponse());
    expect(await screen.findByRole("heading", { name: "Pricing Page Studio" })).toBeInTheDocument();
  });

  it("lands in the Department Workspace with CEO selected after creation", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompany(user);

    expect(screen.getByText("Department Workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /CEO Codex/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Engineering 01/i })).toBeInTheDocument();
    expect(screen.getByText("Validate first wedge")).toBeInTheDocument();
    expect(screen.getByText("Create landing page / queued")).toBeInTheDocument();
  });

  it("shows department responsibility and tasks without a chat input", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompany(user);
    await user.click(screen.getByRole("button", { name: /Engineering 01/i }));

    expect(screen.getByRole("heading", { name: "Engineering Workspace" })).toBeInTheDocument();
    expect(screen.getByText("Build prototype.")).toBeInTheDocument();
    expect(screen.getByText("Create landing page / queued")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /chat/i })).not.toBeInTheDocument();
  });

  it("updates task event stream messages from SSE", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompanyAndOpenDashboard(user);

    await waitFor(() => expect(api.lastEventHandler).toBeDefined());
    act(() => {
      api.lastEventHandler?.({ type: "task_log", taskId: "task_1", message: "Generated landing page" });
    });

    expect(await screen.findByText("Generated landing page")).toBeInTheDocument();
  });

  it("shows a styled empty state when the local API is not connected", async () => {
    const api = createMockApiClient();
    api.listAgents = async () => {
      throw new Error("offline");
    };
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await user.type(await screen.findByLabelText("Company name"), "Pricing Page Studio");
    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(await screen.findByText(/local api is not connected/i)).toBeInTheDocument();
  });

  it("shows create-company errors instead of leaving the button loading", async () => {
    const api = createMockApiClient();
    api.createCompany = async () => {
      throw new Error("CEO agent failed to create company blueprint");
    };
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    expect(await screen.findByRole("heading", { name: "CEO Office" })).toBeInTheDocument();
    await fillReadyToCreate(user);
    await user.click(screen.getByRole("button", { name: /create company/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("CEO agent failed to create company blueprint");
    expect(screen.getByRole("button", { name: /create company/i })).toBeEnabled();
  });

  it("switches skins from the reusable View menu", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await screen.findByRole("heading", { name: "CEO Office" });
    await user.click(screen.getByRole("menuitem", { name: "View" }));
    await user.click(screen.getByRole("menuitem", { name: "Skin" }));
    await user.click(screen.getByRole("menuitem", { name: "极客02" }));

    expect(document.querySelector(".theme-root")).toHaveAttribute("data-skin", "geek02");
  });

  it("selects detected agents from the reusable Agents menu", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await user.type(await screen.findByLabelText("Company name"), "Pricing Page Studio");
    await user.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByRole("heading", { name: "Step 2 / Choose CEO" });
    await user.click(screen.getByRole("menuitem", { name: "Agents" }));
    await user.click(screen.getByRole("menuitem", { name: "Claude Code" }));
    await user.click(screen.getByRole("menuitem", { name: "Agents" }));

    expect(screen.getByRole("menuitemcheckbox", { name: "Claude Code" })).toHaveAttribute("aria-checked", "true");
  });

  it("keeps disabled menu commands visible without triggering actions", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await screen.findByRole("heading", { name: "CEO Office" });
    await user.click(screen.getByRole("menuitem", { name: "Company" }));

    expect(screen.getByRole("menuitem", { name: "Back to Setup" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Kill Switch" })).toBeDisabled();
  });

  it("focuses dashboard sections from Work and Proof menu commands", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompanyAndOpenDashboard(user);

    await user.click(screen.getByRole("menuitem", { name: "Work" }));
    await user.click(screen.getByRole("menuitem", { name: "View Tasks" }));
    await waitFor(() => expect(document.activeElement).toHaveAttribute("id", "active-tasks"));

    await user.click(screen.getByRole("menuitem", { name: "Proof" }));
    await user.click(screen.getByRole("menuitem", { name: "Load Review" }));
    await waitFor(() => expect(document.activeElement).toHaveAttribute("id", "review"));
    expect(await screen.findByText("Ready for next cycle")).toBeInTheDocument();
  });

  it("opens evidence and supports visible command shortcuts", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompanyAndOpenDashboard(user);

    await user.click(screen.getByRole("menuitem", { name: "Proof" }));
    await expect(screen.getByRole("menuitem", { name: /Open Evidence/ })).toBeDisabled();
    expect(screen.getByText("Cmd+3")).toBeInTheDocument();

    await user.keyboard("{Meta>}3{/Meta}");
    expect(await screen.findByText("agent.log")).toBeInTheDocument();

    await user.keyboard("{Meta>}5{/Meta}");
    await waitFor(() => expect(document.activeElement).toHaveAttribute("id", "first-evidence"));
  });

  it("toggles real fullscreen from the View menu when the browser supports it", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();
    let fullscreenElement: Element | null = null;
    const requestFullscreen = vi.fn(async () => {
      fullscreenElement = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const exitFullscreen = vi.fn(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });

    render(<App apiClient={api} />);

    await screen.findByRole("heading", { name: "CEO Office" });
    await user.click(screen.getByRole("menuitem", { name: "View" }));
    await user.click(screen.getByRole("menuitem", { name: "Fullscreen" }));

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });
});

async function fillReadyToCreate(user: ReturnType<typeof userEvent.setup>) {
  expect(await screen.findByRole("heading", { name: "CEO Office" })).toBeInTheDocument();
  await user.type(screen.getByLabelText("Company name"), "Pricing Page Studio");
  await user.click(screen.getByRole("button", { name: /next/i }));
  expect(await screen.findByRole("heading", { name: "Step 2 / Choose CEO" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /codex/i }));
  await user.click(screen.getByRole("button", { name: /next/i }));
  await user.type(screen.getByLabelText("Founder vision"), "Build an AI SaaS that creates pricing pages.");
  await user.click(screen.getByRole("button", { name: /permission mode/i }));
  await user.click(screen.getByRole("option", { name: "Balanced" }));
}

async function createCompany(user: ReturnType<typeof userEvent.setup>) {
  await fillReadyToCreate(user);
  await user.click(screen.getByRole("button", { name: /create company/i }));

  expect(await screen.findByRole("heading", { name: "Pricing Page Studio" })).toBeInTheDocument();
}

async function createCompanyAndOpenDashboard(user: ReturnType<typeof userEvent.setup>) {
  await createCompany(user);
  await user.click(screen.getByRole("menuitem", { name: "Work" }));
  await user.click(screen.getByRole("menuitem", { name: "View Tasks" }));
  expect(await screen.findByRole("heading", { name: "Company Operating Dashboard" })).toBeInTheDocument();
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

function createCompanyResponse(): Awaited<ReturnType<ApiClient["createCompany"]>> {
  return {
    company: {
      id: "company_1",
      name: "Pricing Page Studio",
      status: "draft",
      playbookId: "ai-saas",
    },
    departments: [
      {
        id: "department_1",
        name: "Engineering",
        responsibility: "Build prototype.",
        leadAgentId: "codex",
        memoryPath: ".auto-crop/companies/company_1/departments/engineering/memory.md",
      },
    ],
    objectives: [{ id: "objective_1", title: "Validate first wedge", priority: 1 }],
    tasks: [
      {
        id: "task_1",
        title: "Create landing page",
        status: "queued",
        departmentId: "department_1",
        assigneeAgentId: "codex",
        description: "Build a landing page.",
        riskLevel: "medium",
      },
    ],
    editable: {
      companyName: "Pricing Page Studio",
      objectives: ["Validate first wedge"],
      firstTasks: ["Create landing page"],
    },
  };
}

function createMockApiClient(): ApiClient & { lastEventHandler?: (event: ServerEvent) => void } {
  return {
    lastEventHandler: undefined,
    listAgents: vi.fn(async () => {
      return {
        agents: [
          {
            id: "claude-code",
            name: "Claude Code",
            capabilities: ["writing", "research"],
            detected: true,
          },
          {
            id: "codex",
            name: "Codex",
            capabilities: ["code", "frontend", "test"],
            detected: true,
          },
        ],
      };
    }),
    async createCompany() {
      return createCompanyResponse();
    },
    async activateCompany(companyId) {
      return {
        company: {
          id: companyId,
          name: "Pricing Page Studio",
          status: "active",
          playbookId: "ai-saas",
        },
      };
    },
    async getTaskProof(taskId) {
      return {
        proof: [
          {
            id: "proof_1",
            taskId,
            type: "command_output",
            uri: "agent.log",
            summary: "Generated landing page",
          },
        ],
      };
    },
    async getCompanyReviews(companyId) {
      return {
        reviews: [
          {
            id: "review_1",
            companyId,
            summary: "Ready for next cycle",
            reviewPath: ".auto-crop/reviews/review_1.md",
            createdAt: "2026-08-17T00:00:00.000Z",
          },
        ],
      };
    },
    async triggerKillSwitch(companyId) {
      return {
        paused: true,
        company: {
          id: companyId,
          name: "Pricing Page Studio",
          status: "review",
          playbookId: "ai-saas",
        },
      };
    },
    subscribeEvents(handler) {
      this.lastEventHandler = handler;
      return () => undefined;
    },
  };
}
