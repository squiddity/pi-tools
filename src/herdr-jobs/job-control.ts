import { markClosed } from "./lifecycle.ts";
import { persistJob } from "./runtime.ts";
import type { HerdrOperations, RunningJob } from "./types.ts";

/** Close a tracked pane, treating an externally removed pane as already closed. */
export async function closeTrackedJob(job: RunningJob, operations: HerdrOperations): Promise<{ paneAlreadyMissing: boolean }> {
  job.lifecycle = markClosed(job.lifecycle, Date.now());
  await persistJob(job);
  job.abortController?.abort();
  try {
    await operations.closePane(job.metadata.paneId);
    return { paneAlreadyMissing: false };
  } catch (error) {
    const inspection = await operations.inspectPane(job.metadata.paneId);
    if (inspection.kind !== "missing") throw error;
    return { paneAlreadyMissing: true };
  }
}
