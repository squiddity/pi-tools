# Implementation plan: non-blocking Herdr jobs for Pi

## Purpose

Implement a Pi extension that starts ordinary long-running commands in dedicated Herdr panes, returns control to the main Pi agent immediately, watches the jobs in the background, and injects completion/readiness notifications back into the parent Pi session.

This document is intended to be handed to another model in a fresh session. It contains the design decisions, proposed file layout, tool contracts, lifecycle rules, testing strategy, and acceptance criteria needed to implement the feature without repeating the initial investigation.

## Executive summary

The current documented workflow starts a command in a Herdr pane and then invokes `herdr wait` through Pi's built-in `bash` tool. `herdr wait` is intentionally synchronous. Because the `bash` tool call remains unresolved, Pi remains in its working state for the entire wait and the main agent cannot become idle.

The solution is a custom Pi extension with fire-and-forget tools:

1. `herdr_job_start` performs only the short launch sequence.
2. It creates a watcher with an `AbortController` owned by the extension, not by the tool call.
3. It starts the watcher Promise without awaiting it.
4. It immediately returns a `started` tool result.
5. The watcher observes durable job artifacts and Herdr pane health.
6. On readiness, completion, or failure, the extension calls `pi.sendMessage(..., { triggerTurn: true, deliverAs: "steer" })`.
7. A compact widget reports background job state without using Pi's built-in working indicator.

This is the same orchestration pattern used by `pi-herdr-subagents`, generalized for arbitrary shell commands.

## Research baseline

The implementer should use the following as authoritative references:

- Installed Pi extension documentation:
  - `/home/squiddity/.nvm/versions/node/v24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
  - Read this file completely before implementing. Pay particular attention to custom tools, `pi.sendMessage`, widgets, session shutdown, and reload behavior.
- Installed Pi TUI documentation:
  - `/home/squiddity/.nvm/versions/node/v24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
  - The widget is required scope, so read this file completely and follow its cross-references before implementing custom components.
- Existing async implementation:
  - `/home/squiddity/.pi/agent/npm/node_modules/pi-herdr-subagents/pi-extension/subagents/index.ts`
  - `/home/squiddity/.pi/agent/npm/node_modules/pi-herdr-subagents/pi-extension/subagents/completion.ts`
  - `/home/squiddity/.pi/agent/npm/node_modules/pi-herdr-subagents/pi-extension/subagents/herdr.ts`
  - `/home/squiddity/.pi/agent/npm/node_modules/pi-herdr-subagents/pi-extension/subagents/lifecycle.ts`
- Version-pinned public references:
  - Fire-and-forget watcher and steer delivery: <https://github.com/0xRichardH/pi-herdr-subagents/blob/d654eae75ff347ccb618113f2af85f3040d9ade9/pi-extension/subagents/index.ts#L1695-L1815>
  - Background completion polling: <https://github.com/0xRichardH/pi-herdr-subagents/blob/d654eae75ff347ccb618113f2af85f3040d9ade9/pi-extension/subagents/completion.ts#L128-L175>
  - Pi `sendMessage` semantics: <https://github.com/earendil-works/pi/blob/2b3fda9921b5590f285165287bd442a25817f17b/packages/coding-agent/docs/extensions.md#L1378-L1400>
  - Herdr's synchronous `wait output` CLI: <https://github.com/ogulcancelik/herdr/blob/299dd4163a96381ec2d8e5bde13d7ba6d6432373/src/cli.rs#L689-L782>
  - Herdr output-wait polling loop: <https://github.com/ogulcancelik/herdr/blob/299dd4163a96381ec2d8e5bde13d7ba6d6432373/src/api/wait.rs#L22-L126>
  - Herdr event subscription types: <https://github.com/ogulcancelik/herdr/blob/299dd4163a96381ec2d8e5bde13d7ba6d6432373/src/api/schema/events.rs#L47-L74>

Do not copy the entire subagent extension. Reuse its orchestration ideas while keeping the generic jobs implementation smaller and command-focused.

## Key design decisions

These decisions should remain fixed unless implementation evidence demonstrates a concrete problem:

1. **A Pi extension is the orchestration boundary.** AGENTS guidance or a background shell command alone cannot inject a reliable completion event into the parent model context.
2. **The tool returns after launch, not after completion.** The extension must never await the long-lived watcher from `execute()`.
3. **A durable result sidecar is completion authority.** Terminal output is bounded and cannot be the only source of truth for exit status.
4. **The durable log is readiness authority.** Readiness matching scans `output.log`, not Herdr scrollback, so noisy output cannot erase the event before it is observed.
5. **Do not call `herdr wait` from the start tool.** An asynchronously spawned `herdr wait` child could avoid blocking Pi, but it adds a second long-lived process per condition and still depends on bounded terminal output. Sidecar/log observation is simpler and more reliable for jobs launched by this extension.
6. **Do not implement the raw Herdr socket protocol in v1.** Herdr event subscriptions are useful for a future high-volume supervisor, but the CLI plus durable local artifacts is adequate for the expected small number of concurrent jobs.
7. **Keep panes by default.** Visibility and post-mortem inspection are primary reasons to use Herdr. Closing a pane is opt-in or explicit.
8. **The widget is not Pi's working state.** Background status belongs in a custom widget; it must not keep the built-in spinner/message active.
9. **Coding agents remain separate.** Do not route agent sessions through this generic runner; continue using `pi-herdr-subagents` for agent lifecycle and summaries.

