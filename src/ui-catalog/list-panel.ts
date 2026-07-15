import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { DISABLE_SGR_MOUSE, ENABLE_SGR_MOUSE, parseSgrMouse } from "./mouse.ts";
import { moveListSelection } from "./list-state.ts";

const OPTIONS = ["First option", "Second option", "Third option"];

/** Disposable proof that Termux wheel reports can drive an ordinary keyboard list. */
export class WheelListPanel {
  private selected = 0;
  private disposed = false;
  private lastEvent = "Swipe vertically or use ↑/↓.";

  constructor(private readonly tui: TUI, private readonly theme: Theme, private readonly done: () => void) {
    this.tui.terminal.write(ENABLE_SGR_MOUSE);
  }

  handleInput(data: string): void {
    const mouse = parseSgrMouse(data);
    if (mouse?.button === "wheel-up") {
      this.move(-1);
      this.lastEvent = `wheel-up → Up; selected ${this.selected + 1}.`;
      return;
    }
    if (mouse?.button === "wheel-down") {
      this.move(1);
      this.lastEvent = `wheel-down → Down; selected ${this.selected + 1}.`;
      return;
    }
    if (mouse) {
      this.lastEvent = `${mouse.button} ${mouse.action} at ${mouse.column},${mouse.row} (no list action).`;
      return;
    }
    if (matchesKey(data, Key.up)) this.move(-1);
    else if (matchesKey(data, Key.down)) this.move(1);
    else if (matchesKey(data, Key.enter)) this.lastEvent = `Enter confirms ${OPTIONS[this.selected]}.`;
    else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) this.close();
  }

  render(width: number): string[] {
    const border = (text: string) => this.theme.fg("borderAccent", text);
    const inner = Math.max(1, width - 2);
    const line = (text: string) => {
      const clipped = truncateToWidth(text, inner, "", true);
      return `${border("│")}${clipped}${" ".repeat(Math.max(0, inner - visibleWidth(clipped)))}${border("│")}`;
    };
    return [
      border(`╭${"─".repeat(inner)}╮`),
      line(this.theme.fg("accent", this.theme.bold(" Wheel/list input experiment"))),
      ...OPTIONS.map((option, index) => line(`${index === this.selected ? this.theme.fg("accent", " ›") : "  "} ${option}`)),
      line(this.theme.fg("warning", ` ${this.lastEvent}`)),
      line(this.theme.fg("dim", " Termux wheel → Up/Down · Enter confirms · Esc closes")),
      border(`╰${"─".repeat(inner)}╯`),
    ];
  }

  invalidate(): void {}
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tui.terminal.write(DISABLE_SGR_MOUSE);
  }

  private move(delta: number): void {
    this.selected = moveListSelection(this.selected, delta, OPTIONS.length);
  }
  private close(): void { this.dispose(); this.done(); }
}
