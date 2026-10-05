'use client';

import { useEffect, useState, type ComponentType, type CSSProperties } from 'react';
import Image, { type StaticImageData } from 'next/image';
import Link from 'next/link';
import { FilterIcon, GroupIcon, JoinIcon, SortIcon } from '@/components/Icons';
import heroJoin from '@/public/landing/hero-join.png';
import stageWhere from '@/public/landing/stage-where.png';
import stageGroup from '@/public/landing/stage-group.png';
import stageFinal from '@/public/landing/stage-final.png';

/** Milliseconds each stage frame stays up before the next one fades in. */
const CYCLE_MS = 3400;

interface Frame {
  key: string;
  label: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
  /** Role accent matching the color the stage uses inside the app. */
  tone: string;
  src: StaticImageData;
  alt: string;
  caption: string;
}

const FRAMES: Frame[] = [
  {
    key: 'join',
    label: 'JOIN',
    Icon: JoinIcon,
    tone: 'text-accent-active',
    src: heroJoin,
    alt: 'QueryTrace at the JOIN stage: wires connect VENUE_ID between the VENUE and SCREENING tables and matched rows are lit.',
    caption: 'Wires connect the key columns. Matched rows light up together.',
  },
  {
    key: 'where',
    label: 'WHERE',
    Icon: FilterIcon,
    tone: 'text-accent-filter',
    src: stageWhere,
    alt: 'QueryTrace at the WHERE stage: the SCREENING_DAY column is gold and rows that are not Saturday have faded out.',
    caption: 'The tested column turns gold. Rows that fail fade and drop out.',
  },
  {
    key: 'group',
    label: 'GROUP BY',
    Icon: GroupIcon,
    tone: 'text-accent-group',
    src: stageGroup,
    alt: 'QueryTrace at the GROUP BY stage: rows are tinted by venue and the intermediate result shows one row per venue.',
    caption: 'Rows take the color of their bucket and collapse into one row each.',
  },
  {
    key: 'order',
    label: 'ORDER BY',
    Icon: SortIcon,
    tone: 'text-accent-active',
    src: stageFinal,
    alt: 'QueryTrace at the final ORDER BY stage: three venues sorted by Saturday seats in the result panel.',
    caption: 'The finished result, sorted. Click any row to trace it back.',
  },
];

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

/**
 * The hero visual: real screenshots of one lesson at four stages, cycling
 * the way the app's own playback does. Clicking the frame opens the tracer;
 * clicking a stage chip jumps to that frame and stops the auto-advance.
 */
export function HeroStage() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = usePrefersReducedMotion();
  const cycling = !paused && !reduced;

  useEffect(() => {
    if (!cycling) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % FRAMES.length), CYCLE_MS);
    return () => window.clearInterval(id);
  }, [cycling, index]);

  const active = FRAMES[index];

  return (
    <div
      className="hero-in w-full"
      style={{ '--d': '220ms', '--cycle': `${CYCLE_MS}ms` } as CSSProperties}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <Link
        href="/trace"
        aria-label="Open the tracer"
        className="group relative block overflow-hidden rounded-md border border-line-strong bg-canvas shadow-[0_30px_80px_-30px_rgba(9,13,24,0.9),inset_0_1px_0_rgba(238,242,255,0.06)] transition-colors duration-300 hover:border-accent-active/70 focus-visible:border-accent-active"
      >
        <div className="relative aspect-[16/10] w-full">
          {FRAMES.map((frame, i) => (
            <Image
              key={frame.key}
              src={frame.src}
              alt={i === index ? frame.alt : ''}
              fill
              priority={i === 0}
              sizes="(min-width: 1024px) 60vw, 100vw"
              className={`object-cover object-left-top transition-opacity duration-700 ease-out ${
                i === index ? 'opacity-100' : 'opacity-0'
              }`}
              aria-hidden={i !== index}
            />
          ))}
        </div>
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center bg-gradient-to-t from-app/95 via-app/60 to-transparent px-4 pb-4 pt-12 font-ui text-[12px] font-bold tracking-[0.18em] text-ink opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
          OPEN THE TRACER
        </span>
      </Link>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Stage shown in the preview">
          {FRAMES.map((frame, i) => {
            const isActive = i === index;
            return (
              <button
                key={frame.key}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  setIndex(i);
                  setPaused(true);
                }}
                className={`relative inline-flex h-9 cursor-pointer items-center gap-1.5 overflow-hidden rounded-md border px-3 font-ui text-[10px] font-bold tracking-[0.16em] transition-colors ${
                  isActive
                    ? `border-line-strong bg-panel ${frame.tone}`
                    : 'border-line text-ink-mute hover:border-line-strong hover:text-ink'
                }`}
              >
                <frame.Icon size={12} />
                {frame.label}
                {isActive && cycling && (
                  <span
                    key={index}
                    aria-hidden="true"
                    className="stage-progress absolute inset-x-0 bottom-0 h-[2px] origin-left bg-current opacity-60"
                  />
                )}
              </button>
            );
          })}
        </div>
        <p
          className="font-ui text-[13px] leading-snug text-ink-dim sm:max-w-[32ch] sm:text-right"
          aria-live="polite"
        >
          {active.caption}
        </p>
      </div>
    </div>
  );
}
