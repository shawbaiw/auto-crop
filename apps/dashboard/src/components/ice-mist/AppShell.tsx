import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface AppShellProps {
  children: ReactNode;
  className?: string;
  /** Navigation column, laid out as a row on phones. */
  nav?: ReactNode;
}

/** The warm shell around navigation and the cool workspace. The only layer with backdrop-filter (spec §3). */
export function AppShell({ children, className, nav }: AppShellProps) {
  return (
    <div className={cn("im-shell", className)}>
      {nav ? <nav className="im-shell-nav">{nav}</nav> : null}
      <main className="im-shell-workspace">{children}</main>
    </div>
  );
}
