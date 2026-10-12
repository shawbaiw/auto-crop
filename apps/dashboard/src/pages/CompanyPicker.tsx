import { Building2, FolderOpen, Plus, RefreshCw } from "lucide-react";
import type { CompanyListItem as CompanyListItemData } from "../api/client";
import { CompanyListItem } from "../components/company-flow";
import { Alert, AlertDescription, AlertTitle, Button, Card } from "../components/ui";
import { LanguageSwitch, ModernAppShell } from "../components/workbench";
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
  const titleId = "company-picker-title";

  return (
    <ModernAppShell
      className="mx-auto grid w-full max-w-3xl content-start gap-5"
      header={
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
          <span className="text-sm font-semibold text-foreground">{t("menu.app")}</span>
          <LanguageSwitch />
        </div>
      }
      surface="plain"
    >
      <section aria-labelledby={titleId} className="grid gap-5">
        <Card className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:p-6">
          <div className="grid gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("companyPicker.eyebrow")}
            </span>
            <h1 className="text-2xl font-semibold leading-tight tracking-normal text-foreground sm:text-3xl" id={titleId}>
              {t("companyPicker.title")}
            </h1>
          </div>
          <div className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground">
            <Building2 size={16} aria-hidden="true" />
            <span>{t("app.localAgentCompany")}</span>
          </div>
        </Card>

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
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FolderOpen size={16} aria-hidden="true" />
          <span>{t("companyPicker.status")}</span>
        </div>
      </section>
    </ModernAppShell>
  );
}
