import { MessageSquareText, Send } from "lucide-react";
import { useId, useState } from "react";
import { useLanguage } from "../../ui/language";
import { departmentName } from "../../ui/language/localizedNames";
import { RetroButton } from "../../ui/retro";

export function DepartmentMessageBox({
  departmentName,
  draft,
  onDraftChange,
}: {
  departmentName: string;
  draft: string;
  onDraftChange: (value: string) => void;
}) {
  const { t } = useLanguage();
  const messageInputId = useId();
  const [sent, setSent] = useState(false);
  const hasDraft = draft.trim().length > 0;
  const handleSend = () => {
    if (!hasDraft) {
      return;
    }

    setSent(true);
    onDraftChange("");
  };

  return (
    <section className="department-message-box" aria-label={t("department.messageBox")}>
      <div className="department-message-box__header">
        <MessageSquareText size={16} aria-hidden="true" />
        <h3>{t("department.messageBox")}</h3>
      </div>
      <div className="department-message-box__field">
        <label htmlFor={messageInputId}>{t("department.messageLabel")}</label>
        <div className="department-message-box__composer">
          <textarea
            id={messageInputId}
            className="retro-textarea"
            placeholder={t("department.messagePlaceholder")}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
          />
          <RetroButton
            aria-label={`${t("department.send")} ${departmentName}`}
            className="department-message-box__send"
            disabled={!hasDraft}
            icon={<Send size={14} aria-hidden="true" />}
            onClick={handleSend}
          >
            {t("department.send")}
          </RetroButton>
        </div>
      </div>
      {sent ? <p className="system-message">{t("department.sentToDepartment")}</p> : null}
      <p className="muted">{t("department.messageNote")}</p>
    </section>
  );
}
