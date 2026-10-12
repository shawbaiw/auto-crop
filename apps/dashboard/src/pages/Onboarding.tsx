import { ArrowLeft, ArrowRight, Play, RefreshCw, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentSummary } from "../api/client";
import { AgentOption, CompanyFlowPage } from "../components/company-flow";
import { ComposerInput } from "../components/composer";
import { Alert, Button, Card, Input, Label, RadioGroup, RadioGroupItem } from "../components/ui";
import { cn } from "../lib/utils";
import { useLanguage } from "../ui/language";
import { formatPermissionMode } from "../ui/tasks/formatDisplayValue";

export type OnboardingStep = "company" | "agents" | "vision";

const onboardingSteps: OnboardingStep[] = ["company", "agents", "vision"];
const permissionModes = ["safe", "balanced", "autonomous"];

export type OnboardingProps = {
  step: OnboardingStep;
  companyName: string;
  companyNameError: string | null;
  agents: AgentSummary[];
  agentLoadState: "idle" | "loading" | "ready" | "failed";
  agentSelectionError: string | null;
  selectedAgentId: string;
  founderVision: string;
  founderVisionError: string | null;
  permissionMode: string;
  isCreating: boolean;
  createError: string | null;
  onCompanyNameChange(value: string): void;
  onRetryAgents(): void;
  onSelectAgent(agentId: string): void;
  onVisionChange(value: string): void;
  onPermissionModeChange(value: string): void;
  onBack(): void;
  onNext(): void;
  onCreateCompany(): void;
};

export function Onboarding(props: OnboardingProps) {
  const { t } = useLanguage();
  const selectedAgent = props.agents.find((agent) => agent.id === props.selectedAgentId);
  const displayCompanyName = props.companyName.trim();
  const permissionOptions = permissionModes.map((value) => ({ value, label: formatPermissionMode(value, t) }));
  const permissionLabel = formatPermissionMode(props.permissionMode, t);

  return (
    <CompanyFlowPage
      eyebrow={displayCompanyName ? t("app.localAgentCompany") : t("onboarding.eyebrow")}
      status={`${permissionLabel} ${t("onboarding.executionPolicy")}`}
      statusIcon={<ShieldCheck aria-hidden="true" />}
      title={displayCompanyName || t("app.title")}
      titleId="onboarding-dialog-title"
    >
      <StepProgress step={props.step} />

      {props.step === "company" ? (
        <StepCard title={t("onboarding.stepCompany")}>
          <div className="grid gap-2">
            <Label htmlFor="company-name">{t("onboarding.companyName")}</Label>
            <Input
              id="company-name"
              onChange={(event) => props.onCompanyNameChange(event.target.value)}
              placeholder={t("onboarding.companyPlaceholder")}
              value={props.companyName}
            />
          </div>
          {props.companyNameError ? (
            <Alert role="alert" variant="destructive">
              {props.companyNameError}
            </Alert>
          ) : null}
          <StepActions>
            <Button onClick={props.onNext}>
              {t("onboarding.next")}
              <ArrowRight aria-hidden="true" />
            </Button>
          </StepActions>
        </StepCard>
      ) : null}

      {props.step === "agents" ? (
        <StepCard title={t("onboarding.stepAgents")}>
          <div className="grid gap-2">
            {props.agentLoadState === "loading" ? <Alert role="status">{t("onboarding.scanningAgents")}</Alert> : null}
            {props.agentLoadState === "failed" ? (
              <Alert role="status" variant="destructive">
                {t("onboarding.apiDisconnected")}
              </Alert>
            ) : null}
            {props.agentLoadState === "ready" && props.agents.length === 0 ? (
              <Alert role="status">{t("onboarding.noAgents")}</Alert>
            ) : null}
            {props.agents.map((agent) => (
              <AgentOption
                agent={agent}
                key={agent.id}
                onSelect={props.onSelectAgent}
                selected={agent.id === props.selectedAgentId}
              />
            ))}
          </div>
          {props.agentSelectionError ? (
            <Alert role="alert" variant="destructive">
              {props.agentSelectionError}
            </Alert>
          ) : null}
          <StepActions>
            <Button onClick={props.onBack} variant="ghost">
              <ArrowLeft aria-hidden="true" />
              {t("onboarding.back")}
            </Button>
            {props.agentLoadState === "failed" ? (
              <Button onClick={props.onRetryAgents} variant="outline">
                <RefreshCw aria-hidden="true" />
                {t("onboarding.retry")}
              </Button>
            ) : null}
            <Button onClick={props.onNext}>
              {t("onboarding.next")}
              <ArrowRight aria-hidden="true" />
            </Button>
          </StepActions>
        </StepCard>
      ) : null}

      {props.step === "vision" ? (
        <StepCard title={t("onboarding.stepVision")}>
          {selectedAgent ? (
            <p className="text-sm text-muted-foreground">
              {t("onboarding.ceoAgent")}: <span className="font-medium text-foreground">{selectedAgent.name}</span>
            </p>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="founder-vision">{t("onboarding.founderVision")}</Label>
            <ComposerInput
              id="founder-vision"
              onChange={(event) => props.onVisionChange(event.target.value)}
              placeholder={t("onboarding.visionPlaceholder")}
              value={props.founderVision}
            />
          </div>
          {props.founderVisionError ? (
            <Alert role="alert" variant="destructive">
              {props.founderVisionError}
            </Alert>
          ) : null}
          <div className="grid gap-2">
            <span className="text-sm font-medium leading-none text-foreground" id="permission-mode-label">
              {t("onboarding.permissionMode")}
            </span>
            <RadioGroup
              aria-labelledby="permission-mode-label"
              className="sm:grid-cols-3"
              onValueChange={props.onPermissionModeChange}
              value={props.permissionMode}
            >
              {permissionOptions.map((option) => (
                <Label
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background px-3 py-3 font-normal transition-colors hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary"
                  htmlFor={`permission-mode-${option.value}`}
                  key={option.value}
                >
                  <RadioGroupItem id={`permission-mode-${option.value}`} value={option.value} />
                  {option.label}
                </Label>
              ))}
            </RadioGroup>
          </div>
          {props.createError ? (
            <Alert role="alert" variant="destructive">
              {props.createError}
            </Alert>
          ) : null}
          <StepActions>
            <Button disabled={props.isCreating} onClick={props.onBack} variant="ghost">
              <ArrowLeft aria-hidden="true" />
              {t("onboarding.back")}
            </Button>
            <Button disabled={props.isCreating} onClick={props.onCreateCompany}>
              <Play aria-hidden="true" />
              {props.isCreating ? t("onboarding.creating") : t("menu.createCompany")}
            </Button>
          </StepActions>
        </StepCard>
      ) : null}
    </CompanyFlowPage>
  );
}

function StepProgress({ step }: { step: OnboardingStep }) {
  const current = onboardingSteps.indexOf(step);

  return (
    <div aria-hidden="true" className="grid grid-cols-3 gap-2">
      {onboardingSteps.map((id, index) => (
        <span className={cn("h-1 rounded-full bg-border", index <= current && "bg-primary")} key={id} />
      ))}
    </div>
  );
}

function StepCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <Card className="grid gap-5 p-4 sm:p-6">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {children}
    </Card>
  );
}

function StepActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2">{children}</div>;
}
