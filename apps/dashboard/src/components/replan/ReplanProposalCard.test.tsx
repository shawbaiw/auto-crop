// @vitest-environment jsdom
import "../../test/setup";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReplanProposalSummary, TaskSummary } from "../../api/client";
import { LanguageProvider } from "../../ui/language";
import { ReplanProposalCard } from "./ReplanProposalCard";
import { ReplanRequestForm } from "./ReplanRequestForm";

const keyword: TaskSummary = { id: "task_1", title: "Pick a low-KD keyword", departmentId: "research", status: "blocked",
  affordances: [{ kind: "request_replan", actor: "founder", subjectId: "ha_1", holdId: "hold_1", holdKind: "awaiting_human_action", subjectKind: "human_action" }] };
const verifier: TaskSummary = { id: "task_2", title: "Check the keyword pick", departmentId: "research", status: "waiting_dependency" };
const define: TaskSummary = { id: "task_3", title: "Define the checks", departmentId: "research", status: "complete" };

const revision: ReplanProposalSummary = {
  id: "replan_1", companyId: "company_1", sourceTaskId: "task_1", status: "proposed", proposalSource: "planner_agent",
  plannerAgentId: "codex", mode: "revision", requestedMode: "revision", founderNote: "Accept an estimate.",
  rationale: "KD is unobtainable here.", replacementTasks: [], createdAt: "2026-10-12T00:00:00.000Z", stale: false,
  taskBefore: { title: "Pick a low-KD keyword", description: "Prove Ahrefs KD <= 15.", proofSchemaId: "research-report", requiredCapabilities: ["research"] },
  taskAfter: { title: "Pick a low-difficulty keyword", description: "Use a stated SERP-based estimate.", proofSchemaId: "research-report", requiredCapabilities: ["research", "writing"] },
  capabilitiesChanged: true,
  requirementChanges: [{
    verifierTaskId: "task_2",
    before: [{ id: "meets-thresholds", description: "Ahrefs KD <= 15." }],
    after: [{ id: "meets-thresholds", description: "Low SERP-based estimate, method stated." }],
  }],
  requirementSourceNotes: [{ verifierTaskId: "task_4", producerTaskId: "task_3" }],
};

function renderCard(proposal: ReplanProposalSummary) {
  const onConfirm = vi.fn();
  const onReject = vi.fn();
  render(
    <LanguageProvider defaultLanguage="en">
      <ReplanProposalCard onConfirm={onConfirm} onReject={onReject} proposal={proposal} tasks={[keyword, verifier, define]} />
    </LanguageProvider>,
  );
  return { onConfirm, onReject, user: userEvent.setup() };
}

describe("a Revision proposal", () => {
  it("shows the task and the requirements it amends side by side, before and after", () => {
    renderCard(revision);

    const task = screen.getByRole("table", { name: "Task Changes" });
    const title = within(task).getByRole("row", { name: /Title/ });
    expect(within(title).getByText("Pick a low-KD keyword")).toBeInTheDocument();
    expect(within(title).getByText("Pick a low-difficulty keyword")).toBeInTheDocument();
    expect(title).toHaveClass("replan-diff__changed");
    // An unchanged field is shown but not marked.
    expect(within(task).getByRole("row", { name: /Proof schema/ })).not.toHaveClass("replan-diff__changed");
    expect(screen.getByText("This revision changes the task's required capabilities.")).toBeInTheDocument();

    const requirements = screen.getByRole("table", { name: "Requirement Changes Check the keyword pick" });
    expect(within(requirements).getByText("Ahrefs KD <= 15.")).toBeInTheDocument();
    expect(within(requirements).getByText("Low SERP-based estimate, method stated.")).toBeInTheDocument();
    // A standard that comes from another task's delivery is pointed at, not edited.
    expect(screen.getByText("task_4 takes its requirements from the delivery of Define the checks.")).toBeInTheDocument();
    expect(screen.getByText("Revision — Accept an estimate.")).toBeInTheDocument();
  });

  it("can be confirmed, or rejected with a reason", async () => {
    const { onConfirm, onReject, user } = renderCard(revision);

    await user.click(screen.getByRole("button", { name: "Confirm Replan" }));
    expect(onConfirm).toHaveBeenCalledWith("replan_1");
    await user.type(screen.getByLabelText("Reason for rejecting (read by the planner)"), "Keep English terms only.");
    await user.click(screen.getByRole("button", { name: "Reject Proposal" }));
    expect(onReject).toHaveBeenCalledWith("replan_1", "Keep English terms only.");
  });

  it("says when it has gone stale and cannot be confirmed, but can still be rejected", async () => {
    const { onConfirm, onReject, user } = renderCard({ ...revision, stale: true });

    expect(screen.getByText(/can no longer be confirmed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm Replan" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Reject Proposal" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith("replan_1", null);
  });

  it("shows a refusal from the server instead of swallowing it", async () => {
    const onConfirm = vi.fn(async () => { throw new Error("request a new proposal"); });
    render(
      <LanguageProvider defaultLanguage="en">
        <ReplanProposalCard onConfirm={onConfirm} onReject={vi.fn()} proposal={revision} tasks={[keyword, verifier]} />
      </LanguageProvider>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Confirm Replan" }));
    expect(await screen.findByText("request a new proposal")).toBeInTheDocument();
  });

  it("explains a decided or failed proposal and offers no decision on it", () => {
    for (const [proposal, message] of [
      [{ ...revision, status: "rejected", rejectionNote: "Too broad." }, "Rejected. Too broad."],
      [{ ...revision, status: "dismissed" }, "Replaced by a newer request."],
      [{ ...revision, status: "failed", mode: null, plannerFailureReason: "parse_failed", plannerFailureMessage: "not json" }, "The planner produced no applicable proposal. Request a new one."],
    ] as const) {
      const { unmount } = render(
        <LanguageProvider defaultLanguage="en">
          <ReplanProposalCard onConfirm={vi.fn()} onReject={vi.fn()} proposal={proposal} tasks={[keyword, verifier]} />
        </LanguageProvider>,
      );
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Confirm Replan" })).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe("requesting a proposal", () => {
  it("sends the chosen mode and note, or no mode to let the planner choose", async () => {
    const onSubmit = vi.fn();
    render(<LanguageProvider defaultLanguage="en"><ReplanRequestForm onSubmit={onSubmit} taskTitle="Pick a low-KD keyword" /></LanguageProvider>);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Create Replan Proposal" }));
    expect(onSubmit).toHaveBeenLastCalledWith({ mode: null, note: null });

    await user.selectOptions(screen.getByLabelText("Replan mode for Pick a low-KD keyword"), "Revision — rewrite this task");
    await user.type(screen.getByLabelText("Note for the planner"), "Accept an estimate.");
    await user.click(screen.getByRole("button", { name: "Create Replan Proposal" }));
    expect(onSubmit).toHaveBeenLastCalledWith({ mode: "revision", note: "Accept an estimate." });
  });
});
