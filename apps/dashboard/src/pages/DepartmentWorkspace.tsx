import { Building2, ClipboardCheck, Crown, ListChecks } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { AgentSummary, CompanySummary, DepartmentSummary, ObjectiveSummary, TaskSummary } from "../api/client";
import { VideotexKeyValue, VideotexLog } from "../ui/data";
import { AppShell, PageHeader, Workspace } from "../ui/layout";
import { RetroBadge, RetroListRow, RetroPanel } from "../ui/retro";

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
    <AppShell menuBar={menuBar}>
      <PageHeader
        eyebrow="Department Workspace"
        status={company.status}
        statusIcon={<Building2 size={16} aria-hidden="true" />}
        title={company.name}
      />

      <Workspace className="department-workspace">
        <RetroPanel className="department-workspace__rail" icon={<ClipboardCheck size={18} aria-hidden="true" />} title="Departments">
          <RetroListRow
            meta={selectedCeoAgent?.name ?? selectedCeoAgentId}
            onClick={() => setSelectedRoleId(ceoRoleId)}
            selected={selectedRoleId === ceoRoleId}
            title="CEO"
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
            <RetroPanel icon={<ListChecks size={18} aria-hidden="true" />} title={`${selectedDepartment.name} Workspace`}>
              <div className="role-summary">
                <VideotexKeyValue
                  items={[
                    { label: "Role", value: selectedDepartment.name },
                    { label: "Lead", value: selectedDepartment.leadAgentId ?? "unassigned" },
                    { label: "Memory", value: selectedDepartment.memoryPath ?? "pending" },
                  ]}
                />
                <p>{selectedDepartment.responsibility}</p>
                <div>
                  {(tasksByDepartment.get(selectedDepartment.id) ?? []).map((task) => (
                    <RetroBadge key={task.id} tone="signal">
                      {task.title} / {task.status}
                    </RetroBadge>
                  ))}
                </div>
                <p className="muted">Department chat will be added later. Use queued tasks and proof views for execution.</p>
              </div>
            </RetroPanel>
          ) : (
            <RetroPanel icon={<Crown size={18} aria-hidden="true" />} title="CEO Workspace">
              <div className="role-summary">
                <VideotexKeyValue
                  items={[
                    { label: "CEO", value: selectedCeoAgent?.name ?? selectedCeoAgentId },
                    { label: "Status", value: company.status },
                    { label: "Playbook", value: company.playbookId },
                  ]}
                />
                <div>
                  <h3>Objectives</h3>
                  <VideotexLog emptyMessage="No objectives queued." rows={objectives.map((objective) => objective.title)} />
                </div>
                <div>
                  <h3>First Tasks</h3>
                  <VideotexLog emptyMessage="No tasks queued." rows={tasks.map((task) => `${task.title} / ${task.status}`)} />
                </div>
                <p className="muted">
                  Department execution is queued. Scheduler, proof, and review views are available from the menu.
                </p>
              </div>
            </RetroPanel>
          )}
        </section>
      </Workspace>
    </AppShell>
  );
}
