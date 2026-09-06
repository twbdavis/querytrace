'use client';
import { useAppStore, useCurrentStep } from '@/store/useAppStore';
import { ResultTable } from './ResultTable';
import { StepBackIcon } from './Icons';

interface ResultPanelProps {
  onCollapse?: () => void;
}

export function ResultPanel({ onCollapse }: ResultPanelProps) {
  const step = useCurrentStep();
  const currentStep = useAppStore((s) => s.currentStep);
  const traceLength = useAppStore((s) => s.trace?.length ?? 0);
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
      {result ? (
        result.rows.length > 0 ? (
          <ResultTable key={currentStep} result={result} sources={step?.resultRowSources} />
        ) : (
          <div className="mx-3 mb-3 rounded-md border border-line bg-node/50 p-3 text-[11px] leading-relaxed text-ink-dim">
            Zero rows made it through this stage. Step back to see where they were eliminated.
          </div>
        )
      ) : (
        <div className="mx-3 mb-3 rounded-md border border-dashed border-line p-3 text-[11px] leading-relaxed text-ink-dim">
          Rows will fill in here stage by stage once a query runs.
        </div>
      )}
    </div>
  );
}
