'use client';

import { useAppStore } from '@/store/useAppStore';
import { BookIcon, DatabaseIcon, HelpIcon, RunIcon } from './Icons';

interface TopBarProps {
  onOpenSchema: () => void;
  onOpenLessons: () => void;
  onOpenHelp: () => void;
  /** Show a RUN button here while the query panel (and its own RUN) is collapsed. */
  showRun?: boolean;
}

export function TopBar({ onOpenSchema, onOpenLessons, onOpenHelp, showRun = false }: TopBarProps) {
  const dbReady = useAppStore((state) => state.dbReady);
  const runQuery = useAppStore((state) => state.runQuery);

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
        <button
          onClick={onOpenHelp}
          aria-label="Open help"
          title="Help: what QueryTrace is and how to use it"
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-line-strong bg-panel text-ink-mute transition-colors hover:border-accent-active hover:text-accent-active max-sm:h-9 max-sm:w-9"
        >
          <HelpIcon size={13} />
        </button>
      </div>
    </header>
  );
}
