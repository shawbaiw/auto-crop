import { ArrowLeft, Check, ChevronRight, Circle, CircleAlert, Info, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AgentSummary, CompanyEventSummary } from "../api/client";
import { AmbientBackground, Panel, PillButton, ReadingSurface, StatusTag } from "../components/ice-mist";
import { LanguageSwitch } from "../components/workbench";
import { AgentIcon } from "../components/workbench/AgentIcon";
import { cn } from "@/lib/utils";
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
   * A failed creation is retried or left for another company, so this page is never a dead end.
   * "other" returns to another company; "new" opens the Onboarding Wizard when there is none.
   */
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
  leave,
}: CompanyCreationLoadingProps) {
  const { language, t } = useLanguage();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const titleId = "company-creation-dialog-title";
  const traceId = "company-creation-trace";

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const agentName = selectedAgent?.name ?? selectedAgentId ?? t("creating.selectedAgent");
  const policyName = formatPermissionMode(permissionMode, t);
  const trace = creationTrace(events, isFailed, t, elapsedSeconds);
  const traceElapsedSeconds = creationElapsedSeconds(events, isFailed, elapsedSeconds);
  const failedEvent = [...events].reverse().find((event) => event.type === "company_creation_failed");
  const failureMessage = failedEvent ? resolveLocalizedValue(failedEvent.messageText, language, failedEvent.message) : null;

  return (
    <div className="modern-dashboard-shell">
      <AmbientBackground>
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-[var(--module-gap)]">
          <header className="flex min-h-[var(--hit-min)] flex-wrap items-center justify-between gap-3">
            <span className="text-[15px] font-semibold">{t("menu.app")}</span>
            <LanguageSwitch />
          </header>

          <Panel aria-labelledby={titleId} className="flex flex-col gap-[var(--module-gap)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0 break-words text-[17px] font-semibold">{companyName}</span>
              {isFailed ? <StatusTag tone="failed">{t("creating.failed")}</StatusTag> : <StatusTag tone="running">{t("creating.statusText")}</StatusTag>}
            </div>

            <div className="flex flex-col gap-3">
              <h1 className="break-words text-[34px] font-[350] normal-case leading-[1.1] tracking-[-0.02em] sm:text-[42px]" id={titleId}>
                {isFailed ? t("creating.failureTitle") : t("creating.status")}
              </h1>
              <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px] font-medium text-[color:var(--text-secondary)]">
                <div className="inline-flex gap-1.5">
                  <dt>{t("creating.ceo")}</dt>
                  <dd className="inline-flex items-center gap-1.5 text-[color:var(--text-primary)]">
                    <AgentIcon agentId={selectedAgent?.id ?? selectedAgentId ?? ""} decorative name={agentName} />
                    {agentName}
                  </dd>
                </div>
                <div className="inline-flex gap-1.5">
                  <dt>{t("creating.policy")}</dt>
                  <dd className="text-[color:var(--text-primary)]">{policyName}</dd>
                </div>
                {traceElapsedSeconds !== null ? (
                  <div className="inline-flex gap-1.5">
                    <dt>{isFailed ? t("creating.stoppedAfter") : t("creating.runningFor")}</dt>
                    <dd className="text-[color:var(--text-primary)]">{formatDuration(traceElapsedSeconds)}</dd>
                  </div>
                ) : null}
              </dl>
            </div>

            <section aria-labelledby={traceId} className="flex flex-col gap-4 border-t border-[color:var(--edge-divider)] pt-[var(--module-gap)]">
              <h2 className="text-[13px] font-medium normal-case text-[color:var(--text-secondary)]" id={traceId}>
                {t("creating.trace")}
              </h2>
              <ol className="flex flex-col">
                {trace.map((step, index) => (
                  <CreationTraceStep isLast={index === trace.length - 1} key={step.type} step={step}>
                    {step.state === "failed" ? (
                      <CreationFailureRecovery agentName={agentName} failureMessage={failureMessage} isRetrying={isRetrying} leave={leave} onRetry={onRetry} />
                    ) : null}
                  </CreationTraceStep>
                ))}
              </ol>
            </section>
          </Panel>
        </div>
      </AmbientBackground>
    </div>
  );
}

type CreationStepState = "complete" | "current" | "failed" | "pending";
type CreationStep = { type: string; label: string; state: CreationStepState; durationLabel?: string };

