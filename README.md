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

This repository is one curated Pi package. Keep related resources together here; do not create a package per individual Pi tool call. Non-trivial, independently loadable tool families use matching feature directories:

```text
extensions/<feature>/index.ts  # Pi extension entry point
src/<feature>/                 # implementation helpers
test/<feature>/                # feature tests
```

Pi discovers `extensions/*.ts` and `extensions/*/index.ts`, so extension entry points must stay at that depth. Single-file extensions may remain directly in `extensions/`. Prompts, skills, agent includes, docs, and scripts use their existing top-level directories. See [`AGENTS.md`](AGENTS.md) for the repository rules.

The asynchronous Herdr jobs feature will live at `extensions/herdr-jobs/`, `src/herdr-jobs/`, and `test/herdr-jobs/`.

Local test:

```bash
pi -e .
```
