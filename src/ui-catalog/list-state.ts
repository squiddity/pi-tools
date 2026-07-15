/** Clamp a keyboard-style list selection after a wheel or arrow movement. */
export function moveListSelection(selected: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, selected + delta));
}