## Scope

### In scope

- Start a finite command or long-running service in a new Herdr pane.
- Default to a lower split of the current Pi pane, with no focus stealing.
- Return from the Pi tool as soon as the command has been launched.
- Preserve live terminal visibility in the Herdr pane.
- Persist complete merged stdout/stderr to a log file.
- Detect readiness from an optional substring or regular expression.
- Detect process completion and preserve the real exit code.
- Notify the parent Pi session asynchronously on readiness, success, failure, or watcher failure.
- Track jobs in a widget independent of Pi's working spinner.
- List, inspect/read, interrupt, and close tracked jobs.
- Preserve watchers across `/reload` in the same Pi process.
- Reattach pending jobs when the same persisted Pi session is resumed after a process restart.
- Update agent guidance so models prefer the async tool for long waits.
- Unit tests for parsing, artifacts, lifecycle transitions, wrapper generation, and notification gating.
- A real Herdr integration test or reproducible manual validation script.

### Out of scope for the first implementation

- Replacing Herdr itself or modifying the Herdr server.
- Running coding subagents; `pi-herdr-subagents` remains responsible for those.
- Remote Herdr sessions.
- A generalized distributed job scheduler.
- Guaranteed delivery after the parent Pi session has been permanently deleted.
- Perfect exactly-once notification across a crash occurring at the exact instant a Pi message is being persisted.
- Windows support unless the implementer deliberately replaces the proposed Bash runner with a tested cross-platform runner. The current project guidance and target environment are POSIX/Bash-oriented; fail clearly on unsupported platforms rather than silently misbehaving.

## Terminology

- **Parent**: the main Pi session that called `herdr_job_start`.
- **Job pane**: the Herdr pane in which the command runs.
- **Finite job**: a command expected to terminate, such as a test suite or build.
- **Service job**: a server, watcher, or tail expected to remain alive after reaching readiness.
- **Artifact directory**: a per-job directory containing generated scripts, logs, metadata, and completion records.
- **Watcher**: asynchronous extension-owned code that observes artifacts and pane health after the start tool has returned.
- **Steer notification**: a Pi custom message delivered with `triggerTurn: true` and `deliverAs: "steer"`.

## User-facing tool API

Use `StringEnum` from `@earendil-works/pi-ai` for string enums so the schemas remain compatible with Google providers. Add the package to both peer and development dependencies.

### `herdr_job_start`

Purpose: start a command in a Herdr pane and return immediately.

Proposed parameters:

```ts
{
  name: string;
  command: string;
  cwd?: string;
  kind?: "finite" | "service";       // default: finite
  placement?: "down" | "right" | "tab"; // default: down
  ratio?: number;                      // split only; default: 0.30
  readyPattern?: string;
  readyRegex?: boolean;                // default: false
  readyTimeoutMs?: number;             // optional; timeout does not kill service
  keepPane?: boolean;                  // default: true
}
```

Validation and semantics:

- `name` must be non-empty after trimming and should be limited to a reasonable display length, for example 80 characters.
- `command` must be non-empty. It intentionally uses shell semantics and must be documented as such.
- Resolve a relative `cwd` against `ctx.cwd`, not `process.cwd()`.
- Validate that `cwd` exists and is a directory before creating a pane.
- `ratio` should be constrained to a safe range, for example `0.10` through `0.90`.
- `readyPattern` is allowed for either kind, though it is primarily intended for services.
- Compile a readiness regex before launch so invalid patterns fail synchronously without creating a pane.
- If `readyTimeoutMs` expires, emit a readiness-timeout notification but do not automatically kill the underlying process.
- `keepPane: true` leaves the pane open after completion for inspection. If false, close it only after result/log extraction succeeds.
- Return details containing at least `jobId`, `paneId`, `name`, `kind`, `cwd`, `artifactDir`, `logFile`, and `status: "started"`.
- The tool description and prompt guidelines must explicitly say that it is fire-and-forget, completion will arrive automatically, and the model must not poll with `bash`, `herdr wait`, sleeps, or repeated reads.

Suggested acknowledgement:

```text
Herdr job "tests" started in pane wD:p3. Do not poll it; completion will be delivered automatically.
```

### `herdr_job_interrupt`

