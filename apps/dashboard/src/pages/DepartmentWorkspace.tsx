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
  BusinessArtifactSummary,
  CeoReviewDecisionResponse,
  CeoReviewReturnReason,
  CeoIntakeSummary,
  CeoIntakeStatus,
  CompanySummary,
  DepartmentSummary,
  ObjectiveSummary,
  ProofSummary,
  TaskRecoveryResponse,
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
  businessArtifacts?: BusinessArtifactSummary[];
  onRefreshTask?: (taskId: string) => Promise<TaskRefreshResponse> | TaskRefreshResponse | void;
  onRecoverTask?: (taskId: string) => Promise<TaskRecoveryResponse> | TaskRecoveryResponse | void;
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
  onRecoverTask,
  selectedCeoAgentId,
  tasks,
  ceoIntakes = [],
  proof = [],
  businessArtifacts = [],
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
    () => getCeoPendingItems(tasks, businessArtifacts, departmentNamesById),
    [businessArtifacts, departmentNamesById, tasks],
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
                  onRecoverTask={onRecoverTask}
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
                  departments={departments}
                  intakes={ceoIntakes}
                  objectives={objectives}
                  onDraftChange={setCeoIntakeDraft}
                  onCreateCeoReviewDecision={onCreateCeoReviewDecision}
                  onRefreshTask={onRefreshTask}
                  onSelectDepartment={setSelectedRoleId}
                  onSubmit={onCreateCeoIntake}
                  pendingItems={ceoPendingItems}
                  proof={proof}
                  businessArtifacts={businessArtifacts}
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

function getCeoPendingItems(
  tasks: TaskSummary[],
  businessArtifacts: BusinessArtifactSummary[],
  departmentNamesById: Map<string, string>,
): CeoPendingItem[] {
  return tasks
    .filter((task) => task.taskKind !== "department_subtask" && task.status === "review")
    .filter((task) => isReviewableArtifact(currentArtifactForTask(task.id, businessArtifacts)))
    .map((task) => ({
      departmentName: departmentNamesById.get(task.departmentId) ?? task.departmentId,
      task,
      type: "review" as const,
    }));
}

function currentArtifactForTask(taskId: string, businessArtifacts: BusinessArtifactSummary[]): BusinessArtifactSummary | null {
  return businessArtifacts.find((artifact) => artifact.taskId === taskId && artifact.isCurrent) ?? null;
}

function isReviewableArtifact(artifact: BusinessArtifactSummary | null): boolean {
  return (
    artifact !== null &&
    artifact.isCurrent &&
    artifact.validationStatus === "valid" &&
    artifact.reviewStatus === "unreviewed" &&
    (artifact.artifactKind === "deliverable" || artifact.artifactKind === "final_report")
  );
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
  departments,
  draft,
  intakes,
  objectives,
  onCreateCeoReviewDecision,
  onDraftChange,
  onRefreshTask,
  onSelectDepartment,
  onSubmit,
  pendingItems,
  proof,
  businessArtifacts,
  tasks,
}: {
  departments: DepartmentSummary[];
  draft: string;
  intakes: CeoIntakeSummary[];
  objectives: ObjectiveSummary[];
  onCreateCeoReviewDecision?: DepartmentWorkspaceProps["onCreateCeoReviewDecision"];
  onDraftChange: (value: string) => void;
  onRefreshTask?: (taskId: string) => void;
  onSelectDepartment: (departmentId: string) => void;
  onSubmit?: (body: string) => Promise<void> | void;
  pendingItems: CeoPendingItem[];
  proof: ProofSummary[];
  businessArtifacts: BusinessArtifactSummary[];
  tasks: TaskSummary[];
}) {
  const { t } = useLanguage();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const selectedPendingItem = pendingItems.find((item) => item.task.id === selectedTaskId) ?? null;
  const proofsByTask = useMemo(() => groupProofByTask(proof), [proof]);
  const artifactsByTask = useMemo(() => groupBusinessArtifactsByTask(businessArtifacts), [businessArtifacts]);

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
          businessArtifacts={artifactsByTask.get(selectedPendingItem.task.id) ?? []}
        />
      ) : null}
      <CeoBlueprintSummary
        departments={departments}
        objectives={objectives}
        onSelectDepartment={onSelectDepartment}
        onViewPendingTask={(taskId) => {
          setSelectedTaskId(taskId);
          setSuccessMessage(null);
        }}
        pendingItems={pendingItems}
        tasks={tasks}
      />
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

