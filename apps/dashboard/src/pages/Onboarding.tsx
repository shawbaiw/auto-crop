import { Building2, CheckCircle2, Play, ShieldCheck } from "lucide-react";
import type { AgentSummary, CreateCompanyResponse } from "../api/client";

export type OnboardingProps = {
  agents: AgentSummary[];
  selectedAgentId: string;
  founderVision: string;
  permissionMode: string;
  blueprint: CreateCompanyResponse | null;
  isCreating: boolean;
  onSelectAgent(agentId: string): void;
  onVisionChange(value: string): void;
  onPermissionModeChange(value: string): void;
  onCreateCompany(): void;
  onActivateCompany(): void;
};

export function Onboarding(props: OnboardingProps) {
  return (
    <main className="page-shell">
      <section className="topline">
        <div>
          <span className="eyebrow">Founder Setup</span>
          <h1>CEO Office</h1>
        </div>
        <div className="status-pill">
          <Building2 size={16} aria-hidden="true" />
          Local Agent Company
        </div>
      </section>

      <section className="setup-grid">
        <div className="panel">
          <h2>Choose CEO</h2>
          <div className="agent-grid">
            {props.agents.map((agent) => (
              <button
                className={agent.id === props.selectedAgentId ? "agent-button selected" : "agent-button"}
                key={agent.id}
                onClick={() => props.onSelectAgent(agent.id)}
                type="button"
              >
                <strong>{agent.name}</strong>
                <span>{agent.detected ? "available" : "unavailable"}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>Founder Vision</h2>
          <label className="field">
            <span>Founder vision</span>
            <textarea
              aria-label="Founder vision"
              onChange={(event) => props.onVisionChange(event.target.value)}
              placeholder="Build an AI SaaS that creates pricing pages."
              value={props.founderVision}
            />
          </label>
          <label className="field">
            <span>Permission mode</span>
            <select
              aria-label="Permission mode"
              onChange={(event) => props.onPermissionModeChange(event.target.value)}
              value={props.permissionMode}
            >
              <option value="safe">Safe</option>
              <option value="balanced">Balanced</option>
              <option value="autonomous">Autonomous</option>
            </select>
          </label>
          <button className="primary-action" disabled={props.isCreating} onClick={props.onCreateCompany} type="button">
            <Play size={16} aria-hidden="true" />
            {props.isCreating ? "Creating..." : "Create Company"}
          </button>
        </div>
      </section>

      {props.blueprint ? (
        <section className="blueprint-band">
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
          <button className="primary-action" onClick={props.onActivateCompany} type="button">
            <CheckCircle2 size={16} aria-hidden="true" />
            Activate Company
          </button>
        </section>
      ) : null}

      <section className="policy-strip">
        <ShieldCheck size={16} aria-hidden="true" />
        <span>{props.permissionMode} execution policy</span>
      </section>
    </main>
  );
}
