import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** The page environment: mist with an ice glow top-left and a cool glow bottom-right (spec §3). */
export function AmbientBackground({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("im-ambient", className)} {...props} />;
}
