import { Building2, FolderOpen, Plus, RefreshCw } from "lucide-react";
import type { CompanyListItem } from "../api/client";
import { ModernAppShell } from "../components/workbench";
import { Button } from "../components/ui";
import { useLanguage } from "../ui/language";
import { formatCompanyStatus } from "../ui/tasks/formatDisplayValue";

export type CompanyPickerProps = {
  companies: CompanyListItem[];
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
      surface="plain"
    >
      <section aria-labelledby={titleId} className="grid gap-5">
        <header className="grid gap-4 rounded-lg border border-border/80 bg-card p-5 text-card-foreground shadow-workbench sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:p-6">
          <div className="grid gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("companyPicker.eyebrow")}
            </span>
            <h1 className="text-2xl font-semibold leading-tight tracking-normal text-foreground sm:text-3xl" id={titleId}>
              {t("companyPicker.title")}
            </h1>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground">
            <Building2 size={16} aria-hidden="true" />
            <span>{t("app.localAgentCompany")}</span>
          </div>
        </header>

        <section className="grid gap-4 rounded-lg border border-border/80 bg-card p-4 text-card-foreground shadow-workbench sm:p-5">
          <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("companyPicker.recentCompanies")}
            </h2>
          </div>
          {loadState === "loading" ? (
            <div className="rounded-md border border-border bg-muted px-3 py-3 text-sm text-muted-foreground" role="status">
              {t("companyPicker.loading")}
            </div>
          ) : null}
          {loadState === "failed" ? (
            <div className="grid gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive" role="status">
              <div className="font-medium">{t("companyPicker.failed")}</div>
              {loadError ? <div className="break-words text-destructive/80">{loadError}</div> : null}
            </div>
          ) : null}
          {loadState === "ready" && companies.length === 0 ? (
            <div className="rounded-md border border-border bg-muted px-3 py-3 text-sm text-muted-foreground" role="status">
              {t("companyPicker.empty")}
            </div>
          ) : null}
          {companies.length > 0 ? (
            <div className="grid gap-2">
              {companies.map((company) => (
                <button
                  className="grid gap-1 rounded-md border border-border bg-background px-3 py-3 text-left text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  key={company.id}
                  onClick={() => onOpenCompany(company.id)}
                  type="button"
                >
                  <span className="font-medium">{company.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatCompanyStatus(company.status, t)} / {company.taskCount} {t("companyPicker.tasks")}
                  </span>
                </button>
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
        </section>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FolderOpen size={16} aria-hidden="true" />
          <span>{t("companyPicker.status")}</span>
        </div>
      </section>
    </ModernAppShell>
  );
}
