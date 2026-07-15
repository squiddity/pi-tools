import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { ensureJobDirectory, getJobPaths } from "../../src/herdr-jobs/artifacts.ts";
import { ensureHerdrAvailable, herdr, shellReadyDelayMs } from "../../src/herdr-jobs/herdr.ts";
import { createRunningJob } from "../../src/herdr-jobs/runtime.ts";
import { paneRunCommand, writeRunnerFiles } from "../../src/herdr-jobs/runner.ts";
import type { PersistedJobMetadata, WatchEvent } from "../../src/herdr-jobs/types.ts";
import { watchJob } from "../../src/herdr-jobs/watcher.ts";

const enabled = process.env.HERDR_ENV === "1" && Boolean(process.env.HERDR_PANE_ID);
const execFileAsync = promisify(execFile);

async function splitDown(parentPaneId: string, cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("herdr", ["pane", "split", parentPaneId, "--direction", "down", "--ratio", "0.2", "--cwd", cwd, "--no-focus"], { encoding: "utf8" });
  const paneId = (JSON.parse(stdout) as { result?: { pane?: { pane_id?: unknown } } }).result?.pane?.pane_id;
  if (typeof paneId !== "string" || !paneId) throw new Error(`herdr pane split returned no pane id: ${stdout}`);
  return paneId;
}

test("Herdr finite job publishes a durable sidecar", { skip: !enabled, timeout: 15_000 }, async () => {
  await ensureHerdrAvailable();
  const root = await mkdtemp(join(tmpdir(), "herdr-jobs-integration-"));
  const paths = getJobPaths(root, "abcdefgh");
  await ensureJobDirectory(paths);
  const startedAt = Date.now();
  let paneId: string | undefined;
  try {
    paneId = await herdr.createPane({ name: "herdr-job-test", cwd: root, placement: "tab", ratio: 0.2 });
    const metadata: PersistedJobMetadata = { version: 1, id: "abcdefgh", name: "integration", command: "sleep 0.2; echo integration-success", cwd: root, kind: "finite", paneId, placement: "tab", createdAt: startedAt, startedAt, readyRegex: false, cleanup: "always", delivery: "pending", state: "launching" };
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

test("Herdr tab can contain a downward finite-job pane", { skip: !enabled, timeout: 15_000 }, async () => {
  await ensureHerdrAvailable();
  const root = await mkdtemp(join(tmpdir(), "herdr-jobs-tab-split-"));
  const paths = getJobPaths(root, "ijklmnop");
  await ensureJobDirectory(paths);
  const startedAt = Date.now();
  let tabPaneId: string | undefined;
  let jobPaneId: string | undefined;
  try {
    tabPaneId = await herdr.createPane({ name: "herdr-tab-split-test", cwd: root, placement: "tab", ratio: 0.2 });
    jobPaneId = await splitDown(tabPaneId, root);
    const metadata: PersistedJobMetadata = { version: 1, id: "ijklmnop", name: "nested split", command: "sleep 0.2; echo nested-split-success", cwd: root, kind: "finite", paneId: jobPaneId, placement: "down", createdAt: startedAt, startedAt, readyRegex: false, cleanup: "always", delivery: "pending", state: "launching" };
    await writeRunnerFiles({ id: metadata.id, command: metadata.command, cwd: root, paths, startedAt });
    await new Promise((resolve) => setTimeout(resolve, shellReadyDelayMs()));
    await herdr.runPane(jobPaneId, paneRunCommand(paths.runnerFile));
    const events: WatchEvent[] = [];
    await watchJob(createRunningJob(metadata, paths), new AbortController().signal, herdr, (event) => { events.push(event); });
    assert.equal(events[0]?.kind, "result");
    assert.equal(events[0]?.kind === "result" ? events[0].result.exitCode : undefined, 0);
  } finally {
    if (jobPaneId) await herdr.closePane(jobPaneId).catch(() => {});
    if (tabPaneId) await herdr.closePane(tabPaneId).catch(() => {});
  }
});
