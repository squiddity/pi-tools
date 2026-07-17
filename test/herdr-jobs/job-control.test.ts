import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureJobDirectory, getJobPaths } from "../../src/herdr-jobs/artifacts.ts";
import { closeTrackedJob } from "../../src/herdr-jobs/job-control.ts";
import { formatFailureMessage } from "../../src/herdr-jobs/format.ts";
import { createRunningJob } from "../../src/herdr-jobs/runtime.ts";
import type { HerdrOperations, PersistedJobMetadata } from "../../src/herdr-jobs/types.ts";

function missingPaneOperations(): HerdrOperations {
  return {
    createPane: async () => "pane", renamePane: async () => {}, runPane: async () => {}, inspectPane: async () => ({ kind: "missing", error: "gone" }), readPane: async () => "", interruptPane: async () => {}, closePane: async () => { throw new Error("pane not found"); },
    startAgent: async () => ({ paneId: "pane", terminalId: "terminal" }), inspectAgent: async () => ({ kind: "missing", error: "gone" }),
  };
}

test("closeTrackedJob forgets an externally removed pane", async () => {
  const root = await mkdtemp(join(tmpdir(), "herdr-job-close-"));
  const paths = getJobPaths(root, "abcdefgh");
  await ensureJobDirectory(paths);
  const metadata: PersistedJobMetadata = {
    version: 1, id: "abcdefgh", name: "orphan", command: "sleep 1", cwd: root, kind: "finite", paneId: "pane", placement: "tab", createdAt: 1, startedAt: 1, readyRegex: false, cleanup: "on_success", delivery: "pending", state: "failed",
  };
  const job = createRunningJob(metadata, paths);
  const result = await closeTrackedJob(job, missingPaneOperations());
  assert.deepEqual(result, { paneAlreadyMissing: true });
  assert.equal(job.lifecycle.process.kind, "closed");
  assert.equal(job.lifecycle.delivery, "suppressed");
  const message = await formatFailureMessage(job, "pane disappeared", { pane: "missing", tracking: "retained" });
  assert.match(message, /Pane: pane \(missing\)/);
  assert.match(message, /use herdr_job_close to forget/);
});
