import { Bot, CircleAlert, Eye, Hand, Sparkle, User } from "lucide-react";
import type { CeoOfficeItemSummary, CompanySummary, DepartmentSummary } from "../../api/client";
import { Button } from "@/components/ui";
import { StatusTag } from "../ice-mist";
import { cn } from "@/lib/utils";
import { isUnseenSince } from "../../ui/ceoOutcomes/lastSeen";
import { useLanguage, type TranslationKey } from "../../ui/language";
import { departmentName } from "../../ui/language/localizedNames";
import { formatCeoOfficeItemType, formatTimelineRelativeTime, formatTimelineTasks, timelineItemView, type TimelineRenderContext } from "./timelineItemView";

/**
 * Timeline materials (spec §3, §5.3): agents speak from translucent panels with a highlight edge; text
 * reads at 15px within 72 characters; meta stays 13px secondary, never lighter.
 */
const agentCard = "grid gap-2 rounded-[var(--r-panel)] border border-[color:var(--edge-highlight)] bg-[color:var(--surface-panel)] px-5 py-4";
const cardTitle = "text-[15px] font-semibold leading-snug";
const cardBody = "max-w-[72ch] text-[15px] leading-relaxed text-foreground";
const cardMeta = "text-[13px] text-muted-foreground";
const cardMetaRow = "flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium text-muted-foreground";

/** What every CEO Office card needs from its page. */
export type CeoOfficeView = {
  ctx: TimelineRenderContext;
  companyStatus: CompanySummary["status"];
  departmentsById: Map<string, DepartmentSummary>;
  lastSeen: string | null;
  onOpenItem(item: CeoOfficeItemSummary): void;
  onOpenDepartment(departmentId: string): void;
  /** Opens a task on its department page, where its trace and new plans are. */
  onOpenTask(taskId: string): void;
  onOpenCeoOffice(): void;
  /** Which department each intake was sent to (null for CEO Office), to name where passed-on input came from. */
  intakeDepartments: Map<string, string | null>;
};

/** Cards that ask the founder to act, while they still do. They carry the charcoal "your turn" tag. */
function needsFounder(item: CeoOfficeItemSummary): boolean {
  return item.actionBearing && (item.type === "decision_request" || item.type === "approval_request" || item.type === "human_action" || item.type === "blocked_issue");
}

/**
 * One CEO Office Item as a card: what kind it is, which department, when, its title and its point.
 * The title opens the full detail; the department name opens that department's page (ADR 0002).
 */
export function CeoOfficeCard({ item, view }: { item: CeoOfficeItemSummary; view: CeoOfficeView }) {
  if (item.type === "founder_intake") return <FounderIntakeCard item={item} view={view} />;
  if (item.type === "intake_outcome") return <IntakeOutcomeCard item={item} view={view} />;

  const { ctx } = view;
  const title = ctx.localize(item.titleText, item.title);
  const typeLabel = formatCeoOfficeItemType(item.type, ctx.t);
  return (
    <article className={agentCard}>
      <CardMeta item={item} typeLabel={typeLabel} view={view} />
      <button
        aria-label={ctx.t("ceoOffice.openCard").replace("{type}", typeLabel).replace("{title}", title)}
        className="grid gap-1 rounded-[var(--r-reading)] text-left focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
        onClick={() => view.onOpenItem(item)}
        type="button"
      >
        <span className={cardTitle}>{title}</span>
        <span className={cardBody}>{timelineItemView(item, ctx).keyLine}</span>
        {item.type === "task_brief" ? <TaskBriefLines data={item.data} view={view} /> : null}
      </button>
    </article>
  );
}

