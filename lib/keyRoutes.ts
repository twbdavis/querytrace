export interface TableBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type KeySide = 'top' | 'bottom';
type Point = { x: number; y: number };

export interface KeyRoute {
  path: string;
  points: Point[];
  sourceSide: KeySide;
  targetSide: KeySide;
}

const GAP = 24;

function simplify(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (previous?.x === point.x && previous.y === point.y) continue;
    const before = result.at(-2);
    // Remove redundant stops, but preserve reversals so they are not mistaken
    // for a direct route through the table at the other end of the wire.
    if (before && previous && (
      (before.x === previous.x && previous.x === point.x && (previous.y - before.y) * (point.y - previous.y) > 0) ||
      (before.y === previous.y && previous.y === point.y && (previous.x - before.x) * (point.x - previous.x) > 0)
    )) result.pop();
    result.push(point);
  }
  return result;
}

function crossesBox(a: Point, b: Point, box: TableBounds): boolean {
  return a.x === b.x
    ? a.x > box.x + 0.5 && a.x < box.x + box.width - 0.5 &&
      Math.max(a.y, b.y) > box.y + 0.5 && Math.min(a.y, b.y) < box.y + box.height - 0.5
    : a.y > box.y + 0.5 && a.y < box.y + box.height - 0.5 &&
      Math.max(a.x, b.x) > box.x + 0.5 && Math.min(a.x, b.x) < box.x + box.width - 0.5;
}

interface ReservedIndex {
  vertical: Map<number, Array<readonly [number, number]>>;
  horizontal: Map<number, Array<readonly [number, number]>>;
}
const reservationIndexes = new WeakMap<readonly KeyRoute[], ReservedIndex>();

function reservedCost(a: Point, b: Point, reserved: readonly KeyRoute[]): number {
  if (!reserved.length) return 0;
  let index = reservationIndexes.get(reserved);
  if (!index) {
    index = { vertical: new Map(), horizontal: new Map() };
    for (const route of reserved) for (let i = 1; i < route.points.length; i++) {
      const c = route.points[i - 1];
      const d = route.points[i];
      const vertical = c.x === d.x;
      const low = Math.min(vertical ? c.y : c.x, vertical ? d.y : d.x);
      const high = Math.max(vertical ? c.y : c.x, vertical ? d.y : d.x);
      if (high - low <= 12) continue;
      const map = vertical ? index.vertical : index.horizontal;
      const key = vertical ? c.x : c.y;
      const intervals = map.get(key) ?? [];
      intervals.push([low, high]); map.set(key, intervals);
    }
    reservationIndexes.set(reserved, index);
  }
  const vertical = a.x === b.x;
  const low = Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x);
  const high = Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x);
  let cost = 0;
  for (const [from, to] of (vertical ? index.vertical : index.horizontal).get(vertical ? a.x : a.y) ?? []) {
    cost += Math.max(0, Math.min(high, to) - Math.max(low, from) - 12) * 20;
  }
  return cost;
}

function score(points: Point[], reserved: readonly KeyRoute[]): number {
  let cost = Math.max(0, points.length - 2) * 18;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    cost += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    cost += reservedCost(a, b, reserved);
  }
  return cost;
}

function branchTerminal(points: Point[], reserved: readonly KeyRoute[], offset: number, escape: number): Point[] {
  const [port, next] = points;
  if (!next || port.x !== next.x || Math.abs(next.y - port.y) <= 12 || reservedCost(port, next, reserved) === 0) return points;
  const y = port.y + Math.sign(next.y - port.y) * escape;
  return [port, { x: port.x, y }, { x: port.x + offset, y }, { x: port.x + offset, y: next.y }, ...points.slice(1)];
}

