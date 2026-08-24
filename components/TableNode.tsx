'use client';

import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { useAppStore, useCurrentStep, useHighlight } from '@/store/useAppStore';
import type { TableMeta } from '@/lib/schemas';
import { accents, rowStates, surfaces } from '@/styles/theme';
import type { Stage } from '@/lib/traceEngine';

export interface TableNodeData extends Record<string, unknown> {
  meta: TableMeta;
  columns: string[];
  rows: unknown[][];
  rids: number[];
}

export type TableFlowNode = Node<TableNodeData, 'table'>;

type RowKind = 'neutral' | 'lit' | 'dimmed' | 'group' | 'nullext';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** Column-underline + text classes per stage role (styling only; role = current stage). */
const STAGE_COL_ACCENT: Record<Stage, string> = {
  from: 'border-b-accent-active text-accent-active',
  join: 'border-b-accent-active text-accent-active',
  where: 'border-b-accent-filter text-accent-filter',
  groupBy: 'border-b-accent-group text-accent-group',
  having: 'border-b-accent-filter text-accent-filter',
  subquery: 'border-b-accent-group text-accent-group',
  union: 'border-b-accent-result text-accent-result',
  select: 'border-b-accent-result text-accent-result',
  orderLimit: 'border-b-ink-dim text-ink-dim',
};

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' && !Number.isInteger(v)) return v.toFixed(2);
  return String(v);
}

