import { describe, expect, it } from "vitest";
import {
  projectCeoOfficeItems,
  type AgentFailureReason,
  type BusinessArtifact,
  type CeoAttentionRollup,
  type CEOOfficeItem,
  type Company,
  type FinalFounderReport,
  type FounderDecision,
  type FounderDecisionResolution,
  type HumanAction,
  type KeyResult,
  type Objective,
  type Task,
  type TaskCompletionEvent,
  type TaskEvent,
  type TaskProgressEvent,
  type TaskStatus,
  type WaitState,
  deriveCeoPendingItems,
} from "./index";

const company: Company = {
  id: "company", name: "Studio", founderVision: "Build a sustainable business", locale: "en",
  selectedCeoAgentId: "ceo", playbookId: "custom", status: "active",
  createdAt: "2026-09-01T08:00:00Z", updatedAt: "2026-09-01T08:00:00Z",
};

function scenario(title: string, conclusion: string) {
  const task: Task = {
    id: "task", companyId: company.id, departmentId: "product", keyResultId: null,
    position: 0, title, description: "Evaluate the business options", assigneeAgentId: "agent",
    requiredCapabilities: [], proofSchemaId: "custom-proof", workspacePath: "/private/workspace",
    status: "complete", riskLevel: "low",
  };
  const progress: TaskProgressEvent = {
    id: "progress", companyId: company.id, departmentId: "product", parentTaskId: task.id,
    subjectTaskId: task.id, step: "received", status: "complete", label: "Received",
    detail: null, createdAt: "2026-09-01T09:00:00Z",
  };
  const completion: TaskCompletionEvent = {
    id: "completion", companyId: company.id, taskId: task.id, departmentId: "product",
    keyResultId: null, businessArtifactId: null, outcome: "accepted",
    outcomeSummaryText: { en: conclusion, zh: "业务结论" }, dependencyImpact: {},
    nextStepItems: [], visionGaps: [], createdAt: "2026-09-01T10:00:00Z",
  };
  const start: TaskEvent = {
    id: "started", taskId: task.id, companyId: company.id, type: "task_started", message: "Started",
    createdAt: completion.createdAt, status: "running", failureReason: null, failureMessage: null,
    executionProfileName: null, requestedTimeoutMs: null, effectiveTimeoutMs: null, dependencyNote: null, artifactWorkspacePath: null,
    executionBrief: { title: { en: title }, purpose: { en: "Evaluate the business options" }, approach: { en: "Compare the supplied options against buyer needs" }, expectedOutcome: { en: "A supported recommendation" } },
  };
  return { company, tasks: [task], taskEvents: [start], taskProgressEvents: [progress], taskCompletionEvents: [completion] };
}

