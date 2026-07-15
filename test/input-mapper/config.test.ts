import assert from "node:assert/strict";
import test from "node:test";
import { parseConfig } from "../../src/input-mapper/config.ts";

test("accepts declarative version-one profiles", () => {
  const config = parseConfig(JSON.stringify({
    version: 1,
    profiles: {
      review: {
        activate: { tool: "deployment_review" },
        mouse: { protocol: "sgr", tracking: "buttons" },
        gestures: { thresholdCells: 2, suppressTapAfterWheel: true },
        mappings: [{ report: "wheel-down", send: "down" }, { report: "left-release", send: "f8" }],
      },
    },
  }), "test config");
  assert.equal(config.profiles.review.activate?.tool, "deployment_review");
  assert.equal(config.profiles.review.mappings?.[1].send, "f8");
});

test("rejects unknown fields and arbitrary key injection", () => {
  assert.throws(() => parseConfig('{"version":1,"profiles":{},"run":"code"}', "test config"), /unsupported field/);
  assert.throws(() => parseConfig('{"version":1,"profiles":{"bad":{"mappings":[{"report":"wheel-down","send":"ctrl-c"}]}}}', "test config"), /unsupported/);
  assert.throws(() => parseConfig('{"version":2,"profiles":{}}', "test config"), /version must be 1/);
});
