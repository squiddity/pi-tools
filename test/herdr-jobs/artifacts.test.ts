import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJobId, getArtifactRoot, getJobPaths, readLogTail, readResult, writeAtomicJson } from "../../src/herdr-jobs/artifacts.ts";

test("artifact roots distinguish persisted and ephemeral sessions", () => {
  assert.equal(getArtifactRoot("/sessions", "session-id"), "/sessions/artifacts/session-id/herdr-jobs");
  assert.match(getArtifactRoot(undefined, undefined), /pi-herdr-jobs/);
  assert.match(createJobId(), /^[a-zA-Z0-9_-]{8,128}$/);
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
