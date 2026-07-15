import assert from "node:assert/strict";
import test from "node:test";
import { keyBytes, mappingForReport, reportName } from "../../src/input-mapper/mapping.ts";
import { parseSgrMouse } from "../../src/input-mapper/sgr.ts";

test("a configured Ask profile maps one report to one existing keyboard input", () => {
  const mappings = [
    { report: "wheel-up" as const, send: "up" as const },
    { report: "wheel-down" as const, send: "down" as const },
    { report: "left-release" as const, send: "enter" as const },
  ];
  const up = parseSgrMouse("\x1b[<64;1;1M");
  const down = parseSgrMouse("\x1b[<65;1;1M");
  const release = parseSgrMouse("\x1b[<0;1;1m");
  assert.equal(up && mappingForReport(mappings, up)?.send, "up");
  assert.equal(down && mappingForReport(mappings, down)?.send, "down");
  assert.equal(release && mappingForReport(mappings, release)?.send, "enter");
  assert.equal(keyBytes("up"), "\x1b[A");
  assert.equal(keyBytes("down"), "\x1b[B");
  assert.equal(keyBytes("enter"), "\r");
});

test("only supported reports are named", () => {
  const press = parseSgrMouse("\x1b[<0;1;1M");
  const motion = parseSgrMouse("\x1b[<32;1;1M");
  assert.equal(press && reportName(press), undefined);
  assert.equal(motion && reportName(motion), undefined);
});
