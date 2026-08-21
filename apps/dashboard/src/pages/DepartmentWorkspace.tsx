import { Building2, ClipboardCheck, Crown, ListChecks } from "lucide-react";
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
import { RetroBadge, RetroListRow, RetroPanel } from "../ui/retro";
import { formatTaskStatus } from "../ui/tasks/formatTaskStatus";

export type DepartmentWorkspaceProps = {
  agents: AgentSummary[];
  company: CompanySummary;
  departments: DepartmentSummary[];
  menuBar?: ReactNode;
  objectives: ObjectiveSummary[];
  selectedCeoAgentId: string;
  tasks: TaskSummary[];
};

const ceoRoleId = "ceo";

export function DepartmentWorkspace({
  agents,
  company,
  departments,
  menuBar,
  objectives,
  selectedCeoAgentId,
  tasks,
}: DepartmentWorkspaceProps) {
  const { t } = useLanguage();
  const [selectedRoleId, setSelectedRoleId] = useState(ceoRoleId);
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
                <VideotexKeyValue
                  items={[
                    { label: t("department.role"), value: selectedDepartment.name },
                    { label: t("department.lead"), value: selectedDepartment.leadAgentId ?? t("department.unassigned") },
                    { label: t("department.memory"), value: selectedDepartment.memoryPath ?? t("department.pending") },
                  ]}
                />
                <p>{selectedDepartment.responsibility}</p>
                <div>
                  {(tasksByDepartment.get(selectedDepartment.id) ?? []).map((task) => (
                    <RetroBadge key={task.id} tone="signal">
                      {task.title} / {formatTaskStatus(task, t)}
                    </RetroBadge>
                  ))}
                </div>
                <p className="muted">{t("department.chatLater")}</p>
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
                  <VideotexLog emptyMessage={t("department.noTasks")} rows={tasks.map((task) => `${task.title} / ${formatTaskStatus(task, t)}`)} />
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
