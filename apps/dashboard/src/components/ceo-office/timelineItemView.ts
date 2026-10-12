import type { CeoOfficeItemSummary, Locale, LocalizedText, TaskSummary } from "../../api/client";
import { useLanguage, type TranslationKey } from "../../ui/language";
import { taskTitle } from "../../ui/language/localizedNames";
import { formatCodeLabel } from "../../ui/tasks/formatDisplayValue";
import { formatDecisionKind } from "./formatDecisionKind";

/**
 * A localized line resolver bound to the company canonical locale (ADR 0013 → single canonical
 * locale). Used by both the CEO Office Timeline and the Final Founder Report panel. When the
 * company-locale value is absent it returns a visible "untranslated" marker and logs the gap, rather
 * than silently falling back to another locale — the founder should see it as a gap, not the intended
 * content (spec Decision 2). A field that is simply not present (`null`) returns "" so a caller's
 * `|| t("department.none")` fallback wins.
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
    return t("department.timelineUntranslated");
  };
}

// Largest-unit relative time ("2 hours ago", "3 天前"), so a card reads like a broadcast feed.
const RELATIVE_TIME_DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

export function formatTimelineRelativeTime(iso: string, language: "en" | "zh"): string {
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
 * Everything the card and modal need to turn one timeline item into founder-facing text. The CEO
 * Office timeline is the founder's broadcast surface, so every value in it is resolved against the
 * company canonical locale (ADR 0013) — never the dashboard language toggle, which governs chrome
 * only. `line` is for agent-authored prose: it shows the visible "untranslated" marker when the
 * company-locale value is missing. `localize` is for blueprint-authored names and titles: it falls
 * back to the other locale and then the canonical string rather than showing a marker as a headline.
 */
export type TimelineRenderContext = {
  locale: Locale;
  line: LineResolver;
  localize: (text: LocalizedText | null | undefined, fallback: string) => string;
  t: TranslateFn;
  tasksById: Map<string, TaskSummary>;
};

type TimelineItemView = {
  /** The one key line a summary card leads with: the point of the item. */
  keyLine: string;
  /** The full key-value detail, shown only inside the modal. */
  rows: Array<{ label: string; value: string }>;
};

/**
 * The single place each timeline item's key line and detail rows are defined, so the card and the
 * modal never drift. The Decision card leads with the briefing; options and rationale are secondary
 * (spec). `execution_report` conclusion falls back to the older `outcome_summary` compatibility text;
 * the projection only emits the item when one of those carries a body, so there is always a key line.
 */
