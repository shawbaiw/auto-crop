import {
  Building2,
  ClipboardCheck,
  Code2,
  Crown,
  FlaskConical,
  LineChart,
  ListChecks,
  Megaphone,
  MessageSquareText,
  Package,
  RefreshCcw,
  Send,
} from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import type {
  AgentSummary,
  CeoReviewDecisionResponse,
  CeoReviewReturnReason,
  CeoIntakeSummary,
  CeoIntakeStatus,
  CompanySummary,
  DepartmentSummary,
  ObjectiveSummary,
  ProofSummary,
  TaskRefreshResponse,
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
  ceoIntakes?: CeoIntakeSummary[];
  proof?: ProofSummary[];
  onRefreshTask?: (taskId: string) => Promise<TaskRefreshResponse> | TaskRefreshResponse | void;
  onCreateCeoIntake?: (body: string) => Promise<void> | void;
  onCreateCeoReviewDecision?: (input: {
    taskId: string;
    decision: "approve" | "return";
    returnReason?: CeoReviewReturnReason;
    note?: string;
  }) => Promise<CeoReviewDecisionResponse> | CeoReviewDecisionResponse;
};

const ceoRoleId = "ceo";

export function DepartmentWorkspace({
  agents,
  company,
  departments,
  menuBar,
  objectives,
  onCreateCeoIntake,
  onCreateCeoReviewDecision,
  onRefreshTask,
  selectedCeoAgentId,
  tasks,
  ceoIntakes = [],
  proof = [],
  taskProgressEvents = [],
}: DepartmentWorkspaceProps) {
  const { t } = useLanguage();
  const [selectedRoleId, setSelectedRoleId] = useState(ceoRoleId);
  const [departmentDraft, setDepartmentDraft] = useState("");
  const [ceoIntakeDraft, setCeoIntakeDraft] = useState("");
  const selectedDepartment = departments.find((department) => department.id === selectedRoleId) ?? null;
  const selectedCeoAgent = agents.find((agent) => agent.id === selectedCeoAgentId) ?? null;
  const departmentNamesById = useMemo(
    () => new Map(departments.map((department) => [department.id, department.name])),
    [departments],
  );
  const ceoPendingItems = useMemo(
    () => getCeoPendingItems(tasks, departmentNamesById),
    [departmentNamesById, tasks],
  );
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
            icon={<Crown size={18} aria-hidden="true" />}
            onClick={() => setSelectedRoleId(ceoRoleId)}
            selected={selectedRoleId === ceoRoleId}
            title={t("department.ceo")}
          />
          {departments.map((department) => (
            <RetroListRow
              key={department.id}
              icon={departmentIcon(department.name)}
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
                  onViewCeoPending={() => setSelectedRoleId(ceoRoleId)}
                  onRefreshTask={onRefreshTask}
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
                  ]}
                />
                <CeoIntakeWorkspace
                  draft={ceoIntakeDraft}
                  intakes={ceoIntakes}
                  objectives={objectives}
                  onDraftChange={setCeoIntakeDraft}
                  onCreateCeoReviewDecision={onCreateCeoReviewDecision}
                  onRefreshTask={onRefreshTask}
                  onSubmit={onCreateCeoIntake}
                  pendingItems={ceoPendingItems}
                  proof={proof}
                  tasks={tasks}
                />
                <p className="muted">{t("department.schedulerNote")}</p>
              </div>
            </RetroPanel>
          )}
        </section>
      </Workspace>
    </AppShell>
  );
}

type CeoPendingItem = {
  departmentName: string;
  task: TaskSummary;
  type: "review";
};

function getCeoPendingItems(tasks: TaskSummary[], departmentNamesById: Map<string, string>): CeoPendingItem[] {
  return tasks
    .filter((task) => task.taskKind !== "department_subtask" && task.status === "review")
    .map((task) => ({
      departmentName: departmentNamesById.get(task.departmentId) ?? task.departmentId,
      task,
      type: "review" as const,
    }));
}

