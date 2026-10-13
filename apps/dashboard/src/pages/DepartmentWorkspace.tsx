import { ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  AgentSummary,
  CeoOfficeItemSummary,
  DepartmentSummary,
  HumanActionSummary,
  TaskProgressEventSummary,
  TaskSummary,
  WaitStateSummary,
} from "../api/client";
import { getCeoPendingItems } from "../components/ceo-office/ceoPendingItems";
import { DepartmentAgentSummary } from "../components/department/DepartmentAgentSummary";
import { DepartmentLeaderReport } from "../components/department/DepartmentLeaderReport";
import { DepartmentRoleSummary } from "../components/department/DepartmentRoleSummary";
import type { WorkspaceHandlers } from "../components/workbench/workspaceHandlers";
import { useLanguage } from "../ui/language";
import { departmentName, departmentResponsibility } from "../ui/language/localizedNames";
import { RetroPanel } from "../ui/retro";
import { LegacyTheme } from "../ui/theme";

export type DepartmentWorkspaceProps = Pick<
  WorkspaceHandlers,
  "onConfirmHumanAction" | "onRefreshTask" | "onCreateReplanProposal" | "onDecideFounderApproval" | "onRecoverTask" | "onConfirmTaskTermination"
> & {
  agents: AgentSummary[];
  ceoOfficeItems: CeoOfficeItemSummary[];
  /** The department the Workbench rail has open. */
  departmentId: string;
  departments: DepartmentSummary[];
  humanActions: HumanActionSummary[];
  onOpenCeoOffice(): void;
  taskProgressEvents: TaskProgressEventSummary[];
  tasks: TaskSummary[];
  waitStates: WaitStateSummary[];
};

/**
 * A department page, still in Retro UI until the second P4 step (dashboard ADR 0002). The Workbench
 * rail chooses the department; this renders only its content, inside the legacy palette.
 */
export function DepartmentWorkspace({
  agents,
  ceoOfficeItems,
  departmentId,
  departments,
  humanActions,
  onConfirmHumanAction,
  onConfirmTaskTermination,
  onCreateReplanProposal,
  onDecideFounderApproval,
  onOpenCeoOffice,
  onRecoverTask,
  onRefreshTask,
  taskProgressEvents,
  tasks,
  waitStates,
}: DepartmentWorkspaceProps) {
  const { language, t } = useLanguage();
  const [draft, setDraft] = useState("");
  const department = departments.find((candidate) => candidate.id === departmentId) ?? null;
  const departmentNamesById = useMemo(
    () => new Map(departments.map((candidate) => [candidate.id, departmentName(candidate, language)])),
    [departments, language],
  );
  const pendingItems = useMemo(() => getCeoPendingItems(ceoOfficeItems, tasks, departmentNamesById), [ceoOfficeItems, departmentNamesById, tasks]);

  if (!department) return null;

  return (
    <LegacyTheme className="legacy-workspace">
      <section className="department-workspace__main">
        <RetroPanel icon={<ListChecks size={18} aria-hidden="true" />} title={`${departmentName(department, language)} ${t("department.workspace")}`}>
          <div className="role-summary">
            <section className="department-overview">
              <DepartmentAgentSummary agents={agents} department={department} />
              <DepartmentRoleSummary department={department} />
            </section>
            <DepartmentLeaderReport
              departmentId={department.id}
              departmentName={departmentName(department, language)}
              draft={draft}
              humanActions={humanActions.filter((action) => action.departmentId === department.id)}
              waitStates={waitStates.filter((waitState) => waitState.departmentId === department.id)}
              onConfirmHumanAction={onConfirmHumanAction}
              onDraftChange={setDraft}
              onViewCeoPending={onOpenCeoOffice}
              onRefreshTask={onRefreshTask}
              onCreateReplanProposal={onCreateReplanProposal}
              onDecideFounderApproval={onDecideFounderApproval}
              onRecoverTask={onRecoverTask}
              onConfirmTaskTermination={onConfirmTaskTermination}
              pendingItems={pendingItems}
              progressEvents={taskProgressEvents}
              responsibility={departmentResponsibility(department, language)}
              tasks={tasks.filter((task) => task.departmentId === department.id)}
            />
          </div>
        </RetroPanel>
      </section>
    </LegacyTheme>
  );
}
