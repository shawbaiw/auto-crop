import type { DepartmentSummary, TaskSummary } from "../../api/client";

export const PLAN_NODE_WIDTH = 224;
export const PLAN_NODE_HEIGHT = 84;
const COLUMN_GAP = 72;
const ROW_GAP = 20;

/** One colour per department, in rail order. Enough to tell departments apart; it repeats after eight. */
export const DEPARTMENT_COLORS = ["#2563eb", "#7c3aed", "#0d9488", "#ea580c", "#db2777", "#65a30d", "#0891b2", "#a16207"];

export type PlanNodeLayout = {
  taskId: string;
  departmentId: string;
  color: string;
  column: number;
  x: number;
  y: number;
};

export type PlanEdgeLayout = { id: string; source: string; target: string };

/**
 * Lay the plan out left to right in dependency order (dashboard ADR 0002): a task's column is the
 * length of the longest chain of tasks it needs first, so everything it waits on stands to its left.
 * Within a column, tasks are grouped by department in rail order. Department subtasks stay on their
 * department page. A dependency on a task outside the plan is ignored, and a cycle cannot loop.
 */
export function layoutPlan(tasks: TaskSummary[], departments: DepartmentSummary[]): { nodes: PlanNodeLayout[]; edges: PlanEdgeLayout[] } {
  const planned = tasks.filter((task) => task.taskKind !== "department_subtask");
  const byId = new Map(planned.map((task) => [task.id, task]));
  const departmentIndex = new Map(departments.map((department, index) => [department.id, index]));
  const columns = new Map<string, number>();

  const columnOf = (task: TaskSummary, visiting: Set<string>): number => {
    const known = columns.get(task.id);
    if (known !== undefined) return known;
    if (visiting.has(task.id)) return 0;
    visiting.add(task.id);
    const upstream = (task.dependsOnTaskIds ?? []).map((id) => byId.get(id)).filter((dependency): dependency is TaskSummary => Boolean(dependency));
    const column = upstream.length === 0 ? 0 : Math.max(...upstream.map((dependency) => columnOf(dependency, visiting) + 1));
    visiting.delete(task.id);
    columns.set(task.id, column);
    return column;
  };
  planned.forEach((task) => columnOf(task, new Set()));

  const order = new Map(planned.map((task, index) => [task.id, index]));
  const rowsByColumn = new Map<number, TaskSummary[]>();
  for (const task of planned) {
    const column = columns.get(task.id)!;
    rowsByColumn.set(column, [...(rowsByColumn.get(column) ?? []), task]);
  }

  const nodes: PlanNodeLayout[] = [];
  for (const [column, columnTasks] of rowsByColumn) {
    columnTasks
      .sort((a, b) =>
        (departmentIndex.get(a.departmentId) ?? Number.MAX_SAFE_INTEGER) - (departmentIndex.get(b.departmentId) ?? Number.MAX_SAFE_INTEGER) ||
        order.get(a.id)! - order.get(b.id)!)
      .forEach((task, row) => {
        const index = departmentIndex.get(task.departmentId);
        nodes.push({
          taskId: task.id,
          departmentId: task.departmentId,
          color: index === undefined ? "#64748b" : DEPARTMENT_COLORS[index % DEPARTMENT_COLORS.length]!,
          column,
          x: column * (PLAN_NODE_WIDTH + COLUMN_GAP),
          y: row * (PLAN_NODE_HEIGHT + ROW_GAP),
        });
      });
  }

  const edges = planned.flatMap((task) =>
    (task.dependsOnTaskIds ?? [])
      .filter((id) => byId.has(id))
      .map((id) => ({ id: `${id}->${task.id}`, source: id, target: task.id })),
  );
  return { nodes: nodes.sort((a, b) => a.column - b.column || a.y - b.y), edges };
}
