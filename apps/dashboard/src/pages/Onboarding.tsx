import { Building2, CheckCircle2, Play, ShieldCheck } from "lucide-react";
import type { AgentSummary, CreateCompanyResponse } from "../api/client";
import { RetroButton, RetroField, RetroListRow, RetroPanel, RetroSelect, RetroStatus, RetroTextarea } from "../ui/retro";
import { AppShell, PageHeader, Workspace } from "../ui/layout";

export type OnboardingProps = {
  agents: AgentSummary[];
  agentLoadState: "loading" | "ready" | "failed";
  selectedAgentId: string;
  founderVision: string;
  permissionMode: string;
  blueprint: CreateCompanyResponse | null;
  isCreating: boolean;
  createError: string | null;
  onSelectAgent(agentId: string): void;
  onVisionChange(value: string): void;
  onPermissionModeChange(value: string): void;
  onCreateCompany(): void;
  onActivateCompany(): void;
};

const permissionOptions = [
  { value: "safe", label: "Safe" },
  { value: "balanced", label: "Balanced" },
  { value: "autonomous", label: "Autonomous" },
];

export function Onboarding(props: OnboardingProps) {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Founder Setup"
        status="Local Agent Company"
        statusIcon={<Building2 size={16} aria-hidden="true" />}
        title="CEO Office"
      />

      <Workspace className="setup-grid">
        <RetroPanel title="Choose CEO">
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
                key={agent.id}
                meta={agent.detected ? "available" : "unavailable"}
                onClick={() => props.onSelectAgent(agent.id)}
                selected={agent.id === props.selectedAgentId}
                title={agent.name}
              />
            ))}
          </div>
        </RetroPanel>

        <RetroPanel title="Founder Vision">
          <RetroField htmlFor="founder-vision" label="Founder vision">
            <RetroTextarea
              aria-label="Founder vision"
              id="founder-vision"
              onChange={(event) => props.onVisionChange(event.target.value)}
              placeholder="Build an AI SaaS that creates pricing pages."
              value={props.founderVision}
            />
          </RetroField>
          <RetroField htmlFor="permission-mode" label="Permission mode">
            <RetroSelect
              id="permission-mode"
              label="Permission mode"
              onValueChange={props.onPermissionModeChange}
              options={permissionOptions}
              value={props.permissionMode}
            />
          </RetroField>
          <RetroButton
            disabled={props.isCreating}
            icon={<Play size={16} aria-hidden="true" />}
            onClick={props.onCreateCompany}
            variant="primary"
          >
            {props.isCreating ? "Creating..." : "Create Company"}
          </RetroButton>
          {props.createError ? (
            <div className="system-message system-message--danger" role="alert">
              {props.createError}
            </div>
          ) : null}
        </RetroPanel>
      </Workspace>

      {props.blueprint ? (
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
