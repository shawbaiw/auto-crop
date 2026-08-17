import type { ReactNode } from "react";

export type AppShellProps = {
  children: ReactNode;
  className?: string;
  menuBar?: ReactNode;
};

export function AppShell({ children, className, menuBar }: AppShellProps) {
  const classes = ["app-shell", className].filter(Boolean).join(" ");

  return (
    <main className={classes}>
      {menuBar}
      {children}
    </main>
  );
}
