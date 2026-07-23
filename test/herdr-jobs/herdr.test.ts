import assert from "node:assert/strict";
import test from "node:test";
import { __herdrTest__ } from "../../src/herdr-jobs/herdr.ts";

test("parses split and tab create responses", () => {
  assert.equal(__herdrTest__.parseCreatedPane('{"result":{"pane":{"pane_id":"w:p2"}}}', "down"), "w:p2");
  assert.equal(__herdrTest__.parseCreatedPane('{"result":{"root_pane":{"pane_id":"w:p3"}}}', "tab"), "w:p3");
  assert.throws(() => __herdrTest__.parseCreatedPane("{}", "down"), /no pane id/);
});

test("distinguishes a missing pane from a malformed response", () => {  assert.deepEqual(__herdrTest__.parsePaneInspection('{"error":{"code":"pane_not_found","message":"gone"}}', "w:p2"), { kind: "missing", error: "gone" });
  assert.deepEqual(__herdrTest__.parsePaneInspection('{"result":{"pane":{"pane_id":"w:p2"}}}', "w:p2"), { kind: "present" });
  assert.deepEqual(__herdrTest__.parsePaneInspectionError({ stderr: '{"error":{"code":"not_found"}}' }), { kind: "missing", error: "pane not found" });
});
