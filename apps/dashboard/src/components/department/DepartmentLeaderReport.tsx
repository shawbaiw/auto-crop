import type { HumanActionSummary, TaskProgressEventSummary, TaskSummary, WaitStateSummary } from "../../api/client";
import type { WorkspaceHandlers } from "../workbench/workspaceHandlers";
import { HumanActionPanel } from "../../ui/humanActions/HumanActionPanel";
import { useLanguage } from "../../ui/language";
import { departmentName } from "../../ui/language/localizedNames";
import { WaitStatePanel } from "../../ui/waitStates/WaitStatePanel";
import type { CeoPendingItem } from "../ceo-office/ceoPendingItems";
import { DepartmentMessageBox } from "./DepartmentMessageBox";
import { DepartmentProgressFlows } from "./DepartmentProgressFlows";

export function DepartmentLeaderReport({
  departmentId,
  departmentName,
  draft,
  humanActions,
  waitStates,
  onConfirmHumanAction,
  onDraftChange,
  onCreateReplanProposal,
  onDecideFounderApproval,
  onRecoverTask,
  onConfirmTaskTermination,
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
  onConfirmHumanAction?: WorkspaceHandlers["onConfirmHumanAction"];
  onDraftChange: (value: string) => void;
  onRefreshTask?: WorkspaceHandlers["onRefreshTask"];
  onCreateReplanProposal?: WorkspaceHandlers["onCreateReplanProposal"];
  onDecideFounderApproval?: WorkspaceHandlers["onDecideFounderApproval"];
  onRecoverTask?: WorkspaceHandlers["onRecoverTask"];
  onConfirmTaskTermination?: WorkspaceHandlers["onConfirmTaskTermination"];
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
        onCreateReplanProposal={onCreateReplanProposal}
        onDecideFounderApproval={onDecideFounderApproval}
        onRecoverTask={onRecoverTask}
        onConfirmTaskTermination={onConfirmTaskTermination}
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
