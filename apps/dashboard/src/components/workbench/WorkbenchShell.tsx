import { Menu, Pause, Play } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { cardClassName } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useLanguage } from "../../ui/language";
import { LanguageSwitch } from "./LanguageSwitch";
import type { WorkbenchCommand } from "./workbenchCommands";

export type WorkbenchShellProps = {
  children: ReactNode;
  /** The page is one screen tall and scrolls inside itself, as CEO Office and the department pages do. */
  fill?: boolean;
  /** Where the founder is: CEO Office, a department, or a company-wide page. */
  location: string;
  /** Pause or Resume Operating, from the shared command model. Hidden when it cannot run. */
  operatingCommand: WorkbenchCommand;
  /** A notice about the whole company, such as it being paused. */
  notice?: ReactNode;
  /** Closes the narrow-screen rail when the founder navigates. */
  navigationKey: string;
  rail: ReactNode;
};

/**
 * The Workbench frame (dashboard ADR 0002): a left rail and a header with the current location,
 * Pause or Resume Operating, and a language switch. On narrow screens the rail opens over the page.
 */
export function WorkbenchShell({ children, fill = false, location, navigationKey, notice, operatingCommand, rail }: WorkbenchShellProps) {
  const { t } = useLanguage();
  const [railOpen, setRailOpen] = useState(false);

  useEffect(() => setRailOpen(false), [navigationKey]);
  useEffect(() => {
    if (!railOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRailOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [railOpen]);

  return (
    <div className="modern-dashboard-shell min-h-screen bg-background font-sans text-foreground">
      <div className="mx-auto grid min-h-screen w-full max-w-[1440px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-screen border-r border-border/70 p-3 lg:block">{rail}</aside>
        {railOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              aria-label={t("workbench.closeNavigation")}
              className="absolute inset-0 bg-foreground/20"
              onClick={() => setRailOpen(false)}
              type="button"
            />
            {/* Choosing any page closes the rail, including the page already open. */}
            <aside
              className={cn(cardClassName, "absolute inset-y-0 left-0 w-[min(280px,85vw)] rounded-none p-3")}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button")) setRailOpen(false);
              }}
            >
              {rail}
            </aside>
          </div>
        ) : null}
        <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]", fill && "h-dvh")}>
          <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border/70 bg-background/90 px-4 py-2.5 backdrop-blur sm:px-6">
            <Button
              aria-expanded={railOpen}
              aria-label={t("workbench.openNavigation")}
              className="lg:hidden"
              onClick={() => setRailOpen(true)}
              size="icon"
              variant="ghost"
            >
              <Menu aria-hidden="true" />
            </Button>
            <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{location}</h1>
            <LanguageSwitch />
            {operatingCommand.enabled ? (
              <Button
                aria-label={t(operatingCommand.labelKey)}
                className={cn(
                  operatingCommand.id === "pause-operating" && "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100",
                )}
                onClick={operatingCommand.run}
                size="sm"
                title={operatingCommand.shortcut}
                variant="outline"
              >
                {operatingCommand.id === "pause-operating" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                <span className="hidden sm:inline">{t(operatingCommand.labelKey)}</span>
              </Button>
            ) : null}
          </header>
          <main
            className={cn(
              "min-w-0 px-4 py-5 sm:px-6",
              fill ? "flex min-h-0 flex-col gap-3 overflow-hidden py-3 [&>*:last-child]:min-h-0 [&>*:last-child]:flex-1" : "grid content-start gap-4",
            )}
          >
            {notice}
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

