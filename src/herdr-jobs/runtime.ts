import { StringDecoder } from "node:string_decoder";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { writeAtomicJson } from "./artifacts.ts";
import { createLifecycle, markRunning } from "./lifecycle.ts";
import type { JobPaths, PersistedJobMetadata, RunningJob } from "./types.ts";

export interface HerdrJobsRuntime {
  jobs: Map<string, RunningJob>;
  pi?: ExtensionAPI;
  latestCtx?: ExtensionContext;
  widgetInterval?: ReturnType<typeof setInterval>;
}

const RUNTIME_KEY = Symbol.for("pi-tools/herdr-jobs/runtime");

export function getRuntime(): HerdrJobsRuntime {
  const holder = globalThis as typeof globalThis & { [RUNTIME_KEY]?: HerdrJobsRuntime };
  if (!holder[RUNTIME_KEY]) holder[RUNTIME_KEY] = { jobs: new Map() };
  return holder[RUNTIME_KEY];
}

export function createRunningJob(metadata: PersistedJobMetadata, paths: JobPaths): RunningJob {
  let lifecycle = createLifecycle(metadata.startedAt, metadata.readyPattern);
  lifecycle = markRunning(lifecycle, metadata.startedAt);
  lifecycle = { ...lifecycle, delivery: metadata.delivery };
  return {
    metadata,
    paths,
    lifecycle,
    logOffset: 0,
    logDecoder: new StringDecoder("utf8"),
    logRemainder: "",
    regexWindow: "",
    lastPaneCheckAt: 0,
  };
}

export async function persistJob(job: RunningJob): Promise<void> {
  const state = job.lifecycle.process.kind;
  job.metadata = { ...job.metadata, delivery: job.lifecycle.delivery, state };
  await writeAtomicJson(job.paths.metadataFile, job.metadata);
}

export function hasSessionDelivery(ctx: ExtensionContext, jobId: string, event: "ready" | "result" | "status"): boolean {
  return ctx.sessionManager.getEntries().some((entry) => {
    const item = entry as unknown as { type?: string; customType?: string; details?: { jobId?: unknown; event?: unknown } };
    return item.type === "custom_message" && item.details?.jobId === jobId && item.details?.event === event;
  });
}

export function clearWidgetTimer(runtime: HerdrJobsRuntime): void {
  if (runtime.widgetInterval) clearInterval(runtime.widgetInterval);
  runtime.widgetInterval = undefined;
}
