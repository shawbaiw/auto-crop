import type { BusinessArtifact, Task } from "@auto-crop/core";
import { isReviewableBusinessArtifact } from "./businessArtifact";

export type AutomaticAcceptanceDecision =
  | { kind: "accept" }
  | { kind: "requires_review"; reason: string };

/**
 * External-or-sensitive risk patterns. A hit routes a deliverable to manual CEO
 * review and is, since ADR 0017, the only remaining path into that queue.
 *
 * These are a safety net, not the primary acceptance rule: Business Artifact
 * validation is the semantic gate. The patterns are deliberately precise
 * phrases describing an external or sensitive *action* — not broad single words
 * — so ordinary product-brief and research-report language ("launch copy",
 * "pricing model that charges $29/mo", "customers subscribe to the paid plan",
 * "spend three weeks building", "legal and compliance: none") does not trip
 * them. Task `riskLevel` is NOT consulted here or anywhere in the acceptance
 * path — the CEO Agent's risk labelling was found unreliable (ADR 0017); do not
 * re-add a risk-level check.
 */
const FORBIDDEN_RISK_PATTERNS: readonly RegExp[] = [
  // Public launch / release to the world
  /\bpublic launch\b/i,
  /\blaunch(es|ed|ing)?\b[^.\n]{0,40}\bpublicly\b/i,
  /\bpublicly\b[^.\n]{0,20}\blaunch/i,
  /\brelease(s|d|ing)?\b[^.\n]{0,20}\b(publicly|to the public|to the world)\b/i,
  /\bgo(es|ing)? live\b/i,
  /\bmake(s|ing)?\b[^.\n]{0,25}\b(the |our |this )?(site|website|web ?app|app|page|landing page|repo|repository|product|project)\b[^.\n]{0,15}\b(publicly available|live|public)\b/i,

  // Deployment to production
  /\bto production\b/i,
  /\bproduction (deploy|deployment|environment|server|infrastructure|database|release|rollout)\b/i,
  /\bdeploy(s|ed|ing|ment)?\b[^.\n]{0,30}\bprod\b/i,

  // Custom / production domains, DNS
  /\bcustom domain\b/i,
  /\bproduction domain\b/i,
  /\b(register|registering|purchase|purchasing|buy|buying|configure|configuring|set up|setting up)\b[^.\n]{0,20}\bdomain\b/i,
  /\bDNS (record|records|configuration|settings|zone)\b/i,

  // Search Console / sitemap submission
  /\bsearch console\b/i,
  /\bsubmit(s|ted|ting)?\b[^.\n]{0,30}\bsitemap\b/i,
  /\bsitemap\b[^.\n]{0,20}\bsubmit/i,
  /\bsubmit(s|ted|ting)?\b[^.\n]{0,40}\bto (google|bing)\b/i,

  // Connecting ad or affiliate accounts
  /\b(ad|ads|advertising|adwords|adsense) account\b/i,
  /\bconnect(s|ed|ing)?\b[^.\n]{0,30}\b(ad|ads|advertising|affiliate)\b/i,
  /\baffiliate (account|program|network|link|links)\b/i,
  /\b(run|running|launch|launching|start|starting|set up|setting up)\b[^.\n]{0,20}\bad(s| campaign| campaigns)\b/i,

  // Spending / billing / paid subscriptions — taking a paid action, not describing a pricing model
  /\bset(s|ting)? up (billing|a paid subscription|a paid account)\b/i,
  /\bbilling (account|details|information|info|address)\b/i,
  /\b(enter|entering|add|adding|provide|providing)\b[^.\n]{0,25}\b(payment|credit card|card) (details|information|info|method|number)\b/i,
  /\bpayment method\b/i,
  /\b(make|making|process|processing|submit|submitting)\b[^.\n]{0,15}\b(a |the )?payment\b/i,
  /\b(purchase|purchasing|pay for|paying for)\b[^.\n]{0,20}\b(a |an |the |the annual )?(subscription|license|licence|seat|seats|paid plan)\b/i,
  /\bspend(s|ing)?\b[^.\n]{0,15}(\$|€|£|\bUSD\b|\bEUR\b|\bGBP\b)/i,
  /\bcharge(s|d|ing)?\b[^.\n]{0,15}\b(the |a |our |your |their |a customer's )?(card|credit card|payment method)\b/i,

  // Legal or compliance exposure
  /\blegal (review|counsel|advice|liability|exposure|risk|agreement|contract|obligation)\b/i,
  /\bcompliance (review|requirement|requirements|obligation|obligations|risk|issue|gap|exposure)\b/i,
  /\b(terms of service|privacy policy|data processing agreement)\b/i,
  /\b(GDPR|CCPA|HIPAA|SOC ?2)\b/,

  // User or personal data exposure
  /\b(collect|collecting|store|storing|process|processing|expose|exposing|exposed|share|sharing|sell|selling|leak|leaked|transfer|transferring)\b[^.\n]{0,25}\b(user|customer|personal|end-user) data\b/i,
  /\b(personally identifiable information|personal data breach|data breach)\b/i,
  /\bPII\b/,

  // Credentials / API keys / secrets
  /\bapi keys?\b/i,
  /\baccess tokens?\b/i,
  /\b(secret|private|signing) keys?\b/i,
  /\bclient secret\b/i,
  /\bservice account key\b/i,
  /\bcredentials?\b/i,
  /\bpasswords?\b/i,
  /\b\.env\b/i,

  // Account permissions or OAuth grants
  /\boauth\b/i,
  /\b(grant|granting|request|requesting|escalate|escalating)\b[^.\n]{0,25}\b(access|permission|permissions|scope|scopes|privileges)\b/i,
  /\baccount permissions?\b/i,
  /\b(admin|administrator|root|superuser) (access|rights|privileges|role)\b/i,
  /\b(create|creating|register|registering|sign up for|signing up for|set up|setting up)\b[^.\n]{0,25}\b(account|api key|integration)\b[^.\n]{0,25}\b(with|on|for)\b/i,

  // Irreversible external actions
  /\birreversible\b/i,
  /\b(cannot|can't|can not) be undone\b/i,
  /\bpermanently (delete|deleted|deleting|remove|removed|removing)\b/i,
  /\b(send|sending|blast|blasting|email|emailing)\b[^.\n]{0,25}\b(to )?(all |our |the )?(users|customers|subscribers|mailing list|email list|contacts)\b/i,
  /\bpublish(es|ed|ing)?\b[^.\n]{0,25}\b(app store|play store|npm|pypi|marketplace|chrome web store)\b/i,
] as const;

export function evaluateAutomaticAcceptance(input: {
  artifact: BusinessArtifact | null;
  task: Task;
}): AutomaticAcceptanceDecision {
  if (!input.artifact || !isReviewableBusinessArtifact(input.artifact)) {
    return { kind: "requires_review", reason: "artifact_not_reviewable" };
  }

  const riskText = [
    input.task.title,
    input.task.description,
    input.task.proofSchemaId,
    input.artifact.artifactKind,
    input.artifact.artifactRole,
    input.artifact.artifactSubtype,
    input.artifact.artifactType,
    input.artifact.taskType,
    JSON.stringify(input.artifact.payload),
  ].join("\n");

  if (FORBIDDEN_RISK_PATTERNS.some((pattern) => pattern.test(riskText))) {
    return { kind: "requires_review", reason: "external_or_sensitive_risk" };
  }

  return { kind: "accept" };
}
