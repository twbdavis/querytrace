import assert from 'node:assert/strict';
import { TABLE_ROW_LIMIT, TABLE_SCENE_CELLS, tableRowWindow, tableSceneRowLimit, widestTableValues } from '../lib/tableRowWindow';
import { formatValue } from '../lib/formatValue';

const base = { count: 500, nodeX: 0, nodeY: 0, width: 1200, bodyOffset: 62, viewportWidth: 1440, viewportHeight: 900 };
const overview = tableRowWindow({ ...base, transform: [0, 0, 0.15] });
assert(overview.length <= TABLE_ROW_LIMIT, 'zoomed-out cards never mount all 500 rows');
const pinned = tableRowWindow({ ...base, transform: [0, 0, 0.15], pinned: 499 });
assert(pinned.includes(499) && pinned.length <= TABLE_ROW_LIMIT + 1, 'a distant pinned row remains mounted with a bounded window');
assert.equal(tableRowWindow({ ...base, transform: [2000, 0, 1] }).length, 0, 'offscreen large cards retain geometry without data cells');
const seen = new Set<number>();
for (let y = 0; y <= 9000; y += 400) for (const row of tableRowWindow({ ...base, transform: [0, -y, 1] })) seen.add(row);
assert.equal(seen.size, 500, 'every row becomes reachable by panning through the full card');
assert.equal(tableRowWindow({ ...base, count: 32, transform: [0, 0, 1] }).length, 32, 'normal small tables keep their complete rows');
for (const rows of [60, 125, 500]) {
  const scene = Array.from({ length: 24 }, () => ({ rows, columns: 20 }));
  const budget = tableSceneRowLimit(scene);
  assert(budget.windowed && scene.reduce((sum, table) => sum + Math.min(table.rows, budget.limit) * table.columns, 0) <= TABLE_SCENE_CELLS,
    'the scene budget also bounds initial and zoomed-out multi-card measurement');
}
assert(!tableSceneRowLimit(Array.from({ length: 4 }, () => ({ rows: 10, columns: 8 }))).windowed, 'friendly normal schemas do not window their rows');
const zoomedBudget = tableSceneRowLimit([{ rows: 60, columns: 20 }]);
assert.equal(tableRowWindow({ ...base, count: 60, transform: [2000, 0, 1], rowLimit: zoomedBudget.limit, windowed: true }).length, 0,
  'zooming to one normal-size card does not remount every offscreen card in a large schema');
const rows = Array.from({ length: 500 }, (_, i) => [i === 499 ? 'Widest value outside the first window' : 'short', i]);
assert.equal(widestTableValues(rows, 2, formatValue)[0], rows[499][0], 'column widths include unmounted values');
assert.equal(widestTableValues([['A'.repeat(51)], ['界'.repeat(50)]], 1, formatValue, (text) => [...text].reduce((sum, char) => sum + (char === '界' ? 2 : 1), 0))[0], '界'.repeat(50),
  'actual glyph width, rather than UTF-16 length, chooses hidden column probes');
const blob = formatValue(new Uint8Array(100_000).fill(255));
assert(blob.length < 100 && blob.includes('100000 bytes') && blob.includes('ffff'), 'blob previews have bounded text and preserve byte counts');
const text = formatValue('x'.repeat(100_000));
assert(text.length < 250 && text.includes('100000 characters'), 'large text previews remain bounded and state their full length');
assert.equal(formatValue(null), 'NULL');
assert.equal(formatValue(2.5), '2.50');
console.log('Canvas row windows, complete width probes and bounded cell previews passed.');
