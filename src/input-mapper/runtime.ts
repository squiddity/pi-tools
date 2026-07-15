import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { loadProfiles, type LoadedProfiles } from "./config.ts";
import { keyBytes, mappingForReport } from "./mapping.ts";
import { DISABLE_SGR_MOUSE, ENABLE_SGR_MOUSE, parseSgrMouse, type SgrMouseEvent } from "./sgr.ts";
import type { DiagnosticEntry, ResolvedProfile } from "./types.ts";

type TerminalWriter = Pick<TUI["terminal"], "write">;
type Activation = { id: string; profileId: string; reason: "tool" | "manual" };
type TapCandidate = { profileId: string; column: number; row: number };

class MouseOwner {
  private terminal: TerminalWriter | undefined;
  private enabled = false;
  private wanted = false;

  setTerminal(terminal: TerminalWriter): void {
    this.terminal = terminal;
    this.sync();
  }

  setWanted(wanted: boolean): void {
    this.wanted = wanted;
    this.sync();
  }

  release(): void {
    this.wanted = false;
    this.sync();
  }

  dispose(): void {
    if (this.enabled) this.terminal?.write(DISABLE_SGR_MOUSE);
    this.enabled = false;
    this.terminal = undefined;
  }

  status(): "enabled" | "disabled" | "waiting-for-widget" {
    return this.wanted && !this.terminal ? "waiting-for-widget" : this.enabled ? "enabled" : "disabled";
  }

  private sync(): void {
    if (!this.terminal || this.enabled === this.wanted) return;
    this.terminal.write(this.wanted ? ENABLE_SGR_MOUSE : DISABLE_SGR_MOUSE);
    this.enabled = this.wanted;
  }
}

/** A zero-line bridge that gives the extension its only public TUI reference. */
class MouseOwnerWidget {
  private readonly owner: MouseOwner;

  constructor(owner: MouseOwner, tui: TUI) {
    this.owner = owner;
    this.owner.setTerminal(tui.terminal);
  }
  render(): string[] { return []; }
  invalidate(): void {}
  dispose(): void { this.owner.dispose(); }
}

export class InputMapperRuntime {
  private readonly mouse = new MouseOwner();
  private profiles = new Map<string, ResolvedProfile>();
  private activations: Activation[] = [];
  private tap: TapCandidate | undefined;
  private diagnosticEnabled = false;
  private diagnostics: DiagnosticEntry[] = [];
  private enabled = true;
  private loaded: LoadedProfiles | undefined;
  private unsubscribe: (() => void) | undefined;

  async start(ctx: ExtensionContext): Promise<void> {
    this.stop(ctx);
    this.enabled = true;
    this.loaded = await loadProfiles(ctx.cwd, ctx.isProjectTrusted());
    this.profiles = this.loaded.profiles;
    if (ctx.mode !== "tui") return;
    this.unsubscribe = ctx.ui.onTerminalInput((data) => this.transform(data));
    ctx.ui.setWidget("input-mapper-mouse-owner", (tui) => new MouseOwnerWidget(this.mouse, tui));
  }