function groupBusinessArtifactsByTask(artifacts: BusinessArtifactSummary[]): Map<string, BusinessArtifactSummary[]> {
  const grouped = new Map<string, BusinessArtifactSummary[]>();
  for (const artifact of artifacts) {
    grouped.set(artifact.taskId, [...(grouped.get(artifact.taskId) ?? []), artifact]);
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
  businessArtifacts,
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
  businessArtifacts: BusinessArtifactSummary[];
}) {
  const { t } = useLanguage();
  const [returnReason, setReturnReason] = useState<CeoReviewReturnReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const noteInputId = useId();
  const reasonInputId = useId();
  const hasProof = proofs.length > 0;
  const currentArtifact = businessArtifacts.find((artifact) => artifact.isCurrent) ?? businessArtifacts[0] ?? null;
  const hasValidArtifact =
    currentArtifact !== null &&
    currentArtifact.validationStatus === "valid" &&
    currentArtifact.reviewStatus === "unreviewed" &&
    (currentArtifact.artifactKind === "deliverable" || currentArtifact.artifactKind === "final_report");
  const canApprove = hasProof && hasValidArtifact;

  const handleApprove = async () => {
    if (!canApprove || submitting) {
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
      <p className={canApprove ? "system-message" : "warning-message"}>
        {canApprove ? t("department.ceoReviewCanPass") : t("department.ceoReviewMissingProof")}
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
          {currentArtifact ? (
            <article className="ceo-task-review-proof">
              <p>{`${currentArtifact.artifactKind} / ${currentArtifact.artifactRole} / ${currentArtifact.artifactSubtype}`}</p>
              <p className="muted">{`${currentArtifact.validationStatus} / ${currentArtifact.reviewStatus}`}</p>
            </article>
          ) : (
            <p className="muted">{t("dashboard.noBusinessArtifacts")}</p>
          )}
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
            {canApprove ? (
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
  departments,
  objectives,
  onSelectDepartment,
  onViewPendingTask,
  pendingItems,
  tasks,
}: {
  departments: DepartmentSummary[];
  objectives: ObjectiveSummary[];
  onSelectDepartment: (departmentId: string) => void;
  onViewPendingTask: (taskId: string) => void;
  pendingItems: CeoPendingItem[];
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
        <h3>{t("department.taskRelationships")}</h3>
        <CeoTaskDependencyGraph
          departments={departments}
          onSelectDepartment={onSelectDepartment}
          onViewPendingTask={onViewPendingTask}
          pendingItems={pendingItems}
          tasks={tasks}
        />
      </div>
    </section>
  );
}

function CeoTaskDependencyGraph({
  departments,
  onSelectDepartment,
  onViewPendingTask,
  pendingItems,
  tasks,
}: {
  departments: DepartmentSummary[];
  onSelectDepartment: (departmentId: string) => void;
  onViewPendingTask: (taskId: string) => void;
  pendingItems: CeoPendingItem[];
  tasks: TaskSummary[];
}) {
  const { t } = useLanguage();
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
                  <span>{lane.department.name}</span>
                </h4>
                <div className="ceo-task-dependency-graph__lane-stack">
                  {lane.tasks.map((task) => (
                    <CeoTaskDependencyNode
                      key={task.id}
                      departmentName={departmentsById.get(task.departmentId)?.name ?? task.departmentId}
                      graph={graph}
                      isPending={pendingTaskIds.has(task.id)}
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
  onSelectDepartment,
  onViewPendingTask,
  task,
}: {
  departmentName: string;
  graph: CeoTaskGraph;
  isPending: boolean;
  onSelectDepartment: (departmentId: string) => void;
  onViewPendingTask: (taskId: string) => void;
  task: TaskSummary;
}) {
  const { t } = useLanguage();
  const blockers = getUnfinishedDependencies(task, graph.tasksById);
  const primaryBlocker = blockers[0] ?? null;
  const shouldShowOtherDependencies = Boolean(primaryBlocker);
  const completedDependencyNumbers = shouldShowOtherDependencies
    ? (task.dependsOnTaskIds ?? [])
      .map((dependencyId) => graph.tasksById.get(dependencyId))
      .filter((dependency): dependency is TaskSummary => dependency != null && dependency.id !== primaryBlocker?.id)
      .map((dependency) => taskNumber(dependency, graph.tasks))
    : [];
  const taskLabel = `${t("department.taskTitlePrefix")}${taskNumber(task, graph.tasks)} ${departmentName} ${task.title} ${formatGraphTaskStatus(task, t)}`;

  return (
    <article className={`ceo-task-node ceo-task-node--${graphTaskTone(task)}`}>
      <button
        aria-label={[
          taskLabel,
          primaryBlocker ? `${t("department.waitingOnTask")} ${taskNumber(primaryBlocker, graph.tasks)}: ${primaryBlocker.title}` : null,
          completedDependencyNumbers.length > 0 ? `${t("department.alsoDependsOn")}: ${completedDependencyNumbers.join(", ")}` : null,
        ].filter(Boolean).join(" ")}
        className="ceo-task-node__main"
        onClick={() => onSelectDepartment(task.departmentId)}
        type="button"
      >
        <span className="ceo-task-node__meta">
          {t("department.taskTitlePrefix")}{taskNumber(task, graph.tasks)} · {departmentName}
        </span>
        <strong>{task.title}</strong>
        <span>{formatGraphTaskStatus(task, t)}</span>
        {primaryBlocker ? (
          <span className="ceo-task-node__blocker">
            {t("department.waitingOnTask")} {taskNumber(primaryBlocker, graph.tasks)}: {primaryBlocker.title}
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
  onRecoverTask,
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
  onRecoverTask?: DepartmentWorkspaceProps["onRecoverTask"];
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
        onRecoverTask={onRecoverTask}
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
  onRecoverTask,
  onViewCeoPending,
  progressEvents,
  tasks,
}: {
  departmentId: string;
  onRefreshTask?: DepartmentWorkspaceProps["onRefreshTask"];
  onRecoverTask?: DepartmentWorkspaceProps["onRecoverTask"];
  onViewCeoPending: () => void;
  progressEvents: TaskProgressEventSummary[];
  tasks: TaskSummary[];
}) {
  const { t } = useLanguage();
  const parentTasks = tasks.filter((task) => task.taskKind !== "department_subtask");
  const progressEventsByParent = groupProgressEvents(progressEvents.filter((event) => event.departmentId === departmentId));
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
          <h4>{formatDepartmentTaskTitle(index, flow.task.title, t)}</h4>
          <ol className="department-progress-flow__steps">
            {flow.events.map((event) => (
              <li className={`department-progress-flow__step department-progress-flow__step--${event.status}`} key={event.id}>
                <span aria-hidden="true">{progressMarker(event.status)}</span>
                <div className="department-progress-flow__content">
                  <p>{formatProgressLabel(event, flow.task, t)}</p>
                  {isActiveCeoReviewProgressEvent(event, flow.task) ? (
                    <RetroButton className="department-progress-flow__action" onClick={onViewCeoPending}>
                      {t("department.viewCeoPendingItem")}
                    </RetroButton>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <TaskStatusAction
            onRefreshTask={onRefreshTask}
            onRecoverTask={onRecoverTask}
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

function groupProgressEvents(events: TaskProgressEventSummary[]): Map<string, TaskProgressEventSummary[]> {
  const grouped = new Map<string, TaskProgressEventSummary[]>();
  for (const event of events) {
    grouped.set(event.parentTaskId, [...(grouped.get(event.parentTaskId) ?? []), event]);
  }
  return grouped;
}

function resolveTaskProgressEvents(task: TaskSummary, events: TaskProgressEventSummary[] | undefined): TaskProgressEventSummary[] {
  const baseEvents = events ?? fallbackProgressEvents(task);
  const derivedEvent = deriveCurrentTaskProgressEvent(task);

  if (!derivedEvent || progressEventsAlreadyReflectTaskStatus(baseEvents, task)) {
    return baseEvents;
  }

  return [...baseEvents, derivedEvent];
}

function deriveCurrentTaskProgressEvent(task: TaskSummary): TaskProgressEventSummary | null {
  const status = taskProgressStatusForTask(task);

  if (!status) {
    return null;
  }

  return {
    id: `${task.id}_derived_current_status`,
    companyId: "",
    departmentId: task.departmentId,
    parentTaskId: task.parentTaskId ?? task.id,
    subjectTaskId: task.id,
    step: task.status === "review" ? "awaiting_review" : "executing",
    status,
    label: `Task (${task.title}) ${task.status}`,
    detail: null,
    createdAt: "",
  };
}

function taskProgressStatusForTask(task: TaskSummary): TaskProgressEventSummary["status"] | null {
  switch (task.status) {
    case "queued":
      return "waiting";
    case "running":
    case "retrying":
    case "review":
      return "current";
    case "waiting_dependency":
      return "waiting";
    case "complete":
      return "complete";
    case "blocked":
    case "failed":
    case "needs_replan":
      return "blocked";
    default:
      return null;
  }
}

function progressEventsAlreadyReflectTaskStatus(events: TaskProgressEventSummary[], task: TaskSummary): boolean {
  const currentProgressStatus = taskProgressStatusForTask(task);

  return events.some((event) => {
    if (task.status === "review") {
      return event.step === "awaiting_review" || (event.step === "executing" && /\sreview$/i.test(event.label));
    }

    if (event.step !== "executing") {
      return false;
    }

    if (currentProgressStatus && event.status === currentProgressStatus) {
      return true;
    }

    const match = event.label.match(/^Task(?: \d+)? \((.+)\) ([a-z_]+)$/i);
    return Boolean(match && match[2] === task.status);
  });
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

function formatProgressLabel(event: TaskProgressEventSummary, task: TaskSummary, t: ReturnType<typeof useLanguage>["t"]): string {
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
      return formatReviewProgressLabel(task, t);
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
      return formatExecutingProgressLabel(event.label, task, t);
  }
}

function formatExecutingProgressLabel(label: string, task: TaskSummary, t: ReturnType<typeof useLanguage>["t"]): string {
  const match = label.match(/^Task(?: \d+)? \((.+)\) ([a-z_]+)$/i);
  if (!match) {
    return label;
  }

  const [, taskTitle, status] = match;
  if (status === "review") {
    return formatReviewProgressLabel(task, t);
  }

  return `${t("department.flowTask")} (${task.title}) ${formatFlowTaskStatus(task.status, t)}`;
}

function formatReviewProgressLabel(task: TaskSummary, t: ReturnType<typeof useLanguage>["t"]): string {
  if (task.status === "review") {
    return formatCeoReviewSubmittedLabel(task.title, t);
  }

  return `${t("department.flowTask")} (${task.title}) ${formatFlowTaskStatus(task.status, t)}`;
}

function formatCeoReviewSubmittedLabel(title: string, t: ReturnType<typeof useLanguage>["t"]): string {
  return `${t("department.flowTask")} (${title}) ${t("department.flowSubmittedToCeoReview")}`;
}

function isActiveCeoReviewProgressEvent(event: TaskProgressEventSummary, task: TaskSummary): boolean {
  if (task.status !== "review") {
    return false;
  }

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
  onRecoverTask,
  onRefreshTask,
  showStatusBadge = true,
  task,
}: {
  onRecoverTask?: (taskId: string) => Promise<TaskRecoveryResponse> | TaskRecoveryResponse | void;
  onRefreshTask?: (taskId: string) => Promise<TaskRefreshResponse> | TaskRefreshResponse | void;
  showStatusBadge?: boolean;
  task: TaskSummary;
}) {
  const { t } = useLanguage();
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const canRefresh = Boolean(onRefreshTask) && isRefreshableTask(task);
  const canRecover = Boolean(onRecoverTask) && isRecoverableTask(task);

  const handleRefresh = async () => {
    const response = await onRefreshTask?.(task.id);
    setRefreshMessage(response?.recovery?.message ?? null);
  };

  const handleRecover = async () => {
    const response = await onRecoverTask?.(task.id);
    setRefreshMessage(response?.recovery?.message ?? null);
  };

  if (!showStatusBadge && !canRefresh && !canRecover && !refreshMessage) {
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
      {canRecover ? (
        <RetroButton
          aria-label={`${t("department.recoverTask")} ${task.title}`}
          icon={<RefreshCcw size={14} aria-hidden="true" />}
          onClick={handleRecover}
        >
          {t("department.recoverTask")}
        </RetroButton>
      ) : null}
      {refreshMessage ? <p className="system-message">{refreshMessage}</p> : null}
    </div>
  );
}

function isRefreshableTask(task: TaskSummary): boolean {
  return (
    task.status === "blocked" ||
    ((task.status === "failed" || task.status === "needs_replan") &&
      (task.failureReason === "no_proof" || task.failureReason === "missing_deliverable"))
  );
}

function isRecoverableTask(task: TaskSummary): boolean {
  if (task.status === "failed" || task.status === "needs_replan") {
    return task.failureReason !== "no_proof" && task.failureReason !== "missing_deliverable";
  }

  return false;
}
