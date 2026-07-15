import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJobId, getArtifactRoot, getJobPaths, parseMetadata, readLogChunk, readLogTail, readResult, writeAtomicJson } from "../../src/herdr-jobs/artifacts.ts";

test("artifact roots distinguish persisted and ephemeral sessions", () => {
  assert.equal(getArtifactRoot("/sessions", "session-id"), "/sessions/artifacts/session-id/herdr-jobs");
  assert.match(getArtifactRoot(undefined, undefined), /pi-herdr-jobs/);
  assert.match(createJobId(), /^[a-zA-Z0-9_-]{8,128}$/);
});

test("metadata accepts the cleanup policy and migrates the keepPane alias", () => {
  const base = {
    version: 1, id: "abcdefgh", name: "test", command: "echo test", cwd: "/tmp",
    kind: "finite", paneId: "w:p2", placement: "tab", createdAt: 1, startedAt: 1,
    readyRegex: false, delivery: "pending", state: "running",
  };
  assert.equal(parseMetadata({ ...base, cleanup: "on_success" })?.cleanup, "on_success");
  assert.equal(parseMetadata({ ...base, keepPane: true })?.cleanup, "never");
  assert.equal(parseMetadata({ ...base, keepPane: false })?.cleanup, "always");
  assert.equal(parseMetadata({ ...base, cleanup: "bad" }), null);
});

test("log chunk reads are incremental and bounded", async () => {
  const root = await mkdtemp(join(tmpdir(), "herdr-jobs-chunk-"));
  const logFile = join(root, "output.log");
  await writeFile(logFile, "abcdefghij");
  const first = await readLogChunk(logFile, 0, 4);
  assert.equal(first.bytes.toString(), "abcd");
  assert.equal(first.nextOffset, 4);
  const second = await readLogChunk(logFile, first.nextOffset, 4);
  assert.equal(second.bytes.toString(), "efgh");
  assert.equal(second.nextOffset, 8);
});

test("atomic result JSON round trips and log tails are bounded", async () => {
  const root = await mkdtemp(join(tmpdir(), "herdr-jobs-artifacts-"));
  const paths = getJobPaths(root, "abcdefgh");
  await writeAtomicJson(paths.resultFile, { version: 1, id: "abcdefgh", exitCode: 0, startedAt: 1, completedAt: 2 });
  assert.equal((await readResult(paths, "abcdefgh"))?.exitCode, 0);
  await writeFile(paths.logFile, Array.from({ length: 100 }, (_, i) => `line-${i}`).join("\n"));
  const tail = await readLogTail(paths.logFile, 3);
  assert.match(tail.content, /line-99/);
  assert.doesNotMatch(tail.content, /line-0\n/);
});
