# Herdr runtime guidance

This agent may be running inside [Herdr](https://herdr.dev), a terminal workspace manager for AI coding agents. If `HERDR_ENV=1` is present, prefer Herdr panes for work that should remain visible, persistent, or independently interruptible.

High-level rules:

- Treat Herdr panes as real terminals owned by the Herdr server; they persist if the UI detaches.
- Do not block the primary agent pane with long-running servers, watchers, or slow test loops when a Herdr side pane would be clearer.
- For long-running jobs, open a lower pane with `herdr pane split "$HERDR_PANE_ID" --direction down ...` so the main agent stays above and the observable job runs below.
- Rename every Herdr-created job pane with a short purpose label such as `server`, `tests`, `logs`, or `watch`.
- Use pane commands for ordinary shells, servers, tests, logs, and scripts. Use `herdr agent start` only when intentionally starting another coding agent.
- Prefer explicit pane IDs from `$HERDR_PANE_ID` or command output over relying on whichever pane is focused in the UI.
- Use `--cwd "$PWD"` and usually `--no-focus` when opening panes from an agent.
- Keep the primary pane for reasoning, editing, and final user communication; keep background panes for observable processes.
- For noisy or important output, write a log file with `tee`; `herdr pane read` is retained scrollback, not infinite history.

More detailed pane workflow: [docs/herdr-panes.md](../docs/herdr-panes.md).
