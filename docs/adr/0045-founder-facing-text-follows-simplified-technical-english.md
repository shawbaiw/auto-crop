# Founder-Facing Text Follows Simplified Technical English

Status: proposed

All text the founder reads must be clear, exact and short, and must not use invented terms. This applies to agent-authored text, to text the runtime writes from templates, and to dashboard copy. We follow the ideas of ASD-STE100: one topic per sentence, short sentences, active voice, common words, specific facts and numbers, and no internal terms.

## Context

Founders read messages such as `Task blocked: … / missing_business_artifact / blocker/none/missing_artifact_envelope`. Even a translated summary such as "blocked: missing business artifact" invents a term that the founder does not know. Agent reports were asked to be "concise" and to use "plain business language", but no prompt said what that means. The examples, which steer agent output more than rules do, did not show it.

## Decision

- **Shared Founder Writing Rules.** `localePromptText.ts` holds the rules in English and in Chinese. Every prompt that authors founder-facing prose uses them:
  - the CEO blueprint prompt;
  - the Execution Brief prompt;
  - the task execution prompt (Execution Report fields and Open Decisions);
  - the replan planner;
  - the Final Founder Report prompt.

  STE is an English standard, so the Chinese rules state the same ideas for Chinese.
- **Examples are rewritten to follow the rules.** Each prompt's per-locale examples are the main lever and must show the style, not only describe it.
- **Runtime templates are rewritten.** Text the server writes itself, such as block and failure messages and progress labels, says what happened in plain words. Codes such as `missing_business_artifact` stay in structured fields for diagnosis and never form the sentence.
- **One user term list.** Internal terms (Business Artifact, Hold, Affordance, Envelope, Wait State, …) map to fixed founder words in dashboard ADR 0002. Text that has no fitting word describes the thing concretely, for example "the agent did not submit the required file".
- **Verification.** Style cannot be unit-tested. The change is accepted after real agent trial runs, comparing output before and after.

## Consequences

This work is independent of the dashboard migration and can land at any point. The dashboard still collapses raw codes under Details, because agent text written before this change, and diagnostic fields, remain.
