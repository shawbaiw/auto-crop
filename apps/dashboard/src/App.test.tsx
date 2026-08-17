// @vitest-environment jsdom
import "./test/setup";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import type { ApiClient, ServerEvent } from "./api/client";

describe("Dashboard App", () => {
  it("creates a company from onboarding, reviews the blueprint, activates it, and shows the operating dashboard", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await createAndActivateCompany(user);

    expect(screen.getByRole("heading", { name: "Company Operating Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("CEO Office")).toBeInTheDocument();
    expect(screen.getByText("OKR System")).toBeInTheDocument();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("Active Tasks")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Proof" })).toBeInTheDocument();
    expect(screen.getByText("Approvals")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("updates task event stream messages from SSE", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);
    await createAndActivateCompany(user);

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

    render(<App apiClient={api} />);

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
    await user.click(screen.getByRole("button", { name: /codex/i }));
    await user.type(screen.getByLabelText("Founder vision"), "Build an AI SaaS that creates pricing pages.");
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
    await user.click(screen.getByRole("menuitem", { name: "极客02" }));

    expect(document.querySelector(".theme-root")).toHaveAttribute("data-skin", "geek02");
  });

  it("selects detected agents from the reusable Agents menu", async () => {
    const api = createMockApiClient();
    const user = userEvent.setup();

    render(<App apiClient={api} />);

    await screen.findByRole("heading", { name: "CEO Office" });
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
    await createAndActivateCompany(user);

    await user.click(screen.getByRole("menuitem", { name: "Work" }));
    await user.click(screen.getByRole("menuitem", { name: "View Tasks" }));
    await waitFor(() => expect(document.activeElement).toHaveAttribute("id", "active-tasks"));

    await user.click(screen.getByRole("menuitem", { name: "Proof" }));
    await user.click(screen.getByRole("menuitem", { name: "Load Review" }));
    await waitFor(() => expect(document.activeElement).toHaveAttribute("id", "review"));
    expect(await screen.findByText("Ready for next cycle")).toBeInTheDocument();
  });
});

async function createAndActivateCompany(user: ReturnType<typeof userEvent.setup>) {
  expect(await screen.findByRole("heading", { name: "CEO Office" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /codex/i }));
  await user.type(screen.getByLabelText("Founder vision"), "Build an AI SaaS that creates pricing pages.");
  await user.click(screen.getByRole("button", { name: /permission mode/i }));
  await user.click(screen.getByRole("option", { name: "Balanced" }));
  await user.click(screen.getByRole("button", { name: /create company/i }));

  expect(await screen.findByText("Pricing Page Studio")).toBeInTheDocument();
  expect(screen.getByText("Validate first wedge")).toBeInTheDocument();
  expect(screen.getByText("Create landing page")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /activate company/i }));
  expect(await screen.findByRole("heading", { name: "Company Operating Dashboard" })).toBeInTheDocument();
}

function createMockApiClient(): ApiClient & { lastEventHandler?: (event: ServerEvent) => void } {
  return {
    lastEventHandler: undefined,
    async listAgents() {
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
    },
    async createCompany() {
      return {
        company: {
          id: "company_1",
          name: "Pricing Page Studio",
          status: "draft",
          playbookId: "ai-saas",
        },
        departments: [
          { id: "department_1", name: "Engineering", responsibility: "Build prototype." },
        ],
        objectives: [{ id: "objective_1", title: "Validate first wedge", priority: 1 }],
        tasks: [
          {
            id: "task_1",
            title: "Create landing page",
            status: "queued",
            departmentId: "department_1",
          },
        ],
        editable: {
          companyName: "Pricing Page Studio",
          objectives: ["Validate first wedge"],
          firstTasks: ["Create landing page"],
        },
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
