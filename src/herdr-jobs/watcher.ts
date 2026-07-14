import { StringDecoder } from "node:string_decoder";
import { readLogChunk, readResult } from "./artifacts.ts";
import { markFailure, markPaneMissing, markPanePresent, markPaneUnavailable, markReady, markReadyTimeout, markResult, readinessWaiting } from "./lifecycle.ts";
import type { HerdrOperations, RunningJob, WatchEvent } from "./types.ts";

const POLL_MS = 750;
const PANE_POLL_MS = 2_500;
const PANE_MISSING_GRACE_MS = 500;
const REGEX_WINDOW_BYTES = 64 * 1024;

export function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("Herdr job watcher aborted."));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Herdr job watcher aborted."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function createRunningLogState(): Pick<RunningJob, "logOffset" | "logDecoder" | "logRemainder" | "regexWindow"> {
  return { logOffset: 0, logDecoder: new StringDecoder("utf8"), logRemainder: "", regexWindow: "" };
}

export function scanReadiness(job: RunningJob, text: string): string | undefined {
  const pattern = job.metadata.readyPattern;
  if (!pattern || !readinessWaiting(job.lifecycle.readiness)) return undefined;
  if (job.metadata.readyRegex) {
    const window = `${job.regexWindow}${text}`.slice(-REGEX_WINDOW_BYTES);
    job.regexWindow = window;
    const expression = new RegExp(pattern);
    const match = expression.exec(window);
    return match?.[0];
  }
  const combined = `${job.logRemainder}${text}`;
  const index = combined.indexOf(pattern);
  job.logRemainder = combined.slice(-Math.max(0, pattern.length - 1));
  return index >= 0 ? pattern : undefined;
}

async function consumeReadiness(job: RunningJob, onEvent: (event: WatchEvent) => Promise<void> | void): Promise<void> {
  const chunk = await readLogChunk(job.paths.logFile, job.logOffset);
  job.logOffset = chunk.nextOffset;
  if (chunk.bytes.length === 0) return;
  const matched = scanReadiness(job, job.logDecoder.write(chunk.bytes));
  if (matched !== undefined) {
    job.lifecycle = markReady(job.lifecycle, Date.now(), matched);
    await onEvent({ kind: "ready", matchedText: matched });
  }
}

function terminalMarker(job: RunningJob, screen: string): number | null {
  const expression = new RegExp(`__PI_HERDR_JOB_${job.metadata.id}_DONE_(-?\\d+)__`);
  const match = expression.exec(screen);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

export async function watchJob(
  job: RunningJob,
  signal: AbortSignal,
  operations: HerdrOperations,
  onEvent: (event: WatchEvent) => Promise<void> | void,
): Promise<void> {
  for (;;) {
    if (signal.aborted) return;
    const result = await readResult(job.paths, job.metadata.id);
    if (result) {
      // A readiness line and completion sidecar may appear in the same polling
      // interval. Consume the final log bytes first so each event can still be
      // delivered once before the terminal result.
      try { await consumeReadiness(job, onEvent); } catch { /* result remains authoritative */ }
      job.lifecycle = markResult(job.lifecycle, result);
      await onEvent({ kind: "result", result });
      return;
    }

    try {
      await consumeReadiness(job, onEvent);
    } catch (error) {
      // A transient log error should not discard an otherwise healthy job.
      job.lifecycle = markPaneUnavailable(job.lifecycle, Date.now());
    }

    const now = Date.now();
    if (readinessWaiting(job.lifecycle.readiness) && job.metadata.readyTimeoutMs !== undefined && now - job.metadata.startedAt >= job.metadata.readyTimeoutMs) {
      job.lifecycle = markReadyTimeout(job.lifecycle, now);
      await onEvent({ kind: "ready_timeout" });
    }

    if (now - job.lastPaneCheckAt >= PANE_POLL_MS) {
      job.lastPaneCheckAt = now;
      const inspection = await operations.inspectPane(job.metadata.paneId);
      if (inspection.kind === "present") {
        job.lifecycle = markPanePresent(job.lifecycle);
      } else if (inspection.kind === "unavailable") {
        job.lifecycle = markPaneUnavailable(job.lifecycle, now);
      } else {
        job.lifecycle = markPaneMissing(job.lifecycle, now);
        await abortableDelay(PANE_MISSING_GRACE_MS, signal);
        const racedResult = await readResult(job.paths, job.metadata.id);
        if (racedResult) {
          job.lifecycle = markResult(job.lifecycle, racedResult);
          await onEvent({ kind: "result", result: racedResult });
          return;
        }
        if (job.lifecycle.delivery !== "suppressed") {
          const error = `Herdr pane ${job.metadata.paneId} disappeared before completion evidence was recorded.`;
          job.lifecycle = markFailure(job.lifecycle, error, Date.now());
          await onEvent({ kind: "failure", error });
        }
        return;
      }
    }

    // Scrollback is only a fallback for a failed sidecar publication.
    try {
      const fallback = terminalMarker(job, await operations.readPane(job.metadata.paneId, 8));
      if (fallback !== null) {
        const result = { version: 1 as const, id: job.metadata.id, exitCode: fallback, startedAt: job.metadata.startedAt, completedAt: Date.now() };
        job.lifecycle = markResult(job.lifecycle, result);
        await onEvent({ kind: "result", result });
        return;
      }
    } catch {
      // Pane health is evaluated separately above.
    }

    await abortableDelay(POLL_MS, signal);
  }
}
