'use client';

import { useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlow,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TableNode, type TableFlowNode } from './TableNode';
import { FKEdge } from './FKEdge';
import { displayRowLabel, useAppStore } from '@/store/useAppStore';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { grid } from '@/styles/theme';
import { ChevronDownIcon, CloseIcon, CrosshairIcon } from './Icons';

const nodeTypes = { table: TableNode };
const edgeTypes = { fk: FKEdge };

/** Staggered grid for schemas without a hand layout; nodes stay draggable. */
function autoPosition(i: number): { x: number; y: number } {
  const col = i % 3;
  const row = Math.floor(i / 3);
  return { x: col * 640, y: row * 460 + (col === 1 ? 230 : 0) };
}

const LEGEND: Array<{ swatch: string; name: string; desc: string }> = [
  { swatch: 'border border-accent-active/50 bg-accent-active/20', name: 'alive', desc: 'still in the pipeline' },
  { swatch: 'bg-node-header opacity-40', name: 'eliminated', desc: 'faded + struck through' },
  { swatch: 'border border-accent-group/60 bg-accent-group/20', name: 'grouped', desc: 'one color per bucket' },
  { swatch: 'border border-dashed border-accent-filter bg-accent-active/15', name: 'kept unmatched', desc: 'NULL-extended' },
];

function StateLegend() {
  // Expanded by default only where there's room to spare; a chip elsewhere.
  const [open, setOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1536px)').matches
  );
  return (
    <div className="rounded-md border border-line-strong bg-panel font-data text-[10px]">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-2.5 py-1.5 text-left font-ui text-[9px] font-bold tracking-[0.2em] text-ink-dim hover:text-ink"
      >
        ROW STATES
        <ChevronDownIcon size={10} className={`transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="space-y-1 px-2.5 pb-2">
          {LEGEND.map((item) => (
            <div key={item.name} className="flex items-center gap-2">
              <span className={`h-2.5 w-5 shrink-0 rounded-sm ${item.swatch}`} />
              <span className="text-ink-dim">
                <span className="text-ink">{item.name}</span> - {item.desc}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-0.5">
            <svg width={20} height={10} aria-hidden="true">
              <line x1={0} y1={5} x2={14} y2={5} stroke="var(--accent-active)" strokeWidth={2} />
              <path d="M13 1.5 19 5l-6 3.5Z" fill="var(--accent-active)" />
            </svg>
            <span className="text-ink-dim">
              key wire: runs from the PK column into the matching FK column; pulses during a join
            </span>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <span className="shrink-0 rounded-full border border-accent-active px-1 py-px font-data text-[8px] font-bold text-accent-active">PK</span>
            <span className="text-ink-dim">primary key (underlined) - unique identifier</span>
            <span className="shrink-0 rounded-full border border-ink-mute px-1 py-px font-data text-[8px] font-bold text-ink-mute">FK</span>
            <span className="text-ink-dim">foreign key - must match a parent PK value</span>
          </div>
        </div>
      )}
    </div>
  );
}

function TracePin() {
  const selection = useAppStore((s) => s.selection);
  const selectRow = useAppStore((s) => s.selectRow);
  return selection ? (
        <div className="panel-enter flex items-center gap-2 rounded-full border border-accent-result/60 bg-panel py-1 pl-2.5 pr-1 font-data text-[10px] text-accent-result">
          <CrosshairIcon size={11} className="text-accent-result" />
          tracing {selection.table} · {displayRowLabel(selection.table, selection.rid)}
          <button
            onClick={() => selectRow(null)}
            aria-label="Stop tracing this row"
            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-ink-dim transition-colors hover:bg-accent-result/15 hover:text-accent-result"
          >
            <CloseIcon size={10} />
          </button>
        </div>
  ) : null;
}

export function SchemaCanvas() {
  // On wide screens the floating panels cover the canvas edges, so the
  // initial fit targets the visible middle instead of the full viewport.
  const isWide = useMediaQuery('(min-width: 1024px)');
  const schema = useAppStore((s) => s.schema);
  const schemaDef = useAppStore((s) => s.schemaDef);
  const fkEdges = useAppStore((s) => s.fkEdges);
  const tableData = useAppStore((s) => s.tableData);

  const nodes = useMemo<TableFlowNode[]>(
    () =>
      schema.map((meta, i) => ({
        id: meta.name,
        type: 'table' as const,
        position: schemaDef.positions?.[meta.name] ?? autoPosition(i),
        data: {
          meta,
          columns: tableData[meta.name]?.columns ?? meta.columns.map((c) => c.name),
          rows: tableData[meta.name]?.rows ?? [],
          rids: tableData[meta.name]?.rids ?? [],
        },
      })),
    [schema, schemaDef, tableData]
  );

  const edges = useMemo<Edge[]>(
    () =>
      fkEdges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle,
        target: e.target,
        targetHandle: e.targetHandle,
        type: 'fk' as const,
      })),
    [fkEdges]
  );

  return (
    <ReactFlow
      key={`${schemaDef.id}-${schema.map((table) => table.name).join(',')}`}
      defaultNodes={nodes}
      defaultEdges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{
        // Wide screens: clear the left panel column and the playback dock.
        padding: isWide
          ? { left: '360px', right: '32px', top: '16px', bottom: '110px' }
          : { x: '16px', top: '16px', bottom: '90px' },
      }}
      minZoom={0.15}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      deleteKeyCode={null}
      panActivationKeyCode={null}
      className="!bg-canvas"
    >
      {/* Drafting paper: a fine minor grid with a fainter major grid over it. */}
      <Background
        id="grid-minor"
        variant={BackgroundVariant.Lines}
        gap={28}
        lineWidth={0.5}
        color={grid.minor}
      />
      <Background
        id="grid-major"
        variant={BackgroundVariant.Lines}
        gap={140}
        lineWidth={0.75}
        color={grid.major}
      />
      <Controls
        position="bottom-right"
        showInteractive={false}
        className="!hidden !border-line-strong !bg-panel lg:!block [&>button]:!border-line [&>button]:!bg-panel [&>button]:!fill-ink-dim [&>button:hover]:!bg-white/5"
      />
      <Panel position="top-center">
        <TracePin />
      </Panel>
      {/* Top-right: the full-height panel column owns the left edge. */}
      <Panel position="top-right" className="hidden lg:block">
        <StateLegend />
      </Panel>
    </ReactFlow>
  );
}
