import { Building2 } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { LanguageSwitch, ModernAppShell } from "@/components/workbench";
import { useLanguage } from "../../ui/language";

export type CompanyFlowPageProps = {
  children: ReactNode;
  eyebrow: string;
  /** Page-level commands shown in the header beside the language switch. */
  headerActions?: ReactNode;
  status: ReactNode;
  statusIcon: ReactNode;
  title: string;
  titleId: string;
};

/** The frame shared by the steps before a company exists: picker, onboarding and creation loading. */
export function CompanyFlowPage({ children, eyebrow, headerActions, status, statusIcon, title, titleId }: CompanyFlowPageProps) {
  const { t } = useLanguage();

  return (
    <ModernAppShell
      className="mx-auto grid w-full max-w-3xl content-start gap-5"
      header={
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold text-foreground">{t("menu.app")}</span>
          <div className="flex flex-wrap items-center gap-2">
            {headerActions}
            <LanguageSwitch />
          </div>
        </div>
      }
      surface="plain"
    >
      <section aria-labelledby={titleId} className="grid gap-5">
        <Card className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:p-6">
          <div className="grid min-w-0 gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</span>
            <h1 className="break-words text-2xl font-semibold leading-tight tracking-normal text-foreground sm:text-3xl" id={titleId}>
              {title}
            </h1>
          </div>
          <div className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground">
            <Building2 size={16} aria-hidden="true" />
            <span>{t("app.localAgentCompany")}</span>
          </div>
        </Card>
        {children}
        <div className="flex items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
          {statusIcon}
          <span>{status}</span>
        </div>
      </section>
    </ModernAppShell>
  );
}