/** A Task Brief is one announcement: its goal and key result on a line, then the tasks it needs first. */
function TaskBriefLines({ data, view }: { data: Extract<CeoOfficeItemSummary, { type: "task_brief" }>["data"]; view: CeoOfficeView }) {
  const { ctx } = view;
  const goal = [ctx.line(data.objectiveTitle), ctx.line(data.keyResultTitle)].filter(Boolean).join(" / ");
  return (
    <>
      {goal ? <span className={cardMeta}>{goal}</span> : null}
      {data.dependsOnTaskIds.length > 0 ? (
        <span className={cardMeta}>
          {`${ctx.t("ceoOffice.row.dependsOn")}: ${formatTimelineTasks(data.dependsOnTaskIds, ctx.tasksById, ctx.locale, ctx.t)}`}
        </span>
      ) : null}
    </>
  );
}

function CardMeta({ item, typeLabel, view }: { item: CeoOfficeItemSummary; typeLabel: string; view: CeoOfficeView }) {
  const { language, t } = useLanguage();
  const department = item.departmentId ? view.departmentsById.get(item.departmentId) : undefined;
  const name = department ? departmentName(department, view.ctx.locale) : null;
  return (
    <div className={cardMetaRow}>
      {needsFounder(item) ? (
        <StatusTag icon={item.type === "approval_request" ? Eye : Hand} tone="yourTurn">
          {typeLabel}
        </StatusTag>
      ) : (
        <span className="font-semibold text-foreground">{typeLabel}</span>
      )}
      {department && name ? (
        <Button
          aria-label={t("ceoOffice.openDepartment").replace("{department}", name)}
          className="text-[13px] font-medium text-muted-foreground"
          onClick={() => view.onOpenDepartment(department.id)}
          variant="link"
        >
          {name}
        </Button>
      ) : null}
      <time dateTime={item.occurredAt}>{formatTimelineRelativeTime(item.occurredAt, language)}</time>
      {isUnseenSince(item.occurredAt, view.lastSeen) ? (
        <StatusTag icon={Sparkle} tone="running">
          {t("ceoOffice.new")}
        </StatusTag>
      ) : null}
    </div>
  );
}

/** Who answers an intake: the CEO, or the department it was sent to. */
function intakeSpeaker(departmentId: string | null, view: CeoOfficeView, t: ReturnType<typeof useLanguage>["t"]): string {
  const department = departmentId ? view.departmentsById.get(departmentId) : undefined;
  return department ? departmentName(department, view.ctx.locale) : t("ceoOffice.type.intake_outcome");
}

/** The founder's own message, as sent, with a line while its agent has not answered yet. */
function FounderIntakeCard({ item, view }: { item: Extract<CeoOfficeItemSummary, { type: "founder_intake" }>; view: CeoOfficeView }) {
  const { language, t } = useLanguage();
  const speaker = intakeSpeaker(item.departmentId, view, t);
  const waiting: TranslationKey | null =
    item.data.status === "received"
      ? view.companyStatus === "paused" ? "ceoOffice.intakeWaitsForResume" : "ceoOffice.intakeReceived"
      : item.data.status === "assessing" || item.data.status === "assessment_complete" || item.data.status === "planning"
        ? "ceoOffice.intakeAssessing"
        : null;
  const routedFrom = item.data.routedFromIntakeId;
  const source = routedFrom && view.intakeDepartments.has(routedFrom) ? intakeSpeaker(view.intakeDepartments.get(routedFrom) ?? null, view, t) : null;
  return (
    // The founder's own words: on the right, on the brighter reading surface, no edge (spec §3).
    <article aria-label={t("ceoOffice.type.founder_intake")} className="ml-auto grid w-fit max-w-[min(36rem,90%)] gap-1.5 rounded-[var(--r-reading)] bg-[color:var(--surface-reading)] px-4 py-3">
      <div className={cardMetaRow}>
        <User aria-hidden="true" className="size-4" />
        <span className="font-semibold text-foreground">{t("ceoOffice.type.founder_intake")}</span>
        <time dateTime={item.occurredAt}>{formatTimelineRelativeTime(item.occurredAt, language)}</time>
      </div>
      {source ? <p className={cardMeta}>{t("ceoOffice.intakePassedOnFrom").replace("{source}", source)}</p> : null}
      <p className={cn(cardBody, "whitespace-pre-wrap break-words")}>{item.data.body}</p>
      {waiting ? <p className={cardMeta}>{t(waiting).replace("{agent}", speaker)}</p> : null}
    </article>
  );
}

