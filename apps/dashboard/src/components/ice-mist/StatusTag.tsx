import type { ReactNode } from "react";
import { Check, CircleAlert, Clock, Hand, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** One color per state (color system v2 §3.3); the icon and text say which kind it is. */
export type StatusTone = "success" | "failed" | "running" | "caution" | "queued" | "yourTurn";

const toneIcons: Record<StatusTone, LucideIcon> = {
  success: Check,
  failed: CircleAlert,
  running: LoaderCircle,
  caution: TriangleAlert,
  queued: Clock,
  yourTurn: Hand,
};

export interface StatusTagProps {
  /** The visible status text; the tone never carries the meaning alone. */
  children: ReactNode;
  className?: string;
  /** Overrides the tone's icon where one color means several things, e.g. Pause for queued, Eye for a review. */
  icon?: LucideIcon;
  /** Running tags spin by default; off where another icon already carries the loading feedback (spec §5.1). */
  spin?: boolean;
  tone: StatusTone;
}

/** A 24px status pill: icon plus text in the tone's fg/bg pair (spec §2 component sizes). */
export function StatusTag({ children, className, icon, spin = true, tone }: StatusTagProps) {
  const Icon = icon ?? toneIcons[tone];
  return (
    <span className={cn("im-tag", className)} data-tone={tone}>
      <Icon aria-hidden="true" className={tone === "running" && spin && !icon ? "im-spin" : undefined} strokeWidth={2} />
      {children}
    </span>
  );
}
