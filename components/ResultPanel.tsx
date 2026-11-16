'use client';
import { useAppStore, useCurrentStep, useHighlight, usePinnedHighlight } from '@/store/useAppStore';
import { EXPLANATION_LABELS } from '@/lib/queryCompatibility';
import { ResultTable } from './ResultTable';
import { StepBackIcon } from './Icons';

interface ResultPanelProps {
  onCollapse?: () => void;
}

export function ResultPanel({ onCollapse }: ResultPanelProps) {
  const step = useCurrentStep();
  const highlight = useHighlight();
  const pinned = usePinnedHighlight();
  const currentStep = useAppStore((s) => s.currentStep);
  const traceLength = useAppStore((s) => s.trace?.length ?? 0);
  const coverage = useAppStore((s) => s.coverage);
  const result = step?.partialResult;
  const isFinal = !!step && traceLength > 0 && currentStep === traceLength - 1;
  const interactive = !!step?.resultRowSources;
  const coverageTitle = coverage
    ? [
        coverage.explanation === 'detailed'
          ? 'Every stage is shown and each result row maps back to its source rows.'
          : coverage.explanation === 'components'
            ? 'Component results are shown before the final result; result rows are not traced to source rows.'
            : 'Only the result is shown for this statement.',
        ...coverage.limits,
      ].join(' ')
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-2 max-sm:px-2.5 max-sm:pt-2.5">
        <span className="flex items-center gap-1.5">
          <span className="font-ui text-[10px] font-bold uppercase tracking-[0.2em] text-ink-dim">
            {isFinal ? 'result' : 'intermediate rows'}
          </span>
          {/* The live region stays mounted so a label that appears after a run is announced. */}
          <span role="status" className="contents">
            {coverage && step && (
              <span
                title={coverageTitle}
                className={`rounded border px-1.5 py-0.5 font-ui text-[9px] font-bold uppercase tracking-[0.12em] ${
                  coverage.explanation === 'detailed'
                    ? 'border-accent-result/50 text-accent-result'
                    : 'border-line text-ink-mute'
                }`}
              >
                <span className="sr-only">Explanation: </span>
                {EXPLANATION_LABELS[coverage.explanation]}
                <span className="sr-only">. {coverageTitle}</span>
              </span>
            )}
          </span>
        </span>
        <span className="flex min-h-6 items-center gap-1.5">
          {!!highlight?.resultRows.size && (
            <span className="rounded border border-accent-result/60 bg-accent-result/15 px-1.5 py-0.5 font-data text-[10px] tabular-nums text-accent-result">
              {highlight.resultRows.size} highlighted
            </span>
          )}
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
      {!interactive && coverage && step && coverage.explanation !== 'detailed' && isFinal && (
        <p className="px-3 pb-1 text-[10px] leading-snug text-ink-mute max-sm:px-2.5">
          {coverage.explanation === 'components'
            ? 'This result is executed directly by SQLite after its component previews; rows are not traced back to the tables.'
            : 'This statement shows its result without a row-by-row trace.'}
        </p>
      )}
      {pinned && pinned.resultRows.size === 0 && (
        <p role="status" className="px-3 pb-2 text-[10px] leading-snug text-ink-dim max-sm:px-2.5">
          {interactive ? 'The pinned row does not contribute to this stage’s results.' : 'Row tracing is unavailable for this stage.'}
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
