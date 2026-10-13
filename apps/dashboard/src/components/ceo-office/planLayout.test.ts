import { describe, expect, it } from "vitest";
import type { DepartmentSummary, TaskSummary } from "../../api/client";
import { DEPARTMENT_COLORS, layoutPlan } from "./planLayout";

const departments = [
  { id: "research", name: "Research" },
  { id: "product", name: "Product" },
] as DepartmentSummary[];

function task(id: string, departmentId: string, dependsOnTaskIds: string[] = [], extra: Partial<TaskSummary> = {}): TaskSummary {
  return { id, title: id, status: "queued", departmentId, dependsOnTaskIds, ...extra };
}

describe("layoutPlan", () => {
  it("places each task to the right of everything it needs first", () => {
    const { nodes, edges } = layoutPlan(
      [task("brief", "product", ["offer"]), task("offer", "product", ["scan", "interviews"]), task("scan", "research"), task("interviews", "research", ["scan"])],
      departments,
    );
    const column = (id: string) => nodes.find((node) => node.taskId === id)!.column;
    expect([column("scan"), column("interviews"), column("offer"), column("brief")]).toEqual([0, 1, 2, 3]);
    expect(edges.map((edge) => edge.id).sort()).toEqual(["interviews->offer", "offer->brief", "scan->interviews", "scan->offer"]);
  });

  it("groups a column by department in rail order and colours tasks by department", () => {
    const { nodes } = layoutPlan([task("p", "product"), task("r", "research")], departments);
    expect(nodes.map((node) => [node.taskId, node.y, node.color])).toEqual([
      ["r", 0, DEPARTMENT_COLORS[0]],
      ["p", nodes[1]!.y, DEPARTMENT_COLORS[1]],
    ]);
    expect(nodes[1]!.y).toBeGreaterThan(0);
  });

  it("leaves department subtasks out, ignores dependencies outside the plan, and survives a cycle", () => {
    const { nodes, edges } = layoutPlan(
      [task("a", "research", ["b", "missing"]), task("b", "research", ["a"]), task("sub", "research", [], { taskKind: "department_subtask" })],
      departments,
    );
    expect(nodes.map((node) => node.taskId).sort()).toEqual(["a", "b"]);
    expect(edges.every((edge) => edge.source !== "missing")).toBe(true);
  });
});
