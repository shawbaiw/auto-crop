import { aiSaasPlaybook } from "./aiSaas";
import type { Playbook } from "./types";

const aiSaasKeywords = [
  "ai saas",
  "saas",
  "software",
  "app",
  "tool",
  "developer",
  "shopify",
  "landing page",
  "pricing page",
  "prototype",
];

export function selectPlaybook(founderVision: string): Playbook {
  const normalized = founderVision.toLowerCase();

  if (aiSaasKeywords.some((keyword) => normalized.includes(keyword))) {
    return aiSaasPlaybook;
  }

  return aiSaasPlaybook;
}