Purpose: send Ctrl+C to a tracked job's pane without destroying tracking.

Parameters:

```ts
{
  id?: string;
  name?: string;
}
```

Rules:

- Require exactly one resolvable target.
- Prefer ID for unambiguous control.
- If a name matches multiple jobs, return a clear ambiguity error listing IDs.
- Send `ctrl+c`/`Ctrl+C` using the exact Herdr key spelling supported by the installed CLI; verify this with a real command before finalizing.
- Mark local state `interrupt_requested` immediately, but keep the watcher alive so the wrapper can publish the real exit code.
- This tool returns only an acknowledgement and must not fabricate completion.

### `herdr_job_read`

Purpose: read a bounded tail from the durable log and optionally show job metadata.

Parameters:

```ts
{
  id: string;
  lines?: number; // safe bounded default, e.g. 80; maximum e.g. 500
}
```

Rules:

- Read the log file, not terminal scrollback, so output is durable.
- Apply Pi's standard output truncation utilities or equivalent 50KB/2000-line limits.
- Report when truncation occurred and include the full log path.
- This is an explicit inspection tool, not the completion mechanism. Its description must not encourage polling.

### `herdr_jobs_list`

Purpose: list tracked jobs and their projected states.

Parameters: empty object.

Return for each job:

- ID and display name
- pane ID
- kind
- projected state
- elapsed runtime
- readiness state
- command exit code if complete
- log/artifact paths

### `herdr_job_close`

Purpose: explicitly close a tracked job pane.

Parameters:

```ts
{
  id: string;
  force?: boolean;
}
```

Rules:

- If the process appears active and `force` is not true, refuse and instruct the caller to interrupt first.
- If forced, close the pane and mark the job as intentionally closed/suppressed so pane disappearance does not produce a misleading failure notification.
- Abort the watcher only after recording the suppression state.

## Proposed file layout

Keep extension entrypoint code separate from testable helpers.

```text
extensions/
  herdr-jobs/
    index.ts                 # Pi registration, tools, widget, message renderers
src/
  herdr-jobs/
    types.ts                 # job records, lifecycle, persisted metadata
    herdr.ts                 # typed Herdr CLI wrappers and JSON parsing
    artifacts.ts             # artifact paths, atomic JSON, log tail helpers
    runner.ts                # command/run script generation
    lifecycle.ts             # pure state transitions and projections
    watcher.ts               # completion/readiness/pane-health watcher
    runtime.ts               # registry, reload adoption, delivery gating
    format.ts                # elapsed/status/result formatting
    index.ts                 # optional exports for tests

test/
  herdr-jobs/
    artifacts.test.ts
    runner.test.ts
    lifecycle.test.ts
    watcher.test.ts
    herdr.test.ts
    runtime.test.ts
    integration.test.ts      # guarded/skipped unless HERDR_ENV=1
```

If this decomposition creates unnecessary import friction, helper modules may live under `extensions/herdr-jobs/`, but preserve the boundaries and keep pure logic independently testable.

Because the project uses `NodeNext`, decide on one import convention and make it pass `tsc`. If importing `.ts` files directly under jiti, add `allowImportingTsExtensions: true` to `tsconfig.json`. Do not leave the project in a state where runtime imports work but typechecking fails.

## Package and script updates

Update `package.json` so a clean clone can install, typecheck, and test the extension.

Peer dependencies should include host-provided Pi packages:

```json
{
  "@earendil-works/pi-ai": "*",
  "@earendil-works/pi-coding-agent": "*",
  "@earendil-works/pi-tui": "*",
  "typebox": "*"
}
```

Development dependencies should include compatible concrete versions for local checks, plus Node types and TypeScript. Match the installed Pi family where practical (`0.80.6` at planning time), rather than inventing unverified versions.

Add scripts along these lines:

```json
{
  "test": "node --test test/**/*.test.ts",
  "typecheck": "tsc --noEmit",
  "check": "npm run typecheck && npm test"
}
```

Run `npm install` and commit the generated lockfile if this repository's conventions permit it. The repository currently has no installed local dependencies, so the implementer must not mistake a missing `tsc` binary for an implementation failure.

## Core architecture

### 1. Extension-owned runtime

Create a runtime object containing:

```ts
interface HerdrJobsRuntime {
  jobs: Map<string, RunningJob>;
  pi?: ExtensionAPI;
  latestCtx?: ExtensionContext;
  widgetInterval?: ReturnType<typeof setInterval>;
}
```

Store it under a stable global symbol:

```ts
const RUNTIME_KEY = Symbol.for("pi-tools/herdr-jobs/runtime");
```

This mirrors the proven subagent approach and permits a reloaded extension module to adopt existing watcher closures and records.

On every `session_start`:

- update `runtime.pi` and `runtime.latestCtx`
- restore the widget if jobs are tracked
- on startup/resume, scan current-session artifacts for pending jobs and reattach as described later

