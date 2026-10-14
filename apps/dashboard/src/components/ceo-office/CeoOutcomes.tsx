import { ClipboardCheck } from "lucide-react";
import type { CeoOfficeItemSummary, FinalFounderReportSummary, VisionGapSummary } from "../../api/client";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import { KeyValueList } from "../workbench/KeyValueList";
import { isUnseenSince } from "../../ui/ceoOutcomes/lastSeen";
import { useLanguage, type TranslationKey } from "../../ui/language";
import { departmentName } from "../../ui/language/localizedNames";
import { CeoOfficeCard, type CeoOfficeView } from "./CeoOfficeCard";

const OUTCOME_TYPES = new Set<CeoOfficeItemSummary["type"]>(["execution_report", "key_result_met", "stage_change"]);

// Color system v2 §6.3: a stalled report is a risk to look at (caution), not a failure.
const CLASSIFICATION_TONE = {
  achieved: "bg-status-success-bg text-status-success",
  stalled: "bg-status-caution-bg text-status-caution",
  waiting: "bg-status-neutral-bg text-status-neutral",
} as const;

/** The outcome cards the timeline posts as work completes, newest first. */
export function outcomeItems(items: CeoOfficeItemSummary[]): CeoOfficeItemSummary[] {
  return items.filter((item) => OUTCOME_TYPES.has(item.type)).reverse();
}

/**
 * The Outcomes tab: every outcome card, newest first, with the Final Founder Report pinned above them
 * once there is one (dashboard ADR 0002). A stopped company opens here.
 */
export function CeoOutcomes({
  items,
  report,
  reportPreparing,
  view,
  visionGaps,
}: {
  items: CeoOfficeItemSummary[];
  report: FinalFounderReportSummary | null;
  reportPreparing: boolean;
  view: CeoOfficeView;
  visionGaps: VisionGapSummary[];
}) {
  const { t } = useLanguage();
  const outcomes = outcomeItems(items);
  const newCount = outcomes.filter((item) => isUnseenSince(item.occurredAt, view.lastSeen)).length;
  return (
    <div className="grid content-start gap-3 overflow-y-auto pb-2">
      {report || reportPreparing ? <FinalReportCard report={report} view={view} /> : null}
      {visionGaps.length > 0 ? <VisionGaps gaps={visionGaps} view={view} /> : null}
      {newCount > 0 ? (
        <p className="text-xs font-medium text-status-running" role="status">
          {t("ceoOffice.outcomesNew").replace("{count}", String(newCount))}
        </p>
      ) : null}
      {outcomes.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{t("ceoOffice.outcomesEmpty")}</p> : null}
      {outcomes.map((item) => (
        <CeoOfficeCard item={item} key={item.id} view={view} />
      ))}
    </div>
  );
}

// A blocking gap waits on the founder; the others are neutral, strategic ones in charcoal text.
const GAP_TONE: Record<string, string> = {
  blocking: "bg-[color:var(--status-your-turn-bg)] text-[color:var(--status-your-turn-fg)] font-semibold",
  strategic: "bg-status-neutral-bg text-foreground",
  informational: "bg-status-neutral-bg text-status-neutral",
};

/**
 * What the finished work still leaves open against the vision, as the completing agents reported it,
 * newest first. A gap explains why work can be done while the vision is not yet reached.
 */
function VisionGaps({ gaps, view }: { gaps: VisionGapSummary[]; view: CeoOfficeView }) {
  const { t } = useLanguage();
  const ordered = [...gaps].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <Card aria-label={t("ceoOffice.visionGaps")} className="grid gap-2 p-4" role="region">
      <h3 className="text-sm font-semibold">{t("ceoOffice.visionGaps")}</h3>
      <ul className="grid gap-2">
        {ordered.map((gap) => {
          const department = view.departmentsById.get(gap.departmentId);
          const severity = gap.severity in GAP_TONE ? gap.severity : "informational";
          return (
            <li className="grid gap-1 text-sm" key={gap.id}>
              <p className="break-words">{gap.label}</p>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className={cn("rounded-[var(--r-pill)] px-1.5 py-0.5 font-medium", GAP_TONE[severity])}>{t(`ceoOffice.gapSeverity.${severity}` as TranslationKey)}</span>
                {department ? <span>{departmentName(department, view.ctx.locale)}</span> : null}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** The Final Founder Report. Its sections are written in the company locale, like the timeline. */
function FinalReportCard({ report, view }: { report: FinalFounderReportSummary | null; view: CeoOfficeView }) {
  const { t } = useLanguage();
  const { line } = view.ctx;
  return (
    <Card aria-label={t("ceoOffice.finalReport")} className="grid gap-3 p-4" role="region">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardCheck aria-hidden="true" className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{t("ceoOffice.finalReport")}</h3>
        {report ? (
          <span className={cn("rounded-[var(--r-pill)] px-2 py-0.5 text-xs font-medium", CLASSIFICATION_TONE[report.classification])}>
            {t(`ceoOffice.classification.${report.classification}` as TranslationKey)}
          </span>
        ) : null}
        {report && isUnseenSince(report.createdAt, view.lastSeen) ? (
          <span className="rounded-[var(--r-pill)] bg-status-running-bg px-1.5 py-0.5 text-xs font-medium text-status-running">{t("ceoOffice.new")}</span>
        ) : null}
      </div>
      {report ? (
        <>
          <KeyValueList
            items={[
              { label: t("ceoOffice.report.vision"), value: line(report.sections.vision) },
              { label: t("ceoOffice.report.actualResult"), value: line(report.sections.actualResult) },
              { label: t("ceoOffice.report.goalFit"), value: line(report.sections.goalFit) },
              { label: t("ceoOffice.report.remainingGaps"), value: line(report.sections.remainingGaps) },
              { label: t("ceoOffice.report.nextStep"), value: line(report.sections.recommendedNextStep) },
            ]}
          />
          {report.sections.departmentContributions.length > 0 ? (
            <section aria-label={t("ceoOffice.report.contributions")} className="grid gap-1 text-sm">
              <h4 className="font-medium">{t("ceoOffice.report.contributions")}</h4>
              {report.sections.departmentContributions.map((contribution, index) => (
                <p key={index}>{line(contribution)}</p>
              ))}
            </section>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("ceoOffice.finalReportPreparing")}</p>
      )}
    </Card>
  );
}
