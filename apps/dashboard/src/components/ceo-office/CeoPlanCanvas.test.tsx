// @vitest-environment jsdom
import "../../test/setup";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DepartmentSummary, KeyResultSummary, ObjectiveSummary, TaskSummary } from "../../api/client";
import { LanguageProvider } from "../../ui/language";
import { CeoPlanCanvas } from "./CeoPlanCanvas";

beforeAll(() => {
  // React Flow measures its container and nodes; jsdom has no layout, so give it a fixed size.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
    constructor() {}
  } as unknown as typeof DOMMatrixReadOnly;
});

const departments = [
  { id: "research", name: "Research", leadAgentId: "codex" },
  { id: "growth", name: "Growth", leadAgentId: "codex" },
] as DepartmentSummary[];

const tasks: TaskSummary[] = [
  { id: "t1", title: "Find keyword", status: "complete", departmentId: "research", keyResultId: "kr_keyword", dependsOnTaskIds: [] },
  { id: "t2", title: "Prepare launch", status: "blocked", departmentId: "growth", keyResultId: "kr_launch", dependsOnTaskIds: ["t1"] },
  { id: "t3", title: "Draft copy", status: "cancelled", departmentId: "growth", keyResultId: "kr_launch", dependsOnTaskIds: [] },
  { id: "sub", title: "Hidden subtask", status: "running", departmentId: "growth", keyResultId: "kr_launch", taskKind: "department_subtask" },
];

const objectives: ObjectiveSummary[] = [{ id: "goal", title: "Win the first niche", priority: 1 }];
const keyResults: KeyResultSummary[] = [
  { id: "kr_keyword", objectiveId: "goal", title: "Pick a keyword", metricName: "keyword", targetValue: "1 keyword", currentValue: "0", status: "met" },
  { id: "kr_launch", objectiveId: "goal", title: "Launch the page", metricName: "launch", targetValue: "live", currentValue: "no", status: "active" },
];

describe("CeoPlanCanvas", () => {
  it("shows every planned task with its department and status, and opens a task's department", () => {
    const onOpenDepartment = vi.fn();
    render(
      <LanguageProvider>
        <CeoPlanCanvas departments={departments} keyResults={keyResults} locale="en" objectives={objectives} onOpenDepartment={onOpenDepartment} tasks={tasks} />
      </LanguageProvider>,
    );

    const canvas = screen.getByRole("region", { name: "Task plan" });
    expect(within(canvas).getByText("Find keyword")).toBeInTheDocument();
    expect(within(canvas).getByTitle("Prepare launch, Growth, Needs you")).toBeInTheDocument();
    expect(within(canvas).getByTitle("Draft copy, Growth, Cancelled")).toBeInTheDocument();
    expect(within(canvas).queryByText("Hidden subtask")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Departments" })).toHaveTextContent("ResearchGrowth");

    // A plain click: d3-zoom reads a window off pointer-down events that jsdom does not provide.
    fireEvent.click(within(canvas).getByText("Prepare launch"));
    expect(onOpenDepartment).toHaveBeenCalledWith("growth");
  });

  it("keeps the goals in view above the canvas, with each key result's target, tasks done and status", () => {
    render(
      <LanguageProvider>
        <CeoPlanCanvas departments={departments} keyResults={keyResults} locale="en" objectives={objectives} onOpenDepartment={() => undefined} tasks={tasks} />
      </LanguageProvider>,
    );

    const goals = screen.getByRole("region", { name: "Goals" });
    expect(goals).toHaveTextContent("Win the first niche");
    const [keyword, launch] = within(goals).getAllByRole("listitem");
    expect(keyword).toHaveTextContent("Pick a keywordTarget: 1 keyword1/1 tasks doneMet");
    // A cancelled task and a department subtask are not counted.
    expect(launch).toHaveTextContent("Launch the pageTarget: live0/1 tasks doneIn progress");
  });

  it("says so when there is no task yet", () => {
    render(
      <LanguageProvider>
        <CeoPlanCanvas departments={departments} keyResults={[]} locale="en" objectives={[]} onOpenDepartment={() => undefined} tasks={[]} />
      </LanguageProvider>,
    );
    expect(screen.getByText("No tasks yet.")).toBeInTheDocument();
  });
});
