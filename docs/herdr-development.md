# Herdr development guide

This is the local handoff for developing the Herdr fork used alongside `pi-tools`, especially when testing Pi extensions and terminal input routing.

## Repository layout

The two repositories are sibling directories:

```text
/home/squiddity/projects/pi-tools   # this repository: Pi extensions, mapper profiles, playground
/home/squiddity/projects/herdr       # Herdr Rust fork: terminal/pane routing experiment
```

The Herdr checkout is the fork of [`ogulcancelik/herdr`](https://github.com/ogulcancelik/herdr) owned by the `squiddity` GitHub account.

Its remotes are:

```text
origin    https://github.com/squiddity/herdr.git       # personal fork
upstream  https://github.com/ogulcancelik/herdr.git   # official repository
```

The current experimental branch is:

```text
experiment/pane-wheel-routing
```

The checkout was created from the current upstream `master` and is clean at the time this guide was written.

## Toolchain

Herdr pins Rust in `rust-toolchain.toml`:

```text
Rust 1.96.1
```

The vendored `libghostty-vt` build requires:

```text
Zig 0.15.2
```

The repository's test recipes also use:

```text
just          1.56.0
cargo-nextest 0.9.140
bun           1.3.12 or compatible
Python        3.x
```

Rust and the user-local tools are installed without system packages. In a fresh shell, prepare the environment with:

```bash
source "$HOME/.cargo/env"
export PATH="$HOME/.local/bin:$PATH"
```

This makes `rustc`, `cargo`, `just`, and `zig` available. The Zig binary is installed at:

```text
$HOME/.local/zig/zig-x86_64-linux-0.15.2/zig
```

and linked as `$HOME/.local/bin/zig`.

Verify the environment:

```bash
cd /home/squiddity/projects/herdr
source "$HOME/.cargo/env"
export PATH="$HOME/.local/bin:$PATH"
rustc --version
cargo --version
just --version
cargo nextest --version
zig version
bun --version
```

Do not add generated build output or local toolchain files to either repository.

## Baseline and validation

Herdr's preferred task runner is `just`. From `/home/squiddity/projects/herdr`:

```bash
just ci       # formatting, Clippy, Rust tests, integration and plugin tests
just check    # ci plus Windows-target lint and maintenance script tests
```

The clean baseline has passed `just ci` with:

- 2,838 Rust tests passed;
- 6 integration asset tests passed;
- 12 plugin marketplace tests passed;
- formatting and Clippy checks passed.

`cargo check --locked` also passed after installing Zig. Use the repository recipes rather than ad-hoc Cargo commands when validating changes. A focused test can use:

```bash
just test-one '<nextest-filter>'
```

Run `just check` before committing Herdr changes unless a narrower check has been explicitly agreed. If a command fails because a tool is not on `PATH`, first repeat it after sourcing Cargo and adding `$HOME/.local/bin` as above.

## Development workflow

Keep the Herdr worktree separate from `pi-tools` and make Herdr changes only under `/home/squiddity/projects/herdr`.

Typical session setup:

```bash
cd /home/squiddity/projects/herdr
source "$HOME/.cargo/env"
export PATH="$HOME/.local/bin:$PATH"
git status --short --branch
git fetch upstream
git log --oneline --decorate -5
```

Before a new experiment, confirm that the branch is based on the intended upstream revision. Keep the first routing experiment small and reversible. The initial target is wheel ownership, not the eventual socket/API contract:

1. preserve Herdr's existing outer mouse capture and coordinate hit testing;
2. preserve button/tap forwarding to the child pane;
3. add an explicit wheel-routing override before `MouseReport` forwarding;
4. route overridden vertical wheel events through Herdr's existing pane-history scrolling;
5. prevent clicks in a historical viewport from activating hidden live content;
6. test with the existing Ask and Herdr jobs mapper profiles;
7. only afterward design a runtime lease or socket API.

Do not modify `pi-tools` from the Herdr checkout. Changes to mapper profiles, Pi extensions, or the playground belong in:

```text
/home/squiddity/projects/pi-tools
```

## Relevant Herdr source areas

The exact names may move as upstream evolves, so search current source before editing. The known routing surfaces are:

- `src/pane/terminal.rs` — embedded terminal state, mouse modes, alternate screen, wheel-routing decision, and pane scrollback;
- `src/pane.rs` — pane input state and forwarding capability;
- `src/app/input/mouse.rs` — Herdr chrome hit testing, pane-local coordinate conversion, button forwarding, wheel forwarding, and pane scrolling;
- `src/app/input/mod.rs` — high-level mouse dispatch and routing order;
- `src/app/state.rs` — effective host mouse-capture policy;
- `src/app/mod.rs` or the current runtime/client equivalent — synchronization of host terminal mouse modes.

The key existing conceptual outcomes are:

```text
MouseReport       forward wheel to the child application
AlternateScroll   translate wheel to application navigation keys
HostScroll        scroll Herdr's retained pane history
```

The experiment should add policy around that existing decision rather than duplicate terminal parsing or implement a PTY wrapper.

## Running the development build

Build or run the local binary from the Herdr checkout:

```bash
cd /home/squiddity/projects/herdr
source "$HOME/.cargo/env"
export PATH="$HOME/.local/bin:$PATH"
cargo run -- --help
```

When testing a development build from inside an existing Herdr session, clear inherited socket overrides so the debug binary does not accidentally connect to the installed stable server:

```bash
env -u HERDR_SOCKET_PATH -u HERDR_CLIENT_SOCKET_PATH cargo run -- <command>
```

For Pi integration testing, use the playground from the sibling repository:

```bash
cd /home/squiddity/projects/pi-tools/ui-playground
pi -e ..
```

The playground loads the local Pi extensions through `.pi/settings.json` and `.pi/input-mapper.json`. The relevant profiles are:

- Ask: tap maps to Enter and wheel maps to selection navigation;
- Herdr jobs: same-cell tap maps to F8 for the status widget; wheel is not needed by the widget and is the main scrollback experiment.

The exact command for launching Herdr's development binary around the playground depends on the current Herdr CLI and server/client mode. Do not replace the installed `herdr` command globally. Prefer an explicit `cargo run` invocation or a temporary shell alias so stable Herdr sessions remain available for recovery.

## Manual experiment checklist

For the first wheel-routing prototype, verify each case separately:

1. Start the development Herdr build with the Pi playground.
2. Activate the Herdr jobs mapper profile.
3. Tap the status caret/label and confirm the widget toggles using F8.
4. Swipe vertically inside the pane and confirm Herdr history moves instead of Pi receiving wheel input.
5. Tap Herdr chrome: sidebar, tabs, borders, and menus must remain usable.
6. Scroll back, then tap pane content; confirm it cannot invoke an unseen live-screen target.
7. Deactivate the profile and confirm the default `auto` policy is unchanged.
8. Run Ask with the `application` wheel policy and confirm selection navigation still works.
9. Test a normal desktop wheel and click if available.
10. Test split panes, alternate-screen applications, resize, new output while scrolled back, and pane/session close.

A Herdr jobs tap appears before its label, for example:

```text
▼ herdr jobs
▶ herdr jobs
```

The current mapper profile conservatively maps a same-cell left release; it does not yet have panel-local target coordinates.

## Git and contribution guardrails

This checkout is an external-contributor fork, not the official maintainer checkout. Follow both `AGENTS.md` and `CONTRIBUTING.md` in the Herdr repository before making changes.

In particular:

- use lowercase conventional commit subjects;
- do not add AI co-author lines;
- keep broad interaction/product changes small and discussable;
- do not open issues or pull requests from an agent;
- feature proposals and behavior changes belong in GitHub Discussions first;
- do not open a first PR until the maintainer approval process described in `CONTRIBUTING.md` has been satisfied;
- propose the commit message before committing Herdr changes.

For local experimental work, committing on `experiment/pane-wheel-routing` is fine. Push only when explicitly desired. Keep the working tree clean before switching branches or rebasing.

To synchronize with upstream without discarding local work:

```bash
cd /home/squiddity/projects/herdr
git fetch upstream
git log --oneline --decorate --all -10
git diff upstream/master...HEAD
```

Do not force-push `master`. Keep experiments on a named branch.

## Related pi-tools documents

- [`herdr-mobile-input-routing-proposal.md`](herdr-mobile-input-routing-proposal.md) — research summary and proposed Herdr wheel-routing policy;
- [`mobile-input-mapper-roadmap.md`](mobile-input-mapper-roadmap.md) — Pi mapper roadmap and Touch Review Mode direction;
- [`herdr-panes.md`](herdr-panes.md) — Herdr pane lifecycle and long-running job guidance;
- [`../ui-playground/README.md`](../ui-playground/README.md) — local Pi playground instructions.
