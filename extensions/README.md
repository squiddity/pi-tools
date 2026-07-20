# Extensions

Pi loads direct `.ts` / `.js` files here and `index.ts` / `index.js` from one immediate subdirectory. Use `extensions/<feature>/index.ts` for every new multi-file extension family; put implementation helpers in the matching `src/<feature>/` directory. Do not nest an extension entry point more deeply, because Pi does not recursively discover it.

Existing small standalone extensions may remain as direct files.

## pi-footer configuration

[`../docs/pi-footer.example.json`](../docs/pi-footer.example.json) is a portable copy of the current `pi-footer` layout. Install it after installing `pi-footer` with:

```sh
mkdir -p ~/.pi/agent/extensions
cp docs/pi-footer.example.json ~/.pi/agent/extensions/pi-footer.json
```

The file contains no host paths, credentials, or other personal data. `pi-footer` also supports `/footer` for editing the configuration interactively.

## Lemonade provider

[`lemonade-provider/index.ts`](lemonade-provider/index.ts) registers locally served Lemonade models as the `lemonade` provider. It discovers models from the Ollama-compatible API and reads context lengths when available.

The extension contains no host-specific configuration. By default it connects to `http://127.0.0.1:13305/v1`; configure another host or API key with environment variables before starting Pi:

```sh
export PI_LEMONADE_BASE_URL=http://your-lemonade-host:13305/v1
export PI_LEMONADE_API_KEY=ollama
```

`LEMONADE_BASE_URL` and `LEMONADE_API_KEY` are also accepted for compatibility. The default API key is `ollama`, which is the usual local-server placeholder rather than a credential.

## Herdr jobs

[`herdr-jobs/index.ts`](herdr-jobs/index.ts) registers the asynchronous `herdr_job_*` tool family. `herdr_job_start` returns after launch and delivers readiness/completion automatically; it uses durable logs and result sidecars. Its `cleanup` policy defaults to `"on_success"`, retaining failed panes for inspection. Implementation lives in [`../src/herdr-jobs/`](../src/herdr-jobs/), and matching tests live in [`../test/herdr-jobs/`](../test/herdr-jobs/).

## Input mapper (experimental MVP)

[`input-mapper/index.ts`](input-mapper/index.ts) registers `/input-map`, an extension-only SGR mouse-to-key mapper. Profiles are declarative configuration only; [`../docs/input-mapper.ask-user-question.example.json`](../docs/input-mapper.ask-user-question.example.json) supplies the conservative Ask example, which maps Termux wheel reports to Up/Down and a same-cell press/release tap to Enter on the currently focused row. The mapper owns mouse reporting only for an active profile and `/input-map off` immediately restores normal terminal behavior.

Configuration is loaded from `~/.pi/agent/input-mapper.json`, then trusted-project `.pi/input-mapper.json`; project profile fields override user fields. The initial schema accepts only version 1, profiles, tool activation, SGR/button mouse settings, gesture limits, and one-report-to-one-key mappings. Function keys `f1`–`f12` are available for mapping extension shortcuts. [`../docs/input-mapper.herdr-jobs.example.json`](../docs/input-mapper.herdr-jobs.example.json) maps a tap to the Herdr jobs panel’s F8 toggle. Use the [UI playground](../ui-playground/) to test it before installing globally.

## UI catalog (experimental)

[`ui-catalog/index.ts`](ui-catalog/index.ts) registers `/ui-catalog` plus `/ui-wheel-list`, disposable terminal-mouse experiments. The latter verifies direct wheel-to-list navigation before using the same reports through the mapper. Launch them through [`../ui-playground/`](../ui-playground/) so they stay out of normal Pi sessions.
