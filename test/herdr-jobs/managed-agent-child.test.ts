import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import managedAgentChildExtension from "../../extensions/herdr-jobs/managed-agent-child.ts";

test("herdr_agent_done publishes a durable completion sidecar and exits", async () => {
  const tools = new Map<string, any>();
  const pi = { registerTool(tool: { name: string }) { tools.set(tool.name, tool); } } as unknown as ExtensionAPI;
  managedAgentChildExtension(pi);
  const root = await mkdtemp(join(tmpdir(), "managed-agent-child-"));
  const completionFile = join(root, "completion.json");
  const previousId = process.env.PI_HERDR_MANAGED_AGENT_ID;
  const previousFile = process.env.PI_HERDR_MANAGED_AGENT_COMPLETION_FILE;
  process.env.PI_HERDR_MANAGED_AGENT_ID = "abcdefgh";
  process.env.PI_HERDR_MANAGED_AGENT_COMPLETION_FILE = completionFile;
  let shutdowns = 0;
  try {
    const result = await tools.get("herdr_agent_done").execute("call", { summary: "all done" }, undefined, undefined, { shutdown() { shutdowns += 1; } });
    assert.equal(shutdowns, 1);
    assert.equal(result.details.id, "abcdefgh");
    assert.deepEqual(JSON.parse(await readFile(completionFile, "utf8")), { version: 1, id: "abcdefgh", completedAt: JSON.parse(await readFile(completionFile, "utf8")).completedAt, summary: "all done" });
  } finally {
    if (previousId === undefined) delete process.env.PI_HERDR_MANAGED_AGENT_ID; else process.env.PI_HERDR_MANAGED_AGENT_ID = previousId;
    if (previousFile === undefined) delete process.env.PI_HERDR_MANAGED_AGENT_COMPLETION_FILE; else process.env.PI_HERDR_MANAGED_AGENT_COMPLETION_FILE = previousFile;
  }
});
