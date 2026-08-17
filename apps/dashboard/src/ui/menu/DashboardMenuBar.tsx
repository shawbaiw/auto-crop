import { useMemo } from "react";
import type { AgentSummary } from "../../api/client";
import { isPaletteId, paletteOrder, palettes, useTheme } from "../theme";
import { RetroMenuBar } from "./RetroMenuBar";
import type { RetroMenuGroup } from "./RetroMenu";

export type DashboardMenuView = "onboarding" | "dashboard";

export type DashboardMenuBarProps = {
  agents: AgentSummary[];
  hasBlueprint: boolean;
  isCreating: boolean;
  isPaused: boolean;
  onActivateCompany(): void;
  onBackToSetup(): void;
  onCreateCompany(): void;
  onKillSwitch(): void;
  onLoadProof(): void;
  onLoadReviews(): void;
  onSelectAgent(agentId: string): void;
  onViewDepartments(): void;
  onViewTasks(): void;
  selectedAgentId: string;
  view: DashboardMenuView;
};

export function DashboardMenuBar({
  agents,
  hasBlueprint,
  isCreating,
  isPaused,
  onActivateCompany,
  onBackToSetup,
  onCreateCompany,
  onKillSwitch,
  onLoadProof,
  onLoadReviews,
  onSelectAgent,
  onViewDepartments,
  onViewTasks,
  selectedAgentId,
  view,
}: DashboardMenuBarProps) {
  const { setSkin, skin } = useTheme();
  const detectedAgents = agents.filter((agent) => agent.detected);

  const groups = useMemo<RetroMenuGroup[]>(
    () => [
      {
        id: "auto-crop",
        label: "Auto-Crop",
        items: [
          { disabled: true, id: "about", label: "About Auto-Crop" },
          { id: "auto-crop-separator", type: "separator" },
          { disabled: true, id: "preferences", label: "Preferences..." },
        ],
      },
      {
        id: "company",
        label: "Company",
        items: [
          {
            disabled: view !== "onboarding" || isCreating,
            id: "create-company",
            label: isCreating ? "Creating Company..." : "Create Company",
            onSelect: onCreateCompany,
          },
          {
            disabled: !hasBlueprint,
            id: "activate-company",
            label: "Activate Company",
            onSelect: onActivateCompany,
          },
          {
            disabled: view === "onboarding",
            id: "back-to-setup",
            label: "Back to Setup",
            onSelect: onBackToSetup,
          },
          { id: "company-separator", type: "separator" },
          {
            disabled: view !== "dashboard" || !hasBlueprint,
            id: "kill-switch",
            label: "Kill Switch",
            onSelect: onKillSwitch,
          },
        ],
      },
      {
        id: "agents",
        label: "Agents",
        items:
          detectedAgents.length > 0
            ? detectedAgents.map((agent) => ({
                checked: agent.id === selectedAgentId,
                id: `agent-${agent.id}`,
                label: agent.name,
                onSelect: () => onSelectAgent(agent.id),
              }))
            : [{ disabled: true, id: "no-agents-detected", label: "No Agents Detected" }],
      },
      {
        id: "work",
        label: "Work",
        items: [
          {
            disabled: view !== "dashboard" || !hasBlueprint,
            id: "view-tasks",
            label: "View Tasks",
            onSelect: onViewTasks,
          },
          {
            disabled: view !== "dashboard" || !hasBlueprint,
            id: "view-departments",
            label: "View Departments",
            onSelect: onViewDepartments,
          },
          { checked: isPaused, disabled: true, id: "pause-status", label: "Pause Status" },
        ],
      },
      {
        id: "proof",
        label: "Proof",
        items: [
          {
            disabled: view !== "dashboard" || !hasBlueprint,
            id: "load-proof",
            label: "Load Proof",
            onSelect: onLoadProof,
          },
          {
            disabled: view !== "dashboard" || !hasBlueprint,
            id: "load-review",
            label: "Load Review",
            onSelect: onLoadReviews,
          },
          { disabled: true, id: "open-evidence", label: "Open Evidence" },
        ],
      },
      {
        id: "view",
        label: "View",
        items: [
          ...paletteOrder.map((paletteId) => ({
            checked: paletteId === skin,
            id: `skin-${paletteId}`,
            label: palettes[paletteId].label,
            onSelect: () => {
              if (isPaletteId(paletteId)) {
                setSkin(paletteId);
              }
            },
          })),
          { id: "view-separator", type: "separator" as const },
          { checked: true, disabled: true, id: "crt-effect", label: "CRT Effect: Horizontal + Vignette" },
          { disabled: true, id: "fullscreen", label: "Fullscreen" },
        ],
      },
      {
        id: "help",
        label: "Help",
        items: [
          { disabled: true, id: "documentation", label: "Documentation" },
          { disabled: true, id: "github-repository", label: "GitHub Repository" },
          { disabled: true, id: "keyboard-shortcuts", label: "Keyboard Shortcuts" },
        ],
      },
    ],
    [
      detectedAgents,
      hasBlueprint,
      isCreating,
      isPaused,
      onActivateCompany,
      onBackToSetup,
      onCreateCompany,
      onKillSwitch,
      onLoadProof,
      onLoadReviews,
      onSelectAgent,
      onViewDepartments,
      onViewTasks,
      selectedAgentId,
      setSkin,
      skin,
      view,
    ],
  );

  return <RetroMenuBar groups={groups} />;
}
