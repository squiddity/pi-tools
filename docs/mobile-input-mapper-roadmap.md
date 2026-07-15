# Mobile terminal input mapper and Pi interaction roadmap

## Status and intent

This document records the design analysis that followed the successful `ui-catalog` tap experiment. It is a proposed roadmap, not a committed Pi API or a promise that every phase will be implemented.

The ordering is deliberate:

1. Build a useful configurable input mapper as an extension, with **no Pi core changes**.
2. Prove it first with `ask_user_question`, then use the same mapper with other independently developed overlays and plugins.
3. Add two narrowly scoped Pi primitives only after the extension-first approach exposes concrete lifecycle and coordinate problems:
   1. a mouse-reporting lease;
   2. overlay-local coordinate conversion.
4. Improve the mapper and cooperating external plugins after each primitive lands.
5. Only then pursue core-owned interaction regions, application actions, and individual transcript-block expansion.

The central rule is: **Pi core should own only facts an extension cannot safely know or coordinate.** Protocol decoding, gestures, mobile policy, mappings, and plugin-specific behavior should remain outside core.

## Implementation status (2026-07-15)

Recommended implementation steps **1** and **2** are complete in this repository:

- [`extensions/ui-catalog/index.ts`](../extensions/ui-catalog/index.ts) exposes `/ui-wheel-list`, a disposable wheel-to-list experiment; its selection behavior has unit coverage.
- [`extensions/input-mapper/index.ts`](../extensions/input-mapper/index.ts) supplies the extension-only mapper MVP: SGR parsing, one-report-to-one-key mapping, tool lifecycle activation, direct mouse ownership through a persistent zero-line widget, JSON configuration, diagnostics, and `/input-map off` cleanup.
- Profiles are configuration-owned, not built in. The Ask profile is installed for the playground in [`../ui-playground/.pi/input-mapper.json`](../ui-playground/.pi/input-mapper.json), with the same reusable sample at [`input-mapper.ask-user-question.example.json`](input-mapper.ask-user-question.example.json).

This means the implementation work for those two recommended steps is complete; it does **not** claim that every Phase 1 exit criterion is complete. In particular, the independent-plugin validation in recommended step 3, broader Ask scenario testing, and cross-transport/manual compatibility coverage remain outstanding.

## Executive summary

Pi 0.80.7 already preserves complete SGR mouse reports and exposes a raw terminal input transformer to extensions. A mapper extension can therefore convert a Termux wheel report into Up/Down, or a tap into Enter, before the focused overlay receives the input. `ask_user_question` already understands those keys.

The first useful release does not need a `PointerEvent`, `handlePointer()`, gesture framework, transcript component access, or any Pi patch. It needs:

- one extension that owns mouse reporting;
- an SGR parser;
- activation profiles;
- one-report-to-one-key mappings;
- diagnostics, configuration, and a kill switch;
- lifecycle scoping around tools such as `ask_user_question`.

That release can provide natural Termux vertical swipe navigation and tap-to-activate-the-current-row. It cannot reliably select an arbitrary tapped row in another extension because the mapper does not own that extension's wrapped layout or state.

After the mapper proves useful, the smallest production hardening changes are:

- **Core change 1 — mouse-reporting lease:** reference-count and restore global terminal mouse modes.
- **Core change 2 — overlay-local coordinates:** let an overlay owner translate terminal coordinates through Pi's final committed layout.

Neither change gives a mapper private access to another extension. Cooperating plugins should use a tiny mapper SDK or an instance-scoped event/control contract to publish lifecycle, targets, and semantic actions.

The final phase adds a narrow core action hit-test for visible core-owned affordances. That enables a mobile extension to tap `▶ … Ctrl+O to expand` and invoke only that block's local action while retaining `Ctrl+O` as expand/collapse all.

## Goals

- Make Pi overlays comfortable to operate one-handed in Termux.
- Reuse existing keyboard behavior rather than duplicate state transitions.
- Keep keyboard operation complete and visible.
- Make the mapper useful for third-party extensions, not just `ask_user_question`.
- Allow project- and user-level declarative mappings.
- Let an agent inspect installed extension source and propose mappings with confidence and limitations.
- Scope mouse reporting to an active surface or explicit review mode.
- Preserve native terminal scrolling and text selection whenever interactive mouse reporting is not needed.
- Keep Pi core changes small, protocol-neutral where possible, and independently reviewable.

## Non-goals

- A DOM-style pointer event tree, capture, bubbling, or hover system.
- Multitouch, pressure, pointer IDs, or Android-native touch semantics.
- Automatic mutation or monkey-patching of installed extensions.
- Arbitrary JavaScript embedded in ordinary JSON configuration.
- Reliable tapping of terminal-owned historical scrollback.
- Permanent global mouse reporting as the default.
- Replacing keyboard controls or removing key hints.
- Treating a terminal report as proof that the source was a finger rather than a mouse.

## Principles

### Extension-first

If an extension owns the renderer, state, and actions, it should own hit testing and gesture semantics too. Core should not learn the meaning of an option row, a swipe threshold, or a plugin's Submit button.

### Transform existing input before inventing new actions

When a focused component already understands Up, Down, Left, Right, Enter, Space, or Escape, the mapper should translate into those inputs. This keeps the extension's existing reducer, keybinding behavior, accessibility hints, and tests authoritative.

### One global mouse owner

Terminal mouse reporting is global process state. During the extension-only phases, one mapper extension must own it. Independent extensions should not each write competing DECSET/DECRST sequences.

### Render-derived coordinates

Never duplicate hard-coded terminal coordinates in production. Targets must derive from the surface's current render, accounting for wrapping, Unicode width, terminal resize, overflow clipping, and overlay placement.

### Semantic targets, not invisible panels

Tap only an explicit affordance such as `▶ UI catalog`, an option row, a tab, or a labeled action. Do not make an entire transcript message an invisible button.

### Activate on release

