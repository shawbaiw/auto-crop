import { Bot } from "lucide-react";
import { siClaude, siOpenai, type SimpleIcon } from "simple-icons";
import { cn } from "@/lib/utils";

/** Brand marks from Simple Icons, keyed by agent id (dashboard ADR 0002). */
const agentIcons: Record<string, SimpleIcon> = {
  "claude-code": siClaude,
  codex: siOpenai,
};

export type AgentIconProps = {
  agentId: string;
  /** The agent's display name; also its initials when it has no brand mark. */
  name: string;
  className?: string;
  /** Decorative icons sit beside the agent's name, which already says who it is. */
  decorative?: boolean;
};

/** An agent's brand mark, or a generic bot with its initials when it has none. */
export function AgentIcon({ agentId, className, decorative = false, name }: AgentIconProps) {
  const icon = agentIcons[agentId];
  const a11y = decorative ? { "aria-hidden": true as const } : { "aria-label": name, role: "img" };

  if (icon) {
    return (
      <svg className={cn("size-4 shrink-0", className)} viewBox="0 0 24 24" {...a11y}>
        <path d={icon.path} fill={`#${icon.hex}`} />
      </svg>
    );
  }

  return (
    <span className={cn("relative inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground", className)} {...a11y}>
      <Bot aria-hidden="true" className="size-4" />
      <span className="absolute -bottom-1 -right-1.5 rounded bg-muted px-0.5 text-[8px] font-semibold leading-none text-foreground">
        {initials(name)}
      </span>
    </span>
  );
}

function initials(name: string): string {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}
