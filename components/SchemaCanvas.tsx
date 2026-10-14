'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type Edge,
  type FitViewOptions,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TableNode, type TableFlowNode } from './TableNode';
import { FKEdge } from './FKEdge';
import { displayRowLabel, useAppStore } from '@/store/useAppStore';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { grid } from '@/styles/theme';
import { ownValue } from '@/lib/records';
import { formatValue } from '@/lib/formatValue';
import { ChevronDownIcon, CloseIcon, CrosshairIcon } from './Icons';
import { packSchemaTables, separateSchemaTables } from '@/lib/schemaLayout';
import { KeyRoutesReadyContext } from '@/lib/useKeyRoutes';

const nodeTypes = { table: TableNode };
const edgeTypes = { fk: FKEdge };

const LEGEND: Array<{ swatch: string; name: string; desc: string }> = [
  { swatch: 'border border-l-4 border-accent-active/65 bg-accent-active/30', name: 'alive', desc: 'still in the pipeline' },
  { swatch: 'border-2 border-l-4 border-accent-result bg-accent-result/30', name: 'highlighted', desc: 'checkmark + mint outline trace a row’s contributions' },
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
              key wire: square at the referenced key, arrow into the FK; enters at the column’s top or bottom
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

/**
 * React Flow is uncontrolled here (defaultNodes keeps the user's drag
 * positions), so refreshed table rows (a data change, or a "before" snapshot
 * while scrubbing a data-changing trace) are pushed into the flow's own state.
 */
function CanvasSync({ nodes, edges, handLayout, fitOptions, onReady }: {
  nodes: TableFlowNode[];
  edges: Edge[];
  handLayout: boolean;
  fitOptions: FitViewOptions<TableFlowNode>;
  onReady: () => void;
}) {
  const { getNodes, setNodes, setEdges, fitView } = useReactFlow<TableFlowNode>();
  const initialized = useNodesInitialized();
  // Only geometry changes run the layout. Hovering, playback and dragging do
  // not disturb positions or the viewport.
  const sizes = useStore((state) => JSON.stringify(state.nodes.map((node) =>
    [node.id, node.measured?.width, node.measured?.height])));
  const laidOut = useRef(false);
  const needsFit = useRef(true);
  // Reserve the largest displayed size so scrubbing a mutation's before/after
  // snapshots cannot repeatedly shuffle the same cards back and forth.
  const reservedSizes = useRef(new Map<string, { width: number; height: number }>());
  useEffect(() => {
    setNodes((current) => {
      const nextById = new Map(nodes.map((node) => [node.id, node]));
      const existingIds = new Set(current.map((node) => node.id));
      // Place established cards first, regardless of where a CREATE name sorts
      // in the database metadata; the new card finds space around them.
      return [
        ...current.filter((node) => nextById.has(node.id)).map((node) => ({ ...node, data: nextById.get(node.id)!.data })),
        ...nodes.filter((node) => !existingIds.has(node.id)).map((node) => ({ ...node, style: { ...node.style, opacity: 0 } })),
      ];
    });
  }, [nodes, setNodes]);
  useEffect(() => { setEdges(edges); }, [edges, setEdges]);

  useEffect(() => {
    if (!initialized) return;
    const current = getNodes();
    if (current.length !== nodes.length || current.some((node) => !node.measured?.width || !node.measured?.height)) return;
    const boxes = current.map((node) => {
      const previous = reservedSizes.current.get(node.id);
      if (!previous) needsFit.current = true;
      const size = {
        width: Math.max(previous?.width ?? 0, node.measured!.width!),
        height: Math.max(previous?.height ?? 0, node.measured!.height!),
      };
      if (previous && (size.width > previous.width || size.height > previous.height)) needsFit.current = true;
      reservedSizes.current.set(node.id, size);
      return { id: node.id, position: node.position, ...size };
    });
    const layout = !laidOut.current && !handLayout
      ? packSchemaTables(boxes)
      : separateSchemaTables(boxes);
    laidOut.current = true;
    const positions = new Map(layout.map((box) => [box.id, box.position]));
    if (current.some((node) => {
      const next = positions.get(node.id)!;
      return next.x !== node.position.x || next.y !== node.position.y || node.style?.opacity === 0;
    })) {
      needsFit.current = true;
      setNodes((items) => items.map((node) => ({
        ...node,
        position: positions.get(node.id) ?? node.position,
        style: node.style?.opacity === 0 ? { ...node.style, opacity: 1 } : node.style,
      })));
    }
    if (!needsFit.current) return;
    let cancelled = false;
    // Allow React Flow to apply the new positions before fitting the viewport.
    const frame = requestAnimationFrame(() => {
      void fitView(fitOptions).then(() => {
        if (cancelled) return;
        needsFit.current = false;
        onReady();
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [sizes, initialized, nodes.length, handLayout, fitOptions, getNodes, setNodes, fitView, onReady]);
  return null;
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

export const SchemaCanvas = memo(function SchemaCanvas() {
  // On wide screens the floating panels cover the canvas edges, so the
  // initial fit targets the visible middle instead of the full viewport.
  const isWide = useMediaQuery('(min-width: 1024px)');
  const schema = useAppStore((s) => s.schema);
  const schemaDef = useAppStore((s) => s.schemaDef);
  const schemaRevision = useAppStore((s) => s.schemaRevision);
  const fkEdges = useAppStore((s) => s.fkEdges);
  const liveTableData = useAppStore((s) => s.tableData);
  // A data-changing statement's early stages show the tables as they were
  // before it ran. The selector is stable (undefined) for every other trace.
  const snapshots = useAppStore((s) => s.trace?.[s.currentStep]?.tableSnapshots);
  const [readyRevision, setReadyRevision] = useState(-1);
  const onReady = useCallback(() => setReadyRevision(schemaRevision), [schemaRevision]);
  const fitOptions = useMemo<FitViewOptions<TableFlowNode>>(() => ({
    minZoom: 0.02,
    // Keep the row-tracing chip clear of the first table, including on phones.
    padding: isWide
      ? { left: '360px', right: '32px', top: '56px', bottom: '110px' }
      : { x: '16px', top: '56px', bottom: '90px' },
  }), [isWide]);

  const nodes = useMemo<TableFlowNode[]>(
    () => {
      const initial = schema.map((meta) => {
        const tableData = ownValue(snapshots, meta.name) ?? ownValue(liveTableData, meta.name);
        return {
          id: meta.name,
          type: 'table' as const,
          position: ownValue(schemaDef.positions, meta.name) ?? { x: 0, y: 0 },
          data: {
            meta,
            columns: tableData?.columns ?? meta.columns.map((c) => c.name),
            rows: tableData?.rows ?? [],
            rids: tableData?.rids ?? [],
          },
        };
      });
      // These estimates are only for the hidden measurement pass. The browser's
      // actual card bounds determine the visible layout, including loaded fonts.
      const boxes = initial.map((node) => ({
        id: node.id, position: node.position,
        width: Math.max(180, node.data.meta.columns.reduce((sum, column, i) => {
          const chars = Math.max(column.name.length + (column.type?.length ?? 0),
            ...node.data.rows.map((row) => formatValue(row[i]).length));
          return sum + chars * 8 + 48;
        }, 0)),
        height: 64 + node.data.rows.length * 18,
      }));
      const layout = schemaDef.positions ? separateSchemaTables(boxes) : packSchemaTables(boxes);
      return initial.map((node, i) => ({
        ...node, position: ownValue(schemaDef.positions, node.id) ?? layout[i].position,
      }));
    },
    [schema, schemaDef, liveTableData, snapshots]
  );

  const edges = useMemo<Edge[]>(
    () => {
      const sourceLanes = new Map<string, number>();
      const targetLanes = new Map<string, number>();
      return fkEdges.map((e) => {
        const sourceLane = sourceLanes.get(e.source) ?? 0;
        const targetLane = targetLanes.get(e.target) ?? 0;
        sourceLanes.set(e.source, sourceLane + 1);
        targetLanes.set(e.target, targetLane + 1);
        return {
          id: e.id,
          source: e.source,
          sourceHandle: e.sourceHandle,
          target: e.target,
          targetHandle: e.targetHandle,
          type: 'fk' as const,
          data: { lane: Math.max(sourceLane, targetLane) },
          ariaLabel: `${e.source}.${e.sourceHandle} referenced key to ${e.target}.${e.targetHandle} foreign key`,
        };
      });
    },
    [fkEdges]
  );

  return (
    <KeyRoutesReadyContext.Provider value={readyRevision === schemaRevision}>
    <ReactFlow
      key={`${schemaDef.id}-${schemaRevision}`}
      defaultNodes={nodes}
      defaultEdges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitViewOptions={fitOptions}
      minZoom={0.02}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      deleteKeyCode={null}
      panActivationKeyCode={null}
      className={`!bg-canvas ${readyRevision === schemaRevision ? '' : '[&_.react-flow__nodes]:opacity-0 [&_.react-flow__edges]:opacity-0'}`}
      data-layout-ready={readyRevision === schemaRevision}
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
      <CanvasSync nodes={nodes} edges={edges} handLayout={!!schemaDef.positions} fitOptions={fitOptions} onReady={onReady} />
      <Panel position="top-center">
        <TracePin />
      </Panel>
      {/* Top-right: the full-height panel column owns the left edge. */}
      <Panel position="top-right" className="hidden lg:block">
        <StateLegend />
      </Panel>
    </ReactFlow>
    </KeyRoutesReadyContext.Provider>
  );
});
