import { useState } from "react";
import type { CeoOfficeItemSummary, CeoReviewReturnReason } from "../../api/client";
import { Button } from "@/components/ui";
import type { WorkspaceHandlers } from "../workbench/workspaceHandlers";
import { useLanguage } from "../../ui/language";
import { ReturnReasonFields } from "./ReturnReasonFields";

type DecisionItem = Extract<CeoOfficeItemSummary, { type: "decision_request" }>;

/**
 * Choose one option of a decision only the founder can make, or send all of them back. Picking an
 * option accepts the deliverable once every decision on the task is made.
 */
export function DecisionPanel({
  item,
  onDecided,
  onResolve,
}: {
  item: DecisionItem;
  onDecided(message: string): void;
  onResolve?: WorkspaceHandlers["onResolveFounderDecision"];
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState<CeoReviewReturnReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const pending = item.data.status === "pending";

  const run = async (key: string, input: Parameters<NonNullable<WorkspaceHandlers["onResolveFounderDecision"]>>[0], message: (accepted: boolean) => string) => {
    if (submitting) return;
    setError(null);
    setSubmitting(key);
    try {
      const response = await onResolve?.(input);
      onDecided(message(Boolean(response?.accepted)));
    } catch (resolutionError) {
      setError((resolutionError as Error).message);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <section aria-label={t("ceoOffice.decisions")} className="grid gap-4">
      <ul className="grid gap-2">
        {item.data.options.map((option) => (
          <li className="grid gap-2 rounded-[var(--r-reading)] border border-border/70 p-3" key={option.label}>
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {option.label}
              {option.recommended ? (
                <span className="rounded-[var(--r-pill)] border border-foreground px-2 py-0.5 text-xs font-medium text-foreground">{t("ceoOffice.recommended")}</span>
              ) : null}
            </p>
            {option.tradeoffs ? <p className="text-sm text-muted-foreground">{option.tradeoffs}</p> : null}
            {pending ? (
              <Button
                aria-busy={submitting === option.label}
                aria-label={t("ceoOffice.pickOptionLabel").replace("{option}", option.label)}
                className="justify-self-start"
                disabled={submitting !== null}
                onClick={() =>
                  void run(option.label, { founderDecisionId: item.sourceId, chosenOption: option.label }, (accepted) =>
                    accepted ? t("ceoOffice.decisionAccepted") : t("ceoOffice.decisionPartial"))
                }
                size="sm"
              >
                {t("ceoOffice.pickOption")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {pending ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t("ceoOffice.decisionReturn")}</summary>
          <div className="mt-3 grid gap-3">
            <ReturnReasonFields note={note} onNoteChange={setNote} onReasonChange={setReason} reason={reason} />
            <Button
              aria-busy={submitting === "return"}
              className="justify-self-end"
              disabled={submitting !== null}
              onClick={() => {
                if (!reason) {
                  setError(t("ceoOffice.reasonRequired"));
                  return;
                }
                void run(
                  "return",
                  { founderDecisionId: item.sourceId, action: "return", returnReason: reason, note: note.trim() || undefined },
                  () => t("ceoOffice.decisionReturned"),
                );
              }}
              variant="outline"
            >
              {t("ceoOffice.decisionReturn")}
            </Button>
          </div>
        </details>
      ) : null}
      {error ? <p className="text-sm text-status-failed" role="alert">{error}</p> : null}
    </section>
  );
}
