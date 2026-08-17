import type { ReactNode } from "react";
import { crtPresets, type CRTPreset } from "./crtPresets";
import "./crt.css";

export type CRTFrame = "screen" | "frameless";

export type CRTViewportProps = {
  children: ReactNode;
  disabled?: boolean;
  frame?: CRTFrame;
  preset?: CRTPreset;
};

export function CRTViewport({ children, disabled = false, frame = "screen", preset = "horizontalVignette" }: CRTViewportProps) {
  const disabledByQuery =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("crt") === "off";
  const classes = [
    "crt-viewport",
    `crt-viewport--frame-${frame}`,
    crtPresets[preset].className,
    disabled || disabledByQuery ? "crt-viewport--off" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="crt-screen-face">
        <div className="crt-viewport__content">{children}</div>
        <div aria-hidden="true" className="crt-static-overlay" />
        <div aria-hidden="true" className="crt-fringe-overlay" />
      </div>
    </div>
  );
}
