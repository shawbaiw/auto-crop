import { deriveCeoPendingItems } from "@auto-crop/core";
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
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import type {
  AgentSummary,
  BusinessArtifactSummary,
  Locale,
  LocalizedText,
  CeoAttentionRollupSummary,
  CeoReviewDecisionResponse,
  CeoReviewReturnReason,
  CeoIntakeSummary,
  CeoIntakeStatus,
  CeoOfficeItemSummary,
  CompanySummary,
  DepartmentSummary,
  FinalFounderReportSummary,
  FounderDecisionResolutionResponse,
  FounderDecisionSummary,
  HumanActionSummary,
  KeyResultSummary,
  ObjectiveSummary,
  ProofSummary,
  TaskCompletionEventSummary,
  TaskRecoveryResponse,
  TaskRefreshResponse,
  TaskProgressEventSummary,
  TaskSummary,
  VisionGapSummary,
  WaitStateSummary,
} from "../api/client";
import { UnseenBadge } from "../ui/ceoOutcomes/UnseenBadge";
import { isUnseenSince, readOutcomesLastSeen, writeOutcomesLastSeen } from "../ui/ceoOutcomes/lastSeen";
import { VideotexKeyValue, VideotexLog } from "../ui/data";
import { HumanActionPanel } from "../ui/humanActions/HumanActionPanel";
import { useLanguage, type TranslationKey } from "../ui/language";
import { resolveLocalizedValue } from "../ui/language/localizedText";
import { AppShell, PageHeader, RetroDialog, Workspace } from "../ui/layout";
import { RetroBadge, RetroButton, RetroListRow, RetroPanel } from "../ui/retro";
import {
  formatArtifactKind,
  formatArtifactReviewStatus,
  formatArtifactRole,
  formatArtifactValidationStatus,
  formatCapability,
  formatCodeLabel,
  formatCompanyStatus,
  formatProofType,
} from "../ui/tasks/formatDisplayValue";
import { formatTaskFailureReason, formatTaskStatus } from "../ui/tasks/formatTaskStatus";
import { WaitStatePanel } from "../ui/waitStates/WaitStatePanel";

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
  ceoAttentionRollups?: CeoAttentionRollupSummary[];
  ceoOfficeItems?: CeoOfficeItemSummary[];
  finalFounderReport?: FinalFounderReportSummary | null;
  finalFounderReportPreparing?: boolean;
  founderDecisions?: FounderDecisionSummary[];
  humanActions?: HumanActionSummary[];
  keyResults?: KeyResultSummary[];
  taskCompletionEvents?: TaskCompletionEventSummary[];
  visionGaps?: VisionGapSummary[];
  waitStates?: WaitStateSummary[];
  onConfirmHumanAction?: (humanActionId: string, evidence: Record<string, string>) => Promise<void> | void;
  onResolveFounderDecision?: (input: {
    founderDecisionId: string;
    chosenOption?: string;
    action?: "return";
    returnReason?: CeoReviewReturnReason;
    note?: string;
  }) => Promise<FounderDecisionResolutionResponse> | FounderDecisionResolutionResponse;
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
  onResolveFounderDecision,
  onConfirmHumanAction,
  onRefreshTask,
  onRecoverTask,
  selectedCeoAgentId,
  tasks,
  ceoIntakes = [],
  proof = [],
  businessArtifacts = [],
  ceoAttentionRollups = [],
  ceoOfficeItems = [],
  finalFounderReport = null,
  finalFounderReportPreparing = false,
  founderDecisions = [],
  humanActions = [],
  keyResults = [],
  taskCompletionEvents = [],
  visionGaps = [],
  waitStates = [],
  taskProgressEvents = [],
}: DepartmentWorkspaceProps) {
  const { language, t } = useLanguage();
  const [selectedRoleId, setSelectedRoleId] = useState(ceoRoleId);
  const [departmentDraft, setDepartmentDraft] = useState("");
  const [ceoIntakeDraft, setCeoIntakeDraft] = useState("");
  const selectedDepartment = departments.find((department) => department.id === selectedRoleId) ?? null;
  const selectedCeoAgent = agents.find((agent) => agent.id === selectedCeoAgentId) ?? null;
  const departmentNamesById = useMemo(
    () => new Map(departments.map((department) => [department.id, departmentName(department, language)])),
    [departments, language],
  );
  const ceoPendingItems = useMemo(
    () => getCeoPendingItems(ceoOfficeItems, tasks, departmentNamesById),
    [ceoOfficeItems, departmentNamesById, tasks],
  );
  // The Founder Vision is shown once in the CEO Office header. The company record carries it; a Task
  // Brief item is the fallback for an older snapshot whose company summary omits it.
  const ceoOfficeFounderVision =
    company.founderVision ??
    ceoOfficeItems.find(
      (item): item is Extract<CeoOfficeItemSummary, { type: "task_brief" }> => item.type === "task_brief",
    )?.data.founderVision ??
    "";
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
        status={formatCompanyStatus(company.status, t)}
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
              title={departmentName(department, language)}
            />
          ))}
        </RetroPanel>

        <section className="department-workspace__main">
          {selectedDepartment ? (
            <RetroPanel icon={<ListChecks size={18} aria-hidden="true" />} title={`${departmentName(selectedDepartment, language)} ${t("department.workspace")}`}>
              <div className="role-summary">
                <section className="department-overview">
                  <DepartmentAgentSummary agents={agents} department={selectedDepartment} />
                  <DepartmentRoleSummary department={selectedDepartment} />
                </section>
                <DepartmentLeaderReport
                  departmentId={selectedDepartment.id}
                  departmentName={departmentName(selectedDepartment, language)}
                  draft={departmentDraft}
                  humanActions={humanActions.filter((action) => action.departmentId === selectedDepartment.id)}
                  waitStates={waitStates.filter((waitState) => waitState.departmentId === selectedDepartment.id)}
                  onConfirmHumanAction={onConfirmHumanAction}
                  onDraftChange={setDepartmentDraft}
                  onViewCeoPending={() => setSelectedRoleId(ceoRoleId)}
                  onRefreshTask={onRefreshTask}
                  onRecoverTask={onRecoverTask}
                  pendingItems={ceoPendingItems}
                  progressEvents={taskProgressEvents}
                  responsibility={departmentResponsibility(selectedDepartment, language)}
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
                  companyId={company.id}
                  companyLocale={company.locale ?? "en"}
                  founderVision={ceoOfficeFounderVision}
                  draft={ceoIntakeDraft}
                  departments={departments}
                  intakes={ceoIntakes}
                  objectives={objectives}
                  keyResults={keyResults}
                  ceoOfficeItems={ceoOfficeItems}
                  ceoAttentionRollups={ceoAttentionRollups}
                  finalFounderReport={finalFounderReport}
                  finalFounderReportPreparing={finalFounderReportPreparing}
                  founderDecisions={founderDecisions}
                  taskCompletionEvents={taskCompletionEvents}
                  onDraftChange={setCeoIntakeDraft}
                  onCreateCeoReviewDecision={onCreateCeoReviewDecision}
                  onResolveFounderDecision={onResolveFounderDecision}
                  onConfirmHumanAction={onConfirmHumanAction}
                  onSelectDepartment={setSelectedRoleId}
                  onSubmit={onCreateCeoIntake}
                  pendingItems={ceoPendingItems}
                  proof={proof}
                  businessArtifacts={businessArtifacts}
                  humanActions={humanActions}
                  visionGaps={visionGaps}
                  waitStates={waitStates}
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
  officeItem: CeoOfficeItemSummary | null;
  task: TaskSummary;
  type: "review" | CeoOfficeItemSummary["type"];
};

function getCeoPendingItems(
  ceoOfficeItems: CeoOfficeItemSummary[],
  tasks: TaskSummary[],
  departmentNamesById: Map<string, string>,
): CeoPendingItem[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  return deriveCeoPendingItems(ceoOfficeItems)
    .flatMap((officeItem) => {
      if (!officeItem.taskId) {
        return [];
      }
      const task = tasksById.get(officeItem.taskId);
      if (!task) {
        return [];
      }
      return [{
        departmentName: officeItem.departmentId ? departmentNamesById.get(officeItem.departmentId) ?? officeItem.departmentId : "",
        officeItem,
        task,
        type: officeItem.type,
      }];
    });
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
  ceoAttentionRollups,
  ceoOfficeItems,
  companyId,
  companyLocale,
  finalFounderReport,
  finalFounderReportPreparing,
  founderVision,
  departments,
  draft,
  founderDecisions,
  humanActions,
  intakes,
  keyResults,
  objectives,
  taskCompletionEvents,
  onCreateCeoReviewDecision,
  onResolveFounderDecision,
  onConfirmHumanAction,
  onDraftChange,
  onSelectDepartment,
  onSubmit,
  pendingItems,
  proof,
  businessArtifacts,
  tasks,
  visionGaps,
  waitStates,
}: {
  ceoAttentionRollups: CeoAttentionRollupSummary[];
  ceoOfficeItems: CeoOfficeItemSummary[];
  companyId: string;
  companyLocale: Locale;
  finalFounderReport: FinalFounderReportSummary | null;
  finalFounderReportPreparing: boolean;
  founderVision: string;
  departments: DepartmentSummary[];
  draft: string;
  founderDecisions: FounderDecisionSummary[];
  humanActions: HumanActionSummary[];
  intakes: CeoIntakeSummary[];
  keyResults: KeyResultSummary[];
  objectives: ObjectiveSummary[];
  taskCompletionEvents: TaskCompletionEventSummary[];
  onCreateCeoReviewDecision?: DepartmentWorkspaceProps["onCreateCeoReviewDecision"];
  onResolveFounderDecision?: DepartmentWorkspaceProps["onResolveFounderDecision"];
  onConfirmHumanAction?: DepartmentWorkspaceProps["onConfirmHumanAction"];
  onDraftChange: (value: string) => void;
  onSelectDepartment: (departmentId: string) => void;
  onSubmit?: (body: string) => Promise<void> | void;
  pendingItems: CeoPendingItem[];
  proof: ProofSummary[];
  businessArtifacts: BusinessArtifactSummary[];
  tasks: TaskSummary[];
  visionGaps: VisionGapSummary[];
  waitStates: WaitStateSummary[];
}) {
  const { language, t } = useLanguage();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [highlightedOfficeItemId, setHighlightedOfficeItemId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // The founder's last visit to CEO Office, read once per company before this render's writes so the
  // "what's new" comparison is stable while the view is open; the visit is then recorded for next
  // time. Storage failures degrade to `null` — nothing is marked new.
  const [outcomesLastSeen, setOutcomesLastSeen] = useState<string | null>(null);
  useEffect(() => {
    setOutcomesLastSeen(readOutcomesLastSeen(companyId));
    writeOutcomesLastSeen(companyId, new Date().toISOString());
  }, [companyId]);
  const selectedPendingItem = pendingItems.find((item) => item.task.id === selectedTaskId) ?? null;
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const departmentsById = useMemo(() => new Map(departments.map((department) => [department.id, department])), [departments]);
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
      <CeoExecutiveOverview
        ceoAttentionRollups={ceoAttentionRollups}
        companyTaskCount={tasks.length}
        founderVision={founderVision}
        outcomesLastSeen={outcomesLastSeen}
        departmentsById={departmentsById}
        humanActions={humanActions}
        objectives={objectives}
        tasksById={tasksById}
        visionGaps={visionGaps}
        waitStates={waitStates}
      />
      <CeoPendingQueue
        items={pendingItems}
        onViewItem={(item) => {
          setHighlightedOfficeItemId(item.officeItem?.id ?? null);
          setSelectedTaskId(item.type === "review" || item.type === "approval_request" ? item.task.id : null);
          setSuccessMessage(null);
        }}
        successMessage={successMessage}
      />
      <CeoOfficeTimeline
        artifactsByTask={artifactsByTask}
        companyLocale={companyLocale}
        departmentsById={departmentsById}
        highlightedItemId={highlightedOfficeItemId}
        items={ceoOfficeItems}
        onViewTaskDetail={(taskId) => {
          setHighlightedOfficeItemId(null);
          setSelectedTaskId(taskId);
          setSuccessMessage(null);
        }}
        outcomesLastSeen={outcomesLastSeen}
        proofsByTask={proofsByTask}
        tasksById={tasksById}
      />
      <FinalFounderReportPanel
        companyLocale={companyLocale}
        report={finalFounderReport}
        preparing={finalFounderReportPreparing}
        outcomesLastSeen={outcomesLastSeen}
      />
      <CeoOutcomesView
        departmentsById={departmentsById}
        founderDecisions={founderDecisions}
        keyResults={keyResults}
        objectives={objectives}
        onResolveFounderDecision={onResolveFounderDecision}
        outcomesLastSeen={outcomesLastSeen}
        taskCompletionEvents={taskCompletionEvents}
        tasksById={tasksById}
      />
      <CeoIntakeFlows intakes={intakes} />
      <HumanActionPanel actions={humanActions} onConfirm={onConfirmHumanAction} title={t("department.humanActions")} />
      <WaitStatePanel title={t("department.waitStates")} waitStates={waitStates} />
      {selectedPendingItem ? (
        <CeoTaskReviewDetail
          item={selectedPendingItem}
          onDecision={handleDecision}
          proofs={proofsByTask.get(selectedPendingItem.task.id) ?? []}
          businessArtifacts={artifactsByTask.get(selectedPendingItem.task.id) ?? []}
        />
      ) : null}
      <CeoBlueprintSummary
        departments={departments}
        founderDecisions={founderDecisions}
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

/** How many of the most recent outcome-carrying Task Completion Events the Outcomes view shows. */
const RECENT_OUTCOME_LIMIT = 12;

type OutcomeGroup = {
  key: string;
  label: string;
  priority: number;
  events: TaskCompletionEventSummary[];
};

function hasOutcomeSummary(event: TaskCompletionEventSummary): boolean {
  const text = event.outcomeSummaryText;
  if (!text) {
    return false;
  }
  return Boolean((text.en && text.en.trim()) || (text.zh && text.zh.trim()));
}

function groupOutcomesByObjective(
  events: TaskCompletionEventSummary[],
  keyResults: KeyResultSummary[],
  objectives: ObjectiveSummary[],
  ungroupedLabel: string,
  language: "en" | "zh",
): OutcomeGroup[] {
  const keyResultsById = new Map(keyResults.map((keyResult) => [keyResult.id, keyResult]));
  const objectivesById = new Map(objectives.map((objective) => [objective.id, objective]));
  const groups = new Map<string, OutcomeGroup>();

  for (const event of events) {
    const keyResult = event.keyResultId ? keyResultsById.get(event.keyResultId) : undefined;
    const objective = keyResult ? objectivesById.get(keyResult.objectiveId) : undefined;
    const key = objective?.id ?? "__ungrouped__";
    const existing = groups.get(key);
    if (existing) {
      existing.events.push(event);
      continue;
    }
    groups.set(key, {
      key,
      label: objective ? resolveLocalizedValue(objective.titleText, language, objective.title) : ungroupedLabel,
      priority: objective?.priority ?? Number.MAX_SAFE_INTEGER,
      events: [event],
    });
  }

  return [...groups.values()].sort((a, b) => a.priority - b.priority);
}

/**
 * Business-language read of a Task Completion Event's `dependencyImpact`. The server serializes it as
 * `{ updatedTasks: [{ taskId, status }], errors }` on an acceptance cascade and `{ blockedTaskIds }`
 * on a non-acceptance outcome (see `businessAcceptance.ts` / `scheduler.ts`).
 */
function outcomeDependencyImpact(
  event: TaskCompletionEventSummary,
  t: ReturnType<typeof useLanguage>["t"],
): string {
  if (event.outcome === "awaiting_founder_decision") {
    return t("department.outcomeAwaitingDecision");
  }
  const bag = event.dependencyImpact;
  const record = bag && typeof bag === "object" && !Array.isArray(bag) ? (bag as Record<string, unknown>) : {};

  const unblocked = Array.isArray(record.updatedTasks)
    ? record.updatedTasks.filter(
        (entry) =>
          entry != null &&
          typeof entry === "object" &&
          (entry as { status?: unknown }).status === "queued",
      ).length
    : 0;
  if (unblocked > 0) {
    return `${t("department.outcomeUnblocks")} (${unblocked})`;
  }

  const blocked = Array.isArray(record.blockedTaskIds)
    ? record.blockedTaskIds.filter((entry) => typeof entry === "string").length
    : 0;
  if (blocked > 0) {
    return `${t("department.outcomeHolds")} (${blocked})`;
  }

  return t("department.outcomeNoImpact");
}

function formatDecisionKind(kind: string, t: ReturnType<typeof useLanguage>["t"]): string {
  switch (kind) {
    case "target_market":
      return t("department.decisionKindTargetMarket");
    case "product_direction":
      return t("department.decisionKindProductDirection");
    case "mvp_type":
      return t("department.decisionKindMvpType");
    case "pricing_model":
      return t("department.decisionKindPricingModel");
    case "launch_target":
      return t("department.decisionKindLaunchTarget");
    default:
      return formatCodeLabel(kind);
  }
}

const FINAL_REPORT_CLASSIFICATION_KEY = {
  achieved: "department.finalReportClassificationAchieved",
  stalled: "department.finalReportClassificationStalled",
  waiting: "department.finalReportClassificationWaiting",
} as const;

const FINAL_REPORT_CLASSIFICATION_TONE = {
  achieved: "signal",
  stalled: "danger",
  waiting: "default",
} as const;

/**
 * The Final Founder Report, pinned above the Outcomes view when an `isCurrent` report exists. Shows
 * the classification prominently, then the six localized-text sections, using existing retro
 * primitives. Sections are authored in the company canonical locale (ADR 0013 → single canonical
 * locale), so they render through `makeLineResolver` with the visible "untranslated" marker when
 * that locale value is absent — not the active Interface Locale.
 */
function FinalFounderReportPanel({
  companyLocale,
  report,
  preparing = false,
  outcomesLastSeen = null,
}: {
  companyLocale: Locale;
  report: FinalFounderReportSummary | null;
  preparing?: boolean;
  outcomesLastSeen?: string | null;
}) {
  const { t } = useLanguage();

  if (!report) {
    if (!preparing) {
      return null;
    }
    return (
      <RetroPanel
        className="ceo-final-founder-report ceo-final-founder-report--preparing"
        icon={<ClipboardCheck size={18} aria-hidden="true" />}
        title={t("department.finalFounderReport")}
        aria-label={t("department.finalFounderReport")}
      >
        <p className="ceo-final-founder-report__preparing muted">{t("department.finalReportPreparing")}</p>
      </RetroPanel>
    );
  }

  const sections = report.sections;
  // The same founder-facing line resolver the timeline uses: it renders the visible "untranslated"
  // marker (and logs) when the company-locale value is absent, rather than silently falling back to
  // another locale (ADR 0013 → single canonical locale; spec Decision 2).
  const line = makeLineResolver(companyLocale, t);

  return (
    <RetroPanel
      className="ceo-final-founder-report"
      icon={<ClipboardCheck size={18} aria-hidden="true" />}
      title={t("department.finalFounderReport")}
      aria-label={t("department.finalFounderReport")}
    >
      <p className="ceo-final-founder-report__classification">
        <RetroBadge tone={FINAL_REPORT_CLASSIFICATION_TONE[report.classification]}>
          {t(FINAL_REPORT_CLASSIFICATION_KEY[report.classification])}
        </RetroBadge>
        <UnseenBadge createdAt={report.createdAt} lastSeen={outcomesLastSeen} />
      </p>
      <VideotexKeyValue
        items={[
          { label: t("department.finalReportVision"), value: line(sections.vision) },
          { label: t("department.finalReportActualResult"), value: line(sections.actualResult) },
          { label: t("department.finalReportGoalFit"), value: line(sections.goalFit) },
          { label: t("department.finalReportRemainingGaps"), value: line(sections.remainingGaps) },
          { label: t("department.finalReportNextStep"), value: line(sections.recommendedNextStep) },
        ]}
      />
      <section
        className="ceo-final-founder-report__departments"
        aria-label={t("department.finalReportDepartmentContributions")}
      >
        <h3>{t("department.finalReportDepartmentContributions")}</h3>
        {sections.departmentContributions.map((contribution, index) => (
          <p key={index}>{line(contribution)}</p>
        ))}
      </section>
    </RetroPanel>
  );
}

/**
 * A localized line resolver bound to the company canonical locale (ADR 0013 → single canonical
 * locale). Used by both the CEO Office Timeline and the Final Founder Report panel. When the
 * company-locale value is absent it returns a visible "untranslated" marker and logs the gap, rather
 * than silently falling back to another locale — the founder should see it as a gap, not the intended
 * content (spec Decision 2). A field that is simply not present (`null`) returns "" so a caller's
 * `|| t("department.none")` fallback wins.
 */
type LineResolver = (text: LocalizedText | null | undefined) => string;

function makeLineResolver(companyLocale: Locale, t: TranslateFn): LineResolver {
  return (text) => {
    if (!text) {
      return "";
    }
    const value = text[companyLocale];
    if (value && value.trim().length > 0) {
      return value;
    }
    console.warn(
      `[CeoOffice] localized field is missing the company locale "${companyLocale}"; available locales: ${
        Object.keys(text).join(", ") || "none"
      }`,
    );
    return t("department.timelineUntranslated");
  };
}

// The type tag carries semantic weight: these three are the cards that need a founder or CEO move,
// so they render with an accent stripe; every other type renders quiet (spec User Story 15).
const ACTION_STATE_TIMELINE_TYPES = new Set<CeoOfficeItemSummary["type"]>([
  "decision_request",
  "approval_request",
  "blocked_issue",
]);

// Largest-unit relative time ("2 hours ago", "3 天前"), so a card reads like a broadcast feed.
const RELATIVE_TIME_DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

function formatTimelineRelativeTime(iso: string, language: "en" | "zh"): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    return iso;
  }
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  let duration = (timestamp - Date.now()) / 1000;
  for (const division of RELATIVE_TIME_DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return iso;
}

/**
 * Everything the card and modal need to turn one timeline item into founder-facing text. The CEO
 * Office timeline is the founder's broadcast surface, so every value in it is resolved against the
 * company canonical locale (ADR 0013) — never the dashboard language toggle, which governs chrome
 * only. `line` is for agent-authored prose: it shows the visible "untranslated" marker when the
 * company-locale value is missing. `localize` is for blueprint-authored names and titles: it falls
 * back to the other locale and then the canonical string rather than showing a marker as a headline.
 */
type TimelineRenderContext = {
  locale: Locale;
  line: LineResolver;
  localize: (text: LocalizedText | null | undefined, fallback: string) => string;
  t: TranslateFn;
  tasksById: Map<string, TaskSummary>;
};

type TimelineItemView = {
  /** The one key line a summary card leads with: the point of the item. */
  keyLine: string;
  /** The full key-value detail, shown only inside the modal. */
  rows: Array<{ label: string; value: string }>;
};

/**
 * The single place each timeline item's key line and detail rows are defined, so the card and the
 * modal never drift. The Decision card leads with the briefing; options and rationale are secondary
 * (spec). `execution_report` conclusion falls back to the older `outcome_summary` compatibility text;
 * the projection only emits the item when one of those carries a body, so there is always a key line.
 */
function timelineItemView(item: CeoOfficeItemSummary, ctx: TimelineRenderContext): TimelineItemView {
  const { line, t, tasksById, locale } = ctx;
  const tasks = (ids: string[]) => formatTimelineTasks(ids, tasksById, locale, t);
  const none = t("department.none");
  switch (item.type) {
    case "task_brief":
      return {
        keyLine: line(item.data.purpose),
        rows: [
          { label: t("department.timelinePurposeSource"), value: formatTaskBriefPurposeSource(item.data.purposeSource, t) },
          { label: t("department.timelineObjective"), value: line(item.data.objectiveTitle) || none },
          { label: t("department.timelineKeyResult"), value: line(item.data.keyResultTitle) || none },
          { label: t("department.timelineMetric"), value: item.data.keyResultMetricName ?? none },
          { label: t("department.timelineTarget"), value: line(item.data.keyResultTargetValue) || none },
          { label: t("department.timelineDependencies"), value: tasks(item.data.dependsOnTaskIds) },
        ],
      };
    case "execution_report":
      return {
        keyLine: line(item.data.conclusion) || line(item.data.summaryFallback) || none,
        rows: [
          { label: t("department.timelineVisionImpact"), value: line(item.data.visionImpact) || none },
          { label: t("department.timelineRemainingGap"), value: line(item.data.remainingGap) || formatTimelineGaps(item.data.remainingGaps, none) },
          { label: t("department.timelineRecommendation"), value: line(item.data.recommendation) || formatTimelineNextSteps(item.data.recommendedNextSteps, none) },
        ],
      };
    case "decision_request":
      return {
        keyLine: item.data.briefing || item.data.rationale || none,
        rows: [
          { label: t("department.timelineBriefing"), value: item.data.briefing || none },
          { label: t("department.founderDecisionKind"), value: formatDecisionKind(item.data.decisionKind, t) },
          { label: t("department.status"), value: formatTimelineStatus(item.data.status, t) },
          { label: t("department.timelineRationale"), value: item.data.rationale || none },
          { label: t("department.timelineChosenOption"), value: item.data.resolvedOption ?? none },
          { label: t("department.blockedTasks"), value: tasks(item.data.blockedTaskIds) },
        ],
      };
    case "approval_request":
      return {
        keyLine: t("department.timelineApprovalRequestBody"),
        rows: [{ label: t("department.status"), value: formatTimelineStatus(item.data.status, t) }],
      };
    case "decision_resolution":
      return {
        keyLine: line(item.data.note) || item.data.chosenOption || formatCompletionOutcome(item.data.outcome, t),
        rows: [
          { label: t("department.timelineResolutionOutcome"), value: formatCompletionOutcome(item.data.outcome, t) },
          { label: t("department.timelineChosenOption"), value: item.data.chosenOption ?? none },
          { label: t("department.timelineDecisionRequest"), value: item.data.requestItemId },
        ],
      };
    case "human_action":
      return {
        keyLine: line(item.data.label),
        rows: [
          { label: t("department.status"), value: formatTimelineStatus(item.data.status, t) },
          { label: t("department.humanActionConfirmation"), value: formatTimelineTextList(item.data.confirmationRequirements, t) },
          { label: t("department.blockedTasks"), value: tasks(item.data.blockedTaskIds) },
          { label: t("department.timelineVerifiedAt"), value: item.data.verifiedAt ?? none },
        ],
      };
    case "wait_state":
      return {
        keyLine: line(item.data.reason),
        rows: [
          { label: t("department.status"), value: formatTimelineStatus(item.data.status, t) },
          { label: t("department.waitStateNextCheck"), value: item.data.nextCheckAt },
          { label: t("department.waitStateAffectedTasks"), value: tasks(item.data.affectedTaskIds) },
        ],
      };
    case "blocked_issue":
      return {
        keyLine: line(item.data.reason),
        rows: [
          { label: t("department.status"), value: formatTimelineStatus(item.data.status, t) },
          { label: t("department.blockedTasks"), value: tasks(item.data.affectedTaskIds) },
        ],
      };
    case "stage_change":
      return {
        keyLine: line(item.data.summary),
        rows: [
          { label: t("department.timelineRecommendation"), value: line(item.data.recommendedNextAction) },
          { label: t("department.completedTasks"), value: tasks(item.data.affectedTaskIds) },
        ],
      };
    case "final_report":
      return {
        keyLine: line(item.data.sections.actualResult),
        rows: [
          { label: t("department.finalFounderReport"), value: item.data.isCurrent ? t("department.timelineCurrentReport") : t("department.timelineSupersededReport") },
          { label: t("department.finalReportVision"), value: line(item.data.sections.vision) },
          { label: t("department.finalReportGoalFit"), value: line(item.data.sections.goalFit) },
          { label: t("department.finalReportRemainingGaps"), value: line(item.data.sections.remainingGaps) },
          { label: t("department.finalReportNextStep"), value: line(item.data.sections.recommendedNextStep) },
        ],
      };
  }
}

/** The card / modal meta line: type tag · department · time. `relative` picks the time format. */
function TimelineItemMeta({
  departmentsById,
  item,
  locale,
  relative,
  t,
}: {
  departmentsById: Map<string, DepartmentSummary>;
  item: CeoOfficeItemSummary;
  locale: Locale;
  relative: boolean;
  t: TranslateFn;
}) {
  const department = item.departmentId ? departmentsById.get(item.departmentId) : null;
  return (
    <span className="ceo-office-timeline__meta">
      <span>{formatCeoOfficeItemType(item.type, t)}</span>
      {department ? <span>{departmentName(department, locale)}</span> : null}
      <span>{relative ? formatTimelineRelativeTime(item.occurredAt, locale) : new Date(item.occurredAt).toLocaleString(locale)}</span>
    </span>
  );
}

/**
 * CEO Office reads as a broadcast station: each timeline item is a summary card (type tag +
 * department + relative time + title + one key line), newest at the bottom pushing history up.
 * Clicking a card opens {@link CeoOfficeItemModal} with the full detail, options, and evidence.
 * Action-bearing cards render with an accent stripe; a newly arrived card briefly highlights
 * (CSS animation, suppressed under `prefers-reduced-motion`).
 */
function CeoOfficeTimeline({
  artifactsByTask,
  companyLocale,
  departmentsById,
  highlightedItemId,
  items,
  onViewTaskDetail,
  outcomesLastSeen,
  proofsByTask,
  tasksById,
}: {
  artifactsByTask: Map<string, BusinessArtifactSummary[]>;
  companyLocale: Locale;
  departmentsById: Map<string, DepartmentSummary>;
  highlightedItemId: string | null;
  items: CeoOfficeItemSummary[];
  onViewTaskDetail: (taskId: string) => void;
  outcomesLastSeen: string | null;
  proofsByTask: Map<string, ProofSummary[]>;
  tasksById: Map<string, TaskSummary>;
}) {
  const { t } = useLanguage();
  const ctx: TimelineRenderContext = {
    locale: companyLocale,
    line: makeLineResolver(companyLocale, t),
    localize: (text, fallback) => resolveLocalizedValue(text, companyLocale, fallback),
    t,
    tasksById,
  };
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const visibleItems = [...items].sort(compareCeoOfficeTimelineItems);
  const activeItem = activeItemId ? visibleItems.find((item) => item.id === activeItemId) ?? null : null;

  return (
    <RetroPanel
      className="ceo-office-timeline"
      icon={<ListChecks size={18} aria-hidden="true" />}
      title={t("department.ceoOfficeTimeline")}
      aria-label={t("department.ceoOfficeTimeline")}
    >
      {visibleItems.length === 0 ? <p className="muted">{t("department.noCeoOfficeTimeline")}</p> : null}
      {visibleItems.map((item) => {
        const classes = [
          "ceo-outcome",
          "ceo-office-timeline__item",
          ACTION_STATE_TIMELINE_TYPES.has(item.type)
            ? "ceo-office-timeline__item--action"
            : "ceo-office-timeline__item--quiet",
          item.id === highlightedItemId ? "ceo-office-timeline__item--highlighted" : "",
          // "Newly arrived" = arrived since the founder's last visit; the highlight is a one-shot CSS
          // animation (see styles.css), suppressed under `prefers-reduced-motion` (spec User Story 14).
          isUnseenSince(item.occurredAt, outcomesLastSeen) ? "ceo-office-timeline__item--new" : "",
        ].filter(Boolean).join(" ");
        return (
          <article
            aria-current={item.id === highlightedItemId ? "true" : undefined}
            className={classes}
            key={item.id}
          >
            <button
              aria-label={t("department.timelineOpenCard")
                .replace("{type}", formatCeoOfficeItemType(item.type, t))
                .replace("{title}", ctx.localize(item.titleText, item.title))}
              className="ceo-office-timeline__card"
              onClick={() => setActiveItemId(item.id)}
              type="button"
            >
              <span className="ceo-office-timeline__meta-row">
                <TimelineItemMeta departmentsById={departmentsById} item={item} locale={ctx.locale} relative t={t} />
                <UnseenBadge createdAt={item.occurredAt} lastSeen={outcomesLastSeen} />
              </span>
              <h4 className="ceo-office-timeline__title">{ctx.localize(item.titleText, item.title)}</h4>
              <span className="ceo-office-timeline__key-line">{timelineItemView(item, ctx).keyLine}</span>
              {item.type === "task_brief" ? <TaskBriefCardLines ctx={ctx} data={item.data} /> : null}
            </button>
          </article>
        );
      })}
      {activeItem ? (
        <CeoOfficeItemModal
          businessArtifacts={activeItem.taskId ? artifactsByTask.get(activeItem.taskId) ?? [] : []}
          ctx={ctx}
          departmentsById={departmentsById}
          item={activeItem}
          onClose={() => setActiveItemId(null)}
          onViewTaskDetail={(taskId) => {
            setActiveItemId(null);
            onViewTaskDetail(taskId);
          }}
          proofs={activeItem.taskId ? proofsByTask.get(activeItem.taskId) ?? [] : []}
        />
      ) : null}
    </RetroPanel>
  );
}

/** The `task_brief` card is one announcement: objective / key result on a line, then dependency titles. */
function TaskBriefCardLines({
  ctx,
  data,
}: {
  ctx: TimelineRenderContext;
  data: Extract<CeoOfficeItemSummary, { type: "task_brief" }>["data"];
}) {
  const objectiveAndKeyResult = [ctx.line(data.objectiveTitle), ctx.line(data.keyResultTitle)].filter(Boolean).join(" / ");
  const dependencies = data.dependsOnTaskIds.length > 0
    ? formatTimelineTasks(data.dependsOnTaskIds, ctx.tasksById, ctx.locale, ctx.t)
    : "";
  return (
    <>
      {objectiveAndKeyResult ? <span className="ceo-office-timeline__sub">{objectiveAndKeyResult}</span> : null}
      {dependencies ? (
        <span className="ceo-office-timeline__sub">{`${ctx.t("department.timelineDependencies")}: ${dependencies}`}</span>
      ) : null}
    </>
  );
}

/**
 * The full detail behind a summary card: the key-value table, options, and a collapsed evidence
 * section modelled on `ceo-task-review-detail`, plus a "View task detail" affordance. No new route
 * (spec Decision 3).
 */
function CeoOfficeItemModal({
  businessArtifacts,
  ctx,
  departmentsById,
  item,
  onClose,
  onViewTaskDetail,
  proofs,
}: {
  businessArtifacts: BusinessArtifactSummary[];
  ctx: TimelineRenderContext;
  departmentsById: Map<string, DepartmentSummary>;
  item: CeoOfficeItemSummary;
  onClose: () => void;
  onViewTaskDetail: (taskId: string) => void;
  proofs: ProofSummary[];
}) {
  const { locale, t } = ctx;
  const headingId = useId();
  const view = timelineItemView(item, ctx);
  const hasEvidence = Boolean(item.taskId) && (proofs.length > 0 || businessArtifacts.length > 0);

  return (
    <RetroDialog className="ceo-timeline-modal" labelledBy={headingId} onClose={onClose}>
      <header className="ceo-timeline-modal__head">
        <TimelineItemMeta departmentsById={departmentsById} item={item} locale={locale} relative={false} t={t} />
        <RetroButton aria-label={t("department.timelineClose")} onClick={onClose}>
          {t("department.timelineClose")}
        </RetroButton>
      </header>
      <h3 id={headingId}>{ctx.localize(item.titleText, item.title)}</h3>
      <p className="ceo-timeline-modal__key-line">{view.keyLine}</p>
      <VideotexKeyValue items={view.rows} />
      {item.type === "decision_request" ? <TimelineOptions options={item.data.options} /> : null}
      {hasEvidence ? <TimelineEvidence businessArtifacts={businessArtifacts} locale={locale} proofs={proofs} t={t} /> : null}
      {item.taskId ? (
        <div className="ceo-timeline-modal__actions">
          <RetroButton onClick={() => onViewTaskDetail(item.taskId!)}>
            {t("department.timelineViewDetail")}
          </RetroButton>
        </div>
      ) : null}
    </RetroDialog>
  );
}

/**
 * The modal's collapsed evidence section, modelled on the `ceo-task-review-detail` one: the
 * department's submitted Proof, then the current Business Artifact's kind / role / status.
 */
function TimelineEvidence({
  businessArtifacts,
  locale,
  proofs,
  t,
}: {
  businessArtifacts: BusinessArtifactSummary[];
  locale: Locale;
  proofs: ProofSummary[];
  t: TranslateFn;
}) {
  const currentArtifact = businessArtifacts.find((artifact) => artifact.isCurrent) ?? businessArtifacts[0] ?? null;
  return (
    <details className="ceo-timeline-modal__evidence">
      <summary>{t("department.ceoReviewEvidenceValidation")}</summary>
      <h4>{t("department.ceoReviewDepartmentSubmission")}</h4>
      {proofs.length === 0 ? <p className="muted">{t("department.ceoReviewNoProof")}</p> : null}
      {proofs.map((proof) => (
        <article className="ceo-task-review-proof" key={proof.id}>
          <p>{resolveLocalizedValue(proof.summaryText, locale, proof.summary)}</p>
          <p className="muted">{`${formatProofType(proof.type, t)} / ${proof.uri}`}</p>
        </article>
      ))}
      {currentArtifact ? (
        <article className="ceo-task-review-proof">
          <p>{`${formatArtifactKind(currentArtifact.artifactKind, t)} / ${formatArtifactRole(currentArtifact.artifactRole, t)} / ${formatCodeLabel(currentArtifact.artifactSubtype)}`}</p>
          <p className="muted">{`${formatArtifactValidationStatus(currentArtifact.validationStatus, t)} / ${formatArtifactReviewStatus(currentArtifact.reviewStatus, t)}`}</p>
        </article>
      ) : (
        <p className="muted">{t("dashboard.noBusinessArtifacts")}</p>
      )}
    </details>
  );
}

function TimelineOptions({ options }: { options: Extract<CeoOfficeItemSummary, { type: "decision_request" }>["data"]["options"] }) {
  const { t } = useLanguage();
  return (
    <div className="ceo-founder-decision__options">
      {options.map((option) => (
        <article className="ceo-founder-decision__option" key={option.label}>
          <p className="ceo-founder-decision__option-label">
            {option.label}
            {option.recommended ? <RetroBadge tone="signal">{t("department.founderDecisionRecommended")}</RetroBadge> : null}
          </p>
          {option.tradeoffs ? <p className="muted">{option.tradeoffs}</p> : null}
        </article>
      ))}
    </div>
  );
}

const ceoOfficeTimelineOrder: Record<CeoOfficeItemSummary["type"], number> = {
  task_brief: 0,
  execution_report: 1,
  decision_request: 2,
  approval_request: 3,
  human_action: 4,
  wait_state: 5,
  blocked_issue: 6,
  decision_resolution: 7,
  stage_change: 8,
  final_report: 9,
};

function compareCeoOfficeTimelineItems(a: CeoOfficeItemSummary, b: CeoOfficeItemSummary): number {
  return Date.parse(a.occurredAt) - Date.parse(b.occurredAt) ||
    ceoOfficeTimelineOrder[a.type] - ceoOfficeTimelineOrder[b.type] ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function formatCeoOfficeItemType(type: CeoOfficeItemSummary["type"], t: ReturnType<typeof useLanguage>["t"]): string {
  switch (type) {
    case "task_brief":
      return t("department.timelineTaskBrief");
    case "execution_report":
      return t("department.timelineExecutionReport");
    case "decision_request":
      return t("department.timelineDecisionRequest");
    case "approval_request":
      return t("department.timelineApprovalRequest");
    case "decision_resolution":
      return t("department.timelineDecisionResolution");
    case "human_action":
      return t("department.timelineHumanAction");
    case "wait_state":
      return t("department.timelineWaitState");
    case "blocked_issue":
      return t("department.timelineBlockedIssue");
    case "stage_change":
      return t("department.timelineStageChange");
    case "final_report":
      return t("department.timelineFinalReport");
  }
}

function formatTaskBriefPurposeSource(
  source: Extract<CeoOfficeItemSummary, { type: "task_brief" }>["data"]["purposeSource"],
  t: ReturnType<typeof useLanguage>["t"],
): string {
  return source === "department_assessment" ? t("department.timelineDepartmentAssessment") : t("department.timelineTaskDefinition");
}

function formatTimelineGaps(
  gaps: Extract<CeoOfficeItemSummary, { type: "execution_report" }>["data"]["remainingGaps"],
  emptyLabel: string,
): string {
  return gaps.length === 0 ? emptyLabel : gaps.map((gap) => gap.label).join(" ");
}

function formatTimelineNextSteps(
  nextSteps: Extract<CeoOfficeItemSummary, { type: "execution_report" }>["data"]["recommendedNextSteps"],
  emptyLabel: string,
): string {
  return nextSteps.length === 0 ? emptyLabel : nextSteps.map((step) => step.label).join(" ");
}

type TranslateFn = ReturnType<typeof useLanguage>["t"];

/**
 * Task references (dependencies, affected/blocked tasks) render as task titles, never raw IDs
 * (spec User Story 12), resolved in the company canonical locale like the rest of the timeline.
 * Falls back to a localized count only when an ID resolves to no known task.
 */
function formatTimelineTasks(
  taskIds: string[],
  tasksById: Map<string, TaskSummary>,
  locale: Locale,
  t: TranslateFn,
): string {
  if (taskIds.length === 0) {
    return t("department.none");
  }

  const titles = taskIds
    .map((taskId) => {
      const task = tasksById.get(taskId);
      return task ? taskTitle(task, locale) : null;
    })
    .filter((title): title is string => Boolean(title));

  if (titles.length > 0) {
    return titles.join(", ");
  }
  const countKey = taskIds.length === 1 ? "department.timelineTaskCountOne" : "department.timelineTaskCountOther";
  return t(countKey).replace("{count}", String(taskIds.length));
}

/** Free-text requirement lists (not task IDs) — joined, with a localized empty fallback. */
function formatTimelineTextList(values: string[], t: TranslateFn): string {
  return values.length === 0 ? t("department.none") : values.join(", ");
}

// Enum-class timeline values render through translation keys; an unmapped value still de-snakes via
// `formatCodeLabel`, so the timeline never shows raw snake_case (spec User Story 16). The blocked/wait
// deterministic reason strings have a matching bilingual table in `packages/core/src/ceoOffice.ts`.
const TIMELINE_STATUS_KEY: Record<string, TranslationKey> = {
  pending: "department.timelineStatusPending",
  resolved: "department.timelineStatusResolved",
  returned: "department.timelineStatusReturned",
  approved: "department.timelineStatusApproved",
  confirmed: "department.timelineStatusConfirmed",
  waiting: "department.timelineStatusWaiting",
  ready_for_check_in: "department.timelineStatusReadyForCheckIn",
  open: "department.timelineStatusOpen",
};

const TIMELINE_OUTCOME_KEY: Record<string, TranslationKey> = {
  accepted: "department.timelineOutcomeAccepted",
  blocked: "department.timelineOutcomeBlocked",
  failed_to_review: "department.timelineOutcomeFailedToReview",
  needs_replan: "department.timelineOutcomeNeedsReplan",
  awaiting_founder_decision: "department.timelineOutcomeAwaitingFounderDecision",
  resolved: "department.timelineOutcomeResolved",
  approved: "department.timelineOutcomeApproved",
  returned: "department.timelineOutcomeReturned",
};

function translateTimelineCode(value: string, keys: Record<string, TranslationKey>, t: TranslateFn): string {
  const key = keys[value];
  return key ? t(key) : formatCodeLabel(value);
}

function formatTimelineStatus(status: string, t: TranslateFn): string {
  return translateTimelineCode(status, TIMELINE_STATUS_KEY, t);
}

function formatCompletionOutcome(outcome: string, t: TranslateFn): string {
  return translateTimelineCode(outcome, TIMELINE_OUTCOME_KEY, t);
}

function CeoOutcomesView({
  departmentsById,
  founderDecisions,
  keyResults,
  objectives,
  onResolveFounderDecision,
  outcomesLastSeen,
  taskCompletionEvents,
  tasksById,
}: {
  departmentsById: Map<string, DepartmentSummary>;
  founderDecisions: FounderDecisionSummary[];
  keyResults: KeyResultSummary[];
  objectives: ObjectiveSummary[];
  onResolveFounderDecision?: DepartmentWorkspaceProps["onResolveFounderDecision"];
  outcomesLastSeen: string | null;
  taskCompletionEvents: TaskCompletionEventSummary[];
  tasksById: Map<string, TaskSummary>;
}) {
  const { language, t } = useLanguage();
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const pendingDecisions = founderDecisions.filter((decision) => decision.status === "pending");
  const outcomeEventsWithSummary = [...taskCompletionEvents]
    .filter(hasOutcomeSummary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const outcomeEvents = outcomeEventsWithSummary.slice(0, RECENT_OUTCOME_LIMIT);
  const groups = groupOutcomesByObjective(outcomeEvents, keyResults, objectives, t("department.outcomesUngrouped"), language);
  // Count every unseen outcome, not just the recent slice that renders below — the marker is a
  // "there is new activity" cue. A null last-seen never marks anything new (first visits stay quiet).
  const newOutcomeCount = outcomeEventsWithSummary.filter((event) =>
    isUnseenSince(event.createdAt, outcomesLastSeen),
  ).length;

  const taskLabel = (taskId: string): string => {
    const task = tasksById.get(taskId);
    return task ? taskTitle(task, language) : taskId;
  };
  const taskBrief = (taskId: string): string => {
    const task = tasksById.get(taskId);
    return task ? taskDescription(task, language) : "";
  };
  const departmentLabel = (departmentId: string): string => {
    const department = departmentsById.get(departmentId);
    return department ? departmentName(department, language) : departmentId;
  };

  return (
    <section className="ceo-outcomes-view" aria-label={t("department.ceoOutcomes")}>
      <h3>{t("department.ceoOutcomes")}</h3>
      <p className="muted">{t("department.ceoOutcomesNote")}</p>
      {newOutcomeCount > 0 ? (
        <p className="ceo-outcomes-view__new-marker">
          <RetroBadge tone="signal">
            {t("department.ceoOutcomesNewMarker").replace("{count}", String(newOutcomeCount))}
          </RetroBadge>
        </p>
      ) : null}
      {decisionMessage ? <p className="system-message">{decisionMessage}</p> : null}

      {pendingDecisions.length > 0 ? (
        <section className="ceo-outcomes-view__decisions" aria-label={t("department.founderDecisionsPinned")}>
          <h4>{t("department.founderDecisionsPinned")}</h4>
          {pendingDecisions.map((decision) => (
            <CeoFounderDecisionCard
              key={decision.id}
              decision={decision}
              departmentLabel={departmentLabel(decision.departmentId)}
              onResolveFounderDecision={onResolveFounderDecision}
              onResolved={setDecisionMessage}
              taskLabel={taskLabel(decision.taskId)}
            />
          ))}
        </section>
      ) : null}

      {outcomeEvents.length === 0 ? <p className="muted">{t("department.noOutcomes")}</p> : null}
      {groups.map((group) => (
        <section className="ceo-outcomes-view__group" aria-label={group.label} key={group.key}>
          <h4>{group.label}</h4>
          {group.events.map((event) => {
            const brief = taskBrief(event.taskId);
            return (
              <article className="ceo-outcome" key={event.id}>
                <h5>{taskLabel(event.taskId)}</h5>
                {brief ? (
                  <p className="ceo-outcome__brief muted">
                    <span className="ceo-outcome__brief-label">{t("department.outcomeBriefLabel")}</span>{" "}
                    {brief}
                  </p>
                ) : null}
                <p className="ceo-outcome__summary">
                  {resolveLocalizedValue(event.outcomeSummaryText, language, event.outcomeSummaryText?.en ?? "")}
                </p>
                <p className="muted">{outcomeDependencyImpact(event, t)}</p>
              </article>
            );
          })}
        </section>
      ))}
    </section>
  );
}

function CeoFounderDecisionCard({
  decision,
  departmentLabel,
  onResolveFounderDecision,
  onResolved,
  taskLabel,
}: {
  decision: FounderDecisionSummary;
  departmentLabel: string;
  onResolveFounderDecision?: DepartmentWorkspaceProps["onResolveFounderDecision"];
  onResolved: (message: string) => void;
  taskLabel: string;
}) {
  const { t } = useLanguage();
  const [returnReason, setReturnReason] = useState<CeoReviewReturnReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<{ kind: "pick"; option: string } | { kind: "return" } | null>(null);

  const runResolution = async (
    action: { kind: "pick"; option: string } | { kind: "return" },
    input: Parameters<NonNullable<DepartmentWorkspaceProps["onResolveFounderDecision"]>>[0],
    resolvedMessage: (accepted: boolean) => string,
  ) => {
    if (submitting) {
      return;
    }
    setError(null);
    setSubmitting(action);
    try {
      const response = await onResolveFounderDecision?.(input);
      onResolved(resolvedMessage(Boolean(response?.accepted)));
    } catch (resolutionError) {
      setError((resolutionError as Error).message);
    } finally {
      setSubmitting(null);
    }
  };

  const handlePick = (option: string) =>
    runResolution({ kind: "pick", option }, { founderDecisionId: decision.id, chosenOption: option }, (accepted) =>
      accepted ? t("department.founderDecisionResolvedAccepted") : t("department.founderDecisionResolvedPartial"),
    );

  const handleReturn = () => {
    if (!returnReason) {
      setError(t("department.ceoReviewReturnReasonRequired"));
      return;
    }
    void runResolution(
      { kind: "return" },
      {
        founderDecisionId: decision.id,
        action: "return",
        returnReason,
        note: note.trim() || undefined,
      },
      () => t("department.founderDecisionReturned"),
    );
  };

  return (
    <article className="ceo-founder-decision" aria-label={taskLabel}>
      <div className="ceo-founder-decision__header">
        <p className="muted">{departmentLabel}</p>
        <h5>{taskLabel}</h5>
        <VideotexKeyValue
          items={[
            { label: t("department.founderDecisionKind"), value: formatDecisionKind(decision.decisionKind, t) },
            ...(decision.blockedTaskIds.length > 0
              ? [{ label: t("department.founderDecisionBlocking"), value: String(decision.blockedTaskIds.length) }]
              : []),
          ]}
        />
      </div>
      {decision.rationale ? (
        <p className="ceo-founder-decision__rationale">
          <strong>{t("department.founderDecisionRationale")}:</strong> {decision.rationale}
        </p>
      ) : null}
      <div className="ceo-founder-decision__options">
        <h6>{t("department.founderDecisionOptions")}</h6>
        {decision.options.map((option) => (
          <article className="ceo-founder-decision__option" key={option.label}>
            <p className="ceo-founder-decision__option-label">
              {option.label}
              {option.recommended ? (
                <RetroBadge tone="signal">{t("department.founderDecisionRecommended")}</RetroBadge>
              ) : null}
            </p>
            {option.tradeoffs ? (
              <p className="muted">
                {t("department.founderDecisionTradeoffs")}: {option.tradeoffs}
              </p>
            ) : null}
            <RetroButton
              aria-label={`${t("department.founderDecisionPick")}: ${option.label}`}
              aria-busy={submitting?.kind === "pick" && submitting.option === option.label}
              disabled={submitting !== null}
              onClick={() => void handlePick(option.label)}
            >
              {t("department.founderDecisionPick")}
            </RetroButton>
          </article>
        ))}
      </div>
      <div className="ceo-founder-decision__return">
        <CeoReturnReasonFields
          note={note}
          noteLabel={t("department.founderDecisionNote")}
          onNoteChange={setNote}
          onReturnReasonChange={setReturnReason}
          reasonLabel={t("department.founderDecisionReturnReason")}
          returnReason={returnReason}
        />
        <RetroButton aria-busy={submitting?.kind === "return"} disabled={submitting !== null} onClick={handleReturn}>
          {t("department.founderDecisionReturn")}
        </RetroButton>
      </div>
      {error ? <p role="alert" className="warning-message">{error}</p> : null}
    </article>
  );
}

function CeoExecutiveOverview({
  ceoAttentionRollups,
  companyTaskCount,
  departmentsById,
  founderVision,
  humanActions,
  objectives,
  outcomesLastSeen,
  tasksById,
  visionGaps,
  waitStates,
}: {
  ceoAttentionRollups: CeoAttentionRollupSummary[];
  companyTaskCount: number;
  departmentsById: Map<string, DepartmentSummary>;
  founderVision: string;
  humanActions: HumanActionSummary[];
  objectives: ObjectiveSummary[];
  outcomesLastSeen: string | null;
  tasksById: Map<string, TaskSummary>;
  visionGaps: VisionGapSummary[];
  waitStates: WaitStateSummary[];
}) {
  const { t } = useLanguage();
  const blockingTasks = [...tasksById.values()].filter((task) => task.status === "blocked" || task.status === "needs_replan" || task.status === "failed");
  const completedTasks = [...tasksById.values()].filter((task) => task.status === "complete");

  return (
    <section className="ceo-executive-overview" aria-label={t("department.ceoExecutiveOverview")}>
      <h3>{t("department.ceoExecutiveOverview")}</h3>
      {/* The Founder Vision is shown once here, not repeated on every Task Brief card (spec User Story 13). */}
      {founderVision ? (
        <p className="ceo-executive-overview__vision">
          <span className="ceo-executive-overview__label">{t("department.timelineFounderVision")}</span>
          {founderVision}
        </p>
      ) : null}
      <VideotexKeyValue
        items={[
          { label: t("department.objectives"), value: String(objectives.length) },
          { label: t("department.completedTasks"), value: `${completedTasks.length}/${companyTaskCount}` },
          { label: t("department.attentionRollups"), value: String(ceoAttentionRollups.length) },
          { label: t("department.blockedTasks"), value: String(blockingTasks.length) },
        ]}
      />
      <section className="ceo-attention-rollups" aria-label={t("department.attentionRollups")}>
        <h4>{t("department.attentionRollups")}</h4>
        {ceoAttentionRollups.length === 0 ? <p className="muted">{t("department.noAttentionRollups")}</p> : null}
        {ceoAttentionRollups.map((rollup) => {
          // An Objective Stage Change is an achievement, not an alarm — styled apart from the
          // exception rollups and led by an achievement badge rather than the owning department.
          const isObjectiveStageChange = rollup.reasons.includes("goal_stage_change");
          return (
            <article
              className={`ceo-attention-rollup${isObjectiveStageChange ? " ceo-attention-rollup--achievement" : ""}`}
              key={rollup.id}
            >
              <div>
                {isObjectiveStageChange ? (
                  <p>
                    <RetroBadge tone="signal">{t("department.objectiveStageChange")}</RetroBadge>
                    <UnseenBadge createdAt={rollup.createdAt} lastSeen={outcomesLastSeen} />
                  </p>
                ) : (
                  <p>{formatRollupOwner(rollup.ownerDepartmentId, departmentsById)}</p>
                )}
                <h5>{rollup.title}</h5>
                <p className="muted">{rollup.summary}</p>
              </div>
              <VideotexKeyValue
                items={[
                  // An achievement rollup carries no severity / blocker / downstream impact.
                  ...(isObjectiveStageChange
                    ? []
                    : [
                        { label: t("department.rollupSeverity"), value: rollup.severity },
                        { label: t("department.downstreamImpact"), value: formatDepartments(rollup.downstreamDepartmentIds, departmentsById, t("department.none")) },
                        { label: t("department.currentBlocker"), value: rollup.currentBlocker ?? t("department.none") },
                      ]),
                  { label: t("department.recommendedNextAction"), value: rollup.recommendedNextAction },
                ]}
              />
            </article>
          );
        })}
      </section>
      <VideotexLog
        emptyMessage={t("department.noCriticalChains")}
        rows={criticalDependencyRows([...tasksById.values()], departmentsById)}
      />
      <section className="ceo-executive-overview__signal-list" aria-label={t("department.humanActions")}>
        <p className="ceo-executive-overview__label">{t("department.humanActions")}</p>
        <VideotexLog
          emptyMessage={t("department.noHumanActions")}
          rows={humanActions.map((action) => `${formatRollupOwner(action.departmentId, departmentsById)} / ${action.status} / ${action.label}`)}
        />
      </section>
      <section className="ceo-executive-overview__signal-list" aria-label={t("department.waitStates")}>
        <p className="ceo-executive-overview__label">{t("department.waitStates")}</p>
        <VideotexLog
          emptyMessage={t("department.noWaitStates")}
          rows={waitStates.map(
            (waitState) => `${formatRollupOwner(waitState.departmentId, departmentsById)} / ${waitState.status} / ${waitState.label} / ${waitState.nextCheckAt}`,
          )}
        />
      </section>
      <section className="ceo-executive-overview__signal-list" aria-label={t("department.visionGaps")}>
        <p className="ceo-executive-overview__label">{t("department.visionGaps")}</p>
        <VideotexLog
          emptyMessage={t("department.noVisionGaps")}
          rows={visionGaps.map((gap) => `${gap.label} / ${gap.severity} / ${formatRollupOwner(gap.departmentId, departmentsById)}`)}
        />
      </section>
    </section>
  );
}

function formatRollupOwner(departmentId: string, departmentsById: Map<string, DepartmentSummary>): string {
  return departmentsById.get(departmentId)?.name ?? departmentId;
}

function formatDepartments(departmentIds: string[], departmentsById: Map<string, DepartmentSummary>, emptyLabel: string): string {
  if (departmentIds.length === 0) {
    return emptyLabel;
  }

  return departmentIds.map((departmentId) => departmentsById.get(departmentId)?.name ?? departmentId).join(", ");
}

function criticalDependencyRows(tasks: TaskSummary[], departmentsById: Map<string, DepartmentSummary>): string[] {
  return tasks
    .filter((task) => task.taskKind !== "department_subtask")
    .filter((task) => task.status === "blocked" || task.status === "waiting_dependency" || task.status === "needs_replan")
    .map((task) => `${task.title} / ${formatRollupOwner(task.departmentId, departmentsById)} / ${task.dependencyNote ?? task.status}`);
}

function CeoPendingQueue({
  items,
  onViewItem,
  successMessage,
}: {
  items: CeoPendingItem[];
  onViewItem: (item: CeoPendingItem) => void;
  successMessage: string | null;
}) {
  const { language, t } = useLanguage();

  return (
    <section className="ceo-pending-queue" aria-label={t("department.ceoPending")}>
      <h3>{t("department.ceoPending")}</h3>
      <p className="muted">{t("department.ceoPendingNote")}</p>
      {successMessage ? <p className="system-message">{successMessage}</p> : null}
      {items.length === 0 ? <p className="muted">{t("department.noCeoPending")}</p> : null}
      {items.map((item) => (
        <article className="ceo-pending-item" key={item.officeItem?.id ?? item.task.id}>
          <div>
            <p>{formatCeoPendingType(item, t)}</p>
            <h4>{taskTitle(item.task, language)}</h4>
          </div>
          <RetroButton aria-label={`${t("department.viewTask")} ${taskTitle(item.task, language)}`} onClick={() => onViewItem(item)}>
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
  proofs: ProofSummary[];
  businessArtifacts: BusinessArtifactSummary[];
}) {
  const { language, t } = useLanguage();
  const [returnReason, setReturnReason] = useState<CeoReviewReturnReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<"approve" | "return" | null>(null);
  const hasProof = proofs.length > 0;
  const currentArtifact = businessArtifacts.find((artifact) => artifact.isCurrent) ?? businessArtifacts[0] ?? null;
  const hasValidArtifact =
    currentArtifact !== null &&
    currentArtifact.validationStatus === "valid" &&
    currentArtifact.reviewStatus === "unreviewed" &&
    (currentArtifact.artifactKind === "deliverable" || currentArtifact.artifactKind === "final_report");
  const canApprove = hasProof && hasValidArtifact;
  const outcomeSummary = readOutcomeSummary(currentArtifact?.payload);

  const handleApprove = async () => {
    if (!canApprove || submittingAction) {
      return;
    }

    setError(null);
    setSubmittingAction("approve");
    try {
      await onDecision({ taskId: item.task.id, decision: "approve" });
    } catch (decisionError) {
      setError((decisionError as Error).message);
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleReturn = async () => {
    if (submittingAction) {
      return;
    }

    if (!returnReason) {
      setError(t("department.ceoReviewReturnReasonRequired"));
      return;
    }

    setError(null);
    setSubmittingAction("return");
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
      setSubmittingAction(null);
    }
  };

  return (
    <section className="ceo-task-review-detail" aria-label={t("department.ceoTaskReview")}>
      <h3>{t("department.ceoTaskReview")}</h3>
      <p className={canApprove ? "system-message" : "warning-message"}>
        {canApprove ? t("department.ceoReviewCanPass") : t("department.ceoReviewMissingProof")}
      </p>
      <section className="ceo-task-review-detail__outcome">
        <h4>{t("department.ceoReviewOutcomeSummary")}</h4>
        {outcomeSummary ? (
          <p className="ceo-task-review-detail__outcome-text">
            {typeof outcomeSummary === "string"
              ? outcomeSummary
              : resolveLocalizedValue(outcomeSummary, language, outcomeSummary.en ?? "")}
          </p>
        ) : (
          <p className="muted">{t("department.ceoReviewNoOutcomeSummary")}</p>
        )}
      </section>
      <div className="ceo-task-review-detail__grid">
        <section>
          <h4>{t("department.ceoReviewTaskContent")}</h4>
          <p>{taskTitle(item.task, language)}</p>
          {item.task.description ? <p className="muted">{taskDescription(item.task, language)}</p> : null}
        </section>
        <details className="ceo-task-review-detail__evidence">
          <summary>{t("department.ceoReviewEvidenceValidation")}</summary>
          <h4>{t("department.ceoReviewDepartmentSubmission")}</h4>
          {proofs.length === 0 ? <p className="muted">{t("department.ceoReviewNoProof")}</p> : null}
          {proofs.map((proof) => (
            <article className="ceo-task-review-proof" key={proof.id}>
              <p>{resolveLocalizedValue(proof.summaryText, language, proof.summary)}</p>
              <p className="muted">{`${formatProofType(proof.type, t)} / ${proof.uri}`}</p>
            </article>
          ))}
          {currentArtifact ? (
            <article className="ceo-task-review-proof">
              <p>{`${formatArtifactKind(currentArtifact.artifactKind, t)} / ${formatArtifactRole(currentArtifact.artifactRole, t)} / ${formatCodeLabel(currentArtifact.artifactSubtype)}`}</p>
              <p className="muted">{`${formatArtifactValidationStatus(currentArtifact.validationStatus, t)} / ${formatArtifactReviewStatus(currentArtifact.reviewStatus, t)}`}</p>
            </article>
          ) : (
            <p className="muted">{t("dashboard.noBusinessArtifacts")}</p>
          )}
        </details>
        <section>
          <h4>{t("department.ceoReviewRunStatus")}</h4>
          <VideotexKeyValue
            items={[
              { label: t("department.status"), value: formatTaskStatus(item.task, t) },
              { label: t("department.ceoPendingReviewRequestFrom"), value: item.departmentName },
              ...(item.task.executionProfileName ? [{ label: t("department.executionProfile"), value: formatCodeLabel(item.task.executionProfileName) }] : []),
              ...(item.task.effectiveTimeoutMs ? [{ label: t("department.executionBudget"), value: `${Math.round(item.task.effectiveTimeoutMs / 60_000)}m` }] : []),
              ...(item.task.failureReason ? [{ label: t("department.executionIssue"), value: formatTaskFailureReason(item.task.failureReason, t) }] : []),
              ...(item.task.failureMessage ? [{ label: t("department.executionDetail"), value: item.task.failureMessage }] : []),
              ...(item.task.artifactWorkspacePath ? [{ label: t("department.partialOutput"), value: item.task.artifactWorkspacePath }] : []),
            ]}
          />
        </section>
        <section>
          <h4>{t("department.ceoReviewDecision")}</h4>
          <CeoReturnReasonFields
            note={note}
            noteClassName="ceo-task-review-detail__note"
            noteLabel={t("department.ceoReviewNextStepNote")}
            onNoteChange={setNote}
            onReturnReasonChange={setReturnReason}
            reasonLabel={t("department.ceoReviewReturnReason")}
            returnReason={returnReason}
          />
          {error ? <p role="alert" className="warning-message">{error}</p> : null}
          <div className="ceo-task-review-detail__actions">
            {canApprove ? (
              <RetroButton
                aria-busy={submittingAction === "approve"}
                className={submittingAction === "approve" ? "ceo-task-review-detail__action--submitting" : undefined}
                disabled={submittingAction !== null}
                onClick={handleApprove}
              >
                {t("department.ceoReviewApprove")}
              </RetroButton>
            ) : null}
            <RetroButton
              aria-busy={submittingAction === "return"}
              className={submittingAction === "return" ? "ceo-task-review-detail__action--submitting" : undefined}
              disabled={submittingAction !== null}
              onClick={handleReturn}
            >
              {t("department.ceoReviewReturn")}
            </RetroButton>
          </div>
        </section>
      </div>
    </section>
  );
}

function readOutcomeSummary(payload: unknown): LocalizedText | string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const value = record.outcome_summary ?? record.outcomeSummary;
  if (typeof value === "string") {
    return value.trim().length > 0 ? value.trim() : null;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.en === "string" || typeof candidate.zh === "string") {
      return candidate as LocalizedText;
    }
  }
  return null;
}

/**
 * The Review Return Reason select + note textarea, shared by the CEO review detail panel and the
 * Founder Decision return control so the two return forms cannot drift.
 */
function CeoReturnReasonFields({
  note,
  noteClassName,
  noteLabel,
  onNoteChange,
  onReturnReasonChange,
  reasonLabel,
  returnReason,
}: {
  note: string;
  noteClassName?: string;
  noteLabel: string;
  onNoteChange: (value: string) => void;
  onReturnReasonChange: (value: CeoReviewReturnReason | "") => void;
  reasonLabel: string;
  returnReason: CeoReviewReturnReason | "";
}) {
  const { t } = useLanguage();
  const reasonInputId = useId();
  const noteInputId = useId();

  return (
    <>
      <label className="retro-field" htmlFor={reasonInputId}>
        <span>{reasonLabel}</span>
        <select
          id={reasonInputId}
          className="retro-input"
          value={returnReason}
          onChange={(event) => onReturnReasonChange(event.target.value as CeoReviewReturnReason | "")}
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
        <span>{noteLabel}</span>
        <textarea
          id={noteInputId}
          className={noteClassName ? `retro-textarea ${noteClassName}` : "retro-textarea"}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
        />
      </label>
    </>
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
  switch (item.type) {
    case "review":
    case "approval_request":
      return `${t("department.ceoPendingReviewRequestFrom")} ${item.departmentName}`;
    case "decision_request":
      return `${t("department.ceoPendingDecisionRequestFrom")} ${item.departmentName}`;
    case "human_action":
      return `${t("department.ceoPendingHumanActionFrom")} ${item.departmentName}`;
    case "blocked_issue":
      return `${t("department.ceoPendingBlockedIssueFrom")} ${item.departmentName}`;
    case "wait_state":
      return `${t("department.ceoPendingWaitStateFrom")} ${item.departmentName}`;
    case "task_brief":
    case "execution_report":
    case "decision_resolution":
    case "stage_change":
    case "final_report":
      return item.departmentName;
  }
}

function CeoBlueprintSummary({
  departments,
  founderDecisions,
  objectives,
  onSelectDepartment,
  onViewPendingTask,
  pendingItems,
  tasks,
}: {
  departments: DepartmentSummary[];
  founderDecisions: FounderDecisionSummary[];
  objectives: ObjectiveSummary[];
  onSelectDepartment: (departmentId: string) => void;
  onViewPendingTask: (taskId: string) => void;
  pendingItems: CeoPendingItem[];
  tasks: TaskSummary[];
}) {
  const { language, t } = useLanguage();

  return (
    <section className="ceo-blueprint-summary" aria-label={t("department.ceoBlueprintSummary")}>
      <div>
        <h3>{t("department.objectives")}</h3>
        <VideotexLog
          emptyMessage={t("department.noObjectives")}
          rows={objectives.map((objective) => resolveLocalizedValue(objective.titleText, language, objective.title))}
        />
      </div>
      <div>
        <h3>{t("department.taskRelationships")}</h3>
        <CeoTaskDependencyGraph
          departments={departments}
          founderDecisions={founderDecisions}
          onSelectDepartment={onSelectDepartment}
          onViewPendingTask={onViewPendingTask}
          pendingItems={pendingItems}
          tasks={tasks}
        />
      </div>
    </section>
  );
}

/** Downstream task ids held by an unresolved Founder Decision on an upstream deliverable. */
function waitingOnDecisionTaskIdSet(founderDecisions: FounderDecisionSummary[]): Set<string> {
  return new Set(
    founderDecisions
      .filter((decision) => decision.status === "pending")
      .flatMap((decision) => decision.blockedTaskIds),
  );
}

function CeoTaskDependencyGraph({
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

function CeoIntakeFlows({ intakes }: { intakes: CeoIntakeSummary[] }) {
  const { language, t } = useLanguage();

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
  const { language, t } = useLanguage();

  return (
    <section className="department-role-summary" aria-label={t("department.role")}>
      <h3>{t("department.role")}</h3>
      <p>{departmentName(department, language)}</p>
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
      {agent?.capabilities.length ? <p className="muted">{`${t("department.agentCapabilities")}: ${agent.capabilities.map((capability) => formatCapability(capability, t)).join(" / ")}`}</p> : null}
    </section>
  );
}

function DepartmentLeaderReport({
  departmentId,
  departmentName,
  draft,
  humanActions,
  waitStates,
  onConfirmHumanAction,
  onDraftChange,
  onRecoverTask,
  onRefreshTask,
  onViewCeoPending,
  pendingItems,
  progressEvents,
  responsibility,
  tasks,
}: {
  departmentId: string;
  departmentName: string;
  draft: string;
  humanActions: HumanActionSummary[];
  waitStates: WaitStateSummary[];
  onConfirmHumanAction?: DepartmentWorkspaceProps["onConfirmHumanAction"];
  onDraftChange: (value: string) => void;
  onRefreshTask?: DepartmentWorkspaceProps["onRefreshTask"];
  onRecoverTask?: DepartmentWorkspaceProps["onRecoverTask"];
  onViewCeoPending: () => void;
  pendingItems: CeoPendingItem[];
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
      <HumanActionPanel actions={humanActions} onConfirm={onConfirmHumanAction} title={t("department.humanActions")} />
      <WaitStatePanel title={t("department.waitStates")} waitStates={waitStates} />
      <DepartmentProgressFlows
        departmentId={departmentId}
        onRefreshTask={onRefreshTask}
        onRecoverTask={onRecoverTask}
        onViewCeoPending={onViewCeoPending}
        pendingItems={pendingItems}
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
  pendingItems,
  progressEvents,
  tasks,
}: {
  departmentId: string;
  onRefreshTask?: DepartmentWorkspaceProps["onRefreshTask"];
  onRecoverTask?: DepartmentWorkspaceProps["onRecoverTask"];
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
                        onRecoverTask={onRecoverTask}
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
  const baseEvents = compactProgressEvents(events ?? fallbackProgressEvents(task));
  const derivedEvent = deriveCurrentTaskProgressEvent(task);

  if (!derivedEvent || progressEventsAlreadyReflectTaskStatus(baseEvents, task)) {
    return baseEvents;
  }

  return [...baseEvents, derivedEvent];
}

function compactProgressEvents(events: TaskProgressEventSummary[]): TaskProgressEventSummary[] {
  const latestEventIdBySubject = new Map<string, string>();

  for (const event of events) {
    if (event.subjectTaskId) {
      latestEventIdBySubject.set(event.subjectTaskId, event.id);
    }
  }

  return events.filter((event) => !event.subjectTaskId || latestEventIdBySubject.get(event.subjectTaskId) === event.id);
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
    labelText: {
      en: `Task (${resolveLocalizedValue(task.titleText, "en", task.title)}) ${task.status}`,
      zh: `任务（${resolveLocalizedValue(task.titleText, "zh", task.title)}）${task.status}`,
    },
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

    if (task.status === "complete") {
      return event.step === "complete" || event.status === "complete";
    }

    if (task.status === "blocked" || task.status === "failed" || task.status === "needs_replan") {
      return event.step === "blocked" && event.status === "blocked";
    }

    if (event.step !== "executing") {
      return false;
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
      labelText: { en: "Received CEO task", zh: "已接收 CEO 任务" },
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
      labelText:
        task.status === "queued"
          ? { en: "Assessment pending", zh: "评估待开始" }
          : { en: "Assessment complete", zh: "评估完成" },
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
      labelText: {
        en: `Task 1 (${resolveLocalizedValue(task.titleText, "en", task.title)}) ${task.status}`,
        zh: `任务 1（${resolveLocalizedValue(task.titleText, "zh", task.title)}）${task.status}`,
      },
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

function formatProgressLabel(
  event: TaskProgressEventSummary,
  task: TaskSummary,
  language: "en" | "zh",
  t: ReturnType<typeof useLanguage>["t"],
  hasCeoPendingItem: boolean,
): string {
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
      return formatReviewProgressLabel(task, language, t, hasCeoPendingItem);
    case "complete":
      return t("department.flowComplete");
    case "blocked":
      if (event.label.startsWith("CEO Office returned")) {
        const label = resolveLocalizedValue(event.labelText, language, event.label);
        const detail = event.detail ? resolveLocalizedValue(event.detailText, language, event.detail) : null;
        return detail ? `${label} ${detail}` : label;
      }
      return t("department.flowBlocked");
    case "needs_ceo_reassignment":
      return t("department.flowNeedsCeoReassignment");
    case "executing":
      return formatExecutingProgressLabel(event.label, task, language, t, hasCeoPendingItem);
  }
}

function formatExecutingProgressLabel(
  label: string,
  task: TaskSummary,
  language: "en" | "zh",
  t: ReturnType<typeof useLanguage>["t"],
  hasCeoPendingItem: boolean,
): string {
  const match = label.match(/^Task(?: \d+)? \((.+)\) ([a-z_]+)$/i);
  if (!match) {
    return label;
  }

  const [, , status] = match;
  if (status === "review") {
    return formatReviewProgressLabel(task, language, t, hasCeoPendingItem);
  }

  return `${t("department.flowTask")} (${taskTitle(task, language)}) ${formatFlowTaskStatus(task.status, t)}`;
}

function formatReviewProgressLabel(
  task: TaskSummary,
  language: "en" | "zh",
  t: ReturnType<typeof useLanguage>["t"],
  hasCeoPendingItem: boolean,
): string {
  if (task.status === "review" && hasCeoPendingItem) {
    return formatCeoReviewSubmittedLabel(taskTitle(task, language), t);
  }

  return `${t("department.flowTask")} (${taskTitle(task, language)}) ${formatFlowTaskStatus(task.status, t)}`;
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
  const { language, t } = useLanguage();
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
  const { language, t } = useLanguage();
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
          {taskTitle(task, language)} / {formatTaskStatus(task, t)}
        </RetroBadge>
      ) : null}
      {canRefresh ? (
        <RetroButton
          aria-label={`${t("department.refreshTask")} ${taskTitle(task, language)}`}
          icon={<RefreshCcw size={14} aria-hidden="true" />}
          onClick={handleRefresh}
        >
          {t("department.refreshTask")}
        </RetroButton>
      ) : null}
      {canRecover ? (
        <RetroButton
          aria-label={`${t("department.recoverTask")} ${taskTitle(task, language)}`}
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

function departmentName(department: DepartmentSummary, language: "en" | "zh"): string {
  return resolveLocalizedValue(department.nameText, language, department.name);
}

function departmentResponsibility(department: DepartmentSummary, language: "en" | "zh"): string {
  return resolveLocalizedValue(department.responsibilityText, language, department.responsibility);
}

function taskTitle(task: TaskSummary, language: "en" | "zh"): string {
  return resolveLocalizedValue(task.titleText, language, task.title);
}

function taskDescription(task: TaskSummary, language: "en" | "zh"): string {
  return resolveLocalizedValue(task.descriptionText, language, task.description ?? "");
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
