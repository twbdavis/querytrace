'use client';

import { memo, useMemo, type CSSProperties } from 'react';
import { BaseEdge, type EdgeProps } from '@xyflow/react';
import { useAppStore } from '@/store/useAppStore';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useDocumentVisible } from '@/lib/useDocumentVisible';
import { routeKeys, type KeySide } from '@/lib/keyRoutes';
import { useTableBounds } from '@/lib/useTableBounds';

/**
 * Column handles supply the horizontal alignment. Project those anchors to
 * the table's top/bottom border so wires can approach outside its title/rows.
 */
function arrowPath(x: number, y: number, side: KeySide): string {
  const direction = side === 'top' ? -1 : 1;
  return `M ${x - 4} ${y + direction * 9} L ${x} ${y + direction} L ${x + 4} ${y + direction * 9} Z`;
}

function FKEdgeInner({
  id,
  source,
  target,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourceHandleId,
  targetHandleId,
}: EdgeProps) {
  const active = useAppStore((s) => s.trace?.[s.currentStep]?.activeEdges.includes(id) ?? false);
  const playing = useAppStore((s) => s.playing);
  const speed = useAppStore((s) => s.speed);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const visible = useDocumentVisible();
  const bounds = useTableBounds();
  const lane = typeof data?.lane === 'number' ? data.lane : 0;
  const route = useMemo(() => routeKeys(
    bounds.find((box) => box.id === source) ?? { id: source, x: sourceX, y: sourceY, width: 0, height: 0 },
    bounds.find((box) => box.id === target) ?? { id: target, x: targetX, y: targetY, width: 0, height: 0 },
    sourceX, targetX, bounds, lane
  ), [bounds, source, target, sourceX, sourceY, targetX, targetY, lane]);
  const { path, points } = route;
  const start = points[0];
  const end = points[points.length - 1];
  const label = `${source}.${sourceHandleId} → ${target}.${targetHandleId}`;

  return (
    <g
      className="key-connection"
      data-source-side={route.sourceSide}
      data-target-side={route.targetSide}
      style={{ '--key-stroke': active ? 'var(--accent-active)' : 'var(--border-strong)' } as CSSProperties}
    >
      <title>{label}</title>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: 'var(--key-stroke)',
          strokeWidth: active ? 2.5 : 1.5,
          strokeLinejoin: 'miter',
          strokeLinecap: 'butt',
          transition: 'stroke 180ms ease-out',
        }}
      />
      <rect x={start.x - 2.5} y={start.y - 2.5} width={5} height={5} fill="var(--key-stroke)" />
      <path className="key-arrow" d={arrowPath(end.x, end.y, route.targetSide)} fill="var(--key-stroke)" />
      {active && playing && visible && !reducedMotion && (
        <g className="edge-pulse">
          <circle r={3.5} fill="var(--accent-pulse)">
            <animateMotion dur={`${1.4 / speed}s`} repeatCount="indefinite" path={path} />
          </circle>
          <circle r={3.5} fill="var(--accent-pulse)">
            <animateMotion
              dur={`${1.4 / speed}s`}
              begin={`${0.7 / speed}s`}
              repeatCount="indefinite"
              path={path}
            />
          </circle>
        </g>
      )}
    </g>
  );
}

export const FKEdge = memo(FKEdgeInner);
