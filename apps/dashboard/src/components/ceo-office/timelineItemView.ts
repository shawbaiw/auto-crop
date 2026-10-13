import type { CeoOfficeItemSummary, Locale, LocalizedText, TaskSummary } from "../../api/client";
import { useLanguage, type TranslationKey } from "../../ui/language";
import { taskTitle } from "../../ui/language/localizedNames";
import { formatCodeLabel } from "../../ui/tasks/formatDisplayValue";
import { formatDecisionKind } from "./formatDecisionKind";

export type TranslateFn = ReturnType<typeof useLanguage>["t"];

/**
 * A localized line resolver bound to the company canonical locale (ADR 0013 → single canonical
 * locale). When the company-locale value is absent it returns a visible "untranslated" marker and
 * logs the gap, rather than silently falling back to another locale — the founder should see it as a
 * gap, not the intended content. A field that is simply not present (`null`) returns "" so a
 * caller's `|| t("ceoOffice.none")` fallback wins.
 */
type LineResolver = (text: LocalizedText | null | undefined) => string;

export function makeLineResolver(companyLocale: Locale, t: TranslateFn): LineResolver {
  return (text) => {
    if (!text) {
      return "";
    }
    const value = text[companyLocale];
    if (value && value.trim().length > 0) {
      return value;
    }
    console.warn(
      `[CeoOffice] localized field is missing the company locale "${companyLocale}"; available locales: ${
        Object.keys(text).join(", ") || "none"
      }`,
    );
    return t("ceoOffice.untranslated");
  };
}

// Largest-unit relative time ("2 hours ago", "3 天前"), so a card reads like a feed.
const RELATIVE_TIME_DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

export function formatTimelineRelativeTime(iso: string, language: Locale): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    return iso;
  }
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  let duration = (timestamp - Date.now()) / 1000;
  for (const division of RELATIVE_TIME_DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return iso;
}

/**
 * Everything a card and its dialog need to turn one CEO Office Item into founder-facing text.
 * Business content is resolved against the company canonical locale (ADR 0013); the interface
 * language governs only the chrome, through `t`. `line` is for agent-authored prose and shows the
 * visible "untranslated" marker; `localize` is for names and titles and falls back instead.
 */
export type TimelineRenderContext = {
  locale: Locale;
  line: LineResolver;
  localize: (text: LocalizedText | null | undefined, fallback: string) => string;
  t: TranslateFn;
  tasksById: Map<string, TaskSummary>;
};

type TimelineItemView = {
  /** The one line a card leads with: the point of the item. */
  keyLine: string;
  /** The full detail, shown only inside the dialog. */
  rows: Array<{ label: string; value: string }>;
};

/**
 * The single place each item's key line and detail rows are defined, so the card and the dialog
 * never drift. Labels use the founder words of dashboard ADR 0002; no internal term reaches them.
 */
