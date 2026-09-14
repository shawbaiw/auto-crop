# Context Map

This repo uses multi-context domain docs. Start here, then read the context file for the area you are changing. If a referenced context file does not exist yet, proceed with the closest available context and create or update domain docs only when a domain-modeling task calls for it.

## Contexts

| Area | Context doc | Written? | Scope |
| ---- | ----------- | -------- | ----- |
| System-wide | `CONTEXT.md` | yes | Cross-cutting product vocabulary, architecture terms, and repository-level decisions. |
| Server app | `apps/server/CONTEXT.md` | yes | API routes, persistence, runtime scheduling, artifact workflows, and server-side orchestration. |
| Dashboard app | `apps/dashboard/CONTEXT.md` | yes | Browser UI workflows, API client usage, and user-facing state presentation. |
| Core package | `packages/core/CONTEXT.md` | not yet | Shared schemas, domain types, and contracts used across apps. |
| CLI app | `apps/cli/CONTEXT.md` | not yet | Command-line workflows and local operator-facing behavior. |

The `not yet` rows are planned scopes, not existing files. Write one when a change in that area needs rules that do not belong in the system-wide glossary — the way `apps/server/CONTEXT.md` holds the task state machine rules that only apply to the runtime.

## ADRs

- System-wide ADRs live in `docs/adr/`.
- Context-specific ADRs may live in `<context>/docs/adr/` when needed.
