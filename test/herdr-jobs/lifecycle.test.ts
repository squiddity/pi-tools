import assert from "node:assert/strict";
import test from "node:test";
import { createLifecycle, markInterruptRequested, markReady, markReadyTimeout, markResult, projectLifecycle } from "../../src/herdr-jobs/lifecycle.ts";

test("lifecycle projects running, readiness, interruption, and terminal result", () => {
  let lifecycle = createLifecycle(100, "READY");
  assert.equal(projectLifecycle(lifecycle, 101), "waiting for ready");
  lifecycle = markReady(lifecycle, 102, "READY");
  assert.equal(projectLifecycle(lifecycle, 103), "ready");
  lifecycle = markInterruptRequested(lifecycle, 104);
  assert.equal(projectLifecycle(lifecycle, 105), "interrupt requested");
  lifecycle = markResult(lifecycle, { version: 1, id: "abcdefgh", exitCode: 130, startedAt: 100, completedAt: 106 });
  assert.equal(projectLifecycle(lifecycle, 107), "failed");
});

test("readiness timeout happens only once", () => {
  let lifecycle = createLifecycle(100, "READY");
  lifecycle = markReadyTimeout(lifecycle, 200);
  assert.equal(lifecycle.readiness.kind, "timed_out");
  assert.equal(markReadyTimeout(lifecycle, 300), lifecycle);
});
