import type { CompanyListItem as CompanyListItemData } from "../../api/client";
import { useLanguage } from "../../ui/language";
import { formatCompanyStatus } from "../../ui/tasks/formatDisplayValue";

export type CompanyListItemProps = {
  company: CompanyListItemData;
  onOpen(companyId: string): void;
};

export function CompanyListItem({ company, onOpen }: CompanyListItemProps) {
  const { t } = useLanguage();

  return (
    <button
      className="grid gap-1 rounded-md border border-border bg-background px-3 py-3 text-left text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      onClick={() => onOpen(company.id)}
      type="button"
    >
      <span className="font-medium">{company.name}</span>
      <span className="text-sm text-muted-foreground">
        {formatCompanyStatus(company.status, t)} / {company.taskCount} {t("companyPicker.tasks")}
      </span>
    </button>
  );
}
