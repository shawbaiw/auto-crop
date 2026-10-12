import { ClipboardCheck } from "lucide-react";
import type { FinalFounderReportSummary, Locale } from "../../api/client";
import { UnseenBadge } from "../../ui/ceoOutcomes/UnseenBadge";
import { VideotexKeyValue } from "../../ui/data";
import { useLanguage } from "../../ui/language";
import { RetroBadge, RetroPanel } from "../../ui/retro";
import { makeLineResolver } from "./timelineItemView";

const FINAL_REPORT_CLASSIFICATION_KEY = {
  achieved: "department.finalReportClassificationAchieved",
  stalled: "department.finalReportClassificationStalled",
  waiting: "department.finalReportClassificationWaiting",
} as const;

const FINAL_REPORT_CLASSIFICATION_TONE = {
  achieved: "signal",
  stalled: "danger",
  waiting: "default",
} as const;

/**
 * The Final Founder Report, pinned above the Outcomes view when an `isCurrent` report exists. Shows
 * the classification prominently, then the six localized-text sections, using existing retro
 * primitives. Sections are authored in the company canonical locale (ADR 0013 → single canonical
 * locale), so they render through `makeLineResolver` with the visible "untranslated" marker when
 * that locale value is absent — not the active Interface Locale.
 */
export function FinalFounderReportPanel({
  companyLocale,
  report,
  preparing = false,
  outcomesLastSeen = null,
}: {
  companyLocale: Locale;
  report: FinalFounderReportSummary | null;
  preparing?: boolean;
  outcomesLastSeen?: string | null;
}) {
  const { t } = useLanguage();

  if (!report) {
    if (!preparing) {
      return null;
    }
    return (
      <RetroPanel
        className="ceo-final-founder-report ceo-final-founder-report--preparing"
        icon={<ClipboardCheck size={18} aria-hidden="true" />}
        title={t("department.finalFounderReport")}
        aria-label={t("department.finalFounderReport")}
      >
        <p className="ceo-final-founder-report__preparing muted">{t("department.finalReportPreparing")}</p>
      </RetroPanel>
    );
  }

  const sections = report.sections;
  // The same founder-facing line resolver the timeline uses: it renders the visible "untranslated"
  // marker (and logs) when the company-locale value is absent, rather than silently falling back to
  // another locale (ADR 0013 → single canonical locale; spec Decision 2).
  const line = makeLineResolver(companyLocale, t);

  return (
    <RetroPanel
      className="ceo-final-founder-report"
      icon={<ClipboardCheck size={18} aria-hidden="true" />}
      title={t("department.finalFounderReport")}
      aria-label={t("department.finalFounderReport")}
    >
      <p className="ceo-final-founder-report__classification">
        <RetroBadge tone={FINAL_REPORT_CLASSIFICATION_TONE[report.classification]}>
          {t(FINAL_REPORT_CLASSIFICATION_KEY[report.classification])}
        </RetroBadge>
        <UnseenBadge createdAt={report.createdAt} lastSeen={outcomesLastSeen} />
      </p>
      <VideotexKeyValue
        items={[
          { label: t("department.finalReportVision"), value: line(sections.vision) },
          { label: t("department.finalReportActualResult"), value: line(sections.actualResult) },
          { label: t("department.finalReportGoalFit"), value: line(sections.goalFit) },
          { label: t("department.finalReportRemainingGaps"), value: line(sections.remainingGaps) },
          { label: t("department.finalReportNextStep"), value: line(sections.recommendedNextStep) },
        ]}
      />
      <section
        className="ceo-final-founder-report__departments"
        aria-label={t("department.finalReportDepartmentContributions")}
      >
        <h3>{t("department.finalReportDepartmentContributions")}</h3>
        {sections.departmentContributions.map((contribution, index) => (
          <p key={index}>{line(contribution)}</p>
        ))}
      </section>
    </RetroPanel>
  );
}
