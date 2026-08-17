import type { ReactNode } from "react";

export type RetroStatusProps = {
  children: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "danger";
};

export function RetroStatus({ children, icon, tone = "default" }: RetroStatusProps) {
  return (
    <div className={`retro-status retro-status--${tone}`}>
      {icon ? <span className="retro-status__icon">{icon}</span> : null}
      <span>{children}</span>
    </div>
  );
}
