import { Building2, ClipboardCheck, Crown, ListChecks, MessageSquareText, RefreshCcw, Send } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type {
  AgentSummary,
  CompanySummary,
  DepartmentSummary,
  ObjectiveSummary,
  TaskProgressEventSummary,
  TaskSummary,
} from "../api/client";
import { VideotexKeyValue, VideotexLog } from "../ui/data";
import { useLanguage } from "../ui/language";
import { AppShell, PageHeader, Workspace } from "../ui/layout";
import { RetroBadge, RetroButton, RetroListRow, RetroPanel } from "../ui/retro";
import { formatTaskStatus } from "../ui/tasks/formatTaskStatus";

export type DepartmentWorkspaceProps = {
  agents: AgentSummary[];
  company: CompanySummary;
  departments: DepartmentSummary[];
  menuBar?: ReactNode;
  objectives: ObjectiveSummary[];
  selectedCeoAgentId: string;
  tasks: TaskSummary[];
  taskProgressEvents?: TaskProgressEventSummary[];
  onRefreshTask?: (taskId: string) => void;
};

const ceoRoleId = "ceo";

export function DepartmentWorkspace({
  agents,
  company,
  departments,
  menuBar,
  objectives,
  onRefreshTask,
  selectedCeoAgentId,
  tasks,
  taskProgressEvents = [],
}: DepartmentWorkspaceProps) {
  const { t } = useLanguage();
  const [selectedRoleId, setSelectedRoleId] = useState(ceoRoleId);
  const [departmentDraft, setDepartmentDraft] = useState("");
  const selectedDepartment = departments.find((department) => department.id === selectedRoleId) ?? null;
  const selectedCeoAgent = agents.find((agent) => agent.id === selectedCeoAgentId) ?? null;
  const tasksByDepartment = useMemo(() => {
    const grouped = new Map(departments.map((department) => [department.id, [] as TaskSummary[]]));
    for (const task of tasks) {
      grouped.get(task.departmentId)?.push(task);
    }
    return grouped;
  }, [departments, tasks]);

  return (
    <AppShell className="app-shell--workbench app-shell--department-workspace" menuBar={menuBar}>
      <PageHeader
        eyebrow={t("department.eyebrow")}
        status={company.status}
        statusIcon={<Building2 size={16} aria-hidden="true" />}
        title={company.name}
      />

      <Workspace className="department-workspace">
        <RetroPanel className="department-workspace__rail" icon={<ClipboardCheck size={18} aria-hidden="true" />} title={t("department.departments")}>
          <RetroListRow
            meta={selectedCeoAgent?.name ?? selectedCeoAgentId}
            onClick={() => setSelectedRoleId(ceoRoleId)}
            selected={selectedRoleId === ceoRoleId}
            title={t("department.ceo")}
          />
          {departments.map((department) => (
            <RetroListRow
              key={department.id}
              meta={String((tasksByDepartment.get(department.id) ?? []).length).padStart(2, "0")}
              onClick={() => setSelectedRoleId(department.id)}
              selected={selectedRoleId === department.id}
              title={department.name}
            />
          ))}
        </RetroPanel>

        <section className="department-workspace__main">
          {selectedDepartment ? (
            <RetroPanel icon={<ListChecks size={18} aria-hidden="true" />} title={`${selectedDepartment.name} ${t("department.workspace")}`}>
              <div className="role-summary">
                <section className="department-overview">
                  <DepartmentAgentSummary agents={agents} department={selectedDepartment} />
                  <DepartmentRoleSummary department={selectedDepartment} />
                </section>
                <DepartmentLeaderReport
                  departmentId={selectedDepartment.id}
                  departmentName={selectedDepartment.name}
                  draft={departmentDraft}
                  onDraftChange={setDepartmentDraft}
                  progressEvents={taskProgressEvents}
                  responsibility={selectedDepartment.responsibility}
                  tasks={tasksByDepartment.get(selectedDepartment.id) ?? []}
                />
              </div>
            </RetroPanel>
          ) : (
            <RetroPanel icon={<Crown size={18} aria-hidden="true" />} title={t("department.ceoWorkspace")}>
              <div className="role-summary">
                <VideotexKeyValue
                  items={[
                    { label: t("department.ceo"), value: selectedCeoAgent?.name ?? selectedCeoAgentId },
                    { label: t("department.status"), value: company.status },
                    { label: t("department.playbook"), value: company.playbookId },
                  ]}
                />
                <div>
                  <h3>{t("department.objectives")}</h3>
                  <VideotexLog emptyMessage={t("department.noObjectives")} rows={objectives.map((objective) => objective.title)} />
                </div>
                <div>
                  <h3>{t("department.firstTasks")}</h3>
                  <div className="task-action-list">
                    {tasks.length === 0 ? <p className="muted">{t("department.noTasks")}</p> : null}
                    {tasks.map((task) => (
                      <TaskStatusAction key={task.id} onRefreshTask={onRefreshTask} task={task} />
                    ))}
                  </div>
                </div>
                <p className="muted">{t("department.schedulerNote")}</p>
              </div>
            </RetroPanel>
          )}
        </section>
      </Workspace>
    </AppShell>
  );
}