On `session_shutdown`:

- for `reason === "reload"`, preserve watchers and registry; clear only presentation timers that the new module will replace
- for `quit`, `new`, `resume`, or `fork`, suppress delivery to the old session and abort old-session watchers
- do not automatically kill Herdr pane processes on parent shutdown; Herdr panes are intentionally persistent
- leave enough metadata for a later resume of the same session to reattach

Watcher callbacks must select the newest `runtime.pi`, not blindly retain a stale pre-reload API object.

### 2. Job identity and artifacts

Generate IDs with `crypto.randomUUID()` or a sufficiently unique compact derivative. Avoid `Math.random()` for persistent identifiers.

Preferred artifact root for a persistent Pi session:

```text
<sessionDir>/artifacts/<sessionId>/herdr-jobs/<jobId>/
```

Fallback for an ephemeral session:

```text
<tmpdir>/pi-herdr-jobs/<process-id>/<jobId>/
```

Per-job contents:

```text
command.sh       # exact user command, not interpolated into pane-run arguments
run.sh           # generated wrapper/finalizer
output.log       # durable merged stdout/stderr
metadata.json    # persisted identity, pane, paths, state, delivery status
result.json      # atomically published terminal result
```

Suggested `metadata.json` fields:

```ts
interface PersistedJobMetadata {
  version: 1;
  id: string;
  parentSessionId?: string;
  parentSessionFile?: string;
  name: string;
  command: string;
  cwd: string;
  kind: "finite" | "service";
  paneId: string;
  placement: "down" | "right" | "tab";
  createdAt: number;
  startedAt: number;
  readyPattern?: string;
  readyRegex: boolean;
  readyTimeoutMs?: number;
  keepPane: boolean;
  delivery: "pending" | "delivered" | "suppressed";
  state: string;
}
```

Suggested `result.json` fields:

```ts
interface JobResultArtifact {
  version: 1;
  id: string;
  exitCode: number;
  signal?: string;
  startedAt: number;
  completedAt: number;
}
```

Write JSON atomically:

1. write to a unique temporary file in the same directory
2. flush/close it
3. rename it over the destination

Readers should treat malformed non-atomic legacy files as transient and retry briefly, but generated files must always use atomic publication.

### 3. Safe launch script generation

Never interpolate the raw command into `herdr pane run`. Write the exact command to `command.sh`, write a generated `run.sh`, and send only a safely quoted script path to the pane.

The wrapper must:

- run from the validated working directory
- preserve shell command semantics
- merge stdout/stderr to both the terminal and `output.log`
- capture the command's exit code rather than `tee`'s exit code
- publish `result.json` atomically
- print a unique completion marker containing the job ID and exit code as a fallback
- return to the interactive pane shell after completion
- make best efforts to publish exit code 130 after Ctrl+C

Conceptual wrapper behavior:

```bash
#!/usr/bin/env bash
set +e

cd -- '<validated cwd>' || exit 125

bash '<artifact-dir>/command.sh' 2>&1 | tee -a '<artifact-dir>/output.log'
job_exit=${PIPESTATUS[0]}

# Write result JSON to result.json.tmp.<pid>, then mv to result.json.
# Use values generated by the extension rather than parsing arbitrary output.

printf '\n__PI_HERDR_JOB_<job-id>_DONE_%s__\n' "$job_exit"
exit "$job_exit"
```

Do not use the above verbatim without testing signal and quoting behavior. Add an `EXIT`, `INT`, or `TERM` finalization strategy if needed so interruption still publishes a result. Ensure finalization is idempotent because multiple traps can run.

Use strict shell quoting for every generated path. The raw command belongs only in `command.sh`, where it should be written byte-for-byte plus a final newline if absent.

### 4. Herdr adapter

Implement a small typed wrapper around `execFile`/`execFileSync` with argument arrays. Do not construct shell strings for Herdr CLI calls.

Required operations:

- verify `HERDR_ENV === "1"`
- verify `herdr` is available
- split current pane down/right with `--cwd`, `--ratio`, and `--no-focus`
- create a no-focus tab and obtain its root pane ID
- rename pane
- run the generated script using `herdr pane run`
- inspect pane with `herdr pane get`
- read pane only as a diagnostic fallback
- send Ctrl+C
- close pane

Parse structured JSON and validate the expected fields. Return explicit errors containing the Herdr operation and bounded stdout/stderr when output is malformed.

Use `HERDR_PANE_ID` explicitly as the split parent. Do not depend on whichever pane is currently focused in the UI.

For newly created panes, wait briefly for shell startup before `pane run`. Follow the subagent extension's precedent:

- environment variable: `PI_HERDR_JOB_SHELL_READY_DELAY_MS`
- default: 500 ms
- accept non-negative integer values

The launch portion may await this short delay. The long-running command and watcher must not be awaited by the tool.

