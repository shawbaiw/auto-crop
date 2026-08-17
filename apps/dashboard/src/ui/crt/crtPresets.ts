export const crtPresets = {
  horizontalVignette: "crt-viewport--horizontal-vignette",
} as const;

export type CRTPreset = keyof typeof crtPresets;
