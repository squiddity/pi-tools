import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { InputMapperRuntime } from "../../src/input-mapper/runtime.ts";

/**
 * Experimental, extension-only terminal input mapper.
 * It maps SGR reports to one ordinary key before Pi dispatches focused input.
 */
export default function inputMapperExtension(pi: ExtensionAPI) {
  const runtime = new InputMapperRuntime();

  pi.on("session_start", async (_event, ctx) => {
    await runtime.start(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    runtime.stop(ctx);
  });
  pi.on("tool_execution_start", (event) => {
    runtime.activateTool(event.toolCallId, event.toolName);
  });
  pi.on("tool_execution_end", (event) => {
    runtime.deactivateTool(event.toolCallId);
  });

  pi.registerCommand("input-map", {
    description: "Control experimental terminal pointer-to-key mappings",
    handler: async (args, ctx) => {
      const [command = "status", value] = args.trim().split(/\s+/, 2);
      if (ctx.mode !== "tui") {
        ctx.ui.notify("input-map requires Pi interactive TUI mode.", "warning");
        return;
      }
      switch (command) {
        case "on": {
          const error = runtime.turnOn(value);
          ctx.ui.notify(error ?? `Input mapper enabled (${value}).`, error ? "warning" : "info");
          return;
        }
        case "off":
          runtime.turnOff();
          ctx.ui.notify("Input mapper disabled; terminal mouse reporting restored.");
          return;
        case "status":
          ctx.ui.notify(runtime.status());
          return;
        case "diagnose":
          if (value === "on" || value === "off") {
            runtime.setDiagnostics(value === "on");
            ctx.ui.notify(`Pointer diagnostics ${value}.`);
          } else {
            ctx.ui.notify(runtime.diagnose());
          }
          return;
        case "test":
          ctx.ui.notify(runtime.test(value ?? ""));
          return;
        default:
          ctx.ui.notify("Usage: /input-map on <profile> | off | status | diagnose [on|off] | test wheel-up|wheel-down|tap", "warning");
      }
    },
  });
}