/** Visibility grid: neighboring gutter coordinates form a bounded orthogonal graph. */
function gridPath(start: Point, end: Point, obstacles: TableBounds[], reserved: readonly KeyRoute[], gap: number): Point[] | undefined {
  const xs = [...new Set([start.x, end.x, ...obstacles.flatMap((box) => [box.x - gap, box.x, box.x + box.width, box.x + box.width + gap])])].sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, ...obstacles.flatMap((box) => [box.y - gap, box.y, box.y + box.height, box.y + box.height + gap])])].sort((a, b) => a - b);
  const width = xs.length;
  const size = width * ys.length;
  const from = ys.indexOf(start.y) * width + xs.indexOf(start.x);
  const to = ys.indexOf(end.y) * width + xs.indexOf(end.x);
  const point = (id: number): Point => ({ x: xs[id % width], y: ys[Math.floor(id / width)] });
  const costs = new Float64Array(size * 2).fill(Infinity);
  const previous = new Int32Array(size * 2).fill(-1);
  const heap: Array<{ id: number; cost: number }> = [];
  const push = (entry: { id: number; cost: number }) => {
    let at = heap.length;
    heap.push(entry);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (heap[parent].cost <= entry.cost) break;
      heap[at] = heap[parent]; at = parent;
    }
    heap[at] = entry;
  };
  const pop = () => {
    const first = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      let at = 0;
      while (at * 2 + 1 < heap.length) {
        let child = at * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++;
        if (heap[child].cost >= last.cost) break;
        heap[at] = heap[child]; at = child;
      }
      heap[at] = last;
    }
    return first;
  };
  for (let direction = 0; direction < 2; direction++) {
    costs[from * 2 + direction] = 0;
    push({ id: from * 2 + direction, cost: 0 });
  }
  while (heap.length) {
    const current = pop();
    if (current.cost !== costs[current.id]) continue;
    const cell = Math.floor(current.id / 2);
    if (cell === to) {
      const path: Point[] = [];
      for (let id = current.id; id !== -1; id = previous[id]) path.push(point(Math.floor(id / 2)));
      return simplify(path.reverse());
    }
    const x = cell % width;
    const y = Math.floor(cell / width);
    const neighbors = [x > 0 ? cell - 1 : -1, x + 1 < width ? cell + 1 : -1, y > 0 ? cell - width : -1, y + 1 < ys.length ? cell + width : -1];
    const a = point(cell);
    for (let n = 0; n < neighbors.length; n++) {
      const next = neighbors[n];
      if (next === -1) continue;
      const b = point(next);
      if (obstacles.some((box) => crossesBox(a, b, box))) continue;
      const direction = n < 2 ? 0 : 1;
      const id = next * 2 + direction;
      const cost = current.cost + Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + (direction === current.id % 2 ? 0 : 18) + reservedCost(a, b, reserved);
      if (cost >= costs[id]) continue;
      costs[id] = cost; previous[id] = current.id; push({ id, cost });
    }
  }
  return undefined;
}

