import { RetroMenuItem } from "./RetroMenuItem";
import { RetroMenuSeparator } from "./RetroMenuSeparator";

export type RetroMenuCommand = {
  checked?: boolean;
  disabled?: boolean;
  id: string;
  label: string;
  onSelect?(): void;
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
  group: RetroMenuGroup;
  menuId: string;
  onItemHover(index: number): void;
  onItemSelect(item: RetroMenuCommand): void;
};

export function isRetroMenuCommand(item: RetroMenuEntry): item is RetroMenuCommand {
  return !("type" in item);
}

export function RetroMenu({ activeItemIndex, group, menuId, onItemHover, onItemSelect }: RetroMenuProps) {
  return (
    <div className="retro-menu-popover" id={menuId} role="menu">
      {group.items.map((item, index) =>
        isRetroMenuCommand(item) ? (
          <RetroMenuItem
            active={index === activeItemIndex}
            checked={item.checked}
            disabled={item.disabled}
            key={item.id}
            onMouseEnter={() => onItemHover(index)}
            onSelect={() => onItemSelect(item)}
          >
            {item.label}
          </RetroMenuItem>
        ) : (
          <RetroMenuSeparator key={item.id} />
        ),
      )}
    </div>
  );
}
