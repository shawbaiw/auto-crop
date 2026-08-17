import type { ReactNode } from "react";

export type RetroMenuItemProps = {
  active?: boolean;
  checked?: boolean;
  children: ReactNode;
  disabled?: boolean;
  hasSubmenu?: boolean;
  onMouseEnter?(): void;
  onSelect?(): void;
  shortcut?: string;
};

export function RetroMenuItem({
  active = false,
  checked = false,
  children,
  disabled = false,
  hasSubmenu = false,
  onMouseEnter,
  onSelect,
  shortcut,
}: RetroMenuItemProps) {
  const classes = ["retro-menu-item", active ? "is-active" : "", checked ? "is-checked" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      aria-checked={checked || undefined}
      aria-haspopup={hasSubmenu ? "menu" : undefined}
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
      {shortcut ? (
        <span className="retro-menu-item__shortcut" aria-hidden="true">
          {shortcut}
        </span>
      ) : null}
      {hasSubmenu ? (
        <span className="retro-menu-item__submenu" aria-hidden="true">
          &gt;
        </span>
      ) : null}
    </button>
  );
}
