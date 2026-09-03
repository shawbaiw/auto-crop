import { describe, expect, it } from "vitest";
import {
  agentFailureReasonSchema,
  ceoResponseSchema,
  companyBlueprintSchema,
  localizedTextSchema,
  nextStepItemTypeSchema,
  parseCeoResponse,
  strategicDecisionKindSchema,
  taskCompletionOutcomeSchema,
  taskEventTypeSchema,
  taskSchema,
  taskStatusSchema,
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
      key: "competitor_research",
      departmentName: "Research",
      title: "Write competitor research brief",
      description: "Summarize competitor positioning and customer pain.",
      assigneeAgentId: "claude-code",
      requiredCapabilities: ["research", "writing"],
      proofSchemaId: "research-report-proof",
      riskLevel: "low",
      dependsOnTaskKeys: [],
      handoffContract: "Produce a competitor research brief for prototype positioning.",
    },
    {
      key: "landing_page_prototype",
      departmentName: "Engineering",
      title: "Create the first landing page prototype",
      description: "Build a pricing-page-focused landing page prototype.",
      assigneeAgentId: "codex",
      requiredCapabilities: ["code", "frontend"],
      proofSchemaId: "landing-page-proof",
      riskLevel: "medium",
      dependsOnTaskKeys: ["competitor_research"],
      handoffContract: "Produce runnable landing page files for downstream validation.",
    },
  ],
};

describe("localizedTextSchema", () => {
  it("accepts text with one or more locale values", () => {
    expect(localizedTextSchema.parse({ en: "Engineering", zh: "工程" })).toEqual({
      en: "Engineering",
      zh: "工程",
    });
    expect(localizedTextSchema.parse({ zh: "工程" })).toEqual({ zh: "工程" });
  });

  it("rejects empty localized text", () => {
    expect(() => localizedTextSchema.parse({})).toThrow("Localized text must include at least one locale value.");
    expect(() => localizedTextSchema.parse({ en: " " })).toThrow("Localized text must include at least one locale value.");
  });
});

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

  it("rejects duplicate task keys", () => {
    const result = companyBlueprintSchema.safeParse({
      ...validBlueprint,
      tasks: [
        validBlueprint.tasks[0],
        {
          ...validBlueprint.tasks[1],
          key: validBlueprint.tasks[0].key,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects dependency keys that do not reference earlier tasks", () => {
    const result = companyBlueprintSchema.safeParse({
      ...validBlueprint,
      tasks: [
        {
          ...validBlueprint.tasks[0],
          dependsOnTaskKeys: ["landing_page_prototype"],
        },
        validBlueprint.tasks[1],
      ],
    });

    expect(result.success).toBe(false);
  });

  it("accepts explicit dependencies on earlier task keys", () => {
    const result = companyBlueprintSchema.safeParse({
      ...validBlueprint,
      tasks: [
        validBlueprint.tasks[0],
        {
          ...validBlueprint.tasks[1],
          dependsOnTaskKeys: ["competitor_research"],
        },
      ],
    });

    expect(result.success).toBe(true);
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

describe("runtime status schemas", () => {
  it("accepts dependency wait, retrying, and replan task states", () => {
    expect(taskStatusSchema.safeParse("waiting_dependency").success).toBe(true);
    expect(taskStatusSchema.safeParse("retrying").success).toBe(true);
    expect(taskStatusSchema.safeParse("needs_replan").success).toBe(true);
  });

  it("accepts coordination failure reasons", () => {
    expect(agentFailureReasonSchema.safeParse("missing_deliverable").success).toBe(true);
    expect(agentFailureReasonSchema.safeParse("retry_exhausted").success).toBe(true);
    expect(agentFailureReasonSchema.safeParse("needs_replan").success).toBe(true);
    expect(agentFailureReasonSchema.safeParse("rate_limited").success).toBe(true);
  });

  it("accepts coordination task events", () => {
    expect(taskEventTypeSchema.safeParse("automatic_acceptance").success).toBe(true);
    expect(taskEventTypeSchema.safeParse("dependency_waiting").success).toBe(true);
    expect(taskEventTypeSchema.safeParse("dependency_ready").success).toBe(true);
    expect(taskEventTypeSchema.safeParse("task_retrying").success).toBe(true);
    expect(taskEventTypeSchema.safeParse("task_needs_replan").success).toBe(true);
    expect(taskEventTypeSchema.safeParse("deliverable_missing").success).toBe(true);
  });

  it("accepts the founder_decision next step item type", () => {
    expect(nextStepItemTypeSchema.safeParse("founder_decision").success).toBe(true);
  });

  it("accepts the awaiting_founder_decision task completion outcome", () => {
    expect(taskCompletionOutcomeSchema.safeParse("awaiting_founder_decision").success).toBe(true);
  });

  it("accepts every Strategic Decision Kind and rejects choices outside the fixed set", () => {
    for (const kind of ["target_market", "product_direction", "mvp_type", "pricing_model", "launch_target"]) {
      expect(strategicDecisionKindSchema.safeParse(kind).success).toBe(true);
    }
    expect(strategicDecisionKindSchema.safeParse("brand_name").success).toBe(false);
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
