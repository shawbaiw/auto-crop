import { createContext, useContext, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { paletteOrder, palettes, type PaletteId } from "./palettes";

type ThemeContextValue = {
  skin: PaletteId;
  setSkin(skin: PaletteId): void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export type ThemeProviderProps = {
  children: ReactNode;
  defaultSkin?: PaletteId;
};

export function ThemeProvider({ children, defaultSkin = "mono" }: ThemeProviderProps) {
  const [skin, setSkin] = useState<PaletteId>(defaultSkin);
  const palette = palettes[skin];
  const style = useMemo(
    () =>
      ({
        "--field": palette.colors.field,
        "--ink": palette.colors.ink,
        "--surface": palette.colors.surface,
        "--surface-alt": palette.colors.surfaceAlt,
        "--border": palette.colors.border,
        "--titlebar": palette.colors.titlebar,
        "--titlebar-ink": palette.colors.titlebarInk,
        "--selected-bg": palette.colors.selectedBg,
        "--selected-fg": palette.colors.selectedFg,
        "--accent-primary": palette.colors.accentPrimary,
        "--accent-secondary": palette.colors.accentSecondary,
        "--signal": palette.colors.signal,
        "--danger": palette.colors.danger,
        "--muted-pattern-a": palette.colors.mutedPatternA,
        "--muted-pattern-b": palette.colors.mutedPatternB,
        "--chart-1": palette.colors.chart1,
        "--chart-2": palette.colors.chart2,
        "--chart-3": palette.colors.chart3,
      }) as CSSProperties,
    [palette],
  );

  const value = useMemo(() => ({ skin, setSkin }), [skin]);

  return (
    <ThemeContext.Provider value={value}>
      <div className="theme-root" data-skin={skin} style={style}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider.");
  }
  return context;
}

export function isPaletteId(value: string): value is PaletteId {
  return paletteOrder.includes(value as PaletteId);
}
