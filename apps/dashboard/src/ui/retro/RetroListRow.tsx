import type { ButtonHTMLAttributes, ReactNode } from "react";

export type RetroListRowProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  meta?: string;
  selected?: boolean;
  title: string;
};

export function RetroListRow({ className, icon, meta, selected = false, title, ...props }: RetroListRowProps) {
  const classes = ["retro-list-row", selected ? "is-selected" : "", className].filter(Boolean).join(" ");

  return (
    <button aria-pressed={selected} className={classes} type="button" {...props}>
      <strong>
        {icon ? <span className="retro-list-row__icon">{icon}</span> : null}
        <span>{title}</span>
      </strong>
      {meta ? <span>{meta}</span> : null}
    </button>
  );
}
