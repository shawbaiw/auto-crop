import "@xyflow/react/dist/style.css";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import { useMemo } from "react";
import type { DepartmentSummary, KeyResultSummary, ObjectiveSummary, TaskSummary } from "../../api/client";
import { cn } from "@/lib/utils";
import { useLanguage } from "../../ui/language";
import { departmentName, taskTitle } from "../../ui/language/localizedNames";
import { TaskStatusTag } from "../task/TaskStatusTag";
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
      <div aria-label={t("ceoOffice.planCanvas")} className="min-h-64 flex-1 overflow-hidden rounded-[var(--r-panel)] border border-[color:var(--edge-highlight)] bg-[color:var(--c-mist)]" role="region">
        <ReactFlow
          edges={edges}
          edgesFocusable={false}
          maxZoom={1.5}
          minZoom={0.2}
          nodeTypes={nodeTypes}
          nodes={nodes}
          nodesConnectable={false}
          nodesDraggable={false}
          onInit={showPlanStart}
          onNodeClick={(_, node) => onOpenDepartment(tasks.find((task) => task.id === node.id)?.departmentId ?? "")}
        >
          <Background color="var(--c-cool)" gap={20} size={1} />
          <Controls className="im-flow-controls" orientation="horizontal" showInteractive={false} />
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
 * Start where the plan starts: its first tasks at the top left, at full size so node text stays
 * readable. A wide or tall plan continues beyond the frame, where the founder pans to it.
 */
function showPlanStart(instance: ReactFlowInstance<TaskNode, Edge>) {
  const margin = 24;
  void instance.setViewport({ x: margin, y: margin, zoom: 1 });
}

function TaskNodeView({ data, selected }: NodeProps<TaskNode>) {
  const tone = taskStatusTone(data.status);
  return (
    <div
      className={cn(
        "grid cursor-pointer grid-rows-[auto_1fr_auto] gap-1.5 rounded-[var(--r-reading)] border border-status-neutral-border bg-[color:var(--c-warm)] px-3.5 py-3 text-left",
        selected && "outline outline-2 -outline-offset-1 outline-[color:var(--c-charcoal)]",
      )}
      style={{ width: PLAN_NODE_WIDTH, height: PLAN_NODE_HEIGHT }}
      title={data.label}
    >
      <Handle className="!opacity-0" isConnectable={false} position={Position.Left} type="target" />
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span aria-hidden="true" className="size-2 shrink-0 rounded-[var(--r-pill)]" style={{ backgroundColor: data.color }} />
        <span className="truncate">{data.departmentLabel}</span>
      </span>
      <p className={cn("line-clamp-2 text-[13px] font-semibold leading-snug", tone === "cancelled" && "line-through text-muted-foreground")}>{data.title}</p>
      <TaskStatusTag className="justify-self-start" status={data.status} />
      <Handle className="!opacity-0" isConnectable={false} position={Position.Right} type="source" />
    </div>
  );
}
