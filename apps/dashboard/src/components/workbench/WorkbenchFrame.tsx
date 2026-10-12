import { useMemo, type ReactNode } from "react";
import type { AgentSummary, CeoOfficeItemSummary, CompanySummary, DepartmentSummary, TaskSummary } from "../../api/client";
import { Alert } from "@/components/ui";
import { getCeoPendingItems } from "../ceo-office/ceoPendingItems";
import { useLanguage } from "../../ui/language";
import { departmentName } from "../../ui/language/localizedNames";
import { operatingCommand, type WorkbenchCommands } from "./workbenchCommands";
import { serializeLocation, type WorkbenchLocation } from "./workbenchLocation";
import { WorkbenchRail, type RailAgent, type RailDepartment } from "./WorkbenchRail";
import { WorkbenchShell } from "./WorkbenchShell";

export type WorkbenchFrameProps = {
  agents: AgentSummary[];
  ceoOfficeItems: CeoOfficeItemSummary[];
  children: ReactNode;
  commands: WorkbenchCommands;
  company: CompanySummary;
  departments: DepartmentSummary[];
  location: WorkbenchLocation;
  onNavigate(location: WorkbenchLocation): void;
  tasks: TaskSummary[];
};

/** The open company's Workbench: its rail, its header, and a notice when the company is not operating. */
export function WorkbenchFrame({ agents, ceoOfficeItems, children, commands, company, departments, location, onNavigate, tasks }: WorkbenchFrameProps) {
  const { language, t } = useLanguage();
  const departmentNamesById = useMemo(
    () => new Map(departments.map((department) => [department.id, departmentName(department, language)])),
    [departments, language],
  );
  // The same CEO Pending projection CEO Office lists, counted per department for the rail.
  const pendingItems = useMemo(
    () => getCeoPendingItems(ceoOfficeItems, tasks, departmentNamesById),
    [ceoOfficeItems, departmentNamesById, tasks],
  );
  const agentFor = (agentId: string): RailAgent => ({ id: agentId, name: agents.find((agent) => agent.id === agentId)?.name ?? agentId });
  const railDepartments: RailDepartment[] = departments.map((department) => ({
    id: department.id,
    name: departmentNamesById.get(department.id) ?? department.name,
    leadAgent: department.leadAgentId ? agentFor(department.leadAgentId) : null,
    pendingCount: pendingItems.filter((item) => item.task.departmentId === department.id).length,
    workingAgents: [
      ...new Set(
        tasks
          .filter((task) => task.departmentId === department.id && (task.status === "running" || task.status === "retrying"))
          .map((task) => task.assigneeAgentId)
          .filter((agentId): agentId is string => Boolean(agentId)),
      ),
    ].map(agentFor),
  }));
  const title =
    location.page === "department"
      ? departmentNamesById.get(location.departmentId) ?? t("workbench.ceoOffice")
      : t(
          location.page === "operations"
            ? "workbench.operationsDiagnostics"
            : location.page === "deliverables"
              ? "workbench.deliverables"
              : location.page === "settings"
                ? "workbench.settings"
                : "workbench.ceoOffice",
        );
  const notice =
    company.status === "paused" ? (
      <Alert className="border-amber-300 bg-amber-50 text-amber-900" role="status">
        {t("app.companyPaused")}
      </Alert>
    ) : company.status === "stopped" ? (
      <Alert role="status">{t("workbench.companyStopped")}</Alert>
    ) : null;

  return (
    <WorkbenchShell
      fill={location.page === "ceo-office"}
      location={title}
      navigationKey={serializeLocation(location)}
      notice={notice}
      operatingCommand={operatingCommand(commands)}
      rail={
        <WorkbenchRail
          ceoPendingCount={pendingItems.length}
          companyName={company.name}
          companyStatus={company.status}
          departments={railDepartments}
          location={location}
          onNavigate={onNavigate}
        />
      }
    >
      {children}
    </WorkbenchShell>
  );
}
