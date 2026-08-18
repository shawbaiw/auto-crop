import { useMemo } from "react";
import type { AgentSummary } from "../../api/client";
import { isPaletteId, paletteOrder, palettes, useTheme } from "../theme";
import { RetroMenuBar } from "./RetroMenuBar";
import type { RetroMenuGroup } from "./RetroMenu";

export type DashboardMenuView = "onboarding" | "creating" | "department-workspace" | "dashboard";

export type DashboardMenuBarProps = {
  agents: AgentSummary[];
  canCreateCompany: boolean;
  hasBlueprint: boolean;
  isCreating: boolean;
  isPaused: boolean;
  onActivateCompany(): void;
  onBackToSetup(): void;
  onCreateCompany(): void;
  onKillSwitch(): void;
  onLoadProof(): void;
  onLoadReviews(): void;
  onOpenEvidence(): void;
  onSelectAgent(agentId: string): void;
  onToggleFullscreen(): void;
  onViewDepartments(): void;
  onViewTasks(): void;
  hasProof: boolean;
  isFullscreen: boolean;
  fullscreenAvailable: boolean;
  selectedAgentId: string;
  view: DashboardMenuView;
};

export function DashboardMenuBar({
  agents,
  canCreateCompany,
  hasBlueprint,
  isCreating,
  isPaused,
  onActivateCompany,
  onBackToSetup,
  onCreateCompany,
  onKillSwitch,
  onLoadProof,
  onLoadReviews,
  onOpenEvidence,
  onSelectAgent,
  onToggleFullscreen,
  onViewDepartments,
  onViewTasks,
  hasProof,
  isFullscreen,
  fullscreenAvailable,
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
            disabled: !canCreateCompany || isCreating,
            id: "create-company",
            label: isCreating ? "Creating Company..." : "Create Company",
            onSelect: onCreateCompany,
            shortcut: "Cmd+Enter",
          },
          {
            disabled: !hasBlueprint,
            id: "activate-company",
            label: "Activate Company",
            onSelect: onActivateCompany,
            shortcut: "Shift+Cmd+Enter",
          },
          {
            disabled: view === "onboarding" || view === "creating",
            id: "back-to-setup",
            label: "Back to Setup",
            onSelect: onBackToSetup,
            shortcut: "Cmd+B",
          },
          { id: "company-separator", type: "separator" },
          {
            disabled: view !== "dashboard" || !hasBlueprint,
            id: "kill-switch",
            label: "Kill Switch",
            onSelect: onKillSwitch,
            shortcut: "Shift+Cmd+K",
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
            disabled: (view !== "dashboard" && view !== "department-workspace") || !hasBlueprint,
            id: "view-tasks",
            label: "View Tasks",
            onSelect: onViewTasks,
            shortcut: "Cmd+1",
          },
          {
            disabled: (view !== "dashboard" && view !== "department-workspace") || !hasBlueprint,
            id: "view-departments",
            label: "View Departments",
            onSelect: onViewDepartments,
            shortcut: "Cmd+2",
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
            shortcut: "Cmd+3",
          },
          {
            disabled: view !== "dashboard" || !hasBlueprint,
            id: "load-review",
            label: "Load Review",
            onSelect: onLoadReviews,
            shortcut: "Cmd+4",
          },
          {
            disabled: view !== "dashboard" || !hasBlueprint || !hasProof,
            id: "open-evidence",
            label: "Open Evidence",
            onSelect: onOpenEvidence,
            shortcut: "Cmd+5",
          },
        ],
      },
      {
        id: "view",
        label: "View",
        items: [
          {
            id: "skin",
            label: "Skin",
            children: paletteOrder.map((paletteId) => ({
              checked: paletteId === skin,
              id: `skin-${paletteId}`,
              label: palettes[paletteId].label,
              onSelect: () => {
                if (isPaletteId(paletteId)) {
                  setSkin(paletteId);
                }
              },
            })),
          },
          { id: "view-separator", type: "separator" as const },
          { checked: true, disabled: true, id: "crt-effect", label: "CRT Effect: Horizontal + Vignette" },
          {
            checked: isFullscreen,
            disabled: !fullscreenAvailable,
            id: "fullscreen",
            label: isFullscreen ? "Exit Fullscreen" : "Fullscreen",
            onSelect: onToggleFullscreen,
            shortcut: "Ctrl+Cmd+F",
          },
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
      canCreateCompany,
      hasBlueprint,
      isCreating,
      isPaused,
      onActivateCompany,
      onBackToSetup,
      onCreateCompany,
      onKillSwitch,
      onLoadProof,
      onLoadReviews,
      onOpenEvidence,
      onSelectAgent,
      onToggleFullscreen,
      onViewDepartments,
      onViewTasks,
      fullscreenAvailable,
      hasProof,
      isFullscreen,
      selectedAgentId,
      setSkin,
      skin,
      view,
    ],
  );

  return <RetroMenuBar groups={groups} />;
}
