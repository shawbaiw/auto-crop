import { useMemo } from "react";
import type { AgentSummary } from "../../api/client";
import {
  operatingCommand,
  type WorkbenchCommand,
  type WorkbenchCommands,
} from "../../components/workbench/workbenchCommands";
import { languageOrder, useLanguage, type TranslationKey } from "../language";
import { isPaletteId, paletteOrder, palettes, useTheme } from "../theme";
import { RetroMenuBar } from "./RetroMenuBar";
import type { RetroMenuCommand, RetroMenuGroup } from "./RetroMenu";

export type DashboardMenuBarProps = {
  agents: AgentSummary[];
  /** The founder commands; the menu only lays them out and never decides when one is available. */
  commands: WorkbenchCommands;
  isPaused: boolean;
  onSelectAgent(agentId: string): void;
  selectedAgentId: string;
};

function menuCommand(command: WorkbenchCommand, t: (key: TranslationKey) => string): RetroMenuCommand {
  return {
    checked: command.checked,
    disabled: !command.enabled,
    id: command.id,
    label: t(command.labelKey),
    onSelect: command.run,
    shortcut: command.shortcut,
  };
}

export function DashboardMenuBar({ agents, commands, isPaused, onSelectAgent, selectedAgentId }: DashboardMenuBarProps) {
  const { setSkin, skin } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const detectedAgents = agents.filter((agent) => agent.detected);

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
          menuCommand(commands["create-company"], t),
          { id: "company-separator", type: "separator" },
          menuCommand(operatingCommand(commands), t),
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
          menuCommand(commands["view-tasks"], t),
          menuCommand(commands["view-departments"], t),
          menuCommand(commands["view-operations"], t),
          { checked: isPaused, disabled: true, id: "pause-status", label: t("menu.pauseStatus") },
        ],
      },
      {
        id: "proof",
        label: t("menu.proof"),
        items: [
          menuCommand(commands["load-proof"], t),
          menuCommand(commands["load-review"], t),
          menuCommand(commands["open-evidence"], t),
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
          menuCommand(commands.fullscreen, t),
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
    [commands, detectedAgents, isPaused, language, onSelectAgent, selectedAgentId, setLanguage, setSkin, skin, t],
  );

  return <RetroMenuBar groups={groups} />;
}
