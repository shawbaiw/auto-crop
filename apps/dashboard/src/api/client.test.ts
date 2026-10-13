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

  it("registers a company_report_ready listener and forwards the event to the handler", () => {
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

    expect(listeners.has("company_report_ready")).toBe(true);

    listeners.get("company_report_ready")?.(
      new MessageEvent("company_report_ready", {
        data: JSON.stringify({
          type: "company_report_ready",
          companyId: "company_1",
          message: "Final Founder Report ready.",
        }),
      }),
    );

    expect(handler).toHaveBeenCalledWith({
      type: "company_report_ready",
      companyId: "company_1",
      message: "Final Founder Report ready.",
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

  it("rejects a response without the fields its caller reads, instead of handing it on", async () => {
    // Another JSON service answering on the API port, or a server of another version.
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ companies: [] })));
    const client = createApiClient("", { requestTimeoutMs: 25 });

    await expect(client.getTaskExecution("task_1")).rejects.toThrow('Unexpected response from /api/tasks/task_1/execution: missing "task".');
    await expect(client.getCompanyState("company_1")).rejects.toThrow('Unexpected response from /api/companies/company_1/state: missing "company".');
    await expect(client.stopCompany("company_1")).rejects.toThrow('missing "company"');
  });

  it("passes a well-formed response through, fields it does not check included", async () => {
    const body = { task: { id: "task_1", status: "running", addedByANewerServer: true } };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
    const client = createApiClient("", { requestTimeoutMs: 25 });

    await expect(client.getTaskExecution("task_1")).resolves.toEqual(body);
  });
});
