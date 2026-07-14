import { readLogTail } from "./artifacts.ts";
import { projectLifecycle } from "./lifecycle.ts";
import type { RunningJob } from "./types.ts";

export function formatElapsed(startedAt: number, endedAt = Date.now()): string {
  const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function jobSummary(job: RunningJob, now = Date.now()): string {
  const projection = projectLifecycle(job.lifecycle, now);
  const endedAt = job.lifecycle.process.kind === "completed" || job.lifecycle.process.kind === "failed"
    ? job.lifecycle.process.completedAt
    : job.lifecycle.process.kind === "closed"
      ? job.lifecycle.process.closedAt
      : now;
  return `${formatElapsed(job.metadata.startedAt, endedAt)}  ${job.metadata.name} — ${projection} · ${job.metadata.paneId}`;
}

export async function formatResultMessage(job: RunningJob, exitCode: number): Promise<string> {
  const elapsed = formatElapsed(job.metadata.startedAt, Date.now());
  const succeeded = exitCode === 0;
  const tail = await readLogTail(job.paths.logFile, 80);
  const heading = succeeded
    ? `herdr job "${job.metadata.name}" completed successfully in ${elapsed}.`
    : `herdr job "${job.metadata.name}" failed after ${elapsed}.`;
  return `${heading}\nExit code: ${exitCode}\nPane: ${job.metadata.paneId}\nLog: ${job.paths.logFile}\n\nLast output:\n${tail.content}${tail.notice ? `\n\n${tail.notice}` : ""}`;
}

export async function formatFailureMessage(job: RunningJob, error: string): Promise<string> {
  const tail = await readLogTail(job.paths.logFile, 80);
  return `herdr job "${job.metadata.name}" watcher failed after ${formatElapsed(job.metadata.startedAt)}.\nReason: ${error}\nPane: ${job.metadata.paneId}\nLog: ${job.paths.logFile}\n\nLast output:\n${tail.content}${tail.notice ? `\n\n${tail.notice}` : ""}`;
}

export function formatReadyMessage(job: RunningJob, matchedText?: string): string {
  const kind = job.metadata.kind === "service" ? "service" : "job";
  return `herdr ${kind} "${job.metadata.name}" is ready after ${formatElapsed(job.metadata.startedAt)}.\nPane: ${job.metadata.paneId}${matchedText ? `\nMatched: ${matchedText}` : ""}\nLog: ${job.paths.logFile}`;
}

export function formatReadyTimeoutMessage(job: RunningJob): string {
  return `herdr job "${job.metadata.name}" did not report readiness before its timeout. The process is still running.\nPane: ${job.metadata.paneId}\nLog: ${job.paths.logFile}`;
}