### 5. Watcher design

The watcher must use a separate `AbortController`. Never use the `signal` passed to `herdr_job_start` after the tool returns, because that signal belongs to the current tool/agent turn.

The central pattern must look like:

```ts
const watcherAbort = new AbortController();
job.abortController = watcherAbort;

void watchJob(job, watcherAbort.signal)
  .then((event) => deliverJobEvent(job, event))
  .catch((error) => deliverWatcherFailure(job, error));

return startedResult(job);
```

The watcher should use abortable delays, not blocking loops or shell sleeps in the parent tool.

Every polling cycle should:

1. Check for and parse `result.json`.
2. Incrementally inspect newly appended `output.log` bytes for readiness if not yet ready.
3. Check readiness timeout if configured.
4. Periodically inspect the Herdr pane.
5. Update lifecycle state and widget only when state/detail changes.
6. Await an abortable delay, initially around 500-1000 ms.

Completion authority order:

1. Valid matching `result.json` is authoritative.
2. The unique terminal marker is a fallback if result publication failed.
3. Pane disappearance without completion evidence is a watcher failure after a short artifact grace period.

The sidecar is required because terminal scrollback is bounded and a marker can be lost during noisy output.

Readiness scanning:

- Maintain a byte offset into `output.log`; do not reread an unbounded growing file each second.
- For substring matching, preserve an overlap of at least `pattern.length - 1` characters between chunks.
- For regex matching, maintain a bounded rolling text window, for example 64 KiB, and document that readiness regexes should match localized output rather than the entire history.
- Use `StringDecoder` or equivalent so a UTF-8 character split across reads is not corrupted.
- Emit readiness at most once.
- Record readiness time in memory and metadata.

Pane health:

- A temporary `herdr pane get` failure is not immediate job failure.
- Track consecutive failures or failure duration.
- Mark the job `stalled` only after a reasonable threshold, for example 60 seconds, matching the subagent extension's philosophy.
- A structured `pane_not_found`/`not_found` response is different from a temporary CLI/socket failure.
- If the pane is explicitly closed through `herdr_job_close`, suppress the disappearance failure.

### 6. Lifecycle model

Use pure transition functions rather than mutating ad hoc status strings throughout the extension.

Recommended process states:

```ts
type ProcessState =
  | { kind: "launching"; startedAt: number }
  | { kind: "running"; startedAt: number; confirmedAt: number }
  | { kind: "interrupt_requested"; startedAt: number; requestedAt: number }
  | { kind: "completed"; startedAt: number; completedAt: number; exitCode: number }
  | { kind: "failed"; startedAt: number; completedAt: number; error: string }
  | { kind: "closed"; startedAt: number; closedAt: number };
```

Recommended readiness states:

```ts
type ReadinessState =
  | { kind: "not_configured" }
  | { kind: "waiting"; since: number }
  | { kind: "ready"; detectedAt: number; matchedText?: string }
  | { kind: "timed_out"; timedOutAt: number };
```

Keep delivery separately:

```ts
type DeliveryState = "pending" | "delivered" | "suppressed";
```

Projection rules for display:

- `launching`
- `running`
- `waiting for ready`
- `ready`
- `interrupt requested`
- `stalled`
- `completed`
- `failed`

For service jobs, `ready` is still an active/open job. Do not remove it from tracking until it exits or is explicitly closed.

For finite jobs, remove the row after terminal notification delivery. The completion message remains in the transcript.

### 7. Async notifications

Register custom message renderers for at least:

- `herdr_job_ready`
- `herdr_job_result`
- `herdr_job_status` or `herdr_job_failure`

Every notification must include a stable `jobId` in `details` so session rehydration can detect prior delivery.

Readiness notification example:

```text
Herdr service "dev server" is ready after 8s.
Pane: wD:p3
Matched: Local: http://localhost:5173
Log: /.../output.log
```

Completion notification example:

```text
Herdr job "tests" completed successfully in 2m 14s.
Exit code: 0
Pane: wD:p3
Log: /.../output.log

Last output:
...
```

Failure example:

```text
Herdr job "tests" failed after 41s.
Exit code: 1
Pane: wD:p3
Log: /.../output.log

Last output:
...
```

Use a bounded log tail in LLM-visible content. Never inject the complete log by default.

Delivery call:

```ts
runtime.pi!.sendMessage(
  {
    customType: "herdr_job_result",
    content,
    display: true,
    details,
  },
  { triggerTurn: true, deliverAs: "steer" },
);
```

This behavior means:

- if the parent is idle, Pi begins a new turn
- if the parent is working, the message is steered after the current assistant turn's tool calls and before the next model call

Prevent duplicate terminal delivery with an in-memory gate and persisted metadata. Before reattaching after restart, inspect the current session entries for an existing custom message with the same `jobId` and terminal event. If found, mark it delivered and do not send it again.

