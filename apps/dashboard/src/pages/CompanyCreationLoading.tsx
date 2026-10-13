import { ArrowLeft, Check, ChevronRight, Circle, CircleAlert, Info, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentSummary, CompanyEventSummary } from "../api/client";
import { CompanyFlowPage } from "../components/company-flow";
import { Button, Card } from "../components/ui";
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
      {isFailed ? (
        <CreationFailureRecovery
          failureMessage={failureMessage}
          isRetrying={isRetrying}
          leave={leave}
          onRetry={onRetry}
          summary={summary}
          trace={trace}
        />
      ) : (
        <CreationTraceCards summary={summary} trace={trace} traceId={traceId} />
      )}

      {isFailed && stopCommand ? (
        <Card aria-labelledby={nextStepsId} className="grid gap-3 p-4 sm:p-6" role="region">
          <h2 className="text-base font-semibold text-foreground" id={nextStepsId}>
            {t("creating.nextSteps")}
          </h2>
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
type SummaryItem = { label: string; value: string };

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

function CreationTraceCards({ summary, trace, traceId }: { summary: SummaryItem[]; trace: CreationStep[]; traceId: string }) {
  const { t } = useLanguage();
  return (
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
          <span className="text-sm text-muted-foreground">{t("creating.status")}</span>
        </div>
        <SummaryGrid summary={summary} />
      </div>

      <ol className="mx-auto grid w-full max-w-3xl gap-2">
        {trace.map((step, index) => (
          <li className="relative" key={step.type}>
            {index < trace.length - 1 ? <span aria-hidden="true" className="absolute left-[1.55rem] top-[2.75rem] h-3 w-px bg-border/80" /> : null}
            <Card
              className={cn(
                "grid min-h-14 grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 bg-card/86 p-3 backdrop-blur sm:p-4",
                step.state === "current" && "creation-step-current border-ring/50 bg-card",
              )}
            >
              <StepIcon state={step.state} />
              <span className={cn("text-sm font-medium text-foreground", step.state === "pending" && "text-muted-foreground")}>{step.label}</span>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CreationFailureRecovery({
  failureMessage,
  isRetrying,
  leave,
  onRetry,
  summary,
  trace,
}: {
  failureMessage: string | null;
  isRetrying: boolean;
  leave?: { kind: "other" | "new"; run(): void };
  onRetry?: () => void;
  summary: SummaryItem[];
  trace: CreationStep[];
}) {
  const { t } = useLanguage();
  const failedIndex = Math.max(trace.findIndex((step) => step.state === "failed"), 0);
  const completedSteps = trace.filter((step) => step.state === "complete");
  const pendingCount = trace.filter((step) => step.state === "pending").length;
  const failedStep = trace[failedIndex] ?? trace[0]!;
  return (
    <Card aria-label={t("creating.failureTitle")} className="grid gap-5 p-4 sm:p-5" role="region">
      <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
        <span className="flex size-12 items-center justify-center rounded-lg bg-red-50 text-destructive">
          <CircleAlert aria-hidden="true" className="size-6" />
        </span>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <h2 className="text-xl font-semibold leading-tight text-foreground">{t("creating.failureTitle")}</h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("creating.failureSummary")}</p>
          </div>
          <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t("creating.failurePreserved")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={isRetrying} onClick={onRetry} size="lg">
              <RefreshCw aria-hidden="true" />
              {isRetrying ? t("creating.retrying") : t("creating.retry")}
            </Button>
            {leave ? (
              <Button onClick={leave.run} size="lg" variant="outline">
                {leave.kind === "other" ? <ArrowLeft aria-hidden="true" /> : <Plus aria-hidden="true" />}
                {t(leave.kind === "other" ? "creating.backToOtherCompany" : "creating.createNewCompany")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="border-t border-border/70 pt-4">
        <SummaryGrid summary={summary} />
      </div>

      <section aria-label={t("creating.progress")} className="grid gap-3 border-t border-border/70 pt-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-foreground">{t("creating.progress")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("creating.stoppedAt")
                .replace("{step}", String(failedIndex + 1))
                .replace("{total}", String(trace.length))}
            </p>
          </div>
          <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-destructive">{t("creating.failedBadge")}</span>
        </div>
        <ol className="grid grid-cols-5 gap-1.5" aria-hidden="true">
          {trace.map((step) => (
            <li
              className={cn(
                "h-1.5 rounded-full bg-muted",
                step.state === "complete" && "bg-emerald-500",
                step.state === "failed" && "bg-destructive",
              )}
              key={step.type}
            />
          ))}
        </ol>
        <ol className="grid gap-2">
          {completedSteps.map((step) => (
            <li className="flex items-center gap-2 text-sm text-muted-foreground" key={step.type}>
              <StepIcon state="complete" />
              <span>{step.label}</span>
            </li>
          ))}
          <li className="flex items-center gap-2 text-sm font-medium text-foreground">
            <StepIcon state="failed" />
            <span>{failedStep.label}</span>
          </li>
          {pendingCount > 0 ? (
            <li className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted-foreground/70" />
              <span>{t("creating.remainingSteps").replace("{count}", String(pendingCount))}</span>
            </li>
          ) : null}
        </ol>
        {failureMessage ? (
          <details className="group text-sm">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground">
              <ChevronRight aria-hidden="true" className="size-4 transition-transform group-open:rotate-90" />
              {t("creating.technicalDetails")}
            </summary>
            <p className="mt-2 rounded-md bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground">{failureMessage}</p>
          </details>
        ) : null}
      </section>
    </Card>
  );
}

function SummaryGrid({ summary }: { summary: SummaryItem[] }) {
  return (
    <dl className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-4">
      {summary.map((item) => (
        <div className="min-w-0" key={item.label}>
          <dt className="text-xs font-medium uppercase tracking-wide">{item.label}</dt>
          <dd className="truncate font-medium normal-case text-foreground" title={item.value}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function StepIcon({ state }: { state: CreationStepState }) {
  if (state === "complete") {
    return (
      <span className="inline-flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white">
        <Check aria-hidden="true" className="size-3" />
      </span>
    );
  }
  if (state === "current") return <LoaderCircle aria-hidden="true" className="size-5 animate-spin text-ring" />;
  if (state === "failed") return <CircleAlert aria-hidden="true" className="size-5 text-destructive" />;
  return <Circle aria-hidden="true" className="size-5 text-muted-foreground/45" />;
}
