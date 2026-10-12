import { useMemo } from "react";
import type { TaskProgressEventSummary, TaskSummary } from "../../api/client";
import type { WorkspaceHandlers } from "../workbench/workspaceHandlers";
import { useLanguage } from "../../ui/language";
import { taskTitle } from "../../ui/language/localizedNames";
import { RetroButton } from "../../ui/retro";
import type { CeoPendingItem } from "../ceo-office/ceoPendingItems";
import { TaskStatusAction } from "../task/TaskStatusAction";
import {
  formatProgressLabel,
  groupProgressEvents,
  isActiveCeoReviewProgressEvent,
  progressMarker,
  resolveTaskProgressEvents,
} from "./taskProgress";

export function DepartmentProgressFlows({
  departmentId,
  onRefreshTask,
  onCreateReplanProposal,
  onDecideFounderApproval,
  onRecoverTask,
  onConfirmTaskTermination,
  onViewCeoPending,
  pendingItems,
  progressEvents,
  tasks,
}: {
  departmentId: string;
  onRefreshTask?: WorkspaceHandlers["onRefreshTask"];
  onCreateReplanProposal?: WorkspaceHandlers["onCreateReplanProposal"];
  onDecideFounderApproval?: WorkspaceHandlers["onDecideFounderApproval"];
  onRecoverTask?: WorkspaceHandlers["onRecoverTask"];
  onConfirmTaskTermination?: WorkspaceHandlers["onConfirmTaskTermination"];
  onViewCeoPending: () => void;
  pendingItems: CeoPendingItem[];
  progressEvents: TaskProgressEventSummary[];
  tasks: TaskSummary[];
}) {
  const { language, t } = useLanguage();
  const parentTasks = tasks.filter((task) => task.taskKind !== "department_subtask");
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const progressEventsByParent = groupProgressEvents(progressEvents.filter((event) => event.departmentId === departmentId));
  const pendingTaskIds = useMemo(
    () => new Set(pendingItems.map((item) => item.task.id)),
    [pendingItems],
  );
  const flows = parentTasks.map((task) => ({
    task,
    events: resolveTaskProgressEvents(task, progressEventsByParent.get(task.id)),
  }));

  return (
    <section className="department-progress-flows" aria-label={t("department.ceoTaskProgress")}>
      <h3>{t("department.ceoTaskProgress")}</h3>
      <p className="muted">{t("department.ceoTaskProgressNote")}</p>
      {flows.length === 0 ? <p className="muted">{t("department.noTasks")}</p> : null}
      {flows.map((flow, index) => (
        <article className="department-progress-flow" key={flow.task.id}>
          <h4>{formatDepartmentTaskTitle(index, taskTitle(flow.task, language), t)}</h4>
          <ol className="department-progress-flow__steps">
            {flow.events.map((event) => {
              const subjectTask =
                event.subjectTaskId && event.subjectTaskId !== flow.task.id
                  ? tasksById.get(event.subjectTaskId) ?? null
                  : null;
              const displayTask = subjectTask ?? flow.task;
              const hasCeoPendingItem = pendingTaskIds.has(displayTask.id);

              return (
                <li className={`department-progress-flow__step department-progress-flow__step--${event.status}`} key={event.id}>
                  <span aria-hidden="true">{progressMarker(event.status)}</span>
                  <div className="department-progress-flow__content">
                    <p>{formatProgressLabel(event, displayTask, language, t, hasCeoPendingItem)}</p>
                    {hasCeoPendingItem && isActiveCeoReviewProgressEvent(event, displayTask) ? (
                      <RetroButton className="department-progress-flow__action" onClick={onViewCeoPending}>
                        {t("department.viewCeoPendingItem")}
                      </RetroButton>
                    ) : null}
                    {subjectTask ? (
                      <TaskStatusAction
                        onRefreshTask={onRefreshTask}
                        onCreateReplanProposal={onCreateReplanProposal}
                        onDecideFounderApproval={onDecideFounderApproval}
                        onRecoverTask={onRecoverTask}
                        onConfirmTaskTermination={onConfirmTaskTermination}
                        showStatusBadge={false}
                        task={subjectTask}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <TaskStatusAction
            onRefreshTask={onRefreshTask}
            onCreateReplanProposal={onCreateReplanProposal}
            onDecideFounderApproval={onDecideFounderApproval}
            onRecoverTask={onRecoverTask}
            onConfirmTaskTermination={onConfirmTaskTermination}
            showStatusBadge={false}
            task={flow.task}
          />
        </article>
      ))}
    </section>
  );
}

function formatDepartmentTaskTitle(taskIndex: number, title: string, t: ReturnType<typeof useLanguage>["t"]): string {
  return `${t("department.taskTitlePrefix")}${taskIndex + 1}${t("department.taskTitleSeparator")}${title}`;
}
