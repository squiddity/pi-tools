# Herdr panes for long-running jobs

Herdr panes are real terminal processes managed by the Herdr server. A pane keeps running across client detach/reattach, so it is a good place for servers, file watchers, integration tests, tailing logs, or any command that should remain visible while the main agent continues working.

## Detect whether you are in Herdr

Inside a Herdr-managed pane, these environment variables are usually available:

```bash
env | grep '^HERDR_'
```

Important variables:

- `HERDR_ENV=1` — the process is running inside Herdr.
- `HERDR_PANE_ID` — current pane id, for example `wB:p1`.
- `HERDR_TAB_ID` — current tab id.
- `HERDR_WORKSPACE_ID` — current workspace id.

## Opinionated Herdr defaults for agents

- Prefer a new tab for a long-running job. It keeps the primary agent pane uncluttered while preserving a full-sized, visible terminal for the job.
- Use a lower or right-side split only when watching the job alongside the primary agent is more valuable than a full-sized terminal.
- Use `--no-focus` when opening a job pane from an agent so the agent does not accidentally type into the new shell.
- Use `--cwd "$PWD"` so the pane starts in the same project directory as the agent.
- Rename panes immediately (`server`, `tests`, `logs`, `watch`) so the Herdr sidebar stays useful.
- Use `herdr pane ...` for ordinary terminals and long-running jobs; use `herdr agent start ...` only for another coding agent.
- Use a separate Herdr workspace per repo/task. Use tabs for major views such as `agents`, `server`, `logs`, or `review` only when a single tab is getting crowded.
- For isolated implementation work, prefer Herdr worktrees or another explicit worktree flow rather than multiple writers in one checkout.
- Install/check the Pi integration (`herdr integration install pi`, `herdr integration status`) when managing Pi agents so Herdr gets better agent state/session signals.

## Async jobs from Pi

When the `herdr-jobs` Pi extension is loaded, use its `herdr_job_start` tool for ordinary long-running commands. It creates a new tab by default (or an explicitly requested split), persists a durable merged log and result sidecar, returns control to Pi immediately, and delivers one readiness/completion steer message automatically.

```ts
herdr_job_start({
  name: "tests",
  command: "npm test",
  kind: "finite"
})

herdr_job_start({
  name: "dev server",
  command: "npm run dev",
  kind: "service",
  readyPattern: "Local:"
})

herdr_job_start({
  name: "integration",
  command: "npm run test:integration",
  kind: "finite",
  cleanup: "never"
})
```

`cleanup` controls the terminal pane: `"on_success"` (the default) closes a successful job and retains failures, `"always"` closes either outcome, and `"never"` retains either outcome. The deprecated `keepPane` alias remains supported for old calls (`true` maps to `"never"`; `false` maps to `"always"`), but cannot be combined with `cleanup`.

After starting an async job, do **not** poll it with `bash`, `herdr wait`, sleeps, loops, or repeated reads. Use `herdr_job_read` only for a deliberate inspection; completion and readiness are delivered automatically. Retained terminal jobs remain available to `herdr_job_read` and `herdr_job_close`.

## Managed Pi agent jobs

Use `subagent` for normal coding delegation that should inherit the shared Pi configuration and subagent lifecycle. Use `herdr_agent_start` when a Pi agent needs a visible long-running TTY, caller-selected active tools, experimental/project extensions, or needs to orchestrate its own subagents.

```ts
herdr_agent_start({
  name: "migration orchestrator",
  task: "Coordinate workers, validate the migration, then report the result.",
  cwd: "/path/to/project",
  tools: "read,bash,subagent,dev_migration_tool",
  extensionMode: "normal"
})
```

Managed agents start in a dedicated Herdr **tab** by default. Set `placement: "right"` or `placement: "down"` only when a side-by-side split is intentional.

`extensionMode: "normal"` retains ordinary global/project extension discovery, including project `.pi` extensions. `extensionMode: "explicit"` starts Pi with `--no-extensions` and loads only the comma-separated paths given through `extensions`, plus the private completion bridge. In either mode, `tools` is a strict active-tool allowlist when supplied.

