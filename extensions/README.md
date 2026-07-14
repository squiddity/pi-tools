# Extensions

Pi loads direct `.ts` / `.js` files here and `index.ts` / `index.js` from one immediate subdirectory. Use `extensions/<feature>/index.ts` for every new multi-file extension family; put implementation helpers in the matching `src/<feature>/` directory. Do not nest an extension entry point more deeply, because Pi does not recursively discover it.

Existing small standalone extensions may remain as direct files.

## Herdr jobs

[`herdr-jobs/index.ts`](herdr-jobs/index.ts) registers the asynchronous `herdr_job_*` tool family. Its implementation lives in [`../src/herdr-jobs/`](../src/herdr-jobs/), and matching tests live in [`../test/herdr-jobs/`](../test/herdr-jobs/).
