import { ArrowLeft, ArrowRight, Building2, Play, RefreshCw, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentSummary } from "../api/client";
import { RetroButton, RetroField, RetroListRow, RetroPanel, RetroSelect, RetroStatus, RetroTextarea } from "../ui/retro";
import { ModalFrame, PageHeader, Workspace } from "../ui/layout";
import { useLanguage } from "../ui/language";

export type OnboardingStep = "company" | "agents" | "vision";

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
  menuBar?: ReactNode;
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
  const titleId = "onboarding-dialog-title";
  const displayCompanyName = props.companyName.trim();
  const permissionOptions = [
    { value: "safe", label: t("onboarding.safe") },
    { value: "balanced", label: t("onboarding.balanced") },
    { value: "autonomous", label: t("onboarding.autonomous") },
  ];

  return (
    <ModalFrame labelledBy={titleId} menuBar={props.menuBar}>
          <PageHeader
            eyebrow={displayCompanyName ? t("app.localAgentCompany") : t("onboarding.eyebrow")}
            status={t("app.localAgentCompany")}
            statusIcon={<Building2 size={16} aria-hidden="true" />}
            title={displayCompanyName || t("app.title")}
            titleId={titleId}
          />

          <Workspace className="onboarding-wizard">
            {props.step === "company" ? (
              <RetroPanel title={t("onboarding.stepCompany")}>
                <RetroField htmlFor="company-name" label={t("onboarding.companyName")}>
                  <input
                    aria-label={t("onboarding.companyName")}
                    className="retro-input"
                    id="company-name"
                    onChange={(event) => props.onCompanyNameChange(event.target.value)}
                    placeholder={t("onboarding.companyPlaceholder")}
                    value={props.companyName}
                  />
                </RetroField>
                {props.companyNameError ? (
                  <div className="system-message system-message--danger" role="alert">
                    {props.companyNameError}
                  </div>
                ) : null}
                <div className="onboarding-wizard__actions">
                  <RetroButton
                    icon={<ArrowRight size={16} aria-hidden="true" />}
                    onClick={props.onNext}
                    variant="primary"
                  >
                    {t("onboarding.next")}
                  </RetroButton>
                </div>
              </RetroPanel>
            ) : null}

            {props.step === "agents" ? (
              <RetroPanel title={t("onboarding.stepAgents")}>
                <div className="agent-grid">
                  {props.agentLoadState === "loading" ? (
                    <div className="system-message" role="status">
                      {t("onboarding.scanningAgents")}
                    </div>
                  ) : null}
                  {props.agentLoadState === "failed" ? (
                    <div className="system-message system-message--danger" role="status">
                      {t("onboarding.apiDisconnected")}
                    </div>
                  ) : null}
                  {props.agentLoadState === "ready" && props.agents.length === 0 ? (
                    <div className="system-message" role="status">
                      {t("onboarding.noAgents")}
                    </div>
                  ) : null}
                  {props.agents.map((agent) => (
                    <RetroListRow
                      disabled={!agent.detected}
                      key={agent.id}
                      meta={agent.detected ? t("onboarding.available") : t("onboarding.unavailable")}
                      onClick={() => props.onSelectAgent(agent.id)}
                      selected={agent.id === props.selectedAgentId}
                      title={agent.name}
                    />
                  ))}
                </div>
                {props.agentSelectionError ? (
                  <div className="system-message system-message--danger" role="alert">
                    {props.agentSelectionError}
                  </div>
                ) : null}
                <div className="onboarding-wizard__actions">
                  <RetroButton icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={props.onBack}>
                    {t("onboarding.back")}
                  </RetroButton>
                  {props.agentLoadState === "failed" ? (
                    <RetroButton icon={<RefreshCw size={16} aria-hidden="true" />} onClick={props.onRetryAgents}>
                      {t("onboarding.retry")}
                    </RetroButton>
                  ) : null}
                  <RetroButton
                    icon={<ArrowRight size={16} aria-hidden="true" />}
                    onClick={props.onNext}
                    variant="primary"
                  >
                    {t("onboarding.next")}
                  </RetroButton>
                </div>
              </RetroPanel>
            ) : null}

            {props.step === "vision" ? (
              <RetroPanel title={t("onboarding.stepVision")}>
                {selectedAgent ? <p className="muted">{t("onboarding.ceoAgent")}: {selectedAgent.name}</p> : null}
                <RetroField htmlFor="founder-vision" label={t("onboarding.founderVision")}>
                  <RetroTextarea
                    aria-label={t("onboarding.founderVision")}
                    id="founder-vision"
                    onChange={(event) => props.onVisionChange(event.target.value)}
                    placeholder={t("onboarding.visionPlaceholder")}
                    value={props.founderVision}
                  />
                </RetroField>
                {props.founderVisionError ? (
                  <div className="system-message system-message--danger" role="alert">
                    {props.founderVisionError}
                  </div>
                ) : null}
                <RetroField htmlFor="permission-mode" label={t("onboarding.permissionMode")}>
                  <RetroSelect
                    id="permission-mode"
                    label={t("onboarding.permissionMode")}
                    onValueChange={props.onPermissionModeChange}
                    options={permissionOptions}
                    value={props.permissionMode}
                  />
                </RetroField>
                {props.createError ? (
                  <div className="system-message system-message--danger" role="alert">
                    {props.createError}
                  </div>
                ) : null}
                <div className="onboarding-wizard__actions">
                  <RetroButton disabled={props.isCreating} icon={<ArrowLeft size={16} aria-hidden="true" />} onClick={props.onBack}>
                    {t("onboarding.back")}
                  </RetroButton>
                  <RetroButton
                    disabled={props.isCreating}
                    icon={<Play size={16} aria-hidden="true" />}
                    onClick={props.onCreateCompany}
                    variant="primary"
                  >
                    {props.isCreating ? t("onboarding.creating") : t("menu.createCompany")}
                  </RetroButton>
                </div>
              </RetroPanel>
            ) : null}
          </Workspace>

          <RetroStatus icon={<ShieldCheck size={16} aria-hidden="true" />}>
            {props.permissionMode} {t("onboarding.executionPolicy")}
          </RetroStatus>
    </ModalFrame>
  );
}
