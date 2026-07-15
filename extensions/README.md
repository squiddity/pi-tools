# Extensions

Pi loads direct `.ts` / `.js` files here and `index.ts` / `index.js` from one immediate subdirectory. Use `extensions/<feature>/index.ts` for every new multi-file extension family; put implementation helpers in the matching `src/<feature>/` directory. Do not nest an extension entry point more deeply, because Pi does not recursively discover it.

Existing small standalone extensions may remain as direct files.

## Herdr jobs

[`herdr-jobs/index.ts`](herdr-jobs/index.ts) registers the asynchronous `herdr_job_*` tool family. `herdr_job_start` returns after launch and delivers readiness/completion automatically; it uses durable logs and result sidecars. Its `cleanup` policy defaults to `"on_success"`, retaining failed panes for inspection. Implementation lives in [`../src/herdr-jobs/`](../src/herdr-jobs/), and matching tests live in [`../test/herdr-jobs/`](../test/herdr-jobs/).

## Input mapper (experimental MVP)

[`input-mapper/index.ts`](input-mapper/index.ts) registers `/input-map`, an extension-only SGR mouse-to-key mapper. Profiles are declarative configuration only; [`../docs/input-mapper.ask-user-question.example.json`](../docs/input-mapper.ask-user-question.example.json) supplies the conservative Ask example, which maps Termux wheel reports to Up/Down and a same-cell press/release tap to Enter on the currently focused row. The mapper owns mouse reporting only for an active profile and `/input-map off` immediately restores normal terminal behavior.

Configuration is loaded from `~/.pi/agent/input-mapper.json`, then trusted-project `.pi/input-mapper.json`; project profile fields override user fields. The initial schema accepts only version 1, profiles, tool activation, SGR/button mouse settings, gesture limits, and one-report-to-one-key mappings. Use the [UI playground](../ui-playground/) to test it before installing globally.

## UI catalog (experimental)

[`ui-catalog/index.ts`](ui-catalog/index.ts) registers `/ui-catalog` plus `/ui-wheel-list`, disposable terminal-mouse experiments. The latter verifies direct wheel-to-list navigation before using the same reports through the mapper. Launch them through [`../ui-playground/`](../ui-playground/) so they stay out of normal Pi sessions.
