import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentSummary, CompanyEventSummary } from "../api/client";
import { CompanyFlowPage, CreationTimeline } from "../components/company-flow";
import { Alert, AlertTitle, Button, Card } from "../components/ui";
import { useLanguage } from "../ui/language";
import { resolveLocalizedValue } from "../ui/language/localizedText";
import { formatPermissionMode } from "../ui/tasks/formatDisplayValue";

export type CompanyCreationLoadingProps = {
  companyName: string;
  events?: CompanyEventSummary[];
  isFailed?: boolean;
  isRetrying?: boolean;
  onRetry?: () => void;
  permissionMode: string;
  selectedAgent: AgentSummary | null;
  /** Shown when the agent list has not loaded, so the CEO is never blank. */
  selectedAgentId?: string;
};

export function CompanyCreationLoading({
  companyName,
  events = [],
  isFailed = false,
  isRetrying = false,
  onRetry,
  permissionMode,
  selectedAgent,
  selectedAgentId,
}: CompanyCreationLoadingProps) {
  const { language, t } = useLanguage();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const summaryId = "company-creation-summary";
  const stagesId = "company-creation-stages";

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const summary = [
    { label: t("creating.company"), value: companyName },
    { label: t("creating.ceo"), value: selectedAgent?.name ?? selectedAgentId ?? t("creating.selectedAgent") },
    { label: t("creating.policy"), value: formatPermissionMode(permissionMode, t) },
    { label: t("creating.elapsed"), value: `${elapsedSeconds}s` },
  ];

  return (
    <CompanyFlowPage
      eyebrow={companyName}
      status={isFailed ? t("creating.failed") : t("creating.statusText")}
      statusIcon={isFailed ? <CircleAlert aria-hidden="true" /> : <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}
      title={t("app.title")}
      titleId="company-creation-dialog-title"
    >
      <Card aria-labelledby={summaryId} className="grid gap-5 p-4 sm:p-6" role="region">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground" id={summaryId}>
            {t("creating.panel")}
          </h2>
          {!isFailed ? <span className="text-sm text-muted-foreground">{t("creating.status")}</span> : null}
        </div>
        {!isFailed ? (
          <div aria-label={t("creating.statusText")} className="h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar">
            <span className="block h-full w-2/5 rounded-full bg-primary motion-safe:animate-progress-indeterminate" />
          </div>
        ) : null}
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {summary.map((item) => (
            <div className="grid min-w-0 gap-1" key={item.label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</dt>
              <dd className="break-words text-sm font-medium text-foreground">{item.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card aria-labelledby={stagesId} className="grid gap-4 p-4 sm:p-6" role="region">
        <h2 className="text-base font-semibold text-foreground" id={stagesId}>
          {t("creating.stages")}
        </h2>
        <CreationTimeline
          expectedStages={[
            t("creating.stageVision"),
            t("creating.stageBlueprint"),
            t("creating.stageJson"),
            t("creating.stageTasks"),
          ]}
          isFailed={isFailed}
          stages={events.map((event) => resolveLocalizedValue(event.messageText, language, event.message))}
        />
      </Card>

      {isFailed ? (
        <Alert className="flex flex-wrap items-center justify-between gap-3" role="status" variant="destructive">
          <AlertTitle>{t("creating.failed")}</AlertTitle>
          <Button disabled={isRetrying} onClick={onRetry} variant="outline">
            <RefreshCw aria-hidden="true" />
            {isRetrying ? t("creating.retrying") : t("creating.retry")}
          </Button>
        </Alert>
      ) : null}
    </CompanyFlowPage>
  );
}
