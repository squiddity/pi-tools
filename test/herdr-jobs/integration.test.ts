import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureJobDirectory, getJobPaths } from "../../src/herdr-jobs/artifacts.ts";
import { ensureHerdrAvailable, herdr, shellReadyDelayMs } from "../../src/herdr-jobs/herdr.ts";
import { createRunningJob } from "../../src/herdr-jobs/runtime.ts";
import { paneRunCommand, writeRunnerFiles } from "../../src/herdr-jobs/runner.ts";
import type { PersistedJobMetadata, WatchEvent } from "../../src/herdr-jobs/types.ts";
import { watchJob } from "../../src/herdr-jobs/watcher.ts";

const enabled = process.env.HERDR_ENV === "1" && Boolean(process.env.HERDR_PANE_ID);

test("Herdr finite job publishes a durable sidecar", { skip: !enabled, timeout: 15_000 }, async () => {
  await ensureHerdrAvailable();
  const root = await mkdtemp(join(tmpdir(), "herdr-jobs-integration-"));
  const paths = getJobPaths(root, "abcdefgh");
  await ensureJobDirectory(paths);
  const startedAt = Date.now();
  let paneId: string | undefined;
  try {
    paneId = await herdr.createPane({ name: "herdr-job-test", cwd: root, placement: "down", ratio: 0.2 });
    const metadata: PersistedJobMetadata = { version: 1, id: "abcdefgh", name: "integration", command: "sleep 0.2; echo integration-success", cwd: root, kind: "finite", paneId, placement: "down", createdAt: startedAt, startedAt, readyRegex: false, keepPane: false, delivery: "pending", state: "launching" };
    await writeRunnerFiles({ id: metadata.id, command: metadata.command, cwd: root, paths, startedAt });
    await new Promise((resolve) => setTimeout(resolve, shellReadyDelayMs()));
    await herdr.runPane(paneId, paneRunCommand(paths.runnerFile));
    const job = createRunningJob(metadata, paths);
    const events: WatchEvent[] = [];
    await watchJob(job, new AbortController().signal, herdr, (event) => { events.push(event); });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.kind, "result");
    assert.equal(events[0]?.kind === "result" ? events[0].result.exitCode : undefined, 0);
  } finally {
    if (paneId) await herdr.closePane(paneId).catch(() => {});
  }
});
