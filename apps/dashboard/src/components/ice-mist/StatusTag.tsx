import type { ReactNode } from "react";
import { Check, CircleAlert, Clock, Hand, LoaderCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "failed" | "waiting" | "running" | "queued";

const toneIcons: Record<StatusTone, LucideIcon> = {
  success: Check,
  failed: CircleAlert,
  waiting: Hand,
  running: LoaderCircle,
  queued: Clock,
};

export interface StatusTagProps {
  /** The visible status text; the tone never carries the meaning alone. */
  children: ReactNode;
  className?: string;
  /** Running tags spin by default; off where another icon already carries the loading feedback (spec §5.1). */
  spin?: boolean;
  tone: StatusTone;
}

/** A 24px status pill: icon plus text in the tone's fg/bg pair (spec §2 component sizes). */
export function StatusTag({ children, className, spin = true, tone }: StatusTagProps) {
  const Icon = toneIcons[tone];
  return (
    <span className={cn("im-tag", className)} data-tone={tone}>
      <Icon aria-hidden="true" className={tone === "running" && spin ? "im-spin" : undefined} strokeWidth={2} />
      {children}
    </span>
  );
}
