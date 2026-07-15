# pi-tools

Local repo for pi/agent tooling and reusable agent guidance.

## Current focus

- Asynchronous Herdr jobs extension and reusable agent guidance for Pi agents running inside Herdr.

## Includes

- [`agent-includes/herdr.md`](agent-includes/herdr.md) — short high-level guidance for `AGENTS.md`.
- [`docs/herdr-panes.md`](docs/herdr-panes.md) — deeper guide to opening, monitoring, and closing Herdr panes for long-running jobs.

## Herdr jobs extension

[`extensions/herdr-jobs/`](extensions/herdr-jobs/) provides non-blocking `herdr_job_*` tools for ordinary shell commands in Herdr. `herdr_job_start` creates a visible pane and durable artifacts, returns immediately, and sends automatic readiness/completion notifications; use it for long-running tests, builds, servers, and watchers. Use `subagent` for coding-agent sessions instead.

Try the complete package for one Pi invocation:

```bash
pi -e .
```

After `herdr_job_start`, do not poll with `herdr wait`, sleeps, loops, or repeated reads. Completion arrives as a steer message. See [`docs/herdr-panes.md`](docs/herdr-panes.md) for examples and fallback CLI use.

## Acknowledgements

The async Herdr jobs extension borrows orchestration ideas and notification/widget formatting from [pi-herdr-subagents](https://github.com/0xRichardH/pi-herdr-subagents/tree/d654eae75ff347ccb618113f2af85f3040d9ade9). It is an independently implemented, command-focused runner rather than a fork. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the upstream MIT notice.

## License

This project is licensed under the [MIT License](LICENSE). Third-party notices are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Install into Pi

Install the complete `pi-tools` package globally:

```bash
pi install /home/squiddity/projects/pi-tools
```

Or install only the Herdr jobs extension entrypoint, without other package resources:

```bash
pi install /home/squiddity/projects/pi-tools/extensions/herdr-jobs/index.ts
```

Add `-l` to either command for project-local installation. Restart Pi (or run `/reload`) after installation or after changing a locally linked extension.

## Install agent guidance

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

The asynchronous Herdr jobs implementation lives at `extensions/herdr-jobs/`, `src/herdr-jobs/`, and `test/herdr-jobs/`. The experimental UI catalog lives at `extensions/ui-catalog/`, `src/ui-catalog/`, and `test/ui-catalog/`.

Local test:

```bash
pi -e .
```

## UI playground

[`ui-playground/`](ui-playground/) is a disposable project-local Pi session that loads the experimental [`ui-catalog`](extensions/ui-catalog/) extension directly through its `.pi/settings.json`; it does not require `pi install`. Start Pi from that directory and run `/ui-catalog` to test the tappable/foldable panel.
