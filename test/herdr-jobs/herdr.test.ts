import assert from "node:assert/strict";
import test from "node:test";
import { __herdrTest__ } from "../../src/herdr-jobs/herdr.ts";

test("parses split and tab create responses", () => {
  assert.equal(__herdrTest__.parseCreatedPane('{"result":{"pane":{"pane_id":"w:p2"}}}', "down"), "w:p2");
  assert.equal(__herdrTest__.parseCreatedPane('{"result":{"root_pane":{"pane_id":"w:p3"}}}', "tab"), "w:p3");
  assert.throws(() => __herdrTest__.parseCreatedPane("{}", "down"), /no pane id/);
});

test("parses managed agent launch and status responses", () => {
  assert.deepEqual(__herdrTest__.parseCreatedTab('{"result":{"tab":{"tab_id":"w:t2"},"root_pane":{"pane_id":"w:p2"}}}'), { tabId: "w:t2", rootPaneId: "w:p2" });
  assert.deepEqual(__herdrTest__.parseAgentLaunch('{"result":{"agent":{"pane_id":"w:p2","terminal_id":"term_1"}}}'), { paneId: "w:p2", terminalId: "term_1" });
  assert.deepEqual(__herdrTest__.parseAgentInspection('{"result":{"agent":{"agent_status":"working"}}}'), { kind: "present", status: "working" });
  assert.deepEqual(__herdrTest__.parseAgentInspection('{"error":{"code":"agent_not_found","message":"gone"}}'), { kind: "missing", error: "gone" });
  assert.equal(__herdrTest__.agentSubmissionText("continue"), "continue\n");
  assert.equal(__herdrTest__.agentSubmissionText("continue\n"), "continue\n");
});

test("distinguishes a missing pane from a malformed response", () => {  assert.deepEqual(__herdrTest__.parsePaneInspection('{"error":{"code":"pane_not_found","message":"gone"}}', "w:p2"), { kind: "missing", error: "gone" });
  assert.deepEqual(__herdrTest__.parsePaneInspection('{"result":{"pane":{"pane_id":"w:p2"}}}', "w:p2"), { kind: "present" });
  assert.deepEqual(__herdrTest__.parsePaneInspectionError({ stderr: '{"error":{"code":"not_found"}}' }), { kind: "missing", error: "pane not found" });
});
