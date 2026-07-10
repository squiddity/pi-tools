# pi-tools

Local repo for pi/agent tooling and reusable agent guidance.

## Current focus

- Agent includes for Herdr: reusable Markdown guidance that can be imported or pasted into `AGENTS.md` for agents running inside Herdr.

## Includes

- [`agent-includes/herdr.md`](agent-includes/herdr.md) — short high-level guidance for `AGENTS.md`.
- [`docs/herdr-panes.md`](docs/herdr-panes.md) — deeper guide to opening, monitoring, and closing Herdr panes for long-running jobs.

## Install into Pi agent instructions

Install/update a managed block in the global Pi agent instructions:

```bash
scripts/install-herdr-agents-include.sh
# or: npm run install:herdr-agents
```

Default target: `~/.pi/agent/AGENTS.md`.

Target a project or shared parent directory instead:

```bash
scripts/install-herdr-agents-include.sh --target-dir /path/to/project
scripts/install-herdr-agents-include.sh --target-dir ~/projects
```

The installer is idempotent and updates only the block between `BEGIN pi-tools:herdr` / `END pi-tools:herdr` markers.

## Pi package layout

This repo can also grow into a pi package later:

- `prompts/` — `/name` prompt templates
- `skills/` — pi skills discovered from `SKILL.md`
- `extensions/` — TypeScript extensions, custom commands, and custom tools
- `src/` — shared TypeScript helpers for extensions

Local test:

```bash
pi -e .
```