export function timelineItemView(item: CeoOfficeItemSummary, ctx: TimelineRenderContext): TimelineItemView {
  const { line, t, tasksById, locale } = ctx;
  const tasks = (ids: string[]) => formatTimelineTasks(ids, tasksById, locale, t);
  const none = t("ceoOffice.none");
  switch (item.type) {
    case "plan_brief":
      return {
        keyLine: t("ceoOffice.planBriefLine").replace("{count}", String(item.data.taskCount)),
        rows: item.data.tasks.map((task) => ({
          label: line(task.title),
          value: [
            line(task.purpose),
            task.dependsOnTaskIds.length
              ? `${t("ceoOffice.row.dependsOn")}: ${task.dependsOnTaskIds.map((id) => line(item.data.tasks.find((candidate) => candidate.taskId === id)?.title)).filter(Boolean).join(", ")}`
              : "",
          ].filter(Boolean).join(" — "),
        })),
      };
    case "task_brief":
      return {
        keyLine: line(item.data.purpose),
        rows: [
          { label: t("ceoOffice.row.approach"), value: line(item.data.approach) || t("ceoOffice.notRecorded") },
          { label: t("ceoOffice.row.expectedOutcome"), value: line(item.data.expectedOutcome) || t("ceoOffice.notRecorded") },
          { label: t("ceoOffice.row.objective"), value: line(item.data.objectiveTitle) || none },
          { label: t("ceoOffice.row.keyResult"), value: line(item.data.keyResultTitle) || none },
          { label: t("ceoOffice.row.metric"), value: item.data.keyResultMetricName ?? none },
          { label: t("ceoOffice.row.target"), value: line(item.data.keyResultTargetValue) || none },
          { label: t("ceoOffice.row.dependsOn"), value: tasks(item.data.dependsOnTaskIds) },
        ],
      };
    case "execution_report":
      return {
        keyLine: line(item.data.conclusion) || line(item.data.summaryFallback) || none,
        rows: [
          { label: t("ceoOffice.row.workSummary"), value: line(item.data.workSummary) || t("ceoOffice.notRecorded") },
          { label: t("ceoOffice.row.evidence"), value: line(item.data.evidence) || t("ceoOffice.notRecorded") },
          { label: t("ceoOffice.row.visionImpact"), value: line(item.data.visionImpact) || none },
          { label: t("ceoOffice.row.remainingGap"), value: line(item.data.remainingGap) || joinLabels(item.data.remainingGaps, none) },
          { label: t("ceoOffice.row.recommendation"), value: line(item.data.recommendation) || joinLabels(item.data.recommendedNextSteps, none) },
        ],
      };
    case "decision_request":
      return {
        keyLine: item.data.briefing || item.data.rationale || none,
        rows: [
          { label: t("ceoOffice.row.decisionKind"), value: formatDecisionKind(item.data.decisionKind, t) },
          { label: t("ceoOffice.row.status"), value: formatTimelineStatus(item.data.status, t) },
          { label: t("ceoOffice.row.rationale"), value: item.data.rationale || none },
          { label: t("ceoOffice.row.chosenOption"), value: item.data.resolvedOption ?? none },
          { label: t("ceoOffice.row.blockedTasks"), value: tasks(item.data.blockedTaskIds) },
        ],
      };
    case "approval_request":
      return {
        keyLine: t("ceoOffice.reviewWaiting"),
        rows: [{ label: t("ceoOffice.row.status"), value: formatTimelineStatus(item.data.status, t) }],
      };
    case "decision_resolution":
      return {
        keyLine: line(item.data.note) || item.data.chosenOption || formatCompletionOutcome(item.data.outcome, t),
        rows: [
          { label: t("ceoOffice.row.resolution"), value: formatCompletionOutcome(item.data.outcome, t) },
          { label: t("ceoOffice.row.chosenOption"), value: item.data.chosenOption ?? none },
        ],
      };
    case "human_action":
      return {
        keyLine: line(item.data.label),
        rows: [
          { label: t("ceoOffice.row.status"), value: formatTimelineStatus(item.data.status, t) },
          { label: t("ceoOffice.row.confirmationNeeded"), value: item.data.confirmationRequirements.join(", ") || none },
          { label: t("ceoOffice.row.blockedTasks"), value: tasks(item.data.blockedTaskIds) },
          ...(item.data.verifiedAt ? [{ label: t("ceoOffice.row.verifiedAt"), value: new Date(item.data.verifiedAt).toLocaleString(locale) }] : []),
        ],
      };
    case "wait_state":
      return {
        keyLine: line(item.data.reason),
        rows: [
          { label: t("ceoOffice.row.status"), value: formatTimelineStatus(item.data.status, t) },
          { label: t("ceoOffice.row.nextCheck"), value: new Date(item.data.nextCheckAt).toLocaleString(locale) },
          { label: t("ceoOffice.row.affectedTasks"), value: tasks(item.data.affectedTaskIds) },
        ],
      };
    case "blocked_issue":
      return {
        keyLine: line(item.data.reason),
        rows: [
          { label: t("ceoOffice.row.status"), value: formatTimelineStatus(item.data.status, t) },
          { label: t("ceoOffice.row.affectedTasks"), value: tasks(item.data.affectedTaskIds) },
        ],
      };
    case "stage_change":
      return {
        keyLine: line(item.data.summary),
        rows: [
          { label: t("ceoOffice.row.recommendation"), value: line(item.data.recommendedNextAction) },
          { label: t("ceoOffice.row.tasks"), value: tasks(item.data.affectedTaskIds) },
        ],
      };
    case "final_report":
      return {
        keyLine: line(item.data.sections.actualResult),
        rows: [
          { label: t("ceoOffice.row.report"), value: item.data.isCurrent ? t("ceoOffice.currentReport") : t("ceoOffice.supersededReport") },
          { label: t("ceoOffice.report.vision"), value: line(item.data.sections.vision) },
          { label: t("ceoOffice.report.goalFit"), value: line(item.data.sections.goalFit) },
          { label: t("ceoOffice.report.remainingGaps"), value: line(item.data.sections.remainingGaps) },
          { label: t("ceoOffice.report.nextStep"), value: line(item.data.sections.recommendedNextStep) },
        ],
      };
    case "founder_intake":
      // The founder's own words are raw source content, shown as written (CONTEXT: Interface Locale).
      return { keyLine: item.data.body, rows: [] };
    case "intake_outcome":
      return {
        keyLine: item.data.status === "failed" ? intakeFailureSentence(item.data.failureReason, t) : line(item.data.summary) || none,
        rows: item.data.createdTaskIds.length > 0 ? [{ label: t("ceoOffice.intakeNewTasks"), value: tasks(item.data.createdTaskIds) }] : [],
      };
  }
}

