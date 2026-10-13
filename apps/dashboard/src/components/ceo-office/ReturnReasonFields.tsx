import { useId } from "react";
import type { CeoReviewReturnReason } from "../../api/client";
import { Label, Textarea } from "@/components/ui";
import { useLanguage, type TranslationKey } from "../../ui/language";

const RETURN_REASONS: CeoReviewReturnReason[] = ["needs_changes", "unclear_task_definition", "scope_too_large", "wrong_direction"];

/**
 * The return reason and note, shared by the review and the decision forms so the two ways to send
 * work back cannot drift.
 */
export function ReturnReasonFields({
  note,
  onNoteChange,
  onReasonChange,
  reason,
}: {
  note: string;
  onNoteChange(value: string): void;
  onReasonChange(value: CeoReviewReturnReason | ""): void;
  reason: CeoReviewReturnReason | "";
}) {
  const { t } = useLanguage();
  const reasonId = useId();
  const noteId = useId();
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={reasonId}>{t("ceoOffice.returnReason")}</Label>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          id={reasonId}
          onChange={(event) => onReasonChange(event.target.value as CeoReviewReturnReason | "")}
          value={reason}
        >
          <option value="">{t("ceoOffice.chooseReason")}</option>
          {RETURN_REASONS.map((value) => (
            <option key={value} value={value}>
              {t(`ceoOffice.reason.${value}` as TranslationKey)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={noteId}>{t("ceoOffice.returnNote")}</Label>
        <Textarea className="min-h-20" id={noteId} onChange={(event) => onNoteChange(event.target.value)} value={note} />
      </div>
    </div>
  );
}