A readiness event and a terminal result are distinct and may each be delivered once.

### 8. Widget

Use `ctx.ui.setWidget("herdr-jobs", ...)` above the editor. Do not call `setWorkingMessage` or otherwise keep Pi's built-in working state active.

Suggested presentation:

```text
╭─ Herdr jobs ───────────────────────── 2 active · 1 ready ─╮
│ 00:42  tests                         running · wD:p3       │
│ 03:18  dev server                    ready · wD:p4         │
│ 00:07  docs                          interrupt requested   │
╰────────────────────────────────────────────────────────────╯
```

Widget requirements:

- compact at narrow widths
- elapsed time based on job start, frozen on terminal state
- clear distinction between active, ready/open, stalled, and interrupt requested
- one shared refresh interval, active only while jobs exist
- clear the interval and widget when no jobs remain
- replace stale intervals on `/reload`
- use theme colors rather than hard-coded ANSI if practical
- read Pi's full TUI documentation before implementing

The widget is presentation only. Artifact/watcher state remains authoritative.

### 9. Restart and resume reattachment

Implement after the basic runtime is stable.

On `session_start` for startup/resume:

1. Determine the current session ID/file and its Herdr jobs artifact directory.
2. Scan versioned `metadata.json` files with `delivery: "pending"`.
3. Ignore jobs belonging to a different parent session.
4. Check current session entries for already-delivered custom messages by `jobId`.
5. If `result.json` exists and no terminal message was delivered, reconstruct the result and deliver it.
6. If the pane exists and no result exists, reconstruct `RunningJob` and restart the watcher.
7. If the pane is missing and no result exists, produce one bounded failure notification.
8. Restore widget rows.

Handle corrupt metadata defensively:

- skip unsupported versions
- notify the user through `ctx.ui.notify` rather than crashing extension startup
- never execute a persisted command again during reattachment

Do not relaunch jobs automatically. Reattachment observes only the pane/artifacts of an already-started job.

## Detailed implementation phases

### Phase 1: project setup and pure helpers

1. Read Pi extension and TUI docs completely.
2. Update dependencies and scripts in `package.json`.
3. Install dependencies and establish a passing baseline with `npm run check`.
4. Add TypeScript import settings if required.
5. Define job, artifact, lifecycle, and persisted metadata types.
6. Implement and test:
   - ID generation
   - shell quoting
   - Herdr JSON response parsing
   - artifact path construction
   - atomic JSON write/read
   - bounded log tail
   - lifecycle transitions/projections

Exit criteria:

- clean install works
- typecheck passes
- pure unit tests pass
- no Pi or Herdr process is needed for pure tests

### Phase 2: finite-job MVP

1. Implement Herdr availability checks and pane creation.
2. Implement generated `command.sh` and `run.sh`.
3. Implement `herdr_job_start` for `kind: finite`.
4. Implement sidecar-based watcher with pane disappearance handling.
5. Return immediately after launch.
6. Deliver terminal result via steer message.
7. Implement `herdr_jobs_list`, `herdr_job_read`, and `herdr_job_interrupt`.
8. Add the basic widget and result renderer.
9. Add unit tests with injected fake Herdr operations and fake clocks/delays.

Exit criteria:

- starting `sleep 5; echo done` returns promptly, Pi becomes idle, and completion wakes Pi roughly five seconds later
- non-zero exit is reported correctly
- Ctrl+C produces an interrupted/non-zero terminal result without losing tracking
- direct tool signal cancellation after launch does not cancel the watcher

### Phase 3: service readiness

1. Add `kind: service` and readiness parameters.
2. Implement incremental UTF-8 log scanning.
3. Deliver readiness exactly once.
4. Add readiness timeout without terminating the service.
5. Keep ready services in the widget and registry.
6. Add service-specific tests.

Exit criteria:

- a test server that prints a readiness line triggers a ready steer while continuing to run
- later service exit triggers a separate terminal steer
- a readiness timeout is reported once and does not kill the service

### Phase 4: lifecycle controls and resilience

1. Implement `herdr_job_close` and suppression semantics.
2. Add temporary Herdr inspection failure/stalled handling.
3. Preserve runtime across `/reload` with a global symbol.
4. Ensure old timers are cleared and new presentation adopts running jobs.
5. Add persisted metadata updates for state and delivery.
6. Add startup/resume reattachment.
7. Add duplicate-delivery detection using session entries.

Exit criteria:

- `/reload` during a job does not create duplicate watchers or lose completion
- restarting/resuming the same Pi session reattaches a still-running pane
- already-delivered results are not delivered again
- closing a job intentionally does not later report pane disappearance as an unexpected failure

### Phase 5: documentation and guidance

Update:

- `agent-includes/herdr.md`
- `docs/herdr-panes.md`
- repository `README.md`
- `extensions/README.md`

Guidance must state:

