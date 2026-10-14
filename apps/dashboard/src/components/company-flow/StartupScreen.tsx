import { Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Button, Card } from "@/components/ui";
import { useLanguage } from "../../ui/language";
import { CompanyFlowPage } from "./CompanyFlowPage";

export type StartupScreenProps = {
  error: string | null;
  failed: boolean;
  onRetry(): void;
};

/** Shown while the app finds the company to open, or when the local API cannot be reached. */
export function StartupScreen({ error, failed, onRetry }: StartupScreenProps) {
  const { t } = useLanguage();

  return (
    <CompanyFlowPage
      eyebrow={t("startup.eyebrow")}
      status={t("startup.status")}
      statusIcon={<Loader2 aria-hidden="true" className={failed ? undefined : "motion-safe:animate-spin"} />}
      title={t("menu.app")}
      titleId="startup-title"
    >
      <Card className="grid gap-4 p-4 sm:p-5">
        {failed ? (
          <>
            <Alert role="status" variant="danger">
              <AlertTitle>{t("startup.failed")}</AlertTitle>
              {error ? <AlertDescription>{error}</AlertDescription> : null}
            </Alert>
            <div className="flex justify-end">
              <Button onClick={() => onRetry()} variant="outline">
                <RefreshCw aria-hidden="true" />
                {t("onboarding.retry")}
              </Button>
            </div>
          </>
        ) : (
          <Alert role="status">{t("startup.loading")}</Alert>
        )}
      </Card>
    </CompanyFlowPage>
  );
}
