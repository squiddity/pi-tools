import type { JobLifecycle, JobResultArtifact, ProcessState, ReadinessState } from "./types.ts";

export type JobProjection =
  | "launching"
  | "running"
  | "waiting for ready"
  | "ready"
  | "interrupt requested"
  | "stalled"
  | "completed"
  | "failed"
  | "closed";

export function createLifecycle(startedAt: number, readyPattern?: string): JobLifecycle {
  return {
    process: { kind: "launching", startedAt },
    readiness: readyPattern ? { kind: "waiting", since: startedAt } : { kind: "not_configured" },
    delivery: "pending",
    readyDelivered: false,
    timeoutDelivered: false,
  };
}

function startedAt(process: ProcessState): number {
  return process.startedAt;
}

function terminal(process: ProcessState): boolean {
  return process.kind === "completed" || process.kind === "failed" || process.kind === "closed";
}

export function markRunning(lifecycle: JobLifecycle, now: number): JobLifecycle {
  if (lifecycle.process.kind !== "launching") return lifecycle;
  return { ...lifecycle, process: { kind: "running", startedAt: lifecycle.process.startedAt, confirmedAt: now } };
}

export function markInterruptRequested(lifecycle: JobLifecycle, now: number): JobLifecycle {
  if (terminal(lifecycle.process)) return lifecycle;
  return { ...lifecycle, process: { kind: "interrupt_requested", startedAt: startedAt(lifecycle.process), requestedAt: now } };
}

export function markResult(lifecycle: JobLifecycle, result: JobResultArtifact): JobLifecycle {
  if (terminal(lifecycle.process)) return lifecycle;
  const process = result.exitCode === 0
    ? { kind: "completed" as const, startedAt: startedAt(lifecycle.process), completedAt: result.completedAt, exitCode: result.exitCode }
    : { kind: "failed" as const, startedAt: startedAt(lifecycle.process), completedAt: result.completedAt, exitCode: result.exitCode, error: `Command exited with code ${result.exitCode}.` };
  return { ...lifecycle, process };
}

export function markFailure(lifecycle: JobLifecycle, error: string, now: number): JobLifecycle {
  if (terminal(lifecycle.process)) return lifecycle;
  return { ...lifecycle, process: { kind: "failed", startedAt: startedAt(lifecycle.process), completedAt: now, error } };
}

export function markClosed(lifecycle: JobLifecycle, now: number): JobLifecycle {
  if (lifecycle.process.kind === "closed") return lifecycle;
  return { ...lifecycle, delivery: "suppressed", process: { kind: "closed", startedAt: startedAt(lifecycle.process), closedAt: now } };
}

export function markReady(lifecycle: JobLifecycle, now: number, matchedText?: string): JobLifecycle {
  if (lifecycle.readiness.kind !== "waiting") return lifecycle;
  return { ...lifecycle, readiness: { kind: "ready", detectedAt: now, ...(matchedText ? { matchedText } : {}) } };
}

export function markReadyTimeout(lifecycle: JobLifecycle, now: number): JobLifecycle {
  if (lifecycle.readiness.kind !== "waiting") return lifecycle;
  return { ...lifecycle, readiness: { kind: "timed_out", timedOutAt: now } };
}

export function markPaneUnavailable(lifecycle: JobLifecycle, now: number): JobLifecycle {
  return { ...lifecycle, paneFailureSince: lifecycle.paneFailureSince ?? now };
}

export function markPanePresent(lifecycle: JobLifecycle): JobLifecycle {
  if (!lifecycle.paneFailureSince && !lifecycle.paneMissingAt) return lifecycle;
  const { paneFailureSince: _failure, paneMissingAt: _missing, ...rest } = lifecycle;
  return rest;
}

export function markPaneMissing(lifecycle: JobLifecycle, now: number): JobLifecycle {
  return { ...lifecycle, paneMissingAt: lifecycle.paneMissingAt ?? now };
}

export function markDelivery(lifecycle: JobLifecycle, delivery: JobLifecycle["delivery"]): JobLifecycle {
  if (lifecycle.delivery !== "pending") return lifecycle;
  return { ...lifecycle, delivery };
}

export function projectLifecycle(lifecycle: JobLifecycle, now: number): JobProjection {
  if (lifecycle.process.kind === "completed") return "completed";
  if (lifecycle.process.kind === "failed") return "failed";
  if (lifecycle.process.kind === "closed") return "closed";
  if (lifecycle.paneFailureSince && now - lifecycle.paneFailureSince >= 60_000) return "stalled";
  if (lifecycle.process.kind === "interrupt_requested") return "interrupt requested";
  if (lifecycle.readiness.kind === "ready") return "ready";
  if (lifecycle.readiness.kind === "waiting") return "waiting for ready";
  return lifecycle.process.kind === "launching" ? "launching" : "running";
}

export function isActive(lifecycle: JobLifecycle): boolean {
  return !terminal(lifecycle.process);
}

export function readinessWaiting(readiness: ReadinessState): boolean {
  return readiness.kind === "waiting";
}
