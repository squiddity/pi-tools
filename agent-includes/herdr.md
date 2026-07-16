# Herdr runtime guidance

This agent may be running inside [Herdr](https://herdr.dev), a terminal workspace manager for AI coding agents. If `HERDR_ENV=1` is present, prefer Herdr panes for work that should remain visible, persistent, or independently interruptible.

High-level rules:

- When the `herdr_job_*` tools are available, prefer `herdr_job_start` for ordinary long-running tests, builds, servers, watchers, and tails. It returns immediately; readiness and completion arrive automatically as steer messages.
- After `herdr_job_start`, do **not** poll with the parent `bash` tool, `herdr wait`, sleeps, repeated log reads, or loops. Use `herdr_job_read` only for an explicit inspection requested by the user or needed to diagnose a problem.
- Use `subagent` for ordinary coding delegation in the shared configured environment, `herdr_agent_start` for a long-running isolated Pi orchestrator with caller-selected extensions/tools, and `herdr_job_start` for ordinary shell commands. If the async job extension is unavailable, direct pane commands and a genuinely short synchronous `herdr wait` remain valid fallbacks.
- A managed agent started with `herdr_agent_start` is not done merely because it is idle: it may be waiting for nested subagent results. It must call `herdr_agent_done` only after processing all required descendant results. Its completion is delivered automatically; do not poll it from the parent.
- Treat Herdr panes as real terminals owned by the Herdr server; they persist if the UI detaches.
- After a finite job completes or fails, capture the needed result and close its job pane/tab promptly unless the user asks to keep it open for inspection. Do not leave completed test/build/install panes as workspace clutter.
- After an autonomous subagent reaches a terminal state, close its pane/tab when the harness exposes that control, unless the user is actively watching it, requested a follow-up, or it is intentionally persistent. Never close the primary pane or a requested long-lived service/review pane merely because it is idle.
- Do not block the primary agent pane with long-running servers, watchers, or slow test loops when a Herdr side pane would be clearer.
- Prefer a new Herdr tab for long-running jobs so the primary agent pane stays uncluttered. Use a split only when simultaneous side-by-side or stacked visibility is specifically useful.
- Rename every Herdr-created job pane with a short purpose label such as `server`, `tests`, `logs`, or `watch`.
- Use pane commands for ordinary shells, servers, tests, logs, and scripts. Use `herdr agent start` only when intentionally starting another coding agent.
- Prefer explicit pane IDs from `$HERDR_PANE_ID` or command output over relying on whichever pane is focused in the UI.
- Use `--cwd "$PWD"` and usually `--no-focus` when opening panes from an agent.
- Keep the primary pane for reasoning, editing, and final user communication; keep background panes for observable processes.
- For noisy or important output, write a log file with `tee`; `herdr pane read` is retained scrollback, not infinite history.

More detailed pane workflow: [docs/herdr-panes.md](../docs/herdr-panes.md).
