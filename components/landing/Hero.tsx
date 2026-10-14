'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import Image, { type StaticImageData } from 'next/image';
import Link from 'next/link';
import s from './landing.module.css';
import heroJoin from '@/public/landing/hero-join.png';
import stageWhere from '@/public/landing/stage-where.png';
import stageGroup from '@/public/landing/stage-group.png';
import stageFinal from '@/public/landing/stage-final.png';

/** Each frame holds for a while, then crossfades, like light shifting in a room. */
const HOLD_MS = 5600;

type StageKey = 'join' | 'where' | 'group' | 'order';

interface Frame {
  key: StageKey;
  src: StaticImageData;
  alt: string;
  caption: string;
}

const FRAMES: Frame[] = [
  {
    key: 'join',
    src: heroJoin,
    alt: 'QueryTrace at the JOIN stage: wires connect VENUE_ID between the VENUE and SCREENING tables and matched rows are lit.',
    caption: 'Wires run along VENUE_ID and the matched rows light up on both tables.',
  },
  {
    key: 'where',
    src: stageWhere,
    alt: 'QueryTrace at the WHERE stage: the SCREENING_DAY column is gold and rows that are not Saturday have faded out.',
    caption: 'SCREENING_DAY turns gold and the rows that are not Saturday fade out.',
  },
  {
    key: 'group',
    src: stageGroup,
    alt: 'QueryTrace at the GROUP BY stage: rows are tinted by venue and the intermediate result shows one row per venue.',
    caption: 'Rows take the colour of their venue and collapse to one row each.',
  },
  {
    key: 'order',
    src: stageFinal,
    alt: 'QueryTrace at the final ORDER BY stage: three venues sorted by Saturday seats in the result panel.',
    caption: 'Three venues, sorted by Saturday seats.',
  },
];

const INDEX: Record<StageKey, number> = { join: 0, where: 1, group: 2, order: 3 };

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

interface ClauseProps {
  stage: StageKey;
  active: StageKey;
  tone: string;
  onPick: (stage: StageKey) => void;
  children: ReactNode;
}

/** One line of the query, which is also the control for its stage. */
function Clause({ stage, active, tone, onPick, children }: ClauseProps) {
  const on = stage === active;
  return (
    <button type="button" aria-pressed={on} onClick={() => onPick(stage)} className={`${s.clause} ${tone} ${on ? s.on : ''}`}>
      {children}
    </button>
  );
}

/**
 * The demonstration under the headline: real frames of lesson 15, one per
 * stage, crossfading slowly. The query beneath is the control; pressing a
 * clause shows that stage and stops the drift. The first frame and the
 * static query render without script.
 */
export function Hero() {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const reduced = usePrefersReducedMotion();
  const drifting = !held && !reduced;
  const active = FRAMES[index].key;

  useEffect(() => {
    if (!drifting) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') setIndex((i) => (i + 1) % FRAMES.length);
    }, HOLD_MS);
    return () => window.clearInterval(id);
  }, [drifting, index]);

  const pick = (stage: StageKey) => {
    setIndex(INDEX[stage]);
    setHeld(true);
  };

  return (
    <>
      <Link
        href="/trace"
        aria-label="Open the tracer"
        className={`${s.frame} ${s.wide}`}
        data-rise
        style={{ '--i': 3 } as CSSProperties}
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
      >
        {FRAMES.map((frame, i) => (
          <Image
            key={frame.key}
            src={frame.src}
            alt={i === index ? frame.alt : ''}
            fill
            preload={i === 0}
            sizes="(min-width: 1024px) 860px, 100vw"
            className={`${s.frameImg} ${i === index ? s.frameOn : ''}`}
            aria-hidden={i !== index}
          />
        ))}
      </Link>

      <div className={s.col} data-ui data-rise style={{ '--i': 4 } as CSSProperties}>
        <pre className={s.sql}>
          <code>
            <span className={s.line}>
              <span className={s.kwResult}>SELECT</span> V.VENUE_NAME, SUM(R.SEATS) <span className={s.kw}>AS</span>{' '}
              <span className={s.str}>&apos;Saturday Seats&apos;</span>
            </span>
            <span className={s.line}>
              <span className={s.kw}>FROM</span> VENUE V
            </span>
            <span role="group" aria-label="Stage shown in the preview">
              <Clause stage="join" active={active} tone={s.join} onPick={pick}>
                <span className={s.kw}>JOIN</span> SCREENING S <span className={s.kw}>ON</span> V.VENUE_ID = S.VENUE_ID
              </Clause>
              <Clause stage="join" active={active} tone={s.join} onPick={pick}>
                <span className={s.kw}>JOIN</span> RESERVATION R <span className={s.kw}>ON</span> S.SCREENING_ID = R.SCREENING_ID
              </Clause>
              <Clause stage="where" active={active} tone={s.where} onPick={pick}>
                <span className={s.kwWhere}>WHERE</span> S.SCREENING_DAY = <span className={s.str}>&apos;Saturday&apos;</span>
              </Clause>
              <Clause stage="group" active={active} tone={s.group} onPick={pick}>
                <span className={s.kwGroup}>GROUP BY</span> V.VENUE_NAME
              </Clause>
              <Clause stage="order" active={active} tone={s.order} onPick={pick}>
                <span className={s.kw}>ORDER BY</span> SUM(R.SEATS) <span className={s.kw}>DESC</span>;
              </Clause>
            </span>
          </code>
        </pre>
        <p className={`${s.caption} ${held ? s.captionOn : ''}`} aria-live="polite">
          {FRAMES[index].caption}
        </p>
      </div>
    </>
  );
}
