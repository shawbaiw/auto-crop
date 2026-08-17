import type { ReactNode } from "react";
import { SkinSwitcher } from "../theme";

export type AppShellProps = {
  children: ReactNode;
  className?: string;
};

export function AppShell({ children, className }: AppShellProps) {
  const classes = ["app-shell", className].filter(Boolean).join(" ");

  return (
    <main className={classes}>
      <div className="app-shell__utility">
        <SkinSwitcher />
      </div>
      {children}
    </main>
  );
}
