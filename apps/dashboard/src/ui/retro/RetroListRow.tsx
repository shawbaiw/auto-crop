import type { ButtonHTMLAttributes } from "react";

export type RetroListRowProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  meta?: string;
  selected?: boolean;
  title: string;
};

export function RetroListRow({ className, meta, selected = false, title, ...props }: RetroListRowProps) {
  const classes = ["retro-list-row", selected ? "is-selected" : "", className].filter(Boolean).join(" ");

  return (
    <button aria-pressed={selected} className={classes} type="button" {...props}>
      <strong>{title}</strong>
      {meta ? <span>{meta}</span> : null}
    </button>
  );
}
