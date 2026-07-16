import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentExtensionMode } from "./types.ts";

export const MANAGED_AGENT_DONE_TOOL = "herdr_agent_done";

export function splitCommaList(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean))];
}

export function resolveExtensionPaths(value: string | undefined, cwd: string): string[] {
  return splitCommaList(value).map((path) => resolve(cwd, path));
}

export function buildManagedAgentArgv(options: {
  piExecutable?: string;
  sessionFile: string;
  childExtension: string;
  task: string;
  extensionMode: AgentExtensionMode;
  extensions: string[];
  tools?: string[];
  model?: string;
  thinking?: string;
}): string[] {
  const argv = [options.piExecutable ?? "pi", "--session", options.sessionFile];
  if (options.extensionMode === "explicit") argv.push("--no-extensions");
  argv.push("--extension", options.childExtension);
  for (const extension of options.extensions) argv.push("--extension", extension);
  if (options.model) argv.push("--model", options.model);
  if (options.thinking) argv.push("--thinking", options.thinking);
  if (options.tools && options.tools.length > 0) {
    argv.push("--tools", [...new Set([...options.tools, MANAGED_AGENT_DONE_TOOL])].join(","));
  }
  argv.push(options.task);
  return argv;
}

export function projectManagedAgentStatus(status: "idle" | "working" | "blocked" | "done" | "unknown"):
  "starting" | "working" | "idle" | "blocked" {
  if (status === "working") return "working";
  if (status === "blocked") return "blocked";
  if (status === "idle" || status === "done") return "idle";
  return "starting";
}

export async function findLastAssistantText(sessionFile: string): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await readFile(sessionFile, "utf8");
  } catch {
    return undefined;
  }
  const lines = raw.split("\n").filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]!) as { type?: unknown; message?: { role?: unknown; content?: unknown } };
      if (entry.type !== "message" || entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
      const text = entry.message.content
        .filter((block): block is { type: "text"; text: string } =>
          !!block && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string",
        )
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (text) return text;
    } catch {
      // A partially appended session line is not a completion failure.
    }
  }
  return undefined;
}
