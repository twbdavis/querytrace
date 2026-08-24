'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type UIEvent } from 'react';
import { useAppStore, useCurrentStep } from '@/store/useAppStore';
import { RunIcon, StepBackIcon } from './Icons';

const CodeMirrorInput = dynamic(
  () => import('./CodeMirrorInput').then((module) => module.CodeMirrorInput),
  { ssr: false }
);

interface SqlEditorProps {
  /** Skip the built-in header (the small-screen sheet provides its own RUN). */
  bare?: boolean;
  onCollapse?: () => void;
}

/**
 * The phone editor stays native for fast iOS startup, with a mirrored visual
 * layer so the active SQL clause can still be highlighted during playback.
 */
function NativeSqlInput() {
  const sql = useAppStore((s) => s.sql);
  const setSql = useAppStore((s) => s.setSql);
  const runQuery = useAppStore((s) => s.runQuery);
  const setEditorFocused = useAppStore((s) => s.setEditorFocused);
  const tracedSql = useAppStore((s) => s.tracedSql);
  const finished = useAppStore((s) => s.finished);
  const step = useCurrentStep();
  const mirrorRef = useRef<HTMLPreElement | null>(null);

  const range = step?.queryRange;
  const highlightedRange =
    range && !finished && sql === tracedSql
      ? {
          from: Math.max(0, Math.min(range.start, sql.length)),
          to: Math.max(0, Math.min(range.end, sql.length)),
        }
      : null;

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (!mirrorRef.current) return;
    mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
    mirrorRef.current.scrollLeft = event.currentTarget.scrollLeft;
  };

  return (
    <div className="relative h-full overflow-hidden bg-panel">
      <pre
        ref={mirrorRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-3.5 font-data text-base leading-[1.45] text-ink"
      >
        {highlightedRange ? (
          <>
            {sql.slice(0, highlightedRange.from)}
            <mark className="queryExecHighlight text-inherit">
              {sql.slice(highlightedRange.from, highlightedRange.to)}
            </mark>
            {sql.slice(highlightedRange.to)}
          </>
        ) : (
          sql
        )}
        {' '}
      </pre>
      <textarea
        value={sql}
        onChange={(event) => setSql(event.target.value)}
        onFocus={() => setEditorFocused(true)}
        onBlur={() => setEditorFocused(false)}
        onScroll={syncScroll}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void runQuery();
          }
        }}
        aria-label="SQL query editor"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="absolute inset-0 h-full w-full resize-none border-0 bg-transparent px-3 py-3.5 font-data text-base leading-[1.45] text-transparent caret-accent-active outline-none [-webkit-text-fill-color:transparent]"
      />
    </div>
  );
}

export function SqlEditor({ bare = false, onCollapse }: SqlEditorProps) {
  // Start with the native editor so SSR and the first paint are useful. On
  // roomier screens, progressively enhance to CodeMirror after hydration.
  const [enhancedEditor, setEnhancedEditor] = useState(false);
  const dbReady = useAppStore((s) => s.dbReady);
  const runQuery = useAppStore((s) => s.runQuery);
  const error = useAppStore((s) => s.error);

  useEffect(() => {
    const query = window.matchMedia('(min-width: 640px)');
    const sync = () => setEnhancedEditor(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {!bare && (
        <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
          <span className="font-ui text-[10px] font-bold uppercase tracking-[0.2em] text-ink-mute">
            query
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => void runQuery()}
              disabled={!dbReady}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-accent-active bg-accent-active/10 px-3 py-1 font-ui text-[11px] font-bold tracking-wider text-accent-active transition-colors hover:bg-accent-active/20 disabled:cursor-wait disabled:opacity-40"
              title="Run query (Ctrl/Cmd + Enter)"
            >
              <RunIcon size={11} />
              RUN
            </button>
            {onCollapse && (
              <button
                onClick={onCollapse}
                title="Collapse query panel"
                aria-label="Collapse query panel"
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-ink-mute transition-colors hover:bg-white/5 hover:text-ink"
              >
                <StepBackIcon size={12} />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {!enhancedEditor ? (
          <NativeSqlInput />
        ) : (
          <CodeMirrorInput />
        )}
      </div>
      {error && (
        <div
          role="alert"
          className="border-l-2 border-t border-accent-error border-t-line bg-accent-error/[0.08] px-3 py-2 font-data text-[11px] leading-relaxed text-accent-error"
        >
          {error}
        </div>
      )}
    </div>
  );
}