- prefer `herdr_job_start` for long-running tests, builds, servers, and watchers
- do not invoke `herdr wait`, sleeps, or polling loops through the parent `bash` tool after using the async job tool
- direct `herdr wait` remains appropriate for a genuinely short synchronous gate or as a fallback when the extension is unavailable
- use `subagent` for coding agents and `herdr_job_start` for ordinary commands
- completion and readiness are delivered automatically

Add examples:

Finite tests:

```ts
herdr_job_start({
  name: "tests",
  command: "npm test",
  kind: "finite"
})
```

Development server:

```ts
herdr_job_start({
  name: "dev server",
  command: "npm run dev",
  kind: "service",
  readyPattern: "Local:"
})
```

Noisy integration test with durable log inspection:

```ts
herdr_job_start({
  name: "integration",
  command: "npm run test:integration",
  kind: "finite",
  keepPane: true
})
```

## Testing strategy

### Unit tests

Use dependency injection rather than monkey-patching global process APIs.

Test at minimum:

#### Herdr parsing

- valid split response yields pane ID
- valid tab response yields root pane ID
- malformed JSON is rejected with operation context
- structured pane-not-found is distinguished from temporary unavailable errors
- Ctrl+C and close commands use exact argument arrays

#### Script generation

- paths containing spaces and single quotes are safe
- command content is not embedded in `pane run`
- generated wrapper captures `${PIPESTATUS[0]}` or equivalent real command status
- result publication is atomic
- unique completion marker contains job ID
- repeated finalization cannot overwrite a valid first result incorrectly

#### Artifacts

- session and temporary roots are correct
- atomic JSON round trip
- malformed transient result is retried/ignored safely
- bounded tail honors line and byte limits
- metadata versions are validated

#### Lifecycle

- launch -> running -> completed
- launch -> running -> failed
- running -> interrupt requested -> completed with 130
- waiting -> ready only once
- waiting -> readiness timed out only once
- transient pane errors -> stalled after threshold -> recovered
- intentional close suppresses unexpected disappearance failure
- delivery transitions are one-way

#### Watcher

- result sidecar wins over terminal fallback
- terminal fallback works when sidecar is absent
- missing pane gets artifact grace period
- abort stops polling without delivering
- tool-call signal and watcher signal are independent
- substring match spanning two log reads is found
- UTF-8 split across chunks is decoded correctly
- regex scanner remains bounded

#### Runtime/reload

- global runtime is adopted after simulated reload
- old widget interval is replaced
- exactly one watcher remains per job
- stale Pi API is replaced with latest runtime API
- shutdown suppresses delivery except on reload
- existing session result message prevents duplicate re-delivery

### Integration test in real Herdr

Guard with `HERDR_ENV=1` so normal unit tests can run elsewhere.

Test sequence:

1. Start a disposable finite job that sleeps briefly, prints output, and exits 0.
2. Assert the start tool/helper returns well before command completion.
3. Assert `output.log` contains expected output.
4. Assert `result.json` contains exit code 0.
5. Start a job that exits 7 and verify exit code propagation.
6. Start a service that prints a unique readiness line and then sleeps.
7. Verify readiness fires before process exit.
8. Interrupt the service and verify terminal handling.
9. Close all test panes in `finally` blocks.

If automating through a real Pi session is too expensive for the normal suite, provide:

- helper-level Herdr integration tests under `node --test`
- one documented manual end-to-end procedure through `pi -e .`

Never leave test panes or processes running after the suite.

## Manual end-to-end validation checklist

Run Pi inside Herdr with this package loaded:

```bash
cd /home/squiddity/projects/pi-tools
pi -e .
```

Validate each scenario:

1. **Finite success**
   - start `sleep 5; echo success`
   - confirm tool result returns immediately
   - confirm main Pi working indicator stops before five seconds elapse
   - confirm pane remains visible
   - confirm automatic completion steer and exit code 0

2. **Finite failure**
   - start `echo failure >&2; exit 9`
   - confirm automatic failure steer includes exit code 9 and bounded log tail

3. **Concurrent jobs**
   - start three sleeps with different durations
   - confirm all appear in widget
   - confirm main agent remains interactive
   - confirm each result arrives independently and only once

4. **Service readiness**
   - start a command that prints `READY_UNIQUE_TOKEN` and sleeps
   - confirm one readiness steer
   - confirm service remains tracked as ready
   - interrupt it and confirm later terminal result

5. **Noisy output**
   - generate output exceeding terminal visible history
   - confirm durable log remains complete
   - confirm completion still uses sidecar even if marker is no longer visible

6. **Reload**
   - start a 20-second job
   - run `/reload`
   - confirm one widget row and one eventual result

7. **Pane disappearance**
   - start a job and close its pane externally
   - confirm one clear watcher failure after grace period

8. **Intentional close**
   - close through `herdr_job_close`
   - confirm no unexpected-disappearance notification

