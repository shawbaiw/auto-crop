import { ArrowLeft, Check, Circle, CircleAlert, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentSummary, CompanyEventSummary } from "../api/client";
import { CompanyFlowPage } from "../components/company-flow";
import { Alert, AlertTitle, Button, Card } from "../components/ui";
import { StopOperatingConfirm } from "../components/workbench/StopOperatingConfirm";
import { cn } from "@/lib/utils";
import type { WorkbenchCommand } from "../components/workbench/workbenchCommands";
import { useLanguage, type TranslationKey } from "../ui/language";
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
  /**
   * A failed creation can also be stopped (ADR 0044) or left for another company, so this page is
   * never a dead end. Both appear only when creation failed.
   */
  stopCommand?: WorkbenchCommand;
  onStopped?(): void;
  /** "other" returns to another company; "new" opens the Onboarding Wizard when there is none. */
  leave?: { kind: "other" | "new"; run(): void };
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
  stopCommand,
  onStopped,
  leave,
}: CompanyCreationLoadingProps) {
  const { language, t } = useLanguage();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const traceId = "company-creation-trace";
  const nextStepsId = "company-creation-next-steps";

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
  const trace = creationTrace(events, isFailed, t);
  const failedEvent = [...events].reverse().find((event) => event.type === "company_creation_failed");
  const failureMessage = failedEvent ? resolveLocalizedValue(failedEvent.messageText, language, failedEvent.message) : null;

  return (
    <CompanyFlowPage
      eyebrow={companyName}
      status={isFailed ? t("creating.failed") : t("creating.statusText")}
      statusIcon={isFailed ? <CircleAlert aria-hidden="true" /> : <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />}
      title={t("app.title")}
      titleId="company-creation-dialog-title"
    >
      <section
        aria-labelledby={traceId}
        className="relative isolate grid gap-5 overflow-hidden rounded-lg border border-border/60 bg-background/55 p-4 shadow-workbench backdrop-blur-md sm:p-6"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--accent)/0.42),transparent_42%),linear-gradient(180deg,hsl(var(--card)/0.74),hsl(var(--background)/0.68))]" />
        <div className="mx-auto grid w-full max-w-3xl gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground" id={traceId}>
              {t("creating.trace")}
            </h2>
            <span className="text-sm text-muted-foreground">{isFailed ? t("creating.failed") : t("creating.status")}</span>
          </div>
          <dl className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-4">
            {summary.map((item) => (
              <div className="min-w-0" key={item.label}>
                <dt className="text-xs font-medium uppercase tracking-wide">{item.label}</dt>
                <dd className="truncate font-medium normal-case text-foreground" title={item.value}>{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <ol className="mx-auto grid w-full max-w-3xl gap-2.5 sm:gap-3">
          {trace.map((step) => (
            <li key={step.type}>
              <Card
                className={cn(
                  "grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 bg-card/86 p-3 backdrop-blur sm:p-4",
                  step.state === "current" && "creation-step-current border-ring/50 bg-card",
                  step.state === "failed" && "border-destructive/70 bg-destructive/5",
                )}
              >
                <StepIcon state={step.state} />
                <div className="grid min-w-0 gap-1">
                  <span className={cn("text-sm font-medium text-foreground", step.state === "pending" && "text-muted-foreground", step.state === "failed" && "text-destructive")}>
                    {step.label}
                  </span>
                  {step.state === "failed" && failureMessage ? <span className="break-words text-xs text-destructive/85">{failureMessage}</span> : null}
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {isFailed ? (
        <Alert className="flex flex-wrap items-center justify-between gap-3" role="status" variant="destructive">
          <AlertTitle>{t("creating.failed")}</AlertTitle>
          <Button disabled={isRetrying} onClick={onRetry} variant="outline">
            <RefreshCw aria-hidden="true" />
            {isRetrying ? t("creating.retrying") : t("creating.retry")}
          </Button>
        </Alert>
      ) : null}

      {isFailed && (stopCommand || leave) ? (
        <Card aria-labelledby={nextStepsId} className="grid gap-3 p-4 sm:p-6" role="region">
          <h2 className="text-base font-semibold text-foreground" id={nextStepsId}>
            {t("creating.nextSteps")}
          </h2>
          {leave ? (
            <div>
              <Button onClick={leave.run} variant="outline">
                {leave.kind === "other" ? <ArrowLeft aria-hidden="true" /> : <Plus aria-hidden="true" />}
                {t(leave.kind === "other" ? "creating.backToOtherCompany" : "creating.createNewCompany")}
              </Button>
            </div>
          ) : null}
          {stopCommand ? (
            <StopOperatingConfirm
              command={stopCommand}
              companyName={companyName}
              explanation={t("creating.abandonExplanation")}
              label={t("creating.abandon")}
              onStopped={onStopped}
            />
          ) : null}
        </Card>
      ) : null}
    </CompanyFlowPage>
  );
}

type CreationStepState = "complete" | "current" | "failed" | "pending";
type CreationStep = { type: string; label: string; state: CreationStepState };

const creationStepTypes = [
  "company_creation_accepted",
  "company_creation_agent_started",
  "company_creation_blueprint_parsed",
  "company_creation_records_created",
  "company_creation_completed",
] as const;

function creationTrace(events: CompanyEventSummary[], failed: boolean, t: (key: TranslationKey) => string): CreationStep[] {
  const eventTypes = new Set(events.map((event) => event.type));
  const completed = new Set<string>();
  if (eventTypes.has("company_creation_accepted")) completed.add("company_creation_accepted");
  if (eventTypes.has("company_creation_blueprint_parsed") || eventTypes.has("company_creation_records_created") || eventTypes.has("company_creation_completed")) {
    completed.add("company_creation_agent_started");
  }
  if (eventTypes.has("company_creation_blueprint_parsed")) completed.add("company_creation_blueprint_parsed");
  if (eventTypes.has("company_creation_records_created") || eventTypes.has("company_creation_completed")) completed.add("company_creation_records_created");
  if (eventTypes.has("company_creation_completed")) completed.add("company_creation_completed");

  const firstIncomplete = creationStepTypes.findIndex((type) => !completed.has(type));
  const activeIndex = firstIncomplete === -1 ? creationStepTypes.length - 1 : firstIncomplete;

  return creationStepTypes.map((type, index) => ({
    type,
    label: t(creationStepLabelKeys[type]),
    state: completed.has(type)
      ? "complete"
      : failed && index === activeIndex
        ? "failed"
        : !failed && index === activeIndex
          ? "current"
          : "pending",
  }));
}

const creationStepLabelKeys = {
  company_creation_accepted: "creating.stepAccepted",
  company_creation_agent_started: "creating.stepGeneratingBlueprint",
  company_creation_blueprint_parsed: "creating.stepBlueprintParsed",
  company_creation_records_created: "creating.stepRecordsCreated",
  company_creation_completed: "creating.stepCompleted",
} as const;

function StepIcon({ state }: { state: CreationStepState }) {
  if (state === "complete") {
    return (
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-emerald-500 text-white">
        <Check aria-hidden="true" className="size-3.5" />
      </span>
    );
  }
  if (state === "current") return <LoaderCircle aria-hidden="true" className="size-6 animate-spin text-ring" />;
  if (state === "failed") return <CircleAlert aria-hidden="true" className="size-6 text-destructive" />;
  return <Circle aria-hidden="true" className="size-6 text-muted-foreground/45" />;
}