const creationStepTypes = [
  "company_creation_accepted",
  "company_creation_agent_started",
  "company_creation_blueprint_parsed",
  "company_creation_records_created",
  "company_creation_completed",
] as const;

function creationTrace(events: CompanyEventSummary[], failed: boolean, t: (key: TranslationKey) => string, elapsedSeconds: number): CreationStep[] {
  const eventTypes = new Set(events.map((event) => event.type));
  const eventByType = new Map(events.map((event) => [event.type, event]));
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

  return creationStepTypes.map((type, index) => {
    const state = completed.has(type)
      ? "complete"
      : failed && index === activeIndex
        ? "failed"
        : !failed && index === activeIndex
          ? "current"
          : "pending";
    return {
      type,
      label: t(creationStepLabelKeys[type]),
      state,
      durationLabel: durationLabelForStep(type, index, state, eventByType, elapsedSeconds),
    };
  });
}

const creationStepLabelKeys = {
  company_creation_accepted: "creating.stepAccepted",
  company_creation_agent_started: "creating.stepGeneratingBlueprint",
  company_creation_blueprint_parsed: "creating.stepBlueprintParsed",
  company_creation_records_created: "creating.stepRecordsCreated",
  company_creation_completed: "creating.stepCompleted",
} as const;

const stepStateKeys = {
  complete: "creating.stepState.complete",
  current: "creating.stepState.current",
  failed: "creating.stepState.failed",
  pending: "creating.stepState.pending",
} as const;

/** One row of the trace: icon on a thin connector, label, real duration; the failed row expands in place. */
function CreationTraceStep({ children, isLast, step }: { children?: ReactNode; isLast: boolean; step: CreationStep }) {
  const isCurrent = step.state === "current";
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-4">
      <div className="relative flex justify-center pt-[3px]">
        {!isLast ? <span aria-hidden="true" className="absolute bottom-0 top-[27px] w-px bg-[color:var(--edge-input)]" /> : null}
        <StepIcon state={step.state} />
      </div>
      <div className={cn("min-w-0", !isLast && "pb-5")}>
        <div
          className={cn(
            "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1",
            isCurrent && "-mx-3 -mt-1.5 rounded-[var(--r-reading)] border border-[color:var(--edge-highlight)] bg-[color:var(--surface-reading)] px-3 py-1.5",
          )}
        >
          <span
            className={cn(
              "text-[15px] leading-[1.6]",
              step.state === "pending" ? "text-[color:var(--text-secondary)]" : "text-[color:var(--text-primary)]",
              (isCurrent || step.state === "failed") && "font-semibold",
            )}
          >
            {step.label}
            <StepStateText state={step.state} />
          </span>
          {step.durationLabel ? <span className="im-code text-[color:var(--text-secondary)]">{step.durationLabel}</span> : null}
        </div>
        {children}
      </div>
    </li>
  );
}

function StepStateText({ state }: { state: CreationStepState }) {
  const { t } = useLanguage();
  return <span className="sr-only"> · {t(stepStateKeys[state])}</span>;
}

