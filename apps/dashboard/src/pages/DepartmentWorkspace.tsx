import { Crown, ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  AgentSummary,
  BusinessArtifactSummary,
  CeoIntakeSummary,
  CeoOfficeItemSummary,
  CompanySummary,
  DepartmentSummary,
  FinalFounderReportSummary,
  FounderDecisionSummary,
  HumanActionSummary,
  KeyResultSummary,
  ObjectiveSummary,
  ProofSummary,
  TaskCompletionEventSummary,
  TaskProgressEventSummary,
  TaskSummary,
  VisionGapSummary,
  WaitStateSummary,
} from "../api/client";
import { CeoIntakeWorkspace } from "../components/ceo-office/CeoIntakeWorkspace";
import { getCeoPendingItems } from "../components/ceo-office/ceoPendingItems";
import { DepartmentAgentSummary } from "../components/department/DepartmentAgentSummary";
import { DepartmentLeaderReport } from "../components/department/DepartmentLeaderReport";
import { DepartmentRoleSummary } from "../components/department/DepartmentRoleSummary";
import type { WorkspaceHandlers } from "../components/workbench/workspaceHandlers";
import { VideotexKeyValue } from "../ui/data";
import { useLanguage } from "../ui/language";
import { departmentName, departmentResponsibility } from "../ui/language/localizedNames";
import { RetroPanel } from "../ui/retro";
import { LegacyTheme } from "../ui/theme";

export type DepartmentWorkspaceProps = WorkspaceHandlers & {
  agents: AgentSummary[];
  company: CompanySummary;
  departments: DepartmentSummary[];
  objectives: ObjectiveSummary[];
  selectedCeoAgentId: string;
  tasks: TaskSummary[];
  taskProgressEvents?: TaskProgressEventSummary[];
  ceoIntakes?: CeoIntakeSummary[];
  proof?: ProofSummary[];
  businessArtifacts?: BusinessArtifactSummary[];
  ceoOfficeItems?: CeoOfficeItemSummary[];
  finalFounderReport?: FinalFounderReportSummary | null;
  finalFounderReportPreparing?: boolean;
  founderDecisions?: FounderDecisionSummary[];
  humanActions?: HumanActionSummary[];
  keyResults?: KeyResultSummary[];
  taskCompletionEvents?: TaskCompletionEventSummary[];
  visionGaps?: VisionGapSummary[];
  waitStates?: WaitStateSummary[];
  /** The department the Workbench rail has open, or null for CEO Office. */
  selectedDepartmentId: string | null;
  onSelectDepartment(departmentId: string | null): void;
};

/**
 * CEO Office and the department pages, still in Retro UI until P4 (dashboard ADR 0002). The Workbench
 * rail chooses which one shows; this renders only its content, inside the legacy palette.
 */

export function DepartmentWorkspace({
  agents,
  company,
  departments,
  objectives,
  onCreateCeoIntake,
  onCreateCeoReviewDecision,
  onResolveFounderDecision,
  onConfirmHumanAction,
  onRefreshTask,
  onCreateReplanProposal,
  onDecideFounderApproval,
  onRecoverTask,
  onConfirmTaskTermination,
  onSelectDepartment,
  selectedCeoAgentId,
  selectedDepartmentId,
  tasks,
  ceoIntakes = [],
  proof = [],
  businessArtifacts = [],
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
  const [departmentDraft, setDepartmentDraft] = useState("");
  const [ceoIntakeDraft, setCeoIntakeDraft] = useState("");
  const selectedDepartment = departments.find((department) => department.id === selectedDepartmentId) ?? null;
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
    <LegacyTheme className="legacy-workspace">
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
                onViewCeoPending={() => onSelectDepartment(null)}
                onRefreshTask={onRefreshTask}
                onCreateReplanProposal={onCreateReplanProposal}
                onDecideFounderApproval={onDecideFounderApproval}
                onRecoverTask={onRecoverTask}
                onConfirmTaskTermination={onConfirmTaskTermination}
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
                finalFounderReport={finalFounderReport}
                finalFounderReportPreparing={finalFounderReportPreparing}
                founderDecisions={founderDecisions}
                taskCompletionEvents={taskCompletionEvents}
                onDraftChange={setCeoIntakeDraft}
                onCreateCeoReviewDecision={onCreateCeoReviewDecision}
                onResolveFounderDecision={onResolveFounderDecision}
                onConfirmHumanAction={onConfirmHumanAction}
                onRefreshTask={onRefreshTask}
                onCreateReplanProposal={onCreateReplanProposal}
                onRecoverTask={onRecoverTask}
                onConfirmTaskTermination={onConfirmTaskTermination}
                onSelectDepartment={onSelectDepartment}
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
    </LegacyTheme>
  );
}
