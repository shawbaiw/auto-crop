import { MessageSquareText, Send } from "lucide-react";
import { useId, useState } from "react";
import { useLanguage } from "../../ui/language";
import { RetroButton } from "../../ui/retro";

export function CeoIntakeMessageBox({
  draft,
  onDraftChange,
  onSubmit,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit?: (body: string) => Promise<void> | void;
}) {
  const { t } = useLanguage();
  const messageInputId = useId();
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const hasDraft = draft.trim().length > 0;
  const handleSend = async () => {
    if (!hasDraft || submitting) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit?.(draft.trim());
      setSent(true);
      onDraftChange("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="department-message-box" aria-label={t("department.ceoIntakeBox")}>
      <div className="department-message-box__header">
        <MessageSquareText size={16} aria-hidden="true" />
        <h3>{t("department.ceoIntakeBox")}</h3>
      </div>
      <div className="department-message-box__field">
        <label htmlFor={messageInputId}>{t("department.ceoIntakeLabel")}</label>
        <div className="department-message-box__composer">
          <textarea
            id={messageInputId}
            className="retro-textarea"
            placeholder={t("department.ceoIntakePlaceholder")}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
          />
          <RetroButton
            aria-label={`${t("department.send")} ${t("department.ceoOffice")}`}
            className="department-message-box__send"
            disabled={!hasDraft || submitting}
            icon={<Send size={14} aria-hidden="true" />}
            onClick={handleSend}
          >
            {t("department.send")}
          </RetroButton>
        </div>
      </div>
      {sent ? <p className="system-message">{t("department.sentToCeoOffice")}</p> : null}
      <p className="muted">{t("department.ceoIntakeNote")}</p>
    </section>
  );
}
