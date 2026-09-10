import { describe, expect, it } from "vitest";
import {
  agentFailureReasonSchema,
  ceoAttentionRollupReasonSchema,
  ceoResponseSchema,
  companyBlueprintSchema,
  finalFounderReportClassificationSchema,
  finalFounderReportPayloadSchema,
  finalFounderReportSchema,
  localizedTextSchema,
  nextStepItemTypeSchema,
  parseCeoResponse,
  parseExecutionReportInput,
  parseFinalFounderReportOutput,
  strategicDecisionKindSchema,
  taskAcceptanceProvenanceSchema,
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

describe("parseExecutionReportInput", () => {
  const bareStrings = {
    conclusion: "结论。",
    vision_impact: "愿景影响。",
    remaining_gap: "剩余缺口。",
    recommendation: "建议。",
  };

  it("normalizes a bare string field under the given company locale", () => {
    expect(parseExecutionReportInput(bareStrings, "zh")).toEqual({
      conclusion: { zh: "结论。" },
      visionImpact: { zh: "愿景影响。" },
      remainingGap: { zh: "剩余缺口。" },
      recommendation: { zh: "建议。" },
    });
    expect(parseExecutionReportInput(bareStrings, "en")).toEqual({
      conclusion: { en: "结论。" },
      visionImpact: { en: "愿景影响。" },
      remainingGap: { en: "剩余缺口。" },
      recommendation: { en: "建议。" },
    });
  });

  it("accepts an already-localized { en, zh } object unchanged", () => {
    const localized = {
      conclusion: { en: "Conclusion.", zh: "结论。" },
      vision_impact: { en: "Impact." },
      remaining_gap: { zh: "缺口。" },
      recommendation: { en: "Recommendation.", zh: "建议。" },
    };
    expect(parseExecutionReportInput(localized, "zh")).toEqual({
      conclusion: { en: "Conclusion.", zh: "结论。" },
      visionImpact: { en: "Impact." },
      remainingGap: { zh: "缺口。" },
      recommendation: { en: "Recommendation.", zh: "建议。" },
    });
  });

  it("returns null when a field is missing entirely", () => {
    expect(parseExecutionReportInput({ conclusion: "只有结论。" }, "zh")).toBeNull();
    expect(parseExecutionReportInput(null, "zh")).toBeNull();
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
    expect(taskEventTypeSchema.safeParse("ceo_review_decision").success).toBe(true);
    expect(taskEventTypeSchema.safeParse("founder_decision").success).toBe(true);
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

  it("accepts every task acceptance provenance, including founder_decision", () => {
    for (const provenance of ["manual_ceo_review", "automatic_acceptance", "founder_decision"]) {
      expect(taskAcceptanceProvenanceSchema.safeParse(provenance).success).toBe(true);
    }
    expect(taskAcceptanceProvenanceSchema.safeParse("ceo_review").success).toBe(false);
  });

  it("accepts goal_stage_change as a CeoAttentionRollupReason and rejects an unknown reason", () => {
    for (const reason of [
      "vision_gap",
      "ceo_decision",
      "human_action",
      "wait_state",
      "cross_department_impact",
      "exception_outcome",
      "founder_decision",
      "goal_stage_change",
    ]) {
      expect(ceoAttentionRollupReasonSchema.safeParse(reason).success).toBe(true);
    }
    expect(ceoAttentionRollupReasonSchema.safeParse("objective_complete").success).toBe(false);
  });

  it("accepts every Strategic Decision Kind and rejects choices outside the fixed set", () => {
    for (const kind of ["target_market", "product_direction", "mvp_type", "pricing_model", "launch_target"]) {
      expect(strategicDecisionKindSchema.safeParse(kind).success).toBe(true);
    }
    expect(strategicDecisionKindSchema.safeParse("brand_name").success).toBe(false);
  });
});

describe("Final Founder Report schema", () => {
  const validSections = {
    vision: { en: "Restated vision", zh: "复述愿景" },
    actualResult: { en: "What was produced", zh: "实际产出" },
    departmentContributions: [{ en: "Engineering shipped the prototype", zh: "工程部交付原型" }],
    goalFit: { en: "Partial fit against the key results", zh: "与关键结果部分契合" },
    remainingGaps: { en: "User validation still open", zh: "用户验证仍待完成" },
    recommendedNextStep: { en: "Run a five-user test", zh: "进行五人测试" },
  };

  it("parses each classification value and rejects an unknown one", () => {
    for (const classification of ["achieved", "stalled", "waiting"]) {
      expect(finalFounderReportClassificationSchema.safeParse(classification).success).toBe(true);
    }
    expect(finalFounderReportClassificationSchema.safeParse("waiting_on_you").success).toBe(false);
  });

  it("parses a well-formed report payload with classification, six sections, and generatedBy", () => {
    const result = finalFounderReportPayloadSchema.safeParse({
      classification: "waiting",
      generatedBy: "ceo_agent",
      sections: validSections,
    });

    expect(result.success).toBe(true);
  });

  it("rejects a payload missing a required section", () => {
    const { remainingGaps: _omitted, ...withoutRemainingGaps } = validSections;
    const result = finalFounderReportPayloadSchema.safeParse({
      classification: "achieved",
      generatedBy: "deterministic_fallback",
      sections: withoutRemainingGaps,
    });

    expect(result.success).toBe(false);
  });

  it("parses a full persisted record and rejects one missing a section", () => {
    const record = {
      id: "founder_report_1",
      companyId: "company_1",
      classification: "stalled" as const,
      sections: validSections,
      generatedBy: "ceo_agent" as const,
      isCurrent: true,
      supersedesReportId: null,
      createdAt: "2026-09-04T00:00:00.000Z",
      updatedAt: "2026-09-04T00:00:00.000Z",
    };
    expect(finalFounderReportSchema.safeParse(record).success).toBe(true);

    const { goalFit: _dropped, ...withoutGoalFit } = validSections;
    expect(finalFounderReportSchema.safeParse({ ...record, sections: withoutGoalFit }).success).toBe(false);
  });

  it("parses a fenced JSON report authored by the CEO Agent", () => {
    const parsed = parseFinalFounderReportOutput(
      ["The company is done.", "", "```json", JSON.stringify({ classification: "achieved", sections: validSections }), "```"].join("\n"),
      "en",
    );

    expect(parsed.classification).toBe("achieved");
    expect(parsed.sections.departmentContributions).toHaveLength(1);
  });

  it("stores bare-string sections under the company canonical locale", () => {
    const bareSections = {
      vision: "复述创始人愿景。",
      actualResult: "交付了有证据支撑的原型。",
      departmentContributions: ["工程部构建并验证了原型。"],
      goalFit: "与关键结果部分契合。",
      remainingGaps: "用户验证仍待完成。",
      recommendedNextStep: "进行五人测试。",
    };
    const parsed = parseFinalFounderReportOutput(
      ["```json", JSON.stringify({ classification: "waiting", sections: bareSections }), "```"].join("\n"),
      "zh",
    );

    expect(parsed.sections.vision).toEqual({ zh: "复述创始人愿景。" });
    expect(parsed.sections.departmentContributions).toEqual([{ zh: "工程部构建并验证了原型。" }]);
    expect(parsed.sections.recommendedNextStep).toEqual({ zh: "进行五人测试。" });
  });

  it("accepts an already-localized { en, zh } sections object unchanged", () => {
    const parsed = parseFinalFounderReportOutput(
      ["```json", JSON.stringify({ classification: "achieved", sections: validSections }), "```"].join("\n"),
      "zh",
    );

    expect(parsed.sections.vision).toEqual({ en: "Restated vision", zh: "复述愿景" });
  });

  it("throws when the CEO Agent output has no fenced JSON block", () => {
    expect(() => parseFinalFounderReportOutput("No JSON here.", "en")).toThrow(/strict JSON/i);
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
