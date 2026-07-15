import assert from "node:assert/strict";
import test from "node:test";
import { DISABLE_SGR_MOUSE, ENABLE_SGR_MOUSE, parseSgrMouse } from "../../src/ui-catalog/mouse.ts";

test("parses an SGR left-button press", () => {
  assert.deepEqual(parseSgrMouse("\x1b[<0;12;7M"), {
    button: "left",
    action: "press",
    column: 12,
    row: 7,
    shift: false,
    alt: false,
    ctrl: false,
  });
});

test("parses release, modifiers, and wheel events", () => {
  assert.deepEqual(parseSgrMouse("\x1b[<20;4;2m"), {
    button: "left",
    action: "release",
    column: 4,
    row: 2,
    shift: true,
    alt: false,
    ctrl: true,
  });
  assert.equal(parseSgrMouse("\x1b[<65;2;3M")?.button, "wheel-down");
  assert.equal(parseSgrMouse("plain text"), undefined);
});

test("uses paired SGR mouse mode escape sequences", () => {
  assert.equal(ENABLE_SGR_MOUSE, "\x1b[?1000h\x1b[?1006h");
  assert.equal(DISABLE_SGR_MOUSE, "\x1b[?1006l\x1b[?1000l");
});
