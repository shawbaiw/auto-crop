import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { resolveApiUrl } from "./api/apiUrl";
import { createApiClient } from "./api/client";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing root element.");
}

const apiUrl = resolveApiUrl({
  search: window.location.search,
  hostname: window.location.hostname,
  envApiUrl: import.meta.env.VITE_AUTO_CROP_API_URL,
  storage: window.localStorage,
});
const apiClient = createApiClient(apiUrl);

createRoot(root).render(
  <StrictMode>
    <App apiClient={apiClient} />
  </StrictMode>,
);
