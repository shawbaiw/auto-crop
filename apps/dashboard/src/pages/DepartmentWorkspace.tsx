import { Building2, ClipboardCheck, Crown, ListChecks, MessageSquareText, RefreshCcw, Send } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type {
  AgentSummary,
  CompanySummary,
  DepartmentSummary,
  ObjectiveSummary,
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
                <DepartmentResponsibility responsibility={selectedDepartment.responsibility} />
                <TaskCompletionSummary tasks={tasksByDepartment.get(selectedDepartment.id) ?? []} />
                <DepartmentTaskList onRefreshTask={onRefreshTask} tasks={tasksByDepartment.get(selectedDepartment.id) ?? []} />
                <DepartmentMessageBox
                  departmentName={selectedDepartment.name}
                  draft={departmentDraft}
                  onDraftChange={setDepartmentDraft}
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

function DepartmentResponsibility({ responsibility }: { responsibility: string }) {
  const { t } = useLanguage();

  return (
    <section className="department-responsibility" aria-label={t("department.responsibility")}>
      <h3>{t("department.responsibility")}</h3>
      <p>{responsibility}</p>
    </section>
  );
}

function TaskCompletionSummary({ tasks }: { tasks: TaskSummary[] }) {
  const { t } = useLanguage();
  const total = tasks.length;
  const complete = tasks.filter((task) => task.status === "complete" || task.status === "review").length;
  const running = tasks.filter((task) => task.status === "running" || task.status === "retrying").length;
  const waiting = tasks.filter((task) => task.status === "queued" || task.status === "waiting_dependency").length;
  const blocked = tasks.filter((task) => task.status === "blocked" || task.status === "failed" || task.status === "needs_replan").length;
  const details = [
    running > 0 ? `${running} ${t("department.inProgressTasks")}` : null,
    waiting > 0 ? `${waiting} ${t("department.waitingTasks")}` : null,
    blocked > 0 ? `${blocked} ${t("department.blockedTasks")}` : null,
  ].filter((detail): detail is string => Boolean(detail));

  return (
    <section className="department-task-progress" aria-label={t("department.taskCompletion")}>
      <h3>{t("department.taskCompletion")}</h3>
      <div className="department-task-progress__meter" aria-label={`${complete} / ${total}`}>
        <span style={{ width: total > 0 ? `${Math.round((complete / total) * 100)}%` : "0%" }} />
      </div>
      <p className="department-task-progress__summary">
        {complete} / {total} {t("department.tasksComplete")}
      </p>
      <p className="muted">{details.length > 0 ? details.join(" / ") : t("department.noOpenTaskIssues")}</p>
    </section>
  );
}

function DepartmentTaskList({
  onRefreshTask,
  tasks,
}: {
  onRefreshTask?: (taskId: string) => void;
  tasks: TaskSummary[];
}) {
  const { t } = useLanguage();

  return (
    <section className="department-task-list" aria-label={t("department.assignedTasks")}>
      <h3>{t("department.assignedTasks")}</h3>
      <p className="muted">{t("department.assignedTasksNote")}</p>
      <div className="task-action-list">
        {tasks.length === 0 ? <p className="muted">{t("department.noTasks")}</p> : null}
        {tasks.map((task) => (
          <TaskStatusAction key={task.id} onRefreshTask={onRefreshTask} task={task} />
        ))}
      </div>
    </section>
  );
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
  const [lastTarget, setLastTarget] = useState<"ceo" | "department" | null>(null);
  const hasDraft = draft.trim().length > 0;
  const handleSend = (target: "ceo" | "department") => {
    if (!hasDraft) {
      return;
    }

    setLastTarget(target);
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
          aria-label={`${t("department.sendToDepartment")} ${departmentName}`}
          disabled={!hasDraft}
          icon={<Send size={14} aria-hidden="true" />}
          onClick={() => handleSend("department")}
        >
          {t("department.sendToDepartment")}
        </RetroButton>
        <RetroButton
          aria-label={t("department.sendToCeoOffice")}
          disabled={!hasDraft}
          icon={<Send size={14} aria-hidden="true" />}
          onClick={() => handleSend("ceo")}
        >
          {t("department.sendToCeoOffice")}
        </RetroButton>
      </div>
      {lastTarget ? (
        <p className="system-message">{lastTarget === "department" ? t("department.sentToDepartment") : t("department.sentToCeoOffice")}</p>
      ) : null}
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
