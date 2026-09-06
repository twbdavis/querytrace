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

function score(points: Point[], obstacles: TableBounds[]): number {
  let cost = Math.max(0, points.length - 2) * 18;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    cost += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    for (const box of obstacles) {
      // Touching a port/border is fine. Crossing a table's interior is costly.
      const crosses = a.x === b.x
        ? a.x > box.x + 0.5 && a.x < box.x + box.width - 0.5 &&
          Math.max(a.y, b.y) > box.y + 0.5 && Math.min(a.y, b.y) < box.y + box.height - 0.5
        : a.y > box.y + 0.5 && a.y < box.y + box.height - 0.5 &&
          Math.max(a.x, b.x) > box.x + 0.5 && Math.min(a.x, b.x) < box.x + box.width - 0.5;
      if (crosses) cost += 1_000_000;
    }
  }
  return cost;
}

/** A small, bounded set of orthogonal routes, evaluated only when geometry changes. */
export function routeKeys(
  source: TableBounds,
  target: TableBounds,
  sourceX: number,
  targetX: number,
  obstacles: TableBounds[],
  lane = 0
): KeyRoute {
  // A column that references itself still needs a visible loop, with two
  // nearby terminals in that same column instead of a retraced vertical line.
  if (source.id === target.id && sourceX === targetX) {
    sourceX -= 6;
    targetX += 6;
  }
  const clearance = GAP + lane * 12;
  const sourceBottom = source.y + source.height;
  const targetBottom = target.y + target.height;
  let best: KeyRoute | undefined;
  let bestScore = Infinity;
  const add = (sourceSide: KeySide, targetSide: KeySide, middle: Point[]) => {
    const points = simplify([
      { x: sourceX, y: sourceSide === 'top' ? source.y : sourceBottom },
      ...middle,
      { x: targetX, y: targetSide === 'top' ? target.y : targetBottom },
    ]);
    const cost = score(points, obstacles);
    if (cost >= bestScore) return;
    bestScore = cost;
    best = {
      points, sourceSide, targetSide,
      path: points.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '),
    };
  };

  if (source.id !== target.id && target.y - sourceBottom >= GAP) {
    const gap = target.y - sourceBottom;
    const y = sourceBottom + gap / 2 + Math.min(lane * 12, (gap - GAP) / 2);
    add('bottom', 'top', [{ x: sourceX, y }, { x: targetX, y }]);
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
  if (bestScore >= 1_000_000) {
    const outerTop = Math.min(...obstacles.map((box) => box.y), top) - clearance;
    const outerBottom = Math.max(...obstacles.map((box) => box.y + box.height), bottom) + clearance;
    add('top', 'top', [{ x: sourceX, y: outerTop }, { x: targetX, y: outerTop }]);
    add('bottom', 'bottom', [{ x: sourceX, y: outerBottom }, { x: targetX, y: outerBottom }]);
    const gutters = new Set([
      Math.min(source.x, target.x) - clearance,
      Math.max(source.x + source.width, target.x + target.width) + clearance,
      Math.min(...obstacles.map((box) => box.x)) - clearance,
      Math.max(...obstacles.map((box) => box.x + box.width)) + clearance,
    ]);
    for (const sourceSide of ['top', 'bottom'] as const) {
      for (const targetSide of ['top', 'bottom'] as const) {
        const exitY = sourceSide === 'top' ? source.y - clearance : sourceBottom + clearance;
        const entryY = targetSide === 'top' ? target.y - clearance : targetBottom + clearance;
        for (const x of gutters) {
          add(sourceSide, targetSide, [
            { x: sourceX, y: exitY }, { x, y: exitY },
            { x, y: entryY }, { x: targetX, y: entryY },
          ]);
        }
      }
    }
  }
  return best!;
}
