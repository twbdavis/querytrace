'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAppStore, useCurrentStep } from '@/store/useAppStore';
import { ChevronDownIcon, RunIcon, TableIcon, TerminalIcon } from './Icons';

interface BottomSheetProps {
  editor: ReactNode;
  results: ReactNode;
}

/**
 * Small-screen UI: the canvas keeps the whole viewport and the editor and
 * results share a sheet along the bottom edge, stacked so the clause
 * highlighting in the query stays visible while its rows arrive right below.
 * Phones keep both panes open; larger compact layouts can still collapse the
 * combined sheet to hand more room back to the schema.
 */
export function BottomSheet({ editor, results }: BottomSheetProps) {
  const [open, setOpen] = useState(true);
  const dbReady = useAppStore((s) => s.dbReady);
  const runQuery = useAppStore((s) => s.runQuery);
  const tracedSql = useAppStore((s) => s.tracedSql);
  const step = useCurrentStep();
  const rowCount = step?.partialResult?.rows.length ?? null;

  // A fresh run means the user wants to watch rows arrive: raise the sheet.
  const prevTraced = useRef<string | null>(null);
  useEffect(() => {
    if (tracedSql && tracedSql !== prevTraced.current) {
      setOpen(true);
    }
    prevTraced.current = tracedSql;
  }, [tracedSql]);

  return (
    <div className="flex shrink-0 flex-col border-t border-line-strong bg-panel max-sm:pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center gap-2 px-2.5 py-1.5 max-sm:min-h-12 max-sm:gap-1 max-sm:px-2 max-sm:py-1">
        <div
          aria-label="Query and intermediate results are shown together"
          className="flex h-9 items-center overflow-hidden rounded-md border border-line bg-node/40 font-ui text-[10px] font-bold tracking-wider"
        >
          <span className="flex h-full items-center gap-1.5 px-2 text-accent-active">
            <TerminalIcon size={11} />
            QUERY
          </span>
          <span aria-hidden="true" className="text-ink-mute">
            +
          </span>
          <span className="flex h-full items-center gap-1.5 px-2 text-ink-dim">
            <TableIcon size={11} />
            RESULTS
            {rowCount !== null && (
              <span className="rounded-full bg-node px-1.5 font-data text-[9px] tabular-nums text-ink-dim">
                {rowCount}
              </span>
            )}
          </span>
        </div>

        <div className="flex-1" />

        <button
          onClick={() => {
            setOpen(true);
            void runQuery();
          }}
          disabled={!dbReady}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-accent-active bg-accent-active/10 px-2.5 py-1 font-ui text-[10px] font-bold tracking-wider text-accent-active transition-colors hover:bg-accent-active/20 max-sm:h-9 max-sm:px-2"
          title="Run query (Ctrl/Cmd + Enter)"
        >
          <RunIcon size={10} />
          RUN
        </button>
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? 'Collapse panel' : 'Expand panel'}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-ink-mute transition-colors hover:bg-white/5 hover:text-ink-dim max-sm:hidden"
        >
          <ChevronDownIcon size={12} className={`transition-transform duration-200 ${open ? '' : 'rotate-180'}`} />
        </button>
      </div>

      <div
        className={`overflow-hidden transition-[height] duration-200 ${
          open ? 'h-[52dvh] sm:h-[46dvh]' : 'h-[52dvh] sm:h-0'
        }`}
      >
        <div className="relative flex h-full flex-col">
          {/* Query on top, kept short: the point is watching its clauses light
              up, so a few visible lines (scrollable) are enough. */}
          <div className="flex h-[38%] min-h-[112px] max-h-[180px] shrink-0 flex-col border-b border-line sm:min-h-[96px]">
            {editor}
          </div>
          {/* Rows arrive here, in view at the same time as the highlight. */}
          <div className="flex min-h-0 flex-1 flex-col">
            {results}
          </div>
        </div>
      </div>
    </div>
  );
}