function departmentIcon(departmentName: string): ReactNode {
  const normalizedName = departmentName.toLowerCase();

  if (normalizedName.includes("growth")) {
    return <LineChart size={18} aria-hidden="true" />;
  }
  if (normalizedName.includes("engineer")) {
    return <Code2 size={18} aria-hidden="true" />;
  }
  if (normalizedName.includes("research")) {
    return <FlaskConical size={18} aria-hidden="true" />;
  }
  if (normalizedName.includes("product")) {
    return <Package size={18} aria-hidden="true" />;
  }

  return <Megaphone size={18} aria-hidden="true" />;
}

function CeoIntakeWorkspace({
  draft,
  intakes,
  objectives,
  onCreateCeoReviewDecision,
  onDraftChange,
  onRefreshTask,
  onSubmit,
  pendingItems,
  proof,
  tasks,
}: {
  draft: string;
  intakes: CeoIntakeSummary[];
  objectives: ObjectiveSummary[];
  onCreateCeoReviewDecision?: DepartmentWorkspaceProps["onCreateCeoReviewDecision"];
  onDraftChange: (value: string) => void;
  onRefreshTask?: (taskId: string) => void;
  onSubmit?: (body: string) => Promise<void> | void;
  pendingItems: CeoPendingItem[];
  proof: ProofSummary[];
  tasks: TaskSummary[];
}) {
  const { t } = useLanguage();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const selectedPendingItem = pendingItems.find((item) => item.task.id === selectedTaskId) ?? null;
  const proofsByTask = useMemo(() => groupProofByTask(proof), [proof]);

  const handleDecision = async (input: Parameters<NonNullable<DepartmentWorkspaceProps["onCreateCeoReviewDecision"]>>[0]) => {
    const response = await onCreateCeoReviewDecision?.(input);
    setSelectedTaskId(null);
    setSuccessMessage(
      response?.decision.decision === "return"
        ? t("department.ceoReviewReturnedSuccess")
        : t("department.ceoReviewApprovedSuccess"),
    );
  };

  return (
    <section className="department-leader-report ceo-intake-report" aria-label={t("department.ceoIntakeReport")}>
      <CeoIntakeFlows intakes={intakes} />
      <CeoPendingQueue
        items={pendingItems}
        onViewTask={(taskId) => {
          setSelectedTaskId(taskId);
          setSuccessMessage(null);
        }}
        successMessage={successMessage}
      />
      {selectedPendingItem ? (
        <CeoTaskReviewDetail
          item={selectedPendingItem}
          onDecision={handleDecision}
          onRefreshTask={onRefreshTask}
          proofs={proofsByTask.get(selectedPendingItem.task.id) ?? []}
        />
      ) : null}
      <CeoBlueprintSummary objectives={objectives} onRefreshTask={onRefreshTask} tasks={tasks} />
      <div className="department-leader-report__spacer" aria-hidden="true" />
      <CeoIntakeMessageBox draft={draft} onDraftChange={onDraftChange} onSubmit={onSubmit} />
    </section>
  );
}

function groupProofByTask(proof: ProofSummary[]): Map<string, ProofSummary[]> {
  const grouped = new Map<string, ProofSummary[]>();
  for (const item of proof) {
    grouped.set(item.taskId, [...(grouped.get(item.taskId) ?? []), item]);
  }
  return grouped;
}

function CeoPendingQueue({
  items,
  onViewTask,
  successMessage,
}: {
  items: CeoPendingItem[];
  onViewTask: (taskId: string) => void;
  successMessage: string | null;
}) {
  const { t } = useLanguage();

  return (
    <section className="ceo-pending-queue" aria-label={t("department.ceoPending")}>
      <h3>{t("department.ceoPending")}</h3>
      {successMessage ? <p className="system-message">{successMessage}</p> : null}
      {items.length === 0 ? <p className="muted">{t("department.noCeoPending")}</p> : null}
      {items.map((item) => (
        <article className="ceo-pending-item" key={item.task.id}>
          <div>
            <p>{formatCeoPendingType(item, t)}</p>
            <h4>{item.task.title}</h4>
          </div>
          <RetroButton aria-label={`${t("department.viewTask")} ${item.task.title}`} onClick={() => onViewTask(item.task.id)}>
            {t("department.viewTask")}
          </RetroButton>
        </article>
      ))}
    </section>
  );
}

