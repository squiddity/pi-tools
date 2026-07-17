import assert from "node:assert/strict";
import test from "node:test";
import { StringDecoder } from "node:string_decoder";
import { getTrackedPanelEntries } from "../../src/herdr-jobs/tracked.ts";
import type { RunningJob, RunningManagedAgent } from "../../src/herdr-jobs/types.ts";

function job(name: string): RunningJob {
  return {
    metadata: { version: 1, id: "abcdefgh", name, command: "true", cwd: "/tmp", kind: "finite", paneId: "pane", placement: "tab", createdAt: 1, startedAt: 1, readyRegex: false, cleanup: "on_success", delivery: "pending", state: "failed" },
    paths: { root: "/tmp", commandFile: "/tmp/c", runnerFile: "/tmp/r", logFile: "/tmp/l", metadataFile: "/tmp/m", resultFile: "/tmp/result" },
    lifecycle: { process: { kind: "failed", startedAt: 1, completedAt: 2, error: "pane disappeared" }, readiness: { kind: "not_configured" }, delivery: "delivered", readyDelivered: false, timeoutDelivered: false },
    logOffset: 0, logDecoder: new StringDecoder("utf8"), logRemainder: "", regexWindow: "", lastPaneCheckAt: 0,
  };
}

function agent(status: RunningManagedAgent["status"]): RunningManagedAgent {
  return {
    metadata: { version: 1, id: "ijklmnop", name: "orchestrator", task: "work", cwd: "/tmp", paneId: "agent-pane", terminalId: "terminal", extensionMode: "normal", extensions: [], sessionFile: "/tmp/session", startedAt: 1 },
    paths: { root: "/tmp", metadataFile: "/tmp/m", completionFile: "/tmp/c", sessionFile: "/tmp/session" },
    status,
  };
}

test("tracked panel entries retain failed jobs and exclude completed managed agents", () => {
  const entries = getTrackedPanelEntries([job("orphan")], [agent("working"), agent("completed")]);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.type), ["job", "managed_agent"]);
  assert.equal(entries[0]?.type === "job" ? entries[0].job.metadata.name : undefined, "orphan");
});
