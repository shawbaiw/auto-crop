import { Building2, Languages, Plus, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import type { CompanyListItem, CompanySummary } from "../api/client";
import { Alert, AlertDescription, AlertTitle, Button } from "../components/ui";
import { CompanyStatus } from "../components/workbench/CompanyStatus";
import { LanguageSwitch } from "../components/workbench/LanguageSwitch";
import { StopOperatingConfirm } from "../components/workbench/StopOperatingConfirm";
import type { WorkbenchCommand } from "../components/workbench/workbenchCommands";
import { WorkbenchSection } from "../components/workbench/WorkbenchSection";
import { useLanguage } from "../ui/language";

export type SettingsProps = {
  company: CompanySummary;
  companies: CompanyListItem[];
  companiesLoadState: "loading" | "ready" | "failed";
  companiesLoadError: string | null;
  onLoadCompanies(): void;
  onOpenCompany(companyId: string): void;
  onCreateNewCompany(): void;
  stopCommand: WorkbenchCommand;
};

/** The current company, every company, and the interface language (dashboard ADR 0002). */
export function Settings({
  companies,
  companiesLoadError,
  companiesLoadState,
  company,
  onCreateNewCompany,
  onLoadCompanies,
  onOpenCompany,
  stopCommand,
}: SettingsProps) {
  const { t } = useLanguage();

  useEffect(() => {
    onLoadCompanies();
    // The list is read each time Settings opens; it is not kept live.
  }, []);

  return (
    <div className="grid gap-4">
      <WorkbenchSection icon={<Building2 aria-hidden="true" />} title={t("settings.currentCompany")}>
        <div className="grid gap-1">
          <p className="break-words text-base font-semibold">{company.name}</p>
          <CompanyStatus status={company.status} />
        </div>
        <StopOperatingConfirm command={stopCommand} companyName={company.name} />
      </WorkbenchSection>

      <WorkbenchSection icon={<Building2 aria-hidden="true" />} title={t("settings.allCompanies")}>
        {companiesLoadState === "loading" ? <Alert role="status">{t("settings.loadingCompanies")}</Alert> : null}
        {companiesLoadState === "failed" ? (
          <Alert role="status" variant="danger">
            <AlertTitle>{t("settings.companiesFailed")}</AlertTitle>
            {companiesLoadError ? <AlertDescription>{companiesLoadError}</AlertDescription> : null}
          </Alert>
        ) : null}
        {companies.length > 0 ? (
          <ul className="grid gap-2">
            {companies.map((item) => {
              const isCurrent = item.id === company.id;
              return (
                <li key={item.id}>
                  <button
                    aria-current={isCurrent ? "true" : undefined}
                    className="grid w-full gap-1 rounded-md border border-border bg-background px-3 py-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-background"
                    disabled={isCurrent}
                    onClick={() => onOpenCompany(item.id)}
                    type="button"
                  >
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {item.name}
                      {isCurrent ? (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                          {t("settings.current")}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <CompanyStatus status={item.status} />
                      <span>
                        {item.taskCount} {t("settings.tasks")}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          {companiesLoadState === "failed" ? (
            <Button onClick={() => onLoadCompanies()} variant="outline">
              <RefreshCw aria-hidden="true" />
              {t("onboarding.retry")}
            </Button>
          ) : null}
          <Button onClick={onCreateNewCompany}>
            <Plus aria-hidden="true" />
            {t("settings.createNewCompany")}
          </Button>
        </div>
      </WorkbenchSection>

      <WorkbenchSection icon={<Languages aria-hidden="true" />} title={t("settings.language")}>
        <LanguageSwitch />
      </WorkbenchSection>
    </div>
  );
}
