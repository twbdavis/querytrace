import assert from 'node:assert/strict';
import { routeKeys, routeKeyConnections, type KeyRoute, type TableBounds } from '../lib/keyRoutes';
import { packSchemaTables } from '../lib/schemaLayout';

const source: TableBounds = { id: 'P', x: 0, y: 0, width: 180, height: 100 };
const below: TableBounds = { id: 'C', x: 260, y: 240, width: 180, height: 100 };

function verify(route: KeyRoute, obstacles: TableBounds[]) {
  assert(!/[CQAST]/.test(route.path), 'connections use only straight line commands');
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1];
    const b = route.points[i];
    assert(a.x === b.x || a.y === b.y, 'each segment is horizontal or vertical');
    assert(a.x !== b.x || a.y !== b.y, 'zero-length segments are removed');
    for (const box of obstacles) {
      const crosses = a.x === b.x
        ? a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
        : a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width;
      assert(!crosses, `wire avoids ${box.id} interior across its entire segment`);
      // Sampling includes the segment's interior even when a small obstacle
      // occupies only a fraction of a long wire.
      for (let sample = 1; sample < 100; sample++) {
        const x = a.x + (b.x - a.x) * sample / 100;
        const y = a.y + (b.y - a.y) * sample / 100;
        assert(!(x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height), 'wire avoids table interiors');
      }
    }
  }
}

const down = routeKeys(source, below, 90, 350, [source, below]);
assert.equal(down.sourceSide, 'bottom');
assert.equal(down.targetSide, 'top');
verify(down, [source, below]);
const up = routeKeys(below, source, 350, 90, [source, below]);
assert.equal(up.sourceSide, 'top');
assert.equal(up.targetSide, 'bottom');
verify(up, [source, below]);

const beside = { ...below, y: 0 };
verify(routeKeys(source, beside, 90, 350, [source, beside]), [source, beside]);
const aligned = { ...below, x: 0 };
assert.equal(routeKeys(source, aligned, 90, 90, [source, aligned]).points.length, 2);
verify(routeKeys(source, aligned, 90, 92, [source, aligned]), [source, aligned]);

const blocker = { id: 'B', x: 240, y: 125, width: 140, height: 90 };
verify(routeKeys(source, below, 90, 350, [source, below, blocker]), [source, below, blocker]);
verify(routeKeys(source, source, 45, 135, [source]), [source]);
const selfColumn = routeKeys(source, source, 90, 90, [source]);
assert(selfColumn.points.some((point) => point.x !== selfColumn.points[0].x), 'same-column self reference has a visible loop');
verify(selfColumn, [source]);
assert.equal(selfColumn.points[0].x, 90, 'self-reference starts at the exact key column center');
assert.equal(selfColumn.points.at(-1)!.x, 90, 'self-reference ends at the exact key column center');
assert.notEqual(routeKeys(source, below, 90, 350, [source, below], 1).path, down.path, 'shared-table lanes stay distinct');

// Every old top/bottom/outer-gutter candidate intersects a different table.
const denseSource = { id: 'dense_source', x: 300, y: 200, width: 180, height: 100 };
const denseTarget = { id: 'dense_target', x: 750, y: 200, width: 180, height: 100 };
const dense = [denseSource, denseTarget,
  { id: 'upper', x: 250, y: 100, width: 250, height: 60 },
  { id: 'lower', x: 250, y: 340, width: 250, height: 60 },
  { id: 'left', x: 100, y: 150, width: 180, height: 180 },
  { id: 'right', x: 520, y: 150, width: 160, height: 300 },
];
const weave = routeKeys(denseSource, denseTarget, 390, 840, dense);
verify(weave, dense);
assert(weave.points.length >= 6, 'dense obstacle route uses multiple free gutters');
assert.equal(routeKeys(denseSource, denseTarget, 390, 840, dense).path, weave.path, 'obstacle route is deterministic');