/** The agent's answer to one message: what it decided, in the company's words, and where it led. */
function IntakeOutcomeCard({ item, view }: { item: Extract<CeoOfficeItemSummary, { type: "intake_outcome" }>; view: CeoOfficeView }) {
  const { language, t } = useLanguage();
  const { ctx } = view;
  const speaker = intakeSpeaker(item.departmentId, view, t);
  const failed = item.data.status === "failed";
  const headline = failed
    ? t("ceoOffice.intakeFailedTitle")
    : item.data.outcome ? t(`ceoOffice.intakeOutcome.${item.data.outcome}` as TranslationKey) : speaker;
  const linkedTasks = [...item.data.createdTaskIds, ...(item.data.outcome === "attach_to_task" && item.data.targetTaskId ? [item.data.targetTaskId] : [])]
    .map((id) => ctx.tasksById.get(id))
    .filter((task): task is NonNullable<typeof task> => Boolean(task));
  const targetDepartment = item.data.targetDepartmentId ? view.departmentsById.get(item.data.targetDepartmentId) : undefined;
  return (
    <article aria-label={`${speaker}: ${headline}`} className={cn(agentCard, "max-w-[min(40rem,95%)]")}>
      <div className={cardMetaRow}>
        {failed ? <CircleAlert aria-hidden="true" className="size-4 text-status-failed-icon" /> : <Bot aria-hidden="true" className="size-4" />}
        <span className="font-semibold text-foreground">{speaker}</span>
        <time dateTime={item.occurredAt}>{formatTimelineRelativeTime(item.occurredAt, language)}</time>
      </div>
      <p className={cardTitle}>{headline}</p>
      <p className={cardBody}>{timelineItemView(item, ctx).keyLine}</p>
      {linkedTasks.length > 0 && !failed ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-muted-foreground">{t(item.data.outcome === "attach_to_task" ? "ceoOffice.intakeTask" : "ceoOffice.intakeNewTasks")}:</span>
          {linkedTasks.map((task) => (
            <Button key={task.id} onClick={() => view.onOpenTask(task.id)} variant="link">
              {formatTimelineTasks([task.id], ctx.tasksById, ctx.locale, t)}
            </Button>
          ))}
        </div>
      ) : null}
      {item.data.outcome === "revise_plan" && item.data.replanProposalId && item.data.targetTaskId && !failed ? (
        <Button className="justify-self-start" onClick={() => view.onOpenTask(item.data.targetTaskId!)} size="sm" variant="outline">
          {t("ceoOffice.intakeOpenNewPlan")}
        </Button>
      ) : null}
      {item.data.outcome === "route_department" && targetDepartment && !failed ? (
        <Button className="justify-self-start" onClick={() => view.onOpenDepartment(targetDepartment.id)} size="sm" variant="outline">
          {t("ceoOffice.openDepartment").replace("{department}", departmentName(targetDepartment, ctx.locale))}
        </Button>
      ) : null}
      {item.data.outcome === "route_to_ceo" && !failed ? (
        <Button className="justify-self-start" onClick={view.onOpenCeoOffice} size="sm" variant="outline">
          {t("ceoOffice.openCeoOffice")}
        </Button>
      ) : null}
      {failed && item.data.failureReason ? (
        <details className={cardMeta}>
          <summary className="cursor-pointer">{t("workbench.details")}</summary>
          <code className="im-code mt-1 block">{item.data.failureReason}</code>
        </details>
      ) : null}
    </article>
  );
}
