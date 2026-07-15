export type SgrMouseEvent = {
  button: "left" | "middle" | "right" | "wheel-up" | "wheel-down" | "other";
  action: "press" | "release" | "move";
  column: number;
  row: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
};

/** Parse exactly one complete SGR mouse report emitted by Pi's input buffer. */
export function parseSgrMouse(data: string): SgrMouseEvent | undefined {
  const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(data);
  if (!match) return undefined;

  const code = Number(match[1]);
  const column = Number(match[2]);
  const row = Number(match[3]);
  if (!Number.isSafeInteger(code) || column < 1 || row < 1) return undefined;

  const baseButton = code & 0b11;
  const wheel = (code & 0b110_0000) === 0b100_0000;
  const motion = (code & 0b10_0000) !== 0;
  return {
    button: wheel
      ? baseButton === 0 ? "wheel-up" : baseButton === 1 ? "wheel-down" : "other"
      : baseButton === 0 ? "left" : baseButton === 1 ? "middle" : baseButton === 2 ? "right" : "other",
    action: motion ? "move" : match[4] === "m" ? "release" : "press",
    column,
    row,
    shift: (code & 0b100) !== 0,
    alt: (code & 0b1000) !== 0,
    ctrl: (code & 0b1_0000) !== 0,
  };
}

export const ENABLE_SGR_MOUSE = "\x1b[?1000h\x1b[?1006h";
export const DISABLE_SGR_MOUSE = "\x1b[?1006l\x1b[?1000l";
