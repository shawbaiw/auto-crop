# Optional Persistent Agent Sessions

Auto-Crop will design Persistent Agent Sessions as an experimental, opt-in execution capability for planning and coordination work, while keeping One-shot Agent Runs as the default task execution model. Sessions are for context continuity only: Session Memory is not Proof, Consumable Proof, a Task Deliverable, or a Handoff Package, and the existing Proof gate, Effective Timeout rules, bounded recovery, and dependency handoff contracts remain authoritative.

## Considered Options

- **Keep one-shot only:** simplest and safest, but planning agents must repeatedly rebuild context even after the runtime has made failures, dependencies, handoffs, and company state durable.
- **Make persistent sessions the default:** improves continuity, but it risks hidden context becoming an implicit deliverable and would make task outcomes harder to audit.
- **Adopt a Cumora-style BYOA daemon:** powerful for always-on team chat agents, but it is a different product shape from Auto-Crop's local project runtime and would introduce device pairing, wake streams, daemon supervision, and external orchestration concepts before they are needed.
- **Add optional session capability:** preserves one-shot correctness while allowing selected planning paths to reuse context when a supported adapter can do so safely.

## Consequences

Adapter support should be optional, with one-shot fallback when session probing, session creation, or pre-run session setup fails. Session keys should include `companyId`, `agentId`, and `permissionMode`; one session should run only one Agent Run at a time. The first implementation should not bind to real Claude Code or Codex session flags until adapter probes and smoke tests prove the persistent path is available and does not regress Proof or Handoff behavior.
