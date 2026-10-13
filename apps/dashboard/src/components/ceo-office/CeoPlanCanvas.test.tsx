// @vitest-environment jsdom
import "../../test/setup";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DepartmentSummary, TaskSummary } from "../../api/client";
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
  { id: "t1", title: "Find keyword", status: "complete", departmentId: "research", dependsOnTaskIds: [] },
  { id: "t2", title: "Prepare launch", status: "blocked", departmentId: "growth", dependsOnTaskIds: ["t1"] },
  { id: "t3", title: "Draft copy", status: "cancelled", departmentId: "growth", dependsOnTaskIds: [] },
  { id: "sub", title: "Hidden subtask", status: "running", departmentId: "growth", taskKind: "department_subtask" },
];

describe("CeoPlanCanvas", () => {
  it("shows every planned task with its department and status, and opens a task's department", () => {
    const onOpenDepartment = vi.fn();
    render(
      <LanguageProvider>
        <CeoPlanCanvas departments={departments} locale="en" onOpenDepartment={onOpenDepartment} tasks={tasks} />
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

  it("says so when there is no task yet", () => {
    render(
      <LanguageProvider>
        <CeoPlanCanvas departments={departments} locale="en" onOpenDepartment={() => undefined} tasks={[]} />
      </LanguageProvider>,
    );
    expect(screen.getByText("No tasks yet.")).toBeInTheDocument();
  });
});
