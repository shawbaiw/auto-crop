// @vitest-environment jsdom
import "./test/setup";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import type {
  ApiClient,
  BusinessArtifactSummary,
  CeoAttentionRollupSummary,
  CeoOfficeItemSummary,
  FounderDecisionSummary,
  HumanActionSummary,
  ReplanProposalSummary,
  ServerEvent,
  TaskAffordanceKind,
  TaskAffordanceSummary,
  TaskCompletionEventSummary,
  VisionGapSummary,
  WaitStateSummary,
} from "./api/client";

describe("Dashboard App", () => {
  it("starts on the company-name step only", async () => {
    const api = createMockApiClient();

    render(<App apiClient={api} />);

    expect(await screen.findByRole("heading", { name: "CEO Office" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "CEO Office" })).toBeInTheDocument();
    expect(document.querySelector("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Step 1 / Company Name" })).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Step 2 / Choose CEO" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Founder vision")).not.toBeInTheDocument();
    expect(api.listCompanies).toHaveBeenCalledTimes(1);
    expect(api.listAgents).not.toHaveBeenCalled();
    expect(api.subscribeEvents).not.toHaveBeenCalled();
  });

  it("shows the company list load failure detail", async () => {
    const api = createMockApiClient();
    api.listCompanies = vi.fn(async () => {
      throw new Error("Expected JSON from /api/companies but received text/html.");
    });

    render(<App apiClient={api} />);

    expect(await screen.findByText("Could not load companies from the local API.")).toBeInTheDocument();
    expect(screen.getByText("Expected JSON from /api/companies but received text/html.")).toBeInTheDocument();
  });

  it("retries company loading without passing the click event as load options", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();
    api.listCompanies = vi
      .fn()
      .mockRejectedValueOnce(new Error("Request timed out after 10000ms: http://127.0.0.1:8787/api/companies"))
      .mockResolvedValueOnce({
        companies: [
          {
            id: "company_2",
            name: "Ops Lab",
            status: "active",
            playbookId: "ai-saas",
            selectedCeoAgentId: "codex",
            createdAt: "2026-08-17T00:00:00.000Z",
            updatedAt: "2026-08-18T00:00:00.000Z",
            taskCount: 2,
          },
        ],
      });

    const getCompanyState = vi.spyOn(api, "getCompanyState");

    render(<App apiClient={api} />);

    expect(await screen.findByText("Request timed out after 10000ms: http://127.0.0.1:8787/api/companies")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByRole("navigation", { name: "Workbench" })).toBeInTheDocument();
    expect(api.listCompanies).toHaveBeenCalledTimes(2);
    expect(getCompanyState).toHaveBeenCalledWith("company_2");
  });

  it("opens the most recently updated active company when browser storage has no current company", async () => {
    const api = createMockApiClient();
    const listed = (id: string, status: string, updatedAt: string) => ({
      id,
      name: id,
      status,
      playbookId: "ai-saas",
      selectedCeoAgentId: "codex",
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt,
      taskCount: 2,
    });
    api.listCompanies = vi.fn(async () => ({
      companies: [
        listed("company_old_active", "active", "2026-08-18T00:00:00.000Z"),
        listed("company_stopped", "stopped", "2026-08-21T00:00:00.000Z"),
        listed("company_2", "active", "2026-08-20T00:00:00.000Z"),
      ],
    }));
    api.getCompanyState = vi.fn(async (companyId: string) => {
      const created = createCompanyResponse();
      return {
        ...created,
        company: { ...created.company, id: companyId, name: "Ops Lab", status: "active", selectedCeoAgentId: "codex" },
        proof: [],
        reviews: [],
        activity: [],
        replanProposals: created.replanProposals ?? [],
      };
    });

    render(<App apiClient={api} />);

    // There is no picker page: the app opens a company by itself (dashboard ADR 0002), on CEO Office.
    expect(await screen.findByRole("heading", { name: "Ops Lab" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CEO Office" })).toHaveAttribute("aria-current", "page");
    expect(api.getCompanyState).toHaveBeenCalledTimes(1);
    expect(api.getCompanyState).toHaveBeenCalledWith("company_2");
    expect(window.localStorage.getItem("auto-crop.currentCompanyId")).toBe("company_2");
  });

  it("opens a failed creation at startup only when it is the last choice", async () => {
    const api = createMockApiClient();
    api.listCompanies = vi.fn(async () => ({
      companies: [
        { id: "company_failed", name: "Failed Lab", status: "creation_failed", playbookId: "ai-saas", createdAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-22T00:00:00.000Z", taskCount: 0 },
        { id: "company_stopped", name: "Stopped Lab", status: "stopped", playbookId: "ai-saas", createdAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z", taskCount: 1 },
      ],
    }));
    api.getCompanyState = vi.fn(async (companyId: string) => {
      const created = createCompanyResponse();
      return { ...created, company: { ...created.company, id: companyId, status: "stopped" }, proof: [], reviews: [], activity: [], replanProposals: [] };
    });

    render(<App apiClient={api} />);

    expect(await screen.findByRole("navigation", { name: "Workbench" })).toBeInTheDocument();
    expect(api.getCompanyState).toHaveBeenCalledTimes(1);
    expect(api.getCompanyState).toHaveBeenCalledWith("company_stopped");
  });

  it("prefers a paused company over newer stopped or failed ones when none is active", async () => {
    const api = createMockApiClient();
    api.listCompanies = vi.fn(async () => ({
      companies: [
        { id: "company_failed", name: "Failed Lab", status: "creation_failed", playbookId: "ai-saas", createdAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-22T00:00:00.000Z", taskCount: 0 },
        { id: "company_stopped_newer", name: "Stopped Newer", status: "stopped", playbookId: "ai-saas", createdAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-21T00:00:00.000Z", taskCount: 1 },
        { id: "company_paused", name: "Paused Lab", status: "paused", playbookId: "ai-saas", createdAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-19T00:00:00.000Z", taskCount: 1 },
        { id: "company_stopped", name: "Stopped Lab", status: "stopped", playbookId: "ai-saas", createdAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z", taskCount: 1 },
      ],
    }));
    api.getCompanyState = vi.fn(async (companyId: string) => {
      const created = createCompanyResponse();
      return { ...created, company: { ...created.company, id: companyId, status: "paused" }, proof: [], reviews: [], activity: [], replanProposals: [] };
    });

    render(<App apiClient={api} />);

    expect(await screen.findByRole("navigation", { name: "Workbench" })).toBeInTheDocument();
    expect(api.getCompanyState).toHaveBeenCalledWith("company_paused");
    expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument();
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

  it("uses the entered company name as the onboarding modal title", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await user.type(await screen.findByLabelText("Company name"), "MATT");

    expect(screen.getByRole("region", { name: "MATT" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "MATT" })).toBeInTheDocument();
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

  it("shows the creation loading page immediately after Create Company", async () => {
    const api = createMockApiClient();
    const created = createDeferred<Awaited<ReturnType<ApiClient["createCompany"]>>>();
    api.createCompany = vi.fn(() => created.promise);
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await fillReadyToCreate(user);
    await user.click(screen.getByRole("button", { name: /create company/i }));

    expect(await screen.findByRole("heading", { level: 1, name: "Creating Company" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Creating Company" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Company Creation Trace" })).toBeInTheDocument();
    expect(document.querySelector("dialog")).not.toBeInTheDocument();
    // Before the server accepts the request there is no event timestamp, so no elapsed time is shown.
    expect(screen.queryByText("Running for")).not.toBeInTheDocument();
    expect(screen.getAllByText("Pricing Page Studio").length).toBeGreaterThan(0);
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Accept creation request")).toBeInTheDocument();
    expect(screen.getByText("Generate company blueprint")).toBeInTheDocument();
    expect(screen.getByText("Parse blueprint")).toBeInTheDocument();
    expect(screen.getByText("Create departments and tasks")).toBeInTheDocument();
    expect(screen.getByText("Company ready")).toBeInTheDocument();

    created.resolve(createCompanyResponse());
    expect(await screen.findByRole("heading", { name: "Pricing Page Studio" })).toBeInTheDocument();
  });

  it("keeps watching async company creation and opens the workspace when creation completes", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();
    api.createCompany = vi.fn(async () => createCreatingCompanyResponse());
    api.getCompanyState = vi.fn(async () => ({
      ...createCompanyResponse(),
      proof: [],
      reviews: [],
      activity: [],
      replanProposals: [],
    }));

    render(<App apiClient={api} />);

    await fillReadyToCreate(user);
    await user.click(screen.getByRole("button", { name: /create company/i }));

    expect(await screen.findByText("Accept creation request")).toBeInTheDocument();
    expect(api.subscribeEvents).toHaveBeenCalledWith("company_1", expect.any(Function), expect.any(Function));

    act(() => {
      api.lastEventHandler?.({
        type: "company_creation_completed",
        companyId: "company_1",
        message: "Company Creation completed.",
        status: "active",
      });
    });

    expect(await screen.findByRole("navigation", { name: "Workbench" }, { timeout: 2500 })).toBeInTheDocument();
    expect(api.getCompanyState).toHaveBeenCalledWith("company_1");
  });

  it("leaves the creation view when creation completed before the event stream connected", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();
    let openStream: (() => void) | undefined;
    api.createCompany = vi.fn(async () => createCreatingCompanyResponse());
    api.getCompanyState = vi.fn(async () => ({
      ...createCompanyResponse(),
      proof: [],
      reviews: [],
      activity: [],
      replanProposals: [],
    }));
    api.subscribeEvents = vi.fn((_companyId, _handler, onOpen) => {
      openStream = onOpen;
      return () => undefined;
    });

    render(<App apiClient={api} />);

    await fillReadyToCreate(user);
    await user.click(screen.getByRole("button", { name: /create company/i }));
    expect(await screen.findByText("Accept creation request")).toBeInTheDocument();

    // The completion event was published before this subscriber existed, so it never arrives.
    act(() => openStream?.());

    expect(await screen.findByRole("navigation", { name: "Workbench" }, { timeout: 2500 })).toBeInTheDocument();
    expect(api.getCompanyState).toHaveBeenCalledWith("company_1");
  });

  it("shows failed company creation and retries it from the loading view", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();
    api.createCompany = vi.fn(async () => createFailedCompanyCreationResponse());
    api.retryCompanyCreation = vi.fn(async () => createCreatingCompanyResponse());

    render(<App apiClient={api} />);

    await fillReadyToCreate(user);
    await user.click(screen.getByRole("button", { name: /create company/i }));

    expect(await screen.findByText("Codex ran into an error")).toBeInTheDocument();
    // A failed creation is retried or left, never abandoned from this page.
    expect(screen.queryByRole("button", { name: "Stop and abandon this company" })).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "CEO agent blueprint generation in progress" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry creation/i }));

    expect(api.retryCompanyCreation).toHaveBeenCalledWith("company_1");
    expect(await screen.findByText("Accept creation request")).toBeInTheDocument();
  });

  it("leaves a failed creation for another company", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();
    api.createCompany = vi.fn(async () => createFailedCompanyCreationResponse());
    api.listCompanies = vi
      .fn()
      .mockResolvedValueOnce({ companies: [] })
      .mockResolvedValue({
        companies: [
          { id: "company_1", name: "Pricing Page Studio", status: "creation_failed", playbookId: "ai-saas", createdAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-19T00:00:00.000Z", taskCount: 0 },
          { id: "company_2", name: "Ops Lab", status: "paused", playbookId: "ai-saas", createdAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-17T00:00:00.000Z", taskCount: 2 },
        ],
      });
    const created = createCompanyResponse();
    api.getCompanyState = vi.fn(async (companyId: string) => ({
      ...created,
      company: { ...created.company, id: companyId, name: "Ops Lab", status: "paused" },
      proof: [],
      reviews: [],
      activity: [],
      replanProposals: [],
    }));

    render(<App apiClient={api} />);
    await fillReadyToCreate(user);
    await user.click(screen.getByRole("button", { name: /create company/i }));

    await user.click(await screen.findByRole("button", { name: "Back to another company" }));

    expect(await screen.findByRole("heading", { name: "Ops Lab" })).toBeInTheDocument();
    expect(api.getCompanyState).toHaveBeenCalledWith("company_2");
    expect(api.stopCompany).not.toHaveBeenCalled();
  });

  it("starts afresh from a failed creation when no other company exists", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();
    api.createCompany = vi.fn(async () => createFailedCompanyCreationResponse());

    render(<App apiClient={api} />);
    await fillReadyToCreate(user);
    await user.click(screen.getByRole("button", { name: /create company/i }));

    const nextSteps = await screen.findByRole("region", { name: "What happens to this company" });
    await user.click(within(nextSteps).getByRole("button", { name: "Create New Company" }));

    expect(await screen.findByLabelText("Company name")).toBeInTheDocument();
    expect(api.stopCompany).not.toHaveBeenCalled();
    // There is nothing to go back to: the failed company is not offered as a way back.
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("restores a company still being created with its own CEO and permission mode", async () => {
    const restoreStorage = installMockLocalStorage({ "auto-crop.currentCompanyId": "company_1" });
    const api = createMockApiClient();
    const creating = createCreatingCompanyResponse();
    api.getCompanyState = vi.fn(async () => ({
      ...creating,
      company: { ...creating.company, permissionMode: "autonomous" },
      proof: [],
      reviews: [],
      activity: [],
      replanProposals: [],
    }));

    try {
      render(<App apiClient={api} />);

      const summary = await screen.findByRole("region", { name: "Creating Company" });
      expect(within(summary).getByText("Autonomous")).toBeInTheDocument();
      expect(await within(summary).findByText("Codex")).toBeInTheDocument();
    } finally {
      restoreStorage();
    }
  });

  it("shows creation stages in the interface language", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();
    const creating = createCreatingCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...creating,
      creationEvents: [
        {
          type: "company_creation_accepted",
          companyId: "company_1",
          message: "Company Creation accepted.",
          messageText: { en: "Company Creation accepted.", zh: "已接受公司创建。" },
          status: "creating",
        },
      ],
    }));

    render(<App apiClient={api} />);

    await fillReadyToCreate(user);
    await user.click(screen.getByRole("button", { name: /create company/i }));
    expect(await screen.findByText("Accept creation request")).toBeInTheDocument();

    await user.click(within(screen.getByRole("group", { name: "Language" })).getByRole("button", { name: "中文" }));

    expect(await screen.findByText("接收创建请求")).toBeInTheDocument();
  });

  it("opens CEO Office after creation, with the timeline, a text composer and what needs the founder", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompany(user);

    expect(screen.getByRole("navigation", { name: "Workbench" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CEO Office" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Engineering" })).toBeInTheDocument();
    // The centre column: Timeline, Plan and Outcomes, with the text-only composer docked below.
    expect(screen.getByRole("tab", { name: "Timeline" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Outcomes" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Timeline" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message to the CEO" })).toBeInTheDocument();
    // The right column: "Needs you".
    expect(needsYouColumn()).toHaveTextContent("Nothing needs you now.");
    // No Retro UI is left on the page.
    expect(document.querySelector("[class*='retro-'], .theme-root, .legacy-workspace")).toBeNull();
    expect(screen.queryByText("Playbook")).not.toBeInTheDocument();
  });

  it("lists what needs the founder: overview counts first, then a card per review, decision, Human Action and new plan", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    const decision = createFounderDecisionSummary({ taskId: "task_2", departmentId: "department_1" });
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [
        { ...created.tasks[0], id: "task_1", title: "Validate the prototype", status: "review", affordances: offered("ceo_review_decision") },
        { ...created.tasks[0], id: "task_2", title: "Choose the first market", status: "review" },
        { ...created.tasks[0], id: "task_3", title: "Publish the prototype", status: "blocked" },
        { ...created.tasks[0], id: "task_4", title: "Monitor indexing", status: "running" },
        { ...created.tasks[0], id: "task_5", title: "Write launch copy", status: "complete" },
        // Only the founder can move this one; the runtime has no way forward for it.
        { ...created.tasks[0], id: "task_6", title: "Fix the checkout", status: "blocked", affordances: offered("request_replan") },
        // The runtime can still recover this one, so it is counted as stuck but has no card.
        {
          ...created.tasks[0], id: "task_7", title: "Retry the import", status: "failed",
          affordances: [...offered("request_replan"), { kind: "recover_task" as const, actor: "runtime" as const, holdId: "hold_7", holdKind: null, subjectKind: null, subjectId: null }],
        },
      ],
      founderDecisions: [decision],
      humanActions: [{ ...createHumanActionSummary(), taskId: "task_3" }],
      waitStates: [createWaitStateSummary()],
      replanProposals: [{ ...createReplanProposalSummary(), sourceTaskId: "task_3" }],
      ceoOfficeItems: [
        createApprovalRequestCeoOfficeItem({ businessArtifactId: "business_artifact_1", taskId: "task_1", title: "Validate the prototype" }),
        createDecisionRequestCeoOfficeItem(decision, "Choose the first market"),
        createHumanActionCeoOfficeItem({ ...createHumanActionSummary(), taskId: "task_3" }, "Publish the prototype"),
        {
          id: "wait_state:wait_1", type: "wait_state", companyId: "company_1", sourceId: "wait_1",
          taskId: "task_4", departmentId: "department_1", objectiveId: null, keyResultId: null,
          occurredAt: "2026-08-17T00:05:00.000Z", title: "Monitor indexing", titleText: null, actionBearing: false,
          data: { reason: { en: "Wait for search indexing signals." }, status: "waiting", nextCheckAt: "2026-08-18T00:00:00.000Z", affectedTaskIds: ["task_4"] },
        },
        {
          id: "blocked_issue:block_1", type: "blocked_issue", companyId: "company_1", sourceId: "block_1",
          taskId: "task_3", departmentId: "department_1", objectiveId: null, keyResultId: null,
          occurredAt: "2026-08-17T00:06:00.000Z", title: "Publish the prototype", titleText: null, actionBearing: true,
          data: { reason: { en: "The deployment did not finish." }, status: "open", affectedTaskIds: ["task_3"] },
        },
      ] satisfies CeoOfficeItemSummary[],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    const column = needsYouColumn();
    const overview = within(column).getByLabelText("Overview");
    expect(overview).toHaveTextContent("Done1/7");
    expect(overview).toHaveTextContent("Running1");
    expect(overview).toHaveTextContent("Stuck3");
    expect(overview).toHaveTextContent("Waiting1");
    expect(Boolean(overview.compareDocumentPosition(within(column).getByRole("region", { name: "Needs your review" })) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    expect(within(column).getByRole("region", { name: "Needs your review" })).toHaveTextContent("Validate the prototype");
    expect(within(column).getByRole("region", { name: "Needs your decision" })).toHaveTextContent("Choose the first market");
    expect(within(column).getByRole("region", { name: "Needs your action" })).toHaveTextContent("Publish the prototype");
    expect(within(column).getByRole("region", { name: "New plans" })).toHaveTextContent("A new plan for “Publish the prototype” waits for you to confirm.");
    const waitsOnYou = within(column).getByRole("region", { name: "Waits on you" });
    expect(waitsOnYou).toHaveTextContent("Fix the checkout");
    expect(waitsOnYou).toHaveTextContent("This task cannot go on as planned. Ask for a new plan.");
    expect(waitsOnYou).not.toHaveTextContent("Retry the import");
    // A wait, and a stuck task the runtime can still handle, are counted, not listed.
    expect(column).not.toHaveTextContent("Wait for search indexing signals.");
    expect(column).not.toHaveTextContent("The deployment did not finish.");

    // The rail counts exactly what the column lists: one review, one decision, one Human Action,
    // one new plan and one task only the founder can move.
    expect(within(screen.getByRole("navigation", { name: "Workbench" })).getByRole("button", { name: "CEO Office" })).toHaveAccessibleDescription("5 need you");
    expect(within(column).getAllByRole("article")).toHaveLength(5);
    // The cards open the item; the decision is never made on the card itself.
    expect(within(column).queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();

    // New plans are reviewed on the department page of their task, which opens with that task in view.
    await user.click(within(within(column).getByRole("region", { name: "New plans" })).getByRole("button", { name: "Open the new plan" }));
    expect(screen.getByRole("button", { name: "Engineering" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: "Publish the prototype" })).toBeInTheDocument();
  });

  it("derives Needs you from action-bearing CEO Office Items", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    const ceoOfficeItems: CeoOfficeItemSummary[] = [
      {
        id: "execution_report:task_completion_event_1",
        type: "execution_report",
        companyId: "company_1",
        sourceId: "task_completion_event_1",
        taskId: "task_1",
        departmentId: "department_1",
        objectiveId: null,
        keyResultId: null,
        occurredAt: "2026-08-17T00:02:00.000Z",
        title: "Connect analytics account",
        titleText: null,
        actionBearing: false,
        data: {
          conclusion: { en: "Analytics is ready to connect." },
          visionImpact: null,
          remainingGap: null,
          recommendation: null,
          summaryFallback: null,
          businessArtifactId: null,
          remainingGaps: [],
          recommendedNextSteps: [],
          outcome: "accepted",
        },
      },
      {
        id: "human_action:task_completion_event_1_human_action_1",
        type: "human_action",
        companyId: "company_1",
        sourceId: "task_completion_event_1_human_action_1",
        taskId: "task_1",
        departmentId: "department_1",
        objectiveId: null,
        keyResultId: null,
        occurredAt: "2026-08-17T00:03:00.000Z",
        title: "Connect analytics account",
        titleText: null,
        actionBearing: true,
        data: {
          label: { en: "Connect the analytics account." },
          status: "pending",
          confirmationRequirements: ["Account connected screenshot"],
          blockedTaskIds: ["task_2"],
          verifiedAt: null,
        },
      },
      {
        id: "wait_state:task_completion_event_1_wait_state_1",
        type: "wait_state",
        companyId: "company_1",
        sourceId: "task_completion_event_1_wait_state_1",
        taskId: "task_1",
        departmentId: "department_1",
        objectiveId: null,
        keyResultId: null,
        occurredAt: "2026-08-17T00:04:00.000Z",
        title: "Connect analytics account",
        titleText: null,
        actionBearing: false,
        data: {
          reason: { en: "Wait for first analytics import." },
          status: "waiting",
          nextCheckAt: "2026-08-18T00:00:00.000Z",
          affectedTaskIds: ["task_2"],
        },
      },
    ];
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [
        { ...created.tasks[0], title: "Connect analytics account", status: "complete" },
      ],
      ceoOfficeItems,
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    const column = needsYouColumn();
    const actions = within(column).getByRole("region", { name: "Needs your action" });
    expect(actions).toHaveTextContent("Connect analytics account");
    expect(actions).toHaveTextContent("Engineering");
    // The result and the wait stay in the timeline; only the action is a card here.
    expect(within(column).getAllByRole("article")).toHaveLength(1);
    expect(column).not.toHaveTextContent("Analytics is ready to connect.");
    expect(column).not.toHaveTextContent("Wait for first analytics import.");
  });

  it("renders stage changes, final reports, and decision resolutions in the CEO Office Timeline", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      ceoOfficeItems: [
        {
          id: "stage_change:objective_1",
          type: "stage_change",
          companyId: "company_1",
          sourceId: "rollup_1",
          taskId: null,
          departmentId: null,
          objectiveId: "objective_1",
          keyResultId: null,
          occurredAt: "2026-08-17T00:03:00.000Z",
          title: "Objective complete",
          titleText: null,
          actionBearing: false,
          data: {
            summary: { en: "The objective is complete or stopped after validation." },
            recommendedNextAction: { en: "Prepare the closing summary." },
            affectedTaskIds: ["task_1"],
          },
        },
        {
          id: "decision_resolution:decision_1",
          type: "decision_resolution",
          companyId: "company_1",
          sourceId: "decision_1",
          taskId: "task_1",
          departmentId: "department_1",
          objectiveId: null,
          keyResultId: null,
          occurredAt: "2026-08-17T00:04:00.000Z",
          title: "Choose launch target",
          titleText: null,
          actionBearing: false,
          data: {
            requestItemId: "decision_request:decision_1",
            outcome: "resolved",
            chosenOption: "Clinics",
            note: { en: "Start where urgency is clearest." },
          },
        },
        {
          id: "final_report:report_1",
          type: "final_report",
          companyId: "company_1",
          sourceId: "report_1",
          taskId: null,
          departmentId: null,
          objectiveId: null,
          keyResultId: null,
          occurredAt: "2026-08-17T00:05:00.000Z",
          title: "Final Founder Report",
          titleText: null,
          actionBearing: false,
          data: {
            classification: "achieved",
            sections: {
              vision: { en: "Build a sustainable business." },
              actualResult: { en: "A proof-backed pilot offer is ready." },
              departmentContributions: [{ en: "Product validated the offer." }],
              goalFit: { en: "The objective is complete." },
              remainingGaps: { en: "No blocking gaps remain." },
              recommendedNextStep: { en: "Start founder-led sales." },
            },
            isCurrent: true,
            supersedesReportId: null,
          },
        },
      ] satisfies CeoOfficeItemSummary[],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    const timeline = ceoTimeline();
    // Each item is a summary card: type tag + title + one key line.
    expect(timeline).toHaveTextContent("Goal progress");
    expect(timeline).toHaveTextContent("The objective is complete or stopped after validation.");
    expect(timeline).toHaveTextContent("Your decision");
    expect(timeline).toHaveTextContent("Start where urgency is clearest.");
    expect(timeline).toHaveTextContent("Final report");
    expect(timeline).toHaveTextContent("A proof-backed pilot offer is ready.");
    // The chosen option and the report's next step are detail — behind the card, not on it.
    expect(timeline).not.toHaveTextContent("Clinics");
    expect(timeline).not.toHaveTextContent("Start founder-led sales.");

    // Oldest first, newest at the bottom beside the composer.
    expect(cardLabels(timeline)).toEqual([
      "Open Goal progress: Objective complete",
      "Open Your decision: Choose launch target",
      "Open Final report: Final Founder Report",
    ]);

    // Activating a card opens a modal with the full detail.
    await user.click(within(timeline).getByRole("button", { name: "Open Your decision: Choose launch target" }));
    const resolutionModal = screen.getByRole("dialog");
    expect(resolutionModal).toHaveTextContent("Clinics");
    await user.click(within(resolutionModal).getByRole("button", { name: "Close" }));

    await user.click(within(timeline).getByRole("button", { name: "Open Final report: Final Founder Report" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Start founder-led sales.");
  });

  it("marks an Execution Report field that is missing the company locale as untranslated and logs it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      company: { ...created.company, locale: "zh" as const },
      ceoOfficeItems: [
        {
          id: "execution_report:task_completion_event_1",
          type: "execution_report",
          companyId: "company_1",
          sourceId: "task_completion_event_1",
          taskId: "task_1",
          departmentId: "department_1",
          objectiveId: null,
          keyResultId: null,
          occurredAt: "2026-08-17T00:02:00.000Z",
          title: "连接分析账户",
          titleText: null,
          actionBearing: false,
          data: {
            conclusion: { zh: "分析已准备好连接。" },
            visionImpact: { en: "English-only vision impact." },
            remainingGap: null,
            recommendation: null,
            summaryFallback: null,
            businessArtifactId: null,
            remainingGaps: [],
            recommendedNextSteps: [],
            outcome: "accepted",
          },
        },
      ] satisfies CeoOfficeItemSummary[],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    // The company-locale (zh) conclusion renders on the card as-is.
    expect(await screen.findByText("分析已准备好连接。")).toBeInTheDocument();

    // The vision impact is detail; opening the card shows the visible marker rather than silently
    // falling back to English, and logs the gap.
    await user.click(screen.getByRole("button", { name: "打开成果：连接分析账户" }));
    const modal = screen.getByRole("dialog");
    expect(within(modal).getByText("未翻译 / untranslated")).toBeInTheDocument();
    expect(screen.queryByText("English-only vision impact.")).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing the company locale "zh"'));

    warn.mockRestore();
  });

  it("renders wait-state, blocked-issue, and human-action strings through the company-locale path", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      company: { ...created.company, locale: "zh" as const },
      tasks: [{ ...created.tasks[0], id: "task_1", title: "监控首次导入", status: "blocked" }],
      ceoOfficeItems: [
        {
          id: "human_action:action_1", type: "human_action", companyId: "company_1", sourceId: "action_1",
          taskId: "task_1", departmentId: "department_1", objectiveId: null, keyResultId: null,
          occurredAt: "2026-08-17T00:03:00.000Z", title: "连接分析账户", titleText: null, actionBearing: true,
          data: { label: { zh: "连接分析账户。" }, status: "pending", confirmationRequirements: [], blockedTaskIds: [], verifiedAt: null },
        },
        {
          id: "wait_state:wait_1", type: "wait_state", companyId: "company_1", sourceId: "wait_1",
          taskId: "task_1", departmentId: "department_1", objectiveId: null, keyResultId: null,
          occurredAt: "2026-08-17T00:04:00.000Z", title: "监控首次导入", titleText: null, actionBearing: false,
          data: { reason: { zh: "等待首次分析导入。" }, status: "waiting", nextCheckAt: "2026-08-18T00:00:00.000Z", affectedTaskIds: ["task_1"] },
        },
        {
          id: "blocked_issue:block_1", type: "blocked_issue", companyId: "company_1", sourceId: "block_1",
          taskId: "task_1", departmentId: "department_1", objectiveId: null, keyResultId: null,
          occurredAt: "2026-08-17T00:05:00.000Z", title: "监控首次导入", titleText: null, actionBearing: true,
          data: { reason: { en: "English-only blocker." }, status: "open", affectedTaskIds: ["task_1"] },
        },
      ] satisfies CeoOfficeItemSummary[],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    // The company locale is zh, so the chrome (and region names) render in Chinese.
    const timeline = screen.getByRole("region", { name: "时间线" });
    expect(timeline).toHaveTextContent("连接分析账户。");
    expect(timeline).toHaveTextContent("等待首次分析导入。");
    // The blocker only carries `en`, so the founder sees the untranslated marker, not silent English.
    expect(timeline).not.toHaveTextContent("English-only blocker.");
    expect(within(timeline).getAllByText("未翻译 / untranslated").length).toBeGreaterThan(0);

    warn.mockRestore();
  });

  it("renders the Timeline in the company canonical locale even when the interface toggle is the other language", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    // The company was created in English; the interface toggle is switched to Chinese below. The
    // timeline is the founder's broadcast surface, so its content must follow the company locale,
    // not the toggle — otherwise the card reads half in one language and half in the other.
    api.createCompany = vi.fn(async () => ({
      ...created,
      company: { ...created.company, locale: "en" as const },
      departments: [{ ...created.departments[0], id: "department_1", name: "Product", nameText: { en: "Product", zh: "产品" } }],
      tasks: [
        { ...created.tasks[0], id: "task_1", title: "Define the revenue path", titleText: { en: "Define the revenue path", zh: "定义收入路径" } },
        { ...created.tasks[0], id: "task_2", title: "Research the keyword", titleText: { en: "Research the keyword", zh: "研究关键词" } },
      ],
      ceoOfficeItems: [
        {
          id: "task_brief:task_1", type: "task_brief", companyId: "company_1", sourceId: "task_1",
          taskId: "task_1", departmentId: "department_1", objectiveId: null, keyResultId: null,
          occurredAt: "2026-08-17T00:02:00.000Z", title: "Define the revenue path",
          titleText: { en: "Define the revenue path", zh: "定义收入路径" }, actionBearing: false,
          data: {
            purpose: { en: "Turn the opportunity into a brief", zh: "把机会转化为简报" },
            purposeSource: "task_definition", founderVision: "Vision",
            objectiveTitle: null, keyResultTitle: null, keyResultMetricName: null, keyResultTargetValue: null,
            dependsOnTaskIds: ["task_2"],
          },
        },
      ] satisfies CeoOfficeItemSummary[],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    await switchLanguage(user, "中文");

    // Chrome follows the toggle...
    const timeline = screen.getByRole("region", { name: "时间线" });
    // ...but every value inside the timeline stays in the company locale (en).
    expect(timeline).toHaveTextContent("Define the revenue path");
    expect(timeline).toHaveTextContent("Turn the opportunity into a brief");
    expect(timeline).toHaveTextContent("Research the keyword");
    expect(timeline).toHaveTextContent("Product");
    expect(timeline).not.toHaveTextContent("定义收入路径");
    expect(timeline).not.toHaveTextContent("把机会转化为简报");
    expect(timeline).not.toHaveTextContent("研究关键词");
    expect(timeline).not.toHaveTextContent("产品");
  });

  it("renders action-bearing CEO Office Items in the Timeline with business details", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [
        { ...created.tasks[0], id: "task_1", title: "Choose pricing path", status: "review", affordances: offered("ceo_review_decision") },
        { ...created.tasks[0], id: "task_2", title: "Connect Stripe", status: "blocked" },
        { ...created.tasks[0], id: "task_3", title: "Monitor first import", status: "queued" },
        { ...created.tasks[0], id: "task_4", title: "Recover launch proof", status: "failed" },
      ],
      ceoOfficeItems: [
        {
          id: "decision_request:decision_1",
          type: "decision_request",
          companyId: "company_1",
          sourceId: "decision_1",
          taskId: "task_1",
          departmentId: "department_1",
          objectiveId: "objective_1",
          keyResultId: null,
          occurredAt: "2026-08-17T00:02:00.000Z",
          title: "Choose pricing path",
          titleText: null,
          actionBearing: true,
          data: {
            decisionKind: "pricing_model",
            options: [
              { label: "Subscription", tradeoffs: "Recurring revenue.", recommended: true },
              { label: "One-time", tradeoffs: "Lower buying friction.", recommended: false },
            ],
            rationale: "Pricing affects the first offer.",
            briefing: "We tested subscription and one-time against early buyers; recurring revenue vs. buying friction is the trade.",
            status: "pending",
            resolvedOption: null,
            resolvedAt: null,
            blockedTaskIds: ["task_2"],
          },
        },
        createApprovalRequestCeoOfficeItem({
          businessArtifactId: "business_artifact_1",
          taskId: "task_1",
          title: "Review pricing artifact",
        }),
        {
          id: "human_action:action_1",
          type: "human_action",
          companyId: "company_1",
          sourceId: "action_1",
          taskId: "task_2",
          departmentId: "department_1",
          objectiveId: null,
          keyResultId: null,
          occurredAt: "2026-08-17T00:04:00.000Z",
          title: "Connect Stripe",
          titleText: null,
          actionBearing: true,
          data: {
            label: { en: "Connect the Stripe account." },
            status: "pending",
            confirmationRequirements: ["Paste the account confirmation."],
            blockedTaskIds: ["task_3"],
            verifiedAt: null,
          },
        },
        {
          id: "wait_state:wait_1",
          type: "wait_state",
          companyId: "company_1",
          sourceId: "wait_1",
          taskId: "task_3",
          departmentId: "department_1",
          objectiveId: null,
          keyResultId: null,
          occurredAt: "2026-08-17T00:05:00.000Z",
          title: "Monitor first import",
          titleText: null,
          actionBearing: false,
          data: {
            reason: { en: "Wait for the first payment import." },
            status: "waiting",
            nextCheckAt: "2026-08-18T00:00:00.000Z",
            affectedTaskIds: ["task_3"],
          },
        },
        {
          id: "blocked_issue:block_1",
          type: "blocked_issue",
          companyId: "company_1",
          sourceId: "block_1",
          taskId: "task_4",
          departmentId: "department_1",
          objectiveId: null,
          keyResultId: null,
          occurredAt: "2026-08-17T00:06:00.000Z",
          title: "Recover launch proof",
          titleText: null,
          actionBearing: true,
          data: {
            reason: { en: "Expected deliverable was not recorded." },
            status: "open",
            affectedTaskIds: ["task_4"],
          },
        },
      ] satisfies CeoOfficeItemSummary[],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    const timeline = ceoTimeline();

    // Cards are summaries: type tag + title + one key line. The Decision card leads with the briefing.
    expect(timeline).toHaveTextContent("Needs your decision");
    expect(timeline).toHaveTextContent("We tested subscription and one-time against early buyers");
    expect(timeline).toHaveTextContent("Needs your review");
    expect(timeline).toHaveTextContent("Needs your action");
    expect(timeline).toHaveTextContent("Connect the Stripe account.");
    expect(timeline).toHaveTextContent("Waiting");
    expect(timeline).toHaveTextContent("Wait for the first payment import.");
    expect(timeline).toHaveTextContent("Stuck");
    expect(timeline).toHaveTextContent("Expected deliverable was not recorded.");
    expect(timeline).toHaveTextContent("Recover launch proof");

    // The table, options, trade-offs, rationale, statuses, and dates are detail — behind the card.
    expect(timeline).not.toHaveTextContent("Pricing affects the first offer.");
    expect(timeline).not.toHaveTextContent("Subscription");
    expect(timeline).not.toHaveTextContent("Recurring revenue.");
    expect(timeline).not.toHaveTextContent("Paste the account confirmation.");
    expect(timeline).not.toHaveTextContent("2026-08-18");
    expect(timeline).not.toHaveTextContent("workspace");
    expect(timeline).not.toHaveTextContent("business_artifact_1");
    expect(timeline).not.toHaveTextContent("task_2");
    expect(timeline).not.toHaveTextContent("pricing_model");
    expect(timeline).not.toHaveTextContent("ready_for_check_in");
    expect(timeline).not.toHaveTextContent("awaiting_founder_decision");

    // Cards that still need the founder carry a "your turn" tag; routine ones stay quiet.
    const yourTurnTag = (name: string) =>
      within(timeline).getByRole("button", { name }).closest("article")!.querySelector('[data-tone="yourTurn"]');
    expect(yourTurnTag("Open Needs your decision: Choose pricing path")).toHaveTextContent("Needs your decision");
    expect(yourTurnTag("Open Stuck: Recover launch proof")).toHaveTextContent("Stuck");
    expect(yourTurnTag("Open Waiting: Monitor first import")).toBeNull();

    // Opening the Decision card shows the options, trade-offs, rationale, and status as business language.
    await user.click(within(timeline).getByRole("button", { name: "Open Needs your decision: Choose pricing path" }));
    const modal = screen.getByRole("dialog");
    expect(modal).toHaveTextContent("Subscription");
    expect(modal).toHaveTextContent("Recurring revenue.");
    expect(modal).toHaveTextContent("Pricing affects the first offer.");
    expect(modal).toHaveTextContent("Waits for you");
    expect(modal).not.toHaveTextContent("pricing_model");
    expect(modal).not.toHaveTextContent("awaiting_founder_decision");
    expect(within(modal).getByRole("button", { name: "Choose: Subscription" })).toBeInTheDocument();
    expect(within(modal).getByRole("button", { name: "Open the department page" })).toBeInTheDocument();
    await user.click(within(modal).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // "Needs you" opens the same item, so the decision has one form.
    await user.click(within(needsYouColumn()).getByRole("button", { name: "Open: Choose pricing path" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Pricing affects the first offer.");
  });

  // The Attention Rollups panel (achievement-styled goal_stage_change entries, cross-department
  // exception entries, and quiescence suppression between them) was a dashboard-only rendering of
  // `ceoAttentionRollups` and has been removed as duplicating CEO Pending / the Timeline; the two
  // tests that lived here asserted only on that removed DOM (`.ceo-attention-rollup*`), not on the
  // server-side `projectCeoAttention` filtering itself, so there is nothing left here to assert.

  it("pins the Final Founder Report above the Outcomes view with its classification and sections", async () => {
    const api = createMockApiClient();
    const response = createFinalFounderReportCompanyResponse();
    api.createCompany = vi.fn(async () => response);
    api.getCompanyState = vi.fn(async () => ({
      ...response,
      proof: [],
      reviews: [],
      activity: [],
      replanProposals: response.replanProposals ?? [],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompany(user);

    await user.click(screen.getByRole("tab", { name: "Outcomes" }));
    const outcomes = screen.getByRole("tabpanel", { name: "Outcomes" });
    const panel = within(outcomes).getByRole("region", { name: "Final report" });

    // Pinned first, above every outcome card.
    expect(outcomes.querySelector("[role=region], article")).toBe(panel);

    expect(within(panel).getByText("Waits for you")).toBeInTheDocument();
    expect(within(panel).getByText("Restated vision for the founder.")).toBeInTheDocument();
    expect(within(panel).getByText("A proof-backed prototype shipped.")).toBeInTheDocument();
    expect(within(panel).getByText("Engineering built and validated the prototype.")).toBeInTheDocument();
    expect(within(panel).getByText("Monitor the search-indexing Wait State until 2026-08-27.")).toBeInTheDocument();
  });

  it("renders a deterministic_fallback report in the pinned panel identically to a ceo_agent one", async () => {
    const api = createMockApiClient();
    const base = createFinalFounderReportCompanyResponse();
    const response = {
      ...base,
      finalFounderReport: { ...base.finalFounderReport!, generatedBy: "deterministic_fallback" as const },
    };
    api.createCompany = vi.fn(async () => response);
    api.getCompanyState = vi.fn(async () => ({
      ...response,
      proof: [],
      reviews: [],
      activity: [],
      replanProposals: response.replanProposals ?? [],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompany(user);

    await user.click(screen.getByRole("tab", { name: "Outcomes" }));
    const outcomes = screen.getByRole("tabpanel", { name: "Outcomes" });
    const panel = within(outcomes).getByRole("region", { name: "Final report" });

    // Pinned first, above every outcome card.
    expect(outcomes.querySelector("[role=region], article")).toBe(panel);
    expect(within(panel).getByText("Waits for you")).toBeInTheDocument();
    expect(within(panel).getByText("Restated vision for the founder.")).toBeInTheDocument();
    expect(within(panel).getByText("A proof-backed prototype shipped.")).toBeInTheDocument();
    expect(within(panel).getByText("Engineering built and validated the prototype.")).toBeInTheDocument();
    expect(within(panel).getByText("Monitor the search-indexing Wait State until 2026-08-27.")).toBeInTheDocument();
  });

  it("shows the report-preparing state in the pinned panel from the indicator", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    const preparing = {
      ...created,
      finalFounderReport: null,
      finalFounderReportPreparing: true,
    };
    api.createCompany = vi.fn(async () => preparing);
    api.getCompanyState = vi.fn(async () => ({
      ...preparing,
      proof: [],
      reviews: [],
      activity: [],
      replanProposals: preparing.replanProposals ?? [],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompany(user);

    await user.click(screen.getByRole("tab", { name: "Outcomes" }));
    const panel = within(screen.getByRole("tabpanel", { name: "Outcomes" })).getByRole("region", { name: "Final report" });
    expect(within(panel).getByText("The CEO is writing the final report. It appears here when it is ready.")).toBeInTheDocument();
    expect(within(panel).queryByText("Waits for you")).not.toBeInTheDocument();
  });

  it("refetches Company State Snapshot on a company_report_ready event", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    const preparing = { ...created, finalFounderReport: null, finalFounderReportPreparing: true };
    api.createCompany = vi.fn(async () => preparing);
    const ready = createFinalFounderReportCompanyResponse();
    api.getCompanyState = vi.fn(async () => ({
      ...ready,
      finalFounderReportPreparing: false,
      proof: [],
      reviews: [],
      activity: [],
      replanProposals: ready.replanProposals ?? [],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompany(user);

    act(() => {
      api.lastEventHandler?.({
        type: "company_report_ready",
        companyId: "company_1",
        message: "Final Founder Report ready.",
      });
    });

    await waitFor(() => expect(api.getCompanyState).toHaveBeenCalledWith("company_1"));
    await user.click(screen.getByRole("tab", { name: "Outcomes" }));
    const panel = await within(screen.getByRole("tabpanel", { name: "Outcomes" })).findByRole("region", { name: "Final report" });
    expect(await within(panel).findByText("Restated vision for the founder.")).toBeInTheDocument();
  });

  it("sends a message to the CEO and shows the CEO's answer as a card when the assessment ends", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    const intake = { id: "ceo_intake_1", companyId: "company_1", body: "Add multiplayer mode.", createdAt: "2026-08-17T00:05:00.000Z", updatedAt: "2026-08-17T00:05:00.000Z" };
    const sent = {
      ...created,
      proof: [], reviews: [], activity: [], replanProposals: [],
      ceoIntakes: [{ ...intake, status: "received" as const }],
      ceoOfficeItems: [createFounderIntakeCeoOfficeItem(intake.id, intake.body, "received", intake.createdAt)],
    };
    const answered = {
      ...sent,
      tasks: [...created.tasks, { ...created.tasks[0], id: "task_2", title: "Build the multiplayer lobby", status: "queued" }],
      ceoIntakes: [{ ...intake, status: "dispatched" as const, outcome: "create_tasks" as const, createdTaskIds: ["task_2"], assessedAt: "2026-08-17T00:06:00.000Z" }],
      ceoOfficeItems: [
        createFounderIntakeCeoOfficeItem(intake.id, intake.body, "dispatched", intake.createdAt),
        createIntakeOutcomeCeoOfficeItem(intake.id, {
          status: "dispatched", outcome: "create_tasks", summary: { en: "I added a task to build the multiplayer lobby." }, createdTaskIds: ["task_2"],
        }),
      ],
    };
    api.getCompanyState = vi.fn(async () => sent);
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    await user.type(screen.getByRole("textbox", { name: "Message to the CEO" }), "Add multiplayer mode.");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(api.createCeoIntake).toHaveBeenCalledWith("company_1", { body: "Add multiplayer mode." });
    expect(screen.getByRole("textbox", { name: "Message to the CEO" })).toHaveValue("");
    // The founder's words come back from the server's projection as their own card.
    const founderCard = await within(ceoTimeline()).findByRole("article", { name: "You" });
    expect(founderCard).toHaveTextContent("Add multiplayer mode.");
    expect(founderCard).toHaveTextContent("CEO reads this soon.");

    // The assessment ends on the server and arrives as a company event.
    api.getCompanyState = vi.fn(async () => answered);
    act(() => {
      api.lastEventHandler?.({ type: "ceo_intake_updated", companyId: "company_1", message: "CEO answered founder input." });
    });

    const answer = await within(ceoTimeline()).findByRole("article", { name: "CEO: Added tasks" });
    expect(answer).toHaveTextContent("I added a task to build the multiplayer lobby.");
    expect(within(ceoTimeline()).getByRole("article", { name: "You" })).not.toHaveTextContent("CEO reads this soon.");
    // The new task arrives with the snapshot, and its card links to its department page.
    await user.click(within(answer).getByRole("button", { name: "Build the multiplayer lobby" }));
    expect(screen.getByRole("button", { name: "Engineering" })).toHaveAttribute("aria-current", "page");
  });

  it("explains in a plain sentence when the CEO could not handle a message, with the code under Details", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      ceoOfficeItems: [
        createFounderIntakeCeoOfficeItem("ceo_intake_1", "Change everything.", "failed", "2026-08-17T00:05:00.000Z"),
        createIntakeOutcomeCeoOfficeItem("ceo_intake_1", { status: "failed", outcome: null, summary: null, failureReason: "invalid_agent_output" }),
      ],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    const answer = within(ceoTimeline()).getByRole("article", { name: "CEO: Could not handle your message" });
    expect(answer).toHaveTextContent("The agent could not handle this message. Send it again.");
    const details = within(answer).getByText("Details").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("invalid_agent_output");
  });

  it("keeps a message for a paused company until it resumes", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      company: { ...created.company, status: "paused" },
      ceoOfficeItems: [createFounderIntakeCeoOfficeItem("ceo_intake_1", "Note this.", "received", "2026-08-17T00:05:00.000Z")],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    expect(screen.getByText("The company is paused. Your message is read after you resume.")).toBeInTheDocument();
    expect(within(ceoTimeline()).getByRole("article", { name: "You" })).toHaveTextContent("CEO reads this after you resume the company.");
    expect(screen.getByRole("textbox", { name: "Message to the CEO" })).toBeEnabled();
  });

  it("takes no message for a stopped company and opens it on its outcomes", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({ ...created, company: { ...created.company, status: "stopped" } }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    expect(screen.getByRole("textbox", { name: "Message to the CEO" })).toBeDisabled();
    expect(screen.getByText("This company has stopped. It takes no new messages.")).toBeInTheDocument();
    // A stopped company opens on its outcomes.
    expect(screen.getByRole("tab", { name: "Outcomes" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows a department page: its responsibility, who works now, each task as a trace, and a text composer", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({ ...created, tasks: [{ ...created.tasks[0]!, status: "running" as const }] }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));

    expect(screen.getByRole("heading", { level: 1, name: "Engineering" })).toBeInTheDocument();
    expect(screen.getByText("Build prototype.")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Working now" })).toHaveTextContent("Codex: Task 1 (Create landing page) waiting");
    // Each task is an Execution Trace: the runtime's steps, newest run in full.
    const trace = screen.getByRole("region", { name: "Create landing page" });
    expect(trace).toHaveTextContent("Running");
    expect(within(trace).getByRole("region", { name: "Steps" })).toHaveTextContent("Received CEO task");
    expect(within(trace).getByRole("region", { name: "Steps" })).toHaveTextContent("Assessment complete");
    expect(document.querySelector("[class*='retro-'], .theme-root, .legacy-workspace")).toBeNull();

    // The composer sends a Department Intake, and its card comes back from the server's projection.
    api.getCompanyState = vi.fn(async () => ({
      ...created, proof: [], reviews: [], activity: [], replanProposals: [],
      tasks: [{ ...created.tasks[0]!, status: "running" as const }],
      ceoOfficeItems: [createFounderIntakeCeoOfficeItem("department_intake_1", "Use this launch copy.", "received", "2026-08-17T00:05:00.000Z", { departmentId: "department_1" })],
    }));
    await user.type(screen.getByRole("textbox", { name: "Message to Engineering" }), "Use this launch copy.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(api.createDepartmentIntake).toHaveBeenCalledWith("company_1", "department_1", { body: "Use this launch copy." });
    const messages = await screen.findByRole("region", { name: "Your messages to this department" });
    expect(within(messages).getByRole("article", { name: "You" })).toHaveTextContent("Engineering reads this soon.");

    // What the founder told a department stays off the CEO Office timeline.
    await user.click(screen.getByRole("button", { name: "CEO Office" }));
    expect(ceoTimeline()).not.toHaveTextContent("Use this launch copy.");
  });

  it("folds a settled trace to a summary with its result, keeps a founder's open across live updates, and shows earlier runs on one line", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    const progress = (id: string, step: "received" | "executing" | "blocked" | "complete", status: "complete" | "current" | "blocked", label: string, minute: number) => ({
      id, companyId: "company_1", departmentId: "department_1", parentTaskId: "task_1", subjectTaskId: "task_1",
      step, status, label, detail: null, createdAt: `2026-08-17T00:0${minute}:00.000Z`,
    });
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [{ ...created.tasks[0]!, status: "complete" as const }],
      taskProgressEvents: [
        progress("p1", "received", "complete", "Received CEO task", 0),
        progress("p2", "executing", "current", "First run started", 1),
        progress("p3", "blocked", "blocked", "First run timed out", 2),
        progress("p4", "executing", "current", "Second run started", 3),
        progress("p5", "complete", "complete", "Delivery accepted", 4),
      ],
      ceoOfficeItems: [{
        ...createExecutionReportCeoOfficeItem("done_1", "2026-08-17T00:05:00.000Z", "The landing page is live locally.", "Create landing page"),
        departmentId: "department_1",
      }],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));

    // Settled: one summary line, and the result stays in view.
    const trace = screen.getByRole("region", { name: "Create landing page" });
    expect(trace).toHaveTextContent("Done · 5 steps");
    expect(within(trace).getByRole("region", { name: "Result" })).toHaveTextContent("The landing page is live locally.");
    expect(within(trace).queryByRole("region", { name: "Steps" })).not.toBeInTheDocument();

    // Opened by hand, it stays open while live updates arrive.
    await user.click(within(trace).getByRole("button", { name: "Show steps" }));
    act(() => {
      api.lastEventHandler?.({ type: "task_warning", taskId: "task_1", message: "Unrelated update." });
    });
    const steps = within(trace).getByRole("region", { name: "Steps" });
    // Only the latest run is in full; the earlier one is a single line that opens on demand.
    expect(steps).toHaveTextContent("Second run started");
    expect(steps).not.toHaveTextContent("First run timed out");
    expect(within(trace).getByRole("list", { name: "Earlier runs" })).toHaveTextContent("Run 1 · First run timed out");
  });

  it("answers a department's input with a card on its page: a note for a task, or the input passed to the CEO", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [{ ...created.tasks[0]!, status: "running" as const }],
      ceoOfficeItems: [
        createFounderIntakeCeoOfficeItem("di_1", "Mention the annual discount.", "dispatched", "2026-08-17T00:05:00.000Z", { departmentId: "department_1" }),
        createIntakeOutcomeCeoOfficeItem("di_1", {
          status: "dispatched", outcome: "attach_to_task", departmentId: "department_1", targetTaskId: "task_1",
          summary: { en: "I gave the note to the landing page task. It applies from its next run." },
        }),
        createFounderIntakeCeoOfficeItem("di_2", "Change the target market.", "dispatched", "2026-08-17T00:07:00.000Z", { departmentId: "department_1" }),
        { ...createIntakeOutcomeCeoOfficeItem("di_2", { status: "dispatched", outcome: "route_to_ceo", departmentId: "department_1", summary: { en: "This is for the CEO." } }), occurredAt: "2026-08-17T00:08:00.000Z" },
        createFounderIntakeCeoOfficeItem("ci_3", "Change the target market.", "received", "2026-08-17T00:09:00.000Z", { routedFromIntakeId: "di_2" }),
      ],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    // The input the department passed on reaches CEO Office, saying where it came from.
    expect(within(ceoTimeline()).getByRole("article", { name: "You" })).toHaveTextContent("Passed on by Engineering");
    expect(ceoTimeline()).not.toHaveTextContent("Mention the annual discount.");

    await user.click(screen.getByRole("button", { name: "Engineering" }));
    const messages = screen.getByRole("region", { name: "Your messages to this department" });
    const note = within(messages).getByRole("article", { name: "Engineering: Gave it to a task" });
    expect(note).toHaveTextContent("I gave the note to the landing page task. It applies from its next run.");
    expect(within(note).getByRole("button", { name: "Create landing page" })).toBeInTheDocument();
    const passed = within(messages).getByRole("article", { name: "Engineering: Passed to the CEO" });
    await user.click(within(passed).getByRole("button", { name: "Open CEO Office" }));
    expect(screen.getByRole("button", { name: "CEO Office" })).toHaveAttribute("aria-current", "page");
  });

  it("shows the CEO sending input to one department, with a way to open it", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      ceoOfficeItems: [
        createFounderIntakeCeoOfficeItem("ci_1", "Start a newsletter.", "dispatched", "2026-08-17T00:05:00.000Z"),
        createIntakeOutcomeCeoOfficeItem("ci_1", { status: "dispatched", outcome: "route_department", targetDepartmentId: "department_1", summary: { en: "Engineering will handle it." } }),
      ],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    const answer = within(ceoTimeline()).getByRole("article", { name: "CEO: Sent to a department" });
    await user.click(within(answer).getByRole("button", { name: "Open Engineering" }));
    expect(screen.getByRole("button", { name: "Engineering" })).toHaveAttribute("aria-current", "page");
  });

  it("routes department review-ready tasks to Needs you without approval controls on the card", async () => {
    const api = createMockApiClient();
    api.createCompany = vi.fn(async () => {
      const created = createCompanyResponse();
      const taskProgressEvents = created.taskProgressEvents ?? [];
      return {
        ...created,
        tasks: [
          {
            ...created.tasks[0],
            title: "Validate the prototype",
            status: "review" as const,
            affordances: offered("ceo_review_decision"),
          },
        ],
        taskProgressEvents: [
          ...taskProgressEvents.slice(0, 2),
          {
            id: "task_progress_3",
            companyId: "company_1",
            departmentId: "department_1",
            parentTaskId: "task_1",
            subjectTaskId: "task_1",
            step: "awaiting_review" as const,
            status: "current" as const,
            label: "Awaiting review",
            detail: null,
            createdAt: "2026-08-17T00:02:00.000Z",
          },
        ],
        businessArtifacts: [createBusinessArtifactSummary("business_artifact_1", "task_1", "proof_1")],
        ceoOfficeItems: [createApprovalRequestCeoOfficeItem({
          businessArtifactId: "business_artifact_1",
          taskId: "task_1",
          title: "Validate the prototype",
        })],
      };
    });
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));

    // The department page shows the delivery waiting, and lists the review in its own "Needs you".
    expect(screen.getByRole("region", { name: "Validate the prototype" })).toHaveTextContent("The delivery waits for your review.");
    expect(within(needsYouColumn()).getByRole("region", { name: "Needs your review" })).toHaveTextContent("Validate the prototype");

    await user.click(screen.getByRole("button", { name: "CEO Office" }));

    expect(screen.getByRole("button", { name: "CEO Office" })).toHaveAttribute("aria-current", "page");
    const reviews = within(needsYouColumn()).getByRole("region", { name: "Needs your review" });
    expect(reviews).toHaveTextContent("Validate the prototype");
    expect(reviews).toHaveTextContent("Engineering");
    expect(within(reviews).getByRole("button", { name: "Open: Validate the prototype" })).toBeInTheDocument();
    // The review is decided in the item's dialog, never on the card.
    expect(within(reviews).queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(within(reviews).queryByRole("button", { name: /return/i })).not.toBeInTheDocument();
  });

  it("shows Human Actions in CEO Office and the owning department, then submits evidence", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      humanActions: [createHumanActionSummary()],
      ceoOfficeItems: [createHumanActionCeoOfficeItem(createHumanActionSummary(), "Create landing page")],
    }));

    render(<App apiClient={api} />);
    await createCompany(user);

    expect(within(ceoTimeline()).getByText("Publish the prototype URL.")).toBeInTheDocument();
    expect(within(needsYouColumn()).getByRole("region", { name: "Needs your action" })).toHaveTextContent("Create landing page");

    // The owning department lists it too.
    await user.click(screen.getByRole("button", { name: "Engineering" }));
    expect(within(needsYouColumn()).getByRole("region", { name: "Needs your action" })).toHaveTextContent("Create landing page");

    await user.click(screen.getByRole("button", { name: "CEO Office" }));
    await user.click(within(needsYouColumn()).getByRole("button", { name: "Open: Create landing page" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("configuration_value"), "DEPLOYMENT_URL=https://example.test");
    await user.type(within(dialog).getByLabelText("approval_note"), "Deployment confirmed by founder.");
    await user.click(within(dialog).getByRole("button", { name: "Confirm it is done" }));

    expect(api.confirmHumanAction).toHaveBeenCalledWith(
      "company_1",
      "task_completion_event_1_human_action_1",
      {
        evidence: {
          configuration_value: "DEPLOYMENT_URL=https://example.test",
          approval_note: "Deployment confirmed by founder.",
        },
      },
    );
    expect(await within(needsYouColumn()).findByRole("status")).toHaveTextContent("Confirmed.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows Wait States in CEO Office and the owning department as monitoring work", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      waitStates: [createWaitStateSummary()],
    }));

    render(<App apiClient={api} />);
    await createCompany(user);

    // CEO Office counts what the company waits for; the department page lists it.
    expect(within(needsYouColumn()).getByLabelText("Overview")).toHaveTextContent("Waiting1");
    expect(needsYouColumn()).not.toHaveTextContent("Wait for search indexing signals.");

    await user.click(screen.getByRole("button", { name: "Engineering" }));

    // The department page says what the task waits for, and when it is checked next.
    expect(screen.getByRole("region", { name: "Create landing page" })).toHaveTextContent(
      `Waiting: Wait for search indexing signals. Next check: ${new Date("2026-08-18T00:00:00.000Z").toLocaleString("en")}.`,
    );
  });

  it("routes review-ready department subtasks to Needs you", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    const parentTask = {
      ...created.tasks[0],
      id: "parent_task",
      title: "Provide local prototype access",
      status: "waiting_dependency" as const,
      dependencyNote: "Waiting for dependency acceptance: Execute Provide local prototype access (review).",
    };
    const reviewSubtask = {
      ...created.tasks[0],
      id: "review_subtask",
      title: "Execute Provide local prototype access",
      status: "review" as const,
      affordances: offered("ceo_review_decision"),
      taskKind: "department_subtask" as const,
      parentTaskId: parentTask.id,
    };
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [parentTask, reviewSubtask],
      proof: [
        {
          id: "proof_subtask",
          taskId: reviewSubtask.id,
          type: "file",
          uri: "index.html",
          summary: "File proof: index.html",
        },
      ],
      businessArtifacts: [createBusinessArtifactSummary("business_artifact_subtask", reviewSubtask.id, "proof_subtask")],
      ceoOfficeItems: [createApprovalRequestCeoOfficeItem({
        businessArtifactId: "business_artifact_subtask",
        taskId: "review_subtask",
        title: "Execute Provide local prototype access",
      })],
      taskProgressEvents: [
        ...created.taskProgressEvents!.slice(0, 2).map((event) => ({ ...event, parentTaskId: parentTask.id })),
        {
          id: "task_progress_subtask_review",
          companyId: "company_1",
          departmentId: "department_1",
          parentTaskId: parentTask.id,
          subjectTaskId: reviewSubtask.id,
          step: "awaiting_review" as const,
          status: "current" as const,
          label: "Awaiting review",
          detail: null,
          createdAt: "2026-08-17T00:03:00.000Z",
        },
      ],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    const reviews = within(needsYouColumn()).getByRole("region", { name: "Needs your review" });
    expect(reviews).toHaveTextContent("Execute Provide local prototype access");

    await user.click(within(reviews).getByRole("button", { name: "Open: Execute Provide local prototype access" }));

    const taskReview = within(screen.getByRole("dialog")).getByRole("region", { name: "Needs your review" });
    expect(within(taskReview).getByText("File proof: index.html")).toBeInTheDocument();
    expect(within(taskReview).getByRole("button", { name: "Approve" })).toBeEnabled();
    // The review must not offer a control that re-queues the task; that is how the stuck task kept
    // looping past its recovery ceiling.
    expect(within(taskReview).queryByRole("button", { name: /refresh|recover|run again/i })).not.toBeInTheDocument();
  });

  it("loads review artifacts after a task_review event so Needs you becomes actionable", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    const reviewReady = {
      ...created,
      proof: created.proof ?? [],
      reviews: created.reviews ?? [],
      activity: created.activity ?? [],
      replanProposals: created.replanProposals ?? [],
      tasks: [
        {
          ...created.tasks[0],
          title: "Find the first overseas keyword opportunity",
          status: "review" as const,
          affordances: offered("ceo_review_decision"),
        },
      ],
      taskProgressEvents: [
        ...(created.taskProgressEvents ?? []).slice(0, 2),
        {
          id: "task_progress_3",
          companyId: "company_1",
          departmentId: "department_1",
          parentTaskId: "task_1",
          subjectTaskId: "task_1",
          step: "awaiting_review" as const,
          status: "current" as const,
          label: "Awaiting review",
          detail: null,
          createdAt: "2026-08-17T00:02:00.000Z",
        },
      ],
      businessArtifacts: [createBusinessArtifactSummary("business_artifact_1", "task_1", "proof_1")],
      ceoOfficeItems: [createApprovalRequestCeoOfficeItem({
        businessArtifactId: "business_artifact_1",
        taskId: "task_1",
        title: "Find the first overseas keyword opportunity",
      })],
    };
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [
        {
          ...created.tasks[0],
          title: "Find the first overseas keyword opportunity",
          status: "running" as const,
        },
      ],
      businessArtifacts: [],
    }));
    api.getCompanyState = vi.fn(async () => reviewReady);
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));

    act(() => {
      api.lastEventHandler?.({
        type: "task_review",
        taskId: "task_1",
        status: "review",
        message: "Task ready for CEO review.",
      });
    });

    await waitFor(() => expect(api.getCompanyState).toHaveBeenCalledWith("company_1"));
    const trace = screen.getByRole("region", { name: "Find the first overseas keyword opportunity" });
    expect(await within(trace).findByRole("button", { name: "Review it" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "CEO Office" }));
    expect(within(needsYouColumn()).getByRole("region", { name: "Needs your review" })).toHaveTextContent("Find the first overseas keyword opportunity");
  });

  it("does not duplicate blocked task status in a separate CEO blocked queue", async () => {
    const api = createMockApiClient();
    api.createCompany = vi.fn(async () => {
      const created = createCompanyResponse();
      return {
        ...created,
        tasks: [
          {
            ...created.tasks[0],
            title: "Find the first SEO keyword opportunity",
            status: "blocked" as const,
            failureReason: "invalid_business_artifact",
            failureMessage: "Task blocked: invalid business artifact.",
          },
        ],
        businessArtifacts: [
          {
            ...createBusinessArtifactSummary("business_artifact_1", "task_1", "proof_1"),
            artifactKind: "blocker",
            artifactRole: "none",
            artifactSubtype: "invalid_business_artifact_schema",
            artifactType: "blocker_report",
            validationStatus: "invalid_schema",
            reviewStatus: "not_reviewable",
          },
        ],
      };
    });
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompany(user);

    expect(screen.queryByRole("region", { name: "Blocked / Not Reviewable" })).not.toBeInTheDocument();
    // A stuck task is counted, and is acted on from its department page, not listed again here.
    expect(within(needsYouColumn()).getByLabelText("Overview")).toHaveTextContent("Stuck1");
    expect(needsYouColumn()).toHaveTextContent("Nothing needs you now.");
  });

  it("opens a review from Needs you and approves a proof-backed deliverable", async () => {
    const api = createMockApiClient();
    const decision = createDeferred<Awaited<ReturnType<ApiClient["createCeoReviewDecision"]>>>();
    api.createCompany = vi.fn(async () => ({
      ...createReviewReadyCompanyResponse(),
      proof: [
        {
          id: "proof_1",
          taskId: "task_1",
          type: "file",
          uri: "proof.md",
          summary: "Prototype is playable locally.",
        },
      ],
    }));
    api.createCeoReviewDecision = vi.fn(() => decision.promise);
    const acceptedArtifact = {
      ...createBusinessArtifactSummary("business_artifact_1", "task_1", "proof_1"),
      reviewStatus: "accepted",
    };
    const decisionResponse = {
      decision: {
        id: "ceo_review_decision_1",
        taskId: "task_1",
        decision: "approve" as const,
        note: "Looks good.",
        proofId: "proof_1",
        createdAt: "2026-08-17T00:03:00.000Z",
      },
      task: {
        ...createCompanyResponse().tasks[0],
        status: "complete" as const,
      },
      businessArtifacts: [acceptedArtifact],
    };
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    await user.click(within(needsYouColumn()).getByRole("button", { name: "Open: Validate the prototype" }));

    const taskReview = within(screen.getByRole("dialog")).getByRole("region", { name: "Needs your review" });
    expect(within(taskReview).getByText("The department sent a result you can check. You can approve it.")).toBeInTheDocument();

    // The form leads with what the agent concluded.
    const outcomeSummary = within(taskReview).getByText(/The prototype works end to end/);
    expect(within(taskReview).getByRole("heading", { name: "What the agent concluded" })).toBeInTheDocument();

    // What the department sent, and the checks on it, stay folded below.
    const evidenceSection = within(taskReview).getByText("What the department sent").closest("details");
    expect(evidenceSection).not.toBeNull();
    expect(evidenceSection).not.toHaveAttribute("open");
    expect(evidenceSection).toHaveTextContent("Prototype is playable locally.");
    expect(evidenceSection).toHaveTextContent("proof.md");
    expect(evidenceSection).not.toContainElement(outcomeSummary);
    expect(outcomeSummary.compareDocumentPosition(evidenceSection!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const approveButton = within(taskReview).getByRole("button", { name: "Approve" });
    const returnButton = within(taskReview).getByRole("button", { name: "Return to the department" });
    await user.click(approveButton);

    expect(api.createCeoReviewDecision).toHaveBeenCalledWith({
      taskId: "task_1",
      decision: "approve",
    });
    expect(approveButton).toHaveAttribute("aria-busy", "true");
    expect(returnButton).toHaveAttribute("aria-busy", "false");
    expect(returnButton).toBeDisabled();

    await act(async () => {
      decision.resolve(decisionResponse);
      await decision.promise;
    });

    expect(await within(needsYouColumn()).findByRole("status")).toHaveTextContent("You approved the task.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(needsYouColumn()).queryByRole("button", { name: "Open: Validate the prototype" })).not.toBeInTheDocument();
    expect(needsYouColumn()).toHaveTextContent("Nothing needs you now.");
  });

  it("does not render CEO review decisions when a stale review item no longer offers the review affordance", async () => {
    const api = createMockApiClient();
    api.createCompany = vi.fn(async () => {
      const created = createReviewReadyCompanyResponse();
      return {
        ...created,
        tasks: [
          {
            ...created.tasks[0],
            status: "blocked" as const,
            failureReason: "invalid_business_artifact",
            failureMessage: "Task blocked: invalid business artifact.",
            affordances: offered("request_replan"),
            holds: [
              {
                id: "hold_1",
                kind: "invalid_business_artifact",
                resolver: "runtime" as const,
                subjectKind: "business_artifact",
                subjectId: "business_artifact_1",
                reason: "The business artifact is not reviewable.",
                openedAt: "2026-08-17T00:02:00.000Z",
              },
            ],
          },
        ],
      };
    });
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    await user.click(within(needsYouColumn()).getByRole("button", { name: "Open: Validate the prototype" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("This task no longer waits for your review.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Return to the department" })).not.toBeInTheDocument();
    // What the task offers now is on its department page.
    await user.click(within(dialog).getByRole("button", { name: "Open the department page" }));
    expect(screen.getByRole("button", { name: "Engineering" })).toHaveAttribute("aria-current", "page");
  });

  it("applies dependency cascade updates returned by CEO approval", async () => {
    const api = createMockApiClient();
    const created = createDependencyGraphCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [
        ...created.tasks.map((task) =>
          task.id === "task_4"
            ? { ...task, status: "review" as const, affordances: offered("ceo_review_decision") }
            : task.id === "task_5"
              ? {
                  ...task,
                  status: "blocked" as const,
                  failureReason: "missing_deliverable",
                  dependencyNote: "Missing consumable proof from dependency: Validate prototype locally.",
                }
              : task,
        ),
        {
          ...created.tasks[0],
          id: "task_7",
          title: "Amplify launch pipeline",
          status: "blocked" as const,
          departmentId: "department_growth",
          dependsOnTaskIds: ["task_5"],
          failureReason: "dependency_failed",
          dependencyNote: "Blocked by failed dependency: Prepare SEO launch and indexing assets.",
        },
      ],
      proof: [
        {
          id: "proof_1",
          taskId: "task_4",
          type: "file",
          uri: "proof.md",
          summary: "Prototype validates locally.",
        },
      ],
      businessArtifacts: [createBusinessArtifactSummary("business_artifact_1", "task_4", "proof_1")],
      ceoOfficeItems: [createApprovalRequestCeoOfficeItem({
        businessArtifactId: "business_artifact_1",
        taskId: "task_4",
        title: "Validate prototype locally",
      })],
    }));
    api.createCeoReviewDecision = vi.fn(async () => ({
      decision: {
        id: "ceo_review_decision_1",
        taskId: "task_4",
        decision: "approve" as const,
        proofId: "proof_1",
        createdAt: "2026-08-17T00:03:00.000Z",
      },
      task: {
        ...created.tasks.find((task) => task.id === "task_4")!,
        status: "complete" as const,
      },
      dependencyCascade: {
        updatedTasks: [
          {
            ...created.tasks.find((task) => task.id === "task_5")!,
            status: "queued" as const,
            failureReason: undefined,
            dependencyNote: undefined,
          },
          {
            ...created.tasks[0],
            id: "task_7",
            title: "Amplify launch pipeline",
            status: "waiting_dependency" as const,
            departmentId: "department_growth",
            dependsOnTaskIds: ["task_5"],
            failureReason: undefined,
            dependencyNote: "Waiting for dependency deliverable: Prepare SEO launch and indexing assets (queued).",
          },
        ],
        events: [
          {
            type: "dependency_ready",
            taskId: "task_5",
            status: "queued",
            message: "Task queued after upstream approval: Prepare SEO launch and indexing assets.",
          },
        ],
        progressEvents: [
          {
            id: "task_progress_4",
            companyId: "company_1",
            departmentId: "department_growth",
            parentTaskId: "task_5",
            subjectTaskId: "task_5",
            step: "executing" as const,
            status: "current" as const,
            label: "Dependency ready after upstream approval; queued for scheduler.",
            detail: null,
            createdAt: "2026-08-17T00:03:00.000Z",
          },
        ],
      },
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    const overview = within(needsYouColumn()).getByLabelText("Overview");
    expect(overview).toHaveTextContent("Done4/7");
    expect(overview).toHaveTextContent("Stuck2");
    await user.click(within(needsYouColumn()).getByRole("button", { name: "Open: Validate prototype locally" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve" }));

    // The approval accepts task 04 and the cascade it returns frees tasks 05 and 07.
    await waitFor(() => expect(within(needsYouColumn()).getByLabelText("Overview")).toHaveTextContent("Done5/7"));
    expect(within(needsYouColumn()).getByLabelText("Overview")).toHaveTextContent("Stuck0");
    await user.click(screen.getByRole("button", { name: "Growth" }));
    expect(screen.getByRole("region", { name: "Amplify launch pipeline" })).toHaveTextContent("Waiting");
    expect(screen.getByRole("region", { name: "Prepare SEO launch and indexing assets" })).toHaveTextContent("Waiting");
  });

  it("reviews a delivery from its trace on the department page, which then shows the task done", async () => {
    const api = createMockApiClient();
    api.createCompany = vi.fn(async () => ({
      ...createReviewReadyCompanyResponse(),
      proof: [
        {
          id: "proof_1",
          taskId: "task_1",
          type: "file",
          uri: "proof.md",
          summary: "Prototype is playable locally.",
        },
      ],
    }));
    api.createCeoReviewDecision = vi.fn(async () => ({
      decision: {
        id: "ceo_review_decision_1",
        taskId: "task_1",
        decision: "approve" as const,
        proofId: "proof_1",
        createdAt: "2026-08-17T00:03:00.000Z",
      },
      task: {
        ...createReviewReadyCompanyResponse().tasks[0],
        status: "complete" as const,
      },
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));

    await user.click(within(screen.getByRole("region", { name: "Validate the prototype" })).getByRole("button", { name: "Review it" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve" }));
    await within(needsYouColumn()).findByText("You approved the task.");

    const trace = screen.getByRole("region", { name: "Validate the prototype" });
    expect(within(trace).queryByRole("button", { name: "Review it" })).not.toBeInTheDocument();
    expect(trace).toHaveTextContent("Done");
    expect(within(trace).getByRole("region", { name: "Result" })).toBeInTheDocument();
    expect(needsYouColumn()).toHaveTextContent("Nothing needs you now.");
  });

  it("blocks missing-proof CEO approval and returns tasks with a reason and next step", async () => {
    const api = createMockApiClient();
    api.createCompany = vi.fn(async () => createReviewReadyCompanyResponse());
    api.createCeoReviewDecision = vi.fn(async () => ({
      decision: {
        id: "ceo_review_decision_1",
        taskId: "task_1",
        decision: "return" as const,
        returnReason: "needs_changes" as const,
        note: "Add proof and explain the next step.",
        createdAt: "2026-08-17T00:03:00.000Z",
      },
      task: {
        ...createCompanyResponse().tasks[0],
        status: "queued" as const,
      },
      progressEvent: {
        id: "task_progress_4",
        companyId: "company_1",
        departmentId: "department_1",
        parentTaskId: "task_1",
        subjectTaskId: "task_1",
        step: "blocked" as const,
        status: "current" as const,
        label: "CEO Office returned this, waiting for the department to rework it.",
        detail: "Reason: needs changes. Next step: Add proof and explain the next step.",
        createdAt: "2026-08-17T00:03:00.000Z",
      },
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    await user.click(within(needsYouColumn()).getByRole("button", { name: "Open: Validate the prototype" }));

    const taskReview = within(screen.getByRole("dialog")).getByRole("region", { name: "Needs your review" });
    expect(
      within(taskReview).getByText("The department has not sent a result you can check. You can return the task."),
    ).toBeInTheDocument();
    expect(within(taskReview).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();

    await user.click(within(taskReview).getByRole("button", { name: "Return to the department" }));
    expect(within(taskReview).getByRole("alert")).toHaveTextContent("Choose why you return it.");

    await user.selectOptions(within(taskReview).getByLabelText("Why you return it"), "needs_changes");
    await user.type(within(taskReview).getByLabelText("Note to the department"), "Add proof and explain the next step.");
    await user.click(within(taskReview).getByRole("button", { name: "Return to the department" }));

    expect(api.createCeoReviewDecision).toHaveBeenCalledWith({
      taskId: "task_1",
      decision: "return",
      returnReason: "needs_changes",
      note: "Add proof and explain the next step.",
    });
    expect(await within(needsYouColumn()).findByText("You returned the task to the department.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Engineering" }));
    // The mocked decision answers with the fixture's base task, titled "Create landing page".
    expect(screen.getByRole("region", { name: "Create landing page" })).toHaveTextContent(
      "CEO Office returned this, waiting for the department to rework it.",
    );
  });

  it("shows CEO review API errors instead of silently doing nothing", async () => {
    const api = createMockApiClient();
    api.createCompany = vi.fn(async () => createReviewReadyCompanyResponse());
    api.createCeoReviewDecision = vi.fn(async () => {
      throw new Error("Request failed: 404");
    });
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    await user.click(within(needsYouColumn()).getByRole("button", { name: "Open: Validate the prototype" }));
    const taskReview = within(screen.getByRole("dialog")).getByRole("region", { name: "Needs your review" });
    await user.selectOptions(within(taskReview).getByLabelText("Why you return it"), "needs_changes");
    await user.type(within(taskReview).getByLabelText("Note to the department"), "Add proof.");
    await user.click(within(taskReview).getByRole("button", { name: "Return to the department" }));

    expect(await within(taskReview).findByRole("alert")).toHaveTextContent("Request failed: 404");
    expect(within(taskReview).getByRole("button", { name: "Return to the department" })).toBeEnabled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("offers no way back to setup from a company that is operating", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompany(user);
    expect(queryCommand(/setup/i)).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Workbench" })).queryByRole("button", { name: /setup/i })).not.toBeInTheDocument();
    await user.keyboard("{Meta>}b{/Meta}");

    // A running company never returns to the name and vision form (ADR 0044).
    expect(screen.getByRole("navigation", { name: "Workbench" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Founder vision")).not.toBeInTheDocument();
  });

  it("pauses and resumes operating from the Workbench header", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    await runCommand(user, "Pause Operating");
    expect(api.pauseCompany).toHaveBeenCalledWith("company_1");
    expect(await screen.findByText("This company is paused. No new work starts until you resume it.")).toBeInTheDocument();

    await runCommand(user, "Resume Operating");
    expect(api.resumeCompany).toHaveBeenCalledWith("company_1");
    await waitFor(() =>
      expect(screen.queryByText("This company is paused. No new work starts until you resume it.")).not.toBeInTheDocument(),
    );
  });

  it("updates task event stream messages from SSE", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await openPage(user, "Operations Diagnostics");

    await waitFor(() => expect(api.lastEventHandler).toBeDefined());
    act(() => {
      api.lastEventHandler?.({ type: "task_warning", taskId: "task_1", message: "Task warning: ignored invalid timeout." });
    });

    expect(await screen.findByText("Warning · Create landing page — ignored invalid timeout.")).toBeInTheDocument();
  });

  it("updates a task's trace on the department page from the event stream", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));
    const trace = screen.getByRole("region", { name: "Create landing page" });

    await waitFor(() => expect(api.lastEventHandler).toBeDefined());
    act(() => {
      api.lastEventHandler?.({
        type: "task_started",
        taskId: "task_1",
        message: "Task started: Create landing page (codex).",
      });
    });

    await waitFor(() => expect(trace).toHaveTextContent("Running"));
    expect(screen.queryByRole("heading", { name: "Agent Activity" })).not.toBeInTheDocument();
    expect(screen.queryByText("Task started: Create landing page (codex).")).not.toBeInTheDocument();
  });

  it("keeps one event stream across view changes", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    const subscriptions = vi.mocked(api.subscribeEvents).mock.calls.length;

    await openPage(user, "Operations Diagnostics");
    await openPage(user, "Engineering");
    await openPage(user, "Deliverables");
    await openPage(user, "CEO Office");
    expect(screen.getByRole("button", { name: "CEO Office" })).toHaveAttribute("aria-current", "page");

    expect(api.subscribeEvents).toHaveBeenCalledTimes(subscriptions);
  });

  it("recovers task changes missed while the event stream was reconnecting", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();
    let openStream: (() => void) | undefined;
    api.subscribeEvents = vi.fn((_companyId, _handler, onOpen) => {
      openStream = onOpen;
      return () => undefined;
    });

    render(<App apiClient={api} />);
    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));
    const trace = () => screen.getByRole("region", { name: "Create landing page" });

    // task_started was published while the stream was down; only a snapshot can tell us.
    const created = createCompanyResponse();
    api.getCompanyState = vi.fn(async () => ({
      ...created,
      tasks: created.tasks.map((task) => (task.id === "task_1" ? { ...task, status: "running" } : task)),
      proof: [],
      reviews: [],
      activity: [],
      replanProposals: [],
    }));
    act(() => openStream?.());

    await waitFor(() => expect(trace()).toHaveTextContent("Running"));
  });

  it("shows a stopped task on its trace from the event stream, with its codes only under Details", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));
    const trace = screen.getByRole("region", { name: "Create landing page" });

    await waitFor(() => expect(api.lastEventHandler).toBeDefined());
    act(() => {
      api.lastEventHandler?.({
        type: "task_failed",
        taskId: "task_1",
        failureReason: "timeout",
        message: "Task failed: Create landing page / timeout after 10m.",
      });
    });

    await waitFor(() => expect(trace).toHaveTextContent("Failed"));
    expect(within(trace).getByText("Details").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByRole("heading", { name: "Agent Activity" })).not.toBeInTheDocument();
    expect(screen.queryByText("Task failed: Create landing page / timeout after 10m.")).not.toBeInTheDocument();
  });

  it("shows coordination task states on the trace from the event stream", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));
    const trace = screen.getByRole("region", { name: "Create landing page" });

    await waitFor(() => expect(api.lastEventHandler).toBeDefined());
    act(() => {
      api.lastEventHandler?.({
        type: "dependency_waiting",
        taskId: "task_1",
        status: "waiting_dependency",
        dependencyNote: "Waiting for dependency deliverable: Research brief (running).",
        message: "Waiting for dependency deliverable: Research brief (running).",
      });
    });

    await waitFor(() => expect(trace).toHaveTextContent("Waiting"));

    act(() => {
      api.lastEventHandler?.({
        type: "task_retrying",
        taskId: "task_1",
        status: "retrying",
        message: "Task warning: Create landing page / timed out after 5m; retrying with long budget 10m.",
      });
    });

    await waitFor(() => expect(trace).toHaveTextContent("Running"));

    act(() => {
      api.lastEventHandler?.({
        type: "task_needs_replan",
        taskId: "task_1",
        status: "needs_replan",
        failureReason: "needs_replan",
        message: "Task needs replanning: Create landing page / exceeded long budget 10m.",
      });
    });

    await waitFor(() => expect(trace).toHaveTextContent("Needs you"));
  });

  it("checks a blocked task again from its trace", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [
        {
          ...created.tasks[0],
          status: "blocked",
          failureReason: "dependency_failed",
          dependencyNote: "Blocked by failed dependency: Write brief.",
          affordances: offered("refresh_task", "request_replan"),
        },
      ],
    }));
    api.refreshTask = vi.fn(async () => ({
      task: {
        ...created.tasks[0],
        status: "queued",
      },
      event: {
        type: "dependency_ready",
        taskId: "task_1",
        status: "queued",
        message: "Task refreshed: Create landing page is queued because dependencies are ready.",
      },
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));
    const trace = screen.getByRole("region", { name: "Create landing page" });

    await waitFor(() => expect(trace).toHaveTextContent("Needs you"));
    await user.click(within(trace).getByRole("button", { name: "Check again Create landing page" }));

    expect(api.refreshTask).toHaveBeenCalledWith("task_1");
    await waitFor(() => expect(trace).toHaveTextContent("Waiting"));
  });

  it("checks a blocked department subtask again from its parent's trace", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    const parentTask = {
      ...created.tasks[0],
      id: "parent_task",
      title: "Provide local prototype access",
      status: "waiting_dependency" as const,
      dependencyNote: "Waiting for dependency acceptance: Validate proof for Provide local prototype access (review).",
    };
    const blockedSubtask = {
      ...created.tasks[0],
      id: "blocked_subtask",
      title: "Execute Provide local prototype access",
      status: "blocked" as const,
      taskKind: "department_subtask" as const,
      parentTaskId: parentTask.id,
      failureReason: "non_reviewable_artifact",
      affordances: offered("refresh_task", "recover_task", "request_replan"),
    };
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [parentTask, blockedSubtask],
      taskProgressEvents: [
        ...created.taskProgressEvents!.slice(0, 2).map((event) => ({ ...event, parentTaskId: parentTask.id })),
        {
          id: "task_progress_blocked_subtask",
          companyId: "company_1",
          departmentId: "department_1",
          parentTaskId: parentTask.id,
          subjectTaskId: blockedSubtask.id,
          step: "blocked" as const,
          status: "blocked" as const,
          label: "Blocked by Execute Provide local prototype access.",
          detail: "Task blocked: Execute Provide local prototype access / non_reviewable_artifact.",
          createdAt: "2026-08-17T00:03:00.000Z",
        },
      ],
    }));
    api.refreshTask = vi.fn(async () => ({
      task: {
        ...blockedSubtask,
        status: "review",
        failureReason: undefined,
      },
      event: {
        type: "proof_recovered",
        taskId: blockedSubtask.id,
        status: "review",
        message: "Proof recovered.",
      },
      progressEvent: {
        id: "task_progress_recovered_subtask",
        companyId: "company_1",
        departmentId: "department_1",
        parentTaskId: parentTask.id,
        subjectTaskId: blockedSubtask.id,
        step: "awaiting_review" as const,
        status: "current" as const,
        label: "Found checkable proof and submitted it to CEO Office for review.",
        detail: "File proof: index.html.",
        createdAt: "2026-08-17T00:04:00.000Z",
      },
      recovery: {
        status: "recovered" as const,
        message: "Found checkable proof and submitted it to CEO Office for review.",
      },
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));
    const steps = within(screen.getByRole("region", { name: "Provide local prototype access" })).getByRole("region", { name: "Department steps" });

    expect(steps).toHaveTextContent("Needs you");

    await user.click(within(steps).getByRole("button", { name: "Check again Execute Provide local prototype access" }));

    expect(api.refreshTask).toHaveBeenCalledWith(blockedSubtask.id);
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Department steps" })).getByText("In review")).toBeInTheDocument());
    expect(screen.getByRole("region", { name: "Department steps" })).not.toHaveTextContent("Needs you");
  });

  it("applies parent aggregation updates returned by task refresh", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    const parentTask = {
      ...created.tasks[0],
      id: "task_parent",
      title: "Build the playable prototype",
      status: "waiting_dependency" as const,
      dependencyNote: "Waiting for department subtasks.",
    };
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [
        {
          ...created.tasks[0],
          status: "blocked",
          failureReason: "dependency_failed",
          dependencyNote: "Blocked by failed dependency: Write brief.",
          affordances: offered("refresh_task", "request_replan"),
        },
        parentTask,
      ],
    }));
    api.refreshTask = vi.fn(async () => ({
      task: {
        ...created.tasks[0],
        status: "queued",
      },
      event: {
        type: "dependency_ready",
        taskId: "task_1",
        status: "queued",
        message: "Task refreshed: Create landing page is queued because dependencies are ready.",
      },
      parentAggregation: {
        updatedTasks: [
          {
            ...parentTask,
            status: "queued" as const,
            dependencyNote: undefined,
          },
        ],
        events: [
          {
            type: "dependency_ready",
            taskId: parentTask.id,
            status: "queued",
            message: "Parent task queued for proof summarization: Build the playable prototype.",
          },
        ],
        progressEvents: [
          {
            id: "task_progress_parent",
            companyId: "company_1",
            departmentId: parentTask.departmentId,
            parentTaskId: parentTask.id,
            subjectTaskId: parentTask.id,
            step: "summarizing_proof" as const,
            status: "current" as const,
            label: "Ready to summarize department subtask proof.",
            detail: null,
            createdAt: "2026-08-17T00:03:00.000Z",
          },
        ],
      },
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));
    await user.click(screen.getByRole("button", { name: "Check again Create landing page" }));

    const parent = screen.getByRole("region", { name: "Build the playable prototype" });
    await waitFor(() => expect(parent).toHaveTextContent("Waiting"));
    expect(within(parent).getByRole("region", { name: "Steps" })).toHaveTextContent("Ready to summarize department subtask proof.");
  });

  it("does not show proof recovery refresh for tasks that are waiting on upstream proof", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [
        {
          ...created.tasks[0],
          status: "waiting_dependency",
          dependencyNote: "Waiting for dependency deliverable: Research brief (running).",
        },
      ],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));

    const trace = screen.getByRole("region", { name: "Create landing page" });
    expect(trace).toHaveTextContent("Waiting");
    expect(within(trace).queryByRole("button", { name: "Check again Create landing page" })).not.toBeInTheDocument();
  });

  it("shows proof recovery feedback after refreshing a failed no-proof task", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [
        {
          ...created.tasks[0],
          status: "failed",
          failureReason: "no_proof",
          failureMessage: "Task failed: Create landing page / no_proof.",
          affordances: offered("refresh_task", "recover_task", "request_replan"),
        },
      ],
    }));
    api.refreshTask = vi.fn(async () => ({
      task: {
        ...created.tasks[0],
        status: "review",
        // Recovering proof opens the CEO review Hold, so the task comes back offering the decision.
        affordances: offered("ceo_review_decision"),
      },
      event: {
        type: "proof_recovered",
        taskId: "task_1",
        status: "review",
        message: "Proof recovered: Create landing page submitted to CEO Office for review.",
      },
      progressEvent: {
        id: "task_progress_recovered",
        companyId: "company_1",
        departmentId: "department_1",
        parentTaskId: "task_1",
        subjectTaskId: "task_1",
        step: "awaiting_review" as const,
        status: "current" as const,
        label: "Found checkable proof and submitted it to CEO Office for review.",
        detail: "Diff proof recovered from prototype-audit-trail.patch.",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
      proof: [
        {
          id: "proof_1",
          taskId: "task_1",
          type: "diff",
          uri: ".auto-crop-proof/task_1.diff",
          summary: "Diff proof recovered from prototype-audit-trail.patch.",
        },
      ],
      businessArtifacts: [createBusinessArtifactSummary("business_artifact_1", "task_1", "proof_1")],
      recovery: {
        status: "recovered" as const,
        message: "Found checkable proof and submitted it to CEO Office for review.",
      },
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));

    await user.click(screen.getByRole("button", { name: "Check again Create landing page" }));

    await waitFor(() => expect(screen.getByRole("region", { name: "Create landing page" })).toHaveTextContent("In review"));
    expect(screen.getByText("Found checkable proof and submitted it to CEO Office for review.")).toBeInTheDocument();
  });

  it("runs a failed timeout task again from its trace", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [
        {
          ...created.tasks[0],
          status: "failed",
          failureReason: "timeout",
          failureMessage: "Task failed: Create landing page / timeout after 3m.",
          // An unattributed run failure offers re-running the work, not re-deriving state.
          affordances: offered("recover_task", "request_replan"),
        },
      ],
    }));
    api.recoverTask = vi.fn(async () => ({
      task: {
        ...created.tasks[0],
        status: "queued",
      },
      event: {
        type: "task_recovered",
        taskId: "task_1",
        status: "queued",
        message: "Task recovered: Create landing page is queued for another run.",
      },
      progressEvent: {
        id: "task_progress_recovered",
        companyId: "company_1",
        departmentId: "department_1",
        parentTaskId: "task_1",
        subjectTaskId: "task_1",
        step: "executing" as const,
        status: "waiting" as const,
        label: "Task recovered and queued for another run.",
        detail: null,
        createdAt: "2026-08-25T00:00:00.000Z",
      },
      recovery: {
        status: "queued" as const,
        message: "Task recovered and queued for another run.",
      },
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));
    const trace = screen.getByRole("region", { name: "Create landing page" });

    expect(within(trace).queryByRole("button", { name: "Check again Create landing page" })).not.toBeInTheDocument();
    await user.click(within(trace).getByRole("button", { name: "Run again Create landing page" }));

    expect(api.recoverTask).toHaveBeenCalledWith("task_1");
    await waitFor(() => expect(screen.getAllByText("Task recovered and queued for another run.").length).toBeGreaterThan(0));
    await waitFor(() => expect(trace).toHaveTextContent("Waiting"));
  });

  /**
   * A task held on Founder Approval used to render no action at all: the dashboard only knew how to
   * draw Refresh and Recover, and the route behind approval was a stub anyway (ADR 0020 amendment).
   * The button is drawn from the affordance, and the Approval id rides on the affordance itself.
   */
  it("answers a Founder Approval request from the task's trace", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [
        {
          ...created.tasks[0],
          status: "blocked",
          affordances: [
            {
              kind: "decide_founder_approval" as const,
              actor: "founder" as const,
              holdId: "hold_1",
              holdKind: "awaiting_founder_approval",
              subjectKind: "approval",
              subjectId: "approval_1",
            },
            ...offered(),
          ],
          holds: [
            {
              id: "hold_1",
              kind: "awaiting_founder_approval",
              resolver: "founder" as const,
              subjectKind: "approval",
              subjectId: "approval_1",
              reason: "Create landing page needs Founder Approval before it can run.",
              openedAt: "2026-08-17T00:00:00.000Z",
            },
          ],
        },
      ],
    }));
    api.decideFounderApproval = vi.fn(async (approvalId, input) => ({
      approval: {
        id: approvalId,
        companyId: "company_1",
        taskId: "task_1",
        actionType: "run_safe_command",
        riskLevel: "low",
        status: input.decision,
        requestedAt: "2026-08-17T00:00:00.000Z",
        decidedAt: "2026-08-17T01:00:00.000Z",
        note: null,
      },
      task: { ...created.tasks[0]!, status: "queued" },
      event: {
        type: "founder_approval" as const,
        taskId: "task_1",
        status: "queued",
        message: "Founder approved Create landing page; it is queued to run.",
      },
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));
    const trace = screen.getByRole("region", { name: "Create landing page" });

    // The Hold explains itself, so the founder knows what the button is for.
    expect(screen.getAllByText("Create landing page needs Founder Approval before it can run.").length)
      .toBeGreaterThan(0);
    expect(within(trace).queryByRole("button", { name: "Run again Create landing page" }))
      .not.toBeInTheDocument();

    await user.click(within(trace).getByRole("button", { name: "Approve And Run Create landing page" }));

    expect(api.decideFounderApproval).toHaveBeenCalledWith("approval_1", { decision: "approved" });
    await waitFor(() => expect(trace).toHaveTextContent("Waiting"));
  });

  it("shows agent activity on the Operations Diagnostics page", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    await waitFor(() => expect(api.lastEventHandler).toBeDefined());
    act(() => {
      api.lastEventHandler?.({
        type: "task_failed",
        taskId: "task_1",
        failureReason: "timeout",
        message: "Task failed: Create landing page / timeout after 10m.",
      });
    });

    expect(screen.queryByRole("region", { name: "Agent activity" })).not.toBeInTheDocument();

    await openPage(user, "Operations Diagnostics");

    expect(await screen.findByRole("heading", { name: "Operations Diagnostics" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Agent activity" })).toBeInTheDocument();
    expect(screen.getByText("Failed · Create landing page — Timed out before producing review-ready proof.")).toBeInTheDocument();
    expect(screen.queryByText("Task failed: Create landing page / timeout after 10m.")).not.toBeInTheDocument();
  });

  it("explains coordination events on the Operations Diagnostics page", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    await waitFor(() => expect(api.lastEventHandler).toBeDefined());
    act(() => {
      api.lastEventHandler?.({
        type: "dependency_waiting",
        taskId: "task_1",
        status: "waiting_dependency",
        dependencyNote: "Waiting for dependency deliverable: Research brief (running).",
        message: "Waiting for dependency deliverable: Research brief (running).",
      });
      api.lastEventHandler?.({
        type: "task_retrying",
        taskId: "task_1",
        status: "retrying",
        message: "Task warning: Create landing page / timed out after 5m; retrying with long budget 10m.",
      });
      api.lastEventHandler?.({
        type: "task_needs_replan",
        taskId: "task_1",
        status: "needs_replan",
        failureReason: "needs_replan",
        message: "Task needs replanning: Create landing page / exceeded long budget 10m.",
      });
    });

    await openPage(user, "Operations Diagnostics");

    expect(await screen.findByText("Waiting · Create landing page — Waiting for dependency deliverable: Research brief (running).")).toBeInTheDocument();
    expect(screen.getByText("Retrying · Create landing page — Retrying with a larger execution budget.")).toBeInTheDocument();
    expect(screen.getByText("Needs replan · Create landing page — Task is too large for the current execution budget and needs to be split.")).toBeInTheDocument();
  });

  it("keeps department subtasks out of the Operations Diagnostics review queue", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [
        {
          ...created.tasks[0],
          title: "Parent proof summary",
          status: "review" as const,
          affordances: offered("ceo_review_decision"),
        },
        {
          ...created.tasks[0],
          id: "department_subtask_1",
          title: "Internal prototype slice",
          status: "review" as const,
          affordances: offered("ceo_review_decision"),
          parentTaskId: "task_1",
          taskKind: "department_subtask" as const,
          source: "department" as const,
        },
      ],
    }));

    render(<App apiClient={api} />);
    await createCompany(user);
    await openPage(user, "Operations Diagnostics");

    const reviewQueue = screen.getByRole("region", { name: "Waiting for review" });
    expect(within(reviewQueue).getByText("Parent proof summary")).toBeInTheDocument();
    expect(within(reviewQueue).queryByText("Internal prototype slice")).not.toBeInTheDocument();
  });

  /**
   * The gap the affordance model was supposed to close and did not (ADR 0020 amendment). A task at
   * the Bounded Recovery ceiling is `blocked`, never `needs_replan`, and replanning is its *only*
   * way forward. The board drew nothing for it because both surfaces judged eligibility by status:
   * the task row knew only refresh and recover, and the Operations page filtered on `needs_replan`.
   */
  it("offers replanning on a task whose only way forward is a replan", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    const exhaustedTask = {
      ...created.tasks[0]!,
      status: "blocked",
      failureReason: "retry_exhausted",
      failureMessage: "Task blocked: Create landing page / retry_exhausted.",
      affordances: offered("request_replan"),
      holds: [
        {
          id: "hold_1",
          kind: "recovery_exhausted",
          resolver: "founder" as const,
          reason: "Create landing page reached the Bounded Recovery ceiling and needs a replan.",
          openedAt: "2026-08-17T00:00:00.000Z",
        },
      ],
    };
    api.createCompany = vi.fn(async () => ({ ...created, tasks: [exhaustedTask] }));
    api.createReplanProposal = vi.fn(async () => ({ proposal: createReplanProposalSummary() }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));
    const trace = screen.getByRole("region", { name: "Create landing page" });
    expect(trace).toHaveTextContent("Create landing page reached the Bounded Recovery ceiling and needs a replan.");

    // Neither of the actions the board used to know about applies here.
    expect(within(trace).queryByRole("button", { name: "Check again Create landing page" })).not.toBeInTheDocument();
    expect(within(trace).queryByRole("button", { name: "Run again Create landing page" })).not.toBeInTheDocument();

    await user.click(within(trace).getByRole("button", { name: "Ask for a new plan Create landing page" }));
    await user.click(within(trace).getByRole("button", { name: "Create Replan Proposal" }));
    expect(api.createReplanProposal).toHaveBeenCalledWith("task_1", { mode: null, note: null });
  });

  it("requests a Revision with a note, rejects it with a reason, and re-reads proposals from the server after each", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();
    const created = createCompanyResponse();
    const blockedTask = { ...created.tasks[0]!, status: "blocked", affordances: offered("request_replan") };
    let serverProposals: ReplanProposalSummary[] = [];
    api.createCompany = vi.fn(async () => ({ ...created, tasks: [blockedTask] }));
    api.createReplanProposal = vi.fn(async () => {
      serverProposals = [{ ...createReplanProposalSummary(), mode: "revision", replacementTasks: [] }];
      return { proposal: serverProposals[0]! };
    });
    api.rejectReplanProposal = vi.fn(async () => {
      serverProposals = [{ ...serverProposals[0]!, status: "rejected", rejectionNote: "Too broad." }];
      return { proposal: serverProposals[0]! };
    });
    api.getCompanyState = vi.fn(async () => ({
      ...created, tasks: [blockedTask], proof: [], businessArtifacts: [], reviews: [], activity: [], creationEvents: [],
      creationAttempts: [], replanProposals: serverProposals, taskProgressEvents: [], ceoIntakes: [],
    }));

    render(<App apiClient={api} />);
    await createCompany(user);
    await openPage(user, "Engineering");
    await user.click(screen.getByRole("button", { name: "Ask for a new plan Create landing page" }));

    await user.selectOptions(await screen.findByLabelText("Replan mode for Create landing page"), "Revision — rewrite this task");
    await user.type(screen.getByLabelText("Note for the planner"), "Accept an estimate.");
    const readsBefore = vi.mocked(api.getCompanyState).mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Create Replan Proposal" }));
    expect(api.createReplanProposal).toHaveBeenCalledWith("task_1", { mode: "revision", note: "Accept an estimate." });
    await waitFor(() => expect(vi.mocked(api.getCompanyState).mock.calls.length).toBeGreaterThan(readsBefore));

    await user.type(await screen.findByLabelText("Reason for rejecting (read by the planner)"), "Too broad.");
    const readsBeforeReject = vi.mocked(api.getCompanyState).mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Reject Proposal" }));
    expect(api.rejectReplanProposal).toHaveBeenCalledWith("replan_proposal_1", "Too broad.");
    await waitFor(() => expect(vi.mocked(api.getCompanyState).mock.calls.length).toBeGreaterThan(readsBeforeReject));
    expect(await screen.findByText("Rejected. Too broad.")).toBeInTheDocument();
    // Rejected, so the task can be asked about again.
    expect(screen.getByRole("button", { name: "Ask for a new plan Create landing page" })).toBeInTheDocument();
  });

  it("shows and confirms a new plan on the department page of its task", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [
        ...created.tasks,
        {
          ...created.tasks[0],
          id: "task_2",
          title: "Validate landing page",
          status: "queued",
          dependsOnTaskIds: ["task_1"],
        },
      ],
    }));
    // The server's proposals, which the client re-reads after every replan action.
    let serverProposals: ReplanProposalSummary[] = [];
    api.createReplanProposal = vi.fn(async () => {
      serverProposals = [createReplanProposalSummary()];
      return { proposal: createReplanProposalSummary() };
    });
    api.confirmReplanProposal = vi.fn(async () => ({
      proposal: (serverProposals = [{ ...createReplanProposalSummary(), status: "confirmed", confirmedAt: "2026-08-17T00:01:00.000Z" }])[0]!,
      sourceTask: { ...createCompanyResponse().tasks[0], status: "blocked", failureReason: "needs_replan" },
      createdTasks: [
        { ...createCompanyResponse().tasks[0], id: "task_3", title: "Plan smaller slice for Create landing page", status: "queued" },
        { ...createCompanyResponse().tasks[0], id: "task_4", title: "Produce proof for Create landing page", status: "queued" },
        { ...createCompanyResponse().tasks[0], id: "task_5", title: "Validate replacement output for Create landing page", status: "queued" },
      ],
      dependencyCascade: {
        updatedTasks: [
          {
            ...createCompanyResponse().tasks[0],
            id: "task_2",
            title: "Validate landing page",
            status: "waiting_dependency" as const,
            dependsOnTaskIds: ["task_5"],
            dependencyNote: "Waiting for dependency deliverable: Validate replacement output for Create landing page (queued).",
          },
        ],
        events: [
          {
            type: "dependency_waiting",
            taskId: "task_2",
            status: "waiting_dependency",
            message: "Waiting for dependency deliverable: Validate replacement output for Create landing page (queued).",
          },
        ],
        progressEvents: [
          {
            id: "task_progress_4",
            companyId: "company_1",
            departmentId: "department_1",
            parentTaskId: "task_2",
            subjectTaskId: "task_2",
            step: "executing" as const,
            status: "current" as const,
            label: "Dependency path updated after replan; waiting for replacement deliverable.",
            detail: null,
            createdAt: "2026-08-17T00:01:00.000Z",
          },
        ],
      },
    }));

    // The snapshot the client reloads after the event agrees that the task needs replanning, and
    // carries the Resume Affordance that says so. The board never infers the action from status.
    api.getCompanyState = vi.fn(async () => ({
      ...created,
      tasks: created.tasks.map((task) => (task.id === "task_1"
        ? {
          ...task,
          status: "needs_replan",
          failureReason: "needs_replan",
          affordances: offered("request_replan"),
        }
        : task)),
      proof: [],
      businessArtifacts: [],
      reviews: [],
      activity: [],
      creationEvents: [],
      creationAttempts: [],
      replanProposals: serverProposals,
      taskProgressEvents: [],
      ceoIntakes: [],
    }));

    render(<App apiClient={api} />);
    await createCompany(user);

    await waitFor(() => expect(api.lastEventHandler).toBeDefined());
    act(() => {
      api.lastEventHandler?.({
        type: "task_needs_replan",
        taskId: "task_1",
        status: "needs_replan",
        failureReason: "needs_replan",
        message: "Task needs replanning: Create landing page / exceeded long budget 10m.",
      });
    });

    await openPage(user, "Engineering");
    await user.click(await screen.findByRole("button", { name: "Ask for a new plan Create landing page" }));
    await user.click(await screen.findByRole("button", { name: "Create Replan Proposal" }));

    expect(screen.getByText("Create landing page — Original task exceeded long budget.")).toBeInTheDocument();
    expect(screen.getByText("Generated by CEO Agent")).toBeInTheDocument();
    expect(screen.getByText(".auto-crop/companies/company_1/replan-task_1-prompt.md")).toBeInTheDocument();
    expect(screen.getByText("Original Task")).toBeInTheDocument();
    expect(screen.getByText("Replacement Chain")).toBeInTheDocument();
    expect(screen.getByText("Plan smaller slice for Create landing page")).toBeInTheDocument();
    expect(screen.getByText("Affected Downstream")).toBeInTheDocument();
    expect(screen.getAllByText("Validate landing page").length).toBeGreaterThan(0);
    expect(screen.getByText("Rewire Preview")).toBeInTheDocument();
    expect(screen.getByText("Validate landing page will wait for Produce proof for Create landing page.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm Replan" }));

    expect(api.confirmReplanProposal).toHaveBeenCalledWith("replan_proposal_1");
    expect(await screen.findByText("Produce proof for Create landing page")).toBeInTheDocument();
    // The replacement tasks and the rewired downstream task are traces on the page.
    expect(screen.getByRole("region", { name: "Validate landing page" })).toBeInTheDocument();
    // Operations Diagnostics no longer lists new plans.
    await openPage(user, "Operations Diagnostics");
    expect(screen.queryByRole("region", { name: "New plans" })).not.toBeInTheDocument();
  });

  it("shows task budgets and failed reasons in Operations Diagnostics from SSE", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await openPage(user, "Operations Diagnostics");

    await waitFor(() => expect(api.lastEventHandler).toBeDefined());
    act(() => {
      api.lastEventHandler?.({
        type: "task_started",
        taskId: "task_1",
        effectiveTimeoutMs: 600_000,
        message: "Task started: Create landing page (codex, long budget 10m).",
      });
      api.lastEventHandler?.({
        type: "task_failed",
        taskId: "task_1",
        failureReason: "timeout",
        message: "Task failed: Create landing page / timeout after 10m.",
      });
    });

    // A plain sentence, with the raw codes and the budget kept under Details (dashboard ADR 0002).
    const stuck = await screen.findByRole("region", { name: "Stuck work" });
    expect(within(stuck).getByText("Create landing page is failed · timed out · 10m.")).toBeInTheDocument();
    const details = within(stuck).getByText("Details").closest("details")!;
    expect(details).toHaveTextContent("Status codefailed");
    expect(details).toHaveTextContent("Stop reasontimeout");
    expect(details).toHaveTextContent("Time budget10m");
    expect(screen.getByText("Running · Create landing page — Agent is working on this task. Budget: 10m.")).toBeInTheDocument();
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

  it("switches language from the onboarding language switch", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    expect(await screen.findByRole("heading", { name: "CEO Office" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Language" })).getByRole("button", { name: "中文" }));

    expect(screen.getByRole("heading", { name: "CEO 办公室" })).toBeInTheDocument();
    expect(window.localStorage.getItem("auto-crop.currentLanguage")).toBe("zh");
  });

  it("switches dashboard business content between English and Chinese", async () => {
    const api = createMockApiClient();
    const company = {
      ...createCompanyResponse(),
      activity: [
        {
          type: "task_warning",
          taskId: "task_1",
          message: "Task is ready for review.",
          messageText: { en: "Task is ready for review.", zh: "任务已准备好审查。" },
        },
      ],
      proof: [
        {
          id: "proof_1",
          taskId: "task_1",
          type: "command_output",
          uri: "agent.log",
          summary: "Generated landing page",
          summaryText: { en: "Generated landing page", zh: "已生成落地页" },
        },
      ],
      departments: [
        {
          ...createCompanyResponse().departments[0]!,
          nameText: { en: "Engineering", zh: "工程" },
          responsibilityText: { en: "Build prototype.", zh: "构建原型。" },
        },
      ],
      objectives: [
        {
          ...createCompanyResponse().objectives[0]!,
          titleText: { en: "Validate first wedge", zh: "验证第一个切入点" },
        },
      ],
      taskProgressEvents: (createCompanyResponse().taskProgressEvents ?? []).map((event) => {
        if (event.id === "task_progress_1") {
          return { ...event, labelText: { en: "Received CEO task", zh: "已接收 CEO 任务" } };
        }
        if (event.id === "task_progress_2") {
          return { ...event, labelText: { en: "Assessment complete", zh: "评估完成" } };
        }
        return { ...event, labelText: { en: "Task 1 (Create landing page) waiting", zh: "任务 1（创建落地页）等待中" } };
      }),
      tasks: [
        {
          ...createCompanyResponse().tasks[0]!,
          titleText: { en: "Create landing page", zh: "创建落地页" },
          descriptionText: { en: "Build a landing page.", zh: "构建一个落地页。" },
        },
      ],
    };
    api.createCompany = vi.fn(async () => company);
    api.getCompanyState = vi.fn(async () => ({ ...company, reviews: [], replanProposals: [] }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompany(user);
    expect(screen.getByRole("button", { name: "Engineering" })).toBeInTheDocument();
    await openPage(user, "Engineering");
    expect(screen.getAllByText(/Create landing page/).length).toBeGreaterThan(0);
    await openPage(user, "Deliverables");
    expect(screen.getByText("Generated landing page")).toBeInTheDocument();
    await openPage(user, "Operations Diagnostics");
    expect(screen.getByText(/Task is ready for review\./)).toBeInTheDocument();

    await switchLanguage(user, "中文");

    expect(screen.getByRole("button", { name: "工程" })).toBeInTheDocument();
    // Chrome follows the switch; task titles stay in the company locale, like CEO Office.
    await openPage(user, "工程");
    expect(screen.getByRole("region", { name: "任务" })).toHaveTextContent("Create landing page");
    await openPage(user, "运营诊断");
    expect(screen.getByText(/任务已准备好审查。/)).toBeInTheDocument();
    expect(screen.queryByText(/Task is ready for review\./)).not.toBeInTheDocument();
    await openPage(user, "交付物");
    expect(screen.getByText("已生成落地页")).toBeInTheDocument();
    // CEO Office chrome follows the switch; its business content stays in the company locale.
    await openPage(user, "CEO 办公室");
    expect(screen.getByRole("tab", { name: "时间线" })).toBeInTheDocument();
    expect(screen.queryByText("Build prototype.")).not.toBeInTheDocument();
  });

  it("restores the selected language after refresh", async () => {
    const restoreStorage = installMockLocalStorage({
      "auto-crop.currentLanguage": "zh",
    });
    const api = createMockApiClient();

    try {
      render(<App apiClient={api} />);

      expect(await screen.findByRole("heading", { name: "CEO 办公室" })).toBeInTheDocument();
      expect(within(screen.getByRole("group", { name: "语言" })).getByRole("button", { name: "中文" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    } finally {
      restoreStorage();
    }
  });

  it("initializes the dashboard language from the company locale on load", async () => {
    const restoreStorage = installMockLocalStorage({
      "auto-crop.currentCompanyId": "company_1",
      "auto-crop.currentLanguage": "en",
      "auto-crop.currentView": "operations",
    });
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.getCompanyState = vi.fn(async () => ({
      ...created,
      company: { ...created.company, status: "active" as const, locale: "zh" as const },
      proof: [],
      reviews: [],
      activity: [],
      replanProposals: created.replanProposals ?? [],
    }));

    try {
      const user = userEvent.setup();
      render(<App apiClient={api} />);

      // The company locale wins over the stored "en": chrome loads in Chinese with no toggle click.
      expect(await screen.findByRole("heading", { name: "运营诊断" })).toBeInTheDocument();

      // The toggle still switches chrome afterward.
      await switchLanguage(user, "English");

      expect(await screen.findByRole("heading", { name: "Operations Diagnostics" })).toBeInTheDocument();
    } finally {
      restoreStorage();
    }
  });

  it("selects detected agents from the onboarding agent list", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await user.type(await screen.findByLabelText("Company name"), "Pricing Page Studio");
    await user.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByRole("heading", { name: "Step 2 / Choose CEO" });
    await user.click(await screen.findByRole("button", { name: /Claude Code/ }));

    expect(screen.getByRole("button", { name: /Claude Code/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("hydrates persisted company state, proof, and activity after refresh", async () => {
    const restoreStorage = installMockLocalStorage({
      "auto-crop.currentCompanyId": "company_1",
      "auto-crop.currentView": "dashboard",
    });
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.getCompanyState = vi.fn(async () => ({
      ...created,
      company: {
        ...created.company,
        status: "active",
        selectedCeoAgentId: "codex",
      },
      tasks: [
        {
          ...created.tasks[0],
          status: "failed",
          failureReason: "timeout",
          effectiveTimeoutMs: 600_000,
          artifactWorkspacePath: ".auto-crop/workspaces/task_1",
        },
      ],
      proof: [
        {
          id: "proof_1",
          taskId: "task_1",
          type: "file",
          uri: ".auto-crop/workspaces/task_1/index.html",
          summary: "Prototype file captured.",
        },
      ],
      reviews: [],
      activity: [
        {
          type: "task_failed",
          taskId: "task_1",
          failureReason: "timeout",
          effectiveTimeoutMs: 600_000,
          message: "Task failed: Create landing page / timeout after 10m.",
        },
      ],
      replanProposals: created.replanProposals ?? [],
    }));

    try {
      const user = userEvent.setup();
      render(<App apiClient={api} />);

      // A page stored before the Workbench ("dashboard") opens where its content now lives.
      expect(await screen.findByRole("button", { name: "CEO Office" })).toHaveAttribute("aria-current", "page");
      expect(api.getCompanyState).toHaveBeenCalledWith("company_1");

      await openPage(user, "Operations Diagnostics");
      const stuck = screen.getByRole("region", { name: "Stuck work" });
      expect(within(stuck).getByText(/^Create landing page is failed · timed out · 10m/)).toBeInTheDocument();
      expect(within(stuck).getByText("Details").closest("details")).toHaveTextContent("Time budget10m");
      expect(within(stuck).getByText("Details").closest("details")).toHaveTextContent("Partial output.auto-crop/workspaces/task_1");
      expect(screen.getByText("Failed · Create landing page — Timed out before producing review-ready proof.")).toBeInTheDocument();

      await openPage(user, "Deliverables");
      expect(screen.getByText("File · .auto-crop/workspaces/task_1/index.html")).toBeInTheDocument();
    } finally {
      restoreStorage();
    }
  });

  it("restores the last company page after refresh", async () => {
    const restoreStorage = installMockLocalStorage({
      "auto-crop.currentCompanyId": "company_1",
      "auto-crop.currentView": "operations",
    });
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.getCompanyState = vi.fn(async () => ({
      ...created,
      company: {
        ...created.company,
        status: "active",
        selectedCeoAgentId: "codex",
      },
      proof: [],
      reviews: [],
      activity: [
        {
          type: "task_started",
          taskId: "task_1",
          message: "Task started: Create landing page (codex).",
        },
      ],
      replanProposals: created.replanProposals ?? [],
    }));

    try {
      render(<App apiClient={api} />);

      expect(await screen.findByRole("heading", { name: "Operations Diagnostics" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Agent activity" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Operations Diagnostics" })).toHaveAttribute("aria-current", "page");
    } finally {
      restoreStorage();
    }
  });

  it("shows every outcome card in the Outcomes tab, newest first, as the timeline posted them", async () => {
    const api = createMockApiClient();
    api.createCompany = vi.fn(async () => createOutcomesNewMarkerResponse());
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    await user.click(screen.getByRole("tab", { name: "Outcomes" }));
    const outcomes = screen.getByRole("tabpanel", { name: "Outcomes" });
    expect(cardLabels(outcomes)).toHaveLength(3);
    const conclusions = within(outcomes).getAllByRole("article").map((card) => card.textContent ?? "");
    expect(conclusions[0]).toContain("Prototype validated against the brief.");
    expect(conclusions[1]).toContain("Launch checklist is complete and reviewed.");
    expect(conclusions[2]).toContain("Two SEO keyword clusters are viable.");
    // A Task Brief is not an outcome.
    expect(outcomes).not.toHaveTextContent("Rank for buyer-intent SEO keywords");
  });

  it("shows Task Briefs and Execution Reports in the CEO Office Timeline", async () => {
    const api = createMockApiClient();
    api.createCompany = vi.fn(async () => createOutcomesNewMarkerResponse());
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    // Days before the latest fold away; open them to read the whole history.
    const timeline = ceoTimeline();
    expect(timeline).toHaveTextContent("Task started");
    expect(timeline).toHaveTextContent("Result");
    // The task_brief card is one announcement line: purpose + objective / key result.
    expect(timeline).toHaveTextContent("Rank for buyer-intent SEO keywords");
    expect(timeline).toHaveTextContent("Validate first wedge / Pick a first customer segment");
    // Founder vision is shown once above the tabs, not repeated on the brief card.
    expect(timeline).not.toHaveTextContent("Build an AI SaaS that creates pricing pages.");
    expect(screen.getByTitle("Build an AI SaaS that creates pricing pages.")).toHaveTextContent("Founder vision");
    // The Execution Report card leads with its conclusion; the gap and recommendation are detail.
    expect(timeline).toHaveTextContent("Prototype validated against the brief.");
    expect(timeline).not.toHaveTextContent("segment_selected");
    expect(timeline).not.toHaveTextContent("Organic traffic validation remains open.");
    expect(timeline).not.toHaveTextContent("Prepare the launch page next.");
    expect(timeline).not.toHaveTextContent("artifactSubtype");
    expect(timeline).not.toHaveTextContent("/private/workspace");

    // The detail table appears only after the card is activated.
    await user.click(within(timeline).getAllByRole("button", { name: "Open Result: Find SEO keyword opportunity" }).at(-1)!);
    const modal = screen.getByRole("dialog");
    expect(modal).toHaveTextContent("Organic traffic validation remains open.");
    expect(modal).toHaveTextContent("Prepare the launch page next.");
    expect(within(modal).getByRole("button", { name: "Open the department page" })).toBeInTheDocument();
  });

  it("shows the collapsed evidence section only inside the activated timeline card's modal", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      tasks: [{ ...created.tasks[0], id: "task_1", title: "Find SEO keyword opportunity", status: "review" }],
      proof: [
        { id: "proof_1", taskId: "task_1", type: "command_output", uri: "agent.log", summary: "Keyword scan output" },
      ],
      businessArtifacts: [createBusinessArtifactSummary("business_artifact_1", "task_1", "proof_1")],
      ceoOfficeItems: [
        {
          id: "execution_report:tce_1",
          type: "execution_report",
          companyId: "company_1",
          sourceId: "tce_1",
          taskId: "task_1",
          departmentId: "department_1",
          objectiveId: null,
          keyResultId: null,
          occurredAt: "2026-08-19T00:00:00.000Z",
          title: "Find SEO keyword opportunity",
          titleText: null,
          actionBearing: false,
          data: {
            conclusion: { en: "Two clusters are viable." },
            visionImpact: null,
            remainingGap: null,
            recommendation: null,
            summaryFallback: null,
            businessArtifactId: "business_artifact_1",
            remainingGaps: [],
            recommendedNextSteps: [],
            outcome: "accepted",
          },
        },
      ] satisfies CeoOfficeItemSummary[],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    const timeline = ceoTimeline();
    // The evidence section is not on the card; the raw artifact id is never shown.
    expect(timeline).not.toHaveTextContent("What the department sent");
    expect(timeline).not.toHaveTextContent("business_artifact_1");

    await user.click(within(timeline).getByRole("button", { name: "Open Result: Find SEO keyword opportunity" }));
    const modal = screen.getByRole("dialog");
    const evidence = within(modal).getByText("What the department sent").closest("details");
    expect(evidence).not.toHaveAttribute("open");
    expect(evidence).toHaveTextContent("Keyword scan output");
    // The deliverable file renders as its checks, not a raw id.
    expect(modal).not.toHaveTextContent("business_artifact_1");
  });

  it("marks a timeline card that arrived since the last visit as new", async () => {
    const restoreStorage = installMockLocalStorage({
      "auto-crop.ceoOutcomesLastSeen.company_1": "2026-08-18T00:00:00.000Z",
    });
    try {
      const api = createMockApiClient();
      api.createCompany = vi.fn(async () => createOutcomesNewMarkerResponse());
      const user = userEvent.setup();

      render(<App apiClient={api} />);
      await createCompany(user);

      const timeline = ceoTimeline();
      // The latest Result occurred after the last visit; the Task Brief occurred before it.
      const latest = within(timeline).getAllByRole("button", { name: "Open Result: Find SEO keyword opportunity" }).at(-1)!.closest("article")!;
      expect(within(latest).getByText("New")).toBeInTheDocument();
      const brief = within(timeline).getByRole("button", { name: "Open Task started: Find SEO keyword opportunity" }).closest("article")!;
      expect(within(brief).queryByText("New")).not.toBeInTheDocument();
    } finally {
      restoreStorage();
    }
  });

  it("marks how many outcomes are new since the last visit and clears the marker after a visit", async () => {
    const restoreStorage = installMockLocalStorage({
      "auto-crop.ceoOutcomesLastSeen.company_1": "2026-08-17T12:00:00.000Z",
    });
    try {
      const api = createMockApiClient();
      const response = createOutcomesNewMarkerResponse();
      api.createCompany = vi.fn(async () => response);
      api.getCompanyState = vi.fn(async () => ({
        ...response,
        proof: [],
        reviews: [],
        activity: [],
        replanProposals: response.replanProposals ?? [],
      }));
      const user = userEvent.setup();

      const { unmount } = render(<App apiClient={api} />);
      await createCompany(user);

      // Two of the three outcomes were created after the stubbed last-seen timestamp.
      expect(screen.getByRole("tab", { name: "Outcomes 2" })).toBeInTheDocument();
      await user.click(screen.getByRole("tab", { name: "Outcomes 2" }));
      expect(within(screen.getByRole("tabpanel", { name: "Outcomes 2" })).getByText("2 new since your last visit")).toBeInTheDocument();

      // Revisiting the company after the visit was recorded clears the marker.
      unmount();
      render(<App apiClient={api} />);
      await user.click(await screen.findByRole("tab", { name: "Outcomes" }));
      expect(screen.getByRole("tabpanel", { name: "Outcomes" })).not.toHaveTextContent(/new since your last visit/);
    } finally {
      restoreStorage();
    }
  });

  it("counts every new outcome in the marker", async () => {
    const restoreStorage = installMockLocalStorage({
      "auto-crop.ceoOutcomesLastSeen.company_1": "2026-08-16T00:00:00.000Z",
    });
    try {
      const api = createMockApiClient();
      const base = createOutcomesCompanyResponse();
      const manyReports = Array.from({ length: 15 }, (_, index) =>
        createExecutionReportCeoOfficeItem(`tce_${index}`, `2026-08-${String(17 + index).padStart(2, "0")}T00:00:00.000Z`, `Outcome ${index} is complete and reviewed.`),
      );
      api.createCompany = vi.fn(async () => ({
        ...base,
        founderDecisions: [],
        ceoOfficeItems: manyReports,
      }));
      const user = userEvent.setup();

      render(<App apiClient={api} />);
      await createCompany(user);

      await user.click(screen.getByRole("tab", { name: "Outcomes 15" }));
      const outcomes = screen.getByRole("tabpanel", { name: "Outcomes 15" });
      expect(within(outcomes).getByText("15 new since your last visit")).toBeInTheDocument();
      expect(within(outcomes).getAllByRole("article")).toHaveLength(15);
    } finally {
      restoreStorage();
    }
  });

  it("shows nothing new and does not throw when localStorage is absent", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    delete (window as { localStorage?: Storage }).localStorage;
    try {
      const api = createMockApiClient();
      api.createCompany = vi.fn(async () => createOutcomesNewMarkerResponse());
      const user = userEvent.setup();

      render(<App apiClient={api} />);
      await createCompany(user);

      expect(within(ceoTimeline()).queryByText("New")).not.toBeInTheDocument();
      await user.click(screen.getByRole("tab", { name: "Outcomes" }));
      expect(screen.getByRole("tabpanel", { name: "Outcomes" })).not.toHaveTextContent(/new since your last visit/);
    } finally {
      if (descriptor) {
        Object.defineProperty(window, "localStorage", descriptor);
      }
    }
  });

  it("shows nothing new and does not throw when the last-seen read throws", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => {
          if (key.startsWith("auto-crop.ceoOutcomesLastSeen.")) {
            throw new Error("storage blocked");
          }
          return values.get(key) ?? null;
        }),
        setItem: vi.fn((key: string, value: string) => {
          if (key.startsWith("auto-crop.ceoOutcomesLastSeen.")) {
            throw new Error("storage blocked");
          }
          values.set(key, value);
        }),
        removeItem: vi.fn((key: string) => values.delete(key)),
        clear: vi.fn(() => values.clear()),
      },
    });
    try {
      const api = createMockApiClient();
      api.createCompany = vi.fn(async () => createOutcomesNewMarkerResponse());
      const user = userEvent.setup();

      render(<App apiClient={api} />);
      await createCompany(user);

      expect(within(ceoTimeline()).queryByText("New")).not.toBeInTheDocument();
      await user.click(screen.getByRole("tab", { name: "Outcomes" }));
      expect(screen.getByRole("tabpanel", { name: "Outcomes" })).not.toHaveTextContent(/new since your last visit/);
    } finally {
      if (descriptor) {
        Object.defineProperty(window, "localStorage", descriptor);
      }
    }
  });

  it("marks the Final Founder Report banner as new against the last-seen value", async () => {
    const restoreStorage = installMockLocalStorage({
      "auto-crop.ceoOutcomesLastSeen.company_1": "2026-08-17T12:00:00.000Z",
    });
    try {
      const api = createMockApiClient();
      const response = {
        ...createFinalFounderReportCompanyResponse(),
        finalFounderReport: {
          ...createFinalFounderReportCompanyResponse().finalFounderReport!,
          createdAt: "2026-08-18T00:00:00.000Z",
        },
      };
      api.createCompany = vi.fn(async () => response);
      const user = userEvent.setup();

      render(<App apiClient={api} />);
      await createCompany(user);

      await user.click(screen.getByRole("tab", { name: "Outcomes" }));
      const panel = within(screen.getByRole("tabpanel", { name: "Outcomes" })).getByRole("region", { name: "Final report" });
      expect(within(panel).getByText("New")).toBeInTheDocument();
    } finally {
      restoreStorage();
    }
  });

  it("resolves a Founder Decision by picking an option, which accepts the deliverable", async () => {
    const api = createMockApiClient();
    api.createCompany = vi.fn(async () => createOutcomesCompanyResponse());
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    const decisions = within(needsYouColumn()).getByRole("region", { name: "Needs your decision" });
    await user.click(within(decisions).getByRole("button", { name: "Open: Find SEO keyword opportunity" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Research explored SMB marketing teams and enterprise RevOps");
    expect(dialog).toHaveTextContent("Fast to reach, lower contract value.");
    expect(within(dialog).getByText("Recommended")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Choose: SMB marketing teams" }));

    expect(api.resolveFounderDecision).toHaveBeenCalledWith({
      founderDecisionId: "task_completion_event_1_founder_decision_1",
      chosenOption: "SMB marketing teams",
    });
    expect(await within(needsYouColumn()).findByText("You chose an option. The deliverable is accepted.")).toBeInTheDocument();
    expect(within(needsYouColumn()).queryByRole("region", { name: "Needs your decision" })).not.toBeInTheDocument();
  });

  it("returns a Founder Decision to the department with a reason", async () => {
    const api = createMockApiClient();
    api.createCompany = vi.fn(async () => createOutcomesCompanyResponse());
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    await user.click(within(needsYouColumn()).getByRole("button", { name: "Open: Find SEO keyword opportunity" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByText("None of these. Return to the department", { selector: "summary" }));
    await user.click(within(dialog).getByRole("button", { name: "None of these. Return to the department" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose why you return it.");

    await user.selectOptions(within(dialog).getByLabelText("Why you return it"), "wrong_direction");
    await user.type(within(dialog).getByLabelText("Note to the department"), "Bring options with a clearer wedge.");
    await user.click(within(dialog).getByRole("button", { name: "None of these. Return to the department" }));

    expect(api.resolveFounderDecision).toHaveBeenCalledWith({
      founderDecisionId: "task_completion_event_1_founder_decision_1",
      action: "return",
      returnReason: "wrong_direction",
      note: "Bring options with a clearer wedge.",
    });
    expect(await within(needsYouColumn()).findByText("You returned it to the department for better options.")).toBeInTheDocument();
  });

  it("announces the goals with the plan, keeps them in view on the Plan tab, and posts each key result met", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      objectives: [{ id: "objective_1", title: "Validate first wedge", priority: 1 }],
      keyResults: [
        { id: "key_result_1", objectiveId: "objective_1", title: "Ship the prototype", metricName: "prototype", targetValue: "live URL", currentValue: "none", status: "met" },
        { id: "key_result_2", objectiveId: "objective_1", title: "Document the revenue path", metricName: "revenue", targetValue: "documented", currentValue: "none", status: "active" },
      ],
      tasks: [
        { ...created.tasks[0], id: "task_1", title: "Create landing page", status: "complete", keyResultId: "key_result_1" },
        { ...created.tasks[0], id: "task_2", title: "Write pricing brief", status: "running", keyResultId: "key_result_2" },
      ],
      visionGaps: [{
        id: "gap_1", companyId: "company_1", sourceTaskCompletionEventId: "done_1", taskId: "task_1", departmentId: "department_1",
        keyResultId: "key_result_1", businessArtifactId: null, label: "No paying customer has tried the page yet.", severity: "strategic" as const,
        relatedTaskId: null, relatedBusinessArtifactId: null, createdAt: "2026-08-17T00:04:00.000Z",
      }],
      ceoOfficeItems: [
        {
          id: "plan_brief:plan", type: "plan_brief", companyId: "company_1", sourceId: "plan", taskId: null, departmentId: null,
          objectiveId: null, keyResultId: null, occurredAt: "2026-08-17T00:00:00.000Z", title: "Company plan", titleText: null, actionBearing: false,
          data: {
            taskCount: 2,
            objectives: [{
              objectiveId: "objective_1", title: { en: "Validate first wedge" },
              keyResults: [
                { keyResultId: "key_result_1", title: { en: "Ship the prototype" }, targetValue: { en: "live URL" } },
                { keyResultId: "key_result_2", title: { en: "Document the revenue path" }, targetValue: { en: "documented" } },
              ],
            }],
            tasks: [
              { taskId: "task_1", title: { en: "Create landing page" }, purpose: { en: "Build it." }, departmentId: "department_1", keyResultId: "key_result_1", dependsOnTaskIds: [] },
              { taskId: "task_2", title: { en: "Write pricing brief" }, purpose: { en: "Write it." }, departmentId: "department_1", keyResultId: "key_result_2", dependsOnTaskIds: [] },
            ],
          },
        },
        {
          id: "key_result_met:key_result_1", type: "key_result_met", companyId: "company_1", sourceId: "key_result_1", taskId: null,
          departmentId: null, objectiveId: "objective_1", keyResultId: "key_result_1", occurredAt: "2026-08-17T00:03:00.000Z",
          title: "Ship the prototype", titleText: { en: "Ship the prototype", zh: "Ship the prototype" }, actionBearing: false,
          data: { keyResultId: "key_result_1", objectiveTitle: { en: "Validate first wedge" }, targetValue: { en: "live URL" }, metricName: "prototype", taskIds: ["task_1"] },
        },
      ] satisfies CeoOfficeItemSummary[],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    const timeline = ceoTimeline();
    expect(timeline).toHaveTextContent("The CEO set 1 goals with 2 key results, and planned 2 tasks.");
    expect(timeline).toHaveTextContent("Key result met");
    expect(timeline).toHaveTextContent("Every task for this key result is done. Target: live URL.");

    // The plan's detail reads goal → key result → the tasks that serve it.
    await user.click(within(timeline).getByRole("button", { name: "Open Plan: Company plan" }));
    const plan = screen.getByRole("dialog");
    expect(plan).toHaveTextContent("Validate first wedge / Ship the prototype");
    expect(plan).toHaveTextContent("Target: live URL — Create landing page");
    expect(plan).toHaveTextContent("Validate first wedge / Document the revenue path");
    expect(plan).toHaveTextContent("Target: documented — Write pricing brief");
    await user.click(within(plan).getByRole("button", { name: "Close" }));

    // The Outcomes tab carries the key result card and what is still missing from the vision.
    await user.click(screen.getByRole("tab", { name: "Outcomes" }));
    const outcomes = screen.getByRole("tabpanel", { name: "Outcomes" });
    expect(cardLabels(outcomes)).toEqual(["Open Key result met: Ship the prototype"]);
    const gaps = within(outcomes).getByRole("region", { name: "What is still missing from the vision" });
    expect(gaps).toHaveTextContent("No paying customer has tried the page yet.");
    expect(gaps).toHaveTextContent("Strategic");
  });

  it("keeps the decision in Needs you and the timeline while the task it blocks waits", async () => {
    const api = createMockApiClient();
    api.createCompany = vi.fn(async () => createOutcomesCompanyResponse());
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    expect(within(needsYouColumn()).getByRole("region", { name: "Needs your decision" })).toHaveTextContent("Find SEO keyword opportunity");
    expect(within(ceoTimeline()).getByRole("button", { name: "Open Needs your decision: Find SEO keyword opportunity" })).toBeInTheDocument();
    await user.click(within(ceoTimeline()).getByRole("button", { name: "Open Needs your decision: Find SEO keyword opportunity" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Prepare SEO launch");
  });

  it("renders acceptance events as business language in the agent activity log", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    await waitFor(() => expect(api.lastEventHandler).toBeDefined());
    act(() => {
      api.lastEventHandler?.({
        type: "automatic_acceptance",
        taskId: "task_1",
        message: "Automatic Acceptance accepted task: Create landing page.",
      });
      api.lastEventHandler?.({
        type: "founder_decision",
        taskId: "task_1",
        message: "Founder decision accepted task: Create landing page.",
      });
    });

    await openPage(user, "Operations Diagnostics");

    expect(await screen.findByRole("region", { name: "Agent activity" })).toBeInTheDocument();
    expect(
      screen.getByText("Accepted automatically · Create landing page — Automatic Acceptance accepted task: Create landing page."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Founder decision · Create landing page — Founder decision accepted task: Create landing page."),
    ).toBeInTheDocument();
  });
});


describe("Workbench", () => {
  it("lists CEO Office and each department in the rail, with what needs the founder and who is working", async () => {
    const api = createMockApiClient();
    const created = createReviewReadyCompanyResponse();
    api.createCompany = vi.fn(async () => ({
      ...created,
      departments: [
        ...created.departments,
        { id: "department_growth", name: "Growth", responsibility: "Prepare launch channels.", leadAgentId: "claude-code" },
      ],
      tasks: [
        ...created.tasks,
        { ...created.tasks[0]!, id: "task_growth", title: "Draft launch post", status: "running", departmentId: "department_growth", assigneeAgentId: "claude-code", affordances: [] },
      ],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    const rail = screen.getByRole("navigation", { name: "Workbench" });
    expect(within(rail).getByRole("heading", { name: "Pricing Page Studio" })).toBeInTheDocument();
    expect(within(rail).getByText("Operating")).toBeInTheDocument();
    // Named by the page alone; counts and working agents are its description.
    expect(within(rail).getByRole("button", { name: "CEO Office" })).toHaveAccessibleDescription("1 need you");
    expect(within(rail).getByRole("button", { name: "Engineering" })).toHaveAccessibleDescription("1 need you");
    expect(await within(rail).findByRole("button", { name: "Growth" })).toHaveAccessibleDescription("Claude Code is working");
    for (const page of ["Operations Diagnostics", "Deliverables", "Settings"]) {
      expect(within(rail).getByRole("button", { name: page })).toBeInTheDocument();
    }

    await openPage(user, "Growth");
    expect(screen.getByRole("heading", { level: 1, name: "Growth" })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: "Growth" })).toHaveAttribute("aria-current", "page");
  });

  it("shows deliverable files and their evidence without a load step", async () => {
    const api = createMockApiClient();
    const company = {
      ...createReviewReadyCompanyResponse(),
      proof: [{ id: "proof_1", taskId: "task_1", type: "file", uri: "prototype/index.html", summary: "Prototype page captured." }],
      reviews: [{ id: "review_1", companyId: "company_1", summary: "Ready for next cycle", reviewPath: "review.md", createdAt: "2026-08-17T00:03:00.000Z" }],
      activity: [],
      replanProposals: [],
    };
    api.createCompany = vi.fn(async () => company);
    // Opening Deliverables reads the snapshot again.
    api.getCompanyState = vi.fn(async () => company);
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await openPage(user, "Deliverables");

    const delivered = screen.getByRole("region", { name: "Validate the prototype" });
    expect(within(delivered).getByText("Current version")).toBeInTheDocument();
    expect(within(delivered).getByText("Prototype page captured.")).toBeInTheDocument();
    expect(within(delivered).getByText("File · prototype/index.html")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Review notes" })).toHaveTextContent("Ready for next cycle");
    expect(screen.queryByRole("button", { name: /load/i })).not.toBeInTheDocument();
  });

  it("reads deliverables fresh each time the page opens, since some arrive with no event", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.getCompanyState = vi.fn(async () => ({
      ...created,
      proof: [],
      reviews: [{ id: "review_1", companyId: "company_1", summary: "Written by the CLI review", reviewPath: "review.md", createdAt: "2026-08-17T00:03:00.000Z" }],
      activity: [],
      replanProposals: [],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    expect(screen.queryByText("Written by the CLI review")).not.toBeInTheDocument();

    await openPage(user, "Deliverables");
    expect(await screen.findByText("Written by the CLI review")).toBeInTheDocument();
  });

  it("stops a company from Settings only after its name is typed, and then offers no Pause", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await openPage(user, "Settings");

    const current = screen.getByRole("region", { name: "Current company" });
    await user.click(within(current).getByRole("button", { name: "Stop Operating" }));
    const confirm = within(current).getByRole("button", { name: "Stop this company" });
    expect(confirm).toBeDisabled();
    await user.type(within(current).getByLabelText("Type Pricing Page Studio to confirm"), "Pricing Page");
    expect(confirm).toBeDisabled();
    await user.type(within(current).getByLabelText("Type Pricing Page Studio to confirm"), " Studio");
    await user.click(confirm);

    expect(api.stopCompany).toHaveBeenCalledWith("company_1");
    expect(await within(current).findByText("Stopped")).toBeInTheDocument();
    expect(screen.getByText("This company has stopped. Its work stays here to read.")).toBeInTheDocument();
    expect(queryCommand("Pause Operating")).not.toBeInTheDocument();
    expect(queryCommand("Resume Operating")).not.toBeInTheDocument();
    expect(within(current).queryByRole("button", { name: "Stop Operating" })).not.toBeInTheDocument();
  });

  it("switches company from Settings, and creates a new one with a way back", async () => {
    const api = createMockApiClient();
    api.listCompanies = vi
      .fn()
      .mockResolvedValueOnce({ companies: [] })
      .mockResolvedValue({
        companies: [
          { id: "company_1", name: "Pricing Page Studio", status: "active", playbookId: "ai-saas", createdAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z", taskCount: 1 },
          { id: "company_2", name: "Ops Lab", status: "paused", playbookId: "ai-saas", createdAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-17T00:00:00.000Z", taskCount: 2 },
        ],
      });
    const created = createCompanyResponse();
    api.getCompanyState = vi.fn(async (companyId: string) => ({
      ...created,
      company: { ...created.company, id: companyId, name: companyId === "company_2" ? "Ops Lab" : "Pricing Page Studio", status: companyId === "company_2" ? "paused" : "active" },
      proof: [],
      reviews: [],
      activity: [],
      replanProposals: [],
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);
    await openPage(user, "Settings");

    const companies = screen.getByRole("region", { name: "All companies" });
    expect(await within(companies).findByRole("button", { name: /Pricing Page Studio/ })).toBeDisabled();
    await user.click(within(companies).getByRole("button", { name: /Ops Lab/ }));
    expect(await screen.findByRole("heading", { name: "Ops Lab" })).toBeInTheDocument();
    expect(api.getCompanyState).toHaveBeenLastCalledWith("company_2");
    expect(screen.getByRole("button", { name: "CEO Office" })).toHaveAttribute("aria-current", "page");
    expect(queryCommand("Resume Operating")).toBeInTheDocument();

    await openPage(user, "Settings");
    await user.click(screen.getByRole("button", { name: "Create New Company" }));
    expect(await screen.findByLabelText("Company name")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("heading", { name: "Ops Lab" })).toBeInTheDocument();
    expect(api.getCompanyState).toHaveBeenLastCalledWith("company_2");
  });

  it("pauses with Shift+Cmd+K only when the command model offers it", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    await user.keyboard("{Shift>}{Meta>}k{/Meta}{/Shift}");
    expect(api.pauseCompany).toHaveBeenCalledWith("company_1");
    expect(await screen.findByText("This company is paused. No new work starts until you resume it.")).toBeInTheDocument();
    await user.keyboard("{Shift>}{Meta>}k{/Meta}{/Shift}");
    expect(api.resumeCompany).toHaveBeenCalledWith("company_1");

    await openPage(user, "Settings");
    await user.click(screen.getByRole("button", { name: "Stop Operating" }));
    await user.type(screen.getByLabelText("Type Pricing Page Studio to confirm"), "Pricing Page Studio");
    await user.click(screen.getByRole("button", { name: "Stop this company" }));
    await screen.findByText("This company has stopped. Its work stays here to read.");
    vi.mocked(api.pauseCompany).mockClear();
    await user.keyboard("{Shift>}{Meta>}k{/Meta}{/Shift}");
    expect(api.pauseCompany).not.toHaveBeenCalled();
  });

  it("keeps a page crash to that page, so the rail still works", async () => {
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.createCompany = vi.fn(async () => ({ ...created, tasks: [{ ...created.tasks[0]!, status: "running" as const }] }));
    // A body the dashboard cannot render from; the real client rejects it, a bare mock does not.
    api.getTaskExecution = vi.fn(async () => ({}) as Awaited<ReturnType<ApiClient["getTaskExecution"]>>);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = userEvent.setup();

    try {
      render(<App apiClient={api} />);
      await createCompany(user);
      await openPage(user, "Engineering");

      expect(await screen.findByRole("alert")).toHaveTextContent("This page hit a problem.");
      expect(screen.getByRole("heading", { level: 1, name: "Engineering" })).toBeInTheDocument();

      await openPage(user, "Deliverables");
      expect(screen.queryByText("This page hit a problem.")).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1, name: "Deliverables" })).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("reopens the department page the founder left after a refresh", async () => {
    const restoreStorage = installMockLocalStorage({
      "auto-crop.currentCompanyId": "company_1",
      "auto-crop.currentView": "department:department_1",
    });
    const api = createMockApiClient();
    const created = createCompanyResponse();
    api.getCompanyState = vi.fn(async () => ({ ...created, proof: [], reviews: [], activity: [], replanProposals: [] }));

    try {
      render(<App apiClient={api} />);

      expect(await screen.findByRole("heading", { level: 1, name: "Engineering" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Tasks" })).toBeInTheDocument();
    } finally {
      restoreStorage();
    }
  });
});

// Every test reaches Workbench pages and founder commands through these helpers, so a change to where
// the rail, header or language switch draw them only changes these functions.

/** Opens a Workbench page from the rail, such as "CEO Office", a department, or "Settings". */
async function openPage(user: ReturnType<typeof userEvent.setup>, page: string) {
  await user.click(within(screen.getByRole("navigation")).getByRole("button", { name: page }));
}

/** Runs a founder command from the Workbench header, such as "Pause Operating". */
async function runCommand(user: ReturnType<typeof userEvent.setup>, command: string) {
  await user.click(within(screen.getByRole("banner")).getByRole("button", { name: command }));
}

function queryCommand(command: string | RegExp) {
  return within(screen.getByRole("banner")).queryByRole("button", { name: command });
}

/** Switches the interface language from the header's language switch. */
async function switchLanguage(user: ReturnType<typeof userEvent.setup>, language: "English" | "中文") {
  const header = screen.queryByRole("banner");
  const switches = (header ? within(header) : screen).getAllByRole("group", { name: /Language|语言/ });
  await user.click(within(switches[0]!).getByRole("button", { name: language }));
}

async function fillReadyToCreate(user: ReturnType<typeof userEvent.setup>) {
  expect(await screen.findByRole("heading", { name: "CEO Office" })).toBeInTheDocument();
  await user.type(screen.getByLabelText("Company name"), "Pricing Page Studio");
  await user.click(screen.getByRole("button", { name: /next/i }));
  expect(await screen.findByRole("heading", { name: "Step 2 / Choose CEO" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /codex/i }));
  await user.click(screen.getByRole("button", { name: /next/i }));
  await user.type(screen.getByLabelText("Founder vision"), "Build an AI SaaS that creates pricing pages.");
  await user.click(within(screen.getByRole("radiogroup", { name: "Permission mode" })).getByRole("radio", { name: "Balanced" }));
}

async function createCompany(user: ReturnType<typeof userEvent.setup>) {
  await fillReadyToCreate(user);
  await user.click(screen.getByRole("button", { name: /create company/i }));

  // Onboarding titles itself with the company name too, so wait for it to leave first.
  await waitFor(() => expect(screen.queryByLabelText("Founder vision")).not.toBeInTheDocument());
  expect(await screen.findByRole("heading", { name: "Pricing Page Studio" })).toBeInTheDocument();
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

function createCreatingCompanyResponse(): Awaited<ReturnType<ApiClient["createCompany"]>> {
  return {
    company: {
      id: "company_1",
      name: "Pricing Page Studio",
      status: "creating",
      playbookId: "ai-saas",
      founderVision: "Build an AI SaaS that creates pricing pages.",
      selectedCeoAgentId: "codex",
    },
    departments: [],
    objectives: [],
    keyResults: [],
    tasks: [],
    proof: [],
    reviews: [],
    activity: [],
    replanProposals: [],
    creationEvents: [
      {
        type: "company_creation_accepted",
        companyId: "company_1",
        message: "Company Creation accepted.",
        status: "creating",
      },
    ],
  };
}

function createFailedCompanyCreationResponse(): Awaited<ReturnType<ApiClient["createCompany"]>> {
  return {
    ...createCreatingCompanyResponse(),
    company: {
      ...createCreatingCompanyResponse().company,
      status: "creation_failed",
    },
    creationEvents: [
      {
        type: "company_creation_failed",
        companyId: "company_1",
        message: "Company Creation failed: temporary model failure",
        status: "creation_failed",
      },
    ],
  };
}

/**
 * The Resume Affordances the server would send for a task in this state. Fixtures carry them because
 * the dashboard offers actions from this list alone — it no longer derives eligibility from status
 * and failure reason (ADR 0020).
 */
function offered(...kinds: TaskAffordanceKind[]): TaskAffordanceSummary[] {
  return [...kinds, "cancel_task" as const].map((kind) => ({
    kind,
    actor: "founder" as const,
    holdId: "hold_1",
    holdKind: null,
    subjectKind: null,
    subjectId: null,
  }));
}

function createCompanyResponse(): Awaited<ReturnType<ApiClient["createCompany"]>> {
  return {
    company: {
      id: "company_1",
      name: "Pricing Page Studio",
      status: "active",
      playbookId: "ai-saas",
      founderVision: "Build an AI SaaS that creates pricing pages.",
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
    businessArtifacts: [],
    founderReport: {
      founderVision: "Build an AI SaaS that creates pricing pages.",
      actualOutputs: [],
      completedTaskCount: 0,
      reviewTaskCount: 0,
      blockedTaskCount: 0,
      directionDriftDetected: false,
      nextSteps: [],
    },
    replanProposals: [],
    ceoIntakes: [],
    taskProgressEvents: [
      {
        id: "task_progress_1",
        companyId: "company_1",
        departmentId: "department_1",
        parentTaskId: "task_1",
        subjectTaskId: null,
        step: "received",
        status: "complete",
        label: "Received CEO task",
        detail: null,
        createdAt: "2026-08-17T00:00:00.000Z",
      },
      {
        id: "task_progress_2",
        companyId: "company_1",
        departmentId: "department_1",
        parentTaskId: "task_1",
        subjectTaskId: null,
        step: "assessment_complete",
        status: "complete",
        label: "Assessment complete",
        detail: null,
        createdAt: "2026-08-17T00:01:00.000Z",
      },
      {
        id: "task_progress_3",
        companyId: "company_1",
        departmentId: "department_1",
        parentTaskId: "task_1",
        subjectTaskId: "task_1",
        step: "executing",
        status: "waiting",
        label: "Task 1 (Create landing page) waiting",
        detail: null,
        createdAt: "2026-08-17T00:02:00.000Z",
      },
    ],
  };
}

function createBusinessArtifactSummary(
  id: string,
  taskId: string,
  sourceProofId: string,
): BusinessArtifactSummary {
  return {
    id,
    companyId: "company_1",
    taskId,
    sourceProofId,
    artifactKind: "deliverable",
    artifactRole: "implementation",
    artifactSubtype: "prototype_implementation",
    artifactType: "implementation_summary",
    taskType: "test_task",
    payload: {
      result: "Prototype validates locally.",
      execution_report: {
        conclusion: "The prototype works end to end and is ready to show users.",
        vision_impact: "It clears the build milestone.",
        remaining_gap: "Real-user validation before launch remains.",
        recommendation: "Review the prototype deliverable.",
      },
      outcome_summary:
        "The prototype works end to end and is ready to show users. It clears the build milestone; the remaining gap is real-user validation before launch.",
    },
    lineage: { founder_vision: "Build an AI SaaS that creates pricing pages." },
    validationStatus: "valid",
    validationErrors: [],
    reviewStatus: "unreviewed",
    isCurrent: true,
    supersedesArtifactId: null,
    createdAt: "2026-08-17T00:02:00.000Z",
    updatedAt: "2026-08-17T00:02:00.000Z",
  };
}

function createHumanActionSummary(): HumanActionSummary {
  return {
    id: "task_completion_event_1_human_action_1",
    companyId: "company_1",
    sourceTaskCompletionEventId: "task_completion_event_1",
    taskId: "task_1",
    departmentId: "department_1",
    label: "Publish the prototype URL.",
    blockedTaskIds: ["task_2"],
    confirmationRequirements: ["configuration_value", "approval_note"],
    evidence: {},
    status: "pending",
    verifiedAt: null,
    verificationErrors: [],
    createdAt: "2026-08-17T00:02:00.000Z",
  };
}

function createWaitStateSummary(): WaitStateSummary {
  return {
    id: "task_completion_event_1_wait_state_1",
    companyId: "company_1",
    sourceTaskCompletionEventId: "task_completion_event_1",
    taskId: "task_1",
    departmentId: "department_1",
    keyResultId: "key_result_1",
    businessArtifactId: null,
    label: "Wait for search indexing signals.",
    reason: "Wait for search indexing signals.",
    relatedTaskId: "task_2",
    relatedBusinessArtifactId: null,
    affectedTaskIds: ["task_2"],
    nextCheckAt: "2026-08-18T00:00:00.000Z",
    status: "waiting",
    severity: "informational",
    createdAt: "2026-08-17T00:02:00.000Z",
  };
}

function createVisionGapSummary(): VisionGapSummary {
  return {
    id: "task_completion_event_1_vision_gap_1",
    companyId: "company_1",
    sourceTaskCompletionEventId: "task_completion_event_1",
    taskId: "task_1",
    departmentId: "department_1",
    keyResultId: "key_result_1",
    businessArtifactId: null,
    label: "Vision does not yet define pricing conversion KPI.",
    severity: "strategic",
    relatedTaskId: "task_2",
    relatedBusinessArtifactId: null,
    createdAt: "2026-08-17T00:02:00.000Z",
  };
}

function createCeoAttentionRollupSummary(): CeoAttentionRollupSummary {
  const humanAction = createHumanActionSummary();
  const waitState = createWaitStateSummary();
  const visionGap = createVisionGapSummary();

  return {
    id: "ceo_attention_rollup_1",
    companyId: "company_1",
    group: { type: "dependency_chain", taskId: "task_2" },
    title: "Launch path blocked on deployment evidence",
    summary: "Website exists but launch cannot continue until a deployable URL is confirmed.",
    ownerDepartmentId: "department_1",
    downstreamDepartmentIds: ["department_growth"],
    affectedTaskIds: ["task_2"],
    currentBlocker: "Production URL missing.",
    recommendedNextAction: "Confirm deployment evidence or assign deployment follow-up.",
    severity: "blocking",
    reasons: ["human_action", "cross_department_impact"],
    relevantHumanActions: [humanAction],
    relevantWaitStates: [waitState],
    relevantVisionGaps: [visionGap],
    relevantFounderDecisions: [],
    sourceTaskCompletionEventIds: ["task_completion_event_1"],
    createdAt: "2026-08-17T00:02:00.000Z",
  };
}

function createCeoOfficeAttentionCompanyResponse(): Awaited<ReturnType<ApiClient["createCompany"]>> {
  const created = createCompanyResponse();

  return {
    ...created,
    departments: [
      ...created.departments,
      {
        id: "department_growth",
        name: "Growth",
        responsibility: "Prepare launch channels.",
        leadAgentId: "codex",
      },
    ],
    tasks: [
      {
        ...created.tasks[0],
        id: "task_1",
        title: "Build deployable website",
        status: "complete",
        departmentId: "department_1",
      },
      {
        ...created.tasks[0],
        id: "task_2",
        title: "Prepare SEO launch",
        status: "blocked",
        departmentId: "department_growth",
        dependsOnTaskIds: ["task_1"],
        dependencyNote: "Needs deployed URL from Engineering.",
      },
      {
        ...created.tasks[0],
        id: "task_3",
        title: "Hidden blocked implementation subtask",
        status: "blocked",
        departmentId: "department_1",
        parentTaskId: "task_1",
        taskKind: "department_subtask",
        dependencyNote: "Internal implementation detail.",
      },
      {
        ...created.tasks[0],
        id: "task_4",
        title: "Review gated launch artifact",
        status: "review",
        affordances: offered("ceo_review_decision"),
        departmentId: "department_1",
      },
    ],
    proof: [
      {
        id: "proof_1",
        taskId: "task_4",
        type: "command_output",
        uri: "agent.log",
        summary: "Generated launch artifact",
      },
    ],
    businessArtifacts: [createBusinessArtifactSummary("business_artifact_1", "task_4", "proof_1")],
    ceoAttentionRollups: [createCeoAttentionRollupSummary()],
    ceoOfficeItems: [createApprovalRequestCeoOfficeItem({
      businessArtifactId: "business_artifact_1",
      taskId: "task_4",
      title: "Review gated launch artifact",
    })],
    humanActions: [createHumanActionSummary()],
    visionGaps: [createVisionGapSummary()],
    waitStates: [createWaitStateSummary()],
  };
}

function createReviewReadyCompanyResponse(): Awaited<ReturnType<ApiClient["createCompany"]>> {
  const created = createCompanyResponse();
  return {
    ...created,
    tasks: [
      {
        ...created.tasks[0],
        title: "Validate the prototype",
        status: "review",
        affordances: offered("ceo_review_decision"),
        executionProfileName: "short",
        requestedTimeoutMs: 120_000,
        effectiveTimeoutMs: 120_000,
        artifactWorkspacePath: ".auto-crop/workspaces/task_1",
      },
    ],
    taskProgressEvents: [
      ...created.taskProgressEvents!.slice(0, 2),
      {
        id: "task_progress_3",
        companyId: "company_1",
        departmentId: "department_1",
        parentTaskId: "task_1",
        subjectTaskId: "task_1",
        step: "awaiting_review",
        status: "current",
        label: "Awaiting review",
        detail: null,
        createdAt: "2026-08-17T00:02:00.000Z",
      },
    ],
    businessArtifacts: [createBusinessArtifactSummary("business_artifact_1", "task_1", "proof_1")],
    ceoOfficeItems: [createApprovalRequestCeoOfficeItem({
      businessArtifactId: "business_artifact_1",
      taskId: "task_1",
      title: "Validate the prototype",
    })],
    founderReport: {
      ...created.founderReport!,
      reviewTaskCount: 1,
      nextSteps: ["Review Validate the prototype."],
    },
  };
}

/** The "Needs you" column of CEO Office. */
function needsYouColumn() {
  return screen.getByRole("complementary", { name: "Needs you" });
}

/** The scrolling CEO Office Timeline. */
function ceoTimeline() {
  return screen.getByRole("region", { name: "Timeline" });
}

/** The cards in a container, oldest first, by the name of the control that opens each one. */
function cardLabels(container: HTMLElement): string[] {
  return within(container)
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? "")
    .filter((label) => /^Open .+: /.test(label));
}

function createDecisionRequestCeoOfficeItem(decision: FounderDecisionSummary, title: string): CeoOfficeItemSummary {
  return {
    id: `decision_request:${decision.id}`,
    type: "decision_request",
    companyId: decision.companyId,
    sourceId: decision.id,
    taskId: decision.taskId,
    departmentId: decision.departmentId,
    objectiveId: null,
    keyResultId: null,
    occurredAt: decision.createdAt,
    title,
    titleText: null,
    actionBearing: decision.status === "pending",
    data: {
      decisionKind: decision.decisionKind,
      options: decision.options,
      rationale: decision.rationale,
      briefing: decision.briefing,
      status: decision.status,
      resolvedOption: decision.resolvedOption,
      resolvedAt: decision.resolvedAt,
      blockedTaskIds: decision.blockedTaskIds,
    },
  };
}

function createHumanActionCeoOfficeItem(action: HumanActionSummary, title: string): CeoOfficeItemSummary {
  return {
    id: `human_action:${action.id}`,
    type: "human_action",
    companyId: action.companyId,
    sourceId: action.id,
    taskId: action.taskId,
    departmentId: action.departmentId,
    objectiveId: null,
    keyResultId: null,
    occurredAt: action.createdAt,
    title,
    titleText: null,
    actionBearing: action.status === "pending",
    data: {
      label: { en: action.label },
      status: action.status,
      confirmationRequirements: action.confirmationRequirements,
      blockedTaskIds: action.blockedTaskIds,
      verifiedAt: action.verifiedAt,
    },
  };
}

function createFounderIntakeCeoOfficeItem(
  intakeId: string,
  body: string,
  status: "received" | "assessing" | "dispatched" | "failed",
  occurredAt: string,
  options: { departmentId?: string | null; routedFromIntakeId?: string | null } = {},
): CeoOfficeItemSummary {
  return {
    id: `founder_intake:${intakeId}`,
    type: "founder_intake",
    companyId: "company_1",
    sourceId: intakeId,
    taskId: null,
    departmentId: options.departmentId ?? null,
    objectiveId: null,
    keyResultId: null,
    occurredAt,
    title: "Founder input",
    titleText: { en: "Founder input", zh: "Founder input" },
    actionBearing: false,
    data: { intakeId, body, status, routedFromIntakeId: options.routedFromIntakeId ?? null },
  };
}

function createIntakeOutcomeCeoOfficeItem(
  intakeId: string,
  data: {
    status: "dispatched" | "failed";
    outcome: "create_tasks" | "revise_plan" | "context_only" | "route_department" | "attach_to_task" | "route_to_ceo" | null;
    summary: { en?: string; zh?: string } | null;
    createdTaskIds?: string[];
    replanProposalId?: string | null;
    targetTaskId?: string | null;
    targetDepartmentId?: string | null;
    departmentId?: string | null;
    failureReason?: "agent_failed" | "invalid_agent_output" | "plan_not_made" | "company_stopped" | "no_agent" | null;
  },
): CeoOfficeItemSummary {
  return {
    id: `intake_outcome:${intakeId}`,
    type: "intake_outcome",
    companyId: "company_1",
    sourceId: intakeId,
    taskId: data.targetTaskId ?? null,
    departmentId: data.departmentId ?? null,
    objectiveId: null,
    keyResultId: null,
    occurredAt: "2026-08-17T00:06:00.000Z",
    title: "CEO answer",
    titleText: { en: "CEO answer", zh: "CEO answer" },
    actionBearing: false,
    data: {
      intakeId,
      status: data.status,
      outcome: data.outcome,
      summary: data.summary,
      createdTaskIds: data.createdTaskIds ?? [],
      targetTaskId: data.targetTaskId ?? null,
      targetDepartmentId: data.targetDepartmentId ?? null,
      replanProposalId: data.replanProposalId ?? null,
      failureReason: data.failureReason ?? null,
    },
  };
}

function createExecutionReportCeoOfficeItem(sourceId: string, occurredAt: string, conclusion: string, title = "Find SEO keyword opportunity"): CeoOfficeItemSummary {
  return {
    id: `execution_report:${sourceId}`,
    type: "execution_report",
    companyId: "company_1",
    sourceId,
    taskId: "task_1",
    departmentId: "department_research",
    objectiveId: "objective_1",
    keyResultId: "key_result_1",
    occurredAt,
    title,
    titleText: null,
    actionBearing: false,
    data: {
      conclusion: { en: conclusion },
      visionImpact: null,
      remainingGap: null,
      recommendation: null,
      summaryFallback: null,
      businessArtifactId: "business_artifact_1",
      remainingGaps: [],
      recommendedNextSteps: [],
      outcome: "accepted",
    },
  };
}

function createApprovalRequestCeoOfficeItem({
  businessArtifactId,
  taskId,
  title,
}: {
  businessArtifactId: string;
  taskId: string;
  title: string;
}): CeoOfficeItemSummary {
  return {
    id: `approval_request:${businessArtifactId}`,
    type: "approval_request",
    companyId: "company_1",
    sourceId: businessArtifactId,
    taskId,
    departmentId: "department_1",
    objectiveId: null,
    keyResultId: null,
    occurredAt: "2026-08-17T00:02:00.000Z",
    title,
    titleText: null,
    actionBearing: true,
    data: {
      businessArtifactId,
      status: "pending",
    },
  };
}

function createDependencyGraphCompanyResponse(): Awaited<ReturnType<ApiClient["createCompany"]>> {
  const created = createCompanyResponse();
  return {
    ...created,
    departments: [
      {
        id: "department_research",
        name: "Research",
        responsibility: "Find viable market proof.",
        leadAgentId: "codex",
      },
      {
        id: "department_product",
        name: "Product",
        responsibility: "Define the sellable MVP.",
        leadAgentId: "codex",
      },
      {
        id: "department_engineering",
        name: "Engineering",
        responsibility: "Build and validate the product.",
        leadAgentId: "codex",
      },
      {
        id: "department_growth",
        name: "Growth",
        responsibility: "Prepare launch channels.",
        leadAgentId: "codex",
      },
    ],
    tasks: [
      {
        ...created.tasks[0],
        id: "task_1",
        title: "Find SEO keyword opportunity",
        status: "complete",
        departmentId: "department_research",
        dependsOnTaskIds: [],
      },
      {
        ...created.tasks[0],
        id: "task_2",
        title: "Define MVP and revenue path",
        status: "complete",
        departmentId: "department_product",
        dependsOnTaskIds: ["task_1"],
      },
      {
        ...created.tasks[0],
        id: "task_3",
        title: "Build runnable prototype",
        status: "complete",
        departmentId: "department_engineering",
        dependsOnTaskIds: ["task_2"],
      },
      {
        ...created.tasks[0],
        id: "task_4",
        title: "Validate prototype locally",
        status: "running",
        departmentId: "department_engineering",
        dependsOnTaskIds: ["task_3"],
      },
      {
        ...created.tasks[0],
        id: "task_5",
        title: "Prepare SEO launch and indexing assets",
        status: "waiting_dependency",
        departmentId: "department_growth",
        dependsOnTaskIds: ["task_1", "task_2", "task_4"],
      },
      {
        ...created.tasks[0],
        id: "task_6",
        title: "Continue from Partial Output: Record implementation changes",
        status: "complete",
        departmentId: "department_engineering",
      },
    ],
    taskProgressEvents: [],
  };
}

function createFounderDecisionSummary(overrides: Partial<FounderDecisionSummary> = {}): FounderDecisionSummary {
  return {
    id: "task_completion_event_1_founder_decision_1",
    companyId: "company_1",
    sourceTaskCompletionEventId: "task_completion_event_1",
    taskId: "task_1",
    departmentId: "department_research",
    decisionKind: "target_market",
    options: [
      { label: "SMB marketing teams", tradeoffs: "Fast to reach, lower contract value.", recommended: true },
      { label: "Enterprise RevOps", tradeoffs: "Higher value, long sales cycle.", recommended: false },
    ],
    rationale: "Research surfaced two viable segments; the first customer profile is the founder's call.",
    briefing: "Research explored SMB marketing teams and enterprise RevOps; SMB converts faster but at lower value, and the monetization case rests on volume.",
    status: "pending",
    resolvedOption: null,
    resolvedAt: null,
    blockedTaskIds: ["task_2"],
    createdAt: "2026-08-17T00:02:00.000Z",
    ...overrides,
  };
}

function createTaskCompletionEventSummary(
  overrides: Partial<TaskCompletionEventSummary> = {},
): TaskCompletionEventSummary {
  return {
    id: "task_completion_event_1",
    companyId: "company_1",
    taskId: "task_1",
    departmentId: "department_research",
    keyResultId: "key_result_1",
    businessArtifactId: "business_artifact_1",
    outcome: "accepted",
    acceptanceProvenance: "automatic_acceptance",
    outcomeSummaryText: {
      en: "Two SEO keyword clusters are viable; the recommended one has the least competition. This clears the discovery milestone; the gap is a validated pricing conversion path.",
    },
    dependencyImpact: { updatedTasks: [{ taskId: "task_2", status: "queued" }], errors: [] },
    nextStepItems: [],
    visionGaps: [],
    createdAt: "2026-08-17T00:02:00.000Z",
    ...overrides,
  };
}

function createOutcomesCompanyResponse(): Awaited<ReturnType<ApiClient["createCompany"]>> {
  const created = createCompanyResponse();
  return {
    ...created,
    departments: [
      { id: "department_research", name: "Research", responsibility: "Find viable market proof.", leadAgentId: "codex" },
      { id: "department_growth", name: "Growth", responsibility: "Prepare launch channels.", leadAgentId: "codex" },
    ],
    objectives: [
      { id: "objective_1", title: "Validate first wedge", priority: 1 },
      { id: "objective_2", title: "Prove a repeatable launch", priority: 2 },
    ],
    keyResults: [
      {
        id: "key_result_1",
        objectiveId: "objective_1",
        title: "Pick a first customer segment",
        metricName: "segment_selected",
        targetValue: "1",
        currentValue: "0",
        status: "on_track",
      },
    ],
    tasks: [
      {
        ...created.tasks[0],
        id: "task_1",
        title: "Find SEO keyword opportunity",
        status: "review",
        departmentId: "department_research",
      },
      {
        ...created.tasks[0],
        id: "task_2",
        title: "Prepare SEO launch",
        status: "waiting_dependency",
        departmentId: "department_growth",
        dependsOnTaskIds: ["task_1"],
      },
    ],
    taskProgressEvents: [],
    taskCompletionEvents: [createTaskCompletionEventSummary()],
    founderDecisions: [createFounderDecisionSummary()],
    ceoOfficeItems: [
      createExecutionReportCeoOfficeItem("task_completion_event_1", "2026-08-17T00:02:00.000Z", "Two SEO keyword clusters are viable; the recommended one has the least competition."),
      createDecisionRequestCeoOfficeItem(createFounderDecisionSummary(), "Find SEO keyword opportunity"),
    ],
  };
}

function createOutcomesNewMarkerResponse(): Awaited<ReturnType<ApiClient["createCompany"]>> {
  const base = createOutcomesCompanyResponse();
  return {
    ...base,
    tasks: base.tasks.map((task) =>
      task.id === "task_1" ? { ...task, description: "Rank for buyer-intent SEO keywords" } : task,
    ),
    founderDecisions: [],
    taskCompletionEvents: [
      createTaskCompletionEventSummary({ id: "tce_early", createdAt: "2026-08-17T00:02:00.000Z" }),
      createTaskCompletionEventSummary({
        id: "tce_mid",
        createdAt: "2026-08-18T00:00:00.000Z",
        outcomeSummaryText: { en: "Launch checklist is complete and reviewed." },
      }),
      createTaskCompletionEventSummary({
        id: "tce_late",
        createdAt: "2026-08-19T00:00:00.000Z",
        outcomeSummaryText: { en: "Prototype validated against the brief." },
      }),
    ],
    ceoOfficeItems: [
      createExecutionReportCeoOfficeItem("tce_early", "2026-08-17T00:02:00.000Z", "Two SEO keyword clusters are viable."),
      createExecutionReportCeoOfficeItem("tce_mid", "2026-08-18T00:00:00.000Z", "Launch checklist is complete and reviewed."),
      {
        id: "task_brief:task_1",
        type: "task_brief",
        companyId: "company_1",
        sourceId: "task_1",
        taskId: "task_1",
        departmentId: "department_research",
        objectiveId: "objective_1",
        keyResultId: "key_result_1",
        occurredAt: "2026-08-17T00:01:00.000Z",
        title: "Find SEO keyword opportunity",
        titleText: null,
        actionBearing: false,
        data: {
          purpose: { en: "Rank for buyer-intent SEO keywords" },
          purposeSource: "task_definition",
          founderVision: "Build an AI SaaS that creates pricing pages.",
          objectiveTitle: { en: "Validate first wedge" },
          keyResultTitle: { en: "Pick a first customer segment" },
          keyResultMetricName: "segment_selected",
          keyResultTargetValue: { en: "1" },
          dependsOnTaskIds: [],
        },
      },
      {
        id: "execution_report:tce_late",
        type: "execution_report",
        companyId: "company_1",
        sourceId: "tce_late",
        taskId: "task_1",
        departmentId: "department_research",
        objectiveId: "objective_1",
        keyResultId: "key_result_1",
        occurredAt: "2026-08-19T00:00:00.000Z",
        title: "Find SEO keyword opportunity",
        titleText: null,
        actionBearing: false,
        data: {
          conclusion: { en: "Prototype validated against the brief." },
          visionImpact: { en: "The SEO wedge supports the founder vision." },
          remainingGap: { en: "Organic traffic validation remains open." },
          recommendation: { en: "Prepare the launch page next." },
          summaryFallback: null,
          businessArtifactId: "business_artifact_1",
          remainingGaps: [],
          recommendedNextSteps: [],
          outcome: "accepted",
        },
      },
    ],
  };
}

function createFinalFounderReportCompanyResponse(): Awaited<ReturnType<ApiClient["createCompany"]>> {
  const created = createCompanyResponse();
  return {
    ...created,
    finalFounderReport: {
      id: "founder_report_1",
      classification: "waiting",
      generatedBy: "ceo_agent",
      sections: {
        vision: { en: "Restated vision for the founder.", zh: "为创始人复述愿景。" },
        actualResult: { en: "A proof-backed prototype shipped.", zh: "交付了有证据支撑的原型。" },
        departmentContributions: [
          { en: "Engineering built and validated the prototype.", zh: "工程部构建并验证了原型。" },
        ],
        goalFit: { en: "Partial fit against the key results.", zh: "与关键结果部分契合。" },
        remainingGaps: { en: "User validation is still open.", zh: "用户验证仍待完成。" },
        recommendedNextStep: {
          en: "Monitor the search-indexing Wait State until 2026-08-27.",
          zh: "在 2026-08-27 之前关注搜索索引等待状态。",
        },
      },
    },
  };
}

function createReplanProposalSummary(): ReplanProposalSummary {
  return {
    id: "replan_proposal_1",
    companyId: "company_1",
    sourceTaskId: "task_1",
    status: "proposed",
    proposalSource: "planner_agent",
    plannerAgentId: "codex",
    plannerPromptPath: ".auto-crop/companies/company_1/replan-task_1-prompt.md",
    rationale: "Original task exceeded long budget.",
    replacementTasks: [
      {
        title: "Plan smaller slice for Create landing page",
        description: "Define a smaller slice.",
        requiredCapabilities: ["writing", "research"],
        proofSchemaId: "product-brief",
        riskLevel: "low",
      },
      {
        title: "Produce proof for Create landing page",
        description: "Produce proof.",
        requiredCapabilities: ["code", "frontend"],
        proofSchemaId: "landing-page-file",
        riskLevel: "medium",
      },
    ],
    createdAt: "2026-08-17T00:00:00.000Z",
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
    listCompanies: vi.fn(async () => ({ companies: [] })),
    async createCompany() {
      return createCompanyResponse();
    },
    async retryCompanyCreation() {
      return createCreatingCompanyResponse();
    },
    createDepartmentIntake: vi.fn(async (companyId, departmentId, input) => ({
      intake: {
        id: "department_intake_1",
        companyId,
        departmentId,
        body: input.body,
        status: "received" as const,
        createdAt: "2026-08-17T00:00:00.000Z",
        updatedAt: "2026-08-17T00:00:00.000Z",
      },
    })),
    createCeoIntake: vi.fn(async (companyId, input) => ({
      intake: {
        id: "ceo_intake_1",
        companyId,
        body: input.body,
        status: "received" as const,
        createdAt: "2026-08-17T00:00:00.000Z",
        updatedAt: "2026-08-17T00:00:00.000Z",
      },
    })),
    createCeoReviewDecision: vi.fn(async (input) => ({
      decision: {
        id: "ceo_review_decision_1",
        taskId: input.taskId,
        decision: input.decision,
        returnReason: input.returnReason ?? null,
        note: input.note ?? null,
        createdAt: "2026-08-17T00:03:00.000Z",
      },
      task: {
        ...createCompanyResponse().tasks[0],
        id: input.taskId,
        status: input.decision === "approve" ? "complete" : "queued",
      },
    })),
    resolveFounderDecision: vi.fn(async (input) => ({
      founderDecision: {
        id: input.founderDecisionId,
        companyId: "company_1",
        sourceTaskCompletionEventId: "task_completion_event_1",
        taskId: "task_1",
        departmentId: "department_1",
        decisionKind: "product_direction" as const,
        options: [],
        rationale: "",
        briefing: "",
        status: input.action === "return" ? ("returned" as const) : ("resolved" as const),
        resolvedOption: input.chosenOption ?? null,
        resolvedAt: "2026-08-17T00:03:00.000Z",
        blockedTaskIds: [],
        createdAt: "2026-08-17T00:02:00.000Z",
      },
      accepted: input.action !== "return",
      task: {
        ...createCompanyResponse().tasks[0],
        id: "task_1",
        status: input.action === "return" ? "queued" : "complete",
      },
    })),
    async getCompanyState() {
      const created = createCompanyResponse();
      return {
        ...created,
        proof: [],
        reviews: [],
        activity: [],
        replanProposals: created.replanProposals ?? [],
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
    async refreshTask(taskId) {
      return {
        task: createCompanyResponse().tasks.find((task) => task.id === taskId) ?? createCompanyResponse().tasks[0],
        event: {
          type: "dependency_ready",
          taskId,
          status: "queued",
          message: "Task refreshed.",
        },
      };
    },
    getTaskExecution: vi.fn(async () => { throw new Error("Execution fixture required"); }),
    authorizeExecutionBudget: vi.fn(async () => { throw new Error("Authorization fixture required"); }),
    cancelTask: vi.fn(async () => { throw new Error("Cancellation fixture required"); }),
    async confirmTaskTermination(taskId) {
      return {
        task: createCompanyResponse().tasks.find((task) => task.id === taskId) ?? createCompanyResponse().tasks[0],
        releasedWorkspaces: [],
      };
    },
    async recoverTask(taskId) {
      return {
        task: createCompanyResponse().tasks.find((task) => task.id === taskId) ?? createCompanyResponse().tasks[0],
        event: {
          type: "task_recovered",
          taskId,
          status: "queued",
          message: "Task recovered.",
        },
        recovery: {
          status: "queued",
          message: "Task recovered and queued for another run.",
        },
      };
    },
    async decideFounderApproval(approvalId, input) {
      return {
        approval: {
          id: approvalId,
          companyId: "company_1",
          taskId: "task_1",
          actionType: "run_safe_command",
          riskLevel: "low",
          status: input.decision,
          requestedAt: "2026-08-17T00:00:00.000Z",
          decidedAt: "2026-08-17T01:00:00.000Z",
          note: input.note ?? null,
        },
        task: {
          ...createCompanyResponse().tasks[0]!,
          status: input.decision === "approved" ? "queued" : "needs_replan",
        },
        event: {
          type: "founder_approval",
          taskId: "task_1",
          status: input.decision === "approved" ? "queued" : "needs_replan",
          message: "Founder answered the approval request.",
        },
      };
    },
    async rejectReplanProposal() {
      return { proposal: { ...createReplanProposalSummary(), status: "rejected" } };
    },
    async createReplanProposal() {
      return { proposal: createReplanProposalSummary() };
    },
    async confirmReplanProposal() {
      return {
        proposal: { ...createReplanProposalSummary(), status: "confirmed", confirmedAt: "2026-08-17T00:01:00.000Z" },
        sourceTask: { ...createCompanyResponse().tasks[0], status: "blocked", failureReason: "needs_replan" },
        createdTasks: [],
      };
    },
    confirmHumanAction: vi.fn(async (_companyId, humanActionId, input) => ({
      humanAction: {
        id: humanActionId,
        companyId: "company_1",
        sourceTaskCompletionEventId: "task_completion_event_1",
        taskId: "task_1",
        departmentId: "department_1",
        label: "Publish the prototype URL.",
        blockedTaskIds: ["task_2"],
        confirmationRequirements: ["configuration_value", "approval_note"],
        evidence: input.evidence,
        status: "confirmed" as const,
        verifiedAt: "2026-08-17T00:03:00.000Z",
        verificationErrors: [],
        createdAt: "2026-08-17T00:02:00.000Z",
      },
      updatedTasks: [{ ...createCompanyResponse().tasks[0], id: "task_2", status: "queued" }],
      events: [{ type: "dependency_ready", taskId: "task_2", message: "Human Action confirmed; task queued." }],
    })),
    pauseCompany: vi.fn(async (companyId: string) => ({
      company: { id: companyId, name: "Pricing Page Studio", status: "paused", playbookId: "ai-saas" },
      interruptedTasks: [],
      unreachableTasks: [],
    })),
    resumeCompany: vi.fn(async (companyId: string) => ({
      company: { id: companyId, name: "Pricing Page Studio", status: "active", playbookId: "ai-saas" },
      interruptedTasks: [],
      unreachableTasks: [],
    })),
    stopCompany: vi.fn(async (companyId: string) => ({
      company: { id: companyId, name: "Pricing Page Studio", status: "stopped", playbookId: "ai-saas" },
      interruptedTasks: [],
      unreachableTasks: [],
    })),
    subscribeEvents: vi.fn(function (
      this: ApiClient & { lastEventHandler?: (event: ServerEvent) => void },
      _companyId,
      handler,
    ) {
      this.lastEventHandler = handler;
      return () => undefined;
    }),
  };
}

function installMockLocalStorage(initial: Record<string, string>) {
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  const values = new Map(Object.entries(initial));
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    },
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(window, "localStorage", descriptor);
    } else {
      delete (window as { localStorage?: Storage }).localStorage;
    }
  };
}
