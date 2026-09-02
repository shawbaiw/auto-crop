import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";

describe("createApiClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("subscribes to company creation events", () => {
    const listeners = new Map<string, (event: MessageEvent) => void>();
    class FakeEventSource {
      url: string;

      constructor(url: string) {
        this.url = url;
      }

      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        listeners.set(type, listener);
      }

      close() {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);

    const handler = vi.fn();
    const client = createApiClient("http://127.0.0.1:8787");
    client.subscribeEvents("company_1", handler);

    listeners.get("company_creation_failed")?.(
      new MessageEvent("company_creation_failed", {
        data: JSON.stringify({
          type: "company_creation_failed",
          companyId: "company_1",
          message: "Company Creation failed: temporary model failure",
          status: "creation_failed",
        }),
      }),
    );

    expect(handler).toHaveBeenCalledWith({
      type: "company_creation_failed",
      companyId: "company_1",
      message: "Company Creation failed: temporary model failure",
      status: "creation_failed",
    });
  });

  it("times out company loading requests instead of leaving the picker loading forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
      ),
    );

    const client = createApiClient("http://127.0.0.1:8787", { requestTimeoutMs: 25 });
    const request = client.listCompanies();
    const expectation = expect(request).rejects.toThrow("Request timed out after 25ms: http://127.0.0.1:8787/api/companies");
    await vi.advanceTimersByTimeAsync(25);

    await expectation;
  });

  it("reports non-JSON company responses with the requested URL and content type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } })),
    );

    const client = createApiClient("", { requestTimeoutMs: 25 });

    await expect(client.listCompanies()).rejects.toThrow("Expected JSON from /api/companies but received text/html");
  });
});
