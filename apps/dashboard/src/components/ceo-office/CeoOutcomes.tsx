import { ClipboardCheck, Sparkle } from "lucide-react";
import type { CeoOfficeItemSummary, FinalFounderReportSummary, VisionGapSummary } from "../../api/client";
import { StatusTag, type StatusTone } from "../ice-mist";
import { KeyValueList } from "../workbench/KeyValueList";
import { isUnseenSince } from "../../ui/ceoOutcomes/lastSeen";
import { useLanguage, type TranslationKey } from "../../ui/language";
import { departmentName } from "../../ui/language/localizedNames";
import { CeoOfficeCard, type CeoOfficeView } from "./CeoOfficeCard";

const OUTCOME_TYPES = new Set<CeoOfficeItemSummary["type"]>(["execution_report", "key_result_met", "stage_change"]);

// Color system v2 §6.3: a stalled report is a risk to look at (caution), not a failure.
const CLASSIFICATION_TONE: Record<FinalFounderReportSummary["classification"], StatusTone> = {
  achieved: "success",
  stalled: "caution",
  waiting: "queued",
};

// Ice Mist panel material, as on the Execution Trace: no shadow inside the workspace.
const PANEL = "grid gap-4 rounded-[var(--r-panel)] border border-[color:var(--edge-highlight)] bg-[color:var(--surface-panel)] p-5 sm:px-6";
const PANEL_TITLE = "text-[17px] font-semibold leading-snug";

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
        <p role="status">
          <StatusTag icon={Sparkle} tone="running">
            {t("ceoOffice.outcomesNew").replace("{count}", String(newCount))}
          </StatusTag>
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
const GAP_TONE: Record<string, { tone: StatusTone; className?: string }> = {
  blocking: { tone: "yourTurn" },
  strategic: { tone: "queued", className: "text-foreground" },
  informational: { tone: "queued" },
};

/**
 * What the finished work still leaves open against the vision, as the completing agents reported it,
 * newest first. A gap explains why work can be done while the vision is not yet reached.
 */
function VisionGaps({ gaps, view }: { gaps: VisionGapSummary[]; view: CeoOfficeView }) {
  const { t } = useLanguage();
  const ordered = [...gaps].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section aria-label={t("ceoOffice.visionGaps")} className={PANEL} role="region">
      <h3 className={PANEL_TITLE}>{t("ceoOffice.visionGaps")}</h3>
      <ul className="grid gap-2">
        {ordered.map((gap) => {
          const department = view.departmentsById.get(gap.departmentId);
          const severity = gap.severity in GAP_TONE ? gap.severity : "informational";
          return (
            <li className="grid gap-2 rounded-[var(--r-reading)] bg-[color:var(--surface-reading)] px-4 py-3" key={gap.id}>
              <p className="max-w-[72ch] break-words text-[15px] leading-relaxed">{gap.label}</p>
              <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                <StatusTag className={GAP_TONE[severity]!.className} tone={GAP_TONE[severity]!.tone}>
                  {t(`ceoOffice.gapSeverity.${severity}` as TranslationKey)}
                </StatusTag>
                {department ? <span>{departmentName(department, view.ctx.locale)}</span> : null}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The Final Founder Report. Its sections are written in the company locale, like the timeline. */
function FinalReportCard({ report, view }: { report: FinalFounderReportSummary | null; view: CeoOfficeView }) {
  const { t } = useLanguage();
  const { line } = view.ctx;
  return (
    <section aria-label={t("ceoOffice.finalReport")} className={PANEL} role="region">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardCheck aria-hidden="true" className="size-[18px] text-status-neutral-icon" />
        <h3 className={PANEL_TITLE}>{t("ceoOffice.finalReport")}</h3>
        {report ? (
          <StatusTag tone={CLASSIFICATION_TONE[report.classification]}>{t(`ceoOffice.classification.${report.classification}` as TranslationKey)}</StatusTag>
        ) : null}
        {report && isUnseenSince(report.createdAt, view.lastSeen) ? (
          <StatusTag icon={Sparkle} tone="running">
            {t("ceoOffice.new")}
          </StatusTag>
        ) : null}
      </div>
      {report ? (
        <div className="im-reading grid gap-4">
          <KeyValueList
            className="max-w-[72ch] gap-y-2 text-[15px] leading-relaxed"
            items={[
              { label: t("ceoOffice.report.vision"), value: line(report.sections.vision) },
              { label: t("ceoOffice.report.actualResult"), value: line(report.sections.actualResult) },
              { label: t("ceoOffice.report.goalFit"), value: line(report.sections.goalFit) },
              { label: t("ceoOffice.report.remainingGaps"), value: line(report.sections.remainingGaps) },
              { label: t("ceoOffice.report.nextStep"), value: line(report.sections.recommendedNextStep) },
            ]}
          />
          {report.sections.departmentContributions.length > 0 ? (
            <section aria-label={t("ceoOffice.report.contributions")} className="grid max-w-[72ch] gap-1 text-[15px] leading-relaxed">
              <h4 className="text-[13px] font-medium text-muted-foreground">{t("ceoOffice.report.contributions")}</h4>
              {report.sections.departmentContributions.map((contribution, index) => (
                <p key={index}>{line(contribution)}</p>
              ))}
            </section>
          ) : null}
        </div>
      ) : (
        <p className="max-w-[72ch] text-[15px] leading-relaxed text-muted-foreground">{t("ceoOffice.finalReportPreparing")}</p>
      )}
    </section>
  );
}
