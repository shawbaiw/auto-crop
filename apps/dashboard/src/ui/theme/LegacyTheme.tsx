import type { CSSProperties, ReactNode } from "react";

/**
 * The one palette left for Retro UI content that has not moved to the modern Workbench yet
 * (dashboard ADR 0002: skins are removed). It sets the legacy tokens the Retro components read, on
 * `.theme-root`, which is also where `RetroDialog` portals so those tokens resolve inside dialogs.
 * Delete it with the last Retro component (P5).
 */
const legacyPalette = {
  "--field": "#ffffff",
  "--ink": "#000000",
  "--surface": "#ffffff",
  "--surface-alt": "#f2f2f2",
  "--retro-border": "#000000",
  "--titlebar": "#000000",
  "--titlebar-ink": "#ffffff",
  "--selected-bg": "#000000",
  "--selected-fg": "#ffffff",
  "--accent-primary": "#000000",
  "--accent-secondary": "#000000",
  "--signal": "#ffffff",
  "--danger": "#000000",
  "--muted-pattern-a": "#ffffff",
  "--muted-pattern-b": "#000000",
  "--chart-1": "#000000",
  "--chart-2": "#ffffff",
  "--chart-3": "#000000",
} as CSSProperties;

export function LegacyTheme({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={["theme-root", className].filter(Boolean).join(" ")} style={legacyPalette}>
      {children}
    </div>
  );
}
