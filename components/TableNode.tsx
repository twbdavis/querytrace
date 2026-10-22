'use client';

import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Handle, Position, useReactFlow, useStore, type NodeProps, type Node } from '@xyflow/react';
import { useAppStore, useCurrentStep, useHighlight, type Selection } from '@/store/useAppStore';
import type { TableMeta } from '@/lib/schemas';
import { accents, rowStates, surfaces } from '@/styles/theme';
import type { Stage } from '@/lib/traceEngine';
import { CheckIcon } from './Icons';
import { ownValue } from '@/lib/records';
import { TABLE_FULL_ROWS, TABLE_ROW_HEIGHT, tableRowWindow, tableSceneRowLimit, widestTableValues } from '@/lib/tableRowWindow';
import { formatValue } from '@/lib/formatValue';
import { useSafeUpdateNodeInternals } from '@/lib/useSafeUpdateNodeInternals';

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
  modify: 'border-b-accent-result text-accent-result',
  create: 'border-b-accent-result text-accent-result',
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
  modify: 'bg-accent-result/20',
  create: 'bg-accent-result/20',
};

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
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
        height: TABLE_ROW_HEIGHT - 2,
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
          {formatValue(v)}
        </div>
      ))}
    </div>
  );
});

function TableNodeInner({ id, data }: NodeProps<TableFlowNode>) {
  const { meta, columns, rows, rids } = data;
  const updateNodeInternals = useSafeUpdateNodeInternals();
  const flow = useReactFlow<TableFlowNode>();
  const geometry = useStore((state) => {
    const node = state.nodeLookup.get(id);
    const position = node?.internals.positionAbsolute ?? { x: 0, y: 0 };
    const [tx, ty, zoom] = state.transform;
    const tables = state.nodes.flatMap((candidate) => {
      const internal = state.nodeLookup.get(candidate.id);
      const absolute = internal?.internals.positionAbsolute ?? candidate.position;
      const width = candidate.measured?.width;
      const height = candidate.measured?.height;
      // Unknown sizes participate in the initial budget, before expensive DOM measurement.
      const visible = !width || !height || (absolute.x * zoom + tx < state.width && (absolute.x + width) * zoom + tx > 0 && absolute.y * zoom + ty < state.height && (absolute.y + height) * zoom + ty > 0);
      return visible ? [{ rows: Array.isArray(candidate.data.rows) ? candidate.data.rows.length : 0, columns: Array.isArray(candidate.data.columns) ? candidate.data.columns.length : 0 }] : [];
    });
    const budget = tableSceneRowLimit(tables);
    const allTables = state.nodes.map((candidate) => ({ rows: Array.isArray(candidate.data.rows) ? candidate.data.rows.length : 0, columns: Array.isArray(candidate.data.columns) ? candidate.data.columns.length : 0 }));
    const sceneWindowed = tableSceneRowLimit(allTables).windowed;
    return [tx, ty, zoom, state.width, state.height, position.x, position.y, node?.measured.width ?? 0, budget.limit, sceneWindowed] as const;
  }, (a, b) => a.every((value, i) => value === b[i]));
  const fkEdges = useAppStore((s) => s.fkEdges);
  const step = useCurrentStep();
  const highlight = useHighlight();
  const selection = useAppStore((s) => s.selection);
  const selectRow = useAppStore((s) => s.selectRow);
  const setHoveredRow = useAppStore((s) => s.setHoveredRow);
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let active = true;
    void document.fonts.ready.then(() => { if (active) setFontsReady(true); });
    return () => { active = false; };
  }, []);

  const table = meta.name;
  const virtual = rows.length > TABLE_FULL_ROWS || geometry[9];
  const selectedIndex = selection?.table === table ? rids.indexOf(selection.rid) : undefined;
  const visibleIndices = tableRowWindow({
    count: rows.length, nodeX: geometry[5], nodeY: geometry[6], width: geometry[7], bodyOffset: 62,
    transform: [geometry[0], geometry[1], geometry[2]], viewportWidth: geometry[3], viewportHeight: geometry[4],
    pinned: selectedIndex,
    rowLimit: geometry[8], windowed: virtual,
  });
  const widthProbes = useMemo(() => {
    if (!virtual) return [];
    const context = document.createElement('canvas').getContext('2d');
    if (context) {
      const family = getComputedStyle(document.body).getPropertyValue('--font-data');
      context.font = `11px ${family || 'ui-monospace'}, monospace`;
    }
    return widestTableValues(rows, columns.length, formatValue, context ? (text) => context.measureText(text).width : undefined);
  }, [rows, columns.length, virtual, fontsReady]);
  useEffect(() => {
    if (!virtual || selectedIndex === undefined || selectedIndex < 0) return;
    const node = flow.getInternalNode(id);
    if (!node) return;
    const viewport = flow.getViewport();
    const y = node.internals.positionAbsolute.y + 62 + (selectedIndex + 0.5) * TABLE_ROW_HEIGHT;
    const key = node.internals.handleBounds?.source?.[0];
    const x = node.internals.positionAbsolute.x + (key ? key.x + key.width / 2 : Math.min((node.measured.width ?? 180) / 2, 240));
    const screenY = y * viewport.zoom + viewport.y;
    const screenX = x * viewport.zoom + viewport.x;
    if (viewport.zoom < 0.4 || screenY < 40 || screenY > geometry[4] - 160 || screenX < 40 || screenX > geometry[3] - 40) {
      void flow.setCenter(x, y, { zoom: Math.max(viewport.zoom, 0.8), duration: 0 });
    }
  }, [selection, selectedIndex, virtual, id, flow, geometry[3], geometry[4]]);
  const referencedColumns = useMemo(
    () => new Set(fkEdges.filter((edge) => edge.source === table).map((edge) => edge.sourceHandle)),
    [fkEdges, table]
  );
  useEffect(() => {
    // Columns can trade width while the table's total size stays unchanged.
    // React Flow's outer ResizeObserver cannot see that movement, so measure
    // the key handles again after the displayed table content changes.
    updateNodeInternals(id);
  }, [id, meta, columns, rows, referencedColumns, widthProbes, updateNodeInternals]);
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
    if (ownValue(step.dimmedRows, table)?.has(rid)) return { kind: 'dimmed' };
    const groupColor = ownValue(ownValue(step.groupColors, table), rid);
    if (groupColor) return { kind: 'group', color: groupColor };
    if (ownValue(step.nullExtendedRows, table)?.has(rid)) return { kind: 'nullext' };
    if (ownValue(step.litRows, table)?.has(rid)) return { kind: 'lit' };
    return { kind: 'neutral' };
  };

  const rowElements: ReactNode[] = [];
  let nextRow = 0;
  const spacer = (first: number, end: number) => (
    <div key={`gap-${first}`} aria-hidden="true" data-table-spacer className="col-span-full relative overflow-hidden" style={{ height: (end - first) * TABLE_ROW_HEIGHT }}>
      {geometry[2] < 0.5 && end - first > 20 && (
        <span className="absolute left-2 top-1/2 -translate-y-1/2 whitespace-nowrap text-ink-mute" title={`Zoom and pan to inspect rows ${first + 1}–${end}`} style={{ fontSize: 11 / geometry[2] }}>
          Zoom in
        </span>
      )}
    </div>
  );
  for (const ri of visibleIndices) {
    if (ri > nextRow) rowElements.push(spacer(nextRow, ri));
    const rid = rids[ri];
    const { kind, color } = rowState(rid);
    const inHighlight = ownValue(highlight?.rows, table)?.has(rid) ?? false;
    const isPinned = (selection?.table === table && selection.rid === rid) || (ownValue(highlight?.pinnedRows, table)?.has(rid) ?? false);
    rowElements.push(<TableRow key={rid} row={rows[ri]} ri={ri} rid={rid} table={table} kind={kind} color={color}
      inHighlight={inHighlight} isPinned={isPinned} traceActive={!!step} pkIndices={pkIndices}
      activeColumnIndices={activeColumnIndices} cellAccent={cellAccent} selectRow={selectRow} setHoveredRow={setHoveredRow} />);
    nextRow = ri + 1;
  }
  if (virtual && nextRow < rows.length) rowElements.push(spacer(nextRow, rows.length));

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
              {(c.pk || referencedColumns.has(c.name)) && (
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

        {virtual && (
          <div aria-hidden="true" className="col-span-full grid h-0 grid-cols-subgrid overflow-hidden pointer-events-none border-l-4 border-transparent">
            {widthProbes.map((text, ci) => <div key={ci} className={`whitespace-nowrap border-r border-transparent last:border-r-0 px-1.5 ${ci === 0 ? 'pl-5' : ''}`}>{text}</div>)}
          </div>
        )}
        {rowElements}
      </div>
    </div>
  );
}

export const TableNode = memo(TableNodeInner);
