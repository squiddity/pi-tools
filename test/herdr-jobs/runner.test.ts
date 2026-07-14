import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { getJobPaths, ensureJobDirectory, readResult } from "../../src/herdr-jobs/artifacts.ts";
import { paneRunCommand, shellQuote, writeRunnerFiles } from "../../src/herdr-jobs/runner.ts";

const execFileAsync = promisify(execFile);

test("shellQuote handles spaces and single quotes", async () => {
  const quoted = shellQuote("a path/it's safe");
  const { stdout } = await execFileAsync("bash", ["-c", `printf %s ${quoted}`]);
  assert.equal(stdout, "a path/it's safe");
});

test("wrapper preserves command exit code and atomically publishes result", async () => {
  const root = await mkdtemp(join(tmpdir(), "herdr-jobs-runner-"));
  const paths = getJobPaths(root, "abcdefgh");
  await ensureJobDirectory(paths);
  await writeRunnerFiles({ id: "abcdefgh", command: "echo output; exit 7", cwd: root, paths, startedAt: 123 });
  await assert.rejects(execFileAsync("bash", [paths.runnerFile]));
  const result = await readResult(paths, "abcdefgh");
  assert.deepEqual(result, { version: 1, id: "abcdefgh", exitCode: 7, startedAt: 123, completedAt: result?.completedAt });
  assert.ok((result?.completedAt ?? 0) >= 123);
  assert.match(await readFile(paths.logFile, "utf8"), /output/);
  assert.equal(paneRunCommand(paths.runnerFile).includes("echo output"), false);
});
