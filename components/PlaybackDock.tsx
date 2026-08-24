'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { useAppStore, useCurrentStep, type Speed } from '@/store/useAppStore';
import {
  ColumnsIcon,
  DatabaseIcon,
  FilterIcon,
  GroupIcon,
  HavingIcon,
  InfoIcon,
  JoinIcon,
  PauseIcon,
  PlayIcon,
  ResetIcon,
  SortIcon,
  StepBackIcon,
  StepForwardIcon,
} from './Icons';

const STAGE_META: Record<string, { short: string; Icon: ComponentType<{ size?: number }> }> = {
  from: { short: 'FROM', Icon: DatabaseIcon },
  join: { short: 'JOIN', Icon: JoinIcon },
  where: { short: 'WHERE', Icon: FilterIcon },
  groupBy: { short: 'GROUP', Icon: GroupIcon },
  having: { short: 'HAVING', Icon: HavingIcon },
  subquery: { short: 'INNER', Icon: DatabaseIcon },
  union: { short: 'UNION', Icon: JoinIcon },
  select: { short: 'SELECT', Icon: ColumnsIcon },
  orderLimit: { short: 'ORDER', Icon: SortIcon },
};

/** Narration stage badge, tinted by the stage's role accent. */
const STAGE_BADGE: Record<string, string> = {
  from: 'border-accent-active text-accent-active',
  join: 'border-accent-active text-accent-active',
  where: 'border-accent-filter text-accent-filter',
  having: 'border-accent-filter text-accent-filter',
  groupBy: 'border-accent-group text-accent-group',
  subquery: 'border-accent-group text-accent-group',
  union: 'border-accent-result text-accent-result',
  select: 'border-accent-result text-accent-result',
  orderLimit: 'border-line-strong text-ink-dim',
};

const SPEEDS: Speed[] = [0.5, 1, 2];

/** True when a key event originates inside the SQL editor or another input. */
function fromTextInput(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.isContentEditable ||
    t.closest('.cm-editor') !== null
  );
}

interface PlaybackDockProps {
  /** Left inset so the dock centers within the canvas beside the panel column. */
  leftClass?: string;
}

/**
 * Floating transport + pipeline dock. Hovers over the canvas bottom-center so
 * the schema keeps the full viewport; collapses gracefully on narrow screens
 * (stage labels, speed and counter drop away, chips scroll horizontally).
 */
