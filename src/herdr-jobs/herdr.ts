import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { HerdrAgentInspection, HerdrAgentLaunch, HerdrOperations, PaneInspection, Placement } from "./types.ts";

const execFile = promisify(execFileCallback);
const MAX_ERROR_OUTPUT = 4_000;

function bounded(value: unknown): string {
  const text = String(value ?? "").trim();
  return text.length > MAX_ERROR_OUTPUT ? `${text.slice(0, MAX_ERROR_OUTPUT)}…` : text;
}

function parseJson(output: string, operation: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`herdr ${operation} returned malformed JSON: ${bounded(output) || "(empty)"}`);
  }
}

function getString(object: unknown, ...path: string[]): string | null {
  let value: unknown = object;
  for (const key of path) {
    if (!value || typeof value !== "object") return null;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "string" && value ? value : null;
}

export function parseCreatedPane(output: string, placement: Placement): string {
  const parsed = parseJson(output, placement === "tab" ? "tab create" : "pane split");
  const paneId = placement === "tab"
    ? getString(parsed, "result", "root_pane", "pane_id")
    : getString(parsed, "result", "pane", "pane_id");
  if (!paneId) throw new Error(`herdr ${placement === "tab" ? "tab create" : "pane split"} response contained no pane id.`);
  return paneId;
}

export function parseCreatedTab(output: string): { tabId: string; rootPaneId: string } {
  const parsed = parseJson(output, "tab create");
  const tabId = getString(parsed, "result", "tab", "tab_id");
  const rootPaneId = getString(parsed, "result", "root_pane", "pane_id");
  if (!tabId || !rootPaneId) throw new Error("herdr tab create response contained no tab or root pane id.");
  return { tabId, rootPaneId };
}

/** Herdr's agent send API writes literal bytes; append Enter to submit a Pi prompt. */
export function agentSubmissionText(message: string): string {
  return message.endsWith("\n") ? message : `${message}\n`;
}

export function parseAgentLaunch(output: string): HerdrAgentLaunch {
  const parsed = parseJson(output, "agent start");
  const paneId = getString(parsed, "result", "agent", "pane_id");
  const terminalId = getString(parsed, "result", "agent", "terminal_id");
  if (!paneId || !terminalId) throw new Error("herdr agent start response contained no pane or terminal id.");
  return { paneId, terminalId };
}

export function parseAgentInspection(output: string): HerdrAgentInspection | { kind: "missing"; error?: string } {
  const parsed = parseJson(output, "agent get");
  const errorCode = getString(parsed, "error", "code");
  if (errorCode === "agent_not_found" || errorCode === "not_found" || errorCode === "pane_not_found") {
    return { kind: "missing", error: getString(parsed, "error", "message") ?? "agent not found" };
  }
  const status = getString(parsed, "result", "agent", "agent_status");
  if (status !== "idle" && status !== "working" && status !== "blocked" && status !== "done" && status !== "unknown") {
    throw new Error("herdr agent get response contained no recognized agent status.");
  }
  return { kind: "present", status };
}

export function parsePaneInspection(output: string, paneId: string): PaneInspection {
  const parsed = parseJson(output, "pane get");
  const errorCode = getString(parsed, "error", "code");
  if (errorCode === "pane_not_found" || errorCode === "not_found") {
    return { kind: "missing", error: getString(parsed, "error", "message") ?? "pane not found" };
  }
  const observed = getString(parsed, "result", "pane", "pane_id");
  if (!observed || observed !== paneId) return { kind: "unavailable", error: "pane get returned no matching pane record" };
  return { kind: "present" };
}

function parsePaneInspectionError(error: unknown): PaneInspection {
  const source = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
  for (const text of [source.stdout, source.stderr, source.message]) {
    if (typeof text !== "string" || !text.trim()) continue;
    try {
      const parsed = parseJson(text, "pane get");
      const code = getString(parsed, "error", "code");
      if (code === "pane_not_found" || code === "not_found") {
        return { kind: "missing", error: getString(parsed, "error", "message") ?? "pane not found" };
      }
    } catch {
      if (/\b(?:pane_not_found|not_found)\b/.test(text)) return { kind: "missing", error: bounded(text) };
    }
  }
  return { kind: "unavailable", error: bounded(source.message) || "herdr pane get failed" };
}

async function run(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFile("herdr", args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
    return stdout;
  } catch (error: unknown) {
    const item = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const detail = [item.message, item.stderr, item.stdout].filter(Boolean).map(bounded).join("\n");
    throw new Error(`herdr ${args.slice(0, 2).join(" ")} failed: ${detail || "unknown error"}`);
  }
}

export function shellReadyDelayMs(): number {
  const raw = process.env.PI_HERDR_JOB_SHELL_READY_DELAY_MS;
  if (raw === undefined || raw === "") return 500;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 500;
}

export async function ensureHerdrAvailable(): Promise<void> {
  if (process.platform === "win32") throw new Error("herdr_job_start is not supported on Windows.");
  if (process.env.HERDR_ENV !== "1") throw new Error("herdr_job_start requires a Pi session running inside herdr (HERDR_ENV=1).");
  if (!process.env.HERDR_PANE_ID) throw new Error("HERDR_PANE_ID is not set; cannot identify the parent pane.");
  await run(["--version"]);
}

export const herdr: HerdrOperations = {
  async createPane({ name, cwd, placement, ratio }) {
    if (placement === "tab") {
      const workspace = process.env.HERDR_WORKSPACE_ID;
      if (!workspace) throw new Error("HERDR_WORKSPACE_ID is not set; cannot create a herdr tab.");
      const output = await run(["tab", "create", "--workspace", workspace, "--label", name, "--cwd", cwd, "--no-focus"]);
      return parseCreatedPane(output, placement);
    }
    const parent = process.env.HERDR_PANE_ID;
    if (!parent) throw new Error("HERDR_PANE_ID is not set; cannot split the parent pane.");
    const output = await run(["pane", "split", parent, "--direction", placement, "--ratio", String(ratio), "--cwd", cwd, "--no-focus"]);
    return parseCreatedPane(output, placement);
  },
  async renamePane(paneId, name) {
    await run(["pane", "rename", paneId, name]);
  },
  async runPane(paneId, command) {
    await run(["pane", "run", paneId, command]);
  },
  async inspectPane(paneId) {
    try {
      return parsePaneInspection(await run(["pane", "get", paneId]), paneId);
    } catch (error) {
      return parsePaneInspectionError(error);
    }
  },
  async readPane(paneId, lines) {
    return run(["pane", "read", paneId, "--source", "recent-unwrapped", "--lines", String(lines)]);
  },
  async interruptPane(paneId) {
    await run(["pane", "send-keys", paneId, "ctrl+c"]);
  },
  async closePane(paneId) {
    await run(["pane", "close", paneId]);
  },
  async startAgent({ name, cwd, placement, env, argv }) {
    const currentTab = process.env.HERDR_TAB_ID;
    const workspace = process.env.HERDR_WORKSPACE_ID;
    if (!currentTab || !workspace) throw new Error("HERDR_TAB_ID and HERDR_WORKSPACE_ID are required to place a managed agent.");
    if (argv.length === 0) throw new Error("Managed agent argv must not be empty.");
    let tab = currentTab;
    let temporaryRootPane: string | undefined;
    if (placement === "tab") {
      const created = parseCreatedTab(await run(["tab", "create", "--workspace", workspace, "--label", name, "--cwd", cwd, "--no-focus"]));
      tab = created.tabId;
      temporaryRootPane = created.rootPaneId;
    }
    try {
      const args = ["agent", "start", name, "--cwd", cwd, "--tab", tab, "--split", placement === "tab" ? "right" : placement, "--no-focus"];
      for (const [key, value] of Object.entries(env)) args.push("--env", `${key}=${value}`);
      args.push("--", ...argv);
      const launched = parseAgentLaunch(await run(args));
      if (temporaryRootPane) await run(["pane", "close", temporaryRootPane]);
      return launched;
    } catch (error) {
      if (temporaryRootPane) {
        try { await run(["pane", "close", temporaryRootPane]); } catch { /* best effort cleanup */ }
      }
      throw error;
    }
  },
  async inspectAgent(target) {
    try {
      return parseAgentInspection(await run(["agent", "get", target]));
    } catch (error) {
      const inspection = parsePaneInspectionError(error);
      return inspection.kind === "missing"
        ? inspection
        : { kind: "unavailable" as const, error: inspection.kind === "unavailable" ? inspection.error : "herdr agent get failed" };
    }
  },
  async readAgent(target, lines) {
    return run(["agent", "read", target, "--source", "recent-unwrapped", "--lines", String(Math.max(1, Math.min(500, Math.floor(lines))))]);
  },
  async sendAgentText(target, text) {
    await run(["agent", "send", target, agentSubmissionText(text)]);
  },
};

export const __herdrTest__ = { parseCreatedPane, parseCreatedTab, parsePaneInspection, parsePaneInspectionError, parseAgentLaunch, parseAgentInspection, agentSubmissionText };
