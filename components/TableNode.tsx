'use client';

import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { useAppStore, useCurrentStep, useHighlight, type Selection } from '@/store/useAppStore';
import type { TableMeta } from '@/lib/schemas';
import { accents, rowStates, surfaces } from '@/styles/theme';
import type { Stage } from '@/lib/traceEngine';
import { CheckIcon } from './Icons';

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

const STAGE_CELL_ACCENT: Record<Stage, string> = {
  from: 'bg-accent-active/20',
  join: 'bg-accent-active/20',
  where: 'bg-accent-filter/20',
  groupBy: 'bg-accent-group/20',
  having: 'bg-accent-filter/20',
  subquery: 'bg-accent-group/20',
  union: 'bg-accent-result/20',
  select: 'bg-accent-result/20',
  orderLimit: 'bg-ink-dim/20',
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

// A hover should update the affected row styles, not rebuild every data cell.
const TableRow = memo(function TableRow({
  row, ri, rid, table, kind, color, isPinned, inHighlight, traceActive,
  pkIndices, activeColumnIndices, cellAccent, selectRow, setHoveredRow,
}: {
  row: unknown[];
  ri: number;
  rid: number;
  table: string;
  kind: RowKind;
  color?: string;
  isPinned: boolean;
  inHighlight: boolean;
  traceActive: boolean;
  pkIndices: Set<number>;
  activeColumnIndices: Set<number>;
  cellAccent: string;
  selectRow: (selection: Selection | null) => void;
  setHoveredRow: (selection: Selection | null) => void;
}) {
  const dimmed = kind === 'dimmed';
  const inspecting = isPinned || inHighlight;
  const bg = inspecting ? rowStates.inspectBg
    : kind === 'group' && color ? hexToRgba(color, 0.22)
    : kind === 'lit' || kind === 'nullext' ? rowStates.litBg
    : ri % 2 === 1 ? surfaces.rowAlt : TRANSPARENT;
  const leftBorder = inspecting ? accents.result
    : kind === 'group' && color ? color
    : kind === 'nullext' ? rowStates.nullBorder
    : kind === 'lit' ? rowStates.litBorder : TRANSPARENT;
  const outlined = !dimmed && (inspecting || kind !== 'neutral');

  return (
    <div
      data-table-row={rid}
      onClick={() => { if (!dimmed) selectRow({ table, rid }); }}
      onMouseEnter={() => { if (!dimmed && traceActive) setHoveredRow({ table, rid }); }}
      title={dimmed ? 'Eliminated at this stage' : 'Click to trace this row everywhere it contributes'}
      className={`col-span-full my-px grid grid-cols-subgrid rounded-sm border-l-4 transition-[background-color,opacity,border-color] duration-150 ${dimmed ? 'cursor-default' : 'cursor-pointer'}`}
      style={{
        backgroundColor: dimmed ? TRANSPARENT : bg,
        opacity: dimmed ? 0.3 : 1,
        borderLeftColor: dimmed ? TRANSPARENT : leftBorder,
        borderLeftStyle: kind === 'nullext' && !inspecting ? 'dashed' : 'solid',
        outline: outlined
          ? inspecting ? `2px solid ${accents.result}`
            : `1px ${kind === 'nullext' ? 'dashed' : 'solid'} ${hexToRgba(leftBorder, 0.65)}`
          : undefined,
        outlineOffset: inspecting ? '-2px' : '-1px',
      }}
    >
      {row.map((v, ci) => (
        <div
          key={ci}
          data-column-active={activeColumnIndices.has(ci) && !dimmed && kind !== 'neutral' || undefined}
          className={`relative whitespace-nowrap border-r border-r-[rgba(255,255,255,0.04)] px-1.5 py-[1px] last:border-r-0 ${ci === 0 ? 'pl-5' : ''} ${
            activeColumnIndices.has(ci) && !dimmed && kind !== 'neutral' ? cellAccent : ''
          } ${
            dimmed ? 'text-ink-mute line-through decoration-ink-mute/60'
              : inspecting ? 'text-ink' : pkIndices.has(ci) ? 'text-ink-dim' : 'text-ink'
          }`}
        >
          {ci === 0 && inspecting && !dimmed && (
            <CheckIcon size={11} strokeWidth={3} className="absolute left-1 top-1/2 -translate-y-1/2 text-accent-result" />
          )}
          {fmt(v)}
        </div>
      ))}
    </div>
  );
});

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
  const cellAccent = step ? STAGE_CELL_ACCENT[step.stage] : STAGE_CELL_ACCENT.from;
  const activeColumnIndices = useMemo(
    () => new Set(columns.flatMap((column, index) => activeCols.has(column) ? [index] : [])),
    [columns, activeCols]
  );

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
      className={`rounded-md border-[1.5px] bg-node font-data text-[11px] leading-tight transition-colors duration-200 ${
        isActiveTable ? 'border-accent-active' : 'border-line-strong'
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
        <span className="flex items-center gap-1.5 font-data text-[10px] text-ink-dim">
          {pkIndices.size === 0 && (
            <span
              className="rounded-full border border-dashed border-ink-mute px-1.5 py-px font-data text-[8px] font-bold leading-none tracking-wider text-ink-mute"
              title={`${table} declares no PRIMARY KEY. Rows are still traced individually by their hidden SQLite row number, but nothing stops duplicate rows.`}
            >
              NO PK
            </span>
          )}
          {rows.length} rows
        </span>
      </div>

      {/* Column headers + data rows share one grid so columns auto-size to
          their content and full attribute names are never truncated. */}
      <div
        className="grid px-1 py-0.5"
        style={{ gridTemplateColumns: `repeat(${meta.columns.length}, minmax(min-content, 1fr))` }}
        onMouseLeave={() => setHoveredRow(null)}
      >
        <div className="col-span-full grid grid-cols-subgrid border-b border-line bg-node-header/50">
          {meta.columns.map((c, ci) => (
            <div
              key={c.name}
              data-column={c.name}
              className={`relative flex items-center gap-1 whitespace-nowrap border-b-2 px-1.5 py-1 font-bold ${ci === 0 ? 'pl-6' : ''} ${
                activeCols.has(c.name) ? colAccent : 'border-b-transparent text-ink-dim'
              }`}
              title={
                c.pk
                  ? `${c.name}${c.type ? ` ${c.type}` : ''} - primary key: uniquely identifies each row in ${table} and can never be NULL${c.defaultValue !== null && c.defaultValue !== undefined ? ` - default ${c.defaultValue}` : ''}`
                  : c.fk
                    ? `${c.name}${c.type ? ` ${c.type}` : ''} - foreign key: each value points at ${c.fk.table}.${c.fk.column} - ON UPDATE ${c.fk.onUpdate ?? 'NO ACTION'}, ON DELETE ${c.fk.onDelete ?? 'NO ACTION'}`
                    : `${c.name}${c.type ? ` ${c.type}` : ''}${c.notNull ? ' - NOT NULL' : ' - NULL allowed'}${c.defaultValue !== null && c.defaultValue !== undefined ? ` - default ${c.defaultValue}` : ''}`
              }
            >
              {/* Invisible handles measure each key column's horizontal center.
                  The wire projects that center to the table's top/bottom border. */}
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
          const inHighlight = highlight?.rows[table]?.has(rid) ?? false;
          const isPinned =
            (selection?.table === table && selection.rid === rid) ||
            (highlight?.pinnedRows[table]?.has(rid) ?? false);
          return (
            <TableRow
              key={rid}
              row={row}
              ri={ri}
              rid={rid}
              table={table}
              kind={kind}
              color={color}
              inHighlight={inHighlight}
              isPinned={isPinned}
              traceActive={!!step}
              pkIndices={pkIndices}
              activeColumnIndices={activeColumnIndices}
              cellAccent={cellAccent}
              selectRow={selectRow}
              setHoveredRow={setHoveredRow}
            />
          );
        })}
      </div>
    </div>
  );
}

export const TableNode = memo(TableNodeInner);