export function timelineItemView(item: CeoOfficeItemSummary, ctx: TimelineRenderContext): TimelineItemView {
  const { line, t, tasksById, locale } = ctx;
  const tasks = (ids: string[]) => formatTimelineTasks(ids, tasksById, locale, t);
  const none = t("department.none");
  switch (item.type) {
    case "plan_brief":
      return {
        keyLine: `${t("department.timelinePlanBriefPrefix")}${item.data.taskCount}${t("department.timelinePlanBriefSuffix")}`,
        rows: [
          ...item.data.tasks.map(task => ({
            label: line(task.title),
            value: [line(task.purpose), task.dependsOnTaskIds.length ? `${t("department.timelineDependencies")}: ${task.dependsOnTaskIds.map(id => line(item.data.tasks.find(candidate => candidate.taskId === id)?.title)).filter(Boolean).join(", ")}` : ""].filter(Boolean).join(" — "),
          })),
        ],
      };
    case "task_brief":
      return {
        keyLine: line(item.data.purpose),
        rows: [
          { label: t("department.timelineApproach"), value: line(item.data.approach) || t("department.timelineNotRecorded") },
          { label: t("department.timelineExpectedOutcome"), value: line(item.data.expectedOutcome) || t("department.timelineNotRecorded") },
          { label: t("department.timelineObjective"), value: line(item.data.objectiveTitle) || none },
          { label: t("department.timelineKeyResult"), value: line(item.data.keyResultTitle) || none },
          { label: t("department.timelineMetric"), value: item.data.keyResultMetricName ?? none },
          { label: t("department.timelineTarget"), value: line(item.data.keyResultTargetValue) || none },
          { label: t("department.timelineDependencies"), value: tasks(item.data.dependsOnTaskIds) },
        ],
      };
    case "execution_report":
      return {
        keyLine: line(item.data.conclusion) || line(item.data.summaryFallback) || none,
        rows: [
          { label: t("department.timelineWorkSummary"), value: line(item.data.workSummary) || t("department.timelineNotRecorded") },
          { label: t("department.timelineEvidence"), value: line(item.data.evidence) || t("department.timelineNotRecorded") },
          { label: t("department.timelineVisionImpact"), value: line(item.data.visionImpact) || none },
          { label: t("department.timelineRemainingGap"), value: line(item.data.remainingGap) || formatTimelineGaps(item.data.remainingGaps, none) },
          { label: t("department.timelineRecommendation"), value: line(item.data.recommendation) || formatTimelineNextSteps(item.data.recommendedNextSteps, none) },
        ],
      };
    case "decision_request":
      return {
        keyLine: item.data.briefing || item.data.rationale || none,
        rows: [
          { label: t("department.timelineBriefing"), value: item.data.briefing || none },
          { label: t("department.founderDecisionKind"), value: formatDecisionKind(item.data.decisionKind, t) },
          { label: t("department.status"), value: formatTimelineStatus(item.data.status, t) },
          { label: t("department.timelineRationale"), value: item.data.rationale || none },
          { label: t("department.timelineChosenOption"), value: item.data.resolvedOption ?? none },
          { label: t("department.blockedTasks"), value: tasks(item.data.blockedTaskIds) },
        ],
      };
    case "approval_request":
      return {
        keyLine: t("department.timelineApprovalRequestBody"),
        rows: [{ label: t("department.status"), value: formatTimelineStatus(item.data.status, t) }],
      };
    case "decision_resolution":
      return {
        keyLine: line(item.data.note) || item.data.chosenOption || formatCompletionOutcome(item.data.outcome, t),
        rows: [
          { label: t("department.timelineResolutionOutcome"), value: formatCompletionOutcome(item.data.outcome, t) },
          { label: t("department.timelineChosenOption"), value: item.data.chosenOption ?? none },
          { label: t("department.timelineDecisionRequest"), value: item.data.requestItemId },
        ],
      };
    case "human_action":
      return {
        keyLine: line(item.data.label),
        rows: [
          { label: t("department.status"), value: formatTimelineStatus(item.data.status, t) },
          { label: t("department.humanActionConfirmation"), value: formatTimelineTextList(item.data.confirmationRequirements, t) },
          { label: t("department.blockedTasks"), value: tasks(item.data.blockedTaskIds) },
          { label: t("department.timelineVerifiedAt"), value: item.data.verifiedAt ?? none },
        ],
      };
    case "wait_state":
      return {
        keyLine: line(item.data.reason),
        rows: [
          { label: t("department.status"), value: formatTimelineStatus(item.data.status, t) },
          { label: t("department.waitStateNextCheck"), value: item.data.nextCheckAt },
          { label: t("department.waitStateAffectedTasks"), value: tasks(item.data.affectedTaskIds) },
        ],
      };
    case "blocked_issue":
      return {
        keyLine: line(item.data.reason),
        rows: [
          { label: t("department.status"), value: formatTimelineStatus(item.data.status, t) },
          { label: t("department.blockedTasks"), value: tasks(item.data.affectedTaskIds) },
        ],
      };
    case "stage_change":
      return {
        keyLine: line(item.data.summary),
        rows: [
          { label: t("department.timelineRecommendation"), value: line(item.data.recommendedNextAction) },
          { label: t("department.completedTasks"), value: tasks(item.data.affectedTaskIds) },
        ],
      };
    case "final_report":
      return {
        keyLine: line(item.data.sections.actualResult),
        rows: [
          { label: t("department.finalFounderReport"), value: item.data.isCurrent ? t("department.timelineCurrentReport") : t("department.timelineSupersededReport") },
          { label: t("department.finalReportVision"), value: line(item.data.sections.vision) },
          { label: t("department.finalReportGoalFit"), value: line(item.data.sections.goalFit) },
          { label: t("department.finalReportRemainingGaps"), value: line(item.data.sections.remainingGaps) },
          { label: t("department.finalReportNextStep"), value: line(item.data.sections.recommendedNextStep) },
        ],
      };
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
};

export function compareCeoOfficeTimelineItems(a: CeoOfficeItemSummary, b: CeoOfficeItemSummary): number {
  return Date.parse(a.occurredAt) - Date.parse(b.occurredAt) ||
    ceoOfficeTimelineOrder[a.type] - ceoOfficeTimelineOrder[b.type] ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function formatCeoOfficeItemType(type: CeoOfficeItemSummary["type"], t: ReturnType<typeof useLanguage>["t"]): string {
  switch (type) {
    case "plan_brief":
      return t("department.timelinePlanBrief");
    case "task_brief":
      return t("department.timelineTaskBrief");
    case "execution_report":
      return t("department.timelineExecutionReport");
    case "decision_request":
      return t("department.timelineDecisionRequest");
    case "approval_request":
      return t("department.timelineApprovalRequest");
    case "decision_resolution":
      return t("department.timelineDecisionResolution");
    case "human_action":
      return t("department.timelineHumanAction");
    case "wait_state":
      return t("department.timelineWaitState");
    case "blocked_issue":
      return t("department.timelineBlockedIssue");
    case "stage_change":
      return t("department.timelineStageChange");
    case "final_report":
      return t("department.timelineFinalReport");
  }
}

function formatTimelineGaps(
  gaps: Extract<CeoOfficeItemSummary, { type: "execution_report" }>["data"]["remainingGaps"],
  emptyLabel: string,
): string {
  return gaps.length === 0 ? emptyLabel : gaps.map((gap) => gap.label).join(" ");
}

function formatTimelineNextSteps(
  nextSteps: Extract<CeoOfficeItemSummary, { type: "execution_report" }>["data"]["recommendedNextSteps"],
  emptyLabel: string,
): string {
  return nextSteps.length === 0 ? emptyLabel : nextSteps.map((step) => step.label).join(" ");
}

export type TranslateFn = ReturnType<typeof useLanguage>["t"];

/**
 * Task references (dependencies, affected/blocked tasks) render as task titles, never raw IDs
 * (spec User Story 12), resolved in the company canonical locale like the rest of the timeline.
 * Falls back to a localized count only when an ID resolves to no known task.
 */
export function formatTimelineTasks(
  taskIds: string[],
  tasksById: Map<string, TaskSummary>,
  locale: Locale,
  t: TranslateFn,
): string {
  if (taskIds.length === 0) {
    return t("department.none");
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
  const countKey = taskIds.length === 1 ? "department.timelineTaskCountOne" : "department.timelineTaskCountOther";
  return t(countKey).replace("{count}", String(taskIds.length));
}

/** Free-text requirement lists (not task IDs) — joined, with a localized empty fallback. */
function formatTimelineTextList(values: string[], t: TranslateFn): string {
  return values.length === 0 ? t("department.none") : values.join(", ");
}

// Enum-class timeline values render through translation keys; an unmapped value still de-snakes via
// `formatCodeLabel`, so the timeline never shows raw snake_case (spec User Story 16). The blocked/wait
// deterministic reason strings have a matching bilingual table in `packages/core/src/ceoOffice.ts`.
const TIMELINE_STATUS_KEY: Record<string, TranslationKey> = {
  pending: "department.timelineStatusPending",
  resolved: "department.timelineStatusResolved",
  returned: "department.timelineStatusReturned",
  approved: "department.timelineStatusApproved",
  confirmed: "department.timelineStatusConfirmed",
  waiting: "department.timelineStatusWaiting",
  ready_for_check_in: "department.timelineStatusReadyForCheckIn",
  open: "department.timelineStatusOpen",
};

const TIMELINE_OUTCOME_KEY: Record<string, TranslationKey> = {
  accepted: "department.timelineOutcomeAccepted",
  blocked: "department.timelineOutcomeBlocked",
  failed_to_review: "department.timelineOutcomeFailedToReview",
  needs_replan: "department.timelineOutcomeNeedsReplan",
  awaiting_founder_decision: "department.timelineOutcomeAwaitingFounderDecision",
  awaiting_human_action: "department.timelineOutcomeAwaitingHumanAction",
  resolved: "department.timelineOutcomeResolved",
  approved: "department.timelineOutcomeApproved",
  returned: "department.timelineOutcomeReturned",
};

function translateTimelineCode(value: string, keys: Record<string, TranslationKey>, t: TranslateFn): string {
  const key = keys[value];
  return key ? t(key) : formatCodeLabel(value);
}

function formatTimelineStatus(status: string, t: TranslateFn): string {
  return translateTimelineCode(status, TIMELINE_STATUS_KEY, t);
}

function formatCompletionOutcome(outcome: string, t: TranslateFn): string {
  return translateTimelineCode(outcome, TIMELINE_OUTCOME_KEY, t);
}