function TableNodeInner({ data }: NodeProps<TableFlowNode>) {
  const { meta, columns, rows, rids } = data;
  const step = useCurrentStep();
  const highlight = useHighlight();
  const selection = useAppStore((s) => s.selection);
  const selectRow = useAppStore((s) => s.selectRow);
  const setHoveredRow = useAppStore((s) => s.setHoveredRow);

  const table = meta.name;
  const pkIndices = useMemo(
    () => new Set(columns.map((column, index) => (meta.columns.find((c) => c.name === column)?.pk ? index : -1)).filter((index) => index >= 0)),
    [columns, meta]
  );

  const isActiveTable = !step || step.activeTables.includes(table);
  const activeCols = useMemo(
    () =>
      new Set(
        (step?.activeColumns ?? [])
          .filter((c) => c.table === table)
          .map((c) => c.column)
      ),
    [step, table]
  );
  const colAccent = step ? STAGE_COL_ACCENT[step.stage] : STAGE_COL_ACCENT.from;

  const rowState = (rid: number): { kind: RowKind; color?: string } => {
    if (!step) return { kind: 'neutral' };
    if (step.dimmedRows[table]?.has(rid)) return { kind: 'dimmed' };
    const groupColor = step.groupColors?.[table]?.[rid];
    if (groupColor) return { kind: 'group', color: groupColor };
    if (step.nullExtendedRows?.[table]?.has(rid)) return { kind: 'nullext' };
    if (step.litRows[table]?.has(rid)) return { kind: 'lit' };
    return { kind: 'neutral' };
  };

  return (
    <div
      className={`rounded-md bg-node font-data text-[11px] leading-tight transition-colors duration-300 ${
        isActiveTable ? 'border-[1.5px] border-accent-active' : 'border border-line-strong'
      }`}
      style={{ minWidth: 180 }}
    >
      {/* Header */}
      <div
        className={`flex items-baseline justify-between rounded-t-md border-b bg-node-header px-2.5 py-1.5 ${
          isActiveTable ? 'border-accent-active/40' : 'border-line-strong'
        }`}
      >
        <span className="font-ui text-[13px] font-medium tracking-wide text-ink">{table}</span>
        <span className="font-data text-[10px] text-ink-dim">{rows.length} rows</span>
      </div>

      {/* Column headers + data rows share one grid so columns auto-size to
          their content and full attribute names are never truncated. */}
      <div
        className="grid px-1 py-0.5"
        style={{ gridTemplateColumns: `repeat(${meta.columns.length}, minmax(min-content, 1fr))` }}
        onMouseLeave={() => setHoveredRow(null)}
      >
        <div className="col-span-full grid grid-cols-subgrid border-b border-line bg-node-header/50">
          {meta.columns.map((c) => (
            <div
              key={c.name}
              className={`relative flex items-center gap-1 whitespace-nowrap border-b-2 px-1.5 py-1 font-bold ${
                activeCols.has(c.name) ? colAccent : 'border-b-transparent text-ink-dim'
              }`}
              title={
                c.pk
                  ? `${c.name}${c.type ? ` ${c.type}` : ''} — primary key: uniquely identifies each row in ${table} and can never be NULL${c.defaultValue !== null && c.defaultValue !== undefined ? ` — default ${c.defaultValue}` : ''}`
                  : c.fk
                    ? `${c.name}${c.type ? ` ${c.type}` : ''} — foreign key: each value points at ${c.fk.table}.${c.fk.column} — ON UPDATE ${c.fk.onUpdate ?? 'NO ACTION'}, ON DELETE ${c.fk.onDelete ?? 'NO ACTION'}`
                    : `${c.name}${c.type ? ` ${c.type}` : ''}${c.notNull ? ' — NOT NULL' : ' — NULL allowed'}${c.defaultValue !== null && c.defaultValue !== undefined ? ` — default ${c.defaultValue}` : ''}`
              }
            >
              {/* Key arrows anchor at the attribute cells: tail at the parent's
                  primary key, arrowhead landing on the dependent foreign key. */}
              {c.pk && (
                <Handle
                  id={c.name}
                  type="source"
                  position={Position.Top}
                  isConnectable={false}
                  style={{
                    left: '50%',
                    top: 0,
                    transform: 'translate(-50%, 0)',
                    opacity: 0,
                    pointerEvents: 'none',
                    width: 1,
                    height: 1,
                    minWidth: 0,
                    minHeight: 0,
                  }}
                />
              )}
              {c.fk && (
                <Handle
                  id={c.name}
                  type="target"
                  position={Position.Top}
                  isConnectable={false}
                  style={{
                    left: '50%',
                    top: 0,
                    transform: 'translate(-50%, 0)',
                    opacity: 0,
                    pointerEvents: 'none',
                    width: 1,
                    height: 1,
                    minWidth: 0,
                    minHeight: 0,
                  }}
                />
              )}
              <span
                className={
                  c.pk ? 'underline decoration-accent-active/80 decoration-[1.5px] underline-offset-2' : ''
                }
              >
                {c.name}
              </span>
              {c.type && (
                <span className="font-data text-[7px] font-normal uppercase tracking-tight text-ink-mute">
                  {c.type}
                </span>
              )}
              {c.pk && (
                <span className="rounded-full border border-accent-active px-1 py-px font-data text-[8px] font-bold leading-none text-accent-active">
                  PK
                </span>
              )}
              {c.fk && (
                <span className="rounded-full border border-ink-dim px-1 py-px font-data text-[8px] font-bold leading-none text-ink-dim">
                  FK
                </span>
              )}
            </div>
          ))}
        </div>

        {rows.map((row, ri) => {
          const rid = rids[ri];
          const { kind, color } = rowState(rid);
          const dimmed = kind === 'dimmed';
          const inHighlight = highlight?.rows[table]?.has(rid) ?? false;
          const isPinned =
            (selection?.table === table && selection.rid === rid) ||
            (inHighlight && (highlight?.pinned ?? false));
          const inspecting = isPinned || inHighlight;
          const zebra = ri % 2 === 1 ? surfaces.rowAlt : TRANSPARENT;

          const bg = inspecting
            ? rowStates.inspectBg
            : kind === 'group' && color
              ? hexToRgba(color, 0.15)
              : kind === 'lit' || kind === 'nullext'
                ? rowStates.litBg
                : zebra;
          const leftBorder = inspecting
            ? accents.result
            : kind === 'group' && color
              ? color
              : kind === 'nullext'
                ? rowStates.nullBorder
                : kind === 'lit'
                  ? rowStates.litBorder
                  : TRANSPARENT;

          return (
            <div
              key={rid}
              onClick={() => {
                if (!dimmed) selectRow({ table, rid });
              }}
              onMouseEnter={() => {
                if (!dimmed && step) setHoveredRow({ table, rid });
              }}
              title={dimmed ? 'Eliminated at this stage' : 'Click to trace this row everywhere it contributes'}
              className={`col-span-full my-px grid grid-cols-subgrid rounded-sm border-l-2 transition-[background-color,opacity,border-color] duration-300 ${
                dimmed ? 'cursor-default' : 'cursor-pointer'
              }`}
              style={{
                backgroundColor: dimmed ? TRANSPARENT : bg,
                opacity: dimmed ? 0.3 : 1,
                borderLeftColor: dimmed ? TRANSPARENT : leftBorder,
                borderLeftStyle: kind === 'nullext' ? 'dashed' : 'solid',
                outline: isPinned ? `1px solid ${accents.result}` : undefined,
                outlineOffset: isPinned ? '-1px' : undefined,
              }}
            >
              {row.map((v, ci) => (
                <div
                  key={ci}
                  className={`whitespace-nowrap border-r border-r-[rgba(255,255,255,0.04)] px-1.5 py-[1px] last:border-r-0 ${
                    dimmed
                      ? 'text-ink-mute line-through decoration-ink-mute/60'
                      : pkIndices.has(ci)
                        ? 'text-ink-dim'
                        : 'text-ink'
                  }`}
                >
                  {fmt(v)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const TableNode = memo(TableNodeInner);
