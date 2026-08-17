import { useEffect, useMemo, useRef, useState } from "react";
import { RetroMenu, isRetroMenuCommand, type RetroMenuCommand, type RetroMenuEntry, type RetroMenuGroup } from "./RetroMenu";

export type RetroMenuBarProps = {
  groups: RetroMenuGroup[];
  mobileLabel?: string;
};

type MenuStripProps = {
  groups: RetroMenuGroup[];
  namespace: string;
};

function firstEnabledItemIndex(group: RetroMenuGroup) {
  const index = group.items.findIndex((item) => isRetroMenuCommand(item) && !item.disabled);
  return Math.max(0, index);
}

function nextEnabledItemIndex(group: RetroMenuGroup, currentIndex: number, delta: number) {
  if (group.items.length === 0) {
    return 0;
  }

  for (let offset = 1; offset <= group.items.length; offset += 1) {
    const nextIndex = (currentIndex + offset * delta + group.items.length) % group.items.length;
    const item = group.items[nextIndex];
    if (isRetroMenuCommand(item) && !item.disabled) {
      return nextIndex;
    }
  }

  return currentIndex;
}

function MenuStrip({ groups, namespace }: MenuStripProps) {
  const [openGroupIndex, setOpenGroupIndex] = useState<number | null>(null);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const openGroup = openGroupIndex === null ? null : groups[openGroupIndex];

  useEffect(() => {
    if (openGroupIndex === null) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenGroupIndex(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openGroupIndex]);

  function openGroupAt(index: number) {
    setOpenGroupIndex(index);
    setActiveItemIndex(firstEnabledItemIndex(groups[index]));
  }

  function closeMenu() {
    setOpenGroupIndex(null);
  }

  function moveGroup(delta: number) {
    const currentIndex = openGroupIndex ?? 0;
    const nextIndex = (currentIndex + delta + groups.length) % groups.length;
    openGroupAt(nextIndex);
    triggerRefs.current[nextIndex]?.focus();
  }

  function selectItem(item: RetroMenuCommand) {
    if (item.disabled) {
      return;
    }

    item.onSelect?.();
    closeMenu();
  }

  return (
    <div className="retro-menu-strip" ref={rootRef} role="menubar">
      {groups.map((group, groupIndex) => {
        const menuId = `${namespace}-${group.id}-menu`;
        const isOpen = groupIndex === openGroupIndex;

        return (
          <div className="retro-menu-root" key={group.id}>
            <button
              aria-controls={menuId}
              aria-expanded={isOpen}
              aria-haspopup="menu"
              className={isOpen ? "retro-menu-trigger is-open" : "retro-menu-trigger"}
              onClick={() => {
                if (isOpen) {
                  closeMenu();
                } else {
                  openGroupAt(groupIndex);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openGroupAt(groupIndex);
                  return;
                }
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  moveGroup(1);
                  return;
                }
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  moveGroup(-1);
                  return;
                }
                if (event.key === "Escape") {
                  closeMenu();
                }
              }}
              onMouseEnter={() => {
                if (openGroupIndex !== null) {
                  openGroupAt(groupIndex);
                }
              }}
              ref={(element) => {
                triggerRefs.current[groupIndex] = element;
              }}
              role="menuitem"
              type="button"
            >
              {group.label}
            </button>
            {isOpen && openGroup ? (
              <div
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveItemIndex((current) => nextEnabledItemIndex(openGroup, current, 1));
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveItemIndex((current) => nextEnabledItemIndex(openGroup, current, -1));
                    return;
                  }
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    moveGroup(1);
                    return;
                  }
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    moveGroup(-1);
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const item = openGroup.items[activeItemIndex];
                    if (item && isRetroMenuCommand(item)) {
                      selectItem(item);
                    }
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeMenu();
                    triggerRefs.current[groupIndex]?.focus();
                  }
                }}
              >
                <RetroMenu
                  activeItemIndex={activeItemIndex}
                  group={openGroup}
                  menuId={menuId}
                  onItemHover={setActiveItemIndex}
                  onItemSelect={selectItem}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function makeMobileGroup(groups: RetroMenuGroup[], mobileLabel: string): RetroMenuGroup {
  const items = groups.flatMap<RetroMenuEntry>((group, groupIndex) => [
    {
      disabled: true,
      id: `${group.id}-mobile-heading`,
      label: group.label,
    },
    ...group.items,
    ...(groupIndex === groups.length - 1 ? [] : [{ id: `${group.id}-mobile-separator`, type: "separator" as const }]),
  ]);

  return {
    id: "mobile-menu",
    items,
    label: mobileLabel,
  };
}

export function RetroMenuBar({ groups, mobileLabel = "Menu" }: RetroMenuBarProps) {
  const mobileGroups = useMemo(() => [makeMobileGroup(groups, mobileLabel)], [groups, mobileLabel]);

  return (
    <nav aria-label="Application menu" className="retro-menu-bar">
      <div className="retro-menu-bar__desktop">
        <MenuStrip groups={groups} namespace="desktop" />
      </div>
      <div className="retro-menu-bar__mobile">
        <MenuStrip groups={mobileGroups} namespace="mobile" />
      </div>
    </nav>
  );
}
