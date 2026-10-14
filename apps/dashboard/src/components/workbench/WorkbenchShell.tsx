import { Menu, PanelLeftClose, PanelLeftOpen, Pause, Play, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AmbientBackground, PillButton } from "../ice-mist";
import { useLanguage } from "../../ui/language";
import { LanguageSwitch } from "./LanguageSwitch";
import type { RailVariant } from "./WorkbenchRail";
import type { WorkbenchCommand } from "./workbenchCommands";

export type WorkbenchShellProps = {
  children: ReactNode;
  /** The page is one screen tall and scrolls inside itself, as CEO Office and the department pages do. */
  fill?: boolean;
  /** Where the founder is: CEO Office, a department, or a company-wide page. */
  location: string;
  /** A status beside the location, such as the company being paused. */
  locationStatus?: ReactNode;
  /** Pause or Resume Operating, from the shared command model. Hidden when it cannot run. */
  operatingCommand: WorkbenchCommand;
  /** A notice about the whole company, such as it being paused. */
  notice?: ReactNode;
  /** Closes the narrow-screen rail when the founder navigates. */
  navigationKey: string;
  /** The rail in the given form: icons on the collapsed desktop rail, full when expanded or in the phone drawer. */
  rail(variant: RailVariant): ReactNode;
};

const railExpandedKey = "auto-crop.workbenchRailExpanded";

/**
 * The Workbench frame (dashboard ADR 0002) in the Ice Mist shell: a rail and a header with the current
 * location, Pause or Resume Operating and a language switch, around the cool workspace. The desktop rail
 * is 80px of icons and expands to full names; on narrow screens the rail opens as a drawer over the page.
 */
export function WorkbenchShell({ children, fill = false, location, locationStatus, navigationKey, notice, operatingCommand, rail }: WorkbenchShellProps) {
  const { t } = useLanguage();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railExpanded, setRailExpanded] = useState(readRailExpanded);

  useEffect(() => setDrawerOpen(false), [navigationKey]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const toggleRail = () => {
    setRailExpanded(!railExpanded);
    writeRailExpanded(!railExpanded);
  };
  const pausing = operatingCommand.id === "pause-operating";

  return (
    <div className="font-sans">
      <AmbientBackground>
        <div className="im-shell im-workbench" data-fill={fill || undefined}>
          <aside className="im-workbench-rail" data-expanded={railExpanded || undefined}>
            {rail(railExpanded ? "full" : "icons")}
            <button
              aria-label={t(railExpanded ? "workbench.collapseNavigation" : "workbench.expandNavigation")}
              className="im-rail-toggle"
              onClick={toggleRail}
              title={t(railExpanded ? "workbench.collapseNavigation" : "workbench.expandNavigation")}
              type="button"
            >
              {railExpanded ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
            </button>
          </aside>
          <div className="im-workbench-column">
            <header className="im-workbench-header">
              <PillButton
                aria-expanded={drawerOpen}
                aria-label={t("workbench.openNavigation")}
                className="im-workbench-menu"
                data-icon-only=""
                onClick={() => setDrawerOpen(true)}
              >
                <Menu aria-hidden="true" />
              </PillButton>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="min-w-0 max-w-full truncate text-[22px] font-normal leading-tight tracking-[-0.01em] sm:text-[30px]">{location}</h1>
                {locationStatus}
              </div>
              <LanguageSwitch />
              {operatingCommand.enabled ? (
                <PillButton
                  aria-label={t(operatingCommand.labelKey)}
                  data-collapse-label=""
                  onClick={operatingCommand.run}
                  title={operatingCommand.shortcut}
                  // Pausing is a secondary action; resuming a paused company is the one thing to do next.
                  variant={pausing ? "secondary" : "primary"}
                >
                  {pausing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                  <span className="im-pill-label">{t(operatingCommand.labelKey)}</span>
                </PillButton>
              ) : null}
            </header>
            <main className="im-shell-workspace im-workbench-workspace">
              {notice}
              {children}
            </main>
          </div>
        </div>
      </AmbientBackground>
      {/* In <body>, not the page: the Workbench's enter animation and the shell's blur would make the drawer
          position against them instead of the screen. */}
      {drawerOpen
        ? createPortal(
            <div className="im-drawer-layer font-sans">
              {/* The scrim closes on a click; keyboard users have the close button and Escape. */}
              <div aria-hidden="true" className="im-scrim" onClick={() => setDrawerOpen(false)} />
              {/* Choosing any page closes the drawer, including the page already open. */}
              <aside
                className="im-drawer"
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("button")) setDrawerOpen(false);
                }}
              >
                <div className="flex justify-end">
                  <PillButton aria-label={t("workbench.closeNavigation")} data-icon-only="" variant="secondary">
                    <X aria-hidden="true" />
                  </PillButton>
                </div>
                {rail("full")}
              </aside>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** Whether the founder left the desktop rail expanded. Storage can be missing or blocked; the rail then starts collapsed. */
function readRailExpanded(): boolean {
  try {
    return window.localStorage.getItem(railExpandedKey) === "true";
  } catch {
    return false;
  }
}

function writeRailExpanded(expanded: boolean) {
  try {
    window.localStorage.setItem(railExpandedKey, String(expanded));
  } catch {
    // Not remembered this time; the rail still toggles.
  }
}
