import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureJobDirectory, getManagedAgentPaths, writeAtomicJson } from "../../src/herdr-jobs/artifacts.ts";
import { watchManagedAgent } from "../../src/herdr-jobs/managed-agent-watcher.ts";
import type { HerdrOperations, RunningManagedAgent } from "../../src/herdr-jobs/types.ts";

function operations(): HerdrOperations {
  return {
    createPane: async () => "pane", renamePane: async () => {}, runPane: async () => {}, inspectPane: async () => ({ kind: "present" }), readPane: async () => "", interruptPane: async () => {}, closePane: async () => {},
    startAgent: async () => ({ paneId: "pane", terminalId: "terminal" }), inspectAgent: async () => ({ kind: "present", status: "working" }), sendAgentText: async () => {},
  };
}

test("managed agent watcher trusts explicit completion and projects Herdr status", async () => {
  const root = await mkdtemp(join(tmpdir(), "managed-agent-watch-"));
  const paths = getManagedAgentPaths(root, "abcdefgh");
  await ensureJobDirectory(paths);
  const agent: RunningManagedAgent = {
    metadata: { version: 1, id: "abcdefgh", name: "orchestrator", task: "work", cwd: root, paneId: "pane", terminalId: "terminal", extensionMode: "normal", extensions: [], sessionFile: paths.sessionFile, startedAt: 1 },
    paths,
    status: "starting",
  };
  await writeAtomicJson(paths.completionFile, { version: 1, id: "abcdefgh", completedAt: 2, summary: "finished" });
  const completion = await watchManagedAgent(agent, new AbortController().signal, operations());
  assert.deepEqual(completion, { version: 1, id: "abcdefgh", completedAt: 2, summary: "finished" });
  assert.equal(agent.status, "starting", "completion wins before a status inspection is needed");
});
