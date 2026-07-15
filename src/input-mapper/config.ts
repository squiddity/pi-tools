import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConfigSource, InputKey, InputMapperConfig, InputMapping, InputProfile, MouseReport, ResolvedProfile } from "./types.ts";

const VALID_KEYS = new Set<InputKey>(["up", "down", "enter", "space", "escape"]);
const VALID_REPORTS = new Set<MouseReport>(["wheel-up", "wheel-down", "left-release", "right-release"]);

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function only(value: Record<string, unknown>, allowed: string[], name: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${name} contains unsupported field ${JSON.stringify(key)}.`);
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function parseMapping(value: unknown, index: number): InputMapping {
  const mapping = object(value, `mappings[${index}]`);
  only(mapping, ["report", "send"], `mappings[${index}]`);
  const report = string(mapping.report, `mappings[${index}].report`) as MouseReport;
  const send = string(mapping.send, `mappings[${index}].send`) as InputKey;
  if (!VALID_REPORTS.has(report)) throw new Error(`mappings[${index}].report is unsupported.`);
  if (!VALID_KEYS.has(send)) throw new Error(`mappings[${index}].send is unsupported.`);
  return { report, send };
}

function parseProfile(value: unknown, id: string): Partial<Omit<InputProfile, "id">> {
  const profile = object(value, `profiles.${id}`);
  only(profile, ["activate", "mouse", "gestures", "mappings"], `profiles.${id}`);
  const parsed: Partial<Omit<InputProfile, "id">> = {};
  if (profile.activate !== undefined) {
    const activate = object(profile.activate, `profiles.${id}.activate`);
    only(activate, ["tool"], `profiles.${id}.activate`);
    parsed.activate = { tool: string(activate.tool, `profiles.${id}.activate.tool`) };
  }
  if (profile.mouse !== undefined) {
    const mouse = object(profile.mouse, `profiles.${id}.mouse`);
    only(mouse, ["protocol", "tracking"], `profiles.${id}.mouse`);
    if (mouse.protocol !== undefined && mouse.protocol !== "sgr") throw new Error(`profiles.${id}.mouse.protocol must be "sgr".`);
    if (mouse.tracking !== undefined && mouse.tracking !== "buttons") throw new Error(`profiles.${id}.mouse.tracking must be "buttons".`);
    parsed.mouse = { protocol: mouse.protocol as "sgr" | undefined, tracking: mouse.tracking as "buttons" | undefined };
  }
  if (profile.gestures !== undefined) {
    const gestures = object(profile.gestures, `profiles.${id}.gestures`);
    only(gestures, ["thresholdCells", "axisLockRatio", "suppressTapAfterWheel"], `profiles.${id}.gestures`);
    for (const key of ["thresholdCells", "axisLockRatio"] as const) {
      if (gestures[key] !== undefined && (typeof gestures[key] !== "number" || !Number.isFinite(gestures[key]) || gestures[key] < 0)) throw new Error(`profiles.${id}.gestures.${key} must be a non-negative number.`);
    }
    if (gestures.suppressTapAfterWheel !== undefined && typeof gestures.suppressTapAfterWheel !== "boolean") throw new Error(`profiles.${id}.gestures.suppressTapAfterWheel must be boolean.`);
    parsed.gestures = gestures as InputProfile["gestures"];
  }
  if (profile.mappings !== undefined) {
    if (!Array.isArray(profile.mappings)) throw new Error(`profiles.${id}.mappings must be an array.`);
    parsed.mappings = profile.mappings.map(parseMapping);
  }
  return parsed;
}

export function parseConfig(text: string, source: string): InputMapperConfig {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error(`${source} is not valid JSON.`); }
  const config = object(raw, source);
  only(config, ["version", "profiles"], source);
  if (config.version !== 1) throw new Error(`${source}.version must be 1.`);
  const profiles = object(config.profiles, `${source}.profiles`);
  const parsed: InputMapperConfig["profiles"] = {};
  for (const [id, profile] of Object.entries(profiles)) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) throw new Error(`${source}.profiles has invalid ID ${JSON.stringify(id)}.`);
    parsed[id] = parseProfile(profile, id);
  }
  return { version: 1, profiles: parsed };
}

async function readConfig(path: string, source: ConfigSource, errors: string[]): Promise<{ source: ConfigSource; config: InputMapperConfig } | undefined> {
  try {
    return { source, config: parseConfig(await readFile(path, "utf8"), path) };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    errors.push(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function mergeProfile(current: ResolvedProfile | undefined, id: string, patch: Partial<Omit<InputProfile, "id">>, source: ConfigSource): ResolvedProfile {
  const base: ResolvedProfile = current ?? { id, mappings: [], sources: [] };
  return {
    ...base,
    ...patch,
    activate: patch.activate ?? base.activate,
    mouse: { ...base.mouse, ...patch.mouse },
    gestures: { ...base.gestures, ...patch.gestures },
    mappings: patch.mappings ?? base.mappings,
    sources: [...base.sources, source],
  };
}

export type LoadedProfiles = { profiles: Map<string, ResolvedProfile>; errors: string[]; userPath: string; projectPath: string; projectIgnored: boolean };

export async function loadProfiles(cwd: string, projectTrusted: boolean): Promise<LoadedProfiles> {
  const errors: string[] = [];
  const userPath = join(homedir(), ".pi", "agent", "input-mapper.json");
  const projectPath = join(cwd, ".pi", "input-mapper.json");
  const profiles = new Map<string, ResolvedProfile>();

  const user = await readConfig(userPath, "user", errors);
  const project = projectTrusted ? await readConfig(projectPath, "project", errors) : undefined;
  for (const loaded of [user, project]) {
    if (!loaded) continue;
    for (const [id, patch] of Object.entries(loaded.config.profiles)) profiles.set(id, mergeProfile(profiles.get(id), id, patch, loaded.source));
  }
  for (const [id, profile] of profiles) {
    if (profile.mappings.length === 0) errors.push(`Profile ${JSON.stringify(id)} has no mappings and is ignored.`);
  }
  return { profiles, errors, userPath, projectPath, projectIgnored: !projectTrusted };
}
