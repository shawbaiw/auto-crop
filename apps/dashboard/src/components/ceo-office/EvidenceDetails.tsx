import type { BusinessArtifactSummary, ProofSummary } from "../../api/client";
import { KeyValueList } from "../workbench/KeyValueList";
import { useLanguage } from "../../ui/language";
import { resolveLocalizedValue } from "../../ui/language/localizedText";
import { formatArtifactReviewStatus, formatArtifactValidationStatus, formatProofType } from "../../ui/tasks/formatDisplayValue";

/**
 * What the department sent for a task and the checks on it, folded below the plain-language part.
 * Raw file paths and check results live here, never on a card (dashboard ADR 0002).
 */
export function EvidenceDetails({ businessArtifacts, proofs }: { businessArtifacts: BusinessArtifactSummary[]; proofs: ProofSummary[] }) {
  const { language, t } = useLanguage();
  const artifact = businessArtifacts.find((candidate) => candidate.isCurrent) ?? businessArtifacts[0] ?? null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">{t("ceoOffice.reviewEvidence")}</summary>
      <div className="mt-2 grid gap-2">
        {proofs.length === 0 ? <p className="text-muted-foreground">{t("ceoOffice.reviewNoProof")}</p> : null}
        {proofs.map((proof) => (
          <div className="grid gap-0.5 rounded-md bg-muted/60 px-3 py-2" key={proof.id}>
            <p>{resolveLocalizedValue(proof.summaryText, language, proof.summary)}</p>
            <p className="break-all text-xs text-muted-foreground">{`${formatProofType(proof.type, t)} · ${proof.uri}`}</p>
          </div>
        ))}
        {artifact ? (
          <KeyValueList
            items={[
              { label: t("deliverables.detailValidation"), value: formatArtifactValidationStatus(artifact.validationStatus, t) },
              { label: t("deliverables.detailReview"), value: formatArtifactReviewStatus(artifact.reviewStatus, t) },
            ]}
          />
        ) : null}
      </div>
    </details>
  );
}
