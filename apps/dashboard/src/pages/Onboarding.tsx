import { useEffect, useRef, useState } from "react";
import { Building2, CheckCircle2, ChevronDown, Play, ShieldCheck } from "lucide-react";
import type { AgentSummary, CreateCompanyResponse } from "../api/client";

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
  const [permissionOpen, setPermissionOpen] = useState(false);
  const permissionSelectorRef = useRef<HTMLDivElement>(null);
  const selectedPermission =
    permissionOptions.find((option) => option.value === props.permissionMode) ?? permissionOptions[0];

  useEffect(() => {
    if (!permissionOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!permissionSelectorRef.current?.contains(event.target as Node)) {
        setPermissionOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [permissionOpen]);

  function selectPermissionMode(value: string) {
    props.onPermissionModeChange(value);
    setPermissionOpen(false);
  }

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
            {props.agentLoadState === "loading" ? (
              <div className="agent-empty" role="status">
                Scanning local agent registry...
              </div>
            ) : null}
            {props.agentLoadState === "failed" ? (
              <div className="agent-empty alert" role="status">
                Local API is not connected. Start auto-crop or open the dashboard URL printed by the CLI.
              </div>
            ) : null}
            {props.agentLoadState === "ready" && props.agents.length === 0 ? (
              <div className="agent-empty" role="status">
                No local agents reported by the API.
              </div>
            ) : null}
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
          <div className="field" ref={permissionSelectorRef}>
            <span id="permission-mode-label">Permission mode</span>
            <div className="retro-select">
              <button
                aria-controls="permission-mode-options"
                aria-expanded={permissionOpen}
                aria-haspopup="listbox"
                aria-labelledby="permission-mode-label permission-mode-value"
                className="retro-select-trigger"
                onClick={() => setPermissionOpen((current) => !current)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setPermissionOpen(false);
                  }
                }}
                type="button"
              >
                <span id="permission-mode-value">{selectedPermission.label}</span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              {permissionOpen ? (
                <div className="retro-select-popover" id="permission-mode-options" role="listbox">
                  {permissionOptions.map((option) => (
                    <button
                      aria-selected={option.value === props.permissionMode}
                      className={option.value === props.permissionMode ? "retro-option selected" : "retro-option"}
                      key={option.value}
                      onClick={() => selectPermissionMode(option.value)}
                      role="option"
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <button className="primary-action" disabled={props.isCreating} onClick={props.onCreateCompany} type="button">
            <Play size={16} aria-hidden="true" />
            {props.isCreating ? "Creating..." : "Create Company"}
          </button>
          {props.createError ? (
            <div className="agent-empty alert" role="alert">
              {props.createError}
            </div>
          ) : null}
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
