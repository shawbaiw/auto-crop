import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type WorkspaceProps = ComponentPropsWithoutRef<"section"> & {
  children: ReactNode;
};

export function Workspace({ children, className, ...sectionProps }: WorkspaceProps) {
  const classes = ["workspace", className].filter(Boolean).join(" ");

  return (
    <section className={classes} {...sectionProps}>
      {children}
    </section>
  );
}
