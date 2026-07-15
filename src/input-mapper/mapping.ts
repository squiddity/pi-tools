import type { InputKey, InputMapping, MouseReport } from "./types.ts";
import type { SgrMouseEvent } from "./sgr.ts";

const KEY_BYTES: Record<InputKey, string> = {
  up: "\x1b[A",
  down: "\x1b[B",
  enter: "\r",
  space: " ",
  escape: "\x1b",
};

export function reportName(event: SgrMouseEvent): MouseReport | undefined {
  if (event.button === "wheel-up") return "wheel-up";
  if (event.button === "wheel-down") return "wheel-down";
  if (event.button === "left" && event.action === "release") return "left-release";
  if (event.button === "right" && event.action === "release") return "right-release";
  return undefined;
}

export function mappingForReport(mappings: InputMapping[], event: SgrMouseEvent): InputMapping | undefined {
  const report = reportName(event);
  return report ? mappings.find((mapping) => mapping.report === report) : undefined;
}

export function keyBytes(key: InputKey): string {
  return KEY_BYTES[key];
}

