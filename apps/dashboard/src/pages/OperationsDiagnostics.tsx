import { Activity, AlertTriangle, FileCheck2, ListChecks } from "lucide-react";
import { useMemo } from "react";
import type { HumanActionSummary, ServerEvent, TaskSummary, WaitStateSummary } from "../api/client";
import { WorkbenchSection } from "../components/workbench/WorkbenchSection";
import { KeyValueList, LineList, type KeyValueItem } from "../components/workbench/KeyValueList";
import { useLanguage, type TranslationKey } from "../ui/language";
import { taskTitle } from "../ui/language/localizedNames";
import { resolveLocalizedValue } from "../ui/language/localizedText";
import { formatCodeLabel } from "../ui/tasks/formatDisplayValue";
import { formatTaskStatus } from "../ui/tasks/formatTaskStatus";

export type OperationsDiagnosticsProps = {
  events: ServerEvent[];
  humanActions: HumanActionSummary[];
  tasks: TaskSummary[];
  waitStates: WaitStateSummary[];
};

const stuckStatuses = new Set(["blocked", "failed", "needs_replan"]);

/**
 * How work is flowing and where it is stuck, with raw codes kept under Details (dashboard ADR 0002).
 * New plans are requested and confirmed on the department page of the task.
 */
export function OperationsDiagnostics({
  events,
  humanActions,
  tasks,
  waitStates,
}: OperationsDiagnosticsProps) {
  const { language, t } = useLanguage();
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const activityRows = useMemo(
    () => events.map((event) => formatAgentActivityEvent(event, event.taskId ? tasksById.get(event.taskId) : undefined, language, t)),
    [events, tasksById, language, t],
  );
  const counts = countTasks(tasks);
  const stuckTasks = tasks.filter((task) => stuckStatuses.has(task.status));
  const reviewTasks = tasks.filter((task) => task.taskKind !== "department_subtask" && task.status === "review");

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t("diagnostics.intro")}</p>

      <WorkbenchSection icon={<ListChecks aria-hidden="true" />} title={t("diagnostics.taskFlow")}>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={t("diagnostics.countRunning")} tone="text-blue-700" value={counts.running} />
          <Stat label={t("diagnostics.countWaiting")} tone="text-slate-600" value={counts.waiting} />
          <Stat label={t("diagnostics.countReview")} tone="text-violet-700" value={counts.review} />
          <Stat label={t("diagnostics.countNeedsYou")} tone="text-amber-700" value={counts.needsYou} />
          <Stat label={t("diagnostics.countFailed")} tone="text-red-700" value={counts.failed} />
          <Stat label={t("diagnostics.countComplete")} tone="text-emerald-700" value={counts.complete} />
          <Stat
            label={t("diagnostics.needsYourAction")}
            tone="text-amber-700"
            value={humanActions.filter((action) => action.status === "pending").length}
          />
          <Stat label={t("diagnostics.waitingFor")} tone="text-slate-600" value={waitStates.length} />
        </dl>
      </WorkbenchSection>

      <WorkbenchSection icon={<AlertTriangle aria-hidden="true" />} title={t("diagnostics.stuck")}>
        {stuckTasks.length === 0 ? <p className="text-sm text-muted-foreground">{t("diagnostics.noStuck")}</p> : null}
        <ul className="grid gap-2">
          {stuckTasks.map((task) => (
            <li className="grid gap-1 rounded-md border border-border/70 p-3" key={task.id}>
              <p className="text-sm">
                {stuckSentence(task, language, t)}
              </p>
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">{t("workbench.details")}</summary>
                <KeyValueList className="mt-2" items={taskDetails(task, t)} />
              </details>
            </li>
          ))}
        </ul>
      </WorkbenchSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <WorkbenchSection icon={<Activity aria-hidden="true" />} title={t("diagnostics.activity")}>
          <LineList emptyMessage={t("operations.waitingActivity")} lines={activityRows} />
        </WorkbenchSection>
        <WorkbenchSection icon={<FileCheck2 aria-hidden="true" />} title={t("diagnostics.reviewQueue")}>
          <LineList emptyMessage={t("diagnostics.noReview")} lines={reviewTasks.map((task) => taskTitle(task, language))} />
        </WorkbenchSection>
      </div>
    </div>
  );
}


function Stat({ label, tone, value }: { label: string; tone: string; value: number }) {
  return (
    <div className="grid gap-0.5 rounded-md bg-muted/60 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`m-0 text-xl font-semibold ${tone}`}>{value}</dd>
    </div>
  );
}

/** "{title} is {status}." — without a doubled stop when the status already ends a sentence. */
function stuckSentence(task: TaskSummary, language: "en" | "zh", t: (key: TranslationKey) => string): string {
  return t("diagnostics.stuckSentence")
    .replace("{title}", taskTitle(task, language))
    .replace("{status}", formatTaskStatus(task, t))
    .replace(/([.。!?！？])[.。]$/, "$1");
}

function countTasks(tasks: TaskSummary[]) {
  const counts = { running: 0, waiting: 0, review: 0, needsYou: 0, failed: 0, complete: 0 };
  for (const task of tasks) {
    if (task.status === "running" || task.status === "retrying") counts.running += 1;
    else if (task.status === "queued" || task.status === "waiting_dependency") counts.waiting += 1;
    else if (task.status === "review") counts.review += 1;
    else if (task.status === "blocked" || task.status === "needs_replan") counts.needsYou += 1;
    else if (task.status === "failed") counts.failed += 1;
    else if (task.status === "complete") counts.complete += 1;
  }
  return counts;
}

