'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import s from './landing.module.css';
import { JoinScene, type JoinPhase } from './join-scene/JoinScene';

type Clause = 'select' | 'from' | 'join';

/** The clause the scene is executing, highlighted the way the tracer marks it. */
const CLAUSE_FOR_PHASE: Record<JoinPhase, Clause> = {
  assemble: 'from',
  connect: 'join',
  match: 'join',
  project: 'select',
  hold: 'select',
};

interface HeroProps {
  /** The headline, rendered on the server. */
  title: ReactNode;
  /** The call to action, rendered on the server. */
  action: ReactNode;
}

/**
 * The stage under the header: the three.js join scene with the headline
 * over its top-left corner, and the query it is playing (one clause per
 * line, the executing clause marked as in the tracer) with the call to
 * action over its bottom-left. The words render without script; the scene
 * arrives when it can run.
 */
export function Hero({ title, action }: HeroProps) {
  const [phase, setPhase] = useState<JoinPhase>('assemble');
  const active = CLAUSE_FOR_PHASE[phase];
  const line = (clause: Clause) => `${s.line} ${active === clause ? 'queryExecHighlight' : ''}`;

  return (
    <div className={s.stage}>
      <JoinScene onPhase={setPhase} />
      <div className={s.stageTitle}>{title}</div>
      <div className={s.stageText}>
        <div className={s.demoQuery} data-rise style={{ '--i': 2 } as CSSProperties}>
          <pre className={s.sql}>
            <code>
              <span className={line('select')}>
                <span className={s.kwResult}>SELECT</span> V.VENUE_NAME, S.FILM_TITLE, S.SCREENING_DAY
              </span>
              <span className={line('from')}>
                <span className={s.kw}>FROM</span> SCREENING S
              </span>
              <span className={line('join')}>
                <span className={s.kw}>JOIN</span> VENUE V <span className={s.kw}>ON</span> S.VENUE_ID = V.VENUE_ID;
              </span>
            </code>
          </pre>
        </div>
        {action}
      </div>
    </div>
  );
}
