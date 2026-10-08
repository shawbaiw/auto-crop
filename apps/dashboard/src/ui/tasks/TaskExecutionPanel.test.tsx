// @vitest-environment jsdom
import "../../test/setup";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { ApiClient, TaskSummary } from "../../api/client";
import { LanguageProvider } from "../language";
import { ExecutionActionsContext, TaskExecutionPanel } from "./TaskExecutionPanel";

function setup(awaitingRunSnapshot = false) {
  const task: TaskSummary = { id: "task", title: "Prototype", departmentId: "engineering", status: "failed",
    affordances: [{ kind: "authorize_execution_budget", actor: "founder", subjectId: null, holdId: "hold", holdKind: "execution_budget_exhausted", subjectKind: null }, { kind: "cancel_task", actor: "founder", subjectId: null, holdId: null, holdKind: null, subjectKind: null }],
    execution: { runId: "run", status: "failed", phase: "executing", policyVersion: "budget-v1",
      health: { state: "unknown", reason: "Owner responsive; progress unknown", action: "continue", checkedAt: "2026-09-24" },
      budget: { authorizedMs: 60000, consumedMs: 60000, reservedMs: 0, remainingMs: 0, availableMs: 0, estimated: true },
      stop: { reason: "task_budget_exhausted", requestedAt: "2026-09-24", terminationWaitMs: 500, terminationConfirmed: true } } };
  const api = { getTaskExecution: vi.fn(async () => ({ task })),
    authorizeExecutionBudget: vi.fn(async () => ({ task: { ...task, status: "queued", affordances: [] }, replayed: false })),
    cancelTask: vi.fn(async () => ({ task: { ...task, status: "cancelled", affordances: [] } })) };
  const update = vi.fn();
  render(<LanguageProvider defaultLanguage="en"><ExecutionActionsContext.Provider value={{ client: api as unknown as ApiClient, update }}>
    <TaskExecutionPanel task={awaitingRunSnapshot ? { ...task, status: "running", execution: null } : task} />
  </ExecutionActionsContext.Provider></LanguageProvider>);
  return { api, task, update, user: userEvent.setup() };
}
it("shows persisted budget facts and resumes only through explicit authorization", async () => {
  const { api, user, update } = setup();
  expect(screen.getByText(/includes conservative estimates/)).toBeInTheDocument();
  expect(screen.getByText(/task_budget_exhausted/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Authorize continuation" }));
  await user.clear(screen.getByLabelText("Additional minutes"));
  await user.type(screen.getByLabelText("Additional minutes"), "2");
  await user.type(screen.getByLabelText("Authorization reason"), "Finish validation");
  expect(api.authorizeExecutionBudget).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirm authorization and resume" }));
  await waitFor(() => expect(api.authorizeExecutionBudget).toHaveBeenCalledWith("task", expect.objectContaining({ additionalMs: 120000, expectedAuthorizedMs: 60000, reason: "Finish validation", id: expect.any(String) })));
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "queued" }));
});
it("keeps an uncertain authorization retry idempotent and displays the failure", async () => {
  const { api, user } = setup();
  api.authorizeExecutionBudget.mockRejectedValueOnce(new Error("Network interrupted"));
  await user.click(screen.getByRole("button", { name: "Authorize continuation" }));
  await user.type(screen.getByLabelText("Authorization reason"), "Finish validation");
  await user.click(screen.getByRole("button", { name: "Confirm authorization and resume" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Network interrupted");
  await user.click(screen.getByRole("button", { name: "Confirm authorization and resume" }));
  await waitFor(() => expect(api.authorizeExecutionBudget).toHaveBeenCalledTimes(2));
  expect(api.authorizeExecutionBudget.mock.calls[0]).toEqual(api.authorizeExecutionBudget.mock.calls[1]);
});
it("requires an explicit cancellation confirmation", async () => {
  const { api, user } = setup();
  await user.click(screen.getByRole("button", { name: "Cancel task" }));
  expect(api.cancelTask).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  expect(api.cancelTask).toHaveBeenCalledWith("task");
  expect(api.authorizeExecutionBudget).not.toHaveBeenCalled();
});

it("loads the new run when a running task arrives before its execution snapshot", async () => {
  const { api } = setup(true);
  expect(await screen.findByText(/task_budget_exhausted/)).toBeInTheDocument();
  expect(api.getTaskExecution).toHaveBeenCalledWith("task");
  expect(screen.getByRole("button", { name: "Authorize continuation" })).toBeInTheDocument();
});
