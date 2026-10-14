'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, useHighlight, usePinnedHighlight } from '@/store/useAppStore';
import { useMediaQuery } from '@/lib/useMediaQuery';
import type { TraceStep } from '@/lib/traceEngine';
import { rowStates, surfaces } from '@/styles/theme';
import { CheckIcon } from './Icons';
import { formatValue } from '@/lib/formatValue';
import { widestTableValues } from '@/lib/tableRowWindow';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const OVERSCAN = 8;

const ResultRow = memo(function ResultRow({ row, index, sources, highlighted, animate, virtual }: {
  row: unknown[];
  index: number;
  sources?: Record<string, number[]>;
  highlighted: boolean;
  animate: boolean;
  virtual: boolean;
}) {
  const selectRow = useAppStore((s) => s.selectRow);
  const setHoveredResultRow = useAppStore((s) => s.setHoveredResultRow);
  return (
    <tr
      aria-rowindex={virtual ? index + 2 : undefined}
      data-result-row={index}
      className={`result-data-row transition-colors duration-150 ${highlighted ? 'result-row-highlighted' : ''} ${animate ? 'result-row-enter' : ''} ${sources ? 'cursor-pointer' : ''}`}
      style={{
        backgroundColor: highlighted ? rowStates.inspectBg : index % 2 === 1 ? surfaces.rowAlt : TRANSPARENT,
        animationDelay: animate ? `${index * 20}ms` : undefined,
      }}
      onMouseEnter={() => { if (sources) setHoveredResultRow(index); }}
      onClick={() => {
        if (!sources) return;
        const entry = Object.entries(sources).find(([, rids]) => rids.length > 0);
        if (entry) selectRow({ table: entry[0], rid: entry[1][0] });
      }}
    >
      {row.map((value, ci) => (
        <td key={ci} className={`relative whitespace-nowrap border-b border-r border-line/60 border-r-[rgba(255,255,255,0.04)] px-1.5 py-0 leading-4 last:border-r-0 ${
          ci === 0 ? `border-l-4 pl-5 ${highlighted ? 'border-l-accent-result' : 'border-l-transparent'}` : ''
        } ${value === null ? 'italic text-accent-filter/70' : 'text-ink'}`}>
          {ci === 0 && highlighted && (
            <CheckIcon size={11} strokeWidth={3} className="absolute left-1 top-1/2 -translate-y-1/2 text-accent-result" />
          )}
          {formatValue(value)}
        </td>
      ))}
    </tr>
  );
});

/** Window large results without truncating data or changing provenance indices. */
export function ResultTable({ result, sources }: {
  result: NonNullable<TraceStep['partialResult']>;
  sources: TraceStep['resultRowSources'];
}) {
  const { rows, columns } = result;
  const highlight = useHighlight();
  const pinned = usePinnedHighlight();
  const firstPinned = pinned?.resultRows.values().next().value;
  const playing = useAppStore((s) => s.playing);
  const setHoveredResultRow = useAppStore((s) => s.setHoveredResultRow);
  const compact = useMediaQuery('(max-width: 639px)');
  const rowHeight = compact ? 32 : 24;
  const virtual = rows.length > 100;
  const viewport = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 32 });
  const [entering, setEntering] = useState(playing);
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let active = true;
    void document.fonts.ready.then(() => { if (active) setFontsReady(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;
    setRange({ start: 0, end: 32 });
    setEntering(useAppStore.getState().playing);
  }, [result]);

  useEffect(() => {
    if (!entering) return;
    const timer = window.setTimeout(() => setEntering(false), 440);
    return () => window.clearTimeout(timer);
  }, [entering]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || !virtual) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const first = Math.min(rows.length - 1, Math.floor(element.scrollTop / rowHeight));
      const start = Math.max(0, first - OVERSCAN);
      const end = Math.min(rows.length, first + Math.ceil(element.clientHeight / rowHeight) + OVERSCAN);
      setRange((previous) => previous.start === start && previous.end === end ? previous : { start, end });
    };
    const scheduleMeasure = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const onScroll = () => {
      setHoveredResultRow(null);
      scheduleMeasure();
    };
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(element);
    element.addEventListener('scroll', onScroll, { passive: true });
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener('scroll', onScroll);
    };
  }, [result, rows.length, rowHeight, virtual, setHoveredResultRow]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || firstPinned === undefined) return;
    const headerHeight = element.querySelector('thead')?.getBoundingClientRect().height ?? rowHeight;
    const top = headerHeight + firstPinned * rowHeight;
    if (top < element.scrollTop + headerHeight || top + rowHeight > element.scrollTop + element.clientHeight - 12) {
      // Jump once per pin/stage, without a scrolling animation or hover-driven
      // scrolling. The existing window measurement mounts the matching rows.
      element.scrollTop = firstPinned * rowHeight;
    }
  }, [result, pinned, firstPinned, rowHeight]);

  // Keep column widths stable across windows, including non-Latin fallback
  // glyphs whose pixel width cannot be predicted from string length.
  const widths = useMemo(() => {
    if (!virtual) return [];
    const context = document.createElement('canvas').getContext('2d');
    const family = getComputedStyle(document.body).getPropertyValue('--font-data');
    const font = `${compact ? 12 : 11.5}px ${family || 'ui-monospace'}, monospace`;
    if (context) context.font = `bold ${font}`;
    const headers = columns.map((column) => context?.measureText(column).width ?? column.length * 8);
    if (context) context.font = font;
    const measure = (text: string) => context?.measureText(text).width ?? text.length * 8;
    return widestTableValues(rows, columns.length, formatValue, measure).map((text, i) => Math.max(headers[i], measure(text)));
  }, [columns, rows, virtual, compact, fontsReady]);
  const start = virtual ? range.start : 0;
  const end = virtual ? Math.min(range.end, rows.length) : rows.length;
  const spacer = (height: number) => (
    <tr aria-hidden="true"><td colSpan={columns.length} style={{ height, padding: 0, border: 0 }} /></tr>
  );

  return (
    <div ref={viewport} data-result-scroll tabIndex={0} aria-label="Scrollable query results" className="min-h-0 flex-1 overflow-auto px-3 pb-3 max-sm:px-2.5" onMouseLeave={() => setHoveredResultRow(null)}>
      <table
        aria-label="Query results"
        aria-rowcount={virtual ? rows.length + 1 : undefined}
        className="w-full border-collapse font-data text-[11.5px] max-sm:min-w-max max-sm:text-xs"
        style={virtual ? { tableLayout: 'fixed', minWidth: widths.reduce((sum, width) => sum + width, 0) + columns.length * 16 + 16 } : undefined}
      >
        {virtual && <colgroup>{widths.map((width, i) => <col key={i} style={{ width: width + (i === 0 ? 32 : 16) }} />)}</colgroup>}
        <thead className="sticky top-0 z-10">
          <tr className="result-data-row" aria-rowindex={virtual ? 1 : undefined}>
            {columns.map((column, i) => <th key={i} className={`whitespace-nowrap border-b border-line-strong bg-node-header px-1.5 py-1 text-left font-bold text-ink-dim ${i === 0 ? 'pl-6' : ''}`}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {start > 0 && spacer(start * rowHeight)}
          {rows.slice(start, end).map((row, offset) => {
            const index = start + offset;
            return <ResultRow key={index} row={row} index={index} sources={sources?.[index]} highlighted={highlight?.resultRows.has(index) ?? false} animate={entering && index < 12 && !pinned?.resultRows.has(index)} virtual={virtual} />;
          })}
          {end < rows.length && spacer((rows.length - end) * rowHeight)}
        </tbody>
      </table>
    </div>
  );
}
