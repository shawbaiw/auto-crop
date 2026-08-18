import { Activity, Building2, LoaderCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AgentSummary } from "../api/client";
import { VideotexKeyValue, VideotexLog } from "../ui/data";
import { AppShell, PageHeader, Workspace } from "../ui/layout";
import { RetroPanel, RetroStatus } from "../ui/retro";

export type CompanyCreationLoadingProps = {
  companyName: string;
  menuBar?: ReactNode;
  permissionMode: string;
  selectedAgent: AgentSummary | null;
};

const creationStages = [
  "Sending founder vision",
  "CEO agent generating blueprint",
  "Validating strict JSON",
  "Creating departments and tasks",
];

export function CompanyCreationLoading({
  companyName,
  menuBar,
  permissionMode,
  selectedAgent,
}: CompanyCreationLoadingProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <AppShell menuBar={menuBar}>
      <PageHeader
        eyebrow={companyName}
        status="Creating Company"
        statusIcon={<Building2 size={16} aria-hidden="true" />}
        title="CEO Office"
      />

      <Workspace className="creation-loading">
        <RetroPanel icon={<LoaderCircle size={18} aria-hidden="true" />} title="Company Creation">
          <VideotexKeyValue
            items={[
              { label: "Company", value: companyName },
              { label: "CEO", value: selectedAgent?.name ?? "Selected agent" },
              { label: "Policy", value: permissionMode },
              { label: "Elapsed", value: `${elapsedSeconds}s` },
            ]}
          />
        </RetroPanel>

        <RetroPanel icon={<Activity size={18} aria-hidden="true" />} title="Creation Stages">
          <VideotexLog emptyMessage="Waiting for CEO agent." rows={creationStages} />
        </RetroPanel>
      </Workspace>

      <RetroStatus icon={<LoaderCircle size={16} aria-hidden="true" />}>
        CEO agent blueprint generation in progress
      </RetroStatus>
    </AppShell>
  );
}
