import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import herdrJobsExtension from "../../extensions/herdr-jobs/index.ts";
import { createRunningJob, getRuntime } from "../../src/herdr-jobs/runtime.ts";

function fakeJob() {
  return createRunningJob({
    version: 1, id: "abcdefgh", name: "widget job", command: "sleep 1", cwd: "/tmp", kind: "finite", paneId: "pane", placement: "tab", createdAt: 1, startedAt: 1, readyRegex: false, cleanup: "never", delivery: "pending", state: "running",
  }, {
    root: "/tmp", commandFile: "/tmp/command", runnerFile: "/tmp/run", logFile: "/tmp/log", metadataFile: "/tmp/metadata", resultFile: "/tmp/result",
  });
}

test("jobs widget is mounted once instead of being re-registered on refresh", async () => {
  const runtime = getRuntime();
  runtime.jobs.clear();
  runtime.widgetMounted = false;
  runtime.widgetRequestRender = undefined;
  runtime.jobs.set("abcdefgh", fakeJob());

  const handlers = new Map<string, any>();
  let widgetSets = 0;
  const tools = new Map<string, any>();
  const pi = {
    on(name: string, handler: unknown) { handlers.set(name, handler); },
    registerTool(tool: { name: string }) { tools.set(tool.name, tool); }, registerMessageRenderer() {}, registerShortcut() {},
  } as unknown as ExtensionAPI;
  const ctx = {
    hasUI: true,
    cwd: "/tmp",
    ui: { setWidget() { widgetSets += 1; }, notify() {} },
    sessionManager: { getSessionId: () => "widget-session", getSessionFile: () => undefined, getSessionDir: () => "/tmp", getEntries: () => [] },
  } as unknown as ExtensionContext;

  herdrJobsExtension(pi);
  await handlers.get("session_start")({ reason: "startup" }, ctx);
  await handlers.get("session_start")({ reason: "startup" }, ctx);
  assert.equal(widgetSets, 1);
  const listed = await tools.get("herdr_jobs_list").execute();
  assert.match(listed.content[0].text, /^job abcdefgh/m);

  await handlers.get("session_shutdown")({ reason: "quit" }, ctx);
  assert.equal(runtime.widgetMounted, false);
});
