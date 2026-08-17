import { RetroSelect } from "../retro";
import { paletteOrder, palettes } from "./palettes";
import { isPaletteId, useTheme } from "./ThemeProvider";

export function SkinSwitcher() {
  const { skin, setSkin } = useTheme();

  return (
    <div className="skin-switcher">
      <span>Skin</span>
      <RetroSelect
        className="skin-switcher__select"
        id="skin-switcher"
        label="Skin"
        onValueChange={(nextSkin) => {
          if (isPaletteId(nextSkin)) {
            setSkin(nextSkin);
          }
        }}
        options={paletteOrder.map((paletteId) => ({ label: palettes[paletteId].label, value: paletteId }))}
        value={skin}
      />
    </div>
  );
}
