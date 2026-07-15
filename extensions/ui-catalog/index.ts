import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CatalogPanel } from "../../src/ui-catalog/panel.ts";

/** Experimental terminal-mouse catalog. Intended for a disposable Pi session. */
export default function uiCatalogExtension(pi: ExtensionAPI) {
  pi.registerCommand("ui-catalog", {
    description: "Open experimental tappable Pi TUI catalog",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("ui-catalog requires Pi interactive TUI mode.", "warning");
        return;
      }

      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) => new CatalogPanel(tui, theme, done),
        {
          overlay: true,
          overlayOptions: {
            anchor: "bottom-center",
            width: 66,
            maxHeight: 12,
            margin: { bottom: 1 },
          },
        },
      );
    },
  });
}
