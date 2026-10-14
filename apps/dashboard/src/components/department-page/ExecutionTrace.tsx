import { ChevronDown, CircleAlert, CircleCheck, CircleDot, Eye, LoaderCircle, Pause } from "lucide-react";
import type {
  CeoOfficeItemSummary,
  ReplanProposalSummary,
  TaskProgressEventSummary,
  TaskSummary,
  WaitStateSummary,
} from "../../api/client";
import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ReplanProposalCard } from "../replan/ReplanProposalCard";
import { ReplanRequestForm, type ReplanRequest } from "../replan/ReplanRequestForm";
import { StatusTag } from "../ice-mist";
import { TaskStatusBadge } from "../task/TaskStatusBadge";
import { taskStatusTone, taskStatusToneLabelKey } from "../task/taskStatusTone";
import { KeyValueList } from "../workbench/KeyValueList";
import type { CeoOfficeView } from "../ceo-office/CeoOfficeCard";
import { useLanguage, type TranslationKey } from "../../ui/language";
import { taskTitle } from "../../ui/language/localizedNames";
import { resolveLocalizedValue } from "../../ui/language/localizedText";
import { TaskExecutionPanel } from "../../ui/tasks/TaskExecutionPanel";
import { TaskActions, type TaskActionHandlers } from "./TaskActions";
import { failingStepId, traceRuns, traceState, type TraceRun } from "./traceModel";

export type ReplanHandlers = {
  onCreateReplanProposal(taskId: string, request: ReplanRequest): Promise<void> | void;
  onConfirmReplanProposal(proposalId: string): Promise<void> | void;
  onRejectReplanProposal(proposalId: string, note: string | null): Promise<void> | void;
};

/**
 * One task as an Execution Trace (dashboard ADR 0002): its plan (the Execution Brief), the steps the
 * runtime recorded, and its result. Until ADR 0047 lands the steps are the runtime's progress steps;
 * hidden model reasoning is never shown. Only the latest run is shown in full.
 */
