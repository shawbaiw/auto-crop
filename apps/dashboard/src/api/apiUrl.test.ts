import { describe, expect, it } from "vitest";
import { resolveApiUrl } from "./apiUrl";

describe("resolveApiUrl", () => {
  it("stores and returns the query API URL", () => {
    const storage = createMemoryStorage();

    const apiUrl = resolveApiUrl({
      search: "?apiUrl=http%3A%2F%2F127.0.0.1%3A8787",
      hostname: "127.0.0.1",
      storage,
    });

    expect(apiUrl).toBe("http://127.0.0.1:8787");
    expect(storage.getItem("auto-crop.apiUrl")).toBe("http://127.0.0.1:8787");
  });

  it("restores the stored API URL when the refreshed URL has no query string", () => {
    const storage = createMemoryStorage({ "auto-crop.apiUrl": "http://127.0.0.1:8787" });

    expect(resolveApiUrl({ search: "", hostname: "127.0.0.1", storage })).toBe("http://127.0.0.1:8787");
  });

  it("uses the default local API URL for a bare local dashboard URL", () => {
    expect(resolveApiUrl({ search: "", hostname: "127.0.0.1" })).toBe("http://127.0.0.1:8787");
  });

  it("keeps non-local dashboards relative when no API URL is configured", () => {
    expect(resolveApiUrl({ search: "", hostname: "example.com" })).toBe("");
  });
});

function createMemoryStorage(initial: Record<string, string> = {}): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}
