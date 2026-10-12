import { useMemo } from "react";
import type { DepartmentSummary, FounderDecisionSummary, TaskSummary } from "../../api/client";
import { useLanguage } from "../../ui/language";
import { departmentName, taskTitle } from "../../ui/language/localizedNames";
import { RetroButton } from "../../ui/retro";
import { departmentIcon } from "../department/departmentIcon";
import type { CeoPendingItem } from "./ceoPendingItems";

/** Downstream task ids held by an unresolved Founder Decision on an upstream deliverable. */
function waitingOnDecisionTaskIdSet(founderDecisions: FounderDecisionSummary[]): Set<string> {
  return new Set(
    founderDecisions
      .filter((decision) => decision.status === "pending")
      .flatMap((decision) => decision.blockedTaskIds),
  );
}

export function CeoTaskDependencyGraph({
  departments,
  founderDecisions,
  onSelectDepartment,
  onViewPendingTask,
  pendingItems,
  tasks,
}: {
  departments: DepartmentSummary[];
  founderDecisions: FounderDecisionSummary[];
  onSelectDepartment: (departmentId: string) => void;
  onViewPendingTask: (taskId: string) => void;
  pendingItems: CeoPendingItem[];
  tasks: TaskSummary[];
}) {
  const { language, t } = useLanguage();
  const parentTasks = useMemo(
    () => tasks.filter((task) => task.taskKind !== "department_subtask"),
    [tasks],
  );
  const graph = useMemo(() => buildCeoTaskGraph(parentTasks), [parentTasks]);
  const departmentsById = useMemo(
    () => new Map(departments.map((department) => [department.id, department])),
    [departments],
  );
  const pendingTaskIds = useMemo(
    () => new Set(pendingItems.map((item) => item.task.id)),
    [pendingItems],
  );
  const waitingOnDecisionTaskIds = useMemo(
    () => waitingOnDecisionTaskIdSet(founderDecisions),
    [founderDecisions],
  );
  const lanes = departments
    .map((department) => ({
      department,
      tasks: graph.tasks.filter((task) => task.departmentId === department.id),
    }))
    .filter((lane) => lane.tasks.length > 0);

  return (
    <section className="ceo-task-dependency-graph" aria-label={t("department.ceoTaskDependencyGraph")}>
      {parentTasks.length === 0 ? <p className="muted">{t("department.noTasks")}</p> : null}
      {parentTasks.length > 0 ? (
        <>
          <div className="ceo-task-dependency-graph__lanes">
            {lanes.map((lane) => (
              <section className="ceo-task-dependency-graph__lane" key={lane.department.id}>
                <h4>
                  {departmentIcon(lane.department.name)}
                  <span>{departmentName(lane.department, language)}</span>
                </h4>
                <div className="ceo-task-dependency-graph__lane-stack">
                  {lane.tasks.map((task) => (
                    <CeoTaskDependencyNode
                      key={task.id}
                      departmentName={departmentsById.get(task.departmentId) ? departmentName(departmentsById.get(task.departmentId)!, language) : task.departmentId}
                      graph={graph}
                      isPending={pendingTaskIds.has(task.id)}
                      isWaitingOnDecision={waitingOnDecisionTaskIds.has(task.id)}
                      onSelectDepartment={onSelectDepartment}
                      onViewPendingTask={onViewPendingTask}
                      task={task}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
          {graph.edges.length > 0 ? (
            <div className="ceo-task-dependency-graph__edges" aria-label={t("department.taskDependencyEdges")}>
              {graph.edges.map((edge) => (
                <span key={`${edge.from.id}-${edge.to.id}`}>
                  {taskNumber(edge.from, graph.tasks)} → {taskNumber(edge.to, graph.tasks)}
                </span>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

type CeoTaskGraph = {
  edges: Array<{ from: TaskSummary; to: TaskSummary }>;
  tasks: TaskSummary[];
  tasksById: Map<string, TaskSummary>;
};

function buildCeoTaskGraph(tasks: TaskSummary[]): CeoTaskGraph {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const edges: Array<{ from: TaskSummary; to: TaskSummary }> = [];

  for (const task of tasks) {
    for (const dependencyId of task.dependsOnTaskIds ?? []) {
      const dependency = tasksById.get(dependencyId);
      if (!dependency) {
        continue;
      }
      edges.push({ from: dependency, to: task });
    }
  }

  return {
    edges,
    tasks,
    tasksById,
  };
}

function CeoTaskDependencyNode({
  departmentName,
  graph,
  isPending,
  isWaitingOnDecision,
  onSelectDepartment,
  onViewPendingTask,
  task,
}: {
  departmentName: string;
  graph: CeoTaskGraph;
  isPending: boolean;
  isWaitingOnDecision: boolean;
  onSelectDepartment: (departmentId: string) => void;
  onViewPendingTask: (taskId: string) => void;
  task: TaskSummary;
}) {
  const { language, t } = useLanguage();
  const blockers = getUnfinishedDependencies(task, graph.tasksById);
  const primaryBlocker = blockers[0] ?? null;
  const shouldShowOtherDependencies = Boolean(primaryBlocker);
  const completedDependencyNumbers = shouldShowOtherDependencies
    ? (task.dependsOnTaskIds ?? [])
      .map((dependencyId) => graph.tasksById.get(dependencyId))
      .filter((dependency): dependency is TaskSummary => dependency != null && dependency.id !== primaryBlocker?.id)
      .map((dependency) => taskNumber(dependency, graph.tasks))
    : [];
  const graphStatus = isWaitingOnDecision ? t("department.graphWaitingOnDecision") : formatGraphTaskStatus(task, t);
  const taskLabel = `${t("department.taskTitlePrefix")}${taskNumber(task, graph.tasks)} ${departmentName} ${taskTitle(task, language)} ${graphStatus}`;

  return (
    <article className={`ceo-task-node ceo-task-node--${isWaitingOnDecision ? "waiting" : graphTaskTone(task)}`}>
      <button
        aria-label={[
          taskLabel,
          !isWaitingOnDecision && primaryBlocker
            ? `${t("department.waitingOnTask")} ${taskNumber(primaryBlocker, graph.tasks)}: ${taskTitle(primaryBlocker, language)}`
            : null,
          completedDependencyNumbers.length > 0 ? `${t("department.alsoDependsOn")}: ${completedDependencyNumbers.join(", ")}` : null,
        ].filter(Boolean).join(" ")}
        className="ceo-task-node__main"
        onClick={() => onSelectDepartment(task.departmentId)}
        type="button"
      >
        <span className="ceo-task-node__meta">
          {t("department.taskTitlePrefix")}{taskNumber(task, graph.tasks)} · {departmentName}
        </span>
        <strong>{taskTitle(task, language)}</strong>
        <span>{graphStatus}</span>
        {!isWaitingOnDecision && primaryBlocker ? (
          <span className="ceo-task-node__blocker">
            {t("department.waitingOnTask")} {taskNumber(primaryBlocker, graph.tasks)}: {taskTitle(primaryBlocker, language)}
          </span>
        ) : null}
        {completedDependencyNumbers.length > 0 ? (
          <span className="ceo-task-node__depends">
            {t("department.alsoDependsOn")}: {completedDependencyNumbers.join(", ")}
          </span>
        ) : null}
      </button>
      {primaryBlocker ? (
        <button className="ceo-task-node__link" onClick={() => onSelectDepartment(primaryBlocker.departmentId)} type="button">
          {t("department.viewUpstreamTask")} {taskNumber(primaryBlocker, graph.tasks)}
        </button>
      ) : null}
      {isPending ? (
        <RetroButton className="ceo-task-node__action" onClick={() => onViewPendingTask(task.id)}>
          {t("department.viewTask")}
        </RetroButton>
      ) : null}
    </article>
  );
}

function getUnfinishedDependencies(task: TaskSummary, tasksById: Map<string, TaskSummary>): TaskSummary[] {
  return (task.dependsOnTaskIds ?? [])
    .map((dependencyId) => tasksById.get(dependencyId))
    .filter((dependency): dependency is TaskSummary => dependency != null && dependency.status !== "complete");
}

function taskNumber(task: TaskSummary, tasks: TaskSummary[]): string {
  const index = tasks.findIndex((candidate) => candidate.id === task.id);
  return String(index >= 0 ? index + 1 : 0).padStart(2, "0");
}

function graphTaskTone(task: TaskSummary): string {
  if (task.status === "complete") {
    return "complete";
  }
  if (task.status === "waiting_dependency") {
    return "waiting";
  }
  if (task.status === "review") {
    return "review";
  }
  if (task.status === "blocked" || task.status === "failed" || task.status === "needs_replan") {
    return "blocked";
  }
  if (task.status === "running" || task.status === "retrying") {
    return "running";
  }
  return "queued";
}

function formatGraphTaskStatus(task: TaskSummary, t: ReturnType<typeof useLanguage>["t"]): string {
  switch (task.status) {
    case "complete":
      return t("department.graphStatusComplete");
    case "running":
    case "retrying":
      return t("department.graphStatusRunning");
    case "waiting_dependency":
      return t("department.graphStatusWaitingDependency");
    case "review":
      return t("department.graphStatusReview");
    case "blocked":
      return t("department.graphStatusBlocked");
    case "failed":
      return t("department.graphStatusFailed");
    case "needs_replan":
      return t("department.graphStatusNeedsReplan");
    default:
      return t("department.graphStatusQueued");
  }
}