A press records a candidate. Activation occurs only when release resolves to the same candidate and no wheel/motion event has turned the interaction into a gesture. Cancel the candidate if focus, surface instance, profile, or layout generation changes between press and release.

### Fail safe

Unrecognized SGR reports should be consumed while a profile owns mouse mode rather than leaking escape bytes into the editor. Destructive actions retain explicit confirmation. `/input-map off` must immediately restore normal terminal behavior.

## Terminology and ownership layers

| Layer | Example | Recommended owner |
|---|---|---|
| Terminal report | press, release, wheel, motion at `(x,y)` | Mapper/shared parser |
| Gesture | tap, swipe, drag, repeated wheel navigation | Mapper |
| Surface | active questionnaire or review overlay instance | Owning plugin + mapper lifecycle |
| Hit target | option 2, Next, Submit, `▶ read` | Owning plugin; core only for core UI |
| Semantic action | `nav.next`, `confirm`, `toggleExpanded` | Owning plugin/core component |
| Terminal mode lifetime | enable/disable SGR mouse reporting | Mapper first; Pi lease later |
| Final overlay placement | terminal-to-local coordinate conversion | Pi TUI after core change 2 |

## Research baseline

The installed runtime used for this analysis is Pi/TUI 0.80.7. This repository currently declares Pi development dependencies at 0.80.6, so implementation work must either verify compatibility with both versions or upgrade the development pins deliberately before relying on a newly added API.

### Pi input handling already supports raw mouse reports

Pi's terminal starts raw input, bracketed paste, and keyboard protocol negotiation, but does not enable mouse reporting ([`terminal.ts`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/tui/src/terminal.ts#L134-L167)).

