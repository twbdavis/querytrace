export const TABLE_ROW_HEIGHT = 18;
export const TABLE_ROW_LIMIT = 80;
export const TABLE_FULL_ROWS = 60;
export const TABLE_SCENE_CELLS = 8_000;

export function tableSceneRowLimit(tables: Array<{ rows: number; columns: number }>): { limit: number; windowed: boolean } {
  const demand = tables.reduce((sum, table) => sum + table.rows * table.columns, 0);
  if (demand <= TABLE_SCENE_CELLS) return { limit: TABLE_ROW_LIMIT, windowed: false };
  let low = 1;
  let high = TABLE_ROW_LIMIT;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const cells = tables.reduce((sum, table) => sum + Math.min(table.rows, middle) * table.columns, 0);
    if (cells <= TABLE_SCENE_CELLS) low = middle;
    else high = middle - 1;
  }
  return { limit: low, windowed: true };
}

/** Keep full card geometry while mounting only rows near the visible canvas. */
export function tableRowWindow(input: {
  count: number; nodeX: number; nodeY: number; width: number; bodyOffset: number;
  transform: readonly [number, number, number]; viewportWidth: number; viewportHeight: number;
  pinned?: number;
  rowLimit?: number; windowed?: boolean;
}): number[] {
  if (!input.windowed && input.count <= TABLE_FULL_ROWS) return Array.from({ length: input.count }, (_, i) => i);
  const [tx, ty, zoom] = input.transform;
  const visible = zoom > 0 && input.nodeX * zoom + tx < input.viewportWidth && (input.nodeX + input.width) * zoom + tx > 0;
  const first = Math.floor((-ty / zoom - input.nodeY - input.bodyOffset) / TABLE_ROW_HEIGHT);
  const last = Math.ceil(((input.viewportHeight - ty) / zoom - input.nodeY - input.bodyOffset) / TABLE_ROW_HEIGHT);
  const start = Math.max(0, first - 8);
  const end = visible && last >= 0 ? Math.min(input.count, last + 8, start + (input.rowLimit ?? TABLE_ROW_LIMIT)) : start;
  const indices = Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
  if (input.pinned !== undefined && input.pinned >= 0 && input.pinned < input.count && !indices.includes(input.pinned)) indices.push(input.pinned);
  return indices.sort((a, b) => a - b);
}

/** Intrinsic-width probes include values outside the mounted row window. */
export function widestTableValues(rows: unknown[][], columns: number, format: (value: unknown) => string, measure: (text: string) => number = (text) => text.length): string[] {
  const widest = Array<string>(columns).fill('');
  const widths = Array<number>(columns).fill(0);
  const cache = new Map<string, number>();
  for (const row of rows) row.forEach((value, i) => {
    const text = format(value);
    let width = cache.get(text);
    if (width === undefined) {
      width = measure(text);
      // Repeated numeric/data values should cost one font measurement, while
      // a long stream of unique values cannot grow a permanent text cache.
      if (cache.size < 4_096) cache.set(text, width);
    }
    if (width > widths[i]) { widest[i] = text; widths[i] = width; }
  });
  return widest;
}
