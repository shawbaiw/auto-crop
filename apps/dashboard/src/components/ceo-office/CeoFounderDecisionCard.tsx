import { useState } from "react";
import type { CeoReviewReturnReason, FounderDecisionSummary } from "../../api/client";
import type { WorkspaceHandlers } from "../workbench/workspaceHandlers";
import { VideotexKeyValue } from "../../ui/data";
import { useLanguage } from "../../ui/language";
import { RetroBadge, RetroButton } from "../../ui/retro";
import { CeoReturnReasonFields } from "./CeoReturnReasonFields";
import { formatDecisionKind } from "./formatDecisionKind";

export function CeoFounderDecisionCard({
  decision,
  departmentLabel,
  onResolveFounderDecision,
  onResolved,
  taskLabel,
}: {
  decision: FounderDecisionSummary;
  departmentLabel: string;
  onResolveFounderDecision?: WorkspaceHandlers["onResolveFounderDecision"];
  onResolved: (message: string) => void;
  taskLabel: string;
}) {
  const { t } = useLanguage();
  const [returnReason, setReturnReason] = useState<CeoReviewReturnReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<{ kind: "pick"; option: string } | { kind: "return" } | null>(null);

  const runResolution = async (
    action: { kind: "pick"; option: string } | { kind: "return" },
    input: Parameters<NonNullable<WorkspaceHandlers["onResolveFounderDecision"]>>[0],
    resolvedMessage: (accepted: boolean) => string,
  ) => {
    if (submitting) {
      return;
    }
    setError(null);
    setSubmitting(action);
    try {
      const response = await onResolveFounderDecision?.(input);
      onResolved(resolvedMessage(Boolean(response?.accepted)));
    } catch (resolutionError) {
      setError((resolutionError as Error).message);
    } finally {
      setSubmitting(null);
    }
  };

  const handlePick = (option: string) =>
    runResolution({ kind: "pick", option }, { founderDecisionId: decision.id, chosenOption: option }, (accepted) =>
      accepted ? t("department.founderDecisionResolvedAccepted") : t("department.founderDecisionResolvedPartial"),
    );

  const handleReturn = () => {
    if (!returnReason) {
      setError(t("department.ceoReviewReturnReasonRequired"));
      return;
    }
    void runResolution(
      { kind: "return" },
      {
        founderDecisionId: decision.id,
        action: "return",
        returnReason,
        note: note.trim() || undefined,
      },
      () => t("department.founderDecisionReturned"),
    );
  };

  return (
    <article className="ceo-founder-decision" aria-label={taskLabel}>
      <div className="ceo-founder-decision__header">
        <p className="muted">{departmentLabel}</p>
        <h5>{taskLabel}</h5>
        <VideotexKeyValue
          items={[
            { label: t("department.founderDecisionKind"), value: formatDecisionKind(decision.decisionKind, t) },
            ...(decision.blockedTaskIds.length > 0
              ? [{ label: t("department.founderDecisionBlocking"), value: String(decision.blockedTaskIds.length) }]
              : []),
          ]}
        />
      </div>
      {decision.rationale ? (
        <p className="ceo-founder-decision__rationale">
          <strong>{t("department.founderDecisionRationale")}:</strong> {decision.rationale}
        </p>
      ) : null}
      <div className="ceo-founder-decision__options">
        <h6>{t("department.founderDecisionOptions")}</h6>
        {decision.options.map((option) => (
          <article className="ceo-founder-decision__option" key={option.label}>
            <p className="ceo-founder-decision__option-label">
              {option.label}
              {option.recommended ? (
                <RetroBadge tone="signal">{t("department.founderDecisionRecommended")}</RetroBadge>
              ) : null}
            </p>
            {option.tradeoffs ? (
              <p className="muted">
                {t("department.founderDecisionTradeoffs")}: {option.tradeoffs}
              </p>
            ) : null}
            <RetroButton
              aria-label={`${t("department.founderDecisionPick")}: ${option.label}`}
              aria-busy={submitting?.kind === "pick" && submitting.option === option.label}
              disabled={submitting !== null}
              onClick={() => void handlePick(option.label)}
            >
              {t("department.founderDecisionPick")}
            </RetroButton>
          </article>
        ))}
      </div>
      <div className="ceo-founder-decision__return">
        <CeoReturnReasonFields
          note={note}
          noteLabel={t("department.founderDecisionNote")}
          onNoteChange={setNote}
          onReturnReasonChange={setReturnReason}
          reasonLabel={t("department.founderDecisionReturnReason")}
          returnReason={returnReason}
        />
        <RetroButton aria-busy={submitting?.kind === "return"} disabled={submitting !== null} onClick={handleReturn}>
          {t("department.founderDecisionReturn")}
        </RetroButton>
      </div>
      {error ? <p role="alert" className="warning-message">{error}</p> : null}
    </article>
  );
}
