import type { ReactNode } from "react";

export type RetroMenuItemProps = {
  active?: boolean;
  checked?: boolean;
  children: ReactNode;
  disabled?: boolean;
  onMouseEnter?(): void;
  onSelect?(): void;
};

export function RetroMenuItem({ active = false, checked = false, children, disabled = false, onMouseEnter, onSelect }: RetroMenuItemProps) {
  const classes = ["retro-menu-item", active ? "is-active" : "", checked ? "is-checked" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      aria-checked={checked || undefined}
      className={classes}
      disabled={disabled}
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      role={checked ? "menuitemcheckbox" : "menuitem"}
      type="button"
    >
      <span className="retro-menu-item__check" aria-hidden="true">
        {checked ? "*" : ""}
      </span>
      <span className="retro-menu-item__label">{children}</span>
    </button>
  );
}
