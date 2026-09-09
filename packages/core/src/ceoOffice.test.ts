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
  return { company, tasks: [task], taskProgressEvents: [progress], taskCompletionEvents: [completion] };
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
      { id: "task_brief:task", type: "task_brief", title, occurredAt: "2026-09-01T09:00:00Z", actionBearing: false },
      { id: "execution_report:completion", type: "execution_report", title,
        occurredAt: "2026-09-01T10:00:00Z", actionBearing: false,
        data: { conclusion: null, summaryFallback: { en: conclusion, zh: "业务结论" } } },
    ]);
    expect(items).toHaveLength(2);
    expect(items.filter((item) => item.actionBearing)).toEqual([]);
    expect(JSON.stringify(items)).not.toContain("/private/workspace");
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
      "task_brief:earlier", "execution_report:early", "task_brief:task", "execution_report:a", "execution_report:z",
    ]);
    expect(projectCeoOfficeItems({
      ...input, tasks: [...input.tasks].reverse(), taskCompletionEvents: [...input.taskCompletionEvents].reverse(),
    })).toEqual(projected);
    expect(input).toEqual(before);
  });

  it("omits unstarted work and uses completion facts when older tasks have no progress history", () => {
    const state = scenario("Plan a launch", "Invite pilot customers");
    expect(projectCeoOfficeItems({ ...state, taskProgressEvents: [], taskCompletionEvents: [] })).toEqual([]);
    expect(projectCeoOfficeItems({ ...state, taskProgressEvents: [] })).toMatchObject([
      { type: "task_brief", occurredAt: "2026-09-01T10:00:00Z" },
      { type: "execution_report", occurredAt: "2026-09-01T10:00:00Z" },
    ]);
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

  it("builds Task Briefs from assessment, objective, key-result, dependency, and task definition facts", () => {
    const objective: Objective = {
      id: "objective_growth", companyId: company.id, title: "Reach founder-market fit", status: "active", priority: 1,
    };
    const keyResult: KeyResult = {
      id: "kr_pipeline", objectiveId: objective.id, title: "Qualify 20 buyer conversations",
      metricName: "qualified conversations", targetValue: "20", currentValue: "6", status: "active",
    };
    const state = scenario("Interview pilot buyers", "Three segments are ready for outreach");
    const assessment: TaskProgressEvent = {
      id: "assessment", companyId: company.id, departmentId: "product", parentTaskId: "task",
      subjectTaskId: "task", step: "assessment_complete", status: "complete",
      label: "Assessment complete", labelText: { en: "Buyer interview plan confirmed" },
      detail: "Original task fallback should not win",
      detailText: { en: "Validate whether clinic operators have urgent scheduling pain." },
      createdAt: "2026-09-01T08:45:00Z",
    };

    const items = projectCeoOfficeItems({
      ...state,
      tasks: [{ ...state.tasks[0]!, keyResultId: keyResult.id, description: "Original CEO assignment" }],
      taskProgressEvents: [state.taskProgressEvents[0]!, assessment],
      taskDependencies: [
        { taskId: "task", dependsOnTaskId: "dependency_b" },
        { taskId: "task", dependsOnTaskId: "dependency_a" },
        { taskId: "task", dependsOnTaskId: "dependency_a" },
      ],
      objectives: [objective],
      keyResults: [keyResult],
    });

    expect(items.find((item) => item.type === "task_brief")).toMatchObject({
      occurredAt: "2026-09-01T08:45:00Z",
      objectiveId: objective.id,
      keyResultId: keyResult.id,
      data: {
        purpose: { en: "Validate whether clinic operators have urgent scheduling pain." },
        purposeSource: "department_assessment",
        founderVision: company.founderVision,
        objectiveTitle: { en: "Reach founder-market fit" },
        keyResultTitle: { en: "Qualify 20 buyer conversations" },
        keyResultMetricName: "qualified conversations",
        keyResultTargetValue: { en: "20" },
        dependsOnTaskIds: ["dependency_a", "dependency_b"],
      },
    });
    expect(JSON.stringify(items)).not.toContain("assessment_complete");
    expect(JSON.stringify(items)).not.toContain("received");
  });

  it("falls Task Brief purpose back to the task definition when assessment detail is unavailable", () => {
    const state = scenario("Plan a launch", "Launch plan is ready");
    const [task] = state.tasks;

    expect(projectCeoOfficeItems({
      ...state,
      tasks: [{ ...task!, description: "Define channel, audience, and launch proof." }],
      taskProgressEvents: [{
        ...state.taskProgressEvents[0]!,
        step: "assessment_complete",
        label: "Assessment complete",
        detail: null,
      }],
    }).find((item) => item.type === "task_brief")).toMatchObject({
      data: {
        purpose: { en: "Define channel, audience, and launch proof." },
        purposeSource: "task_definition",
      },
    });
  });

  it("does not rewrite a pre-execution Task Brief from an assessment recorded after execution", () => {
    const state = scenario("Plan a launch", "Launch plan is ready");
    const [task] = state.tasks;

    expect(projectCeoOfficeItems({
      ...state,
      tasks: [{ ...task!, description: "Define channel, audience, and launch proof." }],
      taskProgressEvents: [
        ...state.taskProgressEvents,
        {
          id: "executing",
          companyId: company.id,
          departmentId: "product",
          parentTaskId: "task",
          subjectTaskId: "task",
          step: "executing",
          status: "complete",
          label: "Executing",
          detail: null,
          createdAt: "2026-09-01T09:30:00Z",
        },
        {
          id: "late_assessment",
          companyId: company.id,
          departmentId: "product",
          parentTaskId: "task",
          subjectTaskId: "task",
          step: "assessment_complete",
          status: "complete",
          label: "Assessment complete",
          detailText: { en: "Late assessment should not rewrite the brief." },
          detail: "Late assessment should not rewrite the brief.",
          createdAt: "2026-09-01T09:45:00Z",
        },
      ],
    }).find((item) => item.type === "task_brief")).toMatchObject({
      data: {
        purpose: { en: "Define channel, audience, and launch proof." },
        purposeSource: "task_definition",
      },
    });
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
      taskEvents: [blockedEvent],
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
      data: { reason: "Search indexing has to settle before validation.", status: "waiting" },
    });
    expect(items.find((item) => item.type === "blocked_issue")).toMatchObject({
      taskId: "blocked_task",
      data: { reason: "Expected deliverable was not recorded.", status: "open", affectedTaskIds: ["blocked_task"] },
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
        taskEvents: [blockedEvent],
      })).toContainEqual(expect.objectContaining({
        type: "blocked_issue",
        actionBearing: true,
        data: expect.objectContaining({ status: "open", reason: "The task cannot move forward." }),
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
        data: { status: "open", reason: "The work could not be accepted" },
      });
    },
  );

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