`StdinBuffer` explicitly buffers fragmented SGR reports until `CSI < b ; x ; y M/m` is complete ([`stdin-buffer.ts`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/tui/src/stdin-buffer.ts#L1-L14), [`isCompleteCsiSequence`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/tui/src/stdin-buffer.ts#L84-L125)). An extension does not need its own byte-chunk accumulator when it subscribes through Pi's normal input path.

Extensions can register `ctx.ui.onTerminalInput(handler)` ([`types.ts`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/coding-agent/src/core/extensions/types.ts#L126-L140)). Input listeners run before focus dispatch and may consume or replace one input string ([`tui.ts`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/tui/src/tui.ts#L761-L834)). The resulting string is then delivered once to the focused component.

Custom components and widget factories receive the `TUI` instance ([`types.ts`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/coding-agent/src/core/extensions/types.ts#L164-L205)), so an experiment can write mouse enable/disable sequences through `tui.terminal.write(...)`. Normal custom-component closure invokes `dispose()` ([`interactive-mode.ts`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L2462-L2478)). Direct writes are sufficient for a proof but are not a composable lifecycle contract.

### Existing dispatch order

```text
stdin bytes
  -> StdinBuffer emits one complete sequence
  -> onTerminalInput listeners run in registration order
       -> consume: stop
       -> data: replace current sequence
  -> TUI resolves visible focused overlay/editor
  -> focusedComponent.handleInput(result)
  -> requestRender()
```

This makes a mapper middleware possible without modifying the focused extension.

### One report can become only one input event

Returning this works:

```ts
return { data: "\x1b[B" }; // Down
```

Returning this does not mean three separately dispatched inputs:

```ts
return { data: "\x1b[B\x1b[B\r" }; // not Down, Down, Enter
```

The replacement is not passed through `StdinBuffer` again. The focused component receives one concatenated string, and ordinary `matchesKey()` calls will not recognize it. The roadmap intentionally avoids unsupported `process.stdin.emit()` recursion or private focused-component calls.

### `ask_user_question` is a good first profile

The questionnaire already routes Up/Down selection, Left/Right tab switching, Enter confirmation, and Space toggling through its key router ([`key-router.ts`](https://github.com/juicesharp/rpiv-mono/blob/05aa1b038afbe62b516ab834b064f0e55e9e7598/packages/rpiv-ask-user-question/state/key-router.ts#L100-L113), [selection handling](https://github.com/juicesharp/rpiv-mono/blob/05aa1b038afbe62b516ab834b064f0e55e9e7598/packages/rpiv-ask-user-question/state/key-router.ts#L164-L211)).

Pi emits `tool_execution_start` and `tool_execution_end` with `toolName` and `toolCallId` ([`types.ts`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/coding-agent/src/core/extensions/types.ts#L747-L772)). Those events can arm and disarm a profile for `ask_user_question` even when the mapper does not own its overlay.

Ask also publishes `rpiv:ask-user:prompt` with JSON-safe questions and option metadata. It is useful for notifications and analysis, but currently has no matching close event, instance ID, active tab/index, focus state, or control channel. Tool execution lifecycle is therefore the safer initial activation boundary.

### Termux behavior shapes the gesture design

With terminal mouse tracking active, a stationary Termux finger interaction emits left press/release reports, while finger scrolling is converted to repeated wheel reports rather than button-motion reports ([`TerminalView.java`](https://github.com/termux/termux-app/blob/3df69d1da197dd9bd71a3bafd902dffd720576b4/terminal-view/src/main/java/com/termux/view/TerminalView.java#L140-L183), [`doScroll`](https://github.com/termux/termux-app/blob/3df69d1da197dd9bd71a3bafd902dffd720576b4/terminal-view/src/main/java/com/termux/view/TerminalView.java#L573-L586)).

Consequences:

- `1000 + 1006` is enough for taps and Termux vertical swipe-as-wheel navigation.
- `1002` is relevant for physical mouse/client button-motion, not required for stock Termux finger swipes.
- Horizontal finger swipe should not be promised on stock Termux.
- Long press remains terminal text selection and should not be stolen.
- While mouse tracking is active, Termux sends wheel reports to Pi instead of changing native terminal scrollback. Reporting must be scoped.

## Capability and blocker matrix

| Desired behavior | Pi core change? | Owning change |
|---|---:|---|
| Parse SGR press/release/wheel | No | Mapper/shared helper |
| Map wheel to Up/Down in focused picker | No | Mapper profile |
| Map tap to Enter on current selection | No | Mapper profile |
| Map fixed screen zones to one key | No | Mapper profile |
| Scope mapper to a tool call | No | Mapper + Pi tool lifecycle |
| Directly tap arbitrary Ask row from a separate extension | Not generically | Ask integration or surface SDK |
| Direct Ask row taps implemented inside Ask | No | Ask package |
| Safely compose multiple mouse users | Yes, later | Mouse-reporting lease |
| Convert terminal coordinates through actual overlay layout | Yes, later | `OverlayHandle.toLocalPoint()` |
| Invoke several synthetic keys for one tap | Not planned | Prefer semantic plugin action |
| Invoke private core app actions from a mobile palette | Later core API | App action registry |
| Tap one built-in transcript block | Later core API | Core action hit regions + local block state |
| Tap historical terminal scrollback | Not robustly possible | Pi-owned review overlay |

## Proposed package shape

The mapper should eventually follow the repository's feature-family layout:

```text
extensions/input-mapper/index.ts
src/input-mapper/
  config.ts
  profiles.ts
  sgr.ts
  mapping.ts
  activation.ts
  diagnostics.ts
  analyzer.ts
  sdk.ts
  types.ts
test/input-mapper/
  config.test.ts
  sgr.test.ts
  mapping.test.ts
  activation.test.ts
  diagnostics.test.ts
  analyzer.test.ts
```

The implementation should begin in the UI playground or a dedicated project-local extension before it becomes part of the installed package.

## Mapper architecture

### Input broker

One `onTerminalInput` listener parses recognized reports, consults the active profile stack, consumes handled mouse reports, and either substitutes one supported input or performs a mapper-owned action.

### Mouse owner

Before core change 1, a persistent zero-line widget can obtain the `TUI` instance and own direct enable/disable writes. It is an experimental bridge, not a desirable long-term public pattern.

The owner tracks active profile references so overlapping tool calls do not disable reporting prematurely. It disables reporting on profile completion, widget disposal, mapper shutdown, `/input-map off`, and known extension reset paths.

### Activation manager

Profiles may activate through:

- `tool_execution_start/end` keyed by `toolCallId`;
- explicit `/input-map use <profile>`;
- an extension event contract with open/close instance IDs;
- a cooperating surface registration through the mapper SDK;
- a future Pi active-surface API only if concrete integrations prove lifecycle events insufficient.

The active profile should be a stack or priority set, not a single global string. The most recently focused registered surface wins; tool-call activation alone is a coarse fallback.

### Mapping engine

The first engine supports one report to one known input:

```text
wheel-up     -> up
wheel-down   -> down
left-release -> enter
right-click  -> escape (disabled by default)
```

It should support conditions such as terminal columns/rows, edge zones, modifiers, active tool, and explicit mode. Gesture configuration should include a movement threshold, axis lock, bounded/coalesced motion handling, and at most one discrete action per recognized gesture. A wheel stream may intentionally produce repeated navigation, but a drag release must never produce an extra tap. The engine should not infer private option state.

### Diagnostics

A diagnostic view should show:

- active profile and activation reason;
- raw escaped sequence;
- decoded report;
- terminal coordinates;
- matched mapping and condition;
- substituted key name and bytes;
- consume/pass decision;
- current mouse owner/lease state;
- unknown-report count;
- cleanup status.

Diagnostics must redact ordinary typed/pasted content by default and record only pointer reports unless the user explicitly enables broader tracing.

### Agent analyzer

The analyzer inspects an extension's source and configuration for:

- `ctx.ui.custom()`, `select()`, `confirm()`, and widget surfaces;
- `handleInput(data)`;
- `matchesKey(data, Key.*)`;
- `keybindings.matches(data, "tui.select.*")`;
- Enter/Space confirmation branches;
- tab navigation;
- tool names and lifecycle events;
- extension-specific open/close events;
- overlay dimensions and layout ownership.

It emits proposals with confidence:

- **High:** one pointer report maps to one explicitly supported key.
- **Medium:** a fixed zone maps to one supported key.
- **Low:** inferred coordinates duplicate private wrapping/layout.
- **Blocked:** private state/action or multiple independent input events are required.

The analyzer proposes; it never silently enables mappings or patches installed packages.

## Configuration model

Illustrative configuration locations:

```text
~/.pi/agent/input-mapper.json       # user defaults
<project>/.pi/input-mapper.json     # project overrides
```

Project settings override profile fields by profile ID. Unknown fields are rejected initially; schema migrations must be explicit. Resolution order, inheritance, and provenance must be shown by `/input-map status` and dry-run output. Project profiles are honored only for trusted projects; generated adapters are trusted extension code and require explicit review. Environment matching may select a profile but must not silently broaden its action permissions.

The examples below evolve across phases and are illustrative rather than a frozen schema.

## Phase 0 — Preserve the proof and define the protocol boundary

### State

Completed experimentally:

- SGR reporting reaches a focused Pi component through Herdr.
- Exact text-cell hit testing works.
- A tap can toggle local folded/expanded state.
- Pi's input buffer preserves complete reports.
- `/ui-wheel-list` maps SGR wheel reports to ordinary list Up/Down navigation.

### Work

- Keep `ui-catalog` disposable.
- Expand parser tests for press, release, wheel, modifiers, malformed input, and concatenated events as Pi delivers them.
- Add a list experiment that maps Termux wheel reports to Up/Down.
- Verify directly in Termux as well as Herdr.
- Record terminal/multiplexer versions in manual test results.

### Phase 0 configuration

The playground now loads the disposable catalog and mapper extensions. Its Ask profile lives separately in `.pi/input-mapper.json`; Phase 0 itself still uses `/ui-wheel-list` only to prove raw transport and keyboard-list behavior.

```json
{
  "extensions": [
    "../../extensions/ui-catalog",
    "../../extensions/input-mapper"
  ]
}
```

### Exit criteria

- Tap and wheel diagnostics are repeatable.
- Escape/keyboard fallback always works.
- Mouse mode is restored after normal close.
- Known cleanup leaks are documented before mapper MVP.

## Phase 1 — Mapper MVP with zero Pi core changes

### Scope

**Implementation status:** complete for recommended step 2. The MVP is in `extensions/input-mapper/` with helpers/tests under `src/input-mapper/` and `test/input-mapper/`. Its profile data is declarative JSON; no Ask-specific profile remains hardcoded.

- One global input broker.
- Direct `1000 + 1006` ownership through a persistent mapper widget.
- A passive mode for transports that already emit useful keys/reports and do not need the mapper to enable terminal modes.
- Activation by tool start/end or manual command.
- One-report-to-one-key substitutions.
- User/project JSON configuration.
- `/input-map on`, `off`, `status`, `diagnose`, and `test`.
- Keyboard behavior unchanged when no profile is active.

### Ask-first example

```json
{
  "version": 1,
  "profiles": {
    "ask-user-question": {
      "activate": {
        "tool": "ask_user_question"
      },
      "mouse": {
        "protocol": "sgr",
        "tracking": "buttons"
      },
      "gestures": {
        "thresholdCells": 2,
        "axisLockRatio": 1.5,
        "suppressTapAfterWheel": true
      },
      "mappings": [
        { "report": "wheel-up", "send": "up" },
        { "report": "wheel-down", "send": "down" },
        { "report": "left-release", "send": "enter" }
      ]
    }
  }
}
```

Expected behavior:

- Swipe up through Termux wheel-down reports advances the selection.
- Swipe down moves backward.
- Tap activates the already-focused row.
- Existing Enter/Space/Escape and arrow keys continue to work.

Tap-to-Enter is intentionally conservative: it does not claim that the tapped row is the focused row.

### Example: hypothetical external approval plugin

Assume a third-party tool named `deployment_review` already supports arrow navigation, Enter confirmation, Space toggling, and Escape cancellation.

```json
{
  "version": 1,
  "profiles": {
    "deployment-review": {
      "activate": {
        "tool": "deployment_review"
      },
      "mouse": {
        "protocol": "sgr",
        "tracking": "buttons"
      },
      "mappings": [
        { "report": "wheel-up", "send": "up" },
        { "report": "wheel-down", "send": "down" },
        { "report": "left-release", "send": "enter" },
        {
          "report": "left-release",
          "when": { "column": "right-edge:8" },
          "send": "space"
        }
      ]
    }
  }
}
```

This is already valuable for any strong keyboard-driven plugin: mobile navigation works without modifying that plugin.

### Limitations accepted in phase 1

- The mapper does not know which overlay is actually focused while a tool remains active.
- A nested overlay could receive transformed input.
- Direct mode writes are not reference-counted by Pi.
- Normal custom overlay reset may bypass the overlay's own `dispose()` closure.
- Fixed zones are terminal-global rather than overlay-local.
- One tap cannot become Down, Down, Enter.
- Horizontal finger swipe is not promised in Termux.
- Direct arbitrary-row taps are unavailable.

### Exit criteria

- Ask can be navigated and confirmed in Termux with no Ask or Pi modification.
- Single-select, multi-select, custom input, notes, Submit/Cancel, collapsed state, and cancellation are tested without accidental input.
- At least one independent keyboard-driven plugin can use a declarative profile.
- Tool-call IDs correctly balance overlapping activation.
- Non-default keybindings are either configurable or diagnosed clearly.
- Listener ordering and coexistence with another terminal-input transformer are deterministic and documented.
- Unsupported transports degrade to unchanged keyboard operation.
- `/input-map off` always disables reporting immediately.
- Reload, session replacement, normal exit, tool error, and cancellation have explicit tests/manual checks.

## Phase 2 — Mapper ecosystem and agent-generated profiles, still no Pi core changes

### Goals

- Make configuration scalable beyond tool-name heuristics.
- Give cooperating plugins an optional lifecycle/action contract.
- Let an agent analyze all configured/installed extension sources and propose profiles.
- Keep runtime monkey-patching out of scope.

### Mapper SDK

A tiny optional SDK can expose an in-process surface registry:

```ts
registerInputSurface({
  profileId: "deployment-review",
  instanceId: toolCallId,
  isActive: () => true,
  dispatch: (action) => reviewSession.dispatch(action),
});
```

Initial actions remain plugin-defined. The mapper does not prescribe a universal questionnaire reducer.

A plugin that does not import the SDK can publish JSON-safe lifecycle events instead:

```text
pi-input:surface-open
pi-input:surface-close
pi-input:surface-focus
```

Payloads should include `profileId` and `instanceId`. Open/close must pair; focus is advisory.

### Suggested Ask lifecycle improvement

Ask may add, without changing Pi:

```text
rpiv:ask-user:open
rpiv:ask-user:close
rpiv:ask-user:focus
```

with an instance/tool-call ID. This fixes coarse tool-lifetime activation and allows the mapper to suspend Ask mappings when Ask is hidden or another surface owns focus.

A later Ask SDK integration may expose semantic actions:

```text
nav.previous
nav.next
activate.current
multi.toggleCurrent
tab.previous
tab.next
cancel
```

This is preferable to synthesizing private state changes.

### Analyzer commands

```text
/input-map inspect ask_user_question
/input-map inspect-all
/input-map propose ask_user_question
/input-map write ask_user_question --project
/input-map test ask-user-question
```

`inspect-all` should enumerate configured extension paths and package manifests, then inspect likely UI entry points. It should not recursively parse every dependency on every startup; analysis is an explicit agent/tool task with cached results keyed by package version and file hashes.

### Analyzer output example

```text
ask_user_question 1.20.0

High confidence
  wheel-up   -> tui.select.up
  wheel-down -> tui.select.down
  tap        -> tui.select.confirm (current row only)

Conditional
  left/right -> previous/next tab outside inline text modes

Blocked externally
  direct option-row tap
  reason: private wrapped-row layout, overflow window, and selected index
```

### Phase 2 configuration

```json
{
  "version": 2,
  "profiles": {
    "ask-user-question": {
      "activate": {
        "eventOpen": "rpiv:ask-user:open",
        "eventClose": "rpiv:ask-user:close",
        "fallbackTool": "ask_user_question"
      },
      "mouse": { "tracking": "buttons" },
      "mappings": [
        { "report": "wheel-up", "action": "nav.previous", "fallbackSend": "up" },
        { "report": "wheel-down", "action": "nav.next", "fallbackSend": "down" },
        { "report": "left-release", "action": "activate.current", "fallbackSend": "enter" }
      ]
    },
    "deployment-review": {
      "activate": {
        "eventOpen": "deployment-review:open",
        "eventClose": "deployment-review:close",
        "fallbackTool": "deployment_review"
      },
      "mouse": { "tracking": "buttons" },
      "mappings": [
        { "report": "wheel-up", "action": "selection.previous", "fallbackSend": "up" },
        { "report": "wheel-down", "action": "selection.next", "fallbackSend": "down" },
        { "report": "left-release", "action": "selection.activate", "fallbackSend": "enter" }
      ]
    }
  }
}
```

If a plugin registers semantic actions, the mapper invokes them. Otherwise it uses the single-key fallback. The external profile demonstrates that the lifecycle/action contract is not Ask-specific.

### Generated adapter modules

When JSON is insufficient, an agent may generate an explicitly reviewed project-local adapter:

```text
.pi/extensions/input-mappings/<profile>.ts
```

Generated modules use a stable mapper SDK. They must not import or patch unexported package internals by default. Arbitrary code remains visible extension code, not hidden JSON evaluation.

### Exit criteria

- Profiles can activate through paired instance-scoped events.
- The analyzer reports confidence and blockers.
- Generated changes require user review.
- At least two unrelated external plugins use either key fallback or semantic SDK actions.
- No Pi core patch is required.

## Phase 3 — Core change 1: scoped mouse-reporting lease

### Problem

Direct `tui.terminal.write()` is process-global and not reference-counted. One extension can disable a mode another still needs. Pi's terminal stop/suspend restores modes it owns, but does not know about extension-written mouse modes.

### Minimal API

```ts
const release = ctx.ui.acquireMouseReporting({
  protocol: "sgr",
  tracking: "buttons"
});
```

Later, `tracking: "drag"` may request button-motion mode for clients that provide it.

### Required semantics

- First lease enables reporting; last release disables it.
- Release is idempotent.
- Leases are associated with the extension runtime that acquired them.
- Extension reload/session teardown forcibly releases that runtime's leases.
- TUI stop/suspend disables physical modes.
- TUI restart/resume reapplies still-live logical leases.
- Stronger tracking wins while requested; releasing it falls back to remaining requirements.
- The API is unavailable or a clear no-op outside interactive TUI mode.
- Core manages named modes, not arbitrary caller-provided escape strings.
- Documentation includes `reset`/recovery guidance for unavoidable SIGKILL, terminal disconnect, or transport failures that bypass cleanup.

### Mapper improvement

Remove direct DECSET/DECRST writes and the zero-line widget used only to capture `TUI`. The mapper requests a lease when the first active profile requires mouse reports and releases it when the last profile ends.

### Phase 3 configuration

Configuration remains mostly stable; ownership becomes explicit:

```json
{
  "version": 3,
  "mouse": {
    "owner": "pi-lease",
    "defaultTracking": "buttons"
  },
  "profiles": {
    "ask-user-question": {
      "activate": { "tool": "ask_user_question" },
      "requiresMouse": true,
      "mappings": [
        { "report": "wheel-up", "send": "up" },
        { "report": "wheel-down", "send": "down" },
        { "report": "left-release", "send": "enter" }
      ]
    },
    "deployment-review": {
      "activate": {
        "eventOpen": "deployment-review:open",
        "eventClose": "deployment-review:close"
      },
      "requiresMouse": true,
      "mappings": [
        { "report": "wheel-up", "action": "selection.previous", "fallbackSend": "up" },
        { "report": "wheel-down", "action": "selection.next", "fallbackSend": "down" },
        { "report": "left-release", "action": "selection.activate", "fallbackSend": "enter" }
      ]
    }
  }
}
```

The same lease safely serves Ask and a simultaneously registered external review surface. `owner` may be omitted once all supported Pi versions have the lease. A compatibility mode can retain direct ownership for older Pi versions, with a visible warning.

### Exit criteria

- Two simulated extensions can overlap leases without disabling each other.
- Suspend/resume restores the correct state.
- Reload cannot leak mouse mode.
- The mapper no longer needs an invisible widget merely to control terminal modes.
- Pi's default behavior remains unchanged when no lease exists.

## Phase 4 — Core change 2: overlay-local coordinate conversion

### Problem

An overlay extension can calculate its own local rows but should not duplicate Pi's private anchoring, clamping, margins, width limits, `maxHeight`, clipping, and resize behavior.

### Minimal owner-scoped API

```ts
handle.toLocalPoint(column, row):
  { column: number; row: number } | undefined
```

Coordinates passed in are one-based or explicitly typed as terminal coordinates; returned coordinates should be documented as zero-based local cells.

The method uses the last committed layout and returns `undefined` when:

- outside the overlay;
- hidden;
- not yet rendered;
- clipped out;
- the handle is no longer live.

### Why owner-scoped

The method belongs to the `OverlayHandle` given to the overlay owner. It must not let unrelated extensions inspect the overlay stack or retrieve mutable components.

This means the mapper does not magically gain another extension's handle. A cooperating plugin must register its surface with the mapper SDK or perform local hit testing itself.

### Mapper SDK evolution

```ts
registerInputSurface({
  profileId: "ask-user-question",
  instanceId: toolCallId,
  toLocalPoint: handle.toLocalPoint,
  targets: () => session.visibleTargets(),
  dispatch: (action) => session.dispatch(action)
});
```

The mapper continues to own terminal reports and gesture recognition. The plugin owns target geometry and actions.

### Phase 4 Ask example

After a small Ask integration, configuration can describe semantic target behavior rather than terminal-global guesses:

```json
{
  "version": 4,
  "profiles": {
    "ask-user-question": {
      "activate": { "surface": "ask-user-question" },
      "mappings": [
        { "report": "wheel-up", "action": "nav.previous" },
        { "report": "wheel-down", "action": "nav.next" },
        { "gesture": "tap", "targetRole": "option", "action": "target.focusOrActivate" },
        { "gesture": "tap", "targetRole": "tab", "action": "target.activate" },
        { "gesture": "tap", "targetRole": "submit", "action": "target.activate" },
        { "gesture": "tap", "targetRole": "cancel", "action": "target.activate" }
      ]
    }
  }
}
```

Recommended Ask semantics:

- tap an unfocused option: focus and show preview;
- tap the focused option again: confirm;
- tap a multi-select option: toggle;
- tap Next/Submit/Cancel explicitly;
- tap question tabs directly;
- retain keyboard controls and hints.

### Example: strong external code-review plugin

A cooperating review overlay can expose targets such as `file-tab`, `hunk`, `comment`, `approve`, and `request-changes`.

```json
{
  "version": 4,
  "profiles": {
    "code-review-mobile": {
      "activate": { "surface": "code-review" },
      "mappings": [
        { "report": "wheel-up", "action": "selection.previous" },
        { "report": "wheel-down", "action": "selection.next" },
        { "gesture": "tap", "targetRole": "file-tab", "action": "target.activate" },
        { "gesture": "tap", "targetRole": "hunk", "action": "target.toggleExpanded" },
        { "gesture": "tap", "targetRole": "comment", "action": "target.openEditor" },
        { "gesture": "tap", "targetRole": "approve", "action": "target.confirmedActivate" },
        { "gesture": "tap", "targetRole": "request-changes", "action": "target.confirmedActivate" }
      ]
    }
  }
}
```

This is the target architecture for strong external plugins: the mapper supplies portable reports and gestures; the plugin supplies current targets and safe semantic actions.

### Exit criteria

- `ui-catalog` removes its duplicated bottom-center overlay arithmetic and uses the committed local-coordinate API.
- No cooperating plugin duplicates Pi overlay placement logic.
- Resize, stacked overlays, occlusion where applicable, and `maxHeight` clipping tests preserve accurate local points.
- Ask supports direct option/tab/footer taps through a small supported integration, not monkey-patching.
- At least one unrelated external plugin exposes dynamic target roles/actions.
- Uncooperative plugins still receive phase 1 key mappings.

## Phase 5 — Mapper maturity and mobile interaction catalog

This phase broadens value without yet making core transcript content clickable.

### Features

- Profile priority and focus arbitration.
- Per-terminal compatibility settings for Termux, Herdr, SSH, tmux, and physical mouse.
- Gesture rate limiting for wheel bursts/fling.
- Visible touch-mode status.
- Configurable left/right-handed action placement in cooperating surfaces.
- Import/export of reviewed profiles.
- Version constraints and file-hash invalidation for analyzer proposals.
- A generated Termux extra-key preset with Escape, Ctrl, Tab, arrows, PageUp/PageDown, and a mapper toggle key.
- Optional Termux notifications, clipboard helpers, and wake-lock guidance kept outside Pi core.

### High-value external surfaces

- Questionnaires and approval dialogs.
- Model/session/settings selectors supplied by plugins.
- Review and deployment gates.
- Herdr job cards and log viewers.
- Todo/task overlays.
- Mobile action sheets implemented by an extension for extension-owned actions.
- Prompt helper overlays for Send, Newline, history, and clipboard-image actions where supported.

Scrollable cooperating surfaces should expose explicit Page Up, Page Down, Jump to Latest, and Copy actions whenever mouse reporting replaces native terminal scrolling.

### Phase 5 configuration

```json
{
  "version": 4,
  "compatibility": {
    "termux": {
      "horizontalSwipe": false,
      "longPress": "terminal-selection",
      "wheelBurstLimit": 8
    },
    "herdr": {
      "requireDiagnosticsProbe": true
    }
  },
  "profiles": {
    "code-review-mobile": {
      "activate": { "surface": "code-review" },
      "handedness": "right",
      "mappings": [
        { "report": "wheel-up", "action": "selection.previous" },
        { "report": "wheel-down", "action": "selection.next" },
        { "gesture": "tap", "targetRole": "hunk", "action": "target.toggleExpanded" },
        { "gesture": "tap", "targetRole": "comment", "action": "target.openEditor" },
        { "gesture": "tap", "targetRole": "approve", "action": "target.confirmedActivate" },
        { "gesture": "tap", "targetRole": "page-up", "action": "target.activate" },
        { "gesture": "tap", "targetRole": "page-down", "action": "target.activate" },
        { "gesture": "tap", "targetRole": "jump-latest", "action": "target.activate" },
        { "gesture": "tap", "targetRole": "copy", "action": "target.activate" }
      ],
      "keyboardFallback": "Arrows navigate; Enter opens; Space toggles; Esc closes"
    }
  }
}
```

### Config safety

- Dangerous actions require `confirmedActivate` or a plugin-owned confirmation dialog.
- Long press is not assigned because Termux uses it for selection.
- Horizontal swipe remains opt-in per terminal capability.
- Every profile declares a keyboard fallback summary.
- The mapper shows a warning when a profile's analyzed package version no longer matches.

### Exit criteria

- Profiles remain useful across terminal resize and plugin upgrades.
- The mapper can be disabled without restarting Pi.
- No profile requires mutation of installed extension source.
- Mobile behavior is documented for at least Ask plus two strong external plugins.

## Phase 6 — Optional core application action registry

This is the first final-wave core UI improvement, and it should be independent from pointer handling.

### Problem

Pi names application actions such as model selection, copy message, tool expansion, and session tree, but their handlers are currently attached to `CustomEditor`. They are principally invoked by key matching while the editor owns focus ([`custom-editor.ts`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/coding-agent/src/modes/interactive/components/custom-editor.ts#L7-L28), [dispatch](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/coding-agent/src/modes/interactive/components/custom-editor.ts#L69-L75)).

### Proposed direction

Move handlers into an app-level action registry used by the editor and callable through a guarded UI API:

```ts
ctx.ui.invokeAction("app.model.select")
ctx.ui.invokeAction("app.message.copy")
ctx.ui.invokeAction("app.session.tree")
```

Actions should expose availability and descriptions; invocation should preserve existing focus/context checks. Do not create a generic unrestricted private-method RPC surface.

### Mapper improvement

A mobile action-sheet extension can now list approved actions without synthesizing shortcuts into whichever overlay happens to be focused.

### Example

```json
{
  "version": 5,
  "profiles": {
    "pi-mobile-actions": {
      "activate": { "manual": "f12" },
      "surface": "mapper-action-sheet",
      "items": [
        { "label": "Stop", "invoke": "app.interrupt" },
        { "label": "Copy last", "invoke": "app.message.copy" },
        { "label": "Model", "invoke": "app.model.select" },
        { "label": "Thinking", "invoke": "app.thinking.cycle" },
        { "label": "Sessions", "invoke": "app.session.tree" }
      ]
    }
  }
}
```

### Exit criteria

- Keyboard and mapper action invocation use the same handlers.
- Availability rules prevent inappropriate invocation.
- The registry is useful without mouse support.
- No key-sequence injection is needed for core app actions.

## Phase 7 — Core-owned action hit regions and individual block expansion

Only pursue this after the mapper and external-plugin contracts are proven.

### Problem

Pi's `Container.render()` concatenates child strings and retains no child bounds ([`tui.ts`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/tui/src/tui.ts#L253-L290)). Extensions cannot map a terminal row to a private transcript component. The public tool expansion API is global (`getToolsExpanded()` / `setToolsExpanded()`) rather than per block ([`types.ts`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/coding-agent/src/core/extensions/types.ts#L272-L276)).

Adding `Component.handlePointer()` alone would not solve either issue: focused custom components already receive raw input, while transcript children remain unfocused and unlocated.

### Narrow API

```ts
type UIActionHit = {
  id: string;
  role?: "button" | "tab" | "option";
  label?: string;
  state?: "expanded" | "collapsed" | "selected";
};

ctx.ui.hitTestAction(column, row): UIActionHit | undefined;
ctx.ui.invokeHitAction(id): boolean;
```

Requirements:

- regions represent explicit visible affordances only;
- topmost visible overlay occludes underlying regions;
- regions are rebuilt from the latest committed frame;
- IDs expire when no longer visible;
- invocation executes a private registered callback and requests rendering;
- extensions receive no mutable component tree or private component object.

### Minimal renderer implementation

Pi already embeds and strips a zero-width APC `CURSOR_MARKER` to locate the hardware cursor ([`tui.ts`](https://github.com/earendil-works/pi/blob/818d67457cdd6b60bce6b121d16b23141c252dd8/packages/tui/src/tui.ts#L111-L120)). A similar marker can encode an action ID and visible width around an affordance. The renderer extracts current-frame spans after final layout, then removes the marker before terminal output.

This avoids changing every `render(width): string[]` signature or publishing a layout tree.

### Individual expansion behavior

- Tap `▶ … Ctrl+O to expand`: toggle only that component.
- Tap its explicit title/hint while expanded: collapse only it.
- `Ctrl+O`: retain expand/collapse all.
- New blocks inherit the global default.
- Local overrides use stable session entry/tool-call IDs if they must survive streaming updates, transcript rebuilds, pending-tool transitions, compaction/tree navigation, and resize.
- Skill, branch, compaction, custom, tool, and bash blocks can adopt the same target contract incrementally.
- Thinking requires a separate per-thinking-block component/state refactor; it should not be hidden inside the pointer change.

### Mapper configuration

```json
{
  "version": 6,
  "profiles": {
    "pi-core-review": {
      "activate": { "manual": "touch-review" },
      "requiresMouse": true,
      "mappings": [
        {
          "gesture": "tap",
          "targetRole": "button",
          "targetState": ["expanded", "collapsed"],
          "action": "core.invokeHit"
        }
      ]
    }
  }
}
```

The mapper still owns press/release matching. Pi core supplies only current-frame semantic targets and invocation.

### Live viewport boundary

Terminal mouse coordinates describe the visible screen, but Pi cannot reliably know a user's position in terminal-owned historical scrollback. Core action regions should initially be valid only for the current live committed viewport.

For arbitrary history, implement a Pi-owned **Touch Review Mode** overlay:

- internal transcript viewport;
- wheel/swipe scrolling controlled by Pi;
- per-block expansion;
- message actions such as Copy, Fork, Retry, and Label;
- mouse lease active only while Review Mode is open;
- native scrollback restored on close.

### Exit criteria

- Tapping one visible block never changes unrelated blocks.
- `Ctrl+O` behavior remains backward-compatible.
- Overlay z-order and resize invalidate stale regions safely.
- Keyboard-only sessions have no behavior change.
- Native terminal selection/scrolling is preserved outside explicit touch/review mode.
- Historical interaction is offered only through a Pi-owned viewport, not guessed terminal scrollback coordinates.

## Later feature opportunities

After the final core wave, the same mapper and action infrastructure can support:

- tappable model/thinking/context/footer chips;
- touch-enabled core selectors and confirmations;
- Herdr job result targets for expand logs, interrupt, open pane, and close;
- message-gutter action menus for copy/fork/retry/label;
- a contextual running action sheet for Stop, Steer, and Queue Follow-up;
- explicit Page Up, Page Down, and Jump to Latest controls in Pi-owned review surfaces;
- mobile editor helper overlays;
- configurable command/prompt favorites;
- Termux notifications when user input is required or a run completes;
- clipboard and Android share integrations through optional Termux APIs.

These are product features built on the mapper/action boundary, not reasons to add a general touch framework to Pi.

## Rejected or deferred approaches

### Runtime monkey-patching extension internals

An adapter could theoretically import a package's private session module and modify a prototype before lazy loading. This depends on load order, exact package paths, ESM/TypeScript cache identity, internal names, `/reload` behavior, and package versions. It is unsupported and should not be generated automatically.

### Mutating installed package files

An agent should not rewrite `~/.pi/agent/npm/node_modules` to add pointer support. Generate an explicit project-local adapter or submit a plugin change upstream.

### Concatenated synthetic inputs

One transformed report is delivered as one string. Do not concatenate several arrow/Enter sequences and pretend they are independently dispatched events.

### Generic `dispatchInput()` as the first core patch

Synthetic multi-event injection would introduce reentrancy, focus, ordering, and recursion questions while still lacking private geometry/state. Semantic plugin actions are safer.

### `Component.handlePointer()` as the first core patch

It duplicates `handleInput()` for focused custom UI but does not locate unfocused transcript children. Geometry/action regions are the actual missing capability.

### Exposing the core component tree

Extensions should not receive mutable `chatContainer` children or private tool components. Use opaque current-frame actions.

### Automatic always-on mouse mode

Always-on tracking intercepts Termux native scrolling and selection. Use active profiles, explicit touch mode, or Review Mode.

## Testing strategy

### Mapper unit tests

- complete SGR press/release/wheel/motion decoding;
- modifiers and unknown buttons;
- malformed input and non-pointer pass-through;
- one-report-to-one-key mapping;
- condition and priority resolution;
- overlapping tool-call activation;
- profile inheritance and project overrides;
- config version migration/rejection;
- diagnostic redaction;
- agent proposal confidence classification.

### Mapper integration tests

- input listener consumes recognized reports;
- replacement reaches a fake focused keyboard-driven component exactly once;
- unrecognized keyboard input remains unchanged;
- profile start/end balances mouse ownership;
- reload and error paths clean up;
- semantic SDK action wins over key fallback when registered;
- stale instance IDs cannot receive actions.

### Core change 1 tests

- first acquire enables, final release disables;
- duplicate release is harmless;
- overlapping owners do not interfere;
- stronger tracking downgrades correctly after release;
- stop/suspend disables physical state;
- restart/resume reapplies logical leases;
- extension teardown releases owned leases.

### Core change 2 tests

- each overlay anchor and margin;
- width/height percentages and clamping;
- dynamic options;
- resize;
- `maxHeight` clipping;
- hidden/removed/unrendered handles;
- one-based terminal to zero-based local conversion.

### Core action-region tests

- ANSI styling and Unicode visible widths;
- exact text spans;
- overlay occlusion and z-order;
- viewport translation;
- resize and stale-frame invalidation;
- local per-block expansion versus global `Ctrl+O`;
- transcript rebuild state identity.

### Manual compatibility matrix

- Termux direct;
- Termux through SSH;
- Herdr pane;
- tmux/zellij with forwarding enabled and disabled;
- physical mouse;
- narrow and wide terminals;
- software keyboard show/hide resize;
- scroll, fling, tap, selection, and long press;
- `/reload`, Ctrl+Z/resume, normal exit, cancellation, and tool failure.

## Security, accessibility, and correctness requirements

- Extensions are trusted code, but generated mappings still require explicit review and provenance.
- JSON configuration is declarative, schema-validated, and subject to Pi project trust.
- Ordinary typed/pasted content is not logged by pointer diagnostics.
- Destructive actions are never bound to an unconfirmed swipe.
- Text labels accompany symbols; color is not the sole state indicator.
- Every action has a keyboard fallback.
- Touch mode is visible and can be disabled immediately.
- Targets derive from committed render state.
- Activation happens on release over the same stable target and is cancelled when focus, surface instance, or layout generation changes.
- Mouse reporting is disabled outside active surfaces/review mode.
- Terminal selection and native scroll remain first-class behaviors.

## Recommended implementation order

1. **Complete** — Add wheel/list experiments to `ui-playground` and validate directly in Termux.
2. **Complete** — Implement mapper MVP with tool lifecycle, direct mouse ownership, config, diagnostics, and Ask profile.
3. **Next** — Validate a second independent keyboard-driven plugin using only configuration.
4. Add agent `inspect/propose/write/test` workflow and profile confidence output.
5. Define the mapper SDK and paired surface lifecycle contract; integrate Ask first.
6. Upstream or prototype core change 1: mouse-reporting lease; migrate mapper ownership.
7. Upstream or prototype core change 2: `OverlayHandle.toLocalPoint()`; add owner-registered dynamic targets.
8. Demonstrate direct Ask row/tab/footer taps plus a strong external review/approval plugin.
9. Mature compatibility, safety, and Termux documentation.
10. Add an app action registry only when a mobile action-sheet implementation requires it.
11. Add core current-frame action regions and individual block expansion last.
12. Build Touch Review Mode rather than attempting to hit-test terminal-owned historical scrollback.

## Decision checkpoints

Before each core change, answer:

- Which demonstrated mapper/plugin behavior is blocked?
- Can the owning extension expose a lifecycle, target, or semantic action instead?
- Is the missing fact global terminal state, committed layout, or private core state?
- Can the API be input-protocol-neutral?
- Does it remain useful without mobile/touch?
- Can keyboard behavior remain exactly backward-compatible?

If those questions do not identify an irreducible core-owned fact, keep the change in the mapper or plugin.
