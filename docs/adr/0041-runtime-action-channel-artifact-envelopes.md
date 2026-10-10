# Runtime Action Channel Submits Artifact Envelopes

Status: proposed

Auto-Crop will introduce a **Runtime Action Channel** for task delivery: an Agent Run submits an **Artifact Envelope** through a controlled runtime action, and the runtime validates and settles it into Proof, Business Artifacts, task outcome, Holds, and completion events. The channel is scoped to task-delivery facts in this decision; a future daemon or paired computer may use the same idea as a broader agent action surface, but daemon, pairing, wake streams, online/offline projection, and same-turn steering are not part of this slice.

This ADR supersedes the file-as-formal-interface part of ADR 0028 and the future-direction note in ADR 0040. ADR 0028 still describes the compatibility repair behavior for a deprecated file shim while that shim exists.

## Context

Today the task deliverable path is file-first. The task prompt tells the agent to write `.auto-crop/business-artifact.json`, proof capture looks at workspace files, and settlement later tries to turn those side effects into runtime facts. That made sense while the runtime had no agent action surface, but it keeps the formal delivery hidden inside a file convention. The runtime must distinguish no delivery, malformed delivery, a blocker, a decision request, a deliverable, and proof pointers after the process exits.

Cumora points at a better seam: the model's prose and stdout are observability, while actions that affect shared state go through a runtime-owned action surface. Auto-Crop should borrow that seam without borrowing Cumora's full daemon product shape.

## Decision

The official task-delivery entry point is a Runtime Action Channel action that submits one Artifact Envelope. The envelope is a candidate, not a Business Artifact. It may contain:

- artifact kind: `deliverable`, `blocker`, `decision_request`, `direction_change_request`, or `final_report`
- artifact role, subtype, task type, payload, and lineage
- Proof References, which are candidate evidence pointers the runtime may capture as Proof
- File References, which are workspace-relative candidate file pointers the runtime may snapshot and bind to the accepted artifact revision

The envelope must not be the authority for identity. It does not carry trusted `taskId`, `companyId`, or `runId`; those come from the current Agent Run context. The first production calling surface should be an MCP tool such as `submit_artifact_envelope`, with the tool running inside the adapter's run context and accepting only the envelope.

Calling the action records a run-local candidate. The official Business Artifact, Proof, task transition, Holds, completion event, dependency effects, and handoff snapshot are written only during settlement, under the existing one-writer settlement transaction. If a run submits multiple valid envelopes, the last valid candidate is the one settlement uses. Invalid action calls return structured errors so the agent can correct them in the same run; if the run ends without a valid envelope, settlement fails as an invalid or missing delivery rather than turning the syntax problem into a blocker.

The `.auto-crop/business-artifact.json` file protocol is removed, and ADR 0028's Artifact Syntax Repair with it: the envelope is the only delivery. An adapter without the `artifact_envelope` adapter contract capability is not dispatched task runs, because it could do the work but never deliver it. Both production adapters declare it: Claude Code when its CLI has `--mcp-config`, Codex always.

## Consequences

- Runtime delivery facts arrive through an explicit action instead of stdout, final prose, or a magic file path.
- Business Artifact keeps its current meaning: it is runtime-validated and settled state, not what the agent first submits.
- Proof remains runtime-recorded evidence. Agent-supplied proof pointers are Proof References until captured.
- Handoff versioning has a natural boundary: the runtime snapshots File References and Proof References during settlement and downstream tasks consume the accepted artifact revision.
- Prompt wording must be derived from the adapter's action surface. An adapter with `artifact_envelope` is told to call the action; a temporary non-action adapter may use the deprecated file shim only while migration is in progress.
- Action-call history is run-local diagnostic state, not product state. User-facing state comes from the final settlement outcome.
- The delivery contract — Outcome Summary, Execution Report, Founder Decisions — is checked when the agent submits, by the same function settlement uses, so a breach is something the agent hears about and corrects inside its run. A run whose every call was rejected settles as an invalid delivery carrying the last rejection's errors, not as a missing one.
- A run that does not complete keeps its last valid candidate, and Proof recovery recaptures it, as it used to recapture a file left in the workspace. Dispatching a new run discards earlier runs' candidates, so a task holds at most one candidate: its latest run's.
- Each CLI is told about the action server in its own shape. Claude Code takes an `--mcp-config` file and needs the tool pre-approved in `--allowedTools`, or `--permission-prompts none` denies the delivery itself. Codex takes `-c mcp_servers.*` overrides, since `--ignore-user-config` leaves it no config file, plus `default_tools_approval_mode="approve"`, since `codex exec` cancels any MCP call that would ask. The server is launched with an absolute tsx loader URL, because the CLI starts it in the task workspace.
- The tool's `inputSchema` types every field. With an empty schema, Claude Code sent `payload` as a JSON string, and the delivery never landed.
- Which Proof Reference types a run may submit is the task's Proof Schema, stated once per run and used by the tool schema, the prompt, the submit check and settlement. The first real e2e run cited the web pages it read as `url` refs on a `product-brief` task; the tool advertised every type, the prompt said nothing, the submit said `ok`, and settlement blocked the delivery with eight tasks behind it. Sources an agent read belong in the payload.

## Relationship To Existing Decisions

ADR 0022 remains the rule for runtime-parsed replies: if the runtime parses an adapter reply, that reply needs a Structured Output Contract. Artifact Envelopes are different. They are submitted through a runtime action, not parsed from final prose or stdout.

ADR 0028 is superseded. Its Artifact Syntax Repair existed for a file that might not parse; an envelope is parsed when it is submitted and the agent is told the errors in the same run, so there is nothing left to repair after the fact.

ADR 0035 remains unchanged and becomes more important here: the action may record a run-local candidate, but the official Business Artifact, Proof, Holds, transitions, completion event and handoff snapshot are written only by the settlement transaction.

ADR 0040 deferred a Cumora-style runtime action channel because its slice was execution-brief degradation. This ADR takes up that deferred direction for task delivery only. It does not change ADR 0040's execution-brief degradation behavior.

## Considered Options

- **Keep the file protocol as the official interface.** This avoids new adapter work, but preserves a weak seam where task completion depends on a workspace convention the runtime interprets after the fact.
- **Make the agent submit Business Artifacts directly.** This collapses candidate output and runtime-validated state, contradicting the glossary and making downstream consumption trust the agent's framing.
- **Split the surface into many first-class commands such as `report_blocker`, `request_decision`, and `declare_proof_pointer`.** This may be useful as helper syntax later, but the durable concept is one Artifact Envelope whose kind determines routing.
- **Build a Cumora-style daemon first.** A daemon may eventually be valuable for paired computers, wake streams, long-lived agent homes, session recovery, rate-limit pacing, and same-turn steering. It is larger than the current handoff problem, and it should call the Runtime Action Channel rather than define task-delivery semantics itself.
