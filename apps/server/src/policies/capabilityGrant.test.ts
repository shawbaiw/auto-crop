import { describe, expect, it } from "vitest";
import {
  grantNeedsFounderApproval,
  planningCapabilityNeeds,
  resolveAgentCapabilityGrant,
  resolveTaskCapabilityNeeds,
} from "./capabilityGrant";
import { autonomousPolicy, balancedPolicy, safePolicy } from "./defaults";
import type { ActionPolicy } from "./policy";

const task = (proofSchemaId: string, requiredCapabilities: string[]) => ({
  proofSchemaId,
  requiredCapabilities,
});

describe("resolveTaskCapabilityNeeds", () => {
  /**
   * The reported failure, pinned at the seam that decides it. A research task that cannot search the
   * web narrates the denial as a sandbox and delivers estimates (ADR 0021).
   */
  it("gives a research task the web", () => {
    expect(resolveTaskCapabilityNeeds(task("research-report", ["research", "writing"]))).toEqual([
      "workspace_read",
      "workspace_write",
      "web_research",
    ]);
  });

  it("reads the declared capability and the proof schema independently", () => {
    // A planner that names the work but forgets the capability still gets a usable grant…
    expect(resolveTaskCapabilityNeeds(task("research-report", ["writing"]))).toContain("web_research");
    // …and so does one that declares the capability under another deliverable shape.
    expect(resolveTaskCapabilityNeeds(task("product-brief", ["writing", "research"]))).toContain("web_research");
  });

  it("does not hand the web to a brief that never asked for it", () => {
    expect(resolveTaskCapabilityNeeds(task("product-brief", ["writing"]))).toEqual([
      "workspace_read",
      "workspace_write",
    ]);
  });

  it("gives engineering work the shell and nothing more", () => {
    expect(resolveTaskCapabilityNeeds(task("landing-page-file", ["code", "frontend"]))).toEqual([
      "workspace_read",
      "workspace_write",
      "run_command",
    ]);
  });

  it("never grants a capability the task did not need, whatever the mode allows", () => {
    const grant = resolveAgentCapabilityGrant({
      needs: resolveTaskCapabilityNeeds(task("research-report", ["research"])),
      policy: autonomousPolicy,
    });

    expect(grant.granted).not.toContain("run_command");
  });
});

describe("resolveAgentCapabilityGrant", () => {
  it("keeps an `ask` capability, because the scheduler collects that consent before dispatch", () => {
    const grant = resolveAgentCapabilityGrant({
      needs: resolveTaskCapabilityNeeds(task("research-report", ["research"])),
      policy: safePolicy,
    });

    expect(grant.granted).toContain("web_research");
    expect(grant.withheld).toEqual([]);
  });

  it("withholds a denied capability and names it, so the agent can report it missing", () => {
    const noWebPolicy: ActionPolicy = {
      ...balancedPolicy,
      decisions: { ...balancedPolicy.decisions, read_public_web: "deny" },
    };

    const grant = resolveAgentCapabilityGrant({
      needs: resolveTaskCapabilityNeeds(task("research-report", ["research"])),
      policy: noWebPolicy,
    });

    expect(grant.granted).toEqual(["workspace_read", "workspace_write"]);
    expect(grant.withheld).toEqual(["web_research"]);
  });

  it("gives the same granted set the same id, and different sets different ids", () => {
    const research = resolveAgentCapabilityGrant({ needs: planningCapabilityNeeds, policy: balancedPolicy });
    const engineering = resolveAgentCapabilityGrant({
      needs: resolveTaskCapabilityNeeds(task("repo-diff", ["code"])),
      policy: balancedPolicy,
    });

    expect(research.id).toBe(
      resolveAgentCapabilityGrant({ needs: planningCapabilityNeeds, policy: autonomousPolicy }).id,
    );
    expect(research.id).not.toBe(engineering.id);
  });
});

describe("grantNeedsFounderApproval", () => {
  it("asks in safe mode and not in balanced or autonomous", () => {
    const needs = resolveTaskCapabilityNeeds(task("research-report", ["research"]));

    expect(grantNeedsFounderApproval({ needs, policy: safePolicy })).toBe(true);
    expect(grantNeedsFounderApproval({ needs, policy: balancedPolicy })).toBe(false);
    expect(grantNeedsFounderApproval({ needs, policy: autonomousPolicy })).toBe(false);
  });
});
