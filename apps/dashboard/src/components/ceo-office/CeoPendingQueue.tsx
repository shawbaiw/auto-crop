import { useLanguage } from "../../ui/language";
import { taskTitle } from "../../ui/language/localizedNames";
import { RetroButton } from "../../ui/retro";
import { formatCeoPendingType, type CeoPendingItem } from "./ceoPendingItems";

export function CeoPendingQueue({
  items,
  onViewItem,
  successMessage,
}: {
  items: CeoPendingItem[];
  onViewItem: (item: CeoPendingItem) => void;
  successMessage: string | null;
}) {
  const { language, t } = useLanguage();

  return (
    <section className="ceo-pending-queue" aria-label={t("department.ceoPending")}>
      <h3>{t("department.ceoPending")}</h3>
      <p className="muted">{t("department.ceoPendingNote")}</p>
      {successMessage ? <p className="system-message">{successMessage}</p> : null}
      {items.length === 0 ? <p className="muted">{t("department.noCeoPending")}</p> : null}
      {items.map((item) => (
        <article className="ceo-pending-item" key={item.officeItem?.id ?? item.task.id}>
          <div>
            <p>{formatCeoPendingType(item, t)}</p>
            <h4>{taskTitle(item.task, language)}</h4>
          </div>
          <RetroButton aria-label={`${t("department.viewTask")} ${taskTitle(item.task, language)}`} onClick={() => onViewItem(item)}>
            {t("department.viewTask")}
          </RetroButton>
        </article>
      ))}
    </section>
  );
}
