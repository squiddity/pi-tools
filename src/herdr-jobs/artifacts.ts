import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateTail } from "@earendil-works/pi-coding-agent";
import { JOB_METADATA_VERSION, JOB_RESULT_VERSION, type JobPaths, type JobResultArtifact, type ManagedAgentCompletion, type ManagedAgentMetadata, type ManagedAgentPaths, type PersistedJobMetadata } from "./types.ts";

const JOB_ID = /^[a-zA-Z0-9_-]{8,128}$/;

export function createJobId(): string {
  return randomUUID().replaceAll("-", "");
}

export function isJobId(value: string): boolean {
  return JOB_ID.test(value);
}

export function getArtifactRoot(sessionDir: string | undefined, sessionId: string | undefined): string {
  if (sessionDir && sessionId) return join(sessionDir, "artifacts", sessionId, "herdr-jobs");
  return join(tmpdir(), "pi-herdr-jobs", String(process.pid));
}

export function getManagedAgentPaths(root: string, id: string): ManagedAgentPaths {
  if (!isJobId(id)) throw new Error("Invalid managed agent id.");
  const agentRoot = join(root, "managed-agents", id);
  return {
    root: agentRoot,
    metadataFile: join(agentRoot, "metadata.json"),
    completionFile: join(agentRoot, "completion.json"),
    sessionFile: join(agentRoot, "session.jsonl"),
  };
}

export function parseManagedAgentCompletion(value: unknown, expectedId: string): ManagedAgentCompletion | null {
  const item = value as Partial<ManagedAgentCompletion> | null;
  if (!item || item.version !== 1 || item.id !== expectedId || typeof item.completedAt !== "number") return null;
  if (item.summary !== undefined && typeof item.summary !== "string") return null;
  return item as ManagedAgentCompletion;
}

export function parseManagedAgentMetadata(value: unknown): ManagedAgentMetadata | null {
  const item = value as Partial<ManagedAgentMetadata> | null;
  if (!item || item.version !== 1 || typeof item.id !== "string" || !isJobId(item.id)) return null;
  if (typeof item.name !== "string" || typeof item.task !== "string" || typeof item.cwd !== "string") return null;
  if (typeof item.paneId !== "string" || typeof item.terminalId !== "string" || typeof item.sessionFile !== "string") return null;
  if (item.extensionMode !== "normal" && item.extensionMode !== "explicit") return null;
  if (!Array.isArray(item.extensions) || !item.extensions.every((value) => typeof value === "string")) return null;
  if (item.tools !== undefined && (!Array.isArray(item.tools) || !item.tools.every((value) => typeof value === "string"))) return null;
  if (typeof item.startedAt !== "number") return null;
  return item as ManagedAgentMetadata;
}

export function getJobPaths(root: string, id: string): JobPaths {
  if (!isJobId(id)) throw new Error("Invalid herdr job id.");
  const jobRoot = join(root, id);
  return {
    root: jobRoot,
    commandFile: join(jobRoot, "command.sh"),
    runnerFile: join(jobRoot, "run.sh"),
    logFile: join(jobRoot, "output.log"),
    metadataFile: join(jobRoot, "metadata.json"),
    resultFile: join(jobRoot, "result.json"),
  };
}

export async function ensureJobDirectory(paths: Pick<JobPaths, "root">): Promise<void> {
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
}

export async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