/** The plain sentence for an intake the CEO could not handle. The code itself stays under Details. */
export function intakeFailureSentence(reason: string | null, t: TranslateFn): string {
  switch (reason) {
    case "plan_not_made":
      return t("ceoOffice.intakeFailed.plan");
    case "company_stopped":
      return t("ceoOffice.intakeFailed.stopped");
    case "no_ceo_agent":
      return t("ceoOffice.intakeFailed.noAgent");
    default:
      return t("ceoOffice.intakeFailed.agent");
  }
}

const ceoOfficeTimelineOrder: Record<CeoOfficeItemSummary["type"], number> = {
  plan_brief: -1,
  task_brief: 0,
  execution_report: 1,
  decision_request: 2,
  approval_request: 3,
  human_action: 4,
  wait_state: 5,
  blocked_issue: 6,
  decision_resolution: 7,
  stage_change: 8,
  final_report: 9,
  founder_intake: 10,
  intake_outcome: 11,
};

export function compareCeoOfficeTimelineItems(a: CeoOfficeItemSummary, b: CeoOfficeItemSummary): number {
  return Date.parse(a.occurredAt) - Date.parse(b.occurredAt) ||
    ceoOfficeTimelineOrder[a.type] - ceoOfficeTimelineOrder[b.type] ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function formatCeoOfficeItemType(type: CeoOfficeItemSummary["type"], t: TranslateFn): string {
  return t(`ceoOffice.type.${type}` as TranslationKey);
}

function joinLabels(entries: Array<{ label: string }>, emptyLabel: string): string {
  return entries.length === 0 ? emptyLabel : entries.map((entry) => entry.label).join(" ");
}

/**
 * Task references render as task titles, never raw IDs, resolved in the company canonical locale like
 * the rest of the timeline. Falls back to a localized count only when no ID resolves to a known task.
 */
export function formatTimelineTasks(taskIds: string[], tasksById: Map<string, TaskSummary>, locale: Locale, t: TranslateFn): string {
  if (taskIds.length === 0) {
    return t("ceoOffice.none");
  }
  const titles = taskIds
    .map((taskId) => {
      const task = tasksById.get(taskId);
      return task ? taskTitle(task, locale) : null;
    })
    .filter((title): title is string => Boolean(title));
  if (titles.length > 0) {
    return titles.join(", ");
  }
  const countKey = taskIds.length === 1 ? "ceoOffice.taskCountOne" : "ceoOffice.taskCountOther";
  return t(countKey).replace("{count}", String(taskIds.length));
}

// Enum-class values render through translation keys; an unmapped value still de-snakes through
// `formatCodeLabel`, so the timeline never shows raw snake_case.
const TIMELINE_STATUSES = new Set(["pending", "resolved", "returned", "approved", "confirmed", "waiting", "ready_for_check_in", "open"]);
const COMPLETION_OUTCOMES = new Set([
  "accepted", "blocked", "failed_to_review", "needs_replan", "awaiting_founder_decision", "awaiting_human_action", "resolved", "approved", "returned",
]);

function formatTimelineStatus(status: string, t: TranslateFn): string {
  return TIMELINE_STATUSES.has(status) ? t(`ceoOffice.status.${status}` as TranslationKey) : formatCodeLabel(status);
}

function formatCompletionOutcome(outcome: string, t: TranslateFn): string {
  return COMPLETION_OUTCOMES.has(outcome) ? t(`ceoOffice.outcome.${outcome}` as TranslationKey) : formatCodeLabel(outcome);
}
