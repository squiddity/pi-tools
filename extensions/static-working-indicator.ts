/**
 * Keeps Pi's built-in working state visible without continuously animating it.
 *
 * The single frame prevents the working loader from scheduling refreshes while
 * preserving an unambiguous "Pi is busy" marker.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATIC_WORKING_INDICATOR = { frames: ["●"] };

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setWorkingIndicator(STATIC_WORKING_INDICATOR);
  });
}
