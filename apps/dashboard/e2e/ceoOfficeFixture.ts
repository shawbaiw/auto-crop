import type { Page } from "@playwright/test";

/**
 * A company in mid-operation with something in every CEO Office surface: a plan with dependencies
 * across departments, a review, a decision, a Human Action, a Wait State, a new plan, finished
 * outcomes and founder input in several states. Business content is bilingual so either interface
 * language reads naturally.
 */
export const ceoOfficeCompany = {
  id: "company_ceo",
  name: "Pricing Page Studio",
  status: "active",
  playbookId: "ai-saas",
  locale: "en",
  founderVision: "Build an AI SaaS that writes pricing pages for small software teams.",
  selectedCeoAgentId: "codex",
  permissionMode: "balanced",
  createdAt: "2026-10-10T08:00:00.000Z",
  updatedAt: "2026-10-13T09:00:00.000Z",
  taskCount: 6,
};

const text = (en: string, zh: string) => ({ en, zh });
const base = (id: string, type: string, occurredAt: string, extra: Record<string, unknown>) => ({
  id, type, companyId: ceoOfficeCompany.id, sourceId: id.split(":")[1] ?? id, objectiveId: "objective_1", keyResultId: null,
  occurredAt, titleText: null, ...extra,
});

const departments = [
  { id: "dept_research", name: "Research", nameText: text("Research", "研究部"), responsibility: "Find what buyers pay for.", responsibilityText: text("Find what buyers pay for.", "找出买家愿意付费的内容。"), leadAgentId: "claude-code" },
  { id: "dept_product", name: "Product", nameText: text("Product", "产品部"), responsibility: "Define the first offer.", responsibilityText: text("Define the first offer.", "定义第一个产品方案。"), leadAgentId: "codex" },
  { id: "dept_engineering", name: "Engineering", nameText: text("Engineering", "工程部"), responsibility: "Build the generator.", responsibilityText: text("Build the generator.", "开发页面生成器。"), leadAgentId: "codex" },
];

const offered = (...kinds: string[]) => kinds.map((kind) => ({ kind, actor: "founder", holdId: "hold_1" }));

const tasks = [
  { id: "task_research", keyResultId: "kr_research", title: "Compare competitor pricing pages", titleText: text("Compare competitor pricing pages", "对比竞品定价页"), status: "complete", departmentId: "dept_research", assigneeAgentId: "claude-code", dependsOnTaskIds: [] },
  { id: "task_interviews", keyResultId: "kr_research", title: "Summarize buyer interviews", titleText: text("Summarize buyer interviews", "整理买家访谈"), status: "review", departmentId: "dept_research", assigneeAgentId: "claude-code", dependsOnTaskIds: [], affordances: offered("ceo_review_decision") },
  { id: "task_offer", keyResultId: "kr_launch", title: "Choose the pricing model", titleText: text("Choose the pricing model", "确定定价模式"), status: "blocked", departmentId: "dept_product", assigneeAgentId: "codex", dependsOnTaskIds: ["task_research", "task_interviews"] },
  { id: "task_brief", keyResultId: "kr_launch", title: "Write the MVP brief", titleText: text("Write the MVP brief", "撰写 MVP 简介"), status: "waiting_dependency", departmentId: "dept_product", assigneeAgentId: "codex", dependsOnTaskIds: ["task_offer"] },
  { id: "task_build", keyResultId: "kr_launch", title: "Build the page generator", titleText: text("Build the page generator", "开发定价页生成器"), status: "running", departmentId: "dept_engineering", assigneeAgentId: "codex", dependsOnTaskIds: ["task_research"] },
  { id: "task_deploy", keyResultId: "kr_launch", title: "Deploy a public preview", titleText: text("Deploy a public preview", "部署公开预览版"), status: "blocked", departmentId: "dept_engineering", assigneeAgentId: "codex", dependsOnTaskIds: ["task_build", "task_brief"], affordances: offered("confirm_human_action", "request_replan") },
];

