import type { ReactNode } from "react";

export type RetroPanelProps = {
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  title: string;
  variant?: "default" | "inverted";
};

export function RetroPanel({ children, className, icon, title, variant = "default" }: RetroPanelProps) {
  const classes = ["retro-panel", variant === "inverted" ? "retro-panel--inverted" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes}>
      <div className="retro-title-rail">
        {icon ? <span className="retro-title-rail__icon">{icon}</span> : null}
        <h2>{title}</h2>
      </div>
      <div className="retro-panel__body">{children}</div>
    </section>
  );
}