export function ExecutionTrace({
  actions,
  expanded,
  focused,
  items,
  onToggle,
  progressEvents,
  proposals,
  replan,
  replanFormOpen,
  onReplanFormChange,
  task,
  tasks,
  view,
  waitStates,
}: {
  actions: TaskActionHandlers;
  expanded: boolean;
  focused: boolean;
  items: CeoOfficeItemSummary[];
  onToggle(): void;
  progressEvents: TaskProgressEventSummary[];
  proposals: ReplanProposalSummary[];
  replan: ReplanHandlers;
  replanFormOpen: boolean;
  onReplanFormChange(open: boolean): void;
  task: TaskSummary;
  tasks: TaskSummary[];
  view: CeoOfficeView;
  waitStates: WaitStateSummary[];
}) {
  const { language, t } = useLanguage();
  const { ctx } = view;
  const state = traceState(task);
  const tone = taskStatusTone(task.status);
  const runs = traceRuns(task, progressEvents);
  const latest = runs.at(-1);
  const stepCount = runs.reduce((sum, run) => sum + run.steps.length, 0);
  const title = taskTitle(task, ctx.locale);
  const brief = [...items].reverse().find((item): item is Extract<CeoOfficeItemSummary, { type: "task_brief" }> => item.type === "task_brief" && item.taskId === task.id);
  const report = [...items].reverse().find((item): item is Extract<CeoOfficeItemSummary, { type: "execution_report" }> => item.type === "execution_report" && item.taskId === task.id);
  const review = items.find((item) => item.type === "approval_request" && item.taskId === task.id && item.actionBearing);
  // Proposals awaiting a decision are shown; one gone stale says so, and a new one can be asked for.
  const waiting = proposals.filter((proposal) => proposal.status === "proposed");
  const current = waiting.filter((proposal) => !proposal.stale);
  // With none waiting, the last one the founder rejected or the planner could not make, and why.
  const shown = waiting.length > 0
    ? waiting
    : proposals.filter((proposal) => proposal.status === "rejected" || proposal.status === "failed").sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 1);
  const offersReplan = (task.affordances ?? []).some((affordance) => affordance.kind === "request_replan");
  const statusLabel = t(taskStatusToneLabelKey[tone]);
  const hold = task.holds?.[0];
  // What holds the task, in a plain sentence; the codes stay under Details.
  const holdLine = hold ? resolveLocalizedValue(hold.reasonText, language, hold.reason) : state === "stopped" ? task.failureMessage ?? null : null;
  const subtasks = tasks.filter((candidate) => candidate.parentTaskId === task.id && candidate.taskKind === "department_subtask");
  const waits = waitStates.filter((waitState) => waitState.taskId === task.id || waitState.affectedTaskIds.includes(task.id));

  return (
    <Card
      aria-label={title}
      className={cn("grid gap-3 p-4 scroll-mt-4 transition-shadow duration-[var(--dur)]", focused && "shadow-[var(--focus-ring)]")}
      id={`trace-${task.id}`}
      role="region"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <h3 className={cn("text-sm font-semibold leading-snug", tone === "cancelled" && "text-muted-foreground line-through")}>{title}</h3>
          {state === "settled" && !expanded ? (
            <p className="text-xs text-muted-foreground">
              {t("departmentPage.summary").replace("{status}", statusLabel).replace("{count}", String(stepCount))}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <TaskStatusBadge status={task.status} />
          <Button aria-expanded={expanded} aria-label={t(expanded ? "departmentPage.hideSteps" : "departmentPage.showSteps")} onClick={onToggle} size="icon" variant="ghost">
            <ChevronDown aria-hidden="true" className={cn("transition-transform", expanded && "rotate-180")} />
          </Button>
        </div>
      </div>

      {holdLine && state !== "settled" ? (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          {state === "stopped" ? <Pause aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
          {holdLine}
        </p>
      ) : null}
      {waits.map((waitState) => (
        <p className="text-sm text-muted-foreground" key={waitState.id}>
          {t("departmentPage.waitingFor")
            .replace("{reason}", waitState.reason)
            .replace("{time}", new Date(waitState.nextCheckAt).toLocaleString(language))}
        </p>
      ))}

      {expanded ? (
        <div className="grid gap-3">
          {brief ? (
            <section aria-label={t("departmentPage.plan")} className="grid gap-1 text-sm">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("departmentPage.plan")}</h4>
              <p>{ctx.line(brief.data.purpose)}</p>
              {brief.data.approach ? <p className="text-muted-foreground">{t("ceoOffice.row.approach")}: {ctx.line(brief.data.approach)}</p> : null}
              {brief.data.expectedOutcome ? <p className="text-muted-foreground">{t("ceoOffice.row.expectedOutcome")}: {ctx.line(brief.data.expectedOutcome)}</p> : null}
            </section>
          ) : null}
          {runs.length > 1 ? (
            <ul aria-label={t("departmentPage.earlierRuns")} className="grid gap-1">
              {runs.slice(0, -1).map((run) => (
                <li key={run.index}>
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">
                      {t("departmentPage.earlierRun").replace("{index}", String(run.index)).replace("{outcome}", stepLabel(run.steps.at(-1), language))}
                    </summary>
                    <TraceSteps run={run} highlight={null} />
                  </details>
                </li>
              ))}
            </ul>
          ) : null}
          {subtasks.length > 0 ? (
            <section aria-label={t("departmentPage.subtasks")} className="grid gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("departmentPage.subtasks")}</h4>
              {subtasks.map((subtask) => {
                const subtone = taskStatusTone(subtask.status);
                return (
                  <div className="grid gap-1.5 rounded-md border border-border/70 p-2" key={subtask.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className={cn(subtone === "cancelled" && "line-through text-muted-foreground")}>{taskTitle(subtask, ctx.locale)}</span>
                      <TaskStatusBadge status={subtask.status} />
                    </div>
                    <TaskActions handlers={actions} locale={ctx.locale} task={subtask} />
                  </div>
                );
              })}
            </section>
          ) : null}
          <section aria-label={t("departmentPage.steps")} className="grid gap-1">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("departmentPage.steps")}</h4>
            {latest ? <TraceSteps highlight={state === "stopped" ? failingStepId(latest) : null} run={latest} /> : <p className="text-sm text-muted-foreground">{t("departmentPage.noSteps")}</p>}
          </section>
        </div>
      ) : null}

      <TraceResult report={report} review={review} task={task} view={view} />

      {/* Actions stay mounted when a trace folds, so the outcome of one the founder just took stays in view. */}
      <TaskActions
        handlers={actions}
        locale={ctx.locale}
        onRequestReplan={offersReplan && current.length === 0 ? () => {
          if (!expanded) onToggle();
          onReplanFormChange(!replanFormOpen);
        } : undefined}
        task={task}
      />
      {expanded ? (
        <>
          <TaskExecutionPanel task={task} />
          {replanFormOpen && offersReplan && current.length === 0 ? (
            <ReplanRequestForm
              onSubmit={async (request) => {
                await replan.onCreateReplanProposal(task.id, request);
                onReplanFormChange(false);
              }}
              taskTitle={title}
            />
          ) : null}
          {shown.map((proposal) => (
            <ReplanProposalCard key={proposal.id} onConfirm={replan.onConfirmReplanProposal} onReject={replan.onRejectReplanProposal} proposal={proposal} tasks={tasks} />
          ))}
          {state === "stopped" || task.failureReason ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">{t("workbench.details")}</summary>
              <KeyValueList className="mt-2" items={taskDetails(task, t)} />
            </details>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function stepLabel(step: TaskProgressEventSummary | undefined, language: "en" | "zh"): string {
  return step ? resolveLocalizedValue(step.labelText, language, step.label) : "";
}

function TraceSteps({ highlight, run }: { highlight: string | null; run: TraceRun }) {
  const { language } = useLanguage();
  return (
    <ol className="grid gap-1.5">
      {run.steps.map((step) => (
        <li className={cn("flex items-start gap-2 text-sm", step.id === highlight && "rounded-md bg-status-running-bg px-1.5 py-1")} key={step.id}>
          <StepIcon status={step.status} />
          <div className="grid min-w-0 gap-0.5">
            <span>{stepLabel(step, language)}</span>
            {step.detail ? <span className="break-words text-xs text-muted-foreground">{resolveLocalizedValue(step.detailText, language, step.detail)}</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepIcon({ status }: { status: TaskProgressEventSummary["status"] }) {
  if (status === "complete") return <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-success-icon" />;
  if (status === "blocked") return <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" />;
  if (status === "current") return <LoaderCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin text-status-running-icon" />;
  return <CircleDot aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-neutral-icon" />;
}

/** The final result stays in view, folded or not: what the work concluded, or what it waits for. */
function TraceResult({
  report,
  review,
  task,
  view,
}: {
  report: Extract<CeoOfficeItemSummary, { type: "execution_report" }> | undefined;
  review: CeoOfficeItemSummary | undefined;
  task: TaskSummary;
  view: CeoOfficeView;
}) {
  const { t } = useLanguage();
  if (task.status === "review" && review) {
    return (
      <div className="im-reading flex flex-wrap items-center gap-2 text-sm">
        <StatusTag icon={Eye} tone="yourTurn">
          {t("ceoOffice.taskStatus.review")}
        </StatusTag>
        <span className="min-w-0 flex-1">{t("departmentPage.waitsForReview")}</span>
        <Button onClick={() => view.onOpenItem(review)} size="sm">{t("departmentPage.openReview")}</Button>
      </div>
    );
  }
  if (task.status !== "complete") return null;
  const conclusion = report ? view.ctx.line(report.data.conclusion) || view.ctx.line(report.data.summaryFallback) : "";
  return (
    <section aria-label={t("departmentPage.result")} className="im-reading grid gap-1 text-sm">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground">
        <CircleCheck aria-hidden="true" className="size-3.5 text-status-success-icon" />
        {t("departmentPage.result")}
      </h4>
      <p>{conclusion || t("departmentPage.done")}</p>
    </section>
  );
}

/** The raw execution details behind a task's plain sentence, kept under Details. */
function taskDetails(task: TaskSummary, t: (key: TranslationKey) => string) {
  return [
    { label: t("diagnostics.detailStatus"), value: task.status },
    ...(task.failureReason ? [{ label: t("diagnostics.detailReason"), value: task.failureReason }] : []),
    ...(task.failureMessage ? [{ label: t("diagnostics.detailMessage"), value: task.failureMessage }] : []),
    ...(task.dependencyNote ? [{ label: t("diagnostics.detailDependency"), value: task.dependencyNote }] : []),
    ...(task.artifactWorkspacePath ? [{ label: t("diagnostics.detailWorkspace"), value: task.artifactWorkspacePath }] : []),
  ];
}
