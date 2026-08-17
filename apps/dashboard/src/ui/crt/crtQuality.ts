export const crtQualityLevels = ["full", "reduced", "static", "off"] as const;

export type CRTQuality = (typeof crtQualityLevels)[number];

export function isCRTQuality(value: string): value is CRTQuality {
  return crtQualityLevels.includes(value as CRTQuality);
}
