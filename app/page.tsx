import Link from 'next/link';
import localFont from 'next/font/local';
import type { CSSProperties } from 'react';
import { LESSONS, type Lesson } from '@/lib/lessons';
import { schemaById } from '@/lib/schemas';
import { Hero } from '@/components/landing/Hero';
import { Reveal } from '@/components/landing/Reveal';
import PoweredByPlatmatics from '@/components/badge/PoweredByPlatmatics';
import s from '@/components/landing/landing.module.css';

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

/* What pasting a schema gets you, in the order a visitor asks. */
const FACTS = [
  { text: 'Exports from PostgreSQL, SQL Server, MySQL and Oracle paste in as they are.', tone: 'var(--accent)' },
  { text: 'Everything runs on SQLite compiled to WebAssembly, inside the tab.', tone: 'var(--mint)' },
  { text: 'Nothing you type is sent anywhere.', tone: 'var(--gold)' },
];

const DIALECTS = ['PostgreSQL', 'SQL Server', 'MySQL', 'Oracle', 'SQLite'];

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
          <Hero
            title={
              <h1 id="headline" className={s.headline} data-rise style={{ '--i': 0 } as CSSProperties}>
                Watch a query run.
              </h1>
            }
            action={<Action i={3} />}
          />
        </section>

        <section className={s.section} aria-labelledby="lessons-title" id="lessons">
          <div className={s.inner}>
            <Reveal className={s.wide}>
              <p className={s.eyebrow}>Lessons</p>
              <h2 id="lessons-title" className={s.heading}>Nineteen lessons.</h2>
              <p className={s.prose}>
                Each lesson is one query over a small fictional dataset. Open one and step through it.
              </p>
              <div className={s.rows}>
                {(['Foundations', 'Combining data'] as Lesson['section'][]).map((section) => (
                  <div key={section}>
                    <p className={s.groupWord}>{section}</p>
                    <div className={s.lessonGrid}>
                    {LESSONS.filter((lesson) => lesson.section === section).map((lesson) => (
                      <Link key={lesson.id} href={`/trace?lesson=${lesson.id}`} className={s.row}>
                        <span className={s.dot} style={{ '--c': SECTION_TONE[section] } as CSSProperties} aria-hidden="true" />
                        <span className={s.rowName}>{lesson.title}</span>
                        <span className={s.rowValue}>{schemaById(lesson.schemaId)?.name}</span>
                      </Link>
                    ))}
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        <section className={s.section} aria-labelledby="schema-title" id="schema">
          <div className={s.inner}>
            <Reveal className={s.wide}>
              <div className={s.schema}>
                <div>
                  <p className={s.eyebrow}>Schema</p>
                  <h2 id="schema-title" className={s.heading}>Your own schema works too.</h2>
                  <p className={s.prose}>
                    Paste the CREATE TABLE statements from your database and step through queries over your own tables.
                  </p>
                  <ul className={s.facts}>
                    {FACTS.map((fact) => (
                      <li key={fact.text}>
                        <span className={s.dot} style={{ '--c': fact.tone } as CSSProperties} aria-hidden="true" />
                        <span>{fact.text}</span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/trace" className={s.inlineLink}>
                    <span className={s.textLabel}>Paste a schema</span>
                    <span aria-hidden="true">&rarr;</span>
                  </Link>
                </div>
                <figure className={s.schemaCode}>
                  <figcaption className={s.codeLabel}>Pasted straight from pg_dump</figcaption>
                  <pre className={s.sql}>
                    <code>
                      <span className={s.line}><span className={s.kw}>CREATE TABLE</span> venue (</span>
                      <span className={s.line}>  venue_id    <span className={s.type}>integer</span> <span className={s.kw}>PRIMARY KEY</span>,</span>
                      <span className={s.line}>  venue_name  <span className={s.type}>varchar(30)</span> <span className={s.kw}>NOT NULL</span>,</span>
                      <span className={s.line}>  capacity    <span className={s.type}>integer</span> <span className={s.kw}>NOT NULL</span></span>
                      <span className={s.line}>);</span>
                      <span className={s.line}><span className={s.kw}>CREATE TABLE</span> screening (</span>
                      <span className={s.line}>  screening_id  <span className={s.type}>integer</span> <span className={s.kw}>PRIMARY KEY</span>,</span>
                      <span className={s.line}>  film_title    <span className={s.type}>varchar(40)</span> <span className={s.kw}>NOT NULL</span>,</span>
                      <span className={s.line}>  venue_id      <span className={s.type}>integer</span> <span className={s.kw}>REFERENCES</span> venue (venue_id)</span>
                      <span className={s.line}>);</span>
                    </code>
                  </pre>
                  <ul className={s.dialects} aria-label="Dialects that paste in as exported">
                    {DIALECTS.map((d) => <li key={d} className={s.chip}>{d}</li>)}
                  </ul>
                </figure>
              </div>
            </Reveal>
          </div>
        </section>

        <section className={s.close} aria-labelledby="close-title">
          <div className={s.inner}>
            <Reveal className={s.wide}>
              <div className={s.closePanel}>
                <div>
                  <p className={s.eyebrow}>Start</p>
                  <h2 id="close-title" className={s.closeTitle}>Open the tracer.</h2>
                  <p className={s.closeLine}>
                    It opens on a four-table join you can step through right now. No account, nothing to install.
                  </p>
                </div>
                <div className={s.closeActions}>
                  <Link href="/trace" className={s.cta}>Open the tracer</Link>
                  <a href="#lessons" className={s.inlineLink}>
                    <span className={s.textLabel}>Browse the lessons</span>
                    <span aria-hidden="true">&rarr;</span>
                  </a>
                </div>
              </div>
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
          <PoweredByPlatmatics site="querytrace.net" />
        </div>
      </footer>
    </div>
  );
}