export function PlaybackDock({ leftClass = 'left-0' }: PlaybackDockProps) {
  const trace = useAppStore((s) => s.trace);
  const currentStep = useAppStore((s) => s.currentStep);
  const playing = useAppStore((s) => s.playing);
  const speed = useAppStore((s) => s.speed);
  const { play, pause, stepForward, stepBack, reset, gotoStep, setSpeed } = useAppStore();
  const step = useCurrentStep();
  const [explain, setExplain] = useState(true);

  // Advance the step index on a timer while playing.
  useEffect(() => {
    if (!playing || !trace) return;
    const interval = setInterval(() => {
      const s = useAppStore.getState();
      if (!s.trace) return;
      if (s.currentStep >= s.trace.length - 1) {
        // Auto-play ran to the end: stop and clear the query-text highlight.
        useAppStore.setState({ playing: false, finished: true });
      } else {
        useAppStore.setState({ currentStep: s.currentStep + 1 });
      }
    }, 2000 / speed);
    return () => clearInterval(interval);
  }, [playing, speed, trace]);

  // Transport keyboard shortcuts (ignored while typing SQL).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (fromTextInput(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useAppStore.getState();
      if (s.editorFocused || !s.trace) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          s.playing ? s.pause() : s.play();
          break;
        case 'ArrowRight':
          e.preventDefault();
          s.stepForward();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          s.stepBack();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          s.reset();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const disabled = !trace;
  const btn =
    'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line-strong bg-panel text-ink-dim transition-colors duration-200 hover:border-accent-active hover:text-accent-active disabled:cursor-default disabled:opacity-30 disabled:hover:border-line-strong disabled:hover:text-ink-dim max-sm:h-9 max-sm:w-9';

  return (
    <div
      className={`pointer-events-none absolute bottom-2 right-0 z-30 flex justify-center px-2 transition-[left] duration-200 max-sm:bottom-1.5 max-sm:px-1.5 sm:bottom-3 ${leftClass}`}
    >
      <div className="pointer-events-auto flex min-w-0 max-w-full flex-col rounded-md border border-line-strong bg-panel px-2 py-1.5 max-sm:w-full max-sm:px-1.5 sm:px-3 sm:py-2">
        <div className="flex min-w-0 items-center gap-1.5 max-sm:gap-1 sm:gap-2">
          {/* Transport */}
          <div className="flex shrink-0 items-center gap-1">
            <button className={btn} onClick={reset} disabled={disabled} title="Reset (R)" aria-label="Reset to first stage">
              <ResetIcon size={13} />
            </button>
            <button
              className={btn}
              onClick={stepBack}
              disabled={disabled || currentStep === 0}
              title="Step back (←)"
              aria-label="Step back"
            >
              <StepBackIcon size={13} />
            </button>
            {playing ? (
              <button
                className={`${btn} !border-accent-active bg-accent-active/10 !text-accent-active`}
                onClick={pause}
                disabled={disabled}
                title="Pause (Space)"
                aria-label="Pause"
              >
                <PauseIcon size={13} />
              </button>
            ) : (
              <button className={btn} onClick={play} disabled={disabled} title="Play (Space)" aria-label="Play">
                <PlayIcon size={13} />
              </button>
            )}
            <button
              className={btn}
              onClick={stepForward}
              disabled={disabled || (!!trace && currentStep >= trace.length - 1)}
              title="Step forward (→)"
              aria-label="Step forward"
            >
              <StepForwardIcon size={13} />
            </button>
          </div>

          <div className="h-6 w-px shrink-0 bg-line" />

          {/* Pipeline: stages drawn along a drafting line */}
          <div
            className="scrollbar-none flex min-w-0 items-center overflow-x-auto"
            role={trace ? 'tablist' : undefined}
            aria-label={trace ? 'Execution stages' : undefined}
          >
            {trace ? (
              trace.map((st, i) => {
                const meta = STAGE_META[st.stage] ?? { short: st.stage, Icon: DatabaseIcon };
                const visited = i < currentStep;
                const current = i === currentStep;
                return (
                  <div key={i} className="flex shrink-0 items-center">
                    <button
                      role="tab"
                      aria-selected={current}
                      aria-label={`Stage ${i + 1}: ${st.label}`}
                      onClick={() => gotoStep(i)}
                      title={st.label}
                      className={`group flex shrink-0 cursor-pointer flex-col items-center gap-0.5 rounded-md border px-1.5 py-1 transition-all duration-200 max-sm:min-h-9 max-sm:min-w-8 max-sm:justify-center max-sm:px-1 sm:px-2 ${
                        current
                          ? 'border-accent-active bg-accent-active/10 text-accent-active'
                          : visited
                            ? 'border-line-strong bg-panel text-ink-dim hover:text-accent-active'
                            : 'border-line bg-panel text-ink-mute hover:border-line-strong hover:text-ink-dim'
                      }`}
                    >
                      <meta.Icon size={12} />
                      <span className="hidden font-ui text-[8px] font-bold tracking-[0.15em] min-[480px]:block">
                        {meta.short}
                      </span>
                    </button>
                    {/* wire segment to the next chip */}
                    {i < trace.length - 1 && (
                      <svg
                        className="h-2 w-2.5 shrink-0 sm:w-4 xl:w-6"
                        preserveAspectRatio="none"
                        viewBox="0 0 100 8"
                        aria-hidden="true"
                      >
                        <line
                          x1="0"
                          y1="4"
                          x2="100"
                          y2="4"
                          stroke={i < currentStep ? 'var(--border-strong)' : 'var(--border-default)'}
                          strokeWidth="2"
                        />
                        {i < currentStep && (
                          <line
                            className="bus-current animate-bus-flow"
                            x1="0"
                            y1="4"
                            x2="100"
                            y2="4"
                            stroke="var(--accent-active)"
                            strokeWidth="2"
                            strokeDasharray="4 10"
                          />
                        )}
                      </svg>
                    )}
                  </div>
                );
              })
            ) : (
              <>
                <span className="whitespace-nowrap px-2 font-ui text-[9px] tracking-[0.2em] text-ink-dim max-sm:hidden">
                  RUN A QUERY TO START THE PIPELINE
                </span>
                <span className="whitespace-nowrap px-2 font-ui text-[9px] tracking-[0.16em] text-ink-dim sm:hidden">
                  RUN QUERY TO START
                </span>
              </>
            )}
          </div>

          <div className="hidden h-6 w-px shrink-0 bg-line sm:block" />

          {/* Speed */}
          <div
            className="hidden shrink-0 items-center gap-0.5 rounded-md border border-line bg-panel p-0.5 sm:flex"
            role="group"
            aria-label="Playback speed"
          >
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                aria-pressed={speed === s}
                className={`cursor-pointer rounded px-1.5 py-0.5 font-data text-[10px] transition-colors duration-150 ${
                  speed === s ? 'bg-accent-active/10 text-accent-active' : 'text-ink-mute hover:text-ink-dim'
                }`}
              >
                {s}×
              </button>
            ))}
          </div>

          <span className="hidden w-10 shrink-0 text-right font-data text-[10px] tabular-nums text-ink-mute sm:inline">
            {trace ? `${currentStep + 1} / ${trace.length}` : '– / –'}
          </span>

          {trace && (
            <button
              onClick={() => setExplain(!explain)}
              aria-pressed={explain}
              title={explain ? 'Hide stage explanation' : 'Show stage explanation'}
              className={`hidden h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors md:flex ${
                explain
                  ? 'border-accent-active bg-accent-active/10 text-accent-active'
                  : 'border-line bg-panel text-ink-mute hover:text-ink-dim'
              }`}
            >
              <InfoIcon size={13} />
            </button>
          )}
        </div>

        {/* Narration: what this stage is doing, in plain language */}
        {trace && explain && step && (
          <div className="mt-1.5 hidden max-w-xl border-t border-line/60 pt-1.5 md:block xl:max-w-2xl">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`shrink-0 rounded-full border px-1.5 py-px font-data text-[9px] font-bold tracking-wider ${
                  STAGE_BADGE[step.stage] ?? 'border-line text-ink-dim'
                }`}
              >
                {STAGE_META[step.stage]?.short ?? step.stage}
              </span>
              <span className="truncate font-data text-[10px] text-ink-dim" title={step.label}>
                {step.label}
              </span>
            </div>
            <p
              className="mt-1 line-clamp-2 font-ui text-[14px] leading-normal text-ink"
              title={step.narration}
            >
              {step.narration}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
