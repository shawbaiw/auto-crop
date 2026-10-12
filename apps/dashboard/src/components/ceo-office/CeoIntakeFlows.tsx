import type { CeoIntakeStatus, CeoIntakeSummary, TaskProgressEventSummary } from "../../api/client";
import { useLanguage } from "../../ui/language";
import { progressMarker } from "../department/taskProgress";

export function CeoIntakeFlows({ intakes }: { intakes: CeoIntakeSummary[] }) {
  const { t } = useLanguage();

  return (
    <section className="department-progress-flows ceo-intake-flows" aria-label={t("department.ceoIntakeProgress")}>
      <h3>{t("department.ceoIntakeProgress")}</h3>
      <p className="muted">{t("department.ceoIntakeProgressNote")}</p>
      {intakes.length === 0 ? <p className="muted">{t("department.noCeoIntakes")}</p> : null}
      {intakes.map((intake) => (
        <article className="department-progress-flow ceo-intake-flow" key={intake.id}>
          <h4>
            {t("department.ceoIntakeRequest")}: {summarizeIntakeBody(intake.body)}
          </h4>
          <ol className="department-progress-flow__steps">
            {getCeoIntakeSteps(intake.status, t).map((step) => (
              <li className={`department-progress-flow__step department-progress-flow__step--${step.status}`} key={step.label}>
                <span aria-hidden="true">{progressMarker(step.status)}</span>
                <p>{step.label}</p>
              </li>
            ))}
          </ol>
        </article>
      ))}
    </section>
  );
}

function getCeoIntakeSteps(
  intakeStatus: CeoIntakeStatus,
  t: ReturnType<typeof useLanguage>["t"],
): Array<{ label: string; status: TaskProgressEventSummary["status"] }> {
  const steps: Array<{ key: Exclude<CeoIntakeStatus, "failed">; label: string }> = [
    { key: "received", label: t("department.ceoIntakeReceived") },
    { key: "assessing", label: t("department.ceoIntakeAssessing") },
    { key: "assessment_complete", label: t("department.ceoIntakeAssessmentComplete") },
    { key: "planning", label: t("department.ceoIntakePlanning") },
    { key: "planned", label: t("department.ceoIntakePlanned") },
    { key: "dispatching", label: t("department.ceoIntakeDispatching") },
    { key: "dispatched", label: t("department.ceoIntakeDispatched") },
  ];

  if (intakeStatus === "failed") {
    return [
      ...steps.map((step) => ({ label: step.label, status: "waiting" as const })),
      { label: t("department.ceoIntakeFailed"), status: "blocked" as const },
    ];
  }

  const currentIndex = steps.findIndex((step) => step.key === intakeStatus);
  const milestoneStatuses: CeoIntakeStatus[] = ["received", "assessment_complete", "planned", "dispatched"];

  return steps.map((step, index) => {
    if (index < currentIndex) {
      return { label: step.label, status: "complete" as const };
    }

    if (index === currentIndex) {
      return {
        label: step.label,
        status: milestoneStatuses.includes(intakeStatus) ? "complete" as const : "current" as const,
      };
    }

    if (index === currentIndex + 1 && intakeStatus !== "dispatched" && milestoneStatuses.includes(intakeStatus)) {
      return { label: step.label, status: "current" as const };
    }

    return { label: step.label, status: "waiting" as const };
  });
}

function summarizeIntakeBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > 90 ? `${trimmed.slice(0, 87)}...` : trimmed;
}