describe("projectCeoOfficeItems", () => {
  it.each([
    ["Choose pricing", "A monthly subscription covers delivery costs"],
    ["Define an MVP", "A concierge service can validate demand"],
    ["Plan a launch", "Invite the pilot customers first"],
  ])("projects a brief and report for %s without a prescribed artifact subtype", (title, conclusion) => {
    const state = scenario(title, conclusion);
    const items = projectCeoOfficeItems(state);
    expect(items).toMatchObject([
      // Equal timestamps still put a real start before its completion.
      { id: "task_brief:task", type: "task_brief", title, occurredAt: "2026-09-01T10:00:00Z", actionBearing: false },
      { id: "execution_report:completion", type: "execution_report", title,
        occurredAt: "2026-09-01T10:00:00Z", actionBearing: false,
        data: { conclusion: null, summaryFallback: { en: conclusion, zh: "业务结论" } } },
    ]);
    expect(items).toHaveLength(2);
    expect(items.filter((item) => item.actionBearing)).toEqual([]);
    expect(JSON.stringify(items)).not.toContain("/private/workspace");
  });

  it("does not project a Task Brief for a task that has not started executing", () => {
    // Only the decomposition-time "received" bookkeeping event exists — no "executing" step, no
    // completion. The task hasn't started work yet, so it must not broadcast a brief.
    const state = scenario("Research the first overseas keyword opportunity", "unused");
    const [task] = state.tasks;
    const items = projectCeoOfficeItems({
      ...state, tasks: [{ ...task!, status: "queued" }], taskEvents: [], taskCompletionEvents: [],
    });
    expect(items.some((item) => item.type === "task_brief")).toBe(false);
  });

  it("projects exactly one plan_brief for the founding decomposition, and no Task Briefs before execution", () => {
    const foundingTasks: Task[] = ["research", "product", "growth"].map((departmentId, position) => ({
      id: `${departmentId}_task`, companyId: company.id, departmentId, keyResultId: null,
      position, title: `Found the ${departmentId} plan`, description: "Split from the founder vision",
      assigneeAgentId: "agent", requiredCapabilities: [], proofSchemaId: "custom-proof",
      workspacePath: "/private/workspace", status: "queued", riskLevel: "low", source: "ceo",
    }));
    const receivedEvents: TaskProgressEvent[] = foundingTasks.map((task) => ({
      id: `received_${task.id}`, companyId: company.id, departmentId: task.departmentId,
      parentTaskId: task.id, subjectTaskId: task.id, step: "received", status: "complete",
      label: "Received CEO task", detail: null, createdAt: company.createdAt,
    }));

    const items = projectCeoOfficeItems({
      company, tasks: foundingTasks, taskProgressEvents: receivedEvents, taskCompletionEvents: [],
    });

    expect(items.map((item) => item.type)).toEqual(["plan_brief"]);
    const planBrief = items[0]!;
    if (planBrief.type !== "plan_brief") throw new Error("expected plan_brief");
    expect(planBrief.occurredAt).toBe(company.createdAt);
    expect(planBrief.data.taskCount).toBe(3);
    expect(planBrief.data.tasks.map((task) => task.taskId)).toEqual(["research_task", "product_task", "growth_task"]);
  });

  it("sorts plan_brief before the first Task Brief on a timestamp tie", () => {
    const foundingTask: Task = {
      id: "task", companyId: company.id, departmentId: "product", keyResultId: null,
      position: 0, title: "Found the plan", description: "Split from the founder vision",
      assigneeAgentId: "agent", requiredCapabilities: [], proofSchemaId: "custom-proof",
      workspacePath: "/private/workspace", status: "running", riskLevel: "low", source: "ceo",
    };
    const executing: TaskProgressEvent = {
      id: "executing", companyId: company.id, departmentId: "product", parentTaskId: foundingTask.id,
      subjectTaskId: foundingTask.id, step: "executing", status: "current", label: "In progress",
      detail: null, createdAt: company.createdAt, // same instant as the plan_brief
    };

    const items = projectCeoOfficeItems({
      company, tasks: [foundingTask], taskProgressEvents: [executing], taskEvents: [{ ...scenario("Found the plan", "").taskEvents[0]!, createdAt: company.createdAt }], taskCompletionEvents: [],
    });

    expect(items.map((item) => item.id)).toEqual([`plan_brief:${company.id}`, "task_brief:task"]);
  });

  it("puts the conclusion before its pending choice and preserves the choice identity after resolution", () => {
    const state = scenario("Choose pricing", "Compare the monthly and annual plans");
    const decision: FounderDecision = {
      id: "choice", companyId: company.id, sourceTaskCompletionEventId: "completion", taskId: "task",
      departmentId: "product", decisionKind: "pricing_model", rationale: "Choose a billing period",
      briefing: "Monthly and annual both tested well; the split comes down to cash timing versus commitment.",
      options: [{ label: "Monthly", tradeoffs: "Lower upfront commitment", recommended: true }],
      status: "pending", resolvedOption: null, resolvedAt: null, blockedTaskIds: ["launch"],
      createdAt: "2026-09-01T10:00:00Z",
    };
    const pending = projectCeoOfficeItems({ ...state, founderDecisions: [decision] });
    expect(pending.map((item) => item.type)).toEqual(["task_brief", "execution_report", "decision_request"]);
    expect(pending.filter((item) => item.actionBearing)).toMatchObject([
      {
        id: "decision_request:choice",
        data: {
          status: "pending",
          decisionKind: "pricing_model",
          briefing: "Monthly and annual both tested well; the split comes down to cash timing versus commitment.",
        },
      },
    ]);
    const resolved = projectCeoOfficeItems({ ...state, founderDecisions: [{
      ...decision, status: "resolved", resolvedOption: "Monthly", resolvedAt: "2026-09-01T11:00:00Z",
    }] });
    expect(resolved.filter((item) => item.actionBearing)).toEqual([]);
    expect(resolved.find((item) => item.id === "decision_request:choice")).toMatchObject({
      occurredAt: decision.createdAt, data: { status: "resolved", resolvedOption: "Monthly" },
    });
  });

  it("projects objective stage changes as objective-level timeline items", () => {
    const state = scenario("Validate buyer urgency", "Buyer urgency is proven");
    const objective: Objective = {
      id: "objective_market_fit", companyId: company.id, title: "Reach founder-market fit", status: "complete", priority: 1,
    };
    const keyResult: KeyResult = {
      id: "kr_urgency", objectiveId: objective.id, title: "Confirm urgent buyer pain",
      metricName: "validated pains", targetValue: "1", currentValue: "1", status: "met",
    };
    const stageChange: CeoAttentionRollup = {
      id: "rollup_stage_change", companyId: company.id,
      group: { type: "objective", objectiveId: objective.id },
      title: "Objective complete",
      summary: "The objective reached a terminal state after buyer validation.",
      ownerDepartmentId: "product",
      downstreamDepartmentIds: ["growth"],
      affectedTaskIds: ["task"],
      currentBlocker: null,
      recommendedNextAction: "Prepare the closing company summary.",
      severity: "informational",
      reasons: ["goal_stage_change"],
      relevantHumanActions: [],
      relevantWaitStates: [],
      relevantVisionGaps: [],
      relevantFounderDecisions: [],
      sourceTaskCompletionEventIds: ["completion"],
      createdAt: "2026-09-01T10:30:00Z",
    };

    expect(projectCeoOfficeItems({
      ...state,
      tasks: [{ ...state.tasks[0]!, keyResultId: keyResult.id }],
      objectives: [objective],
      keyResults: [keyResult],
      ceoAttentionRollups: [stageChange],
    })).toContainEqual(expect.objectContaining({
      id: "stage_change:rollup_stage_change",
      type: "stage_change",
      sourceId: stageChange.id,
      taskId: null,
      departmentId: null,
      objectiveId: objective.id,
      keyResultId: null,
      title: "Objective complete",
      occurredAt: "2026-09-01T10:30:00Z",
      actionBearing: false,
      data: {
        summary: { en: "The objective reached a terminal state after buyer validation.", zh: "The objective reached a terminal state after buyer validation." },
        recommendedNextAction: { en: "Prepare the closing company summary.", zh: "Prepare the closing company summary." },
        affectedTaskIds: ["task"],
      },
    }));
  });

  it("projects Final Founder Reports as company-level final report timeline items", () => {
    const state = scenario("Validate pricing", "Pricing is ready");
    const report: FinalFounderReport = {
      id: "final_report_1",
      companyId: company.id,
      classification: "achieved",
      sections: {
        vision: { en: "Build a sustainable business" },
        actualResult: { en: "A pilot offer is ready." },
        departmentContributions: [{ en: "Product validated the offer." }],
        goalFit: { en: "The key result is complete." },
        remainingGaps: { en: "No blocking gaps remain." },
        recommendedNextStep: { en: "Start founder-led sales." },
      },
      generatedBy: "ceo_agent",
      isCurrent: true,
      supersedesReportId: null,
      createdAt: "2026-09-01T11:00:00Z",
      updatedAt: "2026-09-01T11:00:00Z",
    };

    expect(projectCeoOfficeItems({ ...state, finalFounderReports: [report] })).toContainEqual(expect.objectContaining({
      id: "final_report:final_report_1",
      type: "final_report",
      sourceId: report.id,
      taskId: null,
      departmentId: null,
      objectiveId: null,
      keyResultId: null,
      title: "Final Founder Report",
      occurredAt: "2026-09-01T11:00:00Z",
      actionBearing: false,
      data: {
        classification: "achieved",
        sections: report.sections,
        isCurrent: true,
        supersedesReportId: null,
      },
    }));
  });

  it("updates resolved decision requests and projects Decision Resolution history items", () => {
    const state = scenario("Choose launch target", "Two audiences are viable");
    const decision: FounderDecision = {
      id: "launch_choice", companyId: company.id, sourceTaskCompletionEventId: "completion", taskId: "task",
      departmentId: "growth", decisionKind: "launch_target", rationale: "Choose the first audience",
      briefing: "We scoped clinics and gyms; clinics show the sharper workflow pain and a clearer buyer.",
      options: [{ label: "Clinics", tradeoffs: "More urgent workflow pain", recommended: true }],
      status: "pending", resolvedOption: null, resolvedAt: null, blockedTaskIds: ["launch"],
      createdAt: "2026-09-01T10:00:00Z",
    };
    const resolution: FounderDecisionResolution = {
      founderDecisionId: decision.id,
      companyId: company.id,
      taskId: "task",
      status: "resolved",
      chosenOption: "Clinics",
      returnReason: null,
      note: "Start where urgency is clearest.",
      resolvedAt: "2026-09-01T11:00:00Z",
    };

    const items = projectCeoOfficeItems({
      ...state,
      founderDecisions: [decision],
      founderDecisionResolutions: [resolution],
    });

    expect(items.find((item) => item.id === "decision_request:launch_choice")).toMatchObject({
      actionBearing: false,
      occurredAt: "2026-09-01T10:00:00Z",
      data: {
        status: "resolved",
        resolvedOption: "Clinics",
        resolvedAt: "2026-09-01T11:00:00Z",
      },
    });
    expect(items).toContainEqual(expect.objectContaining({
      id: "decision_resolution:launch_choice",
      type: "decision_resolution",
      sourceId: "launch_choice",
      taskId: "task",
      departmentId: "growth",
      occurredAt: "2026-09-01T11:00:00Z",
      actionBearing: false,
      data: expect.objectContaining({
        requestItemId: "decision_request:launch_choice",
        outcome: "resolved",
        chosenOption: "Clinics",
        note: expect.objectContaining({ en: "Start where urgency is clearest." }),
      }),
    }));
  });

  it("sorts stage changes, final reports, and decision resolutions by instant with deterministic ties", () => {
    const state = scenario("Choose launch target", "Two audiences are viable");
    const decision: FounderDecision = {
      id: "launch_choice", companyId: company.id, sourceTaskCompletionEventId: "completion", taskId: "task",
      departmentId: "growth", decisionKind: "launch_target", rationale: "Choose the first audience",
      briefing: "We scoped clinics and gyms; clinics show the sharper workflow pain and a clearer buyer.",
      options: [{ label: "Clinics", tradeoffs: "More urgent workflow pain", recommended: true }],
      status: "pending", resolvedOption: null, resolvedAt: null, blockedTaskIds: ["launch"],
      createdAt: "2026-09-01T10:00:00Z",
    };
    const resolution: FounderDecisionResolution = {
      founderDecisionId: decision.id, companyId: company.id, taskId: "task", status: "resolved",
      chosenOption: "Clinics", returnReason: null, note: null, resolvedAt: "2026-09-01T12:00:00+02:00",
    };
    const stageChange: CeoAttentionRollup = {
      id: "rollup_stage_change", companyId: company.id, group: { type: "objective", objectiveId: "objective_1" },
      title: "Objective complete", summary: "Objective complete.", ownerDepartmentId: "product",
      downstreamDepartmentIds: [], affectedTaskIds: ["task"], currentBlocker: null,
      recommendedNextAction: "Write final report.", severity: "informational", reasons: ["goal_stage_change"],
      relevantHumanActions: [], relevantWaitStates: [], relevantVisionGaps: [], relevantFounderDecisions: [],
      sourceTaskCompletionEventIds: ["completion"], createdAt: "2026-09-01T10:00:00Z",
    };
    const report: FinalFounderReport = {
      id: "final_report_1", companyId: company.id, classification: "achieved", generatedBy: "deterministic_fallback",
      sections: {
        vision: { en: "Vision" },
        actualResult: { en: "Result" },
        departmentContributions: [],
        goalFit: { en: "Fit" },
        remainingGaps: { en: "None" },
        recommendedNextStep: { en: "Sell" },
      },
      isCurrent: true, supersedesReportId: null,
      createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z",
    };

    const items = projectCeoOfficeItems({
      ...state,
      founderDecisions: [decision],
      founderDecisionResolutions: [resolution],
      ceoAttentionRollups: [stageChange],
      finalFounderReports: [report],
    });

    expect(items.map((item) => item.id)).toEqual([
      "task_brief:task",
      "execution_report:completion",
      "decision_request:launch_choice",
      "decision_resolution:launch_choice",
      "stage_change:rollup_stage_change",
      "final_report:final_report_1",
    ]);
  });

  it("keeps chronological order and source identities across shuffled reads without mutating state", () => {
    const state = scenario("Define an MVP", "Start with a concierge service");
    const input = {
      ...state,
      tasks: [...state.tasks, { ...state.tasks[0]!, id: "earlier" }],
      taskCompletionEvents: [
        { ...state.taskCompletionEvents[0]!, id: "z" },
        { ...state.taskCompletionEvents[0]!, id: "a", createdAt: "2026-09-01T12:00:00+02:00" },
        { ...state.taskCompletionEvents[0]!, id: "early", taskId: "earlier", createdAt: "2026-09-01T08:30:00Z" },
      ],
    };
    const before = structuredClone(input);
    const projected = projectCeoOfficeItems(input);
    expect(projected.map((item) => item.id)).toEqual([
      "execution_report:early", "task_brief:task", "execution_report:a", "execution_report:z",
    ]);
    expect(projectCeoOfficeItems({
      ...input, tasks: [...input.tasks].reverse(), taskCompletionEvents: [...input.taskCompletionEvents].reverse(),
    })).toEqual(projected);
    expect(input).toEqual(before);
  });

  it("does not fabricate a pre-work brief from a legacy completion", () => {
    const state = scenario("Plan a launch", "Invite pilot customers");
    expect(projectCeoOfficeItems({ ...state, taskEvents: [], taskProgressEvents: [], taskCompletionEvents: [] })).toEqual([]);
    expect(projectCeoOfficeItems({ ...state, taskEvents: [], taskProgressEvents: [] }).map(item => item.type)).toEqual(["execution_report"]);
  });

  it("prefers structured Execution Report fields and keeps Task Outcome Summary as fallback", () => {
    const state = scenario("Choose pricing", "Legacy summary remains readable");
    const [completion] = state.taskCompletionEvents;
    const items = projectCeoOfficeItems({
      ...state,
      taskCompletionEvents: [{
        ...completion!,
        executionReport: {
          conclusion: { en: "Usage-based pricing is premature." },
          visionImpact: { en: "The business can sell a simpler first package." },
          remainingGap: { en: "Real buyer willingness to pay is still untested." },
          recommendation: { en: "Start with a flat pilot price." },
        },
      }],
    });

    expect(items.find((item) => item.type === "execution_report")).toMatchObject({
      data: {
        conclusion: { en: "Usage-based pricing is premature." },
        visionImpact: { en: "The business can sell a simpler first package." },
        remainingGap: { en: "Real buyer willingness to pay is still untested." },
        recommendation: { en: "Start with a flat pilot price." },
        summaryFallback: null,
      },
    });
  });

  it("preserves the announced plan when task definitions and assessments change", () => {
    const state = scenario("Interview buyers", "Three segments are ready");
    const before = projectCeoOfficeItems(state).find(item => item.type === "task_brief");
    const after = projectCeoOfficeItems({ ...state,
      tasks: [{ ...state.tasks[0]!, title: "A new assignment", description: "Different instructions" }],
      taskProgressEvents: [{ ...state.taskProgressEvents[0]!, step: "assessment_complete", detail: "A later assessment" }],
    }).find(item => item.type === "task_brief");
    expect(after?.titleText).toEqual(before?.titleText);
    expect(after?.data).toEqual(before?.data);
    expect(after).toMatchObject({ data: { purposeSource: "execution_plan", approach: { en: "Compare the supplied options against buyer needs" }, expectedOutcome: { en: "A supported recommendation" } } });
  });

  it("marks the plan unavailable for old real starts without inventing task instructions", () => {
    const state = scenario("Launch", "Ready");
    expect(projectCeoOfficeItems({ ...state, taskEvents: [{ ...state.taskEvents[0]!, executionBrief: undefined }] }).find(item => item.type === "task_brief"))
      .toMatchObject({ data: { purposeSource: "unavailable", approach: null, expectedOutcome: null } });
  });

  it("links Execution Reports to their associated Business Artifact without exposing artifact payloads", () => {
    const state = scenario("Build launch page", "The launch page is ready for review");
    const artifact: BusinessArtifact = {
      id: "artifact_launch_page", companyId: company.id, taskId: "task", sourceProofId: "proof_1",
      artifactKind: "deliverable", artifactRole: "implementation", artifactSubtype: "launch_page",
      artifactType: "implementation_summary", taskType: "launch_page_build",
      payload: { private_diagnostics: "/private/workspace/raw-output.json" },
      lineage: {}, validationStatus: "valid", validationErrors: [], reviewStatus: "unreviewed",
      isCurrent: true, supersedesArtifactId: null,
      createdAt: "2026-09-01T09:55:00Z", updatedAt: "2026-09-01T09:55:00Z",
    };

    const items = projectCeoOfficeItems({
      ...state,
      taskCompletionEvents: [{ ...state.taskCompletionEvents[0]!, businessArtifactId: artifact.id }],
      businessArtifacts: [artifact],
    });

    expect(items.find((item) => item.type === "execution_report")).toMatchObject({
      data: {
        businessArtifactId: artifact.id,
      },
    });
    expect(JSON.stringify(items)).not.toContain("private_diagnostics");
    expect(JSON.stringify(items)).not.toContain("reviewStatus");
    expect(JSON.stringify(items)).not.toContain("artifactSubtype");
  });

  it("does not infer an associated Business Artifact when a legacy completion lacks an artifact id", () => {
    const state = scenario("Validate onboarding", "Trial users completed onboarding");
    const artifact: BusinessArtifact = {
      id: "artifact_validation", companyId: company.id, taskId: "task", sourceProofId: "proof_1",
      artifactKind: "deliverable", artifactRole: "validation", artifactSubtype: "onboarding_test",
      artifactType: "validation_result", taskType: "validation.onboarding",
      payload: {}, lineage: {}, validationStatus: "valid", validationErrors: [], reviewStatus: "accepted",
      isCurrent: true, supersedesArtifactId: null,
      createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z",
    };

    expect(projectCeoOfficeItems({ ...state, businessArtifacts: [artifact] })
      .find((item) => item.type === "execution_report")).toMatchObject({
      data: {
        businessArtifactId: null,
      },
    });
  });

  it("does not expose an artifact id as associated when the referenced artifact belongs to another task", () => {
    const state = scenario("Validate onboarding", "Trial users completed onboarding");
    const artifact: BusinessArtifact = {
      id: "artifact_other_task", companyId: company.id, taskId: "other_task", sourceProofId: "proof_1",
      artifactKind: "deliverable", artifactRole: "validation", artifactSubtype: "onboarding_test",
      artifactType: "validation_result", taskType: "validation.onboarding",
      payload: {}, lineage: {}, validationStatus: "valid", validationErrors: [], reviewStatus: "accepted",
      isCurrent: true, supersedesArtifactId: null,
      createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z",
    };

    expect(projectCeoOfficeItems({
      ...state,
      taskCompletionEvents: [{ ...state.taskCompletionEvents[0]!, businessArtifactId: artifact.id }],
      businessArtifacts: [artifact],
    }).find((item) => item.type === "execution_report")).toMatchObject({
      data: {
        businessArtifactId: null,
      },
    });
  });

  it("carries legacy Execution Report gaps and recommended next steps from completion facts", () => {
    const state = scenario("Research SEO keywords", "Setup keywords have the fastest path to intent");

    expect(projectCeoOfficeItems({
      ...state,
      taskCompletionEvents: [{
        ...state.taskCompletionEvents[0]!,
        nextStepItems: [{
          type: "automatic_downstream_task",
          label: "Draft the landing page around setup automation.",
          ownerDepartmentId: "growth",
          relatedTaskId: "landing_page",
          relatedBusinessArtifactId: null,
          dependencyImpact: {},
          severity: "informational",
          priority: 1,
          evidenceRequirements: ["Landing page brief"],
        }],
        visionGaps: [{
          label: "Search volume still needs validation after publishing.",
          severity: "informational",
          relatedTaskId: "validation_task",
          relatedBusinessArtifactId: null,
        }],
      }],
    }).find((item) => item.type === "execution_report")).toMatchObject({
      data: {
        summaryFallback: { en: "Setup keywords have the fastest path to intent" },
        remainingGaps: [{ label: "Search volume still needs validation after publishing.", severity: "informational" }],
        recommendedNextSteps: [{ label: "Draft the landing page around setup automation.", type: "automatic_downstream_task" }],
      },
    });
  });

  it.each([
    ["SEO keyword research", "Prioritize long-tail setup keywords"],
    ["Choose pricing", "Flat pilot pricing is easiest to sell"],
    ["Define an MVP", "A concierge MVP will test workflow demand"],
    ["Plan a launch", "Invite pilot customers before broad launch"],
  ])("projects ordinary Task Brief and Execution Report timeline items for %s", (title, conclusion) => {
    const items = projectCeoOfficeItems(scenario(title, conclusion));
    expect(items).toMatchObject([
      { type: "task_brief", title, actionBearing: false },
      { type: "execution_report", title, actionBearing: false, data: { summaryFallback: { en: conclusion } } },
    ]);
  });

  it("does not import another company's facts into the timeline", () => {
    const state = scenario("Choose pricing", "Offer a subscription");
    expect(projectCeoOfficeItems({
      ...state,
      tasks: state.tasks.map((task) => ({ ...task, companyId: "other" })),
      taskProgressEvents: state.taskProgressEvents.map((event) => ({ ...event, companyId: "other" })),
      taskCompletionEvents: state.taskCompletionEvents.map((event) => ({ ...event, companyId: "other" })),
    })).toEqual([]);
  });

  it("projects action-bearing CEO Office items generically across pending sources", () => {
    const state = scenario("Validate onboarding", "Onboarding evidence is ready");
    const [task] = state.tasks;
    const reviewArtifact: BusinessArtifact = {
      id: "artifact_review", companyId: company.id, taskId: task!.id, sourceProofId: "proof_1",
      artifactKind: "deliverable", artifactRole: "validation", artifactSubtype: "onboarding_evidence",
      artifactType: "validation_result", taskType: "validation.onboarding",
      payload: {}, lineage: {}, validationStatus: "valid", validationErrors: [], reviewStatus: "unreviewed",
      isCurrent: true, supersedesArtifactId: null,
      createdAt: "2026-09-01T10:05:00Z", updatedAt: "2026-09-01T10:05:00Z",
    };
    const decision: FounderDecision = {
      id: "decision", companyId: company.id, sourceTaskCompletionEventId: "completion", taskId: task!.id,
      departmentId: "product", decisionKind: "launch_target", rationale: "Pick the first launch audience",
      briefing: "Clinics and gyms both viable; clinics carry the more acute pain and a named budget owner.",
      options: [{ label: "Clinics", tradeoffs: "More urgent pain", recommended: true }],
      status: "pending", resolvedOption: null, resolvedAt: null, blockedTaskIds: ["launch"],
      createdAt: "2026-09-01T10:06:00Z",
    };
    const humanAction: HumanAction = {
      id: "human_action", companyId: company.id, sourceTaskCompletionEventId: "completion", taskId: task!.id,
      departmentId: "product", label: "Connect the analytics account.", blockedTaskIds: ["measure"],
      confirmationRequirements: ["Account connected screenshot"], evidence: {}, status: "pending",
      verifiedAt: null, verificationErrors: [], createdAt: "2026-09-01T10:07:00Z",
    };
    const waitState: WaitState = {
      id: "wait_state", companyId: company.id, sourceTaskCompletionEventId: "completion", taskId: task!.id,
      departmentId: "product", keyResultId: null, businessArtifactId: null,
      label: "Wait for search indexing.", reason: "Search indexing has to settle before validation.",
      relatedTaskId: null, relatedBusinessArtifactId: null, affectedTaskIds: ["measure"],
      nextCheckAt: "2026-09-08T10:00:00Z", status: "waiting", severity: "informational",
      createdAt: "2026-09-01T10:08:00Z",
    };
    const blockedTask: Task = {
      ...task!, id: "blocked_task", title: "Recover missing proof", status: "failed",
      latestFailureReason: "missing_deliverable", latestFailureMessage: "Expected deliverable was not recorded.",
    };
    const blockedEvent: TaskEvent = {
      id: "blocked_event", companyId: company.id, taskId: blockedTask.id, type: "deliverable_missing",
      message: "Expected deliverable was not recorded.", messageText: null,
      createdAt: "2026-09-01T10:09:00Z", status: "failed", failureReason: "missing_deliverable",
      failureMessage: "Expected deliverable was not recorded.", executionProfileName: null,
      requestedTimeoutMs: null, effectiveTimeoutMs: null, dependencyNote: null, artifactWorkspacePath: null,
    };

    const items = projectCeoOfficeItems({
      ...state,
      tasks: [task!, blockedTask],
      businessArtifacts: [reviewArtifact],
      founderDecisions: [decision],
      humanActions: [humanAction],
      waitStates: [waitState],
      taskEvents: [...state.taskEvents, blockedEvent],
      taskCompletionEvents: state.taskCompletionEvents,
    });

    expect(items.map((item) => item.type)).toEqual([
      "task_brief", "execution_report", "approval_request", "decision_request", "human_action", "wait_state", "blocked_issue",
    ]);
    expect(items.filter((item) => item.actionBearing).map((item) => item.type)).toEqual([
      "approval_request", "decision_request", "human_action", "blocked_issue",
    ]);
    expect(items.find((item) => item.type === "wait_state")).toMatchObject({
      actionBearing: false,
      data: { reason: { en: "Search indexing has to settle before validation." }, status: "waiting" },
    });
    expect(items.find((item) => item.type === "blocked_issue")).toMatchObject({
      taskId: "blocked_task",
      data: { reason: { en: "Expected deliverable was not recorded." }, status: "open", affectedTaskIds: ["blocked_task"] },
    });
  });

  it.each([
    ["blocked", "blocked", null, "task_blocked"],
    ["retry-exhausted", "failed", "retry_exhausted", "task_failed"],
    ["missing-deliverable", "failed", "missing_deliverable", "deliverable_missing"],
    ["needs-replan", "needs_replan", "needs_replan", "task_needs_replan"],
    ["unrecoverable failure", "failed", null, "task_failed"],
  ] satisfies Array<[string, TaskStatus, AgentFailureReason | null, TaskEvent["type"]]>)(
    "projects %s as an action-bearing Blocked Issue",
    (_label, status, failureReason, eventType) => {
      const state = scenario("Resolve execution issue", "No ordinary completion report should matter");
      const [task] = state.tasks;
      const blockedTask: Task = {
        ...task!,
        status,
        latestFailureReason: failureReason,
        latestFailureMessage: "The task cannot move forward.",
      };
      const blockedEvent: TaskEvent = {
        id: `blocked_event_${status}_${failureReason ?? "unrecoverable"}`,
        companyId: company.id,
        taskId: blockedTask.id,
        type: eventType,
        message: "The task cannot move forward.",
        messageText: null,
        createdAt: "2026-09-01T10:09:00Z",
        status,
        failureReason,
        failureMessage: "The task cannot move forward.",
        executionProfileName: null,
        requestedTimeoutMs: null,
        effectiveTimeoutMs: null,
        dependencyNote: null,
        artifactWorkspacePath: null,
      };

      expect(projectCeoOfficeItems({
        ...state,
        tasks: [blockedTask],
        taskEvents: [...state.taskEvents, blockedEvent],
      })).toContainEqual(expect.objectContaining({
        type: "blocked_issue",
        actionBearing: true,
        data: expect.objectContaining({ status: "open", reason: { en: "The task cannot move forward." } }),
      }));
    },
  );

  it.each([
    ["blocked", "blocked"],
    ["needs_replan", "needs_replan"],
    ["failed_to_review", "blocked"],
  ] satisfies Array<[TaskCompletionEvent["outcome"], TaskStatus]>)(
    "emits no Execution Report for a %s completion outcome but still projects a Blocked Issue",
    (outcome, status) => {
      const state = scenario("Recover the deliverable", "The work could not be accepted");
      const [task] = state.tasks;

      const items = projectCeoOfficeItems({
        ...state,
        tasks: [{ ...task!, status }],
        taskCompletionEvents: [{ ...state.taskCompletionEvents[0]!, outcome }],
      });

      expect(items.some((item) => item.type === "execution_report")).toBe(false);
      expect(items.find((item) => item.type === "blocked_issue")).toMatchObject({
        type: "blocked_issue",
        actionBearing: true,
        taskId: "task",
        data: { status: "open", reason: { en: "The work could not be accepted" } },
      });
    },
  );

  it("does not project an Execution Report for an accepted completion that carries no conclusion or outcome summary", () => {
    const state = scenario("Record the implementation diff", "unused");
    const [task] = state.tasks;
    // An accepted completion with a business artifact but no authored narrative — the shape older
    // completions have. There is nothing to broadcast, so no Report card; the completion row and its
    // artifact still exist as durable facts.
    const bodiless: TaskCompletionEvent = {
      ...state.taskCompletionEvents[0]!, outcome: "accepted",
      businessArtifactId: "artifact_1", outcomeSummaryText: null, executionReport: null,
    };

    const items = projectCeoOfficeItems({ ...state, taskCompletionEvents: [bodiless] });

    expect(items.some((item) => item.type === "execution_report")).toBe(false);
    expect(items.some((item) => item.type === "task_brief")).toBe(true);
  });

  it("keeps a blocked completion's outcome summary as authored so a missing company locale stays visible", () => {
    const state = scenario("Recover the deliverable", "n/a");
    const [task] = state.tasks;
    const zhCompany: Company = { ...company, locale: "zh" };
    // The agent authored the summary in English only; for a zh company the zh slot must stay absent
    // so the dashboard renders its "untranslated" marker rather than silently showing English.
    const blocked: TaskCompletionEvent = {
      ...state.taskCompletionEvents[0]!, outcome: "blocked",
      outcomeSummaryText: { en: "The deliverable could not be accepted." },
    };

    const items = projectCeoOfficeItems({
      ...state, company: zhCompany, tasks: [{ ...task!, status: "blocked" }], taskCompletionEvents: [blocked],
    });

    expect(items.find((item) => item.type === "blocked_issue")?.data).toMatchObject({
      reason: { en: "The deliverable could not be accepted." },
    });
    expect((items.find((item) => item.type === "blocked_issue")?.data as { reason: Record<string, string> }).reason.zh)
      .toBeUndefined();
  });

  it("wraps agent-authored wait/blocked reasons and human-action labels under the company locale", () => {
    const state = scenario("Localize the timeline", "Nothing blocks acceptance");
    const [task] = state.tasks;
    const zhCompany: Company = { ...company, locale: "zh" };
    const humanAction: HumanAction = {
      id: "human_action", companyId: company.id, sourceTaskCompletionEventId: "completion", taskId: task!.id,
      departmentId: "product", label: "连接分析账户。", blockedTaskIds: [],
      confirmationRequirements: [], evidence: {}, status: "pending",
      verifiedAt: null, verificationErrors: [], createdAt: "2026-09-01T10:07:00Z",
    };
    const waitState: WaitState = {
      id: "wait_state", companyId: company.id, sourceTaskCompletionEventId: "completion", taskId: task!.id,
      departmentId: "product", keyResultId: null, businessArtifactId: null,
      label: "等待搜索索引。", reason: "等待搜索索引稳定后再验证。",
      relatedTaskId: null, relatedBusinessArtifactId: null, affectedTaskIds: [],
      nextCheckAt: "2026-09-08T10:00:00Z", status: "waiting", severity: "informational",
      createdAt: "2026-09-01T10:08:00Z",
    };
    const blockedTask: Task = {
      ...task!, id: "blocked_task", title: "恢复缺失的证明", status: "blocked",
      latestFailureReason: null, latestFailureMessage: "部门报告了阻塞。",
    };
    const blockedEvent: TaskEvent = {
      id: "blocked_event", companyId: company.id, taskId: blockedTask.id, type: "task_blocked",
      message: "部门报告了阻塞。", messageText: null, createdAt: "2026-09-01T10:09:00Z", status: "blocked",
      failureReason: null, failureMessage: "部门报告了阻塞。", executionProfileName: null,
      requestedTimeoutMs: null, effectiveTimeoutMs: null, dependencyNote: null, artifactWorkspacePath: null,
    };

    const items = projectCeoOfficeItems({
      ...state, company: zhCompany, tasks: [task!, blockedTask],
      humanActions: [humanAction], waitStates: [waitState], taskEvents: [...state.taskEvents, blockedEvent],
    });

    expect(items.find((item) => item.type === "human_action")?.data).toMatchObject({ label: { zh: "连接分析账户。" } });
    expect(items.find((item) => item.type === "wait_state")?.data).toMatchObject({ reason: { zh: "等待搜索索引稳定后再验证。" } });
    expect(items.find((item) => item.type === "blocked_issue")?.data).toMatchObject({ reason: { zh: "部门报告了阻塞。" } });
    expect(JSON.stringify(items)).not.toMatch(/"reason":"[^"]/);
  });

  it("falls back to a bilingual deterministic blocked-issue reason when no reason string is present", () => {
    const state = scenario("Recover proof", "n/a");
    const [task] = state.tasks;
    const blockedTask: Task = {
      ...task!, id: "blocked_task", status: "failed",
      latestFailureReason: "retry_exhausted", latestFailureMessage: null, dependencyNote: null,
    };
    const blockedEvent: TaskEvent = {
      id: "blocked_event", companyId: company.id, taskId: blockedTask.id, type: "task_failed",
      message: "", messageText: null, createdAt: "2026-09-01T10:09:00Z", status: "failed",
      failureReason: "retry_exhausted", failureMessage: null, executionProfileName: null,
      requestedTimeoutMs: null, effectiveTimeoutMs: null, dependencyNote: null, artifactWorkspacePath: null,
    };

    const items = projectCeoOfficeItems({ ...state, tasks: [blockedTask], taskEvents: [blockedEvent] });
    expect(items.find((item) => item.type === "blocked_issue")?.data).toMatchObject({
      reason: { en: "Retries exhausted", zh: "重试次数已用尽" },
    });
  });

  function blockedTaskFixture(id: string, title: string): { task: Task; event: TaskEvent } {
    return {
      task: {
        id, companyId: company.id, departmentId: "product", keyResultId: null, position: 0, title,
        description: "Blocked by a dependency cascade", assigneeAgentId: "agent", requiredCapabilities: [],
        proofSchemaId: "custom-proof", workspacePath: "/private/workspace", status: "blocked", riskLevel: "low",
        latestFailureReason: "dependency_failed" as AgentFailureReason,
        latestFailureMessage: `Blocked by failed dependency: ${title}.`,
      },
      event: {
        id: `${id}_event`, companyId: company.id, taskId: id, type: "task_blocked",
        message: `Blocked by failed dependency: ${title}.`, messageText: null,
        createdAt: "2026-09-01T10:09:00Z", status: "blocked", failureReason: "dependency_failed",
        failureMessage: `Blocked by failed dependency: ${title}.`, executionProfileName: null,
        requestedTimeoutMs: null, effectiveTimeoutMs: null, dependencyNote: null, artifactWorkspacePath: null,
      },
    };
  }

  it("collapses a blocked dependency chain into one root Blocked Issue with every cascaded task attached", () => {
    // A fails on its own; B depends on A and only reads as blocked because A is; C depends on B for
    // the same reason. Only A should surface as an actionable CEO Pending item.
    const a = blockedTaskFixture("task_a", "Root cause task");
    const b = blockedTaskFixture("task_b", "Middle task");
    const c = blockedTaskFixture("task_c", "Downstream task");
    a.task.latestFailureReason = null; // the actual root: not itself a dependency-cascade victim

    const items = projectCeoOfficeItems({
      company, tasks: [a.task, b.task, c.task], taskCompletionEvents: [],
      taskEvents: [a.event, { ...b.event, blockedByTaskId: a.task.id }, { ...c.event, blockedByTaskId: b.task.id }],
      taskDependencies: [
        { taskId: "task_b", dependsOnTaskId: "task_a" },
        { taskId: "task_c", dependsOnTaskId: "task_b" },
      ],
    });

    const blockedIssues = items.filter((item) => item.type === "blocked_issue");
    expect(blockedIssues).toHaveLength(1);
    expect(blockedIssues[0]).toMatchObject({
      taskId: "task_a",
      data: { affectedTaskIds: ["task_a", "task_b", "task_c"] },
    });
  });

  it("attaches a task blocked by two independently-broken upstreams to both roots", () => {
    const a = blockedTaskFixture("task_a", "First root");
    const e = blockedTaskFixture("task_e", "Second root");
    const d = blockedTaskFixture("task_d", "Fan-in task");
    a.task.latestFailureReason = null;
    e.task.latestFailureReason = null;

    const items = projectCeoOfficeItems({
      company, tasks: [a.task, e.task, d.task], taskCompletionEvents: [],
      taskEvents: [a.event, e.event, { ...d.event, blockedByTaskId: a.task.id }, { ...d.event, id: "second_cause", blockedByTaskId: e.task.id }],
      taskDependencies: [
        { taskId: "task_d", dependsOnTaskId: "task_a" },
        { taskId: "task_d", dependsOnTaskId: "task_e" },
      ],
    });

    const blockedIssues = items.filter((item) => item.type === "blocked_issue");
    expect(blockedIssues).toHaveLength(2);
    expect(blockedIssues.find((item) => item.taskId === "task_a")).toMatchObject({
      data: { affectedTaskIds: ["task_a", "task_d"] },
    });
    expect(blockedIssues.find((item) => item.taskId === "task_e")).toMatchObject({
      data: { affectedTaskIds: ["task_d", "task_e"] },
    });
  });

  it("projects exactly one Execution Report plus a Decision Resolution when a task goes awaiting_founder_decision then accepted", () => {
    const state = scenario("Choose pricing", "Flat pilot pricing is the pick");
    const [task] = state.tasks;
    const awaiting: TaskCompletionEvent = {
      ...state.taskCompletionEvents[0]!, id: "completion_awaiting",
      outcome: "awaiting_founder_decision", createdAt: "2026-09-01T10:00:00Z",
    };
    const accepted: TaskCompletionEvent = {
      ...state.taskCompletionEvents[0]!, id: "completion_accepted",
      outcome: "accepted", createdAt: "2026-09-01T11:30:00Z",
    };
    const decision: FounderDecision = {
      id: "pricing_choice", companyId: company.id, sourceTaskCompletionEventId: "completion_awaiting", taskId: task!.id,
      departmentId: "product", decisionKind: "pricing_model", rationale: "Choose the billing period",
      briefing: "Both plans tested well; the founder owns the call.",
      options: [{ label: "Flat", tradeoffs: "Simplest to sell", recommended: true }],
      status: "pending", resolvedOption: null, resolvedAt: null, blockedTaskIds: ["launch"],
      createdAt: "2026-09-01T10:00:00Z",
    };
    const resolution: FounderDecisionResolution = {
      founderDecisionId: decision.id, companyId: company.id, taskId: task!.id, status: "resolved",
      chosenOption: "Flat", returnReason: null, note: null, resolvedAt: "2026-09-01T11:00:00Z",
    };

    const items = projectCeoOfficeItems({
      ...state,
      taskCompletionEvents: [awaiting, accepted],
      founderDecisions: [decision],
      founderDecisionResolutions: [resolution],
    });

    expect(items.map((item) => item.type)).toEqual([
      "task_brief", "decision_request", "decision_resolution", "execution_report",
    ]);
    expect(items.filter((item) => item.type === "execution_report")).toMatchObject([
      { id: "execution_report:completion_accepted", occurredAt: "2026-09-01T11:30:00Z" },
    ]);
    expect(items.some((item) => item.type === "blocked_issue")).toBe(false);
  });

  it("derives CEO Pending from action-bearing CEO Office Items only", () => {
    const base = {
      companyId: company.id,
      sourceId: "source",
      taskId: "task",
      departmentId: "product",
      objectiveId: null,
      keyResultId: null,
      occurredAt: "2026-09-01T10:00:00Z",
      title: "Validate onboarding",
      titleText: null,
    };
    const items = [
      { ...base, id: "task_brief:task", type: "task_brief", actionBearing: false, data: {} },
      { ...base, id: "execution_report:event", type: "execution_report", actionBearing: false, data: {} },
      { ...base, id: "decision_request:decision", type: "decision_request", actionBearing: true, data: {} },
      { ...base, id: "human_action:action", type: "human_action", actionBearing: true, data: {} },
    ] as CEOOfficeItem[];

    expect(deriveCeoPendingItems(items).map((item) => item.id)).toEqual([
      "decision_request:decision",
      "human_action:action",
    ]);
  });
});
