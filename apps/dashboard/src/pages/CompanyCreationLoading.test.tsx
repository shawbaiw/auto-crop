import "../test/setup";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