const ceoOfficeItems = [
  base("plan_brief:plan", "plan_brief", "2026-10-10T08:05:00.000Z", {
    taskId: null, departmentId: null, title: "Plan created", actionBearing: false,
    data: {
      taskCount: 6,
      objectives: [{
        objectiveId: "objective_1", title: text("Validate the first offer", "验证第一个产品方案"),
        keyResults: [
          { keyResultId: "kr_research", title: text("Know what buyers pay for", "弄清买家愿意付费的内容"), targetValue: text("12 pages and 15 interviews", "12 个定价页和 15 次访谈") },
          { keyResultId: "kr_launch", title: text("Put a preview in front of buyers", "让买家看到预览版"), targetValue: text("A public preview URL", "一个公开预览网址") },
        ],
      }],
      tasks: [
        { taskId: "task_research", title: text("Compare competitor pricing pages", "对比竞品定价页"), purpose: text("", ""), departmentId: "dept_research", keyResultId: "kr_research", dependsOnTaskIds: [] },
        { taskId: "task_interviews", title: text("Summarize buyer interviews", "整理买家访谈"), purpose: text("", ""), departmentId: "dept_research", keyResultId: "kr_research", dependsOnTaskIds: [] },
        { taskId: "task_offer", title: text("Choose the pricing model", "确定定价模式"), purpose: text("", ""), departmentId: "dept_product", keyResultId: "kr_launch", dependsOnTaskIds: [] },
        { taskId: "task_brief", title: text("Write the MVP brief", "撰写 MVP 简介"), purpose: text("", ""), departmentId: "dept_product", keyResultId: "kr_launch", dependsOnTaskIds: [] },
        { taskId: "task_build", title: text("Build the page generator", "开发定价页生成器"), purpose: text("", ""), departmentId: "dept_engineering", keyResultId: "kr_launch", dependsOnTaskIds: [] },
        { taskId: "task_deploy", title: text("Deploy a public preview", "部署公开预览版"), purpose: text("", ""), departmentId: "dept_engineering", keyResultId: "kr_launch", dependsOnTaskIds: [] },
      ],
    },
  }),
  base("task_brief:task_research", "task_brief", "2026-10-10T08:10:00.000Z", {
    taskId: "task_research", departmentId: "dept_research", title: "Compare competitor pricing pages", titleText: text("Compare competitor pricing pages", "对比竞品定价页"), actionBearing: false,
    data: { purpose: text("Learn which pricing page patterns convert for small software teams.", "了解哪些定价页做法对小型软件团队有效。"), purposeSource: "execution_plan", founderVision: ceoOfficeCompany.founderVision, objectiveTitle: text("Validate the first offer", "验证第一个产品方案"), keyResultTitle: null, keyResultMetricName: null, keyResultTargetValue: null, dependsOnTaskIds: [] },
  }),
  base("execution_report:done_research", "execution_report", "2026-10-11T10:00:00.000Z", {
    taskId: "task_research", departmentId: "dept_research", title: "Compare competitor pricing pages", titleText: text("Compare competitor pricing pages", "对比竞品定价页"), actionBearing: false,
    data: {
      conclusion: text("Twelve competitors use three tiers. Nine show a yearly discount.", "12 个竞品使用三档定价，其中 9 个提供年付折扣。"),
      workSummary: text("Compared 12 pricing pages.", "对比了 12 个定价页。"), evidence: null,
      visionImpact: text("The generator should produce three tiers by default.", "生成器默认应生成三档定价。"),
      remainingGap: text("We do not know yet what buyers will pay.", "还不知道买家愿意付多少钱。"),
      recommendation: text("Run buyer interviews next.", "下一步做买家访谈。"),
      summaryFallback: null, businessArtifactId: "artifact_research", remainingGaps: [], recommendedNextSteps: [], outcome: "accepted",
    },
  }),
  base("task_brief:task_build", "task_brief", "2026-10-11T10:30:00.000Z", {
    taskId: "task_build", departmentId: "dept_engineering", title: "Build the page generator", titleText: text("Build the page generator", "开发定价页生成器"), actionBearing: false,
    data: { purpose: text("Build a generator that turns a product description into a pricing page.", "开发一个把产品描述变成定价页的生成器。"), purposeSource: "execution_plan", founderVision: ceoOfficeCompany.founderVision, objectiveTitle: null, keyResultTitle: null, keyResultMetricName: null, keyResultTargetValue: null, dependsOnTaskIds: ["task_research"] },
  }),
  base("approval_request:review_interviews", "approval_request", "2026-10-12T09:00:00.000Z", {
    taskId: "task_interviews", departmentId: "dept_research", title: "Summarize buyer interviews", titleText: text("Summarize buyer interviews", "整理买家访谈"), actionBearing: true,
    data: { businessArtifactId: "artifact_interviews", status: "pending" },
  }),
  base("decision_request:decision_pricing", "decision_request", "2026-10-12T11:00:00.000Z", {
    taskId: "task_offer", departmentId: "dept_product", title: "Choose the pricing model", titleText: text("Choose the pricing model", "确定定价模式"), actionBearing: true,
    data: {
      decisionKind: "pricing_model",
      options: [
        { label: "Monthly subscription", tradeoffs: "Steady revenue. Higher buying friction.", recommended: true },
        { label: "One-time purchase", tradeoffs: "Easy to buy. No recurring revenue.", recommended: false },
      ],
      rationale: "Buyers split evenly in interviews.",
      briefing: "Eight buyers said they prefer a monthly plan. Seven prefer to pay once.",
      status: "pending", resolvedOption: null, resolvedAt: null, blockedTaskIds: ["task_brief"],
    },
  }),
  base("human_action:action_domain", "human_action", "2026-10-12T15:00:00.000Z", {
    taskId: "task_deploy", departmentId: "dept_engineering", title: "Deploy a public preview", titleText: text("Deploy a public preview", "部署公开预览版"), actionBearing: true,
    data: { label: text("Connect a domain for the public preview.", "为公开预览版绑定一个域名。"), status: "pending", confirmationRequirements: ["The preview URL"], blockedTaskIds: ["task_deploy"], verifiedAt: null },
  }),
  base("founder_intake:intake_1", "founder_intake", "2026-10-12T16:00:00.000Z", {
    taskId: null, departmentId: null, objectiveId: null, title: "Founder input", actionBearing: false,
    data: { intakeId: "intake_1", body: "Also support annual plans with a discount.", status: "dispatched" },
  }),
  base("intake_outcome:intake_1", "intake_outcome", "2026-10-12T16:05:00.000Z", {
    taskId: null, departmentId: null, objectiveId: null, title: "CEO answer", actionBearing: false,
    data: {
      intakeId: "intake_1", status: "dispatched", outcome: "create_tasks",
      summary: text("I added the MVP brief task. It now covers annual plans with a 20% discount.", "我新增了 MVP 简介任务，它会包含年付 8 折方案。"),
      createdTaskIds: ["task_brief"], targetTaskId: null, replanProposalId: null, failureReason: null,
    },
  }),
  base("wait_state:wait_index", "wait_state", "2026-10-13T08:00:00.000Z", {
    taskId: "task_build", departmentId: "dept_engineering", title: "Build the page generator", titleText: text("Build the page generator", "开发定价页生成器"), actionBearing: false,
    data: { reason: text("Waiting for the test deploy to finish.", "在等待测试部署完成。"), status: "waiting", nextCheckAt: "2026-10-13T12:00:00.000Z", affectedTaskIds: ["task_build"] },
  }),
  base("founder_intake:intake_2", "founder_intake", "2026-10-13T08:30:00.000Z", {
    taskId: null, departmentId: null, objectiveId: null, title: "Founder input", actionBearing: false,
    data: { intakeId: "intake_2", body: "Our first customers are indie game studios.", status: "assessing" },
  }),
];

