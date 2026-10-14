import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A main panel: translucent warm surface, highlight edge and soft shadow, no blur of its own (spec §3). */
export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("im-panel", className)} {...props} />;
}
