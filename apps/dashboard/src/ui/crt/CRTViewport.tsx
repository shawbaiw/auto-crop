import type { ReactNode } from "react";
import { crtPresets, type CRTPreset } from "./crtPresets";
import { isCRTQuality, type CRTQuality } from "./crtQuality";
import "./crt.css";

export type CRTFrame = "screen" | "frameless";

export type CRTViewportProps = {
  children: ReactNode;
  disabled?: boolean;
  frame?: CRTFrame;
  preset?: CRTPreset;
  quality?: CRTQuality;
};

export function CRTViewport({
  children,
  disabled = false,
  frame = "screen",
  preset = "horizontalVignette",
  quality = "full",
}: CRTViewportProps) {
  const requestedQuality = getQualityFromQuery();
  const resolvedQuality = disabled ? "off" : (requestedQuality ?? quality);
  const classes = [
    "crt-viewport",
    `crt-viewport--frame-${frame}`,
    `crt-viewport--quality-${resolvedQuality}`,
    crtPresets[preset].className,
    resolvedQuality === "off" ? "crt-viewport--off" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <svg aria-hidden="true" className="crt-filter-defs" focusable="false">
        <filter id="crt-soft-barrel-filter" x="-3%" y="-3%" width="106%" height="106%">
          <feTurbulence baseFrequency="0.004 0.012" numOctaves="1" seed="7" type="fractalNoise" result="crtNoise" />
          <feDisplacementMap in="SourceGraphic" in2="crtNoise" scale="1.15" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <div className="crt-screen-face">
        <div className="crt-geometry-shell">
          <div className="crt-viewport__content">{children}</div>
          <div aria-hidden="true" className="crt-static-overlay" />
          <div aria-hidden="true" className="crt-fringe-overlay" />
        </div>
      </div>
    </div>
  );
}

function getQualityFromQuery(): CRTQuality | null {
  if (typeof window === "undefined") {
    return null;
  }

  const requestedQuality = new URLSearchParams(window.location.search).get("crt");
  if (!requestedQuality) {
    return null;
  }

  return isCRTQuality(requestedQuality) ? requestedQuality : null;
}
