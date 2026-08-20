import { useMemo } from "react";
import type { AgentSummary } from "../../api/client";
import { languageOrder, useLanguage } from "../language";
import { isPaletteId, paletteOrder, palettes, useTheme } from "../theme";
import { RetroMenuBar } from "./RetroMenuBar";
import type { RetroMenuGroup } from "./RetroMenu";

export type DashboardMenuView = "onboarding" | "creating" | "department-workspace" | "dashboard" | "operations";

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
  onViewOperations(): void;
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
  onViewOperations,
  onViewTasks,
  hasProof,
  isFullscreen,
  fullscreenAvailable,
  selectedAgentId,
  view,
}: DashboardMenuBarProps) {
  const { setSkin, skin } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const detectedAgents = agents.filter((agent) => agent.detected);
  const canViewCompanyWork = (view === "dashboard" || view === "department-workspace" || view === "operations") && hasBlueprint;

  const groups = useMemo<RetroMenuGroup[]>(
    () => [
      {
        id: "auto-crop",
        label: t("menu.app"),
        items: [
          { disabled: true, id: "about", label: t("menu.about") },
          { id: "auto-crop-separator", type: "separator" },
          { disabled: true, id: "preferences", label: t("menu.preferences") },
        ],
      },
      {
        id: "company",
        label: t("menu.company"),
        items: [
          {
            disabled: !canCreateCompany || isCreating,
            id: "create-company",
            label: isCreating ? t("menu.creatingCompany") : t("menu.createCompany"),
            onSelect: onCreateCompany,
            shortcut: "Cmd+Enter",
          },
          {
            disabled: !hasBlueprint,
            id: "activate-company",
            label: t("menu.activateCompany"),
            onSelect: onActivateCompany,
            shortcut: "Shift+Cmd+Enter",
          },
          {
            disabled: view === "onboarding" || view === "creating",
            id: "back-to-setup",
            label: t("menu.backToSetup"),
            onSelect: onBackToSetup,
            shortcut: "Cmd+B",
          },
          { id: "company-separator", type: "separator" },
          {
            disabled: view !== "dashboard" || !hasBlueprint,
            id: "kill-switch",
            label: t("menu.killSwitch"),
            onSelect: onKillSwitch,
            shortcut: "Shift+Cmd+K",
          },
        ],
      },
      {
        id: "agents",
        label: t("menu.agents"),
        items:
          detectedAgents.length > 0
            ? detectedAgents.map((agent) => ({
                checked: agent.id === selectedAgentId,
                id: `agent-${agent.id}`,
                label: agent.name,
                onSelect: () => onSelectAgent(agent.id),
              }))
            : [{ disabled: true, id: "no-agents-detected", label: t("menu.noAgentsDetected") }],
      },
      {
        id: "work",
        label: t("menu.work"),
        items: [
          {
            disabled: !canViewCompanyWork,
            id: "view-tasks",
            label: t("menu.viewTasks"),
            onSelect: onViewTasks,
            shortcut: "Cmd+1",
          },
          {
            disabled: !canViewCompanyWork,
            id: "view-departments",
            label: t("menu.viewDepartments"),
            onSelect: onViewDepartments,
            shortcut: "Cmd+2",
          },
          {
            disabled: !canViewCompanyWork,
            id: "view-operations",
            label: t("menu.viewOperations"),
            onSelect: onViewOperations,
          },
          { checked: isPaused, disabled: true, id: "pause-status", label: t("menu.pauseStatus") },
        ],
      },
      {
        id: "proof",
        label: t("menu.proof"),
        items: [
          {
            disabled: view !== "dashboard" || !hasBlueprint,
            id: "load-proof",
            label: t("menu.loadProof"),
            onSelect: onLoadProof,
            shortcut: "Cmd+3",
          },
          {
            disabled: view !== "dashboard" || !hasBlueprint,
            id: "load-review",
            label: t("menu.loadReview"),
            onSelect: onLoadReviews,
            shortcut: "Cmd+4",
          },
          {
            disabled: view !== "dashboard" || !hasBlueprint || !hasProof,
            id: "open-evidence",
            label: t("menu.openEvidence"),
            onSelect: onOpenEvidence,
            shortcut: "Cmd+5",
          },
        ],
      },
      {
        id: "view",
        label: t("menu.view"),
        items: [
          {
            id: "skin",
            label: t("menu.skin"),
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
          {
            id: "language",
            label: t("menu.language"),
            children: languageOrder.map((languageId) => ({
              checked: languageId === language,
              id: `language-${languageId}`,
              label: languageId === "zh" ? t("menu.languageChinese") : t("menu.languageEnglish"),
              onSelect: () => setLanguage(languageId),
            })),
          },
          { id: "view-separator", type: "separator" as const },
          { checked: true, disabled: true, id: "crt-effect", label: t("menu.crtEffect") },
          {
            checked: isFullscreen,
            disabled: !fullscreenAvailable,
            id: "fullscreen",
            label: isFullscreen ? t("menu.exitFullscreen") : t("menu.fullscreen"),
            onSelect: onToggleFullscreen,
            shortcut: "Ctrl+Cmd+F",
          },
        ],
      },
      {
        id: "help",
        label: t("menu.help"),
        items: [
          { disabled: true, id: "documentation", label: t("menu.documentation") },
          { disabled: true, id: "github-repository", label: t("menu.githubRepository") },
          { disabled: true, id: "keyboard-shortcuts", label: t("menu.keyboardShortcuts") },
        ],
      },
    ],
    [
      detectedAgents,
      language,
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
      onViewOperations,
      onViewTasks,
      fullscreenAvailable,
      hasProof,
      isFullscreen,
      selectedAgentId,
      setLanguage,
      setSkin,
      skin,
      t,
      view,
    ],
  );

  return <RetroMenuBar groups={groups} />;
}
