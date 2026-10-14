import Image from 'next/image';
import Link from 'next/link';
import localFont from 'next/font/local';
import type { CSSProperties } from 'react';
import { LESSONS, type Lesson } from '@/lib/lessons';
import { schemaById } from '@/lib/schemas';
import { Hero } from '@/components/landing/Hero';
import { Reveal } from '@/components/landing/Reveal';
import PoweredByPlatmatics from '@/components/badge/PoweredByPlatmatics';
import s from '@/components/landing/landing.module.css';
import rowJoined from '@/public/landing/row-joined.png';
import rowFiltered from '@/public/landing/row-filtered.png';
import rowGrouped from '@/public/landing/row-grouped.png';
import rowTraced from '@/public/landing/row-traced.png';
import schemaCrop from '@/public/landing/schema-crop.png';

/* Switzer, self-hosted: the font CSP allows same-origin files only. */
const text = localFont({
  src: [
    { path: '../public/fonts/switzer-400.woff2', weight: '400', style: 'normal' },
    { path: '../public/fonts/switzer-500.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-text',
  display: 'swap',
});

const REPO_URL = 'https://github.com/twbdavis/querytrace';

/* The RESERVATION table of lesson 15, cropped from the real tracer at four
   moments. Same table, same rows, four states. */
const STATES = [
  { word: 'Joined', src: rowJoined, alt: 'The RESERVATION table at the JOIN stage with matched rows lit.' },
  { word: 'Filtered', src: rowFiltered, alt: 'The RESERVATION table at the WHERE stage with failing rows faded.' },
  { word: 'Grouped', src: rowGrouped, alt: 'The RESERVATION table at the GROUP BY stage, each row tinted by venue.' },
  { word: 'Traced', src: rowTraced, alt: 'The RESERVATION table with the five rows behind one result outlined in mint.' },
];

const SECTION_TONE: Record<Lesson['section'], string> = {
  Foundations: 'var(--accent)',
  'Combining data': 'var(--mint)',
};

function Action({ i }: { i?: number }) {
  const style = i === undefined ? undefined : ({ '--i': i } as CSSProperties);
  return (
    <div className={s.actions} data-rise={i === undefined ? undefined : ''} style={style}>
      <Link href="/trace" className={s.button}>Open the tracer</Link>
      <Link href="/trace" className={s.textLink}>
        <span className={s.textLabel}>Open the tracer</span>
        <span aria-hidden="true">&rarr;</span>
      </Link>
    </div>
  );
}

export default function LandingPage() {
  const year = new Date().getFullYear();
  return (
    <div className={`${text.variable} ${s.page}`}>
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />

      <header className={s.top}>
        <Link href="/" className={`${s.mark} ${s.inner}`} aria-label="QueryTrace home">
          <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
            <path d="M12 16h40M12 32h24M12 48h40" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="square" />
            <rect x="42" y="27" width="10" height="10" fill="#5eead4" />
          </svg>
        </Link>
        <nav aria-label="Primary">
          <Link href="/trace" className={s.topLink}>Open the tracer</Link>
        </nav>
      </header>

      <main id="main">
        <section className={s.hero} aria-labelledby="headline">
          <div className={s.inner}>
            <h1 id="headline" className={`${s.headline} ${s.col}`} data-rise style={{ '--i': 0 } as CSSProperties}>
              Watch a SQL Query run.
            </h1>
            <p className={`${s.lede} ${s.col}`} data-rise style={{ '--i': 1 } as CSSProperties}>
              QueryTrace plays your statement over live tables in the browser and shows what each clause did to the rows.
            </p>
            <Action i={2} />
            <Hero />
          </div>
        </section>

        <section className={s.section} aria-labelledby="states-title">
          <div className={s.inner}>
            <Reveal>
              <h2 id="states-title" className={`${s.heading} ${s.col}`}>Every clause shows its work.</h2>
            </Reveal>
            <div className={s.states}>
              {STATES.map((state, i) => (
                <Reveal key={state.word} className={s.state} delay={i * 60}>
                  <span className={s.stateWord}>{state.word}</span>
                  <div className={s.statePic}>
                    <Image src={state.src} alt={state.alt} unoptimized sizes="(min-width: 1024px) 520px, 100vw" />
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className={s.section} aria-labelledby="lessons-title" id="lessons">
          <div className={s.inner}>
            <Reveal className={s.col}>
              <h2 id="lessons-title" className={s.heading}>Nineteen lessons.</h2>
              <p className={s.prose}>
                Each lesson is one query over a small fictional dataset. Open one and step through it.
              </p>
              <div className={s.rows}>
                {(['Foundations', 'Combining data'] as Lesson['section'][]).map((section) => (
                  <div key={section}>
                    <p className={s.groupWord}>{section}</p>
                    {LESSONS.filter((lesson) => lesson.section === section).map((lesson) => (
                      <Link key={lesson.id} href={`/trace?lesson=${lesson.id}`} className={s.row}>
                        <span className={s.dot} style={{ '--c': SECTION_TONE[section] } as CSSProperties} aria-hidden="true" />
                        <span className={s.rowName}>{lesson.title}</span>
                        <span className={s.rowValue}>{schemaById(lesson.schemaId)?.name}</span>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        <section className={s.section} aria-labelledby="schema-title" id="schema">
          <div className={s.inner}>
            <Reveal className={s.col}>
              <h2 id="schema-title" className={s.heading}>Your own schema works too.</h2>
              <p className={s.prose}>
                Paste the CREATE TABLE statements from your database. Exports from PostgreSQL and SQL Server paste in as
                they are, and so do MySQL and Oracle.
              </p>
              <p className={s.prose}>
                Everything runs on SQLite compiled to WebAssembly, inside the tab. Nothing you type is sent anywhere.
              </p>
            </Reveal>
            <Reveal className={`${s.picture} ${s.col}`} delay={80}>
              <Image
                src={schemaCrop}
                unoptimized
                alt="The schema dialog: five preloaded databases and a text area for your own CREATE TABLE statements."
                sizes="(min-width: 1024px) 520px, 100vw"
              />
            </Reveal>
          </div>
        </section>

        <section className={s.close} aria-label="Open the tracer">
          <div className={s.inner}>
            <Reveal className={s.col}>
              <p className={s.closeLine}>The tracer opens on a four-table join you can step through right now.</p>
              <Action />
            </Reveal>
          </div>
        </section>
      </main>

      <footer className={s.foot}>
        <span>QueryTrace, a visual SQL tracer</span>
        <div className={s.footLinks}>
          <Link href="/trace">Tracer</Link>
          <a href="#lessons">Lessons</a>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">MIT licence</a>
        </div>
        <div className={s.footRight}>
          <span>{year}</span>
          <PoweredByPlatmatics site="querytrace.net" variant="inline" />
        </div>
      </footer>
    </div>
  );
}