const cyclicBounds: TableBounds[] = Array.from({ length: 9 }, (_, i) => ({
  id: `T${i}`, x: (i % 3) * 420, y: Math.floor(i / 3) * 260, width: 220, height: 120,
}));
const cyclicConnections = cyclicBounds.map((box, i) => ({
  id: `cycle${i}`, source: box.id, target: cyclicBounds[(i + 4) % 9].id,
  sourceX: box.x + 110, targetX: cyclicBounds[(i + 4) % 9].x + 110, lane: i % 3,
}));
const cyclicRoutes = routeKeyConnections(cyclicConnections, cyclicBounds);
assert.equal(cyclicRoutes.size, cyclicConnections.length);
for (const route of cyclicRoutes.values()) verify(route, cyclicBounds);
assert.deepEqual([...routeKeyConnections([...cyclicConnections].reverse(), cyclicBounds)], [...cyclicRoutes], 'graph reservations ignore edge render order');

const parallel = routeKeyConnections([
  { id: 'parallel1', source: source.id, target: aligned.id, sourceX: 90, targetX: 90 },
  { id: 'parallel2', source: source.id, target: aligned.id, sourceX: 90, targetX: 90, lane: 1 },
  { id: 'parallel3', source: source.id, target: aligned.id, sourceX: 90, targetX: 90, lane: 2 },
], [source, aligned]);
assert.equal(new Set([...parallel.values()].map((route) => route.path)).size, 3, 'parallel foreign keys use distinct long trunks');
for (const route of parallel.values()) {
  verify(route, [source, aligned]);
  assert.equal(route.points[0].x, 90);
  assert.equal(route.points.at(-1)!.x, 90);
}
const hub: TableBounds = { id: 'hub', x: 0, y: 0, width: 760, height: 140 };
const children: TableBounds[] = Array.from({ length: 12 }, (_, i) => ({
  id: `child${i}`, x: (i % 3) * 660, y: 320 + Math.floor(i / 3) * 460, width: 500, height: 280,
}));
const fanout = [...routeKeyConnections(children.map((child, i) => ({
  id: `fk${String(i).padStart(2, '0')}`, source: hub.id, target: child.id, sourceX: 80, targetX: child.x + 80, lane: i,
})), [hub, ...children]).values()];
assert.equal(fanout.length, 12);
for (const route of fanout) verify(route, [hub, ...children]);
for (let i = 0; i < fanout.length; i++) for (let j = 0; j < i; j++) {
  for (let a = 1; a < fanout[i].points.length; a++) for (let b = 1; b < fanout[j].points.length; b++) {
    const p = fanout[i].points[a - 1], q = fanout[i].points[a];
    const r = fanout[j].points[b - 1], s = fanout[j].points[b];
    const overlap = p.x === q.x && r.x === s.x && p.x === r.x
      ? Math.min(Math.max(p.y, q.y), Math.max(r.y, s.y)) - Math.max(Math.min(p.y, q.y), Math.min(r.y, s.y))
      : p.y === q.y && r.y === s.y && p.y === r.y
        ? Math.min(Math.max(p.x, q.x), Math.max(r.x, s.x)) - Math.max(Math.min(p.x, q.x), Math.min(r.x, s.x)) : 0;
    assert(overlap <= 12 + 1e-6, 'high fanout shares only short terminal stems');
  }
}
const cover = { ...below, x: -10, y: -10, width: 200, height: 120 };
const coveredPort = routeKeys(source, cover, 90, 90, [source, cover]);
assert.equal(coveredPort.path, '', 'an overlapped port hides its wire instead of crossing the covering card');
const denseFanoutBounds = packSchemaTables(Array.from({ length: 24 }, (_, i) => ({
  id: i === 0 ? 'hub_dense' : `child_dense${i}`, width: i === 0 ? 900 : 1600, height: 82, position: { x: 0, y: 0 },
}))).map((box) => ({ id: box.id, x: box.position.x, y: box.position.y, width: box.width, height: box.height }));
const denseFanout = routeKeyConnections(denseFanoutBounds.slice(1).flatMap((box, i) => Array.from({ length: 19 }, (_, column) => ({
  id: `dense${String(i * 19 + column).padStart(3, '0')}`, source: 'hub_dense', target: box.id,
  sourceX: 60, targetX: box.x + 60 + (column + 1) * 78, lane: i * 19 + column,
}))), denseFanoutBounds);
assert.equal(denseFanout.size, 437, 'all permitted dense relationship wires remain visible');
for (const route of denseFanout.values()) {
  assert(route.path, 'dense fanout does not drop its high lane numbers');
  verify(route, denseFanoutBounds);
}
console.log('Key routes: ports, obstacles, dense cycles, self-reference and shared-wire reservations passed.');
