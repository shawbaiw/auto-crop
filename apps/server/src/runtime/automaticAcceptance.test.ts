import { describe, expect, it } from "vitest";
import type { BusinessArtifact, RiskLevel, Task } from "@auto-crop/core";
import { evaluateAutomaticAcceptance } from "./automaticAcceptance";

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_1",
    companyId: "company_1",
    departmentId: "department_1",
    keyResultId: "key_result_1",
    position: 0,
    title: "Write the first product brief",
    description: "Produce a concise product brief for the team.",
    assigneeAgentId: "mock-worker",
    requiredCapabilities: ["research"],
    proofSchemaId: "product-brief",
    workspacePath: null,
    status: "review",
    riskLevel: "medium",
    ...overrides,
  };
}

function createArtifact(overrides: Partial<BusinessArtifact> = {}): BusinessArtifact {
  return {
    id: "business_artifact_1",
    companyId: "company_1",
    taskId: "task_1",
    sourceProofId: "proof_1",
    artifactKind: "deliverable",
    artifactRole: "spec",
    artifactSubtype: "mvp_brief",
    artifactType: "product_mvp_brief",
    taskType: "product_planning",
    payload: {
      summary: "The product brief is complete.",
      recommendation: "Proceed with the pricing-page generator wedge.",
    },
    lineage: { objective: "Validate the first wedge" },
    validationStatus: "valid",
    validationErrors: [],
    reviewStatus: "unreviewed",
    isCurrent: true,
    supersedesArtifactId: null,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("evaluateAutomaticAcceptance", () => {
  it("accepts a valid, current, unreviewed deliverable with no payload marker", () => {
    const decision = evaluateAutomaticAcceptance({
      task: createTask(),
      artifact: createArtifact({ payload: { summary: "done" } }),
    });

    expect(decision).toEqual({ kind: "accept" });
  });

  it("does not consult task riskLevel", () => {
    for (const riskLevel of ["low", "medium", "high"] satisfies RiskLevel[]) {
      const decision = evaluateAutomaticAcceptance({
        task: createTask({ riskLevel }),
        artifact: createArtifact(),
      });

      expect(decision).toEqual({ kind: "accept" });
    }
  });

  it("accepts a final_report as well as a deliverable", () => {
    const decision = evaluateAutomaticAcceptance({
      task: createTask(),
      artifact: createArtifact({ artifactKind: "final_report" }),
    });

    expect(decision).toEqual({ kind: "accept" });
  });

  it("requires review when the artifact is missing or not reviewable", () => {
    expect(evaluateAutomaticAcceptance({ task: createTask(), artifact: null })).toEqual({
      kind: "requires_review",
      reason: "artifact_not_reviewable",
    });

    for (const overrides of [
      { isCurrent: false },
      { validationStatus: "invalid_schema" as const },
      { reviewStatus: "accepted" as const },
      { artifactKind: "blocker" as const },
    ]) {
      expect(
        evaluateAutomaticAcceptance({ task: createTask(), artifact: createArtifact(overrides) }).kind,
      ).toBe("requires_review");
    }
  });

  describe("tightened risk-pattern scan", () => {
    const sensitivePhrases: Array<[string, string]> = [
      ["public launch", "This deliverable prepares the public launch of the marketing site."],
      ["launch publicly", "Once approved we will launch the app publicly to all visitors."],
      ["go live", "The plan is to go live this Friday."],
      ["deploy to production", "Deploy the service to production once the brief is signed off."],
      ["production environment", "Provision the production environment for the API."],
      ["custom domain", "Point the custom domain at the new host."],
      ["register a domain", "We should register the domain autocrop.example this week."],
      ["search console", "Verify the property in Google Search Console."],
      ["submit the sitemap", "Then submit the sitemap to Google for indexing."],
      ["ads account", "Connect the Google Ads account before the campaign."],
      ["connect an advertising account", "We need to connect an advertising account to run traffic."],
      ["affiliate program", "Join the affiliate program and add the tracking links."],
      ["set up billing", "Set up billing with the cloud provider for the new project."],
      ["set up a paid subscription", "We must set up a paid subscription to the email service."],
      ["enter payment details", "The founder must enter the credit card details in the console."],
      ["make a payment", "The runtime would need to make a payment to the vendor."],
      ["purchase a subscription", "Purchase a subscription to the analytics tool."],
      ["spend a dollar amount", "This step will spend $200 on ads."],
      ["charge the card", "The integration would charge the card on file automatically."],
      ["legal review", "The terms need a legal review before publishing."],
      ["compliance exposure", "This introduces compliance exposure we have not assessed."],
      ["privacy policy", "Draft and post the privacy policy."],
      ["GDPR", "Assess GDPR obligations for EU visitors."],
      ["collect user data", "The form will collect user data including email and name."],
      ["PII", "The export contains PII for every signup."],
      ["api key", "Store the production api key for the payment provider."],
      ["credentials", "The agent needs credentials for the hosting dashboard."],
      ["password", "Reset the admin password for the shared account."],
      ["oauth", "Complete the OAuth consent flow for the integration."],
      ["grant access", "Grant write access to the deployment service account."],
      ["admin access", "This requires admin access to the DNS provider."],
      ["irreversible", "This is an irreversible external action."],
      ["cannot be undone", "Deleting the bucket cannot be undone."],
      ["permanently delete", "We will permanently delete the staging data."],
      ["email all users", "Send an announcement email to all users on the list."],
    ];

    it.each(sensitivePhrases)("routes %s to manual review", (_label, description) => {
      const decision = evaluateAutomaticAcceptance({
        task: createTask({ description }),
        artifact: createArtifact(),
      });

      expect(decision).toEqual({ kind: "requires_review", reason: "external_or_sensitive_risk" });
    });

    it("also scans the artifact payload, not just the task", () => {
      const decision = evaluateAutomaticAcceptance({
        task: createTask({ description: "Ordinary internal work." }),
        artifact: createArtifact({
          payload: { summary: "Ready to deploy to production once accepted." },
        }),
      });

      expect(decision).toEqual({ kind: "requires_review", reason: "external_or_sensitive_risk" });
    });
  });

  describe("regression fixtures — ordinary business language is accepted", () => {
    const ordinaryProductBrief = [
      "Target market: solo SaaS founders who need a credible pricing page fast.",
      "Product direction: a focused one-page pricing copy generator, not a full site builder.",
      "MVP type: a single-page web app with a form and a live preview.",
      "Pricing model: freemium; the paid plan charges customers $29 per month for exports.",
      "Customers subscribe to the paid plan when they need more than three pages.",
      "Positioning: the fastest route from idea to a pricing page that converts.",
      "Go-to-market: share in founder communities and open an early-access list.",
      "We expect to draft launch copy and a short landing page next, and to spend the next three weeks building.",
      "Success metric: 100 generated pages in the first month.",
      "Risks: crowded category and low willingness to pay for copy alone.",
      "Legal and compliance: none identified for an informational tool.",
      "Recommendation: build the generator wedge first and revisit distribution after.",
    ].join(" ");

    const ordinaryResearchReport = [
      "Research report: keyword opportunity analysis for the pricing-page niche.",
      "We evaluated 40 keywords; 'pricing page generator' has moderate volume and low competition.",
      "Competitors: three established tools, none targeting solo founders specifically.",
      "One competitor shipped their public release two years ago and has iterated since.",
      "Customer pain: pricing pages take too long and read as generic.",
      "Personas: early-stage SaaS founders and indie hackers shipping their first product.",
      "Distribution channels considered: SEO, founder communities, and newsletter sponsorships.",
      "We are comfortable making the findings public in a blog post later.",
      "Positioning options range from 'fastest' to 'most conversion-optimized'.",
      "The recommendation is to target 'pricing page generator' as the first wedge.",
      "Secondary keywords and the full ranking are in the appendix.",
    ].join(" ");

    it("accepts an ordinary product brief", () => {
      const decision = evaluateAutomaticAcceptance({
        task: createTask({
          title: "Write the first product brief",
          description: "Produce a concise product brief with target customer, wedge, MVP scope, and first revenue path.",
        }),
        artifact: createArtifact({
          artifactSubtype: "mvp_brief",
          payload: { summary: ordinaryProductBrief, recommendation: "Build the generator wedge first." },
        }),
      });

      expect(decision).toEqual({ kind: "accept" });
    });

    it("accepts an ordinary research report", () => {
      const decision = evaluateAutomaticAcceptance({
        task: createTask({
          title: "Find the first SEO keyword opportunity",
          description: "Research English-language keyword opportunities and recommend a first wedge.",
        }),
        artifact: createArtifact({
          artifactKind: "final_report",
          artifactRole: "findings",
          artifactSubtype: "keyword_research",
          artifactType: "research_findings",
          taskType: "keyword_opportunity_research",
          payload: { summary: ordinaryResearchReport, recommendation: "Target 'pricing page generator'." },
        }),
      });

      expect(decision).toEqual({ kind: "accept" });
    });
  });
});