/** A small, bounded set of orthogonal routes, evaluated only when geometry changes. */
export function routeKeys(
  source: TableBounds,
  target: TableBounds,
  sourceX: number,
  targetX: number,
  obstacles: TableBounds[],
  lane = 0,
  reserved: readonly KeyRoute[] = [],
  escapes: { source: number; target: number } = { source: 1 + lane % 12, target: 1 + lane % 12 }
): KeyRoute {
  const selfColumn = source.id === target.id && sourceX === targetX;
  // Exit/entry bends stay in the inter-card gap even with hundreds of keys.
  // Only exterior gutters grow with the lane number, where no card can block them.
  const clearance = GAP + (lane % 80) * 1.2;
  const outerClearance = GAP + lane * 12;
  const sourceBottom = source.y + source.height;
  const targetBottom = target.y + target.height;
  let best: KeyRoute | undefined;
  let bestScore = Infinity;
  const add = (sourceSide: KeySide, targetSide: KeySide, middle: Point[]) => {
    if (selfColumn && sourceSide === targetSide) return;
    const direct = simplify([
      { x: sourceX, y: sourceSide === 'top' ? source.y : sourceBottom },
      ...middle,
      { x: targetX, y: targetSide === 'top' ? target.y : targetBottom },
    ]);
    const variants = [direct];
    if (reserved.length) for (const direction of [-1, 1]) {
      const offset = direction * (12 + lane * 6);
      const sourceBranch = branchTerminal(direct, reserved, offset, escapes.source);
      variants.push(simplify(branchTerminal([...sourceBranch].reverse(), reserved, offset, escapes.target).reverse()));
    }
    for (const points of variants) {
      if (points.some((point, i) => i > 0 && obstacles.some((box) => crossesBox(points[i - 1], point, box)))) continue;
      const cost = score(points, reserved);
      if (cost >= bestScore) continue;
      bestScore = cost;
      best = {
        points, sourceSide, targetSide,
        path: points.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '),
      };
    }
  };

  if (source.id !== target.id && target.y - sourceBottom >= GAP) {
    const gap = target.y - sourceBottom;
    const y = sourceBottom + gap / 2 + Math.min(lane * 12, (gap - GAP) / 2);
    add('bottom', 'top', [{ x: sourceX, y }, { x: targetX, y }]);
    if (sourceX === targetX && (lane > 0 || reserved.length)) {
      const x = sourceX + ((lane % 2 ? 1 : -1) * (12 + lane * 6));
      add('bottom', 'top', [{ x: sourceX, y: sourceBottom + 12 }, { x, y: sourceBottom + 12 }, { x, y: target.y - 12 }, { x: targetX, y: target.y - 12 }]);
    }
  }
  if (source.id !== target.id && source.y - targetBottom >= GAP) {
    const gap = source.y - targetBottom;
    const y = targetBottom + gap / 2 + Math.min(lane * 12, (gap - GAP) / 2);
    add('top', 'bottom', [{ x: sourceX, y }, { x: targetX, y }]);
  }
  const top = Math.min(source.y, target.y) - clearance;
  const bottom = Math.max(sourceBottom, targetBottom) + clearance;
  add('top', 'top', [{ x: sourceX, y: top }, { x: targetX, y: top }]);
  add('bottom', 'bottom', [{ x: sourceX, y: bottom }, { x: targetX, y: bottom }]);

  // Normal layouts finish here. Only obstructed wires need a wider detour.
  if (!best || reserved.length || selfColumn) {
    const outerTop = Math.min(...obstacles.map((box) => box.y), top) - outerClearance;
    const outerBottom = Math.max(...obstacles.map((box) => box.y + box.height), bottom) + outerClearance;
    add('top', 'top', [{ x: sourceX, y: outerTop }, { x: targetX, y: outerTop }]);
    add('bottom', 'bottom', [{ x: sourceX, y: outerBottom }, { x: targetX, y: outerBottom }]);
    const gutters = new Set([
      Math.min(source.x, target.x) - clearance,
      Math.max(source.x + source.width, target.x + target.width) + clearance,
      Math.min(...obstacles.map((box) => box.x)) - outerClearance,
      Math.max(...obstacles.map((box) => box.x + box.width)) + outerClearance,
    ]);
    for (const sourceSide of ['top', 'bottom'] as const) {
      for (const targetSide of ['top', 'bottom'] as const) {
        const exitY = sourceSide === 'top' ? source.y - clearance : sourceBottom + clearance;
        const entryY = targetSide === 'top' ? target.y - clearance : targetBottom + clearance;
        const shortExitY = sourceSide === 'top' ? source.y - escapes.source : sourceBottom + escapes.source;
        for (const x of gutters) {
          add(sourceSide, targetSide, [
            { x: sourceX, y: exitY }, { x, y: exitY },
            { x, y: entryY }, { x: targetX, y: entryY },
          ]);
          add(sourceSide, targetSide, [
            { x: sourceX, y: shortExitY }, { x, y: shortExitY },
            { x, y: entryY }, { x: targetX, y: entryY },
          ]);
        }
      }
    }
  }
  // Simple detours can all cross a different obstacle in dense cycles. Search
  // the actual free gutters instead of accepting the least obstructed wire.
  if (!best) {
    for (const sourceSide of ['top', 'bottom'] as const) for (const targetSide of ['top', 'bottom'] as const) {
      const exit = { x: sourceX, y: sourceSide === 'top' ? source.y - GAP : sourceBottom + GAP };
      const entry = { x: targetX, y: targetSide === 'top' ? target.y - GAP : targetBottom + GAP };
      const sourcePort = { x: sourceX, y: sourceSide === 'top' ? source.y : sourceBottom };
      const targetPort = { x: targetX, y: targetSide === 'top' ? target.y : targetBottom };
      if (obstacles.some((box) => crossesBox(sourcePort, exit, box) || crossesBox(entry, targetPort, box))) continue;
      const path = gridPath(exit, entry, obstacles, reserved, GAP + (lane % 8) * 6);
      if (path) add(sourceSide, targetSide, path);
    }
  }
  // A user can drag one table directly over a port on another table. There
  // is no visible free path in that geometry; hide the wire until it separates.
  return best ?? { path: '', points: [{ x: sourceX, y: source.y }, { x: targetX, y: target.y }], sourceSide: 'top', targetSide: 'top' };
}

export interface KeyConnection {
  id: string;
  source: string;
  target: string;
  sourceX: number;
  targetX: number;
  lane?: number;
}

/** Reserve previous trunks in stable edge order, independent of React render order. */
export function routeKeyConnections(connections: readonly KeyConnection[], bounds: TableBounds[]): ReadonlyMap<string, KeyRoute> {
  const routes = new Map<string, KeyRoute>();
  const byId = new Map(bounds.map((box) => [box.id, box]));
  const ordered = [...connections].sort((a, b) => a.id.localeCompare(b.id));
  const port = (table: string, x: number) => JSON.stringify([table, x]);
  const totals = new Map<string, number>();
  const used = new Map<string, number>();
  for (const connection of ordered) for (const key of [port(connection.source, connection.sourceX), port(connection.target, connection.targetX)]) totals.set(key, (totals.get(key) ?? 0) + 1);
  const escape = (key: string) => {
    const count = (used.get(key) ?? 0) + 1;
    used.set(key, count);
    return 12 * count / ((totals.get(key) ?? 1) + 1);
  };
  for (const connection of ordered) {
    const source = byId.get(connection.source);
    const target = byId.get(connection.target);
    if (!source || !target || source.width <= 0 || target.width <= 0 || source.height <= 0 || target.height <= 0) continue;
    routes.set(connection.id, routeKeys(source, target, connection.sourceX, connection.targetX, bounds, connection.lane, [...routes.values()], {
      source: escape(port(connection.source, connection.sourceX)), target: escape(port(connection.target, connection.targetX)),
    }));
  }
  return routes;
}