A managed agent is deliberately **not** auto-completed when Herdr reports it idle: a root orchestrator may be waiting for asynchronous descendant results. The agent calls `herdr_agent_done` after it has processed those results. That writes the completion artifact, shuts down the child Pi process, and delivers the final summary to the caller automatically. Do not poll the managed agent from the parent.

The direct CLI workflow below remains appropriate when the extension is unavailable or when a genuinely short synchronous gate is required.

## Open a tab for a long-running command

Prefer a new tab for an agent-started long-running command:

```bash
new_pane=$(herdr tab create \
  --workspace "$HERDR_WORKSPACE_ID" \
  --label "server" \
  --cwd "$PWD" \
  --no-focus | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); console.log(j.result.root_pane.pane_id)})')

herdr pane run "$new_pane" "npm run dev"
```

Notes:

- A tab gives the job a full-sized terminal and leaves the primary agent view uncluttered.
- `--workspace "$HERDR_WORKSPACE_ID"` creates the tab in the current workspace explicitly.
- `--label "server"` keeps the Herdr sidebar useful.
- Use `--cwd "$PWD"` so the tab starts in the same project directory as the agent.
- `--no-focus` avoids stealing interactive focus from the main agent pane.
- `herdr pane run` sends the command plus Enter atomically; prefer it over `send-text` + `send-keys enter` for shell commands.

Use a split only when you need to watch the job beside the primary agent:

```bash
new_pane=$(herdr pane split "$HERDR_PANE_ID" --direction down --ratio 0.30 --cwd "$PWD" --no-focus | jq -r '.result.pane.pane_id')
```

## Monitor the pane

Read recent output:

```bash
herdr pane read "$new_pane" --source recent-unwrapped --lines 80
```

`pane read` reads Herdr's terminal buffer, not an infinite command log. It is reliable for the visible screen and retained recent scrollback, but very noisy jobs can push older output out of the buffer. Herdr's default scrollback limit for newly created panes is controlled by `[advanced] scrollback_limit_bytes` in `~/.config/herdr/config.toml` (default shown by `herdr --default-config`; current docs show `10485760`, about 10 MiB). Full-screen alternate-screen apps may also produce no normal scrollback. For commands where every byte matters, redirect to a log file and use the pane for live visibility:

```bash
herdr pane run "$new_pane" "npm run dev 2>&1 | tee .herdr-dev.log"
```

Wait for a server readiness line or a test milestone:

```bash
herdr wait output "$new_pane" --match "Local:" --lines 120 --timeout 60000
```

Use `--regex` when matching a pattern:

```bash
herdr wait output "$new_pane" --match 'ready|listening|compiled' --regex --timeout 60000
```

## Stop or close a pane

Interrupt a running command:

```bash
herdr pane send-keys "$new_pane" ctrl+c
```

Close the pane when it is no longer useful:

```bash
herdr pane close "$new_pane"
```

## When to use panes vs agents

Use `herdr pane ...` for:

- dev servers (`npm run dev`, `rails server`, `cargo watch`, etc.)
- long-running tests or watch mode
- log tails
- REPLs and ordinary shells
- low-level terminal control

Use `herdr agent start ... -- <argv...>` only when starting another coding agent that should appear in `herdr agent list` and receive agent status tracking. Prefer `herdr_agent_start` from Pi when the parent needs tool isolation and automatic completion delivery; use direct CLI only for manual or external orchestration:

```bash
herdr agent start reviewer --cwd "$PWD" --split right -- pi
```

## Useful commands

```bash
herdr pane list
herdr pane current --current
herdr pane get "$HERDR_PANE_ID"
herdr pane read <pane_id> --source recent-unwrapped --lines 120
herdr pane focus --direction right --pane "$HERDR_PANE_ID"
herdr pane resize --direction down --amount 0.05 --pane "$HERDR_PANE_ID"
herdr pane zoom "$HERDR_PANE_ID" --toggle
herdr pane rename <pane_id> "label"
herdr pane close <pane_id>
```

For agent-aware panes:

```bash
herdr agent list
herdr agent read <target> --lines 80
herdr agent wait <target> --status idle --timeout 300000
herdr agent explain <target> --json
```
