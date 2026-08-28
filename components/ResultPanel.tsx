'use client';
import { useAppStore, useCurrentStep, useHighlight } from '@/store/useAppStore';
import { rowStates, surfaces } from '@/styles/theme';
import { StepBackIcon } from './Icons';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

function fmt(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' && !Number.isInteger(v)) return v.toFixed(2);
  return String(v);
}

interface ResultPanelProps {
  onCollapse?: () => void;
}

export function ResultPanel({ onCollapse }: ResultPanelProps) {
  const step = useCurrentStep();
  const currentStep = useAppStore((s) => s.currentStep);
  const traceLength = useAppStore((s) => s.trace?.length ?? 0);
  const highlight = useHighlight();
  const selectRow = useAppStore((s) => s.selectRow);
  const setHoveredResultRow = useAppStore((s) => s.setHoveredResultRow);
  const result = step?.partialResult;
  const isFinal = !!step && traceLength > 0 && currentStep === traceLength - 1;
  const interactive = !!step?.resultRowSources;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-2 max-sm:px-2.5 max-sm:pt-2.5">
        <span className="font-ui text-[10px] font-bold uppercase tracking-[0.2em] text-ink-dim">
          {isFinal ? 'result' : 'intermediate rows'}
        </span>
        <span className="flex items-center gap-1.5">
          {result && (
            <span className="font-data text-[10px] tabular-nums text-ink-mute">
              {result.rows.length} {result.rows.length === 1 ? 'row' : 'rows'}
            </span>
          )}
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Collapse result panel"
              aria-label="Collapse result panel"
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-ink-mute transition-colors hover:bg-white/5 hover:text-ink"
            >
              <StepBackIcon size={12} />
            </button>
          )}
        </span>
      </div>
      {interactive && (
        <p className="px-3 pb-1 text-[10px] leading-snug text-ink-mute max-sm:px-2.5">
          <span className="sm:hidden">Tap a row to light up and pin its source rows in the tables.</span>
          <span className="hidden sm:inline">
            Hover a row to light up its source rows in the tables; click to pin the trace.
          </span>
        </p>
      )}
      <div
        className="min-h-0 flex-1 overflow-auto px-3 pb-3 max-sm:px-2.5"
        onMouseLeave={() => setHoveredResultRow(null)}
      >
        {result ? (
          result.rows.length > 0 ? (
            <table className="w-full border-collapse font-data text-[11.5px] max-sm:min-w-max max-sm:text-xs">
              <thead className="sticky top-0 z-10">
                <tr>
                  {result.columns.map((c, i) => (
                    <th
                      key={i}
                      className="whitespace-nowrap border-b border-line-strong bg-node-header px-1.5 py-1 text-left font-bold text-ink-dim max-sm:py-1.5"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, ri) => {
                  const sources = step?.resultRowSources?.[ri];
                  const highlighted = highlight?.resultRows.has(ri) ?? false;
                  const zebra = ri % 2 === 1 ? surfaces.rowAlt : TRANSPARENT;
                  return (
                    <tr
                      key={`${currentStep}-${ri}`}
                      className={`result-row-enter transition-colors duration-200 ${sources ? 'cursor-pointer' : ''}`}
                      style={{
                        backgroundColor: highlighted ? rowStates.inspectBg : zebra,
                        animationDelay: `${Math.min(ri * 40, 800)}ms`,
                      }}
                      onMouseEnter={() => {
                        if (sources) setHoveredResultRow(ri);
                      }}
                      onClick={() => {
                        // Clicking pins the trace to this row's first contributing source.
                        if (!sources) return;
                        const entry = Object.entries(sources).find(([, rids]) => rids.length > 0);
                        if (entry) selectRow({ table: entry[0], rid: entry[1][0] });
                      }}
                    >
                      {row.map((v, ci) => (
                        <td
                          key={ci}
                          className={`whitespace-nowrap border-b border-r border-line/60 border-r-[rgba(255,255,255,0.04)] px-1.5 py-0.5 last:border-r-0 max-sm:py-1.5 ${
                            ci === 0 ? 'border-l-2' : ''
                          } ${
                            ci === 0 && highlighted ? 'border-l-accent-result' : ci === 0 ? 'border-l-transparent' : ''
                          } ${v === null ? 'italic text-accent-filter/70' : 'text-ink'}`}
                        >
                          {fmt(v)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="rounded-md border border-line bg-node/50 p-3 text-[11px] leading-relaxed text-ink-dim">
              Zero rows made it through this stage. Step back to see where they were eliminated.
            </div>
          )
        ) : (
          <div className="rounded-md border border-dashed border-line p-3 text-[11px] leading-relaxed text-ink-dim">
            Rows will fill in here stage by stage once a query runs.
          </div>
        )}
      </div>
    </div>
  );
}
