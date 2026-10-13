import { ClipboardCheck } from "lucide-react";
import type { CeoOfficeItemSummary, FinalFounderReportSummary } from "../../api/client";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import { KeyValueList } from "../workbench/KeyValueList";
import { isUnseenSince } from "../../ui/ceoOutcomes/lastSeen";
import { useLanguage, type TranslationKey } from "../../ui/language";
import { CeoOfficeCard, type CeoOfficeView } from "./CeoOfficeCard";

const OUTCOME_TYPES = new Set<CeoOfficeItemSummary["type"]>(["execution_report", "stage_change"]);

const CLASSIFICATION_TONE = {
  achieved: "bg-emerald-50 text-emerald-700",
  stalled: "bg-red-50 text-red-700",
  waiting: "bg-amber-50 text-amber-800",
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
}: {
  items: CeoOfficeItemSummary[];
  report: FinalFounderReportSummary | null;
  reportPreparing: boolean;
  view: CeoOfficeView;
}) {
  const { t } = useLanguage();
  const outcomes = outcomeItems(items);
  const newCount = outcomes.filter((item) => isUnseenSince(item.occurredAt, view.lastSeen)).length;
  return (
    <div className="grid content-start gap-3 overflow-y-auto pb-2">
      {report || reportPreparing ? <FinalReportCard report={report} view={view} /> : null}
      {newCount > 0 ? (
        <p className="text-xs font-medium text-blue-700" role="status">
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

/** The Final Founder Report. Its sections are written in the company locale, like the timeline. */
function FinalReportCard({ report, view }: { report: FinalFounderReportSummary | null; view: CeoOfficeView }) {
  const { t } = useLanguage();
  const { line } = view.ctx;
  return (
    <Card aria-label={t("ceoOffice.finalReport")} className="grid gap-3 border-l-4 border-l-primary/60 p-4" role="region">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardCheck aria-hidden="true" className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{t("ceoOffice.finalReport")}</h3>
        {report ? (
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", CLASSIFICATION_TONE[report.classification])}>
            {t(`ceoOffice.classification.${report.classification}` as TranslationKey)}
          </span>
        ) : null}
        {report && isUnseenSince(report.createdAt, view.lastSeen) ? (
          <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">{t("ceoOffice.new")}</span>
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
