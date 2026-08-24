// @vitest-environment jsdom
import "./test/setup";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import type { ApiClient, ReplanProposalSummary, ServerEvent } from "./api/client";

describe("Dashboard App", () => {
  it("starts on the company-name step only", async () => {
    const api = createMockApiClient();

    render(<App apiClient={api} />);

    expect(await screen.findByRole("heading", { name: "CEO Office" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "CEO Office" })).toBeInTheDocument();
    expect(document.querySelector("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Step 1 / Company Name" })).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Step 2 / Choose CEO" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Founder vision")).not.toBeInTheDocument();
    expect(api.listCompanies).toHaveBeenCalledTimes(1);
    expect(api.listAgents).not.toHaveBeenCalled();
  });

  it("opens a recent company when browser storage has no current company", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();
    api.listCompanies = vi.fn(async () => ({
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
    }));
    api.getCompanyState = vi.fn(async () => {
      const created = createCompanyResponse();
      return {
        ...created,
        company: {
          ...created.company,
          id: "company_2",
          name: "Ops Lab",
          status: "active",
          selectedCeoAgentId: "codex",
        },
        proof: [],
        reviews: [],
        activity: [],
        replanProposals: created.replanProposals ?? [],
      };
    });

    render(<App apiClient={api} />);

    expect(await screen.findByRole("heading", { name: "Recent Companies" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /ops lab/i }));

    expect(await screen.findByRole("heading", { name: "Company Operating Dashboard" })).toBeInTheDocument();
    expect(api.getCompanyState).toHaveBeenCalledWith("company_2");
    expect(window.localStorage.getItem("auto-crop.currentCompanyId")).toBe("company_2");
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

    expect(screen.getByRole("dialog", { name: "MATT" })).toBeInTheDocument();
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
    expect(screen.getByRole("dialog", { name: "CEO Office" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "CEO agent blueprint generation in progress" })).toBeInTheDocument();
    expect(document.querySelector("dialog")).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "CEO" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Engineering" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /CEO Codex/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Engineering 01/i })).not.toBeInTheDocument();
    const ceoReport = screen.getByRole("region", { name: "CEO Intake Report" });
    expect(within(ceoReport).getByRole("heading", { name: "Objectives" })).toBeInTheDocument();
    expect(within(ceoReport).getByText("Validate first wedge")).toBeInTheDocument();
    expect(within(ceoReport).getByRole("heading", { name: "First Tasks" })).toBeInTheDocument();
    expect(within(ceoReport).getByText("Create landing page / queued")).toBeInTheDocument();
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
    expect(screen.queryByText("Playbook")).not.toBeInTheDocument();
  });

  it("creates a durable CEO intake from the CEO Workspace", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompany(user);
    await user.type(screen.getByRole("textbox", { name: "New vision, material, or task" }), "Add multiplayer mode.");
    await user.click(screen.getByRole("button", { name: /send ceo office/i }));

    expect(api.createCeoIntake).toHaveBeenCalledWith("company_1", { body: "Add multiplayer mode." });
    expect(screen.getByText("Request: Add multiplayer mode.")).toBeInTheDocument();
    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(screen.getByText("CEO assessing")).toBeInTheDocument();
    expect(screen.getByText("Assessment complete")).toBeInTheDocument();
    expect(screen.getByText("Planning")).toBeInTheDocument();
    expect(screen.getByText("Generated objectives/tasks/department assignments")).toBeInTheDocument();
    expect(screen.getByText("Dispatching")).toBeInTheDocument();
    expect(screen.getByText("Dispatched to departments")).toBeInTheDocument();
  });

  it("shows department agent, task completion, and input controls", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));

    expect(screen.getByRole("heading", { name: "Engineering Workspace" })).toBeInTheDocument();
    expect(screen.getByText("Current Agent")).toBeInTheDocument();
    expect(screen.getByText("Capabilities: code / frontend / test")).toBeInTheDocument();
    const leaderReport = screen.getByRole("region", { name: "Department Leader Report" });
    expect(leaderReport).toHaveTextContent("Current department mission: Build prototype.");
    expect(leaderReport).toHaveTextContent("CEO Task Progress");
    expect(screen.getByRole("heading", { name: "Task 1: Create landing page" })).toBeInTheDocument();
    expect(leaderReport).toHaveTextContent("Received CEO task");
    expect(leaderReport).toHaveTextContent("Assessment complete");
    expect(leaderReport).toHaveTextContent("Task (Create landing page) waiting");
    expect(leaderReport).not.toHaveTextContent("Task 1 (Create landing page) waiting");
    expect(screen.queryByText("CEO Assigned Tasks")).not.toBeInTheDocument();
    expect(screen.queryByText("Create landing page / queued")).not.toBeInTheDocument();
    expect(screen.getByText("Role")).toBeInTheDocument();
    expect(screen.queryByText("Memory")).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Question, material, or task" }), "Use this launch copy.");
    expect(screen.getByRole("button", { name: /send engineering/i })).toHaveTextContent("Send");
    expect(screen.getByRole("button", { name: /send engineering/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /send engineering/i }).closest(".department-message-box__composer")).toContainElement(
      screen.getByRole("textbox", { name: "Question, material, or task" }),
    );
    expect(screen.queryByRole("button", { name: "Send to CEO Office" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /send engineering/i }));
    expect(screen.getByText("Input staged for the department agent.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Question, material, or task" })).toHaveValue("");
    expect(screen.getByRole("button", { name: /send engineering/i })).toBeDisabled();
  });

  it("routes department review-ready tasks to CEO Pending without approval controls", async () => {
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
      };
    });
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompany(user);
    await user.click(screen.getByRole("button", { name: "Engineering" }));

    const leaderReport = screen.getByRole("region", { name: "Department Leader Report" });
    expect(leaderReport).toHaveTextContent("Task (Validate the prototype) submitted to CEO Office for review");
    expect(within(leaderReport).getByRole("button", { name: "View CEO Pending Item" })).toBeInTheDocument();
    expect(leaderReport).not.toHaveTextContent("awaiting review");

    await user.click(within(leaderReport).getByRole("button", { name: "View CEO Pending Item" }));

    expect(screen.getByRole("button", { name: "CEO" })).toHaveAttribute("aria-pressed", "true");
    const ceoPending = screen.getByRole("region", { name: "CEO Pending" });
    expect(ceoPending).toHaveTextContent("Review request from Engineering");
    expect(ceoPending).toHaveTextContent("Validate the prototype");
    expect(within(ceoPending).getByRole("button", { name: "View Task Validate the prototype" })).toBeInTheDocument();
    expect(within(ceoPending).queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(within(ceoPending).queryByRole("button", { name: /return/i })).not.toBeInTheDocument();
  });

  it("opens CEO task review details and approves proof-backed completion review items", async () => {
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
        note: "Looks good.",
        proofId: "proof_1",
        createdAt: "2026-08-17T00:03:00.000Z",
      },
      task: {
        ...createCompanyResponse().tasks[0],
        status: "complete" as const,
      },
    }));
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    const ceoPending = screen.getByRole("region", { name: "CEO Pending" });
    await user.click(within(ceoPending).getByRole("button", { name: "View Task Validate the prototype" }));

    const taskReview = screen.getByRole("region", { name: "Task Review" });
    expect(within(taskReview).getByRole("heading", { name: "Task Review" })).toBeInTheDocument();
    expect(within(taskReview).getByText("This task can pass now because the department submitted checkable proof.")).toBeInTheDocument();
    expect(within(taskReview).getByText("Prototype is playable locally.")).toBeInTheDocument();
    expect(within(taskReview).getByText("file / proof.md")).toBeInTheDocument();

    await user.click(within(taskReview).getByRole("button", { name: "Approve, mark complete" }));

    expect(api.createCeoReviewDecision).toHaveBeenCalledWith({
      taskId: "task_1",
      decision: "approve",
    });
    expect(await screen.findByText("CEO Office approved the task.")).toBeInTheDocument();
    expect(screen.queryByText("Validate the prototype")).not.toBeInTheDocument();
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

    const ceoPending = screen.getByRole("region", { name: "CEO Pending" });
    await user.click(within(ceoPending).getByRole("button", { name: "View Task Validate the prototype" }));

    const taskReview = screen.getByRole("region", { name: "Task Review" });
    expect(
      within(taskReview).getByText(
        "The department has not submitted a checkable result yet, so this cannot pass. You can return it to the department for more results or explanation.",
      ),
    ).toBeInTheDocument();
    expect(within(taskReview).queryByRole("button", { name: "Approve, mark complete" })).not.toBeInTheDocument();

    await user.click(within(taskReview).getByRole("button", { name: "Return to department" }));
    expect(within(taskReview).getByRole("alert")).toHaveTextContent("Choose why this is being returned.");

    await user.selectOptions(within(taskReview).getByLabelText("Return reason"), "needs_changes");
    await user.type(within(taskReview).getByLabelText("Next step note"), "Add proof and explain the next step.");
    await user.click(within(taskReview).getByRole("button", { name: "Return to department" }));

    expect(api.createCeoReviewDecision).toHaveBeenCalledWith({
      taskId: "task_1",
      decision: "return",
      returnReason: "needs_changes",
      note: "Add proof and explain the next step.",
    });
    expect(await screen.findByText("CEO Office returned the task to the department.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Engineering" }));
    expect(screen.getByRole("region", { name: "Department Leader Report" })).toHaveTextContent(
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

    const ceoPending = screen.getByRole("region", { name: "CEO Pending" });
    await user.click(within(ceoPending).getByRole("button", { name: "View Task Validate the prototype" }));
    const taskReview = screen.getByRole("region", { name: "Task Review" });
    await user.selectOptions(within(taskReview).getByLabelText("Return reason"), "needs_changes");
    await user.type(within(taskReview).getByLabelText("Next step note"), "Add proof.");
    await user.click(within(taskReview).getByRole("button", { name: "Return to department" }));

    expect(await within(taskReview).findByRole("alert")).toHaveTextContent("Request failed: 404");
    expect(within(taskReview).getByRole("button", { name: "Return to department" })).toBeEnabled();
  });

  it("returns to setup from workspace views without showing the generated blueprint", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createCompany(user);
    await user.click(screen.getByRole("menuitem", { name: "Company" }));
    await user.click(screen.getByRole("menuitem", { name: "Back to Setup" }));

    expect(await screen.findByRole("heading", { name: "Step 3 / Founder Vision" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Blueprint Review" })).not.toBeInTheDocument();
    expect(screen.queryByText("Create landing page")).not.toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Company" }));
    await user.click(screen.getByRole("menuitem", { name: "Activate Company" }));
    expect(await screen.findByRole("heading", { name: "Company Operating Dashboard" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Company" }));
    await user.click(screen.getByRole("menuitem", { name: "Back to Setup" }));

    expect(await screen.findByRole("heading", { name: "Step 3 / Founder Vision" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Blueprint Review" })).not.toBeInTheDocument();
  });

  it("updates task event stream messages from SSE", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompanyAndOpenDashboard(user);

    await waitFor(() => expect(api.lastEventHandler).toBeDefined());
    act(() => {
      api.lastEventHandler?.({ type: "task_warning", taskId: "task_1", message: "Task warning: ignored invalid timeout." });
    });

    expect(await screen.findByText("Task warning: ignored invalid timeout.")).toBeInTheDocument();
  });

  it("updates task status in the Department Workspace from SSE", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompany(user);

    await waitFor(() => expect(api.lastEventHandler).toBeDefined());
    act(() => {
      api.lastEventHandler?.({
        type: "task_started",
        taskId: "task_1",
        message: "Task started: Create landing page (codex).",
      });
    });

    expect(await screen.findByText("Create landing page / running")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Agent Activity" })).not.toBeInTheDocument();
    expect(screen.queryByText("Task started: Create landing page (codex).")).not.toBeInTheDocument();
  });

  it("shows failed task reasons in the Department Workspace from SSE", async () => {
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

    expect(await screen.findByText("Create landing page / failed · timeout")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Agent Activity" })).not.toBeInTheDocument();
    expect(screen.queryByText("Task failed: Create landing page / timeout after 10m.")).not.toBeInTheDocument();
  });

  it("shows coordination task states in the Department Workspace from SSE", async () => {
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
    });

    expect(await screen.findByText("Create landing page / waiting for upstream proof")).toBeInTheDocument();

    act(() => {
      api.lastEventHandler?.({
        type: "task_retrying",
        taskId: "task_1",
        status: "retrying",
        message: "Task warning: Create landing page / timed out after 5m; retrying with long budget 10m.",
      });
    });

    expect(await screen.findByText("Create landing page / retrying with a larger budget")).toBeInTheDocument();

    act(() => {
      api.lastEventHandler?.({
        type: "task_needs_replan",
        taskId: "task_1",
        status: "needs_replan",
        failureReason: "needs_replan",
        message: "Task needs replanning: Create landing page / exceeded long budget 10m.",
      });
    });

    expect(await screen.findByText("Create landing page / needs replanning")).toBeInTheDocument();
  });

  it("refreshes a blocked task from the Department Workspace", async () => {
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

    expect(await screen.findByText("Create landing page / blocked · dependency_failed · Blocked by failed dependency: Write brief.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh Create landing page" }));

    expect(api.refreshTask).toHaveBeenCalledWith("task_1");
    expect(await screen.findByText("Create landing page / queued")).toBeInTheDocument();
  });

  it("shows agent activity on a dedicated Company Operations page", async () => {
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

    expect(screen.queryByRole("heading", { name: "Agent Activity" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Work" }));
    await user.click(screen.getByRole("menuitem", { name: "View Operations" }));

    expect(await screen.findByRole("heading", { name: "Company Operations" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agent Activity" })).toBeInTheDocument();
    expect(screen.getByText("Failed · Create landing page — Timed out before producing review-ready proof.")).toBeInTheDocument();
    expect(screen.queryByText("Task failed: Create landing page / timeout after 10m.")).not.toBeInTheDocument();
  });

  it("explains coordination events on the Company Operations page", async () => {
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

    await user.click(screen.getByRole("menuitem", { name: "Work" }));
    await user.click(screen.getByRole("menuitem", { name: "View Operations" }));

    expect(await screen.findByText("Waiting · Create landing page — Waiting for dependency deliverable: Research brief (running).")).toBeInTheDocument();
    expect(screen.getByText("Retrying · Create landing page — Retrying with a larger execution budget.")).toBeInTheDocument();
    expect(screen.getByText("Needs replan · Create landing page — Task is too large for the current execution budget and needs to be split.")).toBeInTheDocument();
  });

  it("shows and confirms replan proposals on the Company Operations page", async () => {
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
    api.createReplanProposal = vi.fn(async () => ({
      proposal: createReplanProposalSummary(),
    }));
    api.confirmReplanProposal = vi.fn(async () => ({
      proposal: { ...createReplanProposalSummary(), status: "confirmed", confirmedAt: "2026-08-17T00:01:00.000Z" },
      sourceTask: { ...createCompanyResponse().tasks[0], status: "blocked", failureReason: "needs_replan" },
      createdTasks: [
        { ...createCompanyResponse().tasks[0], id: "task_2", title: "Plan smaller slice for Create landing page", status: "queued" },
        { ...createCompanyResponse().tasks[0], id: "task_3", title: "Produce proof for Create landing page", status: "queued" },
        { ...createCompanyResponse().tasks[0], id: "task_4", title: "Validate replacement output for Create landing page", status: "queued" },
      ],
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

    await user.click(screen.getByRole("menuitem", { name: "Work" }));
    await user.click(screen.getByRole("menuitem", { name: "View Operations" }));
    await user.click(await screen.findByRole("button", { name: "Create Replan Proposal" }));

    expect(await screen.findByText("Replan Proposals")).toBeInTheDocument();
    expect(screen.getByText("Create landing page — Original task exceeded long budget.")).toBeInTheDocument();
    expect(screen.getByText("Generated by CEO Agent")).toBeInTheDocument();
    expect(screen.getByText(".auto-crop/companies/company_1/replan-task_1-prompt.md")).toBeInTheDocument();
    expect(screen.getByText("Original Task")).toBeInTheDocument();
    expect(screen.getByText("Replacement Chain")).toBeInTheDocument();
    expect(screen.getByText("Plan smaller slice for Create landing page")).toBeInTheDocument();
    expect(screen.getByText("Affected Downstream")).toBeInTheDocument();
    expect(screen.getByText("Validate landing page")).toBeInTheDocument();
    expect(screen.getByText("Rewire Preview")).toBeInTheDocument();
    expect(screen.getByText("Validate landing page will wait for Produce proof for Create landing page.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm Replan" }));

    expect(api.confirmReplanProposal).toHaveBeenCalledWith("replan_proposal_1");
    expect(await screen.findByText("Produce proof for Create landing page")).toBeInTheDocument();
  });

  it("updates task status in the operating dashboard from SSE", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompanyAndOpenDashboard(user);

    await waitFor(() => expect(api.lastEventHandler).toBeDefined());
    act(() => {
      api.lastEventHandler?.({
        type: "task_review",
        taskId: "task_1",
        message: "Task is ready for review.",
      });
    });

    expect(await screen.findByText("Create landing page / REVIEW")).toBeInTheDocument();
  });

  it("shows task budgets and failed reasons in the operating dashboard from SSE", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompanyAndOpenDashboard(user);

    await waitFor(() => expect(api.lastEventHandler).toBeDefined());
    act(() => {
      api.lastEventHandler?.({
        type: "task_started",
        taskId: "task_1",
        message: "Task started: Create landing page (codex, long budget 10m).",
      });
      api.lastEventHandler?.({
        type: "task_failed",
        taskId: "task_1",
        failureReason: "timeout",
        message: "Task failed: Create landing page / timeout after 10m.",
      });
    });

    expect(await screen.findByText("Create landing page / FAILED · TIMEOUT")).toBeInTheDocument();
    expect(screen.getByText("Task started: Create landing page (codex, long budget 10m).")).toBeInTheDocument();
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

  it("restores the selected skin after refresh", async () => {
    const restoreStorage = installMockLocalStorage({
      "auto-crop.currentSkin": "geek02",
    });
    const api = createMockApiClient();

    try {
      render(<App apiClient={api} />);

      await screen.findByRole("heading", { name: "CEO Office" });
      expect(document.querySelector(".theme-root")).toHaveAttribute("data-skin", "geek02");
    } finally {
      restoreStorage();
    }
  });

  it("switches language from the reusable View menu", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    expect(await screen.findByRole("heading", { name: "CEO Office" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "View" }));
    await user.click(screen.getByRole("menuitem", { name: "Language" }));
    await user.click(screen.getByRole("menuitem", { name: "中文" }));

    expect(screen.getByRole("heading", { name: "CEO 办公室" })).toBeInTheDocument();
    expect(window.localStorage.getItem("auto-crop.currentLanguage")).toBe("zh");
  });

  it("restores the selected language after refresh", async () => {
    const restoreStorage = installMockLocalStorage({
      "auto-crop.currentLanguage": "zh",
    });
    const api = createMockApiClient();

    try {
      render(<App apiClient={api} />);

      expect(await screen.findByRole("heading", { name: "CEO 办公室" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "视图" })).toBeInTheDocument();
    } finally {
      restoreStorage();
    }
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

  it("returns from the task dashboard to the Department Workspace from the Work menu", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createCompanyAndOpenDashboard(user);

    await user.click(screen.getByRole("menuitem", { name: "Work" }));
    await user.click(screen.getByRole("menuitem", { name: "View Departments" }));

    expect(await screen.findByRole("heading", { name: "Pricing Page Studio" })).toBeInTheDocument();
    expect(screen.getByText("Department Workspace")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "CEO Workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Company Operating Dashboard" })).not.toBeInTheDocument();
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

  it("hydrates persisted company state, proof, and activity after refresh", async () => {
    const restoreStorage = installMockLocalStorage({ "auto-crop.currentCompanyId": "company_1" });
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
      render(<App apiClient={api} />);

      expect(await screen.findByRole("heading", { name: "Company Operating Dashboard" })).toBeInTheDocument();
      expect(api.getCompanyState).toHaveBeenCalledWith("company_1");
      expect(screen.getByText("Create landing page / FAILED · TIMEOUT · 10M · PARTIAL OUTPUT: .AUTO-CROP/WORKSPACES/TASK_1")).toBeInTheDocument();
      expect(screen.getByText(".auto-crop/workspaces/task_1/index.html")).toBeInTheDocument();
      expect(screen.getByText("Task failed: Create landing page / timeout after 10m.")).toBeInTheDocument();
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

      expect(await screen.findByRole("heading", { name: "Company Operations" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Agent Activity" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Company Operating Dashboard" })).not.toBeInTheDocument();
    } finally {
      restoreStorage();
    }
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

function createReviewReadyCompanyResponse(): Awaited<ReturnType<ApiClient["createCompany"]>> {
  const created = createCompanyResponse();
  return {
    ...created,
    tasks: [
      {
        ...created.tasks[0],
        title: "Validate the prototype",
        status: "review",
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