  stop(ctx?: ExtensionContext): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.activations = [];
    this.tap = undefined;
    this.mouse.release();
    ctx?.ui.setWidget("input-mapper-mouse-owner", undefined);
    this.mouse.dispose();
  }

  activateTool(toolCallId: string, toolName: string): void {
    if (!this.enabled) return;
    for (const profile of this.profiles.values()) {
      if (profile.activate?.tool === toolName && profile.mappings.length > 0) this.activate({ id: toolCallId, profileId: profile.id, reason: "tool" });
    }
  }

  deactivateTool(toolCallId: string): void {
    this.activations = this.activations.filter((activation) => activation.id !== toolCallId || activation.reason !== "tool");
    this.clearTap();
    this.syncMouse();
  }

  turnOn(profileId: string | undefined): string | undefined {
    if (!profileId) return "Specify a configured profile: /input-map on <profile>.";
    const profile = this.profiles.get(profileId);
    if (!profile || profile.mappings.length === 0) return `Unknown or empty input-mapper profile: ${profileId}.`;
    this.enabled = true;
    this.activate({ id: `manual:${profileId}`, profileId, reason: "manual" });
    return undefined;
  }

  turnOff(): void {
    this.enabled = false;
    this.activations = [];
    this.clearTap();
    this.syncMouse();
  }

  setDiagnostics(enabled: boolean): void {
    this.diagnosticEnabled = enabled;
    if (!enabled) this.diagnostics = [];
  }

  status(): string {
    const profile = this.activeProfile();
    const loaded = this.loaded;
    const source = loaded
      ? `profiles: ${[...this.profiles.keys()].join(", ") || "none"}\nuser: ${loaded.userPath}\nproject: ${loaded.projectIgnored ? `${loaded.projectPath} (ignored: untrusted)` : loaded.projectPath}`
      : "configuration not loaded";
    const errors = loaded?.errors.length ? `\nconfig warnings: ${loaded.errors.join("; ")}` : "";
    return `input mapper: ${this.enabled ? "on" : "off"}\nactive: ${profile?.id ?? "none"}\nmouse: ${this.mouse.status()}\n${source}${errors}`;
  }

  diagnose(): string {
    if (!this.diagnosticEnabled) return "Pointer diagnostics are off. Run /input-map diagnose on.";
    if (this.diagnostics.length === 0) return "Pointer diagnostics are on; no SGR reports captured yet.";
    return this.diagnostics.map((entry) => `${new Date(entry.at).toLocaleTimeString()} ${entry.decoded ?? "unknown"} → ${entry.action ?? entry.decision} (${entry.profile ?? "no profile"})`).join("\n");
  }

  test(name: string): string {
    const samples: Record<string, string> = {
      "wheel-up": "\x1b[<64;1;1M",
      "wheel-down": "\x1b[<65;1;1M",
      tap: "\x1b[<0;1;1M / \x1b[<0;1;1m",
    };
    if (!(name in samples)) return "Usage: /input-map test wheel-up|wheel-down|tap";
    return `${name}: ${samples[name]}${this.activeProfile() ? `; active profile ${this.activeProfile()!.id}` : "; no active profile"}`;
  }

  /** Transform one raw terminal input event. Public for integration tests and adapters. */
  transform(data: string): { consume?: boolean; data?: string } | undefined {
    const mouse = parseSgrMouse(data);
    if (!mouse) return undefined;
    const profile = this.activeProfile();
    if (!profile) {
      this.record({ raw: data, decoded: describe(mouse), decision: "pass" });
      return undefined;
    }

    const mapping = mappingForReport(profile.mappings, mouse);
    if (mouse.button === "left" && mouse.action === "press") {
      this.tap = { profileId: profile.id, column: mouse.column, row: mouse.row };
      this.record({ raw: data, decoded: describe(mouse), profile: profile.id, decision: "consume", action: "tap candidate" });
      return { consume: true };
    }
    if (mouse.action === "move") {
      if (this.tap && (Math.abs(this.tap.column - mouse.column) >= (profile.gestures?.thresholdCells ?? 2) || Math.abs(this.tap.row - mouse.row) >= (profile.gestures?.thresholdCells ?? 2))) this.clearTap();
      this.record({ raw: data, decoded: describe(mouse), profile: profile.id, decision: "consume", action: "motion" });
      return { consume: true };
    }
    if (mouse.button === "wheel-up" || mouse.button === "wheel-down") this.clearTap();
    if (mapping) {
      if (mapping.report === "left-release" && !this.isMatchingTap(profile.id, mouse)) {
        this.record({ raw: data, decoded: describe(mouse), profile: profile.id, decision: "consume", action: "cancelled tap" });
        return { consume: true };
      }
      this.clearTap();
      this.record({ raw: data, decoded: describe(mouse), profile: profile.id, decision: "substitute", action: mapping.send });
      return { data: keyBytes(mapping.send) };
    }
    this.clearTap();
    // A profile owns mouse mode, so no report may leak its escape sequence into the editor.
    this.record({ raw: data, decoded: describe(mouse), profile: profile.id, decision: "consume" });
    return { consume: true };
  }

  private activate(activation: Activation): void {
    this.activations = this.activations.filter((current) => current.id !== activation.id || current.reason !== activation.reason);
    this.activations.push(activation);
    this.syncMouse();
  }

  private activeProfile(): ResolvedProfile | undefined {
    if (!this.enabled) return undefined;
    for (let index = this.activations.length - 1; index >= 0; index--) {
      const profile = this.profiles.get(this.activations[index].profileId);
      if (profile) return profile;
    }
    return undefined;
  }

  private syncMouse(): void {
    this.mouse.setWanted(Boolean(this.activeProfile()?.mouse));
  }

  private isMatchingTap(profileId: string, mouse: SgrMouseEvent): boolean {
    return Boolean(this.tap && this.tap.profileId === profileId && this.tap.column === mouse.column && this.tap.row === mouse.row);
  }

  private clearTap(): void { this.tap = undefined; }

  private record(entry: Omit<DiagnosticEntry, "at">): void {
    if (!this.diagnosticEnabled) return;
    this.diagnostics.push({ ...entry, at: Date.now() });
    if (this.diagnostics.length > 20) this.diagnostics.shift();
  }
}

function describe(event: SgrMouseEvent): string {
  return `${event.button} ${event.action} @${event.column},${event.row}`;
}
