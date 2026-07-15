# Extensions

Pi loads direct `.ts` / `.js` files here and `index.ts` / `index.js` from one immediate subdirectory. Use `extensions/<feature>/index.ts` for every new multi-file extension family; put implementation helpers in the matching `src/<feature>/` directory. Do not nest an extension entry point more deeply, because Pi does not recursively discover it.

Existing small standalone extensions may remain as direct files.

## Herdr jobs

[`herdr-jobs/index.ts`](herdr-jobs/index.ts) registers the asynchronous `herdr_job_*` tool family. `herdr_job_start` returns after launch and delivers readiness/completion automatically; it uses durable logs and result sidecars. Its `cleanup` policy defaults to `"on_success"`, retaining failed panes for inspection. Implementation lives in [`../src/herdr-jobs/`](../src/herdr-jobs/), and matching tests live in [`../test/herdr-jobs/`](../test/herdr-jobs/).

## UI catalog (experimental)

[`ui-catalog/index.ts`](ui-catalog/index.ts) registers `/ui-catalog`, a disposable terminal-mouse experiment. It enables SGR mouse reporting while its overlay is open, decodes raw click/tap events, and toggles the panel between folded and expanded states. Launch it through [`../ui-playground/`](../ui-playground/) so it stays out of normal Pi sessions.
