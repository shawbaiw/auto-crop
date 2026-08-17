import { RetroMenuItem } from "./RetroMenuItem";
import { RetroMenuSeparator } from "./RetroMenuSeparator";

export type RetroMenuCommand = {
  checked?: boolean;
  children?: RetroMenuEntry[];
  disabled?: boolean;
  id: string;
  label: string;
  onSelect?(): void;
  shortcut?: string;
};

export type RetroMenuSeparatorEntry = {
  id: string;
  type: "separator";
};

export type RetroMenuEntry = RetroMenuCommand | RetroMenuSeparatorEntry;

export type RetroMenuGroup = {
  id: string;
  items: RetroMenuEntry[];
  label: string;
};

export type RetroMenuProps = {
  activeItemIndex: number;
  activeSubItemIndex: number | null;
  group: RetroMenuGroup;
  menuId: string;
  onItemHover(index: number): void;
  onItemSelect(item: RetroMenuCommand): void;
  onSubItemHover(index: number): void;
  onSubItemSelect(item: RetroMenuCommand): void;
};

export function isRetroMenuCommand(item: RetroMenuEntry): item is RetroMenuCommand {
  return !("type" in item);
}

export function hasRetroSubmenu(item: RetroMenuEntry): item is RetroMenuCommand & { children: RetroMenuEntry[] } {
  return isRetroMenuCommand(item) && Array.isArray(item.children) && item.children.length > 0;
}

export function RetroMenu({
  activeItemIndex,
  activeSubItemIndex,
  group,
  menuId,
  onItemHover,
  onItemSelect,
  onSubItemHover,
  onSubItemSelect,
}: RetroMenuProps) {
  return (
    <div className="retro-menu-popover" id={menuId} role="menu">
      {group.items.map((item, index) => {
        if (!isRetroMenuCommand(item)) {
          return <RetroMenuSeparator key={item.id} />;
        }

        const isActive = index === activeItemIndex;
        const hasSubmenu = hasRetroSubmenu(item);

        return (
          <div className="retro-menu-item-wrap" key={item.id}>
            <RetroMenuItem
              active={isActive}
              checked={item.checked}
              disabled={item.disabled}
              hasSubmenu={hasSubmenu}
              onMouseEnter={() => onItemHover(index)}
              onSelect={() => onItemSelect(item)}
              shortcut={item.shortcut}
            >
              {item.label}
            </RetroMenuItem>
            {hasSubmenu && isActive ? (
              <div className="retro-menu-popover retro-menu-popover--submenu" role="menu">
                {item.children.map((child, childIndex) =>
                  isRetroMenuCommand(child) ? (
                    <RetroMenuItem
                      active={childIndex === activeSubItemIndex}
                      checked={child.checked}
                      disabled={child.disabled}
                      key={child.id}
                      onMouseEnter={() => onSubItemHover(childIndex)}
                      onSelect={() => onSubItemSelect(child)}
                      shortcut={child.shortcut}
                    >
                      {child.label}
                    </RetroMenuItem>
                  ) : (
                    <RetroMenuSeparator key={child.id} />
                  ),
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
