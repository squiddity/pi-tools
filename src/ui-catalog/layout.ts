export const CATALOG_WIDTH = 66;
export const CATALOG_BOTTOM_MARGIN = 1;

export type CatalogTapTarget = {
  left: number;
  right: number;
  row: number;
};

/**
 * Return the one-based terminal-cell hit region for the `▶ UI catalog` label.
 * The overlay is bottom-centred, and the label is on its first inner row.
 */
export function catalogTapTarget(columns: number, rows: number, expanded: boolean): CatalogTapTarget {
  const width = Math.min(CATALOG_WIDTH, columns);
  const height = expanded ? 10 : 6;
  const left = Math.floor((columns - width) / 2);
  const top = rows - CATALOG_BOTTOM_MARGIN - height;

  // The first inner cell is a space, then `▶ UI catalog` occupies 12 cells.
  return { left: left + 3, right: left + 14, row: top + 2 };
}

export function isCatalogTapTarget(column: number, row: number, columns: number, rows: number, expanded: boolean): boolean {
  const target = catalogTapTarget(columns, rows, expanded);
  return row === target.row && column >= target.left && column <= target.right;
}
