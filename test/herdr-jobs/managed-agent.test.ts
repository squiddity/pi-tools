import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getManagedAgentPaths, parseManagedAgentCompletion, parseManagedAgentMetadata } from "../../src/herdr-jobs/artifacts.ts";
import { buildManagedAgentArgv, findLastAssistantText, projectManagedAgentStatus, resolveExtensionPaths, splitCommaList } from "../../src/herdr-jobs/managed-agent.ts";

test("builds an explicitly isolated Pi argv with a completion tool", () => {
  const argv = buildManagedAgentArgv({
    sessionFile: "/tmp/session.jsonl",
    childExtension: "/tmp/child.ts",
    task: "coordinate work",
    extensionMode: "explicit",
    extensions: ["/project/.pi/extensions/dev.ts"],
    tools: ["read", "subagent"],
    model: "test/model",
    thinking: "high",
  });
  assert.deepEqual(argv, [
    "pi", "--session", "/tmp/session.jsonl", "--no-extensions", "--extension", "/tmp/child.ts",
    "--extension", "/project/.pi/extensions/dev.ts", "--model", "test/model", "--thinking", "high",
    "--tools", "read,subagent,herdr_agent_done", "coordinate work",
  ]);
});

test("normalizes tool lists, extension paths, and Herdr agent states", () => {
  assert.deepEqual(splitCommaList(" read, bash,read ,"), ["read", "bash"]);
  assert.deepEqual(resolveExtensionPaths(".pi/extensions/a.ts, /tmp/b.ts", "/project"), ["/project/.pi/extensions/a.ts", "/tmp/b.ts"]);
  assert.equal(projectManagedAgentStatus("working"), "working");
  assert.equal(projectManagedAgentStatus("blocked"), "blocked");
  assert.equal(projectManagedAgentStatus("done"), "idle");
});

test("validates managed agent artifacts", () => {
  const paths = getManagedAgentPaths("/tmp/jobs", "abcdefgh");
  assert.equal(paths.completionFile, "/tmp/jobs/managed-agents/abcdefgh/completion.json");
  assert.deepEqual(parseManagedAgentCompletion({ version: 1, id: "abcdefgh", completedAt: 1, summary: "done" }, "abcdefgh"), { version: 1, id: "abcdefgh", completedAt: 1, summary: "done" });
  assert.equal(parseManagedAgentCompletion({ version: 1, id: "other", completedAt: 1 }, "abcdefgh"), null);
  assert.equal(parseManagedAgentMetadata({ version: 1, id: "abcdefgh", name: "A", task: "T", cwd: "/tmp", paneId: "p", terminalId: "t", extensionMode: "normal", extensions: [], sessionFile: "/tmp/session", startedAt: 1 })?.name, "A");
});

test("extracts the last usable managed-agent assistant summary", async () => {
  const root = await mkdtemp(join(tmpdir(), "managed-agent-session-"));
  const session = join(root, "session.jsonl");
  await writeFile(session, [
    JSON.stringify({ type: "session" }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "first" }] } }),
    "not json",
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "final summary" }] } }),
  ].join("\n"));
  assert.equal(await findLastAssistantText(session), "final summary");
});
