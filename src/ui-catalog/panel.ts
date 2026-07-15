import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { isCatalogTapTarget } from "./layout.ts";
import { DISABLE_SGR_MOUSE, ENABLE_SGR_MOUSE, parseSgrMouse, type SgrMouseEvent } from "./mouse.ts";

export class CatalogPanel {
  private expanded = false;
  private disposed = false;
  private lastMouse = "No mouse input yet — click/tap this panel.";
  private lastEvent: SgrMouseEvent | undefined;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly done: () => void,
  ) {
    // Pi passes raw input to focused components, but does not enable terminal
    // mouse reporting itself. This is intentionally scoped to this experiment.
    this.tui.terminal.write(ENABLE_SGR_MOUSE);
  }

  handleInput(data: string): void {
    const mouse = parseSgrMouse(data);
    if (mouse) {
      this.lastEvent = mouse;
      const location = `${mouse.button} ${mouse.action} at ${mouse.column},${mouse.row}`;
      if (mouse.button === "left" && mouse.action === "press" && this.isTitleTap(mouse.column, mouse.row)) {
        this.expanded = !this.expanded;
        this.lastMouse = `${location} — panel ${this.expanded ? "expanded" : "folded"}.`;
      } else {
        this.lastMouse = `${location} — outside the ▶ UI catalog tap target.`;
      }
      return;
    }

    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      this.expanded = !this.expanded;
      this.lastMouse = `Keyboard fallback — panel ${this.expanded ? "expanded" : "folded"}.`;
    } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.close();
    }
  }

  render(width: number): string[] {
    const border = (text: string) => this.theme.fg("borderAccent", text);
    const innerWidth = Math.max(1, width - 2);
    const symbol = this.expanded ? "▼" : "▶";
    const lines = [
      border(`╭${"─".repeat(innerWidth)}╮`),
      this.line(`${this.theme.fg("accent", this.theme.bold(` ${symbol} UI catalog`))}  ${this.theme.fg("dim", "mouse target experiment")}`, innerWidth, border),
      this.line(this.theme.fg("muted", " Tap ▶ UI catalog only · Enter/Space fallback"), innerWidth, border),
    ];

    if (this.expanded) {
      lines.push(
        this.line(this.theme.fg("accent", "  Components"), innerWidth, border),
        this.line("  • expandable panel", innerWidth, border),
        this.line("  • SGR mouse event diagnostics", innerWidth, border),
        this.line(this.theme.fg("dim", "  Next: test persistent widgets and hit regions."), innerWidth, border),
      );
    }

    const modifiers = this.lastEvent && (this.lastEvent.shift || this.lastEvent.alt || this.lastEvent.ctrl)
      ? ` [${[this.lastEvent.shift && "shift", this.lastEvent.alt && "alt", this.lastEvent.ctrl && "ctrl"].filter(Boolean).join("+")}]`
      : "";
    lines.push(this.line(this.theme.fg("warning", ` ${this.lastMouse}${modifiers}`), innerWidth, border));
    lines.push(this.line(this.theme.fg("dim", " Esc closes and restores normal terminal mouse behavior."), innerWidth, border));
    lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
    return lines;
  }

  invalidate(): void {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tui.terminal.write(DISABLE_SGR_MOUSE);
  }

  private line(content: string, innerWidth: number, border: (text: string) => string): string {
    const clipped = truncateToWidth(content, innerWidth, "", true);
    return `${border("│")}${clipped}${" ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)))}${border("│")}`;
  }

  private isTitleTap(column: number, row: number): boolean {
    return isCatalogTapTarget(column, row, this.tui.terminal.columns, this.tui.terminal.rows, this.expanded);
  }

  private close(): void {
    this.dispose();
    this.done();
  }
}