function DepartmentRoleSummary({ department }: { department: DepartmentSummary }) {
  const { t } = useLanguage();

  return (
    <section className="department-role-summary" aria-label={t("department.role")}>
      <h3>{t("department.role")}</h3>
      <p>{department.name}</p>
    </section>
  );
}

function DepartmentAgentSummary({
  agents,
  department,
}: {
  agents: AgentSummary[];
  department: DepartmentSummary;
}) {
  const { t } = useLanguage();
  const agent = agents.find((candidate) => candidate.id === department.leadAgentId);
  const agentName = agent?.name ?? department.leadAgentId ?? t("department.unassigned");

  return (
    <section className="department-agent-summary" aria-label={t("department.currentAgent")}>
      <div>
        <h3>{t("department.currentAgent")}</h3>
        <p>{agentName}</p>
      </div>
      {agent?.capabilities.length ? <p className="muted">{`${t("department.agentCapabilities")}: ${agent.capabilities.join(" / ")}`}</p> : null}
    </section>
  );
}

function DepartmentLeaderReport({
  departmentId,
  departmentName,
  draft,
  onDraftChange,
  progressEvents,
  responsibility,
  tasks,
}: {
  departmentId: string;
  departmentName: string;
  draft: string;
  onDraftChange: (value: string) => void;
  progressEvents: TaskProgressEventSummary[];
  responsibility: string;
  tasks: TaskSummary[];
}) {
  const { t } = useLanguage();

  return (
    <section className="department-leader-report" aria-label={t("department.leaderReport")}>
      <p className="department-leader-report__mission">
        <strong>{t("department.currentResponsibility")}:</strong> {responsibility}
      </p>
      <DepartmentProgressFlows departmentId={departmentId} progressEvents={progressEvents} tasks={tasks} />
      <div className="department-leader-report__spacer" aria-hidden="true" />
      <DepartmentMessageBox departmentName={departmentName} draft={draft} onDraftChange={onDraftChange} />
    </section>
  );
}

