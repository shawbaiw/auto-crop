import type { ReactNode } from "react";

export type WorkspaceProps = {
  children: ReactNode;
  className?: string;
};

export function Workspace({ children, className }: WorkspaceProps) {
  const classes = ["workspace", className].filter(Boolean).join(" ");

  return <section className={classes}>{children}</section>;
}
