import { describe, expect, it } from "vitest";
import {
  ceoResponseSchema,
  companyBlueprintSchema,
  parseCeoResponse,
  taskSchema,
} from "./schemas";

const validBlueprint = {
  company: {
    name: "Pricing Page Studio",
    founderVision:
      "Build an AI SaaS that helps independent developers generate better pricing pages.",
    playbookId: "ai-saas",
  },
  departments: [
    {
      name: "Product",
      responsibility: "Define the ICP, value proposition, and MVP scope.",
      leadAgentId: "claude-code",
    },
    {
      name: "Research",
      responsibility: "Research competitors, customer pain, and market positioning.",
      leadAgentId: "claude-code",
    },
    {
      name: "Growth",
      responsibility: "Create early acquisition assets and launch copy.",
      leadAgentId: "claude-code",
    },
    {
      name: "Engineering",
      responsibility: "Build the landing page, prototype, tests, and deployment proof.",
      leadAgentId: "codex",
    },
  ],
  objectives: [
    {
      title: "Validate the first AI SaaS wedge",
      priority: 1,
      keyResults: [
        {
          title: "Ship a proof-backed landing page prototype",
          metricName: "prototype_status",
          targetValue: "local_url_or_deployment_url",
          currentValue: "not_started",
        },
      ],
    },
  ],
  proofSchemas: [
    {
      id: "landing-page-proof",
      description: "Landing page work must include a file artifact and runnable URL.",
      acceptedTypes: ["file", "url", "screenshot"],
    },
    {
      id: "research-report-proof",
      description: "Research work must include a report artifact.",
      acceptedTypes: ["file"],
    },
  ],
  tasks: [
    {
      departmentName: "Engineering",
      title: "Create the first landing page prototype",
      description: "Build a pricing-page-focused landing page prototype.",
      assigneeAgentId: "codex",
      requiredCapabilities: ["code", "frontend"],
      proofSchemaId: "landing-page-proof",
      riskLevel: "medium",
    },
    {
      departmentName: "Research",
      title: "Write competitor research brief",
      description: "Summarize competitor positioning and customer pain.",
      assigneeAgentId: "claude-code",
      requiredCapabilities: ["research", "writing"],
      proofSchemaId: "research-report-proof",
      riskLevel: "low",
    },
  ],
};

describe("companyBlueprintSchema", () => {
  it("accepts a valid AI SaaS company blueprint", () => {
    const result = companyBlueprintSchema.safeParse(validBlueprint);

    expect(result.success).toBe(true);
  });

  it("rejects blueprints without departments", () => {
    const result = companyBlueprintSchema.safeParse({
      ...validBlueprint,
      departments: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects tasks that reference a missing proof schema", () => {
    const result = companyBlueprintSchema.safeParse({
      ...validBlueprint,
      tasks: [
        {
          ...validBlueprint.tasks[0],
          proofSchemaId: "missing-proof-schema",
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe("taskSchema", () => {
  it("rejects tasks without a proof schema id", () => {
    const result = taskSchema.safeParse({
      ...validBlueprint.tasks[0],
      proofSchemaId: "",
    });

    expect(result.success).toBe(false);
  });
});

describe("ceoResponseSchema", () => {
  it("requires a human brief and a strict JSON blueprint", () => {
    const result = ceoResponseSchema.safeParse({
      brief: "The CEO will validate a narrow pricing page wedge.",
      blueprint: validBlueprint,
    });

    expect(result.success).toBe(true);
  });

  it("rejects CEO output without strict JSON", () => {
    expect(() =>
      parseCeoResponse("The CEO thinks this is a good idea, but provides no JSON."),
    ).toThrow(/strict JSON/i);
  });

  it("parses CEO output when strict JSON is fenced", () => {
    const parsed = parseCeoResponse(
      [
        "The company should validate a narrow SaaS wedge first.",
        "",
        "```json",
        JSON.stringify({ brief: "Validate the wedge.", blueprint: validBlueprint }),
        "```",
      ].join("\n"),
    );

    expect(parsed.blueprint.company.name).toBe("Pricing Page Studio");
  });
});
