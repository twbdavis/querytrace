'use client';

import { memo } from 'react';
import { BaseEdge, type EdgeProps } from '@xyflow/react';
import { useAppStore, useCurrentStep } from '@/store/useAppStore';
import { useMediaQuery } from '@/lib/useMediaQuery';

/**
 * Orthogonal key wire, schema-diagram style: rises from the PK column, runs
 * along a horizontal rail above both tables, then drops straight down into
 * the FK column header. Rail heights are staggered per edge so parallel
 * wires do not sit on top of each other.
 *
 * Idle edges read as drafting lines (dashed chalk); active edges snap to a
 * solid periwinkle with traveling pulses - no glow, just dash-to-solid.
 */
function railPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  clearance: number,
  r = 8
): string {
  if (Math.abs(tx - sx) < 4) {
    // Columns vertically aligned: a straight drop reads best.
    return `M ${sx} ${sy} L ${tx} ${ty}`;
  }
  const railY = Math.min(sy, ty) - clearance;
  const dir = tx > sx ? 1 : -1;
  const rr = Math.min(r, Math.abs(tx - sx) / 2);
  return [
    `M ${sx} ${sy}`,
    `L ${sx} ${railY + rr}`,
    `Q ${sx} ${railY} ${sx + dir * rr} ${railY}`,
    `L ${tx - dir * rr} ${railY}`,
    `Q ${tx} ${railY} ${tx} ${railY + rr}`,
    `L ${tx} ${ty}`,
  ].join(' ');
}

/** Arrowhead pointing straight down, tip on the FK column header. */
function arrowPath(x: number, y: number): string {
  return `M ${x - 4.5} ${y - 9} L ${x} ${y - 0.5} L ${x + 4.5} ${y - 9} Z`;
}

/** Small deterministic stagger so edges sharing an area get distinct rails. */
function railStagger(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 4) * 14;
}

function FKEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourceHandleId,
  targetHandleId,
}: EdgeProps) {
  const step = useCurrentStep();
  const speed = useAppStore((s) => s.speed);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const active = step?.activeEdges.includes(id) ?? false;

  const clearance = 46 + railStagger(id);
  const path = railPath(sourceX, sourceY, targetX, targetY, clearance);
  const stroke = active ? 'var(--accent-active)' : 'var(--border-strong)';

  // Label sits on the rail's horizontal run (or mid-drop when aligned).
  const straightDrop = Math.abs(targetX - sourceX) < 4;
  const labelX = (sourceX + targetX) / 2;
  const labelY = straightDrop
    ? (sourceY + targetY) / 2
    : Math.min(sourceY, targetY) - clearance;
  const label =
    sourceHandleId && targetHandleId ? `${sourceHandleId} → ${targetHandleId}` : null;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke,
          strokeWidth: active ? 2.5 : 1.25,
          strokeDasharray: active ? undefined : '6 4',
          transition: 'stroke 0.3s, stroke-width 0.3s',
        }}
      />
      <path d={arrowPath(targetX, targetY)} fill={stroke} style={{ transition: 'fill 0.3s' }} />
      {label && (
        <text
          x={labelX}
          y={labelY - 5}
          textAnchor="middle"
          style={{
            fill: active ? 'var(--accent-active)' : 'var(--text-muted)',
            fontFamily: 'var(--font-data), monospace',
            fontSize: 10,
            // Halo in the canvas color knocks the grid out behind the label.
            paintOrder: 'stroke',
            stroke: 'var(--bg-canvas)',
            strokeWidth: 5,
            strokeLinejoin: 'round',
            transition: 'fill 0.3s',
          }}
        >
          {label}
        </text>
      )}
      {active && !reducedMotion && (
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
    </>
  );
}

export const FKEdge = memo(FKEdgeInner);
