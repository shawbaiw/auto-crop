import { ListChecks } from "lucide-react";
import { useState } from "react";
import type {
  BusinessArtifactSummary,
  CeoOfficeItemSummary,
  DepartmentSummary,
  Locale,
  ProofSummary,
  TaskSummary,
} from "../../api/client";
import { UnseenBadge } from "../../ui/ceoOutcomes/UnseenBadge";
import { isUnseenSince } from "../../ui/ceoOutcomes/lastSeen";
import { useLanguage } from "../../ui/language";
import { resolveLocalizedValue } from "../../ui/language/localizedText";
import { RetroPanel } from "../../ui/retro";
import { CeoOfficeItemModal } from "./CeoOfficeItemModal";
import { TimelineItemMeta } from "./TimelineItemMeta";
import {
  compareCeoOfficeTimelineItems,
  formatCeoOfficeItemType,
  formatTimelineTasks,
  makeLineResolver,
  timelineItemView,
  type TimelineRenderContext,
} from "./timelineItemView";

// The type tag carries semantic weight: these three are the cards that need a founder or CEO move,
// so they render with an accent stripe; every other type renders quiet (spec User Story 15).
const ACTION_STATE_TIMELINE_TYPES = new Set<CeoOfficeItemSummary["type"]>([
  "decision_request",
  "approval_request",
  "blocked_issue",
]);

/**
 * CEO Office reads as a broadcast station: each timeline item is a summary card (type tag +
 * department + relative time + title + one key line), newest at the bottom pushing history up.
 * Clicking a card opens {@link CeoOfficeItemModal} with the full detail, options, and evidence.
 * Action-bearing cards render with an accent stripe; a newly arrived card briefly highlights
 * (CSS animation, suppressed under `prefers-reduced-motion`).
 */
export function CeoOfficeTimeline({
  artifactsByTask,
  companyLocale,
  departmentsById,
  highlightedItemId,
  items,
  onViewTaskDetail,
  outcomesLastSeen,
  proofsByTask,
  tasksById,
}: {
  artifactsByTask: Map<string, BusinessArtifactSummary[]>;
  companyLocale: Locale;
  departmentsById: Map<string, DepartmentSummary>;
  highlightedItemId: string | null;
  items: CeoOfficeItemSummary[];
  onViewTaskDetail: (taskId: string) => void;
  outcomesLastSeen: string | null;
  proofsByTask: Map<string, ProofSummary[]>;
  tasksById: Map<string, TaskSummary>;
}) {
  const { t } = useLanguage();
  const ctx: TimelineRenderContext = {
    locale: companyLocale,
    line: makeLineResolver(companyLocale, t),
    localize: (text, fallback) => resolveLocalizedValue(text, companyLocale, fallback),
    t,
    tasksById,
  };
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const visibleItems = [...items].sort(compareCeoOfficeTimelineItems);
  const activeItem = activeItemId ? visibleItems.find((item) => item.id === activeItemId) ?? null : null;

  return (
    <RetroPanel
      className="ceo-office-timeline"
      icon={<ListChecks size={18} aria-hidden="true" />}
      title={t("department.ceoOfficeTimeline")}
      aria-label={t("department.ceoOfficeTimeline")}
    >
      {visibleItems.length === 0 ? <p className="muted">{t("department.noCeoOfficeTimeline")}</p> : null}
      {visibleItems.map((item) => {
        const classes = [
          "ceo-outcome",
          "ceo-office-timeline__item",
          ACTION_STATE_TIMELINE_TYPES.has(item.type)
            ? "ceo-office-timeline__item--action"
            : "ceo-office-timeline__item--quiet",
          item.id === highlightedItemId ? "ceo-office-timeline__item--highlighted" : "",
          // "Newly arrived" = arrived since the founder's last visit; the highlight is a one-shot CSS
          // animation (see styles.css), suppressed under `prefers-reduced-motion` (spec User Story 14).
          isUnseenSince(item.occurredAt, outcomesLastSeen) ? "ceo-office-timeline__item--new" : "",
        ].filter(Boolean).join(" ");
        return (
          <article
            aria-current={item.id === highlightedItemId ? "true" : undefined}
            className={classes}
            key={item.id}
          >
            <button
              aria-label={t("department.timelineOpenCard")
                .replace("{type}", formatCeoOfficeItemType(item.type, t))
                .replace("{title}", ctx.localize(item.titleText, item.title))}
              className="ceo-office-timeline__card"
              onClick={() => setActiveItemId(item.id)}
              type="button"
            >
              <span className="ceo-office-timeline__meta-row">
                <TimelineItemMeta departmentsById={departmentsById} item={item} locale={ctx.locale} relative t={t} />
                <UnseenBadge createdAt={item.occurredAt} lastSeen={outcomesLastSeen} />
              </span>
              <h4 className="ceo-office-timeline__title">{ctx.localize(item.titleText, item.title)}</h4>
              <span className="ceo-office-timeline__key-line">{timelineItemView(item, ctx).keyLine}</span>
              {item.type === "task_brief" ? <TaskBriefCardLines ctx={ctx} data={item.data} /> : null}
            </button>
          </article>
        );
      })}
      {activeItem ? (
        <CeoOfficeItemModal
          businessArtifacts={activeItem.taskId ? artifactsByTask.get(activeItem.taskId) ?? [] : []}
          ctx={ctx}
          departmentsById={departmentsById}
          item={activeItem}
          onClose={() => setActiveItemId(null)}
          onViewTaskDetail={(taskId) => {
            setActiveItemId(null);
            onViewTaskDetail(taskId);
          }}
          proofs={activeItem.taskId ? proofsByTask.get(activeItem.taskId) ?? [] : []}
        />
      ) : null}
    </RetroPanel>
  );
}

/** The `task_brief` card is one announcement: objective / key result on a line, then dependency titles. */
function TaskBriefCardLines({
  ctx,
  data,
}: {
  ctx: TimelineRenderContext;
  data: Extract<CeoOfficeItemSummary, { type: "task_brief" }>["data"];
}) {
  const objectiveAndKeyResult = [ctx.line(data.objectiveTitle), ctx.line(data.keyResultTitle)].filter(Boolean).join(" / ");
  const dependencies = data.dependsOnTaskIds.length > 0
    ? formatTimelineTasks(data.dependsOnTaskIds, ctx.tasksById, ctx.locale, ctx.t)
    : "";
  return (
    <>
      {objectiveAndKeyResult ? <span className="ceo-office-timeline__sub">{objectiveAndKeyResult}</span> : null}
      {dependencies ? (
        <span className="ceo-office-timeline__sub">{`${ctx.t("department.timelineDependencies")}: ${dependencies}`}</span>
      ) : null}
    </>
  );
}
