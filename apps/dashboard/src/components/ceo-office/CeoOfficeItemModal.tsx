import { useId } from "react";
import type {
  BusinessArtifactSummary,
  CeoOfficeItemSummary,
  DepartmentSummary,
  Locale,
  ProofSummary,
} from "../../api/client";
import { VideotexKeyValue } from "../../ui/data";
import { useLanguage } from "../../ui/language";
import { resolveLocalizedValue } from "../../ui/language/localizedText";
import { RetroDialog } from "../../ui/layout";
import { RetroBadge, RetroButton } from "../../ui/retro";
import {
  formatArtifactKind,
  formatArtifactReviewStatus,
  formatArtifactRole,
  formatArtifactValidationStatus,
  formatCodeLabel,
  formatProofType,
} from "../../ui/tasks/formatDisplayValue";
import { TimelineItemMeta } from "./TimelineItemMeta";
import { timelineItemView, type TimelineRenderContext, type TranslateFn } from "./timelineItemView";

/**
 * The full detail behind a summary card: the key-value table, options, and a collapsed evidence
 * section modelled on `ceo-task-review-detail`, plus a "View task detail" affordance. No new route
 * (spec Decision 3).
 */
export function CeoOfficeItemModal({
  businessArtifacts,
  ctx,
  departmentsById,
  item,
  onClose,
  onViewTaskDetail,
  proofs,
}: {
  businessArtifacts: BusinessArtifactSummary[];
  ctx: TimelineRenderContext;
  departmentsById: Map<string, DepartmentSummary>;
  item: CeoOfficeItemSummary;
  onClose: () => void;
  onViewTaskDetail: (taskId: string) => void;
  proofs: ProofSummary[];
}) {
  const { locale, t } = ctx;
  const headingId = useId();
  const view = timelineItemView(item, ctx);
  const hasEvidence = Boolean(item.taskId) && (proofs.length > 0 || businessArtifacts.length > 0);

  return (
    <RetroDialog className="ceo-timeline-modal" labelledBy={headingId} onClose={onClose}>
      <header className="ceo-timeline-modal__head">
        <TimelineItemMeta departmentsById={departmentsById} item={item} locale={locale} relative={false} t={t} />
        <RetroButton aria-label={t("department.timelineClose")} onClick={onClose}>
          {t("department.timelineClose")}
        </RetroButton>
      </header>
      <h3 id={headingId}>{ctx.localize(item.titleText, item.title)}</h3>
      <p className="ceo-timeline-modal__key-line">{view.keyLine}</p>
      <VideotexKeyValue items={view.rows} />
      {item.type === "decision_request" ? <TimelineOptions options={item.data.options} /> : null}
      {hasEvidence ? <TimelineEvidence businessArtifacts={businessArtifacts} locale={locale} proofs={proofs} t={t} /> : null}
      {item.taskId ? (
        <div className="ceo-timeline-modal__actions">
          <RetroButton onClick={() => onViewTaskDetail(item.taskId!)}>
            {t("department.timelineViewDetail")}
          </RetroButton>
        </div>
      ) : null}
    </RetroDialog>
  );
}

/**
 * The modal's collapsed evidence section, modelled on the `ceo-task-review-detail` one: the
 * department's submitted Proof, then the current Business Artifact's kind / role / status.
 */
function TimelineEvidence({
  businessArtifacts,
  locale,
  proofs,
  t,
}: {
  businessArtifacts: BusinessArtifactSummary[];
  locale: Locale;
  proofs: ProofSummary[];
  t: TranslateFn;
}) {
  const currentArtifact = businessArtifacts.find((artifact) => artifact.isCurrent) ?? businessArtifacts[0] ?? null;
  return (
    <details className="ceo-timeline-modal__evidence">
      <summary>{t("department.ceoReviewEvidenceValidation")}</summary>
      <h4>{t("department.ceoReviewDepartmentSubmission")}</h4>
      {proofs.length === 0 ? <p className="muted">{t("department.ceoReviewNoProof")}</p> : null}
      {proofs.map((proof) => (
        <article className="ceo-task-review-proof" key={proof.id}>
          <p>{resolveLocalizedValue(proof.summaryText, locale, proof.summary)}</p>
          <p className="muted">{`${formatProofType(proof.type, t)} / ${proof.uri}`}</p>
        </article>
      ))}
      {currentArtifact ? (
        <article className="ceo-task-review-proof">
          <p>{`${formatArtifactKind(currentArtifact.artifactKind, t)} / ${formatArtifactRole(currentArtifact.artifactRole, t)} / ${formatCodeLabel(currentArtifact.artifactSubtype)}`}</p>
          <p className="muted">{`${formatArtifactValidationStatus(currentArtifact.validationStatus, t)} / ${formatArtifactReviewStatus(currentArtifact.reviewStatus, t)}`}</p>
        </article>
      ) : (
        <p className="muted">{t("dashboard.noBusinessArtifacts")}</p>
      )}
    </details>
  );
}

function TimelineOptions({ options }: { options: Extract<CeoOfficeItemSummary, { type: "decision_request" }>["data"]["options"] }) {
  const { t } = useLanguage();
  return (
    <div className="ceo-founder-decision__options">
      {options.map((option) => (
        <article className="ceo-founder-decision__option" key={option.label}>
          <p className="ceo-founder-decision__option-label">
            {option.label}
            {option.recommended ? <RetroBadge tone="signal">{t("department.founderDecisionRecommended")}</RetroBadge> : null}
          </p>
          {option.tradeoffs ? <p className="muted">{option.tradeoffs}</p> : null}
        </article>
      ))}
    </div>
  );
}
