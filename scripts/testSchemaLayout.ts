import assert from 'node:assert/strict';
import { packSchemaTables, separateSchemaTables, TABLE_GAP, type LayoutTable } from '../lib/schemaLayout';

function clear(tables: LayoutTable[]) {
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      const a = tables[i], b = tables[j];
      assert.ok(
        a.position.x + a.width + TABLE_GAP.x <= b.position.x ||
        b.position.x + b.width + TABLE_GAP.x <= a.position.x ||
        a.position.y + a.height + TABLE_GAP.y <= b.position.y ||
        b.position.y + b.height + TABLE_GAP.y <= a.position.y,
        `${a.id} overlaps ${b.id}`,
      );
    }
  }
}

const cards: LayoutTable[] = [
  { id: 'wide', width: 4692, height: 78, position: { x: 0, y: 0 } },
  { id: 'tall', width: 600, height: 9000, position: { x: 640, y: 230 } },
  { id: 'inside-wide', width: 180, height: 60, position: { x: 1280, y: 0 } },
  { id: 'inside-tall', width: 500, height: 400, position: { x: 640, y: 690 } },
];
clear(packSchemaTables(cards));
const separated = separateSchemaTables(cards);
clear(separated);
assert.deepEqual(separated[0], cards[0], 'The first hand position stays in place');
assert.deepEqual(separateSchemaTables(separated), separated, 'Repeated runs keep positions stable');
assert.deepEqual(packSchemaTables([]), []);
assert.deepEqual(separateSchemaTables([]), []);

// Seeded varied imports exercise the 24-table limit, long text, many rows,
// coincident preferred positions and growth after the first measured layout.
let seed = 631;
const random = (max: number) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % max;
};
for (let run = 0; run < 250; run++) {
  const imported = Array.from({ length: 1 + random(24) }, (_, i) => ({
    id: String(i), width: 180 + random(8000), height: 60 + random(9000),
    position: { x: random(4) * 640, y: random(4) * 460 },
  }));
  const packed = packSchemaTables(imported);
  clear(packed);
  assert.deepEqual(packSchemaTables(imported), packed, 'Packing is deterministic');
  const placed = separateSchemaTables(imported);
  clear(placed);
  assert.deepEqual(separateSchemaTables(placed), placed, 'Queries preserve a valid layout');
  const grown = placed.map((table, i) => i === 0
    ? { ...table, width: table.width + 4000, height: table.height + 5000 }
    : table);
  clear(separateSchemaTables(grown));
  clear(separateSchemaTables([...placed, {
    id: 'created', width: 7000, height: 600, position: { x: 0, y: 0 },
  }]));
}
console.log('Schema layout: 250 varied import/growth/CREATE cases passed.');