function DepartmentProgressFlows({
  departmentId,
  progressEvents,
  tasks,
}: {
  departmentId: string;
  progressEvents: TaskProgressEventSummary[];
  tasks: TaskSummary[];
}) {
  const { t } = useLanguage();
  const parentTasks = tasks.filter((task) => task.taskKind !== "department_subtask");
  const progressEventsByParent = groupProgressEvents(progressEvents.filter((event) => event.departmentId === departmentId));
  const flows = parentTasks.map((task) => ({
    task,
    events: progressEventsByParent.get(task.id) ?? fallbackProgressEvents(task),
  }));

  return (
    <section className="department-progress-flows" aria-label={t("department.ceoTaskProgress")}>
      <h3>{t("department.ceoTaskProgress")}</h3>
      <p className="muted">{t("department.ceoTaskProgressNote")}</p>
      {flows.length === 0 ? <p className="muted">{t("department.noTasks")}</p> : null}
      {flows.map((flow, index) => (
        <article className="department-progress-flow" key={flow.task.id}>
          <h4>{formatDepartmentTaskTitle(index, flow.task.title, t)}</h4>
          <ol className="department-progress-flow__steps">
            {flow.events.map((event) => (
              <li className={`department-progress-flow__step department-progress-flow__step--${event.status}`} key={event.id}>
                <span aria-hidden="true">{progressMarker(event.status)}</span>
                <p>{formatProgressLabel(event, flow.task.title, t)}</p>
              </li>
            ))}
          </ol>
        </article>
      ))}
    </section>
  );
}

function formatDepartmentTaskTitle(taskIndex: number, title: string, t: ReturnType<typeof useLanguage>["t"]): string {
  return `${t("department.taskTitlePrefix")}${taskIndex + 1}${t("department.taskTitleSeparator")}${title}`;
}

function groupProgressEvents(events: TaskProgressEventSummary[]): Map<string, TaskProgressEventSummary[]> {
  const grouped = new Map<string, TaskProgressEventSummary[]>();
  for (const event of events) {
    grouped.set(event.parentTaskId, [...(grouped.get(event.parentTaskId) ?? []), event]);
  }
  return grouped;
}

function fallbackProgressEvents(task: TaskSummary): TaskProgressEventSummary[] {
  const isDone = task.status === "review" || task.status === "complete";
  const isBlocked = task.status === "blocked" || task.status === "failed" || task.status === "needs_replan";
  const currentStatus = isDone ? "complete" : isBlocked ? "blocked" : task.status === "queued" ? "waiting" : "current";

  return [
    {
      id: `${task.id}_received`,
      companyId: "",
      departmentId: task.departmentId,
      parentTaskId: task.id,
      subjectTaskId: null,
      step: "received",
      status: "complete",
      label: "Received CEO task",
      detail: null,
      createdAt: "",
    },
    {
      id: `${task.id}_assessment`,
      companyId: "",
      departmentId: task.departmentId,
      parentTaskId: task.id,
      subjectTaskId: null,
      step: "assessment_complete",
      status: task.status === "queued" ? "waiting" : "complete",
      label: task.status === "queued" ? "Assessment pending" : "Assessment complete",
      detail: null,
      createdAt: "",
    },
    {
      id: `${task.id}_execution`,
      companyId: "",
      departmentId: task.departmentId,
      parentTaskId: task.id,
      subjectTaskId: task.id,
      step: "executing",
      status: currentStatus,
      label: `Task 1 (${task.title}) ${task.status}`,
      detail: null,
      createdAt: "",
    },
  ];
}

function progressMarker(status: TaskProgressEventSummary["status"]): string {
  if (status === "complete") {
    return "✓";
  }
  if (status === "current") {
    return "●";
  }
  return "○";
}

function formatProgressLabel(event: TaskProgressEventSummary, parentTaskTitle: string, t: ReturnType<typeof useLanguage>["t"]): string {
  switch (event.step) {
    case "received":
      return t("department.flowReceived");
    case "assessing":
      return t("department.flowAssessing");
    case "assessment_complete":
      return t("department.flowAssessmentComplete");
    case "splitting":
      return t("department.flowSplitting");
    case "split_complete":
      return t("department.flowSplitComplete");
    case "no_split_needed":
      return t("department.flowNoSplitNeeded");
    case "summarizing_proof":
      return t("department.flowSummarizingProof");
    case "awaiting_review":
      return t("department.flowAwaitingReview");
    case "complete":
      return t("department.flowComplete");
    case "blocked":
      return t("department.flowBlocked");
    case "needs_ceo_reassignment":
      return t("department.flowNeedsCeoReassignment");
    case "executing":
      return formatExecutingProgressLabel(event.label, parentTaskTitle, t);
  }
}

