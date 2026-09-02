import { Activity, Building2, LoaderCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AgentSummary, CompanyEventSummary } from "../api/client";
import { VideotexKeyValue, VideotexLog } from "../ui/data";
import { useLanguage } from "../ui/language";
import { ModalFrame, PageHeader, Workspace } from "../ui/layout";
import { RetroButton, RetroPanel, RetroStatus } from "../ui/retro";

export type CompanyCreationLoadingProps = {
  companyName: string;
  events?: CompanyEventSummary[];
  isFailed?: boolean;
  isRetrying?: boolean;
  menuBar?: ReactNode;
  onRetry?: () => void;
  permissionMode: string;
  selectedAgent: AgentSummary | null;
};

export function CompanyCreationLoading({
  companyName,
  events = [],
  isFailed = false,
  isRetrying = false,
  menuBar,
  onRetry,
  permissionMode,
  selectedAgent,
}: CompanyCreationLoadingProps) {
  const { t } = useLanguage();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const titleId = "company-creation-dialog-title";
  const creationStages = events.length > 0 ? events.map((event) => event.message) : [
    t("creating.stageVision"),
    t("creating.stageBlueprint"),
    t("creating.stageJson"),
    t("creating.stageTasks"),
  ];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <ModalFrame className="app-modal-card--creation" labelledBy={titleId} menuBar={menuBar}>
      <PageHeader
        eyebrow={companyName}
        status={t("creating.status")}
        statusIcon={<Building2 size={16} aria-hidden="true" />}
        title={t("app.title")}
        titleId={titleId}
      />

      <section aria-label={t("creating.status")} className="creation-progress">
        <div aria-label={t("creating.statusText")} className="creation-progress__track" role="progressbar">
          <span className="creation-progress__bar" />
        </div>
      </section>

      <Workspace className="creation-loading">
        <RetroPanel icon={<LoaderCircle size={18} aria-hidden="true" />} title={t("creating.panel")}>
          <VideotexKeyValue
            items={[
              { label: t("creating.company"), value: companyName },
              { label: t("creating.ceo"), value: selectedAgent?.name ?? t("creating.selectedAgent") },
              { label: t("creating.policy"), value: permissionMode },
              { label: t("creating.elapsed"), value: `${elapsedSeconds}s` },
            ]}
          />
        </RetroPanel>

        <RetroPanel icon={<Activity size={18} aria-hidden="true" />} title={t("creating.stages")}>
          <VideotexLog emptyMessage={t("creating.waiting")} rows={creationStages} />
        </RetroPanel>
      </Workspace>

      <RetroStatus icon={<LoaderCircle size={16} aria-hidden="true" />}>
        {isFailed ? t("creating.failed") : t("creating.statusText")}
      </RetroStatus>

      {isFailed ? (
        <RetroButton disabled={isRetrying} onClick={onRetry} type="button">
          {isRetrying ? t("creating.retrying") : t("creating.retry")}
        </RetroButton>
      ) : null}
    </ModalFrame>
  );
}