/** The raw execution details behind a stuck task's plain sentence. */
function taskDetails(task: TaskSummary, t: (key: TranslationKey) => string): KeyValueItem[] {
  return [
    { label: t("diagnostics.detailStatus"), value: task.status },
    ...(task.failureReason ? [{ label: t("diagnostics.detailReason"), value: task.failureReason }] : []),
    ...(task.failureMessage ? [{ label: t("diagnostics.detailMessage"), value: task.failureMessage }] : []),
    ...(task.effectiveTimeoutMs ? [{ label: t("diagnostics.detailBudget"), value: formatBudget(task.effectiveTimeoutMs) }] : []),
    ...(task.executionProfileName ? [{ label: t("diagnostics.detailProfile"), value: task.executionProfileName }] : []),
    ...(task.dependencyNote ? [{ label: t("diagnostics.detailDependency"), value: task.dependencyNote }] : []),
    ...(task.artifactWorkspacePath ? [{ label: t("diagnostics.detailWorkspace"), value: task.artifactWorkspacePath }] : []),
  ];
}

function formatAgentActivityEvent(event: ServerEvent, task: TaskSummary | undefined, language: "en" | "zh", t: (key: TranslationKey) => string): string {
  const title = task ? taskTitle(task, language) : t("operations.unknownTask");
  return `${formatAgentActivityState(event, t)} · ${title} — ${formatAgentActivityDetail(event, language, t)}`;
}

function formatAgentActivityState(event: ServerEvent, t: (key: TranslationKey) => string): string {
  switch (event.type) {
    case "task_started":
      return t("operations.running");
    case "dependency_waiting":
      return t("operations.waiting");
    case "task_retrying":
      return t("operations.retrying");
    case "task_needs_replan":
      return t("operations.needsReplan");
    case "deliverable_missing":
      return t("operations.missingDeliverable");
    case "task_review":
      return t("operations.readyForReview");
    case "task_failed":
      return t("operations.failed");
    case "task_blocked":
      return t("operations.blocked");
    case "task_warning":
      return t("operations.warning");
    case "partial_output":
      return t("operations.partialOutput");
    case "automatic_acceptance":
      return t("operations.acceptedAutomatically");
    case "founder_decision":
      return t("operations.founderDecision");
    case "ceo_review_decision":
      return t("operations.ceoReviewDecision");
    default:
      return event.status ? formatCodeLabel(event.status) : t("operations.activity");
  }
}

function formatAgentActivityDetail(event: ServerEvent, language: "en" | "zh", t: (key: TranslationKey) => string): string {
  if (event.type === "task_started") {
    return event.effectiveTimeoutMs
      ? `${t("operations.agentWorking")} ${t("operations.budget")}: ${formatBudget(event.effectiveTimeoutMs)}.`
      : t("operations.agentWorking");
  }

  if (event.type === "task_review") {
    return t("operations.proofReady");
  }

  if (event.type === "dependency_waiting") {
    return event.dependencyNote ?? cleanActivityMessage(resolveLocalizedValue(event.messageText, language, event.message)) ?? t("operations.waitingDependencyProof");
  }

  if (event.type === "task_retrying") {
    return t("operations.retryingBudget");
  }

  if (event.type === "task_needs_replan") {
    return t("operations.needsReplanDetail");
  }

  if (event.type === "deliverable_missing") {
    return event.dependencyNote ?? t("operations.missingDeliverableDetail");
  }

  if (event.type === "task_failed") {
    return formatFailureDetail(event.failureReason, t);
  }

  if (event.type === "task_blocked") {
    return event.dependencyNote ?? cleanActivityMessage(resolveLocalizedValue(event.messageText, language, event.message)) ?? t("operations.waitingDependency");
  }

  if (event.type === "task_warning") {
    return cleanActivityMessage(resolveLocalizedValue(event.messageText, language, event.message)) ?? t("operations.needsAttention");
  }

  if (event.type === "partial_output") {
    return event.artifactWorkspacePath
      ? `${event.artifactWorkspacePath} ${t("operations.diagnosticPath")}`
      : t("operations.diagnosticOnly");
  }

  if (event.type === "automatic_acceptance") {
    return cleanActivityMessage(resolveLocalizedValue(event.messageText, language, event.message)) ?? t("operations.acceptedAutomaticallyDetail");
  }

  if (event.type === "founder_decision") {
    return cleanActivityMessage(resolveLocalizedValue(event.messageText, language, event.message)) ?? t("operations.founderDecisionDetail");
  }

  if (event.type === "ceo_review_decision") {
    return cleanActivityMessage(resolveLocalizedValue(event.messageText, language, event.message)) ?? t("operations.ceoReviewDecisionDetail");
  }

  return cleanActivityMessage(resolveLocalizedValue(event.messageText, language, event.message)) ?? t("operations.newActivity");
}

function formatFailureDetail(reason: string | undefined, t: (key: TranslationKey) => string): string {
  switch (reason) {
    case "timeout":
      return t("operations.failureTimeout");
    case "no_proof":
      return t("operations.failureNoProof");
    case "proof_capture_failed":
      return t("operations.failureProofCapture");
    case "dependency_failed":
      return t("operations.failureDependency");
    case "missing_deliverable":
      return t("operations.failureMissingDeliverable");
    case "needs_replan":
      return t("operations.needsReplanDetail");
    case "agent_failed":
      return t("operations.failureAgent");
    case "invalid_agent_output":
      return t("operations.failureInvalidAgentOutput");
    default:
      return t("operations.failureDefault");
  }
}

function formatBudget(timeoutMs: number): string {
  const seconds = timeoutMs / 1000;
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
}

function cleanActivityMessage(message: string): string | null {
  const cleaned = message
    .replace(/^Task warning:\s*/i, "")
    .replace(/^Task blocked:\s*/i, "")
    .replace(/^Task failed:\s*/i, "")
    .replace(/^Partial Output:\s*/i, "")
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}