function formatExecutingProgressLabel(label: string, parentTaskTitle: string, t: ReturnType<typeof useLanguage>["t"]): string {
  const match = label.match(/^Task (\d+) \((.+)\) ([a-z_]+)$/i);
  if (!match) {
    return label;
  }

  const [, , taskTitle, status] = match;
  const displayTitle = taskTitle.trim() || parentTaskTitle;
  return `${t("department.flowTask")} (${displayTitle}) ${formatFlowTaskStatus(status, t)}`;
}

function formatFlowTaskStatus(status: string, t: ReturnType<typeof useLanguage>["t"]): string {
  switch (status) {
    case "waiting":
      return t("department.flowStatusWaiting");
    case "queued":
      return t("department.flowStatusWaiting");
    case "running":
      return t("department.flowStatusRunning");
    case "retrying":
      return t("department.flowStatusRunning");
    case "blocked":
      return t("department.flowStatusBlocked");
    case "failed":
      return t("department.flowStatusBlocked");
    case "review":
      return t("department.flowStatusReview");
    case "complete":
      return t("department.flowStatusComplete");
    default:
      return status;
  }
}

function DepartmentMessageBox({
  departmentName,
  draft,
  onDraftChange,
}: {
  departmentName: string;
  draft: string;
  onDraftChange: (value: string) => void;
}) {
  const { t } = useLanguage();
  const [sent, setSent] = useState(false);
  const hasDraft = draft.trim().length > 0;
  const handleSend = () => {
    if (!hasDraft) {
      return;
    }

    setSent(true);
    onDraftChange("");
  };

  return (
    <section className="department-message-box" aria-label={t("department.messageBox")}>
      <div className="department-message-box__header">
        <MessageSquareText size={16} aria-hidden="true" />
        <h3>{t("department.messageBox")}</h3>
      </div>
      <label className="department-message-box__field">
        <span>{t("department.messageLabel")}</span>
        <textarea
          className="retro-textarea"
          placeholder={t("department.messagePlaceholder")}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
        />
      </label>
      <div className="department-message-box__actions">
        <RetroButton
          aria-label={`${t("department.send")} ${departmentName}`}
          className="department-message-box__send"
          disabled={!hasDraft}
          icon={<Send size={14} aria-hidden="true" />}
          onClick={handleSend}
        >
          {t("department.send")}
        </RetroButton>
      </div>
      {sent ? <p className="system-message">{t("department.sentToDepartment")}</p> : null}
      <p className="muted">{t("department.messageNote")}</p>
    </section>
  );
}

function TaskStatusAction({
  onRefreshTask,
  task,
}: {
  onRefreshTask?: (taskId: string) => void;
  task: TaskSummary;
}) {
  const { t } = useLanguage();
  const canRefresh = Boolean(onRefreshTask) && isRefreshableTask(task);

  return (
    <div className="task-action-row">
      <RetroBadge tone={task.status === "blocked" || task.status === "failed" ? "danger" : "signal"}>
        {task.title} / {formatTaskStatus(task, t)}
      </RetroBadge>
      {canRefresh ? (
        <RetroButton
          aria-label={`${t("department.refreshTask")} ${task.title}`}
          icon={<RefreshCcw size={14} aria-hidden="true" />}
          onClick={() => onRefreshTask?.(task.id)}
        >
          {t("department.refreshTask")}
        </RetroButton>
      ) : null}
    </div>
  );
}

function isRefreshableTask(task: TaskSummary): boolean {
  return task.status === "blocked" || task.status === "failed" || task.status === "waiting_dependency";
}