const humanActions = [{
  id: "action_domain", companyId: ceoOfficeCompany.id, departmentId: "dept_engineering", taskId: "task_deploy", label: "Connect a domain for the public preview.", labelText: text("Connect a domain for the public preview.", "为公开预览版绑定一个域名。"),
  status: "pending", confirmationRequirements: ["The preview URL"], blockedTaskIds: ["task_deploy"], createdAt: "2026-10-12T15:00:00.000Z",
}];

const waitStates = [{
  id: "wait_index", companyId: ceoOfficeCompany.id, departmentId: "dept_engineering", taskId: "task_build", reason: "Waiting for the test deploy to finish.", reasonText: text("Waiting for the test deploy to finish.", "在等待测试部署完成。"),
  status: "waiting", nextCheckAt: "2026-10-13T12:00:00.000Z", affectedTaskIds: ["task_build"], createdAt: "2026-10-13T08:00:00.000Z",
}];

const founderDecisions = [{
  id: "decision_pricing", companyId: ceoOfficeCompany.id, taskId: "task_offer", departmentId: "dept_product", decisionKind: "pricing_model",
  options: [
    { label: "Monthly subscription", tradeoffs: "Steady revenue. Higher buying friction.", recommended: true },
    { label: "One-time purchase", tradeoffs: "Easy to buy. No recurring revenue.", recommended: false },
  ],
  rationale: "Buyers split evenly in interviews.", briefing: "Eight buyers said they prefer a monthly plan. Seven prefer to pay once.",
  status: "pending", resolvedOption: null, resolvedAt: null, blockedTaskIds: ["task_brief"], createdAt: "2026-10-12T11:00:00.000Z",
}];

const taskCompletionEvents = [{
  id: "done_research", companyId: ceoOfficeCompany.id, taskId: "task_research", departmentId: "dept_research", keyResultId: null, businessArtifactId: "artifact_research", outcome: "accepted",
  outcomeSummary: "Twelve competitors use three tiers.", outcomeSummaryText: text("Twelve competitors use three tiers. Nine show a yearly discount.", "12 个竞品使用三档定价，其中 9 个提供年付折扣。"),
  dependencyImpact: {}, nextStepItems: [], visionGaps: [], createdAt: "2026-10-11T10:00:00.000Z",
}];

