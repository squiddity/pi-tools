import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { writeAtomicJson } from "../../src/herdr-jobs/artifacts.ts";
import type { ManagedAgentCompletion } from "../../src/herdr-jobs/types.ts";

/**
 * Loaded only in a child launched by herdr_agent_start. It supplies an explicit
 * completion boundary because an idle Pi turn is not evidence that descendants
 * launched by the agent have completed.
 */
export default function managedAgentChildExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "herdr_agent_done",
    label: "Herdr Agent Done",
    description: "Finish this managed Herdr agent after all required work and descendant-agent results have been processed. This reports completion to the caller and gracefully exits this Pi session.",
    parameters: Type.Object({
      summary: Type.Optional(Type.String({ description: "Optional concise completion summary for the caller." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const file = process.env.PI_HERDR_MANAGED_AGENT_COMPLETION_FILE;
      const id = process.env.PI_HERDR_MANAGED_AGENT_ID;
      if (!file || !id) throw new Error("herdr_agent_done is only available in a herdr managed agent.");
      const completion: ManagedAgentCompletion = {
        version: 1,
        id,
        completedAt: Date.now(),
        ...(params.summary?.trim() ? { summary: params.summary.trim() } : {}),
      };
      await writeAtomicJson(file, completion);
      ctx.shutdown();
      return {
        content: [{ type: "text", text: "Managed agent completion recorded; shutting down." }],
        details: { id, completionFile: file },
      };
    },
  });
}
