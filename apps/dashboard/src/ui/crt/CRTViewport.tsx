import type { ReactNode } from "react";
import { crtPresets, type CRTPreset } from "./crtPresets";

export type CRTViewportProps = {
  children: ReactNode;
  preset?: CRTPreset;
};

export function CRTViewport({ children, preset = "horizontalVignette" }: CRTViewportProps) {
  const crtDisabled =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("crt") === "off";
  const classes = ["crt-viewport", crtPresets[preset], crtDisabled ? "crt-viewport--off" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="crt-viewport__content">{children}</div>
      <div aria-hidden="true" className="crt-static-overlay" />
      <div aria-hidden="true" className="crt-fringe-overlay" />
    </div>
  );
}
