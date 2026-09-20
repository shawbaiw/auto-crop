# Serving Locally Is A Capability, Not A Side Effect Of The Shell

Status: accepted

## Context

A department's Validate stage was asked to check two requirements of a served prototype: that `localhost` returns the home page, and that `robots.txt` and `sitemap.xml` are served. It did the work honestly and reported both as `not_run`:

```
python3 -m http.server 4187 -b 127.0.0.1 → PermissionError: [Errno 1] Operation not permitted
```

Codex's `workspace-write` sandbox denies every socket, including a loopback bind, unless `sandbox_workspace_write.network_access` is on. The verdict was `inconclusive`, the verification escalated, and the company stopped — on a requirement the plan was right to state and the runtime had made impossible to satisfy.

Probing both CLIs directly (a static file, a local server, one `curl`):

| Launch | Result |
| --- | --- |
| Codex, `--sandbox workspace-write` | `Operation not permitted`, `HTTP:000` |
| Codex, `-c sandbox_workspace_write.network_access=true` | `HTTP:200` |
| Claude Code, `--restricted` with `Bash` | `HTTP:200`, no extra flag |

So the same grant meant different things on the two CLIs: a `run_command` grant already carried local networking on Claude Code and never carried it on Codex. ADR 0021's claim — the prompt tells a run exactly what it holds — was true of the list and false of the launch.

## Decision

**`local_network` joins the Runtime Capabilities**: serve and reach `127.0.0.1` from inside this run.

- **Needed by the deliverables that require a listener**: `local-url` and `screenshot` proof schemas, which also imply `run_command`. Other tasks do not ask for it, so a research or brief run cannot open a socket.
- **Gated by `run_safe_command`**, not `read_public_web`. Binding a loopback port is a local command; gating it with the web would let an `autonomous` company's web decision settle whether a prototype may be served.
- **Codex translates it** to `-c sandbox_workspace_write.network_access=<granted>` — passed either way, so the launch states the decision rather than relying on a default.
- **Claude Code cannot express it.** Its `Bash` tool binds a local port and no flag withholds that. The capability grants nothing there and withholding it is not enforced; the grant list the prompt shows remains truthful about intent, and this asymmetry is recorded rather than hidden.

## Considered options

- **Keep the sandbox closed and let plans avoid such requirements.** The requirement is the right one — a prototype nobody can load is not validated — and "do not ask for what the sandbox denies" is a rule no planner can follow reliably.
- **Open Codex's network for every workspace-write run.** Gives web access to runs that were never granted the web, since the config is not loopback-only.
- **Have the runtime serve the workspace itself.** ADR 0016 already declined runtime-managed dev servers, and nothing here reverses that.

## Consequences

- A task whose deliverable is a local URL or a screenshot can actually produce it on either CLI, and a verifier of a served page can run its checks instead of reporting `not_run`.
- Codex's network config is now an explicit part of every launch, so a future default change cannot silently alter what a run may reach.
- Known limitation: `network_access` is not loopback-scoped, so a Codex run holding `local_network` can also reach the public web. It is granted only to tasks that must serve, and `tools.web_search` stays off for them, but the sandbox does not enforce the narrower rule.
- Known limitation: Claude Code cannot withhold local networking from a run that holds the shell. Withholding `local_network` narrows Codex only.
