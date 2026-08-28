const apiUrlStorageKey = "auto-crop.apiUrl";

export type ResolveApiUrlInput = {
  search: string;
  hostname: string;
  envApiUrl?: string;
  storage?: Pick<Storage, "getItem" | "setItem">;
};

export function resolveApiUrl(input: ResolveApiUrlInput): string {
  const queryApiUrl = new URLSearchParams(input.search).get("apiUrl");

  if (queryApiUrl) {
    input.storage?.setItem(apiUrlStorageKey, queryApiUrl);
    return queryApiUrl;
  }

  if (input.envApiUrl) {
    return input.envApiUrl;
  }

  const storedApiUrl = input.storage?.getItem(apiUrlStorageKey);
  if (storedApiUrl) {
    return storedApiUrl;
  }

  return isLocalhost(input.hostname) ? "http://127.0.0.1:8787" : "";
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