function StepIcon({ state }: { state: CreationStepState }) {
  if (state === "complete") {
    return (
      <span className="relative z-10 inline-flex size-5 items-center justify-center rounded-[var(--r-pill)] bg-[color:var(--status-success-fg)] text-[color:var(--text-on-dark)]">
        <Check aria-hidden="true" className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (state === "current") {
    return <LoaderCircle aria-hidden="true" className="im-spin relative z-10 size-5 text-[color:var(--status-running-fg)]" />;
  }
  if (state === "failed") {
    return (
      <span className="relative z-10 inline-flex size-5 items-center justify-center rounded-[var(--r-pill)] bg-[color:var(--status-failed-fg)] text-[12px] font-bold leading-none text-[color:var(--text-on-dark)]">
        <span aria-hidden="true">!</span>
      </span>
    );
  }
  return <Circle aria-hidden="true" className="relative z-10 size-5 text-[color:var(--text-secondary)]" strokeWidth={1.5} />;
}

/**
 * The recovery area under the failed step (spec §5.2, trimmed by the product owner): a one-line summary
 * that opens to the full raw error, what was kept, then retry or leave. A failed creation is retried or
 * left; it is not abandoned from here.
 */
function CreationFailureRecovery({
  agentName,
  failureMessage,
  isRetrying,
  leave,
  onRetry,
}: {
  agentName: string;
  failureMessage: string | null;
  isRetrying: boolean;
  leave?: { kind: "other" | "new"; run(): void };
  onRetry?: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="mt-3 flex flex-col gap-4">
      {failureMessage ? (
        <details className="group">
          <summary className="flex min-h-[var(--hit-min)] cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--r-reading)] bg-[color:var(--status-failed-bg)] px-4 py-2 outline-none focus-visible:shadow-[var(--focus-ring)]">
            <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-[color:var(--status-failed-fg)]" />
            <span className="text-[15px] font-medium">{failureSummary(failureMessage, agentName, t)}</span>
            <span className="inline-flex items-center gap-0.5 text-[13px] font-medium text-[color:var(--status-failed-fg)]">
              <span aria-hidden="true">·</span>
              {t("creating.viewErrorDetails")}
              <ChevronRight aria-hidden="true" className="size-4 transition-transform duration-[var(--dur)] ease-[var(--ease)] group-open:rotate-90" />
            </span>
          </summary>
          <ReadingSurface className="mt-2">
            <p className="im-code whitespace-pre-wrap text-[color:var(--text-primary)]">{failureMessage}</p>
          </ReadingSurface>
        </details>
      ) : null}

      <p className="flex max-w-[72ch] items-start gap-2 text-[15px] leading-[1.6] text-[color:var(--text-secondary)]">
        <Info aria-hidden="true" className="mt-1 size-4 shrink-0" />
        {t("creating.failurePreserved")}
      </p>

      {onRetry || leave ? (
        <section aria-label={t("creating.nextSteps")} className="flex flex-wrap gap-3">
          {onRetry ? (
            <PillButton disabled={isRetrying} onClick={onRetry} variant="primary">
              <RefreshCw aria-hidden="true" />
              {isRetrying ? t("creating.retrying") : t("creating.retry")}
            </PillButton>
          ) : null}
          {leave ? (
            <PillButton onClick={leave.run} variant="secondary">
              {leave.kind === "other" ? <ArrowLeft aria-hidden="true" /> : <Plus aria-hidden="true" />}
              {t(leave.kind === "other" ? "creating.backToOtherCompany" : "creating.createNewCompany")}
            </PillButton>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function durationLabelForStep(
  type: string,
  index: number,
  state: CreationStepState,
  eventByType: Map<string, CompanyEventSummary>,
  elapsedSeconds: number,
) {
  const stepEvent = eventByType.get(type);
  const start = parseEventTime(stepEvent);
  const nextType = creationStepTypes[index + 1];
  const nextEvent = nextType ? eventByType.get(nextType) : undefined;
  const failedAt = parseEventTime(eventByType.get("company_creation_failed"));
  const end = state === "complete" ? parseEventTime(nextEvent) : state === "failed" ? failedAt : null;
  if (start !== null && end !== null && end >= start) return formatStepDuration((end - start) / 1000);
  if (state === "current") return formatStepDuration(elapsedSeconds);
  // A failed step without both timestamps has no real duration; the page clock is not one (spec: no invented data).
  return "";
}

function parseEventTime(event: CompanyEventSummary | undefined) {
  if (!event?.createdAt) return null;
  const timestamp = Date.parse(event.createdAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Real time from acceptance to failure, or null when the events do not carry it; never the page clock. */
function creationElapsedSeconds(events: CompanyEventSummary[], failed: boolean, elapsedSeconds: number): number | null {
  if (!failed) return elapsedSeconds;
  const first = events.find((event) => event.type === "company_creation_accepted") ?? events[0];
  const failedEvent = [...events].reverse().find((event) => event.type === "company_creation_failed");
  const start = parseEventTime(first);
  const end = parseEventTime(failedEvent);
  if (start !== null && end !== null && end >= start) return (end - start) / 1000;
  return null;
}

function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds * 10) / 10);
  if (rounded < 10) return `${rounded.toFixed(1)}s`;
  return `${Math.round(rounded)}s`;
}

function formatStepDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds * 10) / 10);
  return `${rounded.toFixed(1)}s`;
}

/**
 * A one-line summary built only from what the raw error reliably says: a timeout, or else that the agent
 * ran into an error. It never guesses a cause; the full message is one click away.
 */
function failureSummary(message: string, agentName: string, t: (key: TranslationKey) => string) {
  if (/timed out/i.test(message)) return t("creating.failureTimedOut");
  return t("creating.failureAgentError").replace("{agent}", agentName);
}
