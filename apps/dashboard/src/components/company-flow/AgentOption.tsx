import { Check } from "lucide-react";
import type { AgentSummary } from "../../api/client";
import { cn } from "@/lib/utils";
import { useLanguage } from "../../ui/language";

export type AgentOptionProps = {
  agent: AgentSummary;
  selected: boolean;
  onSelect(agentId: string): void;
};

export function AgentOption({ agent, onSelect, selected }: AgentOptionProps) {
  const { t } = useLanguage();

  return (
    <button
      aria-pressed={selected}
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-3 text-left text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background disabled:hover:text-foreground",
        selected && "border-primary bg-secondary",
      )}
      disabled={!agent.detected}
      onClick={() => onSelect(agent.id)}
      type="button"
    >
      <span className="grid gap-1">
        <span className="font-medium">{agent.name}</span>
        <span className="text-sm text-muted-foreground">
          {agent.detected ? t("onboarding.available") : t("onboarding.unavailable")}
        </span>
      </span>
      {selected ? <Check aria-hidden="true" className="size-4 shrink-0 text-primary" /> : null}
    </button>
  );
}
