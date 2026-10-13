import { ArrowLeft, Check, Circle, CircleAlert, LoaderCircle, Plus, RefreshCw } from "lucide-react";
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

  const agentName = selectedAgent?.name ?? selectedAgentId ?? t("creating.selectedAgent");
  const policyName = formatPermissionMode(permissionMode, t);
  const trace = creationTrace(events, isFailed, t, elapsedSeconds);
  const traceElapsedSeconds = creationElapsedSeconds(events, isFailed, elapsedSeconds);
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
      <CreationTraceTimeline
        agentName={agentName}
        elapsedSeconds={traceElapsedSeconds}
        failureMessage={failureMessage}
        isFailed={isFailed}
        policyName={policyName}
        trace={trace}
        traceId={traceId}
      />

      {isFailed && (onRetry || leave || stopCommand) ? (
        <Card aria-labelledby={nextStepsId} className="grid gap-3 p-4 sm:p-6" role="region">
          <h2 className="text-base font-semibold text-foreground" id={nextStepsId}>
            {t("creating.nextSteps")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {onRetry ? (
              <Button disabled={isRetrying} onClick={onRetry}>
                <RefreshCw aria-hidden="true" />
                {isRetrying ? t("creating.retrying") : t("creating.retry")}
              </Button>
            ) : null}
            {leave ? (
              <Button onClick={leave.run} variant="outline">
                {leave.kind === "other" ? <ArrowLeft aria-hidden="true" /> : <Plus aria-hidden="true" />}
                {t(leave.kind === "other" ? "creating.backToOtherCompany" : "creating.createNewCompany")}
              </Button>
            ) : null}
          </div>
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
      durationLabel: durationLabelForStep(type, index, state, eventByType, failed, elapsedSeconds),
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

function CreationTraceTimeline({
  agentName,
  elapsedSeconds,
  failureMessage,
  isFailed,
  policyName,
  trace,
  traceId,
}: {
  agentName: string;
  elapsedSeconds: number;
  failureMessage: string | null;
  isFailed: boolean;
  policyName: string;
  trace: CreationStep[];
  traceId: string;
}) {
  const { t } = useLanguage();
  return (
    <section
      aria-labelledby={traceId}
      className="relative isolate overflow-hidden rounded-lg border border-border/60 bg-background/70 p-4 shadow-workbench backdrop-blur-md sm:p-6"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--accent)/0.22),transparent_46%),linear-gradient(180deg,hsl(var(--card)/0.78),hsl(var(--background)/0.72))]" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 className="text-base font-semibold text-foreground" id={traceId}>
          {t("creating.trace")}
        </h2>
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <div className="inline-flex gap-1.5">
            <dt>{t("creating.ceo")}</dt>
            <dd className="font-semibold text-foreground">{agentName}</dd>
          </div>
          <div className="inline-flex gap-1.5">
            <dt>{t("creating.policy")}</dt>
            <dd className="font-semibold text-foreground">{policyName}</dd>
          </div>
          <div className="inline-flex gap-1.5">
            <dt>{isFailed ? t("creating.stoppedAfter") : t("creating.runningFor")}</dt>
            <dd className="font-semibold text-foreground">{formatDuration(elapsedSeconds)}</dd>
          </div>
        </dl>
      </div>

      <ol className="mt-6 grid gap-0">
        {trace.map((step, index) => (
          <li className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-x-4" key={step.type}>
            <div className="relative flex justify-center">
              {index < trace.length - 1 ? <span aria-hidden="true" className="absolute top-6 h-full w-px bg-border" /> : null}
              <StepIcon state={step.state} />
            </div>
            <div className="min-w-0 pb-6">
              <div className={cn("text-base text-muted-foreground", step.state === "complete" && "text-foreground", (step.state === "current" || step.state === "failed") && "font-semibold text-foreground")}>
                {step.label}
              </div>
              {step.state === "failed" && failureMessage ? <p className="mt-1 text-sm text-destructive">{shortFailureMessage(failureMessage, t("creating.failedBadge"))}</p> : null}
            </div>
            <div className="pb-6 pt-0.5 font-mono text-sm text-muted-foreground">{step.durationLabel}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StepIcon({ state }: { state: CreationStepState }) {
  if (state === "complete") {
    return (
      <span className="relative z-10 inline-flex size-5 items-center justify-center rounded-full bg-emerald-600 text-white">
        <Check aria-hidden="true" className="size-3" />
      </span>
    );
  }
  if (state === "current") return <LoaderCircle aria-hidden="true" className="relative z-10 size-5 animate-spin bg-background text-ring" />;
  if (state === "failed") {
    return (
      <span className="relative z-10 inline-flex size-5 items-center justify-center rounded-full bg-destructive text-xs font-bold leading-none text-destructive-foreground">
        !
      </span>
    );
  }
  return <Circle aria-hidden="true" className="relative z-10 size-5 bg-background text-muted-foreground/35" />;
}

function durationLabelForStep(
  type: string,
  index: number,
  state: CreationStepState,
  eventByType: Map<string, CompanyEventSummary>,
  failed: boolean,
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
  if (state === "failed" && start === null) return formatStepDuration(elapsedSeconds);
  if (state === "failed" && !failed && start !== null) return formatDuration(elapsedSeconds);
  return "";
}

function parseEventTime(event: CompanyEventSummary | undefined) {
  if (!event?.createdAt) return null;
  const timestamp = Date.parse(event.createdAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function creationElapsedSeconds(events: CompanyEventSummary[], failed: boolean, elapsedSeconds: number) {
  if (!failed) return elapsedSeconds;
  const first = events.find((event) => event.type === "company_creation_accepted") ?? events[0];
  const failedEvent = [...events].reverse().find((event) => event.type === "company_creation_failed");
  const start = parseEventTime(first);
  const end = parseEventTime(failedEvent);
  if (start !== null && end !== null && end >= start) return (end - start) / 1000;
  return elapsedSeconds;
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

function shortFailureMessage(message: string, failureLabel: string) {
  return message.replace(/^Company Creation failed:\s*/i, `${failureLabel} · `);
}
