import "../test/setup";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompanyEventSummary } from "../api/client";
import { LanguageProvider } from "../ui/language";
import { CompanyCreationLoading } from "./CompanyCreationLoading";

function renderFailed(message: string) {
  const events: CompanyEventSummary[] = [
    { type: "company_creation_accepted", companyId: "company_1", message: "Company Creation accepted.", status: "creating" },
    { type: "company_creation_failed", companyId: "company_1", message, status: "creation_failed" },
  ];
  render(
    <LanguageProvider>
      <CompanyCreationLoading
        companyName="Pricing Page Studio"
        events={events}
        isFailed
        onRetry={() => {}}
        permissionMode="balanced"
        selectedAgent={{ id: "codex", name: "Codex", capabilities: ["code"], detected: true }}
      />
    </LanguageProvider>,
  );
}

describe("CompanyCreationLoading failure summary", () => {
  it("says only that the agent ran into an error, and keeps the raw message one click away", () => {
    renderFailed("Company Creation failed: codex exited with code 1: model returned an empty response");

    expect(screen.getByText("Codex ran into an error")).toBeInTheDocument();
    expect(screen.getByText("Company Creation failed: codex exited with code 1: model returned an empty response")).toBeInTheDocument();
  });

  it("names a timeout when the raw message reports one", () => {
    renderFailed("Company Creation failed: active creation attempt timed out.");

    expect(screen.getByText("Timed out")).toBeInTheDocument();
    expect(screen.queryByText("Codex ran into an error")).not.toBeInTheDocument();
  });
});

function renderCreating(events: CompanyEventSummary[]) {
  render(
    <LanguageProvider>
      <CompanyCreationLoading
        companyName="Pricing Page Studio"
        events={events}
        permissionMode="balanced"
        selectedAgent={{ id: "codex", name: "Codex", capabilities: ["code"], detected: true }}
      />
    </LanguageProvider>,
  );
}

describe("CompanyCreationLoading real elapsed time", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("times the run from acceptance and the current step from its own start, ticking every second", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-08-17T00:01:05.000Z"));
    renderCreating([
      { type: "company_creation_accepted", companyId: "company_1", message: "Company Creation accepted.", status: "creating", createdAt: "2026-08-17T00:00:00.000Z" },
      { type: "company_creation_agent_started", companyId: "company_1", message: "CEO agent started.", status: "creating", createdAt: "2026-08-17T00:00:00.300Z" },
    ]);

    expect(screen.getByText("Running for").nextElementSibling).toHaveTextContent("1m 5s");
    expect(screen.getByText("1m 4s")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText("Running for").nextElementSibling).toHaveTextContent("1m 6s");
    expect(screen.getByText("1m 5s")).toBeInTheDocument();
  });

  it("keeps seconds under a minute and switches to minutes and seconds from one minute", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-08-17T00:00:59.000Z"));
    renderCreating([
      { type: "company_creation_accepted", companyId: "company_1", message: "Company Creation accepted.", status: "creating", createdAt: "2026-08-17T00:00:00.000Z" },
      { type: "company_creation_agent_started", companyId: "company_1", message: "CEO agent started.", status: "creating", createdAt: "2026-08-17T00:00:00.300Z" },
    ]);

    expect(screen.getByText("Running for").nextElementSibling).toHaveTextContent("59s");
    expect(screen.getByText("58.7s")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(253_000);
    });

    expect(screen.getByText("Running for").nextElementSibling).toHaveTextContent("5m 12s");
    expect(screen.getByText("5m 11s")).toBeInTheDocument();
  });

  it("shows no elapsed time at all when the events carry no timestamps, never a page-open clock", () => {
    renderCreating([
      { type: "company_creation_accepted", companyId: "company_1", message: "Company Creation accepted.", status: "creating" },
      { type: "company_creation_agent_started", companyId: "company_1", message: "CEO agent started.", status: "creating" },
    ]);

    expect(screen.queryByText("Running for")).not.toBeInTheDocument();
    expect(screen.queryByText(/^(\d+m )?\d+(\.\d)?s$/)).not.toBeInTheDocument();
  });
});
