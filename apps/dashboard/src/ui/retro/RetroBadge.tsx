import type { ReactNode } from "react";

export type RetroBadgeProps = {
  children: ReactNode;
  tone?: "default" | "signal" | "danger" | "muted";
};

export function RetroBadge({ children, tone = "default" }: RetroBadgeProps) {
  return <span className={`retro-badge retro-badge--${tone}`}>{children}</span>;
}
