import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import herdrJobsExtension from "../../extensions/herdr-jobs/index.ts";

test("result messages use a coloured box and hide log output until expanded", async () => {
  const renderers = new Map<string, any>();
  const tools = new Map<string, any>();
  const pi = {
    on() {},
    registerTool(tool: { name: string }) { tools.set(tool.name, tool); },
    registerMessageRenderer(type: string, renderer: unknown) { renderers.set(type, renderer); },
  } as unknown as ExtensionAPI;
  herdrJobsExtension(pi);

  const renderer = renderers.get("herdr_job_result");
  assert.ok(renderer);
  const theme = {
    fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    bg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    bold: (text: string) => `**${text}**`,
  };
  const message = {
    content: "herdr job \"tests\" completed successfully.\nExit code: 0\n\nLast output:\nvery noisy log line",
    details: { exitCode: 0 },
  };

  const collapsed = renderer(message, { expanded: false }, theme).render(160).join("\n");
  assert.match(collapsed, /toolSuccessBg/);
  assert.match(collapsed, /\[herdr job complete\]/);
  assert.match(collapsed, /to show last output/);
  assert.doesNotMatch(collapsed, /very noisy log line/);

  const expanded = renderer(message, { expanded: true }, theme).render(160).join("\n");
  assert.match(expanded, /very noisy log line/);

  const startCall = tools.get("herdr_job_start").renderCall({}, theme).render(160).join("\n");
  assert.match(startCall, /herdr job start/);
  assert.doesNotMatch(startCall, /herdr_job_start/);

  await assert.rejects(
    tools.get("herdr_job_start").execute("call", { name: "tests", command: "echo test", cleanup: "always", keepPane: false }),
    /cleanup or keepPane/,
  );
});
