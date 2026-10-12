import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  BusinessArtifactSummary,
  CeoIntakeSummary,
  CeoOfficeItemSummary,
  DepartmentSummary,
  FinalFounderReportSummary,
  FounderDecisionSummary,
  HumanActionSummary,
  KeyResultSummary,
  Locale,
  ObjectiveSummary,
  ProofSummary,
  TaskCompletionEventSummary,
  TaskSummary,
  VisionGapSummary,
  WaitStateSummary,
} from "../../api/client";
import type { WorkspaceHandlers } from "../workbench/workspaceHandlers";
import { readOutcomesLastSeen, writeOutcomesLastSeen } from "../../ui/ceoOutcomes/lastSeen";
import { HumanActionPanel } from "../../ui/humanActions/HumanActionPanel";
import { useLanguage } from "../../ui/language";
import { RetroButton } from "../../ui/retro";
import { WaitStatePanel } from "../../ui/waitStates/WaitStatePanel";
import { CeoBlueprintSummary } from "./CeoBlueprintSummary";
import { CeoExecutiveOverview } from "./CeoExecutiveOverview";
import { CeoIntakeFlows } from "./CeoIntakeFlows";
import { CeoIntakeMessageBox } from "./CeoIntakeMessageBox";
import { CeoOfficeTimeline } from "./CeoOfficeTimeline";
import { CeoOutcomesView } from "./CeoOutcomesView";
import { CeoPendingQueue } from "./CeoPendingQueue";
import { CeoTaskReviewDetail } from "./CeoTaskReviewDetail";
import { FinalFounderReportPanel } from "./FinalFounderReportPanel";
import type { CeoPendingItem } from "./ceoPendingItems";

export function CeoIntakeWorkspace({
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
  onRefreshTask,
  onCreateReplanProposal,
  onRecoverTask,
  onConfirmTaskTermination,
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
  onCreateCeoReviewDecision?: WorkspaceHandlers["onCreateCeoReviewDecision"];
  onResolveFounderDecision?: WorkspaceHandlers["onResolveFounderDecision"];
  onConfirmHumanAction?: WorkspaceHandlers["onConfirmHumanAction"];
  onRefreshTask?: WorkspaceHandlers["onRefreshTask"];
  onCreateReplanProposal?: WorkspaceHandlers["onCreateReplanProposal"];
  onRecoverTask?: WorkspaceHandlers["onRecoverTask"];
  onConfirmTaskTermination?: WorkspaceHandlers["onConfirmTaskTermination"];
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
  const { t } = useLanguage();
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

  const handleDecision = async (input: Parameters<NonNullable<WorkspaceHandlers["onCreateCeoReviewDecision"]>>[0]) => {
    const response = await onCreateCeoReviewDecision?.(input);
    setSelectedTaskId(null);
    setSuccessMessage(
      response?.decision.decision === "return"
        ? t("department.ceoReviewReturnedSuccess")
        : t("department.ceoReviewApprovedSuccess"),
    );
  };

  const historyRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const itemRevision = ceoOfficeItems.map(item => `${item.id}:${item.actionBearing}`).join("|");
  const scrollToLatest = () => {
    const history = historyRef.current;
    if (history) history.scrollTop = history.scrollHeight;
    followLatest.current = true;
    setHasNewMessages(false);
  };
  useLayoutEffect(() => {
    followLatest.current = true;
    scrollToLatest();
  }, [companyId]);
  useLayoutEffect(() => {
    if (followLatest.current) scrollToLatest();
    else setHasNewMessages(true);
  }, [itemRevision]);
  useEffect(() => {
    const history = historyRef.current;
    if (!history || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (followLatest.current) history.scrollTop = history.scrollHeight;
    });
    observer.observe(history);
    if (history.firstElementChild) observer.observe(history.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="department-leader-report ceo-intake-report" aria-label={t("department.ceoIntakeReport")}>
      <div className="ceo-intake-report__history" ref={historyRef} role="region" aria-label={t("department.ceoHistory")} tabIndex={0}
        onScroll={() => {
          const history = historyRef.current;
          if (!history) return;
          followLatest.current = history.scrollHeight - history.scrollTop - history.clientHeight < 48;
          if (followLatest.current) setHasNewMessages(false);
        }}>
      <div className="ceo-intake-report__content">
      <CeoExecutiveOverview
        companyTaskCount={tasks.length}
        founderVision={founderVision}
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
          onRefreshTask={onRefreshTask}
          onCreateReplanProposal={onCreateReplanProposal}
          onRecoverTask={onRecoverTask}
          onConfirmTaskTermination={onConfirmTaskTermination}
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
      </div>
      </div>
      <div className="ceo-intake-report__footer">
        {hasNewMessages ? <RetroButton onClick={scrollToLatest}>{t("department.ceoNewMessages")}</RetroButton> : null}
        <CeoIntakeMessageBox draft={draft} onDraftChange={onDraftChange} onSubmit={onSubmit} />
      </div>
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
