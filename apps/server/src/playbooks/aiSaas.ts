import type { CompanyBlueprint, CompleteLocalizedText } from "@auto-crop/core";
import type { Playbook, TaskTemplate } from "./types";

function text(en: string, zh: string): CompleteLocalizedText {
  return { en, zh };
}

const taskTemplates: TaskTemplate[] = [
  {
    key: "product_brief",
    departmentKey: "product",
    departmentName: "Product",
    title: "Write the first product brief",
    titleText: text("Write the first product brief", "撰写第一份产品简报"),
    description:
      "Define the target customer, wedge, core use case, MVP scope, and first revenue path for the founder vision.",
    descriptionText: text(
      "Define the target customer, wedge, core use case, MVP scope, and first revenue path for the founder vision.",
      "围绕创始人愿景定义目标客户、切入点、核心用例、MVP 范围和第一条收入路径。",
    ),
    requiredCapabilities: ["writing", "research"],
    proofSchemaId: "product-brief",
    riskLevel: "low",
    dependsOnTaskKeys: [],
    handoffContract: "Produce a concise product brief with target customer, wedge, MVP scope, and first revenue path.",
    handoffContractText: text(
      "Produce a concise product brief with target customer, wedge, MVP scope, and first revenue path.",
      "产出一份简洁的产品简报，包含目标客户、切入点、MVP 范围和第一条收入路径。",
    ),
  },
  {
    key: "market_research",
    departmentKey: "research",
    departmentName: "Research",
    title: "Create competitor and customer pain research",
    titleText: text("Create competitor and customer pain research", "完成竞品与客户痛点研究"),
    description:
      "Research comparable products, positioning, pricing, and the customer pain that the first version should address.",
    descriptionText: text(
      "Research comparable products, positioning, pricing, and the customer pain that the first version should address.",
      "研究可比产品、定位、定价，以及第一个版本需要解决的客户痛点。",
    ),
    requiredCapabilities: ["research", "writing"],
    proofSchemaId: "research-report",
    riskLevel: "low",
    dependsOnTaskKeys: [],
    handoffContract: "Produce a research report covering comparable products, positioning, pricing, and customer pain.",
    handoffContractText: text(
      "Produce a research report covering comparable products, positioning, pricing, and customer pain.",
      "产出一份研究报告，覆盖可比产品、定位、定价和客户痛点。",
    ),
  },
  {
    key: "growth_assets",
    departmentKey: "growth",
    departmentName: "Growth",
    title: "Draft early acquisition assets",
    titleText: text("Draft early acquisition assets", "起草早期获客素材"),
    description:
      "Create landing page copy, launch positioning, and the first distribution channel list for early users.",
    descriptionText: text(
      "Create landing page copy, launch positioning, and the first distribution channel list for early users.",
      "为早期用户创建落地页文案、发布定位和第一批分发渠道清单。",
    ),
    requiredCapabilities: ["writing", "growth"],
    proofSchemaId: "product-brief",
    riskLevel: "low",
    dependsOnTaskKeys: ["product_brief", "market_research"],
    handoffContract: "Produce launch copy, positioning notes, and an initial channel list for the prototype and launch plan.",
    handoffContractText: text(
      "Produce launch copy, positioning notes, and an initial channel list for the prototype and launch plan.",
      "产出发布文案、定位说明，以及用于原型和发布计划的初始渠道清单。",
    ),
  },
  {
    key: "landing_page_prototype",
    departmentKey: "engineering",
    departmentName: "Engineering",
    title: "Create the first landing page prototype",
    titleText: text("Create the first landing page prototype", "创建第一个落地页原型"),
    description:
      "Build a runnable landing page or prototype that communicates the SaaS wedge and collects first traction proof.",
    descriptionText: text(
      "Build a runnable landing page or prototype that communicates the SaaS wedge and collects first traction proof.",
      "构建一个可运行的落地页或原型，用来表达 SaaS 切入点并收集第一批 traction 证明。",
    ),
    requiredCapabilities: ["code", "frontend"],
    proofSchemaId: "landing-page-file",
    riskLevel: "medium",
    dependsOnTaskKeys: ["product_brief", "market_research", "growth_assets"],
    handoffContract: "Produce runnable prototype files that implement the approved wedge, research-informed positioning, and launch copy.",
    handoffContractText: text(
      "Produce runnable prototype files that implement the approved wedge, research-informed positioning, and launch copy.",
      "产出可运行的原型文件，落实已批准的切入点、基于研究的定位和发布文案。",
    ),
  },
  {
    key: "prototype_validation",
    departmentKey: "engineering",
    departmentName: "Engineering",
    title: "Run local validation for the prototype",
    titleText: text("Run local validation for the prototype", "对原型进行本地验证"),
    description:
      "Run local checks and capture command output, local URL, screenshot, and optional deployment URL when configured.",
    descriptionText: text(
      "Run local checks and capture command output, local URL, screenshot, and optional deployment URL when configured.",
      "运行本地检查，并记录命令输出、本地 URL、截图，以及配置后可选的部署 URL。",
    ),
    requiredCapabilities: ["code", "test"],
    proofSchemaId: "test-output",
    riskLevel: "medium",
    dependsOnTaskKeys: ["landing_page_prototype"],
    handoffContract: "Produce validation output that proves the prototype can run and be inspected locally.",
    handoffContractText: text(
      "Produce validation output that proves the prototype can run and be inspected locally.",
      "产出验证结果，证明原型可以在本地运行并被检查。",
    ),
  },
];

