import { describe, expect, it } from "vitest";
import { inlineAffordanceControls, taskAffordanceControls } from "./affordanceControls";
import { englishTranslations } from "../language/translations";
import type { TaskAffordanceKind } from "../../api/client";

/**
 * The kinds the server can emit. Kept as a literal rather than imported from `@auto-crop/core` on
 * purpose: this is the dashboard asserting it can render everything the API contract allows, so the
 * list has to be stated independently of the module that produces it. A kind added server-side
 * shows up here as a failure, which is the point.
 */
const serverAffordanceKinds: TaskAffordanceKind[] = [
  "ceo_review_decision",
  "decide_founder_approval",
  "confirm_human_action",
  "resolve_founder_decision",
  "refresh_task",
  "recover_task",
  "request_replan",
  "confirm_replan",
  "cancel_task",
];

describe("taskAffordanceControls", () => {
  /**
   * The dashboard's half of the contract. The server guarantees every Task Hold offers a real way
   * forward and that a route performs it; this guarantees the founder can reach it. Both halves had
   * failed: the board kept its own eligibility rules and drew nothing for a task at the Bounded
   * Recovery ceiling, whose only way forward was to replan (ADR 0020).
   */
  it("says where every affordance the server can offer is rendered", () => {
    for (const kind of serverAffordanceKinds) {
      expect(taskAffordanceControls[kind], `${kind} has no declared surface`).toBeDefined();
    }
    expect(Object.keys(taskAffordanceControls).sort()).toEqual([...serverAffordanceKinds].sort());
  });

  it("gives every inline button a real label", () => {
    for (const [kind, control] of Object.entries(taskAffordanceControls)) {
      if (control.render !== "inline") {
        continue;
      }
      expect(control.buttons.length, `${kind} renders inline with no buttons`).toBeGreaterThan(0);
      for (const button of control.buttons) {
        expect(englishTranslations[button.labelKey], `${kind} button has no translation`).toBeTruthy();
      }
    }
  });

  /**
   * `unsurfaced` is a real answer, but it has to be argued for. An affordance that nothing renders
   * because nobody thought about it is how the replan gap survived; one that nothing renders because
   * someone wrote down why is a decision.
   */
  it("makes an unrendered affordance state its reason", () => {
    for (const [kind, control] of Object.entries(taskAffordanceControls)) {
      if (control.render === "unsurfaced") {
        expect(control.reason.length, `${kind} is unsurfaced with no reason`).toBeGreaterThan(40);
      }
      if (control.render === "surface") {
        expect(control.surface.length, `${kind} names no surface`).toBeGreaterThan(0);
      }
    }
  });

  it("draws inline controls in the order the server offered them, ignoring the rest", () => {
    const controls = inlineAffordanceControls([
      { kind: "ceo_review_decision", subjectId: "artifact_1" },
      { kind: "request_replan", subjectId: null },
      { kind: "refresh_task", subjectId: null },
      { kind: "cancel_task", subjectId: null },
    ]);

    expect(controls.map((control) => control.kind)).toEqual(["request_replan", "refresh_task"]);
  });

  it("carries the subject an affordance acts on through to the control", () => {
    const controls = inlineAffordanceControls([
      { kind: "decide_founder_approval", subjectId: "approval_1" },
    ]);

    expect(controls[0]).toMatchObject({ handler: "founderApproval", subjectId: "approval_1" });
    expect(controls[0]!.buttons.map((button) => button.decision)).toEqual(["approved", "denied"]);
  });
});
