import assert from 'node:assert/strict';
import { routeKeys, type KeyRoute, type TableBounds } from '../lib/keyRoutes';

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
assert.notEqual(routeKeys(source, below, 90, 350, [source, below], 1).path, down.path, 'shared-table lanes stay distinct');
console.log('Key routes: vertical, horizontal, near-aligned, obstacle, self-reference and lane checks passed.');
