import { Building2, Languages, OctagonX, Plus, RefreshCw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { CompanyListItem, CompanySummary } from "../api/client";
import { Alert, AlertDescription, AlertTitle, Button, Input, Label } from "../components/ui";
import { CompanyStatus } from "../components/workbench/CompanyStatus";
import { LanguageSwitch } from "../components/workbench/LanguageSwitch";
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
        <StopOperating command={stopCommand} companyName={company.name} />
      </WorkbenchSection>

      <WorkbenchSection icon={<Building2 aria-hidden="true" />} title={t("settings.allCompanies")}>
        {companiesLoadState === "loading" ? <Alert role="status">{t("settings.loadingCompanies")}</Alert> : null}
        {companiesLoadState === "failed" ? (
          <Alert role="status" variant="destructive">
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

/** Stop Operating is final, so the founder confirms it by typing the company name (ADR 0044). */
function StopOperating({ command, companyName }: { command: WorkbenchCommand; companyName: string }) {
  const { t } = useLanguage();
  const confirmId = useId();
  const [confirming, setConfirming] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!command.enabled) {
    return <p className="text-sm text-muted-foreground">{t("settings.stopUnavailable")}</p>;
  }

  async function stop() {
    setStopping(true);
    setError(null);
    try {
      await command.run();
      setConfirming(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="grid gap-3 border-t border-border/70 pt-3">
      <p className="text-sm text-muted-foreground">{t("settings.stopExplanation")}</p>
      {confirming ? (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={confirmId}>{t("settings.stopConfirmLabel").replace("{name}", companyName)}</Label>
            <Input autoComplete="off" id={confirmId} onChange={(event) => setTypedName(event.target.value)} value={typedName} />
          </div>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={typedName.trim() !== companyName || stopping} onClick={() => void stop()} variant="destructive">
              <OctagonX aria-hidden="true" />
              {t("settings.stopConfirm")}
            </Button>
            <Button
              onClick={() => {
                setConfirming(false);
                setTypedName("");
                setError(null);
              }}
              variant="outline"
            >
              {t("settings.stopCancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button onClick={() => setConfirming(true)} variant="outline">
            <OctagonX aria-hidden="true" />
            {t(command.labelKey)}
          </Button>
        </div>
      )}
    </div>
  );
}

