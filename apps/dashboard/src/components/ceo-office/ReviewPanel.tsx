import { useState } from "react";
import type { BusinessArtifactSummary, CeoReviewReturnReason, LocalizedText, ProofSummary, TaskSummary } from "../../api/client";
import { Alert, Button } from "@/components/ui";
import type { WorkspaceHandlers } from "../workbench/workspaceHandlers";
import { useLanguage } from "../../ui/language";
import { taskDescription, taskTitle } from "../../ui/language/localizedNames";
import { resolveLocalizedValue } from "../../ui/language/localizedText";
import { EvidenceDetails } from "./EvidenceDetails";
import { ReturnReasonFields } from "./ReturnReasonFields";

/**
 * Approve or return a deliverable that waits for the founder's review. The form exists only while the
 * server offers `ceo_review_decision` on the task (ADR 0020); approving also needs a checkable result,
 * as it did before. Raw codes stay under Details.
 */
export function ReviewPanel({
  businessArtifacts,
  onDecided,
  onDecision,
  proofs,
  task,
}: {
  businessArtifacts: BusinessArtifactSummary[];
  onDecided(message: string): void;
  onDecision?: WorkspaceHandlers["onCreateCeoReviewDecision"];
  proofs: ProofSummary[];
  task: TaskSummary;
}) {
  const { language, t } = useLanguage();
  const [reason, setReason] = useState<CeoReviewReturnReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"approve" | "return" | null>(null);
  const offered = (task.affordances ?? []).some((affordance) => affordance.kind === "ceo_review_decision");
  const artifact = businessArtifacts.find((candidate) => candidate.isCurrent) ?? businessArtifacts[0] ?? null;
  const reviewableArtifact =
    artifact !== null &&
    artifact.validationStatus === "valid" &&
    artifact.reviewStatus === "unreviewed" &&
    (artifact.artifactKind === "deliverable" || artifact.artifactKind === "final_report");
  const canApprove = offered && proofs.length > 0 && reviewableArtifact;
  const outcome = readOutcomeSummary(artifact?.payload);

  if (!offered) {
    return <p className="text-sm text-muted-foreground">{t("ceoOffice.reviewNoLonger")}</p>;
  }

  const decide = async (decision: "approve" | "return") => {
    if (submitting) return;
    if (decision === "return" && !reason) {
      setError(t("ceoOffice.reasonRequired"));
      return;
    }
    setError(null);
    setSubmitting(decision);
    try {
      const response = await onDecision?.(
        decision === "approve"
          ? { taskId: task.id, decision }
          : { taskId: task.id, decision, returnReason: reason as CeoReviewReturnReason, note: note.trim() || undefined },
      );
      onDecided(response?.decision.decision === "return" || decision === "return" ? t("ceoOffice.returnedMessage") : t("ceoOffice.approvedMessage"));
    } catch (decisionError) {
      setError((decisionError as Error).message);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <section aria-label={t("ceoOffice.reviews")} className="grid gap-4">
      <Alert className={canApprove ? undefined : "border-amber-300 bg-amber-50 text-amber-900"} role="status">
        {canApprove ? t("ceoOffice.reviewCanApprove") : t("ceoOffice.reviewCannotApprove")}
      </Alert>
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">{t("ceoOffice.reviewOutcome")}</h3>
        <p className="text-sm">
          {outcome
            ? typeof outcome === "string" ? outcome : resolveLocalizedValue(outcome, language, outcome.en ?? "")
            : <span className="text-muted-foreground">{t("ceoOffice.reviewNoOutcome")}</span>}
        </p>
      </div>
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">{t("ceoOffice.reviewTask")}</h3>
        <p className="text-sm">{taskTitle(task, language)}</p>
        {task.description ? <p className="text-sm text-muted-foreground">{taskDescription(task, language)}</p> : null}
      </div>
      <EvidenceDetails businessArtifacts={businessArtifacts} proofs={proofs} />
      <ReturnReasonFields note={note} onNoteChange={setNote} onReasonChange={setReason} reason={reason} />
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button aria-busy={submitting === "return"} disabled={submitting !== null} onClick={() => void decide("return")} variant="outline">
          {t("ceoOffice.return")}
        </Button>
        {canApprove ? (
          <Button aria-busy={submitting === "approve"} disabled={submitting !== null} onClick={() => void decide("approve")}>
            {t("ceoOffice.approve")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function readOutcomeSummary(payload: unknown): LocalizedText | string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const value = record.outcome_summary ?? record.outcomeSummary;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.en === "string" || typeof candidate.zh === "string") return candidate as LocalizedText;
  }
  return null;
}
