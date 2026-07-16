import { parseManagedAgentCompletion, readJsonIfPresent } from "./artifacts.ts";
import type { ManagedAgentCompletion, HerdrOperations, RunningManagedAgent } from "./types.ts";
import { projectManagedAgentStatus } from "./managed-agent.ts";

const POLL_MS = 1_000;

function delay(signal: AbortSignal, milliseconds = POLL_MS): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("managed agent watcher aborted."));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("managed agent watcher aborted."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function watchManagedAgent(
  agent: RunningManagedAgent,
  signal: AbortSignal,
  operations: HerdrOperations,
  onStatus?: () => void,
): Promise<ManagedAgentCompletion> {
  for (;;) {
    if (signal.aborted) throw new Error("managed agent watcher aborted.");
    const completion = parseManagedAgentCompletion(
      await readJsonIfPresent(agent.paths.completionFile),
      agent.metadata.id,
    );
    if (completion) return completion;

    const inspection = await operations.inspectAgent(agent.metadata.terminalId);
    if (inspection.kind === "present") {
      agent.status = projectManagedAgentStatus(inspection.status);
      onStatus?.();
    } else if (inspection.kind === "missing") {
      throw new Error(`Managed agent pane disappeared before calling herdr_agent_done.${inspection.error ? ` ${inspection.error}` : ""}`);
    } else {
      // A transient Herdr failure must not report an agent failure. Keep its
      // last known status and retry; the explicit sidecar remains authoritative.
      onStatus?.();
    }
    await delay(signal);
  }
}