function CeoTaskReviewDetail({
  item,
  onDecision,
  onRefreshTask,
  proofs,
}: {
  item: CeoPendingItem;
  onDecision: (input: {
    taskId: string;
    decision: "approve" | "return";
    returnReason?: CeoReviewReturnReason;
    note?: string;
  }) => Promise<void>;
  onRefreshTask?: (taskId: string) => void;
  proofs: ProofSummary[];
}) {
  const { t } = useLanguage();
  const [returnReason, setReturnReason] = useState<CeoReviewReturnReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const noteInputId = useId();
  const reasonInputId = useId();
  const hasProof = proofs.length > 0;

  const handleApprove = async () => {
    if (!hasProof || submitting) {
      return;
    }

    setSubmitting(true);
    try {
      await onDecision({ taskId: item.task.id, decision: "approve" });
    } catch (decisionError) {
      setError((decisionError as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturn = async () => {
    if (submitting) {
      return;
    }

    if (!returnReason) {
      setError(t("department.ceoReviewReturnReasonRequired"));
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onDecision({
        taskId: item.task.id,
        decision: "return",
        returnReason,
        note: note.trim() || undefined,
      });
    } catch (decisionError) {
      setError((decisionError as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="ceo-task-review-detail" aria-label={t("department.ceoTaskReview")}>
      <h3>{t("department.ceoTaskReview")}</h3>
      <p className={hasProof ? "system-message" : "warning-message"}>
        {hasProof ? t("department.ceoReviewCanPass") : t("department.ceoReviewMissingProof")}
      </p>
      <div className="ceo-task-review-detail__grid">
        <section>
          <h4>{t("department.ceoReviewTaskContent")}</h4>
          <p>{item.task.title}</p>
          {item.task.description ? <p className="muted">{item.task.description}</p> : null}
        </section>
        <section>
          <h4>{t("department.ceoReviewDepartmentSubmission")}</h4>
          {proofs.length === 0 ? <p className="muted">{t("department.ceoReviewNoProof")}</p> : null}
          {proofs.map((proof) => (
            <article className="ceo-task-review-proof" key={proof.id}>
              <p>{proof.summary}</p>
              <p className="muted">{`${proof.type} / ${proof.uri}`}</p>
            </article>
          ))}
        </section>
        <section>
          <h4>{t("department.ceoReviewRunStatus")}</h4>
          <VideotexKeyValue
            items={[
              { label: t("department.status"), value: formatTaskStatus(item.task, t) },
              { label: t("department.ceoPendingReviewRequestFrom"), value: item.departmentName },
              ...(item.task.executionProfileName ? [{ label: "Profile", value: item.task.executionProfileName }] : []),
              ...(item.task.effectiveTimeoutMs ? [{ label: "Budget", value: `${Math.round(item.task.effectiveTimeoutMs / 60_000)}m` }] : []),
              ...(item.task.failureReason ? [{ label: "Issue", value: item.task.failureReason }] : []),
              ...(item.task.failureMessage ? [{ label: "Detail", value: item.task.failureMessage }] : []),
              ...(item.task.artifactWorkspacePath ? [{ label: t("department.partialOutput"), value: item.task.artifactWorkspacePath }] : []),
            ]}
          />
        </section>
        <section>
          <h4>{t("department.ceoReviewDecision")}</h4>
          <label className="retro-field" htmlFor={reasonInputId}>
            <span>{t("department.ceoReviewReturnReason")}</span>
            <select
              id={reasonInputId}
              className="retro-input"
              value={returnReason}
              onChange={(event) => setReturnReason(event.target.value as CeoReviewReturnReason | "")}
            >
              <option value="">{t("department.ceoReviewChooseReason")}</option>
              {ceoReturnReasonOptions(t).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="retro-field" htmlFor={noteInputId}>
            <span>{t("department.ceoReviewNextStepNote")}</span>
            <textarea
              id={noteInputId}
              className="retro-textarea ceo-task-review-detail__note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {error ? <p role="alert" className="warning-message">{error}</p> : null}
          <div className="ceo-task-review-detail__actions">
            <RetroButton onClick={() => onRefreshTask?.(item.task.id)}>{t("department.viewTask")}</RetroButton>
            {hasProof ? (
              <RetroButton disabled={submitting} onClick={handleApprove}>
                {t("department.ceoReviewApprove")}
              </RetroButton>
            ) : null}
            <RetroButton disabled={submitting} onClick={handleReturn}>
              {t("department.ceoReviewReturn")}
            </RetroButton>
          </div>
        </section>
      </div>
    </section>
  );
}

function ceoReturnReasonOptions(t: ReturnType<typeof useLanguage>["t"]): Array<{ value: CeoReviewReturnReason; label: string }> {
  return [
    { value: "needs_changes", label: t("department.returnReasonNeedsChanges") },
    { value: "unclear_task_definition", label: t("department.returnReasonUnclearTask") },
    { value: "scope_too_large", label: t("department.returnReasonScopeTooLarge") },
    { value: "wrong_direction", label: t("department.returnReasonWrongDirection") },
  ];
}

function formatCeoPendingType(item: CeoPendingItem, t: ReturnType<typeof useLanguage>["t"]): string {
  if (item.type === "review") {
    return `${t("department.ceoPendingReviewRequestFrom")} ${item.departmentName}`;
  }

  return item.departmentName;
}

function CeoBlueprintSummary({
  objectives,
  onRefreshTask,
  tasks,
}: {
  objectives: ObjectiveSummary[];
  onRefreshTask?: (taskId: string) => void;
  tasks: TaskSummary[];
}) {
  const { t } = useLanguage();

  return (
    <section className="ceo-blueprint-summary" aria-label={t("department.ceoBlueprintSummary")}>
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
    </section>
  );
}

function CeoIntakeFlows({ intakes }: { intakes: CeoIntakeSummary[] }) {
  const { t } = useLanguage();

  return (
    <section className="department-progress-flows ceo-intake-flows" aria-label={t("department.ceoIntakeProgress")}>
      <h3>{t("department.ceoIntakeProgress")}</h3>
      <p className="muted">{t("department.ceoIntakeProgressNote")}</p>
      {intakes.length === 0 ? <p className="muted">{t("department.noCeoIntakes")}</p> : null}
      {intakes.map((intake) => (
        <article className="department-progress-flow ceo-intake-flow" key={intake.id}>
          <h4>
            {t("department.ceoIntakeRequest")}: {summarizeIntakeBody(intake.body)}
          </h4>
          <ol className="department-progress-flow__steps">
            {getCeoIntakeSteps(intake.status, t).map((step) => (
              <li className={`department-progress-flow__step department-progress-flow__step--${step.status}`} key={step.label}>
                <span aria-hidden="true">{progressMarker(step.status)}</span>
                <p>{step.label}</p>
              </li>
            ))}
          </ol>
        </article>
      ))}
    </section>
  );
}

function getCeoIntakeSteps(
  intakeStatus: CeoIntakeStatus,
  t: ReturnType<typeof useLanguage>["t"],
): Array<{ label: string; status: TaskProgressEventSummary["status"] }> {
  const steps: Array<{ key: Exclude<CeoIntakeStatus, "failed">; label: string }> = [
    { key: "received", label: t("department.ceoIntakeReceived") },
    { key: "assessing", label: t("department.ceoIntakeAssessing") },
    { key: "assessment_complete", label: t("department.ceoIntakeAssessmentComplete") },
    { key: "planning", label: t("department.ceoIntakePlanning") },
    { key: "planned", label: t("department.ceoIntakePlanned") },
    { key: "dispatching", label: t("department.ceoIntakeDispatching") },
    { key: "dispatched", label: t("department.ceoIntakeDispatched") },
  ];

  if (intakeStatus === "failed") {
    return [
      ...steps.map((step) => ({ label: step.label, status: "waiting" as const })),
      { label: t("department.ceoIntakeFailed"), status: "blocked" as const },
    ];
  }

  const currentIndex = steps.findIndex((step) => step.key === intakeStatus);
  const milestoneStatuses: CeoIntakeStatus[] = ["received", "assessment_complete", "planned", "dispatched"];

  return steps.map((step, index) => {
    if (index < currentIndex) {
      return { label: step.label, status: "complete" as const };
    }

    if (index === currentIndex) {
      return {
        label: step.label,
        status: milestoneStatuses.includes(intakeStatus) ? "complete" as const : "current" as const,
      };
    }

    if (index === currentIndex + 1 && intakeStatus !== "dispatched" && milestoneStatuses.includes(intakeStatus)) {
      return { label: step.label, status: "current" as const };
    }

    return { label: step.label, status: "waiting" as const };
  });
}

function summarizeIntakeBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > 90 ? `${trimmed.slice(0, 87)}...` : trimmed;
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
  onRefreshTask,
  onViewCeoPending,
  progressEvents,
  responsibility,
  tasks,
}: {
  departmentId: string;
  departmentName: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onRefreshTask?: DepartmentWorkspaceProps["onRefreshTask"];
  onViewCeoPending: () => void;
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
      <DepartmentProgressFlows
        departmentId={departmentId}
        onRefreshTask={onRefreshTask}
        onViewCeoPending={onViewCeoPending}
        progressEvents={progressEvents}
        tasks={tasks}
      />
      <div className="department-leader-report__spacer" aria-hidden="true" />
      <DepartmentMessageBox departmentName={departmentName} draft={draft} onDraftChange={onDraftChange} />
    </section>
  );
}

function DepartmentProgressFlows({
  departmentId,
  onRefreshTask,
  onViewCeoPending,
  progressEvents,
  tasks,
}: {
  departmentId: string;
  onRefreshTask?: DepartmentWorkspaceProps["onRefreshTask"];
  onViewCeoPending: () => void;
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
                <div className="department-progress-flow__content">
                  <p>{formatProgressLabel(event, flow.task.title, t)}</p>
                  {isCeoReviewProgressEvent(event) ? (
                    <RetroButton className="department-progress-flow__action" onClick={onViewCeoPending}>
                      {t("department.viewCeoPendingItem")}
                    </RetroButton>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <TaskStatusAction onRefreshTask={onRefreshTask} showStatusBadge={false} task={flow.task} />
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
      return formatCeoReviewSubmittedLabel(parentTaskTitle, t);
    case "complete":
      return t("department.flowComplete");
    case "blocked":
      if (event.label.startsWith("CEO Office returned")) {
        return event.detail ? `${event.label} ${event.detail}` : event.label;
      }
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
  if (status === "review") {
    return formatCeoReviewSubmittedLabel(displayTitle, t);
  }

  return `${t("department.flowTask")} (${displayTitle}) ${formatFlowTaskStatus(status, t)}`;
}

function formatCeoReviewSubmittedLabel(title: string, t: ReturnType<typeof useLanguage>["t"]): string {
  return `${t("department.flowTask")} (${title}) ${t("department.flowSubmittedToCeoReview")}`;
}

function isCeoReviewProgressEvent(event: TaskProgressEventSummary): boolean {
  if (event.step === "awaiting_review") {
    return true;
  }

  return event.step === "executing" && /\sreview$/i.test(event.label);
}

function formatFlowTaskStatus(status: string, t: ReturnType<typeof useLanguage>["t"]): string {
  switch (status) {
    case "waiting":
      return t("department.flowStatusWaiting");
    case "queued":
      return t("department.flowStatusWaiting");
    case "waiting_dependency":
    case "needs_replan":
      return formatTaskStatus({ status } as TaskSummary, t);
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

function CeoIntakeMessageBox({
  draft,
  onDraftChange,
  onSubmit,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit?: (body: string) => Promise<void> | void;
}) {
  const { t } = useLanguage();
  const messageInputId = useId();
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const hasDraft = draft.trim().length > 0;
  const handleSend = async () => {
    if (!hasDraft || submitting) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit?.(draft.trim());
      setSent(true);
      onDraftChange("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="department-message-box" aria-label={t("department.ceoIntakeBox")}>
      <div className="department-message-box__header">
        <MessageSquareText size={16} aria-hidden="true" />
        <h3>{t("department.ceoIntakeBox")}</h3>
      </div>
      <div className="department-message-box__field">
        <label htmlFor={messageInputId}>{t("department.ceoIntakeLabel")}</label>
        <div className="department-message-box__composer">
          <textarea
            id={messageInputId}
            className="retro-textarea"
            placeholder={t("department.ceoIntakePlaceholder")}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
          />
          <RetroButton
            aria-label={`${t("department.send")} ${t("department.ceoOffice")}`}
            className="department-message-box__send"
            disabled={!hasDraft || submitting}
            icon={<Send size={14} aria-hidden="true" />}
            onClick={handleSend}
          >
            {t("department.send")}
          </RetroButton>
        </div>
      </div>
      {sent ? <p className="system-message">{t("department.sentToCeoOffice")}</p> : null}
      <p className="muted">{t("department.ceoIntakeNote")}</p>
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
  const messageInputId = useId();
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
      <div className="department-message-box__field">
        <label htmlFor={messageInputId}>{t("department.messageLabel")}</label>
        <div className="department-message-box__composer">
          <textarea
            id={messageInputId}
            className="retro-textarea"
            placeholder={t("department.messagePlaceholder")}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
          />
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
      </div>
      {sent ? <p className="system-message">{t("department.sentToDepartment")}</p> : null}
      <p className="muted">{t("department.messageNote")}</p>
    </section>
  );
}

function TaskStatusAction({
  onRefreshTask,
  showStatusBadge = true,
  task,
}: {
  onRefreshTask?: (taskId: string) => Promise<TaskRefreshResponse> | TaskRefreshResponse | void;
  showStatusBadge?: boolean;
  task: TaskSummary;
}) {
  const { t } = useLanguage();
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const canRefresh = Boolean(onRefreshTask) && isRefreshableTask(task);

  const handleRefresh = async () => {
    const response = await onRefreshTask?.(task.id);
    setRefreshMessage(response?.recovery?.message ?? null);
  };

  if (!showStatusBadge && !canRefresh && !refreshMessage) {
    return null;
  }

  return (
    <div className="task-action-row">
      {showStatusBadge ? (
        <RetroBadge tone={task.status === "blocked" || task.status === "failed" ? "danger" : "signal"}>
          {task.title} / {formatTaskStatus(task, t)}
        </RetroBadge>
      ) : null}
      {canRefresh ? (
        <RetroButton
          aria-label={`${t("department.refreshTask")} ${task.title}`}
          icon={<RefreshCcw size={14} aria-hidden="true" />}
          onClick={handleRefresh}
        >
          {t("department.refreshTask")}
        </RetroButton>
      ) : null}
      {refreshMessage ? <p className="system-message">{refreshMessage}</p> : null}
    </div>
  );
}

function isRefreshableTask(task: TaskSummary): boolean {
  return task.status === "blocked" || task.status === "failed" || task.status === "waiting_dependency";
}
