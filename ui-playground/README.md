# UI playground

A disposable, project-local Pi environment for experimenting with terminal UI interactions before adopting them in normal extensions.

## Start it

```bash
cd /home/squiddity/projects/pi-tools/ui-playground
pi
```

The local [`.pi/settings.json`](.pi/settings.json) loads `../../extensions/ui-catalog` directly from this repository. Nothing is installed globally with `pi install`.

Once Pi starts, open the experiment with:

```text
/ui-catalog
```

Tap/click **`▶ UI catalog`** to fold or expand the panel. Enter and Space provide the keyboard equivalent; Esc closes the panel.

## Principles

- **Disposable and isolated.** Keep incomplete interaction experiments in this playground, rather than loading them into every Pi session.
- **Progressive enhancement.** Mouse/tap input is optional. Every interaction must retain a keyboard path and a visible hint.
- **Small, explicit hit targets.** Bind an action to the text that names it—not an invisible or overly broad portion of a panel. The catalog targets only `▶ UI catalog`.
- **Observable behavior.** Render the decoded input event and its terminal coordinates so failures can be attributed to the terminal, Herdr forwarding, coordinate mapping, or hit testing.
- **Minimal protocol scope.** Enable terminal mouse reporting only for the active component, and always disable it in `dispose()` / close handling.
- **No assumptions about the host.** Test inside the intended Herdr pane and treat unsupported or intercepted mouse input as a normal fallback case.

## Approach

The experiment is split into small, testable layers:

1. [`src/ui-catalog/mouse.ts`](../src/ui-catalog/mouse.ts) enables SGR mouse mode while the overlay is open and parses `CSI < b ; x ; y M/m` input into button, action, modifier, and one-based terminal coordinates.
2. [`src/ui-catalog/layout.ts`](../src/ui-catalog/layout.ts) calculates the bottom-centred overlay's exact title hit region. Its tests assert that the caret and final character of `UI catalog` are included, while adjacent cells and rows are excluded.
3. [`src/ui-catalog/panel.ts`](../src/ui-catalog/panel.ts) owns folded/expanded state, routes the focused component's raw input through the parser, and renders diagnostics.
4. [`extensions/ui-catalog/index.ts`](../extensions/ui-catalog/index.ts) exposes the panel as `/ui-catalog` in this playground.

Pi's TUI forwards raw input to a focused custom component and preserves SGR mouse sequences, but it does not enable mouse reporting for extensions. The panel writes the required enable/disable sequences through `tui.terminal.write(...)` while active. Herdr must forward those sequences to the pane for tap/clicks to arrive.

## Iteration workflow

1. Change the extension or helper code.
2. Run `npm run check` from the repository root.
3. In the playground Pi session, run `/reload`.
4. Close and reopen `/ui-catalog` so it creates a fresh panel instance.

For imported helper modules, use a fresh Pi process if `/reload` retains an old module instance. This is an experimental harness, so restarting the playground is preferred to making reload behavior part of the feature contract.

See [`../docs/mobile-input-mapper-roadmap.md`](../docs/mobile-input-mapper-roadmap.md) for the extension-first configurable mapper plan, phased Pi core changes, external plugin contract, and eventual transcript-block interactions.
