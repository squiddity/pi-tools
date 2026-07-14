# pi-tools contributor guidance

## Repository role

`pi-tools` is one curated Pi package for related extensions, skills, prompts, reusable agent guidance, and their shared implementation code. Keep it as a single package unless a tool needs an independently versioned/released dependency boundary; decide explicitly before introducing a workspace or nested package.

## Layout

Use Pi's conventional top-level resource directories. A **tool family** is a coherent, independently loadable feature; it may expose one or several Pi tools. Give each non-trivial family a matching subdirectory:

```text
extensions/<feature>/index.ts  # Pi extension entry point
src/<feature>/                 # implementation helpers, organized by concern
test/<feature>/                # tests for the feature
skills/<feature>/SKILL.md      # feature-specific skill, when needed
prompts/<feature>.md           # prompt template, when needed
agent-includes/<topic>.md      # reusable AGENTS guidance
docs/<topic>.md                # user-facing or design documentation
scripts/<topic>.sh             # executable maintenance/install scripts
```

Pi discovers `extensions/*.ts` and `extensions/*/index.ts`; it does not recursively discover deeper extension entry points. Therefore each extension entry point must be exactly `extensions/<feature>/index.ts` (or a single-file extension directly under `extensions/`). Put its supporting code in `src/<feature>/`, not beneath a deeper `extensions/` path.

Small, self-contained legacy extensions may remain as `extensions/<name>.ts`. New multi-file features use the feature-directory layout. Do not create a generic `tools/` directory or a separate package per individual Pi tool call.

The planned asynchronous Herdr jobs feature uses:

```text
extensions/herdr-jobs/index.ts
src/herdr-jobs/
test/herdr-jobs/
```

## Implementation expectations

- Keep extension registration/UI code in `extensions/<feature>/index.ts`; keep pure and testable logic in `src/<feature>/`.
- Match test paths to source feature paths and add tests with new behavior.
- Add runtime dependencies to `dependencies`; Pi-provided packages stay in `peerDependencies`.
- Use the existing package manifest rather than adding nested manifests unless the package-boundary decision above is made.
- Update the relevant README/docs and agent include when a feature changes how agents should work.
- Before finishing, run the narrowest relevant test plus `npm run check` when the project dependencies are installed.
