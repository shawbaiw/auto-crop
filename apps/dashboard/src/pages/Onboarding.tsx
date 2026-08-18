import { ArrowLeft, ArrowRight, Building2, CheckCircle2, Play, RefreshCw, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentSummary, CreateCompanyResponse } from "../api/client";
import { RetroButton, RetroField, RetroListRow, RetroPanel, RetroSelect, RetroStatus, RetroTextarea } from "../ui/retro";
import { AppShell, PageHeader, Workspace } from "../ui/layout";

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
  blueprint: CreateCompanyResponse | null;
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
  onActivateCompany(): void;
};

const permissionOptions = [
  { value: "safe", label: "Safe" },
  { value: "balanced", label: "Balanced" },
  { value: "autonomous", label: "Autonomous" },
];

export function Onboarding(props: OnboardingProps) {
  const selectedAgent = props.agents.find((agent) => agent.id === props.selectedAgentId);

  return (
    <AppShell menuBar={props.menuBar}>
      <PageHeader
        eyebrow="Founder Setup"
        status="Local Agent Company"
        statusIcon={<Building2 size={16} aria-hidden="true" />}
        title="CEO Office"
      />

      <Workspace className="onboarding-wizard">
        {props.step === "company" ? (
          <RetroPanel title="Step 1 / Company Name">
            <RetroField htmlFor="company-name" label="Company name">
              <input
                aria-label="Company name"
                className="retro-input"
                id="company-name"
                onChange={(event) => props.onCompanyNameChange(event.target.value)}
                placeholder="Pricing Page Studio"
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
                Next
              </RetroButton>
            </div>
          </RetroPanel>
        ) : null}

        {props.step === "agents" ? (
          <RetroPanel title="Step 2 / Choose CEO">
          <div className="agent-grid">
            {props.agentLoadState === "loading" ? (
              <div className="system-message" role="status">
                Scanning local agent registry...
              </div>
            ) : null}
            {props.agentLoadState === "failed" ? (
              <div className="system-message system-message--danger" role="status">
                Local API is not connected. Start auto-crop or open the dashboard URL printed by the CLI.
              </div>
            ) : null}
            {props.agentLoadState === "ready" && props.agents.length === 0 ? (
              <div className="system-message" role="status">
                No local agents reported by the API.
              </div>
            ) : null}
            {props.agents.map((agent) => (
              <RetroListRow
                disabled={!agent.detected}
                key={agent.id}
                meta={agent.detected ? "available" : "unavailable"}
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
              Back
            </RetroButton>
            {props.agentLoadState === "failed" ? (
              <RetroButton icon={<RefreshCw size={16} aria-hidden="true" />} onClick={props.onRetryAgents}>
                Retry
              </RetroButton>
            ) : null}
            <RetroButton
              icon={<ArrowRight size={16} aria-hidden="true" />}
              onClick={props.onNext}
              variant="primary"
            >
              Next
            </RetroButton>
          </div>
        </RetroPanel>
        ) : null}

        {props.step === "vision" ? (
          <RetroPanel title="Step 3 / Founder Vision">
          {selectedAgent ? <p className="muted">CEO Agent: {selectedAgent.name}</p> : null}
          <RetroField htmlFor="founder-vision" label="Founder vision">
            <RetroTextarea
              aria-label="Founder vision"
              id="founder-vision"
              onChange={(event) => props.onVisionChange(event.target.value)}
              placeholder="Build an AI SaaS that creates pricing pages."
              value={props.founderVision}
            />
          </RetroField>
          {props.founderVisionError ? (
            <div className="system-message system-message--danger" role="alert">
              {props.founderVisionError}
            </div>
          ) : null}
          <RetroField htmlFor="permission-mode" label="Permission mode">
            <RetroSelect
              id="permission-mode"
              label="Permission mode"
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
              Back
            </RetroButton>
            <RetroButton
              disabled={props.isCreating}
              icon={<Play size={16} aria-hidden="true" />}
              onClick={props.onCreateCompany}
              variant="primary"
            >
              {props.isCreating ? "Creating..." : "Create Company"}
            </RetroButton>
          </div>
        </RetroPanel>
        ) : null}
      </Workspace>

      {props.step === "vision" && props.blueprint ? (
        <RetroPanel className="blueprint-band" title="Blueprint Review">
          <div>
            <span className="eyebrow">Blueprint Review</span>
            <h2>{props.blueprint.editable.companyName}</h2>
          </div>
          <div className="review-columns">
            <div>
              <h3>Objectives</h3>
              {props.blueprint.editable.objectives.map((objective) => (
                <p key={objective}>{objective}</p>
              ))}
            </div>
            <div>
              <h3>First Tasks</h3>
              {props.blueprint.editable.firstTasks.map((task) => (
                <p key={task}>{task}</p>
              ))}
            </div>
          </div>
          <RetroButton
            icon={<CheckCircle2 size={16} aria-hidden="true" />}
            onClick={props.onActivateCompany}
            variant="primary"
          >
            Activate Company
          </RetroButton>
        </RetroPanel>
      ) : null}

      <RetroStatus icon={<ShieldCheck size={16} aria-hidden="true" />}>
        {props.permissionMode} execution policy
      </RetroStatus>
    </AppShell>
  );
}
