import type { AgentSummary, DepartmentSummary } from "../../api/client";
import { useLanguage } from "../../ui/language";
import { formatCapability } from "../../ui/tasks/formatDisplayValue";

export function DepartmentAgentSummary({
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
