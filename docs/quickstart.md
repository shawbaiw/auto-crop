# Quickstart

This guide is for running auto-crop from a source checkout.

## Requirements

- Node.js 24 or newer.
- pnpm 11 or newer.
- Optional: Claude Code and/or Codex installed on the same machine.
- Optional for browser E2E: a compatible Playwright Chromium install.

## Clone Setup

```bash
git clone <repo-url>
cd auto-crop
pnpm install
pnpm test
pnpm typecheck
```

The SQLite layer uses Node's built-in `node:sqlite` module. On Node 24 this prints an experimental warning during tests and local runs.

## Start The Local Runtime

From the project you want auto-crop to operate on:

```bash
AUTO_CROP_PORT=8787 pnpm --filter @auto-crop/cli start
```

The CLI creates `.auto-crop/state.sqlite`, starts the local API server, detects Claude Code and Codex adapters, and prints the local server URL.

Future package usage is intended to be:

```bash
npx auto-crop start
```

## Run The Dashboard

During development, run the dashboard separately and point it at the API server:

```bash
VITE_AUTO_CROP_API_URL=http://127.0.0.1:8787 pnpm --filter @auto-crop/dashboard dev
```

The dashboard also accepts an API URL query parameter:

```text
http://127.0.0.1:5173/?apiUrl=http%3A%2F%2F127.0.0.1%3A8787
```

## Expected UI Flow

1. Start the local runtime.
2. Open the dashboard.
3. Enter a company name.
4. Continue to agent detection and choose one detected CEO agent. Claude Code is the recommended first CEO Agent on this machine; Codex may require local permissions.
5. Enter a founder vision.
6. Choose Safe, Balanced, or Autonomous mode. Balanced is the default.
7. Click Create Company and wait on the CRT-styled creation loading page.
8. Land in the Department Workspace with CEO selected by default.
9. Use the left rail to inspect generated departments and their queued tasks.
10. Use the Work menu to open the operating dashboard for task, proof, review, and event views.
11. Use the kill switch if work must stop immediately.

## Troubleshooting

If the CEO selection step shows `Local API is not connected`, make sure the local runtime is still running and that `VITE_AUTO_CROP_API_URL` points at the API server URL printed by the CLI.

If company creation returns a CEO Agent timeout or blueprint error, retry with a smaller founder vision, confirm the selected local agent can run from the terminal, and consider increasing `AUTO_CROP_AGENT_TIMEOUT_MS` when starting the runtime.

## Supported Agents

Built-in adapters:

- Claude Code.
- Codex.
- Mock agent for tests.

Custom agents are represented by command templates with capability tags. Command templates can interpolate:

- `{workspace}`: the task workspace path.
- `{promptPath}`: the prompt file path.

The adapter interface exposes `id`, `name`, `capabilities`, `detect()`, and `run()`.

## Testing

Core test commands:

```bash
pnpm smoke:mock
pnpm test
pnpm typecheck
```

Optional real-agent smoke:

```bash
pnpm smoke:real-agent
```

The real-agent smoke requires a working local agent, defaults to Claude Code, and runs in an isolated temporary workspace. To try Codex:

```bash
AUTO_CROP_REAL_AGENT=codex pnpm smoke:real-agent
```

Dashboard commands:

```bash
pnpm --filter @auto-crop/dashboard test
pnpm --filter @auto-crop/dashboard typecheck
```

Browser E2E:

```bash
pnpm --filter @auto-crop/dashboard exec playwright install chromium
pnpm --filter @auto-crop/dashboard e2e
```

If you already have a compatible Chromium executable:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium pnpm --filter @auto-crop/dashboard e2e
```

On some restricted macOS environments, Playwright can fail before running tests with `bootstrap_check_in` permission errors. Use an unrestricted local environment or CI runner for E2E verification.
