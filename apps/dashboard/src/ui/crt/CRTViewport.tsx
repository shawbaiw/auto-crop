import type { ReactNode } from "react";

export type CRTViewportProps = {
  children: ReactNode;
};

export function CRTViewport({ children }: CRTViewportProps) {
  const crtDisabled =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("crt") === "off";

  return (
    <div className={crtDisabled ? "crt-viewport crt-viewport--off" : "crt-viewport"}>
      <div className="crt-viewport__content">{children}</div>
      <div aria-hidden="true" className="crt-static-overlay" />
      <div aria-hidden="true" className="crt-fringe-overlay" />
    </div>
  );
}
