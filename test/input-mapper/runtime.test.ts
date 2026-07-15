import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { InputMapperRuntime } from "../../src/input-mapper/runtime.ts";

async function context(): Promise<ExtensionContext> {
  const cwd = await mkdtemp(join(tmpdir(), "input-mapper-"));
  await mkdir(join(cwd, ".pi"));
  await writeFile(join(cwd, ".pi", "input-mapper.json"), JSON.stringify({
    version: 1,
    profiles: {
      test: {
        activate: { tool: "test_input_mapper" },
        mouse: { protocol: "sgr", tracking: "buttons" },
        mappings: [
          { report: "wheel-up", send: "up" },
          { report: "wheel-down", send: "down" },
          { report: "left-release", send: "enter" },
        ],
      },
    },
  }));
  return {
    mode: "tui",
    cwd,
    hasUI: true,
    isProjectTrusted: () => true,
    ui: { onTerminalInput: () => () => {}, setWidget() {} },
  } as unknown as ExtensionContext;
}

test("active configured profile maps wheel input and requires a matching press/release tap", async () => {
  const runtime = new InputMapperRuntime();
  const ctx = await context();
  await runtime.start(ctx);
  runtime.activateTool("test-call", "test_input_mapper");

  assert.deepEqual(runtime.transform("\x1b[<65;1;1M"), { data: "\x1b[B" });
  assert.deepEqual(runtime.transform("\x1b[<0;4;2m"), { consume: true }, "release without press cannot activate");
  assert.deepEqual(runtime.transform("\x1b[<0;4;2M"), { consume: true });
  assert.deepEqual(runtime.transform("\x1b[<0;4;2m"), { data: "\r" });
  assert.deepEqual(runtime.transform("\x1b[<2;4;2M"), { consume: true }, "recognized but unmapped reports do not leak");
  runtime.deactivateTool("test-call");
  assert.equal(runtime.transform("\x1b[<65;1;1M"), undefined);
  runtime.stop(ctx);
});

test("off is an immediate kill switch", async () => {
  const runtime = new InputMapperRuntime();
  const ctx = await context();
  await runtime.start(ctx);
  runtime.activateTool("test-call", "test_input_mapper");
  runtime.turnOff();
  assert.equal(runtime.transform("\x1b[<65;1;1M"), undefined);
  runtime.stop(ctx);
});
