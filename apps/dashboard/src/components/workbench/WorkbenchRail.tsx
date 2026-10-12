import { Crown, FileText, Settings, Stethoscope } from "lucide-react";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useLanguage } from "../../ui/language";
import { AgentIcon } from "./AgentIcon";
import { CompanyStatus } from "./CompanyStatus";
import { sameLocation, type WorkbenchLocation } from "./workbenchLocation";

export type RailAgent = { id: string; name: string };

export type RailDepartment = {
  id: string;
  name: string;
  leadAgent: RailAgent | null;
  /** Items in this department that need the founder. */
  pendingCount: number;
  /** Agents running this department's work right now. */
  workingAgents: RailAgent[];
};

export type WorkbenchRailProps = {
  companyName: string;
  companyStatus: string;
  ceoPendingCount: number;
  departments: RailDepartment[];
  location: WorkbenchLocation;
  onNavigate(location: WorkbenchLocation): void;
};

/** The Workbench's left rail: the company, CEO Office, each department, then the company-wide pages. */
export function WorkbenchRail({ ceoPendingCount, companyName, companyStatus, departments, location, onNavigate }: WorkbenchRailProps) {
  const { t } = useLanguage();

  return (
    <nav aria-label={t("workbench.navigation")} className="flex h-full min-h-0 flex-col gap-1 text-sm">
      <div className="mb-3 grid gap-1 px-2 py-1">
        <h2 className="break-words text-base font-semibold leading-tight text-foreground">{companyName}</h2>
        <CompanyStatus status={companyStatus} />
      </div>
      <RailItem
        active={sameLocation(location, { page: "ceo-office" })}
        icon={<Crown aria-hidden="true" className="size-4" />}
        label={t("workbench.ceoOffice")}
        onClick={() => onNavigate({ page: "ceo-office" })}
        pendingCount={ceoPendingCount}
      />
      {departments.length > 0 ? (
        <span className="mt-3 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("workbench.departments")}</span>
      ) : null}
      {departments.map((department) => (
        <RailItem
          active={sameLocation(location, { page: "department", departmentId: department.id })}
          icon={
            department.leadAgent ? (
              <AgentIcon agentId={department.leadAgent.id} decorative name={department.leadAgent.name} />
            ) : (
              <span aria-hidden="true" className="size-4" />
            )
          }
          key={department.id}
          label={department.name}
          onClick={() => onNavigate({ page: "department", departmentId: department.id })}
          pendingCount={department.pendingCount}
          workingAgents={department.workingAgents}
        />
      ))}
      <div className="mt-auto grid gap-1 border-t border-border/70 pt-3">
        <RailItem
          active={sameLocation(location, { page: "operations" })}
          icon={<Stethoscope aria-hidden="true" className="size-4" />}
          label={t("workbench.operationsDiagnostics")}
          onClick={() => onNavigate({ page: "operations" })}
        />
        <RailItem
          active={sameLocation(location, { page: "deliverables" })}
          icon={<FileText aria-hidden="true" className="size-4" />}
          label={t("workbench.deliverables")}
          onClick={() => onNavigate({ page: "deliverables" })}
        />
        <RailItem
          active={sameLocation(location, { page: "settings" })}
          icon={<Settings aria-hidden="true" className="size-4" />}
          label={t("workbench.settings")}
          onClick={() => onNavigate({ page: "settings" })}
        />
      </div>
    </nav>
  );
}

function RailItem({
  active,
  icon,
  label,
  onClick,
  pendingCount = 0,
  workingAgents = [],
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick(): void;
  pendingCount?: number;
  workingAgents?: RailAgent[];
}) {
  const { t } = useLanguage();
  const descriptionId = useId();
  // The button is named by its label alone; counts and working agents are its description, so
  // "Engineering" stays "Engineering" however busy it is.
  const description = [
    pendingCount > 0 ? t("workbench.needsYouCount").replace("{count}", String(pendingCount)) : null,
    ...workingAgents.map((agent) => t("workbench.agentWorking").replace("{agent}", agent.name)),
  ].filter(Boolean).join(", ");

  return (
    <>
      <button
        aria-current={active ? "page" : undefined}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active && "bg-secondary font-medium",
        )}
        onClick={onClick}
        type="button"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {workingAgents.length > 0 ? (
          <span aria-hidden="true" className="inline-flex items-center gap-0.5">
            {workingAgents.map((agent) => (
              <span className="relative inline-flex" key={agent.id}>
                <AgentIcon agentId={agent.id} className="size-3.5" decorative name={agent.name} />
                <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-blue-500 motion-safe:animate-pulse" />
              </span>
            ))}
          </span>
        ) : null}
        {pendingCount > 0 ? (
          <span aria-hidden="true" className="rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-800">
            {pendingCount}
          </span>
        ) : null}
      </button>
      {description ? (
        <span className="sr-only" id={descriptionId}>
          {description}
        </span>
      ) : null}
    </>
  );
}
