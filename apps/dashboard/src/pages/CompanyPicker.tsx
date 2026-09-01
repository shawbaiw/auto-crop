import { Building2, FolderOpen, Plus, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import type { CompanyListItem } from "../api/client";
import { ModalFrame, PageHeader, Workspace } from "../ui/layout";
import { useLanguage } from "../ui/language";
import { RetroButton, RetroListRow, RetroPanel, RetroStatus } from "../ui/retro";
import { formatCompanyStatus } from "../ui/tasks/formatDisplayValue";

export type CompanyPickerProps = {
  companies: CompanyListItem[];
  loadError?: string | null;
  loadState: "loading" | "ready" | "failed";
  menuBar?: ReactNode;
  onCreateNew(): void;
  onOpenCompany(companyId: string): void;
  onRetry(): void;
};

export function CompanyPicker({
  companies,
  loadError,
  loadState,
  menuBar,
  onCreateNew,
  onOpenCompany,
  onRetry,
}: CompanyPickerProps) {
  const { t } = useLanguage();
  const titleId = "company-picker-title";

  return (
    <ModalFrame labelledBy={titleId} menuBar={menuBar}>
      <PageHeader
        eyebrow={t("companyPicker.eyebrow")}
        status={t("app.localAgentCompany")}
        statusIcon={<Building2 size={16} aria-hidden="true" />}
        title={t("companyPicker.title")}
        titleId={titleId}
      />

      <Workspace className="company-picker">
        <RetroPanel title={t("companyPicker.recentCompanies")}>
          {loadState === "loading" ? (
            <div className="system-message" role="status">
              {t("companyPicker.loading")}
            </div>
          ) : null}
          {loadState === "failed" ? (
            <div className="system-message system-message--danger" role="status">
              <div>{t("companyPicker.failed")}</div>
              {loadError ? <div className="system-message__detail">{loadError}</div> : null}
            </div>
          ) : null}
          {loadState === "ready" && companies.length === 0 ? (
            <div className="system-message" role="status">
              {t("companyPicker.empty")}
            </div>
          ) : null}
          {companies.length > 0 ? (
            <div className="company-picker__list">
              {companies.map((company) => (
                <RetroListRow
                  key={company.id}
                  meta={`${formatCompanyStatus(company.status, t)} / ${company.taskCount} ${t("companyPicker.tasks")}`}
                  onClick={() => onOpenCompany(company.id)}
                  title={company.name}
                />
              ))}
            </div>
          ) : null}
          <div className="company-picker__actions">
            {loadState === "failed" ? (
              <RetroButton icon={<RefreshCw size={16} aria-hidden="true" />} onClick={() => onRetry()}>
                {t("onboarding.retry")}
              </RetroButton>
            ) : null}
            <RetroButton icon={<Plus size={16} aria-hidden="true" />} onClick={onCreateNew} variant="primary">
              {t("companyPicker.createNew")}
            </RetroButton>
          </div>
        </RetroPanel>
      </Workspace>

      <RetroStatus icon={<FolderOpen size={16} aria-hidden="true" />}>
        {t("companyPicker.status")}
      </RetroStatus>
    </ModalFrame>
  );
}
