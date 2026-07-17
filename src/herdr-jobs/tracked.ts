import type { RunningJob, RunningManagedAgent } from "./types.ts";

export type TrackedPanelEntry =
  | { type: "job"; job: RunningJob }
  | { type: "managed_agent"; agent: RunningManagedAgent };

export function isVisibleManagedAgent(agent: RunningManagedAgent): boolean {
  return agent.status !== "completed" && agent.status !== "failed" && agent.status !== "closed";
}

/** The single source of truth for entries presented in the widget and list tool. */
export function getTrackedPanelEntries(
  jobs: Iterable<RunningJob>,
  agents: Iterable<RunningManagedAgent>,
): TrackedPanelEntry[] {
  return [
    ...[...jobs].map((job) => ({ type: "job" as const, job })),
    ...[...agents].filter(isVisibleManagedAgent).map((agent) => ({ type: "managed_agent" as const, agent })),
  ];
}
