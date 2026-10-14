import { Crown, FileText, Settings, Stethoscope, Users } from "lucide-react";
import { useId, type ReactNode } from "react";
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

/** `icons` is the 80px rail of icons and short names; `full` shows the company, full names and working agents. */
export type RailVariant = "icons" | "full";

export type WorkbenchRailProps = {
  companyName: string;
  companyStatus: string;
  ceoPendingCount: number;
  departments: RailDepartment[];
  location: WorkbenchLocation;
  onNavigate(location: WorkbenchLocation): void;
  variant: RailVariant;
};

type RailEntry = {
  key: string;
  active: boolean;
  icon: ReactNode;
  label: string;
  /** What the 80px rail shows under the icon; the full label is its tooltip and accessible name. */
  shortLabel?: string;
  onClick(): void;
  pendingCount?: number;
  workingAgents?: RailAgent[];
};

/** The Workbench's left rail: the company, CEO Office, each department, then the company-wide pages. */
export function WorkbenchRail({ ceoPendingCount, companyName, companyStatus, departments, location, onNavigate, variant }: WorkbenchRailProps) {
  const { t } = useLanguage();
  const ceoOffice: RailEntry = {
    key: "ceo-office",
    active: sameLocation(location, { page: "ceo-office" }),
    icon: <Crown aria-hidden="true" />,
    label: t("workbench.ceoOffice"),
    shortLabel: t("workbench.ceoOfficeShort"),
    onClick: () => onNavigate({ page: "ceo-office" }),
    pendingCount: ceoPendingCount,
  };
  const departmentEntries: RailEntry[] = departments.map((department) => ({
    key: department.id,
    active: sameLocation(location, { page: "department", departmentId: department.id }),
    icon: department.leadAgent ? (
      <AgentIcon agentId={department.leadAgent.id} decorative name={department.leadAgent.name} />
    ) : (
      <Users aria-hidden="true" />
    ),
    label: department.name,
    onClick: () => onNavigate({ page: "department", departmentId: department.id }),
    pendingCount: department.pendingCount,
    workingAgents: department.workingAgents,
  }));
  const companyPages: RailEntry[] = [
    {
      key: "operations",
      active: sameLocation(location, { page: "operations" }),
      icon: <Stethoscope aria-hidden="true" />,
      label: t("workbench.operationsDiagnostics"),
      shortLabel: t("workbench.operationsDiagnosticsShort"),
      onClick: () => onNavigate({ page: "operations" }),
    },
    {
      key: "deliverables",
      active: sameLocation(location, { page: "deliverables" }),
      icon: <FileText aria-hidden="true" />,
      label: t("workbench.deliverables"),
      onClick: () => onNavigate({ page: "deliverables" }),
    },
    {
      key: "settings",
      active: sameLocation(location, { page: "settings" }),
      icon: <Settings aria-hidden="true" />,
      label: t("workbench.settings"),
      onClick: () => onNavigate({ page: "settings" }),
    },
  ];

  if (variant === "icons") {
    return (
      <nav aria-label={t("workbench.navigation")} className="im-rail" data-variant="icons">
        {/* The company's name and status stay in the rail for screen readers; sighted founders see its initial. */}
        <div className="im-rail-company" title={companyName}>
          <span aria-hidden="true" className="im-rail-mark">
            {Array.from(companyName.trim())[0] ?? ""}
          </span>
          <div className="sr-only">
            <h2>{companyName}</h2>
            <CompanyStatus status={companyStatus} />
          </div>
        </div>
        {[ceoOffice, ...departmentEntries].map((entry) => (
          <RailItem entry={entry} key={entry.key} variant="icons" />
        ))}
        <div className="im-rail-pages">
          {companyPages.map((entry) => (
            <RailItem entry={entry} key={entry.key} variant="icons" />
          ))}
        </div>
      </nav>
    );
  }

  return (
    <nav aria-label={t("workbench.navigation")} className="im-rail" data-variant="full">
      <div className="im-rail-company">
        <h2 className="break-words text-base font-semibold normal-case leading-tight">{companyName}</h2>
        <CompanyStatus status={companyStatus} />
      </div>
      <RailItem entry={ceoOffice} variant="full" />
      {departmentEntries.length > 0 ? <span className="im-rail-section">{t("workbench.departments")}</span> : null}
      {departmentEntries.map((entry) => (
        <RailItem entry={entry} key={entry.key} variant="full" />
      ))}
      <div className="im-rail-pages">
        {companyPages.map((entry) => (
          <RailItem entry={entry} key={entry.key} variant="full" />
        ))}
      </div>
    </nav>
  );
}

function RailItem({ entry, variant }: { entry: RailEntry; variant: RailVariant }) {
  const { t } = useLanguage();
  const descriptionId = useId();
  const { active, icon, label, onClick, pendingCount = 0, shortLabel, workingAgents = [] } = entry;
  // The button is named by its label alone; counts and working agents are its description, so
  // "Engineering" stays "Engineering" however busy it is.
  const description = [
    pendingCount > 0 ? t("workbench.needsYouCount").replace("{count}", String(pendingCount)) : null,
    ...workingAgents.map((agent) => t("workbench.agentWorking").replace("{agent}", agent.name)),
  ].filter(Boolean).join(", ");
  const pendingPill = pendingCount > 0 ? (
    <span aria-hidden="true" className="im-rail-count">
      {pendingCount}
    </span>
  ) : null;

  return (
    <>
      <button
        aria-current={active ? "page" : undefined}
        aria-describedby={description ? descriptionId : undefined}
        aria-label={shortLabel && variant === "icons" ? label : undefined}
        className="im-rail-item"
        onClick={onClick}
        title={variant === "icons" ? label : undefined}
        type="button"
      >
        {variant === "icons" ? (
          <>
            <span className="im-rail-icon">
              {icon}
              {pendingPill}
              {/* One quiet dot however many agents are working; the full rail names them. */}
              {workingAgents.length > 0 ? <span aria-hidden="true" className="im-rail-working" /> : null}
            </span>
            <span className="im-rail-short">{shortLabel ?? label}</span>
          </>
        ) : (
          <>
            <span className="im-rail-icon">{icon}</span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {workingAgents.length > 0 ? (
              <span aria-hidden="true" className="inline-flex items-center gap-1">
                {workingAgents.map((agent) => (
                  <span className="relative inline-flex" key={agent.id}>
                    <AgentIcon agentId={agent.id} className="size-3.5" decorative name={agent.name} />
                    <span className="im-rail-working" />
                  </span>
                ))}
              </span>
            ) : null}
            {pendingPill}
          </>
        )}
      </button>
      {description ? (
        <span className="sr-only" id={descriptionId}>
          {description}
        </span>
      ) : null}
    </>
  );
}
