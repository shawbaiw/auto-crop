import type { ReactNode } from "react";
import { AppShell } from "./AppShell";

export type ModalFrameProps = {
  children: ReactNode;
  className?: string;
  labelledBy: string;
  menuBar?: ReactNode;
};

export function ModalFrame({ children, className, labelledBy, menuBar }: ModalFrameProps) {
  const classes = ["app-modal-card", className].filter(Boolean).join(" ");

  return (
    <AppShell className="app-shell--modal" menuBar={menuBar}>
      <div className="app-modal-backdrop">
        <section aria-labelledby={labelledBy} aria-modal="true" className={classes} role="dialog">
          {children}
        </section>
      </div>
    </AppShell>
  );
}