9. **Session restart/resume**
   - start a longer job
   - quit Pi without killing the pane
   - resume the same session
   - confirm reattachment and one eventual result

## Error handling requirements

All failures must be explicit and bounded.

Launch errors:

- Herdr unavailable
- missing `HERDR_PANE_ID`
- invalid cwd
- invalid readiness regex
- pane creation failure
- malformed Herdr response
- shell startup/run failure

Watcher errors:

- temporary Herdr socket unavailable
- pane missing before result
- malformed or wrong-ID result artifact
- log read error
- unsupported metadata version
- aborted watcher

Rules:

- Throw from a Pi tool only when the tool execution itself should be marked failed.
- Background watcher failures cannot throw into the completed tool call; convert them into lifecycle state plus a steer notification.
- Include job ID, pane ID, artifact path, and remediation in error details where available.
- Do not include unbounded command output or sensitive environment dumps.
- Cleanup must be idempotent.

## Concurrency and race conditions to handle

- The command can finish before the watcher starts. Check `result.json` immediately on watcher entry.
- The pane can disappear just before the sidecar rename. Use a short bounded artifact grace window.
- `/reload` can happen while a watcher callback is about to deliver. Use delivery gating in shared runtime.
- A readiness line can arrive in the same chunk as terminal completion. Readiness may be delivered before the terminal result if not already delivered; document and test ordering.
- Multiple jobs can finish in the same event-loop tick. Each must retain its own ID, artifacts, and delivery gate.
- User interrupt and natural completion can race. The result artifact decides the terminal exit code.
- Explicit close and pane-missing observation can race. Record suppression before invoking pane close.
- A stale pre-interrupt status must not overwrite `interrupt_requested` unless new evidence shows the process continued.

## Performance constraints

- No blocking `herdr wait` inside tool execution.
- Avoid synchronous filesystem scans on every widget tick.
- One widget refresh interval for all jobs.
- Watcher polling around 500-1000 ms is sufficient; do not busy-loop.
- Incremental log reads only.
- Cap regex rolling buffer and LLM-visible output.
- Herdr pane inspection may run less frequently than artifact checks, for example every 2-5 seconds, to reduce CLI/socket load.

## Security and correctness constraints

- Treat `command` as intentionally executable shell input supplied to a privileged coding agent tool.
- Never concatenate command text into a Herdr CLI shell invocation.
- Use `execFile` with argument arrays for Herdr.
- Validate and normalize paths before use.
- Keep artifacts within the selected session/temp job directory.
- Use restrictive file modes where practical (`0700` directory/scripts, `0600` metadata/results/logs if compatible with execution needs).
- Do not follow arbitrary persisted artifact paths outside the expected root during reattachment.
- Validate job IDs before using them as path components.
- Ensure a persisted metadata file cannot cause the extension to execute a command on startup.
- Do not close or interrupt panes not registered to the current runtime/session without explicit validated reattachment.

## Acceptance criteria

The implementation is complete only when all of the following are true:

1. `herdr_job_start` returns promptly after pane launch and does not remain active for the job duration.
2. Pi's built-in working message is not shown for the whole background execution.
3. The main agent can continue unrelated work or become idle while jobs run.
4. Finite success and failure produce automatic steer messages with accurate exit codes.
5. Service readiness produces one automatic steer without ending tracking.
6. Logs are durable and result messages are bounded.
7. Multiple jobs run and complete independently.
8. Interrupt keeps tracking alive until terminal evidence appears.
9. Pane disappearance and temporary Herdr failures are distinguished.
10. `/reload` neither loses jobs nor duplicates watchers/results.
11. Session resume reattaches pending jobs or reports a clear bounded failure.
12. The widget reflects state without manipulating Pi's working indicator.
13. `npm run check` passes from a clean install.
14. Real Herdr end-to-end validation passes and leaves no orphaned test panes.
15. Agent guidance clearly prefers the async tool over parent-side `herdr wait` for long jobs.

## Recommended implementation order for the new session

The implementing model should proceed in this order:

1. Read `AGENTS.md`, this plan, Pi `extensions.md`, and Pi `tui.md` completely.
2. Inspect the pinned subagent source files listed above.
3. Create a todo list reflecting Phases 1-5.
4. Establish dependency/typecheck/test baseline.
5. Implement pure types, artifacts, lifecycle, and Herdr parsing with tests.
6. Implement finite-job launch and sidecar watcher before any widget polish.
7. Run a real `sleep` job inside Herdr and prove the Pi tool returns immediately.
8. Add notifications and controls.
9. Add service readiness.
10. Add reload/resume resilience.
11. Add widget and custom renderers.
12. Update guidance/docs.
13. Run the full automated and manual validation checklist.

Do not begin by editing AGENTS guidance alone. The async extension must exist and be tested before instructions tell models to rely on it.
