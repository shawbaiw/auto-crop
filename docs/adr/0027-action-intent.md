# A Delivery Declares What It Did, Instead Of Being Read For Risk Words

Status: accepted

## Context

Automatic Acceptance decided whether a delivery needed a founder by scanning the whole artifact payload against a list of risk phrases. The scan cannot tell the difference between describing a risk and taking one, and a report's most useful sentences are exactly the ones that describe risks: what was not done, what is missing, what comes next.

The company that started this work makes SEO tools. Every deliverable it produced mentioned Search Console — in `remaining_gap` ("未获得 Google Search Console 权限"), in `recommendation`, in validation limits. All of them were routed to manual CEO review, where the founder saw nothing that actually needed a decision. Replaying the rule with the words removed accepted the same reports automatically, including one whose verdict said verification had failed.

The failure runs both ways. Words are not actions: a report that had avoided the phrases could have deployed to production and been accepted without anyone being asked. And a keyword list grows an exception per phrase per language, which is the kind of rule this repository has repeatedly replaced with structure — capabilities (ADR 0021), output shape (ADR 0022), a verification verdict (ADR 0023).

## Decision

**A delivery declares its Action Intents.** `payload.actions` is a list of `{ category, status, description, target? }`:

- `category` is one of ten kinds that need a founder's eye: external publication, deployment, domain or DNS, search-engine submission, advertising or affiliate, payment or billing, credentials or access, personal data, legal or compliance, irreversible change.
- `status` is `performed` (this run did it), `requested` (the work is blocked until someone approves and performs it now), or `considered` (a later step, a limitation, or something deliberately not done).
- `[]` is a declaration, and the normal one: research, planning, writing and local implementation take no such action.

**Acceptance reads the declaration, not the prose.** A delivery that declares actions is accepted automatically unless something is `performed` or `requested`. `considered` never asks anyone for anything. The text is not scanned at all.

**A declaration the runtime cannot read is a contract violation**, like a malformed Execution Report: the artifact is invalid and the agent delivers again. Acceptance never falls back to guessing from prose because the structure was wrong.

**Artifacts written before the contract keep the old scan.** They declare nothing, and silence is not a claim that nothing was done, so their text remains all there is to read.

**Declaring is not being allowed.** An action still needs the capability its run was granted (ADR 0021) and the Founder Approval the policy requires before dispatch. The declaration decides who is asked about a delivery, not what an agent may do.

## Considered options

- **Exempt "Search Console" or scan fewer payload fields.** An exception per phrase, and the fields that mention risks are the ones worth reading.
- **Infer actions from the capability grant.** Runtime capabilities are `workspace_read`, `workspace_write`, `run_command`, `web_research` — too coarse to tell a deployment from a local build.
- **Require a declaration on every delivery, invalidating those without one.** Correct in principle, but it would invalidate every artifact captured before the contract; the compatibility path costs one legacy branch and no correctness.

## Consequences

- An SEO company's ordinary deliverables stop landing in CEO review for naming a service, in English or Chinese, while a delivery that says it deployed, submitted a sitemap, or connected an account still goes there.
- CEO review now shows what the delivery says it did, which is a better question than "these words appeared".
- Known limitations:
  - The declaration is the agent's own account. The runtime does not check it against what the run actually did; capabilities and pre-dispatch approval remain the enforcement.
  - An agent that omits `payload.actions` gets the old text scan, including its false positives, until the prompt's declaration is habitual.
  - Automatic Acceptance still applies only to ordinary tasks; a department subtask is an internal delivery and is not scanned at all (ADR 0024).