export async function readJsonIfPresent(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

export function parseMetadata(value: unknown): PersistedJobMetadata | null {
  const item = value as Partial<PersistedJobMetadata> | null;
  if (!item || item.version !== JOB_METADATA_VERSION || typeof item.id !== "string" || !isJobId(item.id)) return null;
  if (typeof item.name !== "string" || typeof item.command !== "string" || typeof item.cwd !== "string") return null;
  if (item.kind !== "finite" && item.kind !== "service") return null;
  if (item.placement !== "down" && item.placement !== "right" && item.placement !== "tab") return null;
  if (typeof item.paneId !== "string" || !item.paneId || typeof item.startedAt !== "number") return null;
  if (item.delivery !== "pending" && item.delivery !== "delivered" && item.delivery !== "suppressed") return null;
  if (typeof item.readyRegex !== "boolean" || typeof item.state !== "string") return null;

  // v1 initially persisted keepPane. Keep those durable artifacts readable while
  // writing the explicit cleanup policy for all new jobs.
  const legacy = item as Partial<PersistedJobMetadata> & { keepPane?: unknown };
  const cleanup = item.cleanup === "on_success" || item.cleanup === "always" || item.cleanup === "never"
    ? item.cleanup
    : legacy.keepPane === true ? "never" : legacy.keepPane === false ? "always" : null;
  if (!cleanup) return null;
  return { ...item, cleanup } as PersistedJobMetadata;
}

export function parseResult(value: unknown, expectedId: string): JobResultArtifact | null {
  const item = value as Partial<JobResultArtifact> | null;
  if (!item || item.version !== JOB_RESULT_VERSION || item.id !== expectedId) return null;
  if (!Number.isInteger(item.exitCode) || typeof item.startedAt !== "number" || typeof item.completedAt !== "number") return null;
  if (item.signal !== undefined && typeof item.signal !== "string") return null;
  return item as JobResultArtifact;
}

export async function readResult(paths: JobPaths, id: string): Promise<JobResultArtifact | null> {
  return parseResult(await readJsonIfPresent(paths.resultFile), id);
}

export async function readLogChunk(path: string, offset: number, maximumBytes = 64 * 1024): Promise<{ bytes: Buffer; nextOffset: number }> {
  try {
    const info = await stat(path);
    if (info.size <= offset) return { bytes: Buffer.alloc(0), nextOffset: Math.max(0, info.size) };
    const handle = await open(path, "r");
    try {
      // A single noisy polling interval must not allocate an unbounded buffer.
      // Returning a partial chunk lets the next poll continue at the byte offset.
      const size = Math.min(info.size - offset, Math.max(1, Math.floor(maximumBytes)));
      const bytes = Buffer.alloc(size);
      const { bytesRead } = await handle.read(bytes, 0, size, offset);
      return { bytes: bytes.subarray(0, bytesRead), nextOffset: offset + bytesRead };
    } finally {
      await handle.close();
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { bytes: Buffer.alloc(0), nextOffset: offset };
    throw error;
  }
}

export async function readLogTail(path: string, lines = 80): Promise<{ content: string; truncated: boolean; notice?: string }> {
  const boundedLines = Math.max(1, Math.min(500, Math.floor(lines)));
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { content: "(No log output yet.)", truncated: false };
    throw error;
  }
  const result = truncateTail(text, { maxLines: Math.min(boundedLines, DEFAULT_MAX_LINES), maxBytes: DEFAULT_MAX_BYTES });
  const notice = result.truncated
    ? `[Output truncated: ${result.outputLines} of ${result.totalLines} lines (${formatSize(result.outputBytes)} of ${formatSize(result.totalBytes)}). Full log: ${path}]`
    : undefined;
  return { content: result.content, truncated: result.truncated, ...(notice ? { notice } : {}) };
}

export async function listMetadata(root: string): Promise<Array<{ metadata: PersistedJobMetadata; paths: JobPaths }>> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const result: Array<{ metadata: PersistedJobMetadata; paths: JobPaths }> = [];
  for (const name of names) {
    if (!isJobId(name)) continue;
    const paths = getJobPaths(root, name);
    const metadata = parseMetadata(await readJsonIfPresent(paths.metadataFile));
    if (metadata && metadata.id === name) result.push({ metadata, paths });
  }
  return result;
}

export async function assertInsideArtifactRoot(root: string, candidate: string): Promise<void> {
  const normalizedRoot = resolve(root) + sep;
  const normalizedCandidate = resolve(candidate);
  if (!normalizedCandidate.startsWith(normalizedRoot)) throw new Error("Artifact path escapes the expected herdr jobs root.");
}

export function artifactDisplayName(paths: JobPaths): string {
  return basename(paths.root);
}

export async function writePrivateFile(path: string, content: string, mode = 0o700): Promise<void> {
  await writeFile(path, content, { encoding: "utf8", mode });
}
