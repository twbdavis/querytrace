export interface LayoutTable {
  id: string;
  width: number;
  height: number;
  position: { x: number; y: number };
}

// Leave space for distinct orthogonal relationship lanes between the cards.
export const TABLE_GAP = { x: 160, y: 140 };

function collides(a: LayoutTable, b: LayoutTable): boolean {
  return a.position.x < b.position.x + b.width + TABLE_GAP.x &&
    a.position.x + a.width + TABLE_GAP.x > b.position.x &&
    a.position.y < b.position.y + b.height + TABLE_GAP.y &&
    a.position.y + a.height + TABLE_GAP.y > b.position.y;
}

/** Pack measured cards into shelves, allowing wide cards to own a whole row. */
export function packSchemaTables(tables: LayoutTable[]): LayoutTable[] {
  const area = tables.reduce((sum, table) => sum +
    (table.width + TABLE_GAP.x) * (table.height + TABLE_GAP.y), 0);
  const rowWidth = Math.max(...tables.map((table) => table.width), Math.sqrt(area * 1.8), 1);
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  return tables.map((table) => {
    if (x > 0 && x + table.width > rowWidth) {
      x = 0;
      y += rowHeight + TABLE_GAP.y;
      rowHeight = 0;
    }
    const placed = { ...table, position: { x, y } };
    x += table.width + TABLE_GAP.x;
    rowHeight = Math.max(rowHeight, table.height);
    return placed;
  });
}

/**
 * Keep existing/hand-placed positions wherever possible. A growing or newly
 * created card only moves cards that no longer fit, to the nearest free gap.
 * Candidate edges come from already placed rectangles, so this also handles
 * very wide values and tall tables without a fixed grid or retry limit.
 */
export function separateSchemaTables(tables: LayoutTable[]): LayoutTable[] {
  const placed: LayoutTable[] = [];
  for (const table of tables) {
    if (!placed.some((other) => collides(table, other))) {
      placed.push(table);
      continue;
    }
    const xs = [table.position.x, ...placed.map((other) => other.position.x + other.width + TABLE_GAP.x)];
    const ys = [table.position.y, ...placed.map((other) => other.position.y + other.height + TABLE_GAP.y)];
    let best: LayoutTable | undefined;
    let bestDistance = Infinity;
    for (const y of ys) {
      for (const x of xs) {
        const distance = (x - table.position.x) ** 2 + (y - table.position.y) ** 2;
        if (distance >= bestDistance) continue;
        const candidate = { ...table, position: { x, y } };
        if (!placed.some((other) => collides(candidate, other))) {
          best = candidate;
          bestDistance = distance;
        }
      }
    }
    // The rightmost/bottommost candidate is always outside every placed card.
    placed.push(best!);
  }
  return placed;
}
