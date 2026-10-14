import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A near-opaque surface for failure reasons, generated results and long text. No shadow (spec §3). */
export function ReadingSurface({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("im-reading", className)} {...props} />;
}
