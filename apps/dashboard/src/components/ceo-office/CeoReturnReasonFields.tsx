import { useId } from "react";
import type { CeoReviewReturnReason } from "../../api/client";
import { useLanguage } from "../../ui/language";

/**
 * The Review Return Reason select + note textarea, shared by the CEO review detail panel and the
 * Founder Decision return control so the two return forms cannot drift.
 */
export function CeoReturnReasonFields({
  note,
  noteClassName,
  noteLabel,
  onNoteChange,
  onReturnReasonChange,
  reasonLabel,
  returnReason,
}: {
  note: string;
  noteClassName?: string;
  noteLabel: string;
  onNoteChange: (value: string) => void;
  onReturnReasonChange: (value: CeoReviewReturnReason | "") => void;
  reasonLabel: string;
  returnReason: CeoReviewReturnReason | "";
}) {
  const { t } = useLanguage();
  const reasonInputId = useId();
  const noteInputId = useId();

  return (
    <>
      <label className="retro-field" htmlFor={reasonInputId}>
        <span>{reasonLabel}</span>
        <select
          id={reasonInputId}
          className="retro-input"
          value={returnReason}
          onChange={(event) => onReturnReasonChange(event.target.value as CeoReviewReturnReason | "")}
        >
          <option value="">{t("department.ceoReviewChooseReason")}</option>
          {ceoReturnReasonOptions(t).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="retro-field" htmlFor={noteInputId}>
        <span>{noteLabel}</span>
        <textarea
          id={noteInputId}
          className={noteClassName ? `retro-textarea ${noteClassName}` : "retro-textarea"}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
        />
      </label>
    </>
  );
}

function ceoReturnReasonOptions(t: ReturnType<typeof useLanguage>["t"]): Array<{ value: CeoReviewReturnReason; label: string }> {
  return [
    { value: "needs_changes", label: t("department.returnReasonNeedsChanges") },
    { value: "unclear_task_definition", label: t("department.returnReasonUnclearTask") },
    { value: "scope_too_large", label: t("department.returnReasonScopeTooLarge") },
    { value: "wrong_direction", label: t("department.returnReasonWrongDirection") },
  ];
}
