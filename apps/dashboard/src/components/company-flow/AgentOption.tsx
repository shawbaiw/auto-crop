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
        // A radio card (color system v2 §5.3): chosen is a reading surface with a 2px charcoal edge.
        "flex items-center justify-between gap-3 rounded-[var(--r-reading)] border border-[color:var(--edge-input)] bg-[color:var(--surface-input)] px-3 py-3 text-left text-foreground transition-colors hover:bg-accent focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-[color:var(--c-mist)] disabled:text-[color:var(--text-disabled)] disabled:hover:bg-[color:var(--c-mist)]",
        selected && "border-2 border-[color:var(--c-charcoal)] bg-[color:var(--surface-reading)] px-[11px] py-[11px] hover:bg-[color:var(--surface-reading)]",
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