export const aiSaasPlaybook = {
  id: "ai-saas",
  name: "AI SaaS",
  suitableFor: ["AI tools", "SaaS products", "developer tools", "software products"],
  defaultDepartments: [
    {
      key: "product",
      name: "Product",
      nameText: text("Product", "产品"),
      responsibility: "Define target customer, wedge, MVP scope, and first revenue path.",
      responsibilityText: text(
        "Define target customer, wedge, MVP scope, and first revenue path.",
        "定义目标客户、切入点、MVP 范围和第一条收入路径。",
      ),
      defaultLeadCapability: "writing",
    },
    {
      key: "research",
      name: "Research",
      nameText: text("Research", "研究"),
      responsibility: "Research customer pain, competitors, pricing, and positioning.",
      responsibilityText: text(
        "Research customer pain, competitors, pricing, and positioning.",
        "研究客户痛点、竞品、定价和定位。",
      ),
      defaultLeadCapability: "research",
    },
    {
      key: "growth",
      name: "Growth",
      nameText: text("Growth", "增长"),
      responsibility: "Create launch assets, channel lists, and early traction paths.",
      responsibilityText: text(
        "Create launch assets, channel lists, and early traction paths.",
        "创建发布素材、渠道清单和早期 traction 路径。",
      ),
      defaultLeadCapability: "growth",
    },
    {
      key: "engineering",
      name: "Engineering",
      nameText: text("Engineering", "工程"),
      responsibility: "Build the prototype, run checks, and produce technical proof.",
      responsibilityText: text(
        "Build the prototype, run checks, and produce technical proof.",
        "构建原型、运行检查并产出技术证明。",
      ),
      defaultLeadCapability: "code",
    },
  ],
  okrTemplates: [
    {
      objectiveTitle: "Validate the first AI SaaS wedge",
      objectiveTitleText: text("Validate the first AI SaaS wedge", "验证第一个 AI SaaS 切入点"),
      priority: 1,
      keyResults: [
        {
          title: "Ship a proof-backed landing page prototype",
          titleText: text("Ship a proof-backed landing page prototype", "交付带证明的落地页原型"),
          metricName: "prototype_status",
          targetValue: "local_url_or_deployment_url",
          targetValueText: text("local_url_or_deployment_url", "本地 URL 或部署 URL"),
          currentValue: "not_started",
          currentValueText: text("not_started", "未开始"),
        },
        {
          title: "Document the first revenue path",
          titleText: text("Document the first revenue path", "记录第一条收入路径"),
          metricName: "revenue_path_status",
          targetValue: "documented",
          targetValueText: text("documented", "已记录"),
          currentValue: "not_started",
          currentValueText: text("not_started", "未开始"),
        },
      ],
    },
  ],
  taskTemplates,
  proofSchemas: [
    {
      id: "product-brief",
      description: "A product or growth brief stored as a file artifact.",
      descriptionText: text("A product or growth brief stored as a file artifact.", "以文件产物形式保存的产品或增长简报。"),
      acceptedTypes: ["file"],
    },
    {
      id: "research-report",
      description: "A research report stored as a file artifact.",
      descriptionText: text("A research report stored as a file artifact.", "以文件产物形式保存的研究报告。"),
      acceptedTypes: ["file"],
    },
    {
      id: "landing-page-file",
      description: "Landing page or prototype files created in the task workspace.",
      descriptionText: text(
        "Landing page or prototype files created in the task workspace.",
        "在任务工作区中创建的落地页或原型文件。",
      ),
      acceptedTypes: ["file"],
    },
    {
      id: "repo-diff",
      description: "A git diff or patch showing repository changes.",
      descriptionText: text("A git diff or patch showing repository changes.", "展示仓库变更的 git diff 或 patch。"),
      acceptedTypes: ["diff"],
    },
    {
      id: "test-output",
      description: "Command output from test, typecheck, lint, build, or local validation commands.",
      descriptionText: text(
        "Command output from test, typecheck, lint, build, or local validation commands.",
        "测试、类型检查、lint、构建或本地验证命令的输出。",
      ),
      acceptedTypes: ["command_output", "test_result"],
    },
    {
      id: "local-url",
      description: "A local development URL for the runnable prototype.",
      descriptionText: text("A local development URL for the runnable prototype.", "可运行原型的本地开发 URL。"),
      acceptedTypes: ["url"],
    },
    {
      id: "deployment-url",
      description: "An optional deployed URL when a development deployment provider is configured.",
      descriptionText: text(
        "An optional deployed URL when a development deployment provider is configured.",
        "配置开发部署服务后可选的部署 URL。",
      ),
      acceptedTypes: ["deployment", "url"],
    },
  ],
  reviewCriteria: [
    "Every completed task must include proof matching its proof schema.",
    "Engineering proof must include either runnable local proof or an optional deployment URL.",
    "The next cycle should prioritize missing proof before adding new scope.",
  ],
  reviewCriteriaText: [
    text(
      "Every completed task must include proof matching its proof schema.",
      "每个已完成任务都必须包含与其 proof schema 匹配的证明。",
    ),
    text(
      "Engineering proof must include either runnable local proof or an optional deployment URL.",
      "工程证明必须包含可运行的本地证明，或可选的部署 URL。",
    ),
    text(
      "The next cycle should prioritize missing proof before adding new scope.",
      "下一轮应先补齐缺失证明，再增加新范围。",
    ),
  ],

  createBlueprint(input): CompanyBlueprint {
    return {
      company: {
        name: input.companyName,
        founderVision: input.founderVision,
        playbookId: "ai-saas",
      },
      departments: this.defaultDepartments.map((department) => ({
        key: department.key,
        name: department.name,
        nameText: department.nameText,
        responsibility: department.responsibility,
        responsibilityText: department.responsibilityText,
        leadAgentId:
          department.defaultLeadCapability === "code"
            ? input.preferredEngineeringAgentId
            : input.preferredStrategyAgentId,
      })),
      objectives: this.okrTemplates.map((template) => ({
        title: template.objectiveTitle,
        titleText: template.objectiveTitleText,
        priority: template.priority,
        keyResults: template.keyResults,
      })),
      proofSchemas: this.proofSchemas,
      tasks: this.taskTemplates.map((template) => ({
        key: template.key,
        departmentKey: template.departmentKey,
        departmentName: template.departmentName,
        title: template.title,
        titleText: template.titleText,
        description: template.description,
        descriptionText: template.descriptionText,
        assigneeAgentId: template.departmentName === "Engineering" ? input.preferredEngineeringAgentId : input.preferredStrategyAgentId,
        requiredCapabilities: template.requiredCapabilities,
        proofSchemaId: template.proofSchemaId,
        riskLevel: template.riskLevel,
        dependsOnTaskKeys: template.dependsOnTaskKeys,
        handoffContract: template.handoffContract,
        handoffContractText: template.handoffContractText,
      })),
    };
  },
} satisfies Playbook;
