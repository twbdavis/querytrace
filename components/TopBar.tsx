'use client';

import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { BookIcon, DatabaseIcon, HelpIcon, RunIcon } from './Icons';

interface TopBarProps {
  onOpenSchema: () => void;
  onOpenLessons: () => void;
  /** Show a RUN button here while the query panel (and its own RUN) is collapsed. */
  showRun?: boolean;
}

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl + ↵', 'Run the query'],
  ['Space', 'Play / pause the trace'],
  ['← →', 'Step through stages'],
  ['R', 'Reset to the first stage'],
];

const TIPS = [
  'Point to a row in a table or in the results to light up where it came from; click or tap to pin the trace.',
  'Drag tables to rearrange the schema; pinch or scroll to zoom the canvas.',
  'On larger screens, collapse the query and result panels to give the schema more room.',
];

export function TopBar({ onOpenSchema, onOpenLessons, showRun = false }: TopBarProps) {
  const dbReady = useAppStore((state) => state.dbReady);
  const runQuery = useAppStore((state) => state.runQuery);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!helpOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!helpRef.current?.contains(e.target as Node)) setHelpOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHelpOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [helpOpen]);

  const chromeBtn =
    'inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1 font-ui text-[10px] font-bold tracking-wider text-ink transition-colors hover:border-accent-active hover:text-accent-active disabled:cursor-wait disabled:opacity-40 max-sm:h-9 max-sm:w-9 max-sm:justify-center max-sm:p-0';

  return (
    <header className="relative z-40 flex h-10 shrink-0 items-center justify-between border-b border-line bg-app px-3 max-sm:h-12 max-sm:pr-2">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="shrink-0 font-ui text-sm font-bold tracking-[0.2em] text-ink">
          QUERY<span className="text-accent-active">TRACE</span>
        </h1>
      </div>

      <div className="flex shrink-0 items-center gap-2 max-sm:gap-1.5">
        {showRun && (
          <button
            disabled={!dbReady}
            onClick={() => void runQuery()}
            className="panel-enter inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-accent-active bg-accent-active/10 px-2.5 py-1 font-ui text-[10px] font-bold tracking-wider text-accent-active transition-colors hover:bg-accent-active/20 disabled:cursor-wait disabled:opacity-40"
            aria-label="Run query"
            title="Run query (Ctrl/Cmd + Enter)"
          >
            <RunIcon size={11} />
            RUN
          </button>
        )}
        <button disabled={!dbReady} onClick={onOpenSchema} className={chromeBtn} aria-label="Open schema settings" title="Schema">
          <DatabaseIcon size={11} />
          <span className="hidden sm:inline">SCHEMA</span>
        </button>
        <button disabled={!dbReady} onClick={onOpenLessons} className={chromeBtn} aria-label="Open lessons" title="Lessons">
          <BookIcon size={11} />
          <span className="hidden sm:inline">LESSONS</span>
        </button>

        <div ref={helpRef} className="relative">
          <button
            onClick={() => setHelpOpen(!helpOpen)}
            aria-expanded={helpOpen}
            aria-label="Keyboard shortcuts and tips"
            title="Shortcuts & tips"
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border transition-colors max-sm:h-9 max-sm:w-9 ${
              helpOpen
                ? 'border-accent-active bg-accent-active/10 text-accent-active'
                : 'border-line-strong bg-panel text-ink-mute hover:border-accent-active hover:text-accent-active'
            }`}
          >
            <HelpIcon size={13} />
          </button>

          {helpOpen && (
            <div className="absolute right-0 top-full mt-2 w-72 rounded-md border border-line-strong bg-panel p-3 max-sm:fixed max-sm:inset-x-2 max-sm:top-12 max-sm:mt-2 max-sm:w-auto">
              <div className="mb-2 font-ui text-[9px] font-bold uppercase tracking-[0.25em] text-ink-mute max-sm:hidden">
                keyboard
              </div>
              <dl className="mb-3 space-y-1.5 max-sm:hidden">
                {SHORTCUTS.map(([keys, what]) => (
                  <div key={what} className="flex items-center justify-between gap-3">
                    <dt>
                      <kbd>{keys}</kbd>
                    </dt>
                    <dd className="text-[10px] text-ink-dim">{what}</dd>
                  </div>
                ))}
              </dl>
              <div className="mb-1.5 font-ui text-[9px] font-bold uppercase tracking-[0.25em] text-ink-mute">
                tips
              </div>
              <ul className="space-y-1.5 text-[10px] leading-relaxed text-ink-dim">
                {TIPS.map((tip) => (
                  <li key={tip} className="flex gap-1.5">
                    <span className="text-accent-active">·</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
