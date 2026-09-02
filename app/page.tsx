'use client';

import { useEffect, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useAppStore, useCurrentStep } from '@/store/useAppStore';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { TopBar } from '@/components/TopBar';
import { PlaybackDock } from '@/components/PlaybackDock';
import { BottomSheet } from '@/components/BottomSheet';
import { ResultPanel } from '@/components/ResultPanel';
import { SqlEditor } from '@/components/SqlEditor';
import { LessonsModal } from '@/components/LessonsModal';
import { SchemaModal } from '@/components/SchemaModal';
import { TableIcon, TerminalIcon } from '@/components/Icons';

// React Flow is browser-only; skip SSR entirely.
const SchemaCanvas = dynamic(
  () => import('@/components/SchemaCanvas').then((m) => m.SchemaCanvas),
  { ssr: false, loading: () => <PanelLoading label="loading canvas" /> }
);

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center font-data text-[11px] text-ink-mute">
      {label}…
    </div>
  );
}

/** Slim rail on the left screen edge that re-opens the collapsed panel column. */
function EdgeTab({
  offsetClass,
  label,
  badge,
  icon,
  onClick,
}: {
  offsetClass: string;
  label: string;
  badge?: number;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={`Show ${label.toLowerCase()} panel`}
      className={`absolute left-0 z-20 flex cursor-pointer flex-col items-center gap-1.5 rounded-r-md border border-l-0 border-line-strong bg-panel px-1.5 py-2.5 text-ink-dim transition-colors hover:border-accent-active hover:text-accent-active ${offsetClass}`}
    >
      {icon}
      <span
        className="font-ui text-[9px] font-bold tracking-[0.2em]"
        style={{ writingMode: 'vertical-rl' }}
      >
        {label}
      </span>
      {badge !== undefined && (
        <span className="rounded bg-accent-active/15 px-1 py-0.5 font-data text-[8px] tabular-nums text-accent-active">
          {badge}
        </span>
      )}
    </button>
  );
}

/** Slim horizontal strip inside the panel column that restores a collapsed panel. */
function RestoreBar({
  label,
  badge,
  icon,
  onClick,
}: {
  label: string;
  badge?: number;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={`Show ${label.toLowerCase()} panel`}
      className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-panel px-3 text-ink-dim transition-colors hover:border-accent-active hover:text-accent-active"
    >
      {icon}
      <span className="font-ui text-[9px] font-bold tracking-[0.2em]">{label}</span>
      {badge !== undefined && (
        <span className="ml-auto rounded bg-accent-active/15 px-1.5 py-0.5 font-data text-[9px] tabular-nums text-accent-active">
          {badge}
        </span>
      )}
    </button>
  );
}

const panelShell = 'flex flex-col overflow-hidden rounded-md border border-line-strong bg-panel';

export default function Home() {
  const dbReady = useAppStore((s) => s.dbReady);
  const dbError = useAppStore((s) => s.dbError);
  const init = useAppStore((s) => s.init);
  const step = useCurrentStep();
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [queryOpen, setQueryOpen] = useState(true);
  const [resultsOpen, setResultsOpen] = useState(true);
  // Two UIs: a floating left column (query stacked over results) beside a
  // full-bleed canvas (laptop and up), or a full-screen canvas with a stacked
  // bottom sheet (anything narrower). Query and results are always visible
  // together so the clause highlighting can be read against the arriving rows.
  const isWide = useMediaQuery('(min-width: 1024px)');
  const columnOpen = queryOpen || resultsOpen;

  useEffect(() => {
    // Let the shell/editor paint before compiling SQLite WASM. This keeps the
    // app responsive on slower mobile Safari CPUs without delaying the data.
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => void init());
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [init]);

  if (dbError) {
    return (
      <main className="flex h-[100dvh] items-center justify-center sm:h-screen">
        <div className="max-w-md rounded-md border-l-2 border border-accent-error/40 border-l-accent-error bg-accent-error/[0.08] p-6 font-data text-sm text-accent-error">
          <div className="mb-2 font-bold">The in-browser database could not start</div>
          <p className="mb-3">{dbError}</p>
          <p className="text-[11px] text-accent-error/70">Reload the page to try again.</p>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="flex h-[100dvh] flex-col overflow-hidden sm:h-screen">
        <TopBar
          onOpenSchema={() => setSchemaOpen(true)}
          onOpenLessons={() => setLessonsOpen(true)}
          // The query panel carries its own RUN; offer one up here while it is collapsed.
          showRun={isWide && !queryOpen}
        />

        <div className="relative min-h-0 flex-1">
          {!dbReady && (
            <div
              role="status"
              className="pointer-events-none absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line-strong bg-panel px-3 py-1.5 font-ui text-[9px] font-bold tracking-[0.18em] text-ink-dim"
            >
              <span className="h-2.5 w-2.5 animate-spin rounded-full border border-line-strong border-t-accent-active" />
              STARTING SQLITE
            </div>
          )}
          {/* The schema owns the entire viewport; everything else floats. */}
          <div className="absolute inset-0">
            <SchemaCanvas />
          </div>

          {isWide && (
            <>
              {columnOpen && (
                <div
                  key="panel-column"
                  className="panel-enter absolute bottom-2 left-2 top-2 z-20 flex w-[19rem] flex-col gap-2 xl:bottom-3 xl:left-3 xl:top-3 xl:w-[21rem] 2xl:w-[24rem]"
                >
                  {queryOpen ? (
                    <section
                      aria-label="SQL editor panel"
                      className={`${panelShell} ${
                        resultsOpen ? 'h-[42%] max-h-[420px] min-h-[200px]' : 'min-h-0 flex-1'
                      }`}
                    >
                      <SqlEditor onCollapse={() => setQueryOpen(false)} />
                    </section>
                  ) : (
                    <RestoreBar
                      label="QUERY"
                      icon={<TerminalIcon size={12} />}
                      onClick={() => setQueryOpen(true)}
                    />
                  )}
                  {resultsOpen ? (
                    <section aria-label="Results panel" className={`${panelShell} min-h-0 flex-1`}>
                      <ResultPanel onCollapse={() => setResultsOpen(false)} />
                    </section>
                  ) : (
                    <RestoreBar
                      label="RESULTS"
                      badge={step?.partialResult?.rows.length}
                      icon={<TableIcon size={12} />}
                      onClick={() => setResultsOpen(true)}
                    />
                  )}
                </div>
              )}
              {!columnOpen && (
                <EdgeTab
                  key="editor-tab"
                  offsetClass="top-4"
                  label="QUERY"
                  icon={<TerminalIcon size={13} />}
                  onClick={() => setQueryOpen(true)}
                />
              )}
              {!columnOpen && (
                <EdgeTab
                  key="results-tab"
                  offsetClass="top-36"
                  label="RESULTS"
                  badge={step?.partialResult?.rows.length}
                  icon={<TableIcon size={13} />}
                  onClick={() => setResultsOpen(true)}
                />
              )}
            </>
          )}

          {/* Keep the dock centered in the canvas area left free by the column. */}
          <PlaybackDock
            leftClass={
              isWide && columnOpen ? 'left-[20rem] xl:left-[22.5rem] 2xl:left-[25.5rem]' : 'left-0'
            }
          />
        </div>

        {!isWide && <BottomSheet editor={<SqlEditor bare />} results={<ResultPanel />} />}

        <LessonsModal open={lessonsOpen} onClose={() => setLessonsOpen(false)} />
        <SchemaModal open={schemaOpen} onClose={() => setSchemaOpen(false)} />
      </main>
    </>
  );
}
