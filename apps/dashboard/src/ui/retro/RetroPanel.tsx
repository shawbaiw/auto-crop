import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

export type RetroPanelProps = Omit<ComponentPropsWithoutRef<"section">, "title"> & {
  children: ReactNode;
  icon?: ReactNode;
  title: string;
  variant?: "default" | "inverted";
};

export const RetroPanel = forwardRef<HTMLElement, RetroPanelProps>(function RetroPanel(
  { children, className, icon, title, variant = "default", ...sectionProps },
  ref,
) {
  const classes = ["retro-panel", variant === "inverted" ? "retro-panel--inverted" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} ref={ref} {...sectionProps}>
      <div className="retro-title-rail">
        {icon ? <span className="retro-title-rail__icon">{icon}</span> : null}
        <h2>{title}</h2>
      </div>
      <div className="retro-panel__body">{children}</div>
    </section>
  );
});
