import "@xyflow/react/dist/style.css";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import { useMemo, useRef } from "react";
import type { DepartmentSummary, KeyResultSummary, ObjectiveSummary, TaskSummary } from "../../api/client";
import { cn } from "@/lib/utils";
import { useLanguage } from "../../ui/language";
import { departmentName, taskTitle } from "../../ui/language/localizedNames";
import { TaskStatusBadge } from "../task/TaskStatusBadge";
import { taskStatusTone, taskStatusToneLabelKey } from "../task/taskStatusTone";
import { PlanGoals } from "./PlanGoals";
import { DEPARTMENT_COLORS, layoutPlan, PLAN_NODE_HEIGHT, PLAN_NODE_WIDTH } from "./planLayout";

type TaskNodeData = { title: string; departmentLabel: string; color: string; status: string; label: string };
type TaskNode = Node<TaskNodeData, "task">;

const nodeTypes = { task: TaskNodeView };

/**
 * The Plan tab (dashboard ADR 0002): every task left to right in dependency order, coloured by
 * department, on a canvas the founder can pan and zoom. Opening a task opens its department page.
 */
export function CeoPlanCanvas({
  departments,
  keyResults,
  locale,
  objectives,
  onOpenDepartment,
  tasks,
}: {
  departments: DepartmentSummary[];
  keyResults: KeyResultSummary[];
  locale: "en" | "zh";
  objectives: ObjectiveSummary[];
  onOpenDepartment(departmentId: string): void;
  tasks: TaskSummary[];
}) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const departmentsById = useMemo(() => new Map(departments.map((department) => [department.id, department])), [departments]);
  const { nodes, edges } = useMemo(() => {
    const layout = layoutPlan(tasks, departments);
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const flowNodes: TaskNode[] = layout.nodes.map((node) => {
      const task = tasksById.get(node.taskId)!;
      const department = departmentsById.get(node.departmentId);
      const departmentLabel = department ? departmentName(department, locale) : node.departmentId;
      const title = taskTitle(task, locale);
      const status = t(taskStatusToneLabelKey[taskStatusTone(task.status)]);
      return {
        id: node.taskId,
        type: "task",
        position: { x: node.x, y: node.y },
        data: {
          title,
          departmentLabel,
          color: node.color,
          status: task.status,
          label: t("ceoOffice.planNode").replace("{title}", title).replace("{department}", departmentLabel).replace("{status}", status),
        },
        draggable: false,
        connectable: false,
        ariaLabel: t("ceoOffice.planNode").replace("{title}", title).replace("{department}", departmentLabel).replace("{status}", status),
      };
    });
    const flowEdges: Edge[] = layout.edges.map((edge) => ({
      ...edge,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--edge-strong)" },
      style: { strokeWidth: 1.5, stroke: "var(--edge-strong)" },
    }));
    return { nodes: flowNodes, edges: flowEdges };
  }, [departments, departmentsById, locale, t, tasks]);

  if (nodes.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("ceoOffice.planEmpty")}</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <PlanGoals keyResults={keyResults} locale={locale} objectives={objectives} tasks={tasks} />
      <div aria-label={t("ceoOffice.planCanvas")} className="min-h-64 flex-1 overflow-hidden rounded-lg border border-border/80 bg-[color:var(--c-mist)]" ref={containerRef} role="region">
        <ReactFlow
          edges={edges}
          edgesFocusable={false}
          maxZoom={1.5}
          minZoom={0.2}
          nodeTypes={nodeTypes}
          nodes={nodes}
          nodesConnectable={false}
          nodesDraggable={false}
          onInit={(instance) => showPlanStart(instance, nodes, containerRef.current)}
          onNodeClick={(_, node) => onOpenDepartment(tasks.find((task) => task.id === node.id)?.departmentId ?? "")}
        >
          <Background color="var(--c-cool)" gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <ul aria-label={t("ceoOffice.planLegend")} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {departments.map((department, index) => (
          <li className="flex items-center gap-1.5" key={department.id}>
            <span aria-hidden="true" className="size-2 rounded-[var(--r-pill)]" style={{ backgroundColor: DEPARTMENT_COLORS[index % DEPARTMENT_COLORS.length] }} />
            {departmentName(department, locale)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Start where the plan starts: its first tasks at the top left, zoomed out only as far as text stays
 * readable. A wide plan continues to the right, where the founder pans to it.
 */
function showPlanStart(instance: ReactFlowInstance<TaskNode, Edge>, nodes: TaskNode[], container: HTMLDivElement | null) {
  const margin = 24;
  const width = container?.clientWidth ?? 0;
  const height = container?.clientHeight ?? 0;
  const contentWidth = Math.max(...nodes.map((node) => node.position.x)) + PLAN_NODE_WIDTH;
  const contentHeight = Math.max(...nodes.map((node) => node.position.y)) + PLAN_NODE_HEIGHT;
  const fit = Math.min((width - margin * 2) / contentWidth, (height - margin * 2) / contentHeight);
  const zoom = Math.min(1, Math.max(0.7, Number.isFinite(fit) && fit > 0 ? fit : 1));
  void instance.setViewport({ x: margin, y: margin, zoom });
}

function TaskNodeView({ data }: NodeProps<TaskNode>) {
  const { t } = useLanguage();
  const tone = taskStatusTone(data.status);
  return (
    <div
      className="grid cursor-pointer content-between gap-1 rounded-md border border-status-neutral-border bg-card px-3 py-2 text-left"
      style={{ width: PLAN_NODE_WIDTH, height: PLAN_NODE_HEIGHT }}
      title={data.label}
    >
      <Handle className="!opacity-0" isConnectable={false} position={Position.Left} type="target" />
      <p className={cn("line-clamp-2 text-xs font-semibold leading-snug", tone === "cancelled" && "line-through text-muted-foreground")}>{data.title}</p>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-[var(--r-pill)]" style={{ backgroundColor: data.color }} />
          <span className="truncate">{data.departmentLabel}</span>
        </span>
        <TaskStatusBadge className="px-1.5 text-[11px]" status={data.status} />
      </div>
      <Handle className="!opacity-0" isConnectable={false} position={Position.Right} type="source" />
    </div>
  );
}
