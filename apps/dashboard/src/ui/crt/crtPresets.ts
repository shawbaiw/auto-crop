export const crtPresets = {
  horizontalVignette: {
    className: "crt-viewport--horizontal-vignette",
    label: "Horizontal scanlines with CRT vignette",
  },
} as const;

export type CRTPreset = keyof typeof crtPresets;
