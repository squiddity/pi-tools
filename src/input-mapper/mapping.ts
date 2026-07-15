import type { InputKey, InputMapping, MouseReport } from "./types.ts";
import type { SgrMouseEvent } from "./sgr.ts";

const KEY_BYTES: Record<InputKey, string> = {
  up: "\x1b[A",
  down: "\x1b[B",
  enter: "\r",
  space: " ",
  escape: "\x1b",
  f1: "\x1bOP",
  f2: "\x1bOQ",
  f3: "\x1bOR",
  f4: "\x1bOS",
  f5: "\x1b[15~",
  f6: "\x1b[17~",
  f7: "\x1b[18~",
  f8: "\x1b[19~",
  f9: "\x1b[20~",
  f10: "\x1b[21~",
  f11: "\x1b[23~",
  f12: "\x1b[24~",
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