const ceoIntakes = [
  { id: "intake_1", companyId: ceoOfficeCompany.id, body: "Also support annual plans with a discount.", bodyText: { en: "Also support annual plans with a discount." }, status: "dispatched", createdAt: "2026-10-12T16:00:00.000Z", updatedAt: "2026-10-12T16:05:00.000Z" },
  { id: "intake_2", companyId: ceoOfficeCompany.id, body: "Our first customers are indie game studios.", bodyText: { en: "Our first customers are indie game studios." }, status: "assessing", createdAt: "2026-10-13T08:30:00.000Z", updatedAt: "2026-10-13T08:30:00.000Z" },
];

const step = (id: string, taskId: string, departmentId: string, kind: string, status: string, label: string, zh: string, createdAt: string) => ({
  id, companyId: ceoOfficeCompany.id, departmentId, parentTaskId: taskId, subjectTaskId: taskId, step: kind, status, label, labelText: text(label, zh), detail: null, createdAt,
});

const taskProgressEvents = [
  step("p1", "task_build", "dept_engineering", "received", "complete", "Received CEO task", "已接收 CEO 任务", "2026-10-11T10:30:00.000Z"),
  step("p2", "task_build", "dept_engineering", "assessment_complete", "complete", "Assessment complete", "评估完成", "2026-10-11T10:31:00.000Z"),
  step("p3", "task_build", "dept_engineering", "executing", "current", "Codex is building the generator", "Codex 正在开发生成器", "2026-10-13T07:50:00.000Z"),
  step("p4", "task_deploy", "dept_engineering", "received", "complete", "Received CEO task", "已接收 CEO 任务", "2026-10-12T14:00:00.000Z"),
  step("p5", "task_deploy", "dept_engineering", "executing", "current", "Deploying the preview", "正在部署预览版", "2026-10-12T14:10:00.000Z"),
  step("p6", "task_deploy", "dept_engineering", "blocked", "blocked", "A domain is needed to publish", "发布需要一个域名", "2026-10-12T15:00:00.000Z"),
];

export function ceoOfficeState(overrides: Record<string, unknown> = {}) {
  return {
    company: ceoOfficeCompany,
    creationEvents: [],
    departments,
    objectives: [{ id: "objective_1", title: "Validate the first offer", titleText: text("Validate the first offer", "验证第一个产品方案"), priority: 1 }],
    keyResults: [
      { id: "kr_research", objectiveId: "objective_1", title: "Know what buyers pay for", titleText: text("Know what buyers pay for", "弄清买家愿意付费的内容"), metricName: "research", targetValue: "12 pages and 15 interviews", targetValueText: text("12 pages and 15 interviews", "12 个定价页和 15 次访谈"), currentValue: "0", status: "active" },
      { id: "kr_launch", objectiveId: "objective_1", title: "Put a preview in front of buyers", titleText: text("Put a preview in front of buyers", "让买家看到预览版"), metricName: "launch", targetValue: "A public preview URL", targetValueText: text("A public preview URL", "一个公开预览网址"), currentValue: "none", status: "active" },
    ],
    visionGaps: [{
      id: "gap_1", companyId: ceoOfficeCompany.id, sourceTaskCompletionEventId: "done_research", taskId: "task_research", departmentId: "dept_research",
      keyResultId: "kr_research", businessArtifactId: null, label: "We do not know yet what buyers will pay.", severity: "strategic",
      relatedTaskId: null, relatedBusinessArtifactId: null, createdAt: "2026-10-11T10:00:00.000Z",
    }],
    tasks,
    ceoOfficeItems,
    proof: [],
    businessArtifacts: [],
    reviews: [],
    activity: [],
    replanProposals: [],
    taskProgressEvents,
    taskCompletionEvents,
    founderDecisions,
    humanActions,
    waitStates,
    ceoIntakes,
    ...overrides,
  };
}

/** Serves the API from a fixed state, with no live event stream. */
export async function mockCeoOfficeApi(page: Page, state: Record<string, unknown> = ceoOfficeState()) {
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/events") {
        await route.abort();
      } else if (path === "/api/agents") {
        await route.fulfill({ json: { agents: [
          { id: "codex", name: "Codex", capabilities: ["code"], detected: true },
          { id: "claude-code", name: "Claude Code", capabilities: ["code", "research"], detected: true },
        ] } });
      } else if (path.endsWith("/state")) {
        await route.fulfill({ json: state });
      } else {
        await route.fulfill({ json: { companies: [state.company] } });
      }
    },
  );
}
