import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import herdrJobsExtension from "../../extensions/herdr-jobs/index.ts";

const enabled = process.env.HERDR_ENV === "1" && Boolean(process.env.HERDR_PANE_ID);

test("extension start returns before a Herdr service completes and delivers readiness/result", { skip: !enabled, timeout: 15_000 }, async () => {
  const tools = new Map<string, any>();
  const handlers = new Map<string, any>();
  const messages: Array<{ customType: string; content: string; details?: unknown }> = [];
  const sessionDir = await mkdtemp(`${tmpdir()}/herdr-jobs-extension-`);
  const pi = {
    registerTool(tool: { name: string }) { tools.set(tool.name, tool); },
    on(name: string, handler: unknown) { handlers.set(name, handler); },
    registerMessageRenderer() {},
    sendMessage(message: { customType: string; content: string; details?: unknown }) { messages.push(message); },
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: sessionDir,
    hasUI: false,
    ui: { setWidget() {}, notify() {} },
    sessionManager: {
      getSessionDir: () => sessionDir,
      getSessionId: () => "extension-integration-session",
      getSessionFile: () => undefined,
      getEntries: () => [],
    },
  } as unknown as ExtensionContext;

  herdrJobsExtension(pi);
  await handlers.get("session_start")({ reason: "startup" }, ctx);
  const start = tools.get("herdr_job_start");
  assert.ok(start);
  const startedAt = Date.now();
  const result = await start.execute("call", {
    name: "extension integration",
    command: "printf READY_TOKEN; sleep 1; exit 0",
    kind: "service",
    readyPattern: "READY_TOKEN",
    keepPane: false,
  }, new AbortController().signal, undefined, ctx);
  assert.ok(Date.now() - startedAt < 1_500, "start tool should return after pane launch, not process completion");
  assert.equal(result.details.status, "started");

  const deadline = Date.now() + 8_000;
  while (messages.filter((message) => message.customType === "herdr_job_ready" || message.customType === "herdr_job_result").length < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(messages.filter((message) => message.customType === "herdr_job_ready").length, 1);
  assert.equal(messages.filter((message) => message.customType === "herdr_job_result").length, 1);
  assert.match(messages.find((message) => message.customType === "herdr_job_result")?.content ?? "", /Exit code: 0/);
  await handlers.get("session_shutdown")({ reason: "quit" }, ctx);
});
