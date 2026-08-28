# Context Map

This repo uses multi-context domain docs. Start here, then read the context file for the area you are changing. If a referenced context file does not exist yet, proceed with the closest available context and create or update domain docs only when a domain-modeling task calls for it.

## Contexts

| Area | Context doc | Scope |
| ---- | ----------- | ----- |
| System-wide | `CONTEXT.md` | Cross-cutting product vocabulary, architecture terms, and repository-level decisions. |
| Core package | `packages/core/CONTEXT.md` | Shared schemas, domain types, and contracts used across apps. |
| Server app | `apps/server/CONTEXT.md` | API routes, persistence, runtime scheduling, artifact workflows, and server-side orchestration. |
| CLI app | `apps/cli/CONTEXT.md` | Command-line workflows and local operator-facing behavior. |
| Dashboard app | `apps/dashboard/CONTEXT.md` | Browser UI workflows, API client usage, and user-facing state presentation. |

## ADRs

- System-wide ADRs live in `docs/adr/`.
- Context-specific ADRs may live in `<context>/docs/adr/` when needed.
