import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureJobDirectory, getJobPaths, writeAtomicJson } from "../../src/herdr-jobs/artifacts.ts";
import { createLifecycle } from "../../src/herdr-jobs/lifecycle.ts";
import { createRunningJob } from "../../src/herdr-jobs/runtime.ts";
import type { HerdrOperations, PersistedJobMetadata, WatchEvent } from "../../src/herdr-jobs/types.ts";
import { createRunningLogState, scanReadiness, watchJob } from "../../src/herdr-jobs/watcher.ts";

function fakeOperations(): HerdrOperations {
  return {
    createPane: async () => "w:p2", renamePane: async () => {}, runPane: async () => {},
    inspectPane: async () => ({ kind: "present" }), readPane: async () => "", interruptPane: async () => {}, closePane: async () => {},
    startAgent: async () => ({ paneId: "w:p3", terminalId: "term_1" }), inspectAgent: async () => ({ kind: "present", status: "idle" }), sendAgentText: async () => {},
  };
}

async function testJob() {
  const root = await mkdtemp(join(tmpdir(), "herdr-jobs-watcher-"));
  const paths = getJobPaths(root, "abcdefgh");
  await ensureJobDirectory(paths);
  const metadata: PersistedJobMetadata = { version: 1, id: "abcdefgh", name: "test", command: "echo test", cwd: root, kind: "finite", paneId: "w:p2", placement: "down", createdAt: 1, startedAt: 1, readyPattern: "RÉADY", readyRegex: false, cleanup: "never", delivery: "pending", state: "running" };
  const job = createRunningJob(metadata, paths);
  job.lifecycle = createLifecycle(1, metadata.readyPattern);
  Object.assign(job, createRunningLogState());
  return job;
}

test("readiness scanner retains UTF-8 decoder state across chunks", async () => {
  const job = await testJob();
  const text = Buffer.from("RÉADY");
  assert.equal(scanReadiness(job, job.logDecoder.write(text.subarray(0, 2))), undefined);
  assert.equal(scanReadiness(job, job.logDecoder.write(text.subarray(2))), "RÉADY");
});

test("watcher accepts the terminal marker if result publication is unavailable", async () => {
  const job = await testJob();
  const events: WatchEvent[] = [];
  const operations = fakeOperations();
  operations.readPane = async () => "__PI_HERDR_JOB_abcdefgh_DONE_130__";
  await watchJob(job, new AbortController().signal, operations, (event) => { events.push(event); });
  assert.equal(events[0]?.kind, "result");
  assert.equal(events[0]?.kind === "result" ? events[0].result.exitCode : undefined, 130);
});

test("watcher prioritizes the result sidecar", async () => {
  const job = await testJob();
  await writeAtomicJson(job.paths.resultFile, { version: 1, id: job.metadata.id, exitCode: 7, startedAt: 1, completedAt: 2 });
  const events: WatchEvent[] = [];
  await watchJob(job, new AbortController().signal, fakeOperations(), (event) => { events.push(event); });
  assert.deepEqual(events, [{ kind: "result", result: { version: 1, id: "abcdefgh", exitCode: 7, startedAt: 1, completedAt: 2 } }]);
});
