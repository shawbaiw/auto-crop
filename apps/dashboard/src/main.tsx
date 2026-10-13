import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import App from "./App";
import { createApiClient } from "./api/client";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing root element.");
}

const apiUrl = import.meta.env.VITE_AUTO_CROP_API_URL ?? "";
const apiClient = createApiClient(apiUrl);

// Dev-only design gallery (docs/design/ice-mist-ui-spec.md stage 1); dropped from production builds.
const IceMistDevPage =
  import.meta.env.DEV && window.location.pathname === "/dev/ice-mist"
    ? lazy(() => import("./pages/dev/IceMistDevPage").then((module) => ({ default: module.IceMistDevPage })))
    : null;

createRoot(root).render(
  <StrictMode>
    {IceMistDevPage ? (
      <Suspense fallback={null}>
        <IceMistDevPage />
      </Suspense>
    ) : (
      <App apiClient={apiClient} />
    )}
  </StrictMode>,
);
