import type { CompanyBlueprint } from "@auto-crop/core";
import type { Playbook, TaskTemplate } from "./types";

const taskTemplates: TaskTemplate[] = [
  {
    key: "product_brief",
    departmentName: "Product",
    title: "Write the first product brief",
    description:
      "Define the target customer, wedge, core use case, MVP scope, and first revenue path for the founder vision.",
    requiredCapabilities: ["writing", "research"],
    proofSchemaId: "product-brief",
    riskLevel: "low",
    dependsOnTaskKeys: [],
    handoffContract: "Produce a concise product brief with target customer, wedge, MVP scope, and first revenue path.",
  },
  {
    key: "market_research",
    departmentName: "Research",
    title: "Create competitor and customer pain research",
    description:
      "Research comparable products, positioning, pricing, and the customer pain that the first version should address.",
    requiredCapabilities: ["research", "writing"],
    proofSchemaId: "research-report",
    riskLevel: "low",
    dependsOnTaskKeys: [],
    handoffContract: "Produce a research report covering comparable products, positioning, pricing, and customer pain.",
  },
  {
    key: "growth_assets",
    departmentName: "Growth",
    title: "Draft early acquisition assets",
    description:
      "Create landing page copy, launch positioning, and the first distribution channel list for early users.",
    requiredCapabilities: ["writing", "growth"],
    proofSchemaId: "product-brief",
    riskLevel: "low",
    dependsOnTaskKeys: ["product_brief", "market_research"],
    handoffContract: "Produce launch copy, positioning notes, and an initial channel list for the prototype and launch plan.",
  },
  {
    key: "landing_page_prototype",
    departmentName: "Engineering",
    title: "Create the first landing page prototype",
    description:
      "Build a runnable landing page or prototype that communicates the SaaS wedge and collects first traction proof.",
    requiredCapabilities: ["code", "frontend"],
    proofSchemaId: "landing-page-file",
    riskLevel: "medium",
    dependsOnTaskKeys: ["product_brief", "market_research", "growth_assets"],
    handoffContract: "Produce runnable prototype files that implement the approved wedge, research-informed positioning, and launch copy.",
  },
  {
    key: "prototype_validation",
    departmentName: "Engineering",
    title: "Run local validation for the prototype",
    description:
      "Run local checks and capture command output, local URL, screenshot, and optional deployment URL when configured.",
    requiredCapabilities: ["code", "test"],
    proofSchemaId: "test-output",
    riskLevel: "medium",
    dependsOnTaskKeys: ["landing_page_prototype"],
    handoffContract: "Produce validation output that proves the prototype can run and be inspected locally.",
  },
];

export const aiSaasPlaybook = {
  id: "ai-saas",
  name: "AI SaaS",
  suitableFor: ["AI tools", "SaaS products", "developer tools", "software products"],
  defaultDepartments: [
    {
      name: "Product",
      responsibility: "Define target customer, wedge, MVP scope, and first revenue path.",
      defaultLeadCapability: "writing",
    },
    {
      name: "Research",
      responsibility: "Research customer pain, competitors, pricing, and positioning.",
      defaultLeadCapability: "research",
    },
    {
      name: "Growth",
      responsibility: "Create launch assets, channel lists, and early traction paths.",
      defaultLeadCapability: "growth",
    },
    {
      name: "Engineering",
      responsibility: "Build the prototype, run checks, and produce technical proof.",
      defaultLeadCapability: "code",
    },
  ],
  okrTemplates: [
    {
      objectiveTitle: "Validate the first AI SaaS wedge",
      priority: 1,
      keyResults: [
        {
          title: "Ship a proof-backed landing page prototype",
          metricName: "prototype_status",
          targetValue: "local_url_or_deployment_url",
          currentValue: "not_started",
        },
        {
          title: "Document the first revenue path",
          metricName: "revenue_path_status",
          targetValue: "documented",
          currentValue: "not_started",
        },
      ],
    },
  ],
  taskTemplates,
  proofSchemas: [
    {
      id: "product-brief",
      description: "A product or growth brief stored as a file artifact.",
      acceptedTypes: ["file"],
    },
    {
      id: "research-report",
      description: "A research report stored as a file artifact.",
      acceptedTypes: ["file"],
    },
    {
      id: "landing-page-file",
      description: "Landing page or prototype files created in the task workspace.",
      acceptedTypes: ["file"],
    },
    {
      id: "repo-diff",
      description: "A git diff or patch showing repository changes.",
      acceptedTypes: ["diff"],
    },
    {
      id: "test-output",
      description: "Command output from test, typecheck, lint, build, or local validation commands.",
      acceptedTypes: ["command_output", "test_result"],
    },
    {
      id: "local-url",
      description: "A local development URL for the runnable prototype.",
      acceptedTypes: ["url"],
    },
    {
      id: "screenshot",
      description: "A screenshot proving the prototype renders.",
      acceptedTypes: ["screenshot"],
    },
    {
      id: "deployment-url",
      description: "An optional deployed URL when a development deployment provider is configured.",
      acceptedTypes: ["deployment", "url"],
    },
  ],
  reviewCriteria: [
    "Every completed task must include proof matching its proof schema.",
    "Engineering proof must include either runnable local proof or an optional deployment URL.",
    "The next cycle should prioritize missing proof before adding new scope.",
  ],

  createBlueprint(input): CompanyBlueprint {
    return {
      company: {
        name: input.companyName,
        founderVision: input.founderVision,
        playbookId: "ai-saas",
      },
      departments: this.defaultDepartments.map((department) => ({
        name: department.name,
        responsibility: department.responsibility,
        leadAgentId:
          department.defaultLeadCapability === "code"
            ? input.preferredEngineeringAgentId
            : input.preferredStrategyAgentId,
      })),
      objectives: this.okrTemplates.map((template) => ({
        title: template.objectiveTitle,
        priority: template.priority,
        keyResults: template.keyResults,
      })),
      proofSchemas: this.proofSchemas,
      tasks: this.taskTemplates.map((template) => ({
        key: template.key,
        departmentName: template.departmentName,
        title: template.title,
        description: template.description,
        assigneeAgentId: template.departmentName === "Engineering" ? input.preferredEngineeringAgentId : input.preferredStrategyAgentId,
        requiredCapabilities: template.requiredCapabilities,
        proofSchemaId: template.proofSchemaId,
        riskLevel: template.riskLevel,
        dependsOnTaskKeys: template.dependsOnTaskKeys,
        handoffContract: template.handoffContract,
      })),
    };
  },
} satisfies Playbook;
