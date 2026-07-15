# Herdr mobile input routing analysis and modification proposal

## Status and purpose

This document is a research summary and handoff for a future Herdr planning session. It proposes directions only; no Herdr modification is implemented or committed here.

The immediate context is the `pi-tools` input mapper. Two profiles now work:

- `ask_user_question`: Termux swipe-as-wheel maps to selection Up/Down, and a same-cell tap maps to Enter.
- Herdr jobs status: a same-cell tap maps to the extension's supported F8 collapse/expand shortcut.

Both demonstrate useful pointer-to-key translation. Both also expose the terminal protocol trade-off: while mouse reporting is active, Termux and Ghostty send wheel reports to the application instead of scrolling history.

## Mobile-first interaction model

The product priority is a phone screen rather than parity with a desktop mouse. The important distinction is therefore not finger versus physical mouse. It is:

- **tap** — activate an explicit action;
- **swipe/fling** — scroll history or navigate a surface;
- **long press** — preserve terminal text selection.

Termux already recognizes a stationary finger gesture separately from scrolling. With mouse tracking active, a stationary gesture emits left press/release, while finger scrolling and fling produce repeated wheel reports ([tap handling](https://github.com/termux/termux-app/blob/3df69d1da197dd9bd71a3bafd902dffd720576b4/terminal-view/src/main/java/com/termux/view/TerminalView.java#L140-L183), [`doScroll`](https://github.com/termux/termux-app/blob/3df69d1da197dd9bd71a3bafd902dffd720576b4/terminal-view/src/main/java/com/termux/view/TerminalView.java#L574-L588)). The desired mobile policy can therefore treat button reports as taps and wheel reports as swipes even though the terminal protocol calls both mouse input.

Desktop wheel and click behavior remains important compatibility coverage, but should follow rather than drive this design.

## Protocol constraint

The xterm protocol has no mode for “report clicks but keep wheel local.”

- `1000` reports button presses and releases.
- `1002` adds motion while a button is held.
- `1003` adds all pointer motion.
- Wheel events are buttons 4 and 5 in these tracking modes.
- `1006` changes only the report encoding to SGR `CSI < b;x;y M/m`.

The authoritative xterm documentation describes normal tracking and wheel buttons together ([normal/wheel tracking](https://github.com/ThomasDickey/xterm-snapshots/blob/6380a3eaed857c182ea6cfa78cd706966b2628d0/ctlseqs.ms#L3900-L3966)), then describes `1002`/`1003` as broader motion modes ([motion modes](https://github.com/ThomasDickey/xterm-snapshots/blob/6380a3eaed857c182ea6cfa78cd706966b2628d0/ctlseqs.ms#L4037-L4071)) and `1006` as an encoding ([SGR encoding](https://github.com/ThomasDickey/xterm-snapshots/blob/6380a3eaed857c182ea6cfa78cd706966b2628d0/ctlseqs.ms#L4103-L4133)). Changing modes cannot solve the scroll conflict.

Ghostty follows the same rule: when reporting is active, it emits wheel reports and returns without moving its viewport ([`Surface.zig`](https://github.com/ghostty-org/ghostty/blob/c5a21edfcbc2d5b46540ad91b7980aca31f5f1f3/src/Surface.zig#L3563-L3595)). Its Shift override protects click/selection handling, not wheel scrolling ([click override](https://github.com/ghostty-org/ghostty/blob/c5a21edfcbc2d5b46540ad91b7980aca31f5f1f3/src/Surface.zig#L3898-L3934)). Ghostty can toggle all reporting, but that disables taps as well ([configuration](https://github.com/ghostty-org/ghostty/blob/c5a21edfcbc2d5b46540ad91b7980aca31f5f1f3/src/config/Config.zig#L966-L976)).

## Why Herdr UI remains tappable

Herdr is already the terminal mediator needed to separate event ownership.

A pane application's output is parsed into an embedded terminal state. Herdr records whether the child requested `1000`/`1002`/`1003`, which encoding it requested, and whether it is on the alternate screen ([pane input state](https://github.com/ogulcancelik/herdr/blob/299dd4163a96381ec2d8e5bde13d7ba6d6432373/src/pane/terminal.rs#L930-L991)). Herdr independently decides whether the outer terminal must capture mouse reports based on its own UI setting or the focused pane's request ([capture policy](https://github.com/ogulcancelik/herdr/blob/299dd4163a96381ec2d8e5bde13d7ba6d6432373/src/app/state.rs#L1524-L1541), [host mode synchronization](https://github.com/ogulcancelik/herdr/blob/299dd4163a96381ec2d8e5bde13d7ba6d6432373/src/app/mod.rs#L1103-L1117)).

The event reaches Herdr first with outer-screen coordinates. Herdr handles overlays, sidebar, tab bar, pane frames, split boundaries, and pane content separately. Only pane-local events are re-encoded and sent to the child's PTY, after subtracting the pane's `inner_rect` origin ([button and wheel forwarding](https://github.com/ogulcancelik/herdr/blob/299dd4163a96381ec2d8e5bde13d7ba6d6432373/src/app/input/mouse.rs#L1613-L1689)).

Therefore the observed behavior is expected:

```text
Termux/Ghostty report
  -> Herdr outer mouse capture
  -> Herdr coordinate hit test
       -> Herdr chrome: handle in Herdr
       -> pane content: convert to local coordinates and forward to Pi
```

Pi never owns events outside its pane.

## Why wheel currently bypasses Herdr scrollback

Herdr already has an explicit three-way wheel decision:

- `MouseReport` — forward the wheel event to the child;
- `AlternateScroll` — translate wheel to application cursor keys;
- `HostScroll` — move Herdr's retained pane viewport.

The current decision always chooses `MouseReport` whenever the child has any mouse-reporting mode enabled ([wheel routing](https://github.com/ogulcancelik/herdr/blob/299dd4163a96381ec2d8e5bde13d7ba6d6432373/src/pane/terminal.rs#L994-L1014)). The full mouse router follows that result; only an unforwarded wheel reaches Herdr's pane-history scrolling methods ([terminal wheel handling](https://github.com/ogulcancelik/herdr/blob/299dd4163a96381ec2d8e5bde13d7ba6d6432373/src/app/input/mouse.rs#L1564-L1611), [forwarding branch](https://github.com/ogulcancelik/herdr/blob/299dd4163a96381ec2d8e5bde13d7ba6d6432373/src/app/input/mouse.rs#L1691-L1730)).

The mapper then receives the forwarded wheel report. If the profile maps it, it becomes a key; if it does not, the mapper safely consumes it. At that point it is too late to recover Herdr or outer-terminal scrolling because Herdr has already selected child routing.

## Thin PTY wrapper assessment

A transparent byte wrapper around Pi cannot restore native terminal scrollback while also receiving clicks:

1. If it strips `1000`, the outer terminal scrolls normally but never reports taps.
2. If it preserves `1000`, the outer terminal emits SGR wheel bytes instead of moving its viewport.
3. Replaying those bytes toward stdout does not recreate a GUI wheel gesture.
4. `CSI S/T` changes screen contents; it is not a portable command for moving the user's historical viewport.
5. Translating wheel to Up/Down or PageUp/PageDown changes application state rather than terminal history.

A wrapper that truly supports both must parse VT output, virtualize DEC modes, retain screen history, manage resize and alternate-screen state, render a historical viewport, and safely route coordinates. That is a terminal multiplexer, not a thin execution shim. Herdr already performs this work: it writes child output through an embedded terminal ([PTY processing](https://github.com/ogulcancelik/herdr/blob/299dd4163a96381ec2d8e5bde13d7ba6d6432373/src/pane/terminal.rs#L569-L585)) and exposes direct viewport scrolling over its retained buffer ([scroll methods](https://github.com/ogulcancelik/herdr/blob/299dd4163a96381ec2d8e5bde13d7ba6d6432373/src/pane/terminal.rs#L874-L899)).

The recommended approach is therefore to extend Herdr's existing router rather than build another wrapper.

## Proposed Herdr modification

### Goal

Allow Herdr to capture the outer report once, forward tap/button events to the child, and retain wheel/swipe events for Herdr pane history.

```text
left press/release inside pane -> child application
wheel/swipe inside pane        -> Herdr pane scrollback
Herdr chrome events            -> Herdr as today
```

### Initial policy shape

Add a wheel-routing override with three conceptual values:

```text
auto          current behavior: follow child terminal modes
application   always forward wheel to the child when possible
scrollback    keep wheel in Herdr pane history
```

Names and configuration placement should be decided in the future Herdr planning session. The important design point is that button routing and wheel routing become independently selectable.

Default must remain `auto` so existing wheel-aware applications such as `lazygit`, `btop`, editors, and pagers do not regress.

### Why this fits Herdr

- `WheelRouting` already centralizes the relevant decision.
- Herdr already knows the pointer's pane and local coordinates.
- Herdr already owns pane scrollback and its viewport.
- Herdr already forwards button, motion, and wheel events through separate functions.
- No terminal-protocol invention is required.
- No Pi core change is required.

`tmux` provides a precedent: it parses child mouse modes and exposes wheel as a bindable event that may be forwarded or retained for copy-mode history. Its default still forwards when a child requested mouse input, but users can replace that policy ([default mouse bindings](https://github.com/tmux/tmux/blob/15746a1bc796a76cd855636e0073c339b517b1c2/key-bindings.c#L500-L516)).

## Proposed evolution

### Stage A — manual Herdr policy

Prototype a manual per-pane or session toggle:

```text
wheel -> application
wheel -> scrollback
```

This proves that taps still reach Pi while Termux swipes move Herdr history. It should be tested before designing an integration API.

### Stage B — pane-scoped runtime policy

Represent the override per pane rather than only as a global setting. Different panes may run applications with different expectations.

Possible state:

```text
PaneInputPolicy {
  buttons: auto | application
  wheel: auto | application | scrollback
}
```

The initial implementation may only need the `wheel` field.

### Stage C — lifecycle-scoped external contract

Expose a small Herdr socket/API contract so a trusted pane application can request and release a policy. The exact lease semantics require planning, but should cover:

- pane ID and requesting owner;
- idempotent release;
- automatic cleanup when the pane/process/session disappears;
- overlapping request precedence;
- visible diagnostics/status;
- safe fallback when a client does not support the API.

The Pi mapper can detect `HERDR_ENV` and associate requests with `HERDR_PANE_ID`. A mapper profile could then declare an environment-specific wheel preference:

```json
{
  "herdr": {
    "wheel": "scrollback"
  }
}
```

This field is illustrative, not a committed mapper schema.

## Profile implications

### Herdr jobs status

This profile requires taps but does not use wheel navigation. Its natural policy is:

```text
buttons -> application
wheel   -> scrollback
```

That permits tap-to-F8 while preserving phone swipe history.

### Ask user question

Ask currently uses Termux wheel reports for selection navigation. Its natural default remains:

```text
buttons -> application
wheel   -> application
```

A future user preference could instead choose scrollback and rely on explicit keyboard/onscreen navigation. There is no universal answer; wheel ownership is profile policy.

## Safety and correctness requirements

### Historical viewport clicks

Never apply a click from a historical viewport to live application coordinates. Herdr currently resets its pane viewport before forwarding mouse input. With split wheel routing, a user may intentionally remain scrolled back, so the policy must be explicit:

- recommended: ignore pane-content clicks while scrolled back and show a “return to live” affordance;
- acceptable alternative: first return visibly to live without activating, then require a second tap;
- unsafe: jump to live and invoke the hidden current-frame action with the same tap.

### Gesture stability

- Activation remains press/release over the same live target.
- A wheel event cancels any tap candidate.
- Fling bursts must be rate-limited or coalesced at the layer that owns scrolling.
- Long press remains available for terminal selection.

### Compatibility

Test at minimum:

- Termux direct to Herdr;
- Termux over SSH to Herdr;
- Ghostty with physical wheel;
- split panes and pane borders;
- Herdr sidebar/tab interactions;
- applications that need wheel input;
- scrolled-back output while new output arrives;
- resize while scrolled back;
- pane/session close while a policy is active.

## Direct-Termux and direct-Ghostty boundary

A Herdr change solves sessions running inside Herdr because Herdr owns pane scrollback. It does not solve Pi launched directly in Termux or Ghostty.

For direct execution, realistic choices remain:

- narrowly scoped interaction mode;
- explicit reporting on/off toggle;
- a terminal-specific tap-versus-swipe policy;
- a Pi-owned review/history viewport.

A Termux-specific change could report stationary taps while retaining finger swipes for local history. That is useful for direct Pi, but inside Herdr it would scroll Termux's outer surface rather than Herdr's pane history, so Herdr is the correct layer there.

The portable long-term direction remains a Pi-owned Touch Review Mode: Pi would own both history and hit targets rather than trying to interact with terminal-owned historical scrollback.

## Rejected directions

- Changing from `1000` to `1002` or `1003`: wheel remains reported.
- Enabling only `1006`: encoding without a tracking mode produces no events.
- Disabling tracking immediately after press: release can be lost and wheel is invisible while disabled.
- Replaying SGR bytes toward the terminal: does not move native scrollback.
- Mapping wheel to PageUp/Down and calling it history: changes the focused application instead.
- Building another PTY terminal proxy around Pi: duplicates Herdr at multiplexer-scale complexity.
- Forwarding clicks from historical content: stale-coordinate action risk.

## Questions for the future Herdr planning session

1. Should the first prototype be a global config, a per-pane toggle, or a keybinding?
2. Where should an active override be displayed?
3. Should scrollback mode ignore all pane mouse buttons while scrolled back, or reserve one tap to return live?
4. How should split routing interact with alternate-screen applications?
5. What lease ownership and cleanup model fits Herdr's existing socket API?
6. Should an external requester be allowed to control buttons and motion independently, or wheel only?
7. How should overlapping policy requests be prioritized?
8. Can the policy be implemented consistently in monolithic, local client/server, remote attach, and plugin contexts?
9. What compatibility behavior is required for older Herdr versions?
10. Does Herdr want this as a general pane input-policy feature rather than a Pi-specific integration?

## Recommended next planning target

Plan the smallest Herdr-native experiment that changes only wheel ownership:

1. retain current outer capture and coordinate routing;
2. preserve existing button forwarding;
3. add an explicit override before `MouseReport` wheel forwarding;
4. route overridden vertical wheel events to Herdr's existing pane scroll methods;
5. block live application clicks while scrolled back;
6. test manually with the existing Ask and Herdr jobs mapper profiles;
7. only then design the socket/API lease.

This validates the mobile interaction model without committing prematurely to a public API.
