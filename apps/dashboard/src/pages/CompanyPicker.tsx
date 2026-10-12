import { FolderOpen, Plus, RefreshCw } from "lucide-react";
import type { CompanyListItem as CompanyListItemData } from "../api/client";
import { CompanyFlowPage, CompanyListItem } from "../components/company-flow";
import { Alert, AlertDescription, AlertTitle, Button, Card } from "../components/ui";
import { useLanguage } from "../ui/language";

export type CompanyPickerProps = {
  companies: CompanyListItemData[];
  loadError?: string | null;
  loadState: "loading" | "ready" | "failed";
  onCreateNew(): void;
  onOpenCompany(companyId: string): void;
  onRetry(): void;
};

export function CompanyPicker({
  companies,
  loadError,
  loadState,
  onCreateNew,
  onOpenCompany,
  onRetry,
}: CompanyPickerProps) {
  const { t } = useLanguage();

  return (
    <CompanyFlowPage
      eyebrow={t("companyPicker.eyebrow")}
      status={t("companyPicker.status")}
      statusIcon={<FolderOpen aria-hidden="true" />}
      title={t("companyPicker.title")}
      titleId="company-picker-title"
    >
      <Card className="grid gap-4 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("companyPicker.recentCompanies")}
          </h2>
        </div>
        {loadState === "loading" ? <Alert role="status">{t("companyPicker.loading")}</Alert> : null}
        {loadState === "failed" ? (
          <Alert role="status" variant="destructive">
            <AlertTitle>{t("companyPicker.failed")}</AlertTitle>
            {loadError ? <AlertDescription>{loadError}</AlertDescription> : null}
          </Alert>
        ) : null}
        {loadState === "ready" && companies.length === 0 ? (
          <Alert role="status">{t("companyPicker.empty")}</Alert>
        ) : null}
        {companies.length > 0 ? (
          <div className="grid gap-2">
            {companies.map((company) => (
              <CompanyListItem company={company} key={company.id} onOpen={onOpenCompany} />
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          {loadState === "failed" ? (
            <Button onClick={() => onRetry()} variant="outline">
              <RefreshCw aria-hidden="true" />
              {t("onboarding.retry")}
            </Button>
          ) : null}
          <Button onClick={onCreateNew}>
            <Plus aria-hidden="true" />
            {t("companyPicker.createNew")}
          </Button>
        </div>
      </Card>
    </CompanyFlowPage>
  );
}
