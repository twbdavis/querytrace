import Image from 'next/image';
import Link from 'next/link';
import { LESSONS, type Lesson } from '@/lib/lessons';
import { schemaById } from '@/lib/schemas';
import {
  ColumnsIcon,
  DatabaseIcon,
  FilterIcon,
  GroupIcon,
  JoinIcon,
  PlayIcon,
  SortIcon,
} from '@/components/Icons';
import { HeroStage } from '@/components/landing/HeroStage';
import { Reveal } from '@/components/landing/Reveal';
import PoweredByPlatmatics from '@/components/badge/PoweredByPlatmatics';
import provenanceCrop from '@/public/landing/provenance-crop.png';
import schemaDialog from '@/public/landing/schema.png';
import mobileJoin from '@/public/landing/mobile-join.png';

const REPO_URL = 'https://github.com/twbdavis/querytrace';

const container = 'mx-auto w-full max-w-[1200px] px-5 sm:px-8';

const primaryCta =
  'inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-accent-active px-5 font-ui text-[13px] font-bold tracking-wide text-app transition-[background-color,transform] duration-200 hover:-translate-y-px hover:bg-accent-pulse active:translate-y-0 active:scale-[0.98]';
const secondaryCta =
  'inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-line-strong px-5 font-ui text-[13px] font-bold tracking-wide text-ink transition-colors duration-200 hover:border-accent-active hover:text-accent-active active:scale-[0.98]';

const STAGES = [
  {
    name: 'FROM',
    Icon: DatabaseIcon,
    tone: 'text-accent-active',
    text: 'Every table the query names lights up. Their rows are the starting set; everything else dims.',
  },
  {
    name: 'JOIN',
    Icon: JoinIcon,
    tone: 'text-accent-active',
    text: 'Wires connect the key columns and matched rows light together. Outer joins keep the unmatched rows, dashed in gold.',
  },
  {
    name: 'WHERE',
    Icon: FilterIcon,
    tone: 'text-accent-filter',
    text: 'The columns the condition reads turn gold. Rows that fail drop out, so you can count exactly what survived.',
  },
  {
    name: 'GROUP BY',
    Icon: GroupIcon,
    tone: 'text-accent-group',
    text: 'Rows take the color of their bucket, then each bucket collapses into a single row. HAVING filters the buckets.',
  },
  {
    name: 'SELECT',
    Icon: ColumnsIcon,
    tone: 'text-accent-result',
    text: 'The kept columns turn mint and everything else falls away. Aliases and expressions are evaluated here.',
  },
  {
    name: 'ORDER BY',
    Icon: SortIcon,
    tone: 'text-accent-active',
    text: 'The result settles into its final order. Scrub back to any earlier stage and the rows are still there.',
  },
];

const LESSON_SECTIONS: Lesson['section'][] = ['Foundations', 'Combining data'];

function LessonLink({ lesson }: { lesson: Lesson }) {
  const schemaName = schemaById(lesson.schemaId)?.name ?? lesson.schemaId;
  return (
    <Link
      href={`/trace?lesson=${lesson.id}`}
      className="group flex min-h-11 items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-panel focus-visible:bg-panel"
    >
      <PlayIcon size={10} className="shrink-0 text-ink-mute transition-colors group-hover:text-accent-active" />
      <span className="min-w-0 flex-1 font-ui text-[14px] leading-snug text-ink">{lesson.title}</span>
      <span className="hidden shrink-0 font-data text-[10px] text-ink-mute sm:inline">{schemaName}</span>
    </Link>
  );
}

export default function LandingPage() {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-app/85 backdrop-blur-md">
        <nav className={`${container} flex h-16 items-center justify-between gap-6`} aria-label="Primary">
          <Link href="/" className="shrink-0 font-ui text-sm font-bold tracking-[0.2em] text-ink">
            QUERY<span className="text-accent-active">TRACE</span>
          </Link>
          <div className="hidden items-center gap-7 md:flex">
            <a href="#stages" className="font-ui text-[13px] font-medium text-ink-dim transition-colors hover:text-ink">
              How it works
            </a>
            <a href="#lessons" className="font-ui text-[13px] font-medium text-ink-dim transition-colors hover:text-ink">
              Lessons
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-ui text-[13px] font-medium text-ink-dim transition-colors hover:text-ink"
            >
              GitHub
            </a>
          </div>
          <Link href="/trace" className={`${primaryCta} h-9 px-4 text-[12px]`}>
            Open the tracer
          </Link>
        </nav>
      </header>

      <main id="main">
        {/* ------------------------------------------------------------ hero */}
        <section className="relative overflow-hidden">
          <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className={`${container} relative grid items-center gap-10 pb-16 pt-12 sm:pt-16 lg:grid-cols-12 lg:gap-8 lg:pb-24 lg:pt-20`}>
            <div className="lg:col-span-5">
              <h1
                className="hero-in max-w-[14ch] font-ui text-[2.6rem] font-bold leading-[1.02] tracking-tight text-ink sm:text-5xl lg:text-[3.5rem]"
                style={{ '--d': '0ms' } as React.CSSProperties}
              >
                See the query run.
              </h1>
              <p
                className="hero-in mt-6 max-w-[42ch] font-ui text-base leading-relaxed text-ink-dim sm:text-lg"
                style={{ '--d': '90ms' } as React.CSSProperties}
              >
                Joins pulse along foreign keys. Filtered rows fade. Groups collapse into results. Live tables in your
                browser, nothing to install.
              </p>
              <div
                className="hero-in mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"
                style={{ '--d': '160ms' } as React.CSSProperties}
              >
                <Link href="/trace" className={primaryCta}>
                  <PlayIcon size={12} />
                  Open the tracer
                </Link>
                <a href="#stages" className={secondaryCta}>
                  How it works
                </a>
              </div>
            </div>
            <div className="lg:col-span-7 lg:-mr-16 xl:-mr-28">
              <HeroStage />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- stages */}
        <section id="stages" className="scroll-mt-20 border-t border-line/70">
          <div className={`${container} py-20 lg:py-28`}>
            <Reveal className="max-w-[60ch]">
              <h2 className="font-ui text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
                Six stages. Every row accounted for.
              </h2>
              <p className="mt-4 font-ui text-base leading-relaxed text-ink-dim sm:text-lg">
                A query is not one step. QueryTrace splits it into the stages the database actually runs, and shows
                what each one keeps, drops, or builds.
              </p>
            </Reveal>
            <ol className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              {STAGES.map((stage, i) => (
                <Reveal key={stage.name} delay={i * 60}>
                  <li className="border-t border-line pt-5">
                    <div className={`flex items-center gap-2.5 ${stage.tone}`}>
                      <stage.Icon size={16} />
                      <span className="font-data text-[13px] font-bold tracking-[0.12em]">{stage.name}</span>
                    </div>
                    <p className="mt-3 font-ui text-[15px] leading-relaxed text-ink-dim">{stage.text}</p>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------------ provenance */}
        <section className="border-t border-line/70 bg-canvas">
          <div className={`${container} grid items-center gap-12 py-20 lg:grid-cols-12 lg:gap-14 lg:py-28`}>
            <Reveal className="lg:col-span-5">
              <h2 className="font-ui text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
                Click a result. See where it came from.
              </h2>
              <p className="mt-4 max-w-[48ch] font-ui text-base leading-relaxed text-ink-dim sm:text-lg">
                Pin any row in the result and every source row that produced it lights up in mint, across all the
                tables and at every stage. Hover to preview, click to keep it.
              </p>
              <p className="mt-4 max-w-[48ch] font-ui text-base leading-relaxed text-ink-dim">
                It works in reverse too: pin a row in a table and watch whether it survives the WHERE, which group it
                lands in, and which result it ends up inside.
              </p>
            </Reveal>
            <Reveal className="lg:col-span-7" delay={80}>
              <Link
                href="/trace"
                aria-label="Open the tracer"
                className="block overflow-hidden rounded-md border border-line-strong bg-canvas shadow-[0_30px_80px_-30px_rgba(9,13,24,0.9)] transition-colors hover:border-accent-active/70 focus-visible:border-accent-active"
              >
                <Image
                  src={provenanceCrop}
                  alt="The result panel with Beacon Theater pinned, and the VENUE and RESERVATION rows that produced it outlined in mint."
                  sizes="(min-width: 1024px) 58vw, 100vw"
                  className="h-auto w-full"
                />
              </Link>
            </Reveal>
          </div>
        </section>

        {/* --------------------------------------------------------- lessons */}
        <section id="lessons" className="scroll-mt-20 border-t border-line/70">
          <div className={`${container} py-20 lg:py-28`}>
            <Reveal className="max-w-[60ch]">
              <h2 className="font-ui text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
                Nineteen lessons, from SELECT to subqueries.
              </h2>
              <p className="mt-4 font-ui text-base leading-relaxed text-ink-dim sm:text-lg">
                Each lesson loads a small database, runs one query, and suggests a change to try. Pick one and the
                tracer opens with it already running.
              </p>
            </Reveal>
            <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:gap-14">
              {LESSON_SECTIONS.map((section, si) => (
                <Reveal key={section} delay={si * 80}>
                  <h3 className="mb-3 px-3 font-ui text-[13px] font-bold text-ink-mute">{section}</h3>
                  <div className="-mx-3 flex flex-col">
                    {LESSONS.filter((l) => l.section === section).map((lesson) => (
                      <LessonLink key={lesson.id} lesson={lesson} />
                    ))}
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------- bento */}
        <section className="border-t border-line/70 bg-canvas">
          <div className={`${container} py-20 lg:py-28`}>
            <Reveal className="max-w-[60ch]">
              <h2 className="font-ui text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
                Yours to run, anywhere.
              </h2>
            </Reveal>
            <div className="mt-12 grid gap-4 md:grid-cols-12">
              <Reveal className="md:col-span-7">
                <div className="blueprint-grid flex h-full min-h-[280px] flex-col justify-end rounded-md border border-line-strong bg-app p-7 sm:p-9">
                  <h3 className="font-ui text-2xl font-bold leading-tight tracking-tight text-ink sm:text-3xl">
                    Nothing leaves this tab.
                  </h3>
                  <p className="mt-3 max-w-[46ch] font-ui text-[15px] leading-relaxed text-ink-dim">
                    SQLite compiled to WebAssembly runs inside the page. No account, no server, no tracking. The code is
                    open source under the MIT license.
                  </p>
                </div>
              </Reveal>
              <Reveal className="md:col-span-5" delay={60}>
                <div className="flex h-full flex-col overflow-hidden rounded-md border border-line-strong bg-panel">
                  <div className="p-7">
                    <h3 className="font-ui text-xl font-bold leading-tight tracking-tight text-ink">
                      Bring your own schema.
                    </h3>
                    <p className="mt-2 font-ui text-[15px] leading-relaxed text-ink-dim">
                      Paste CREATE TABLE and INSERT statements, or a Workbench export, and trace against your own
                      data.
                    </p>
                  </div>
                  <div className="relative mt-auto h-56 overflow-hidden border-t border-line">
                    <Image
                      src={schemaDialog}
                      alt="The schema dialog listing five preloaded databases and a Build Your Own editor."
                      sizes="(min-width: 768px) 40vw, 100vw"
                      className="absolute left-5 top-5 w-[115%] max-w-none rounded-tl-md border-l border-t border-line-strong"
                    />
                  </div>
                </div>
              </Reveal>
              <Reveal className="md:col-span-5" delay={40}>
                <div className="flex h-full flex-col overflow-hidden rounded-md border border-line-strong bg-panel">
                  <div className="relative order-2 h-80 overflow-hidden border-t border-line md:order-1 md:border-b md:border-t-0">
                    <Image
                      src={mobileJoin}
                      alt="QueryTrace on a phone: the schema canvas on top with the playback dock, and the query sheet below."
                      sizes="(min-width: 768px) 40vw, 100vw"
                      className="absolute left-1/2 top-5 w-[62%] max-w-none -translate-x-1/2 rounded-t-xl border border-line-strong"
                    />
                  </div>
                  <div className="order-1 p-7 md:order-2">
                    <h3 className="font-ui text-xl font-bold leading-tight tracking-tight text-ink">Fits a phone.</h3>
                    <p className="mt-2 font-ui text-[15px] leading-relaxed text-ink-dim">
                      The canvas fills the screen and the query and results live in a sheet beneath it.
                    </p>
                  </div>
                </div>
              </Reveal>
              <Reveal className="md:col-span-7" delay={100}>
                <div className="flex h-full flex-col justify-end rounded-md border border-line-strong bg-panel p-7 sm:p-9">
                  <h3 className="font-ui text-2xl font-bold leading-tight tracking-tight text-ink sm:text-3xl">
                    Write it in your dialect.
                  </h3>
                  <p className="mt-3 max-w-[50ch] font-ui text-[15px] leading-relaxed text-ink-dim">
                    MySQL, PostgreSQL, SQL Server and Oracle queries are translated to SQLite before they run, and the
                    rewrite is shown under the editor so you learn both spellings.
                  </p>
                  <ul className="mt-6 flex flex-wrap gap-2" aria-label="Supported dialects">
                    {['MySQL / MariaDB', 'PostgreSQL', 'SQL Server', 'Oracle', 'SQLite'].map((d) => (
                      <li
                        key={d}
                        className="rounded-md border border-line px-2.5 py-1 font-data text-[11px] text-ink-dim"
                      >
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- final cta */}
        <section className="border-t border-line/70">
          <div className={`${container} py-24 lg:py-32`}>
            <Reveal className="flex flex-col items-start gap-8 lg:flex-row lg:items-end lg:justify-between">
              <h2 className="max-w-[18ch] font-ui text-4xl font-bold leading-[1.05] tracking-tight text-ink sm:text-5xl">
                Open the tracer and run a query.
              </h2>
              <Link href="/trace" className={`${primaryCta} h-12 px-6 text-sm`}>
                <PlayIcon size={12} />
                Open the tracer
              </Link>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-line/70">
        <div className={`${container} flex flex-col gap-4 py-8 text-[12px] text-ink-mute sm:flex-row sm:items-center sm:justify-between`}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="font-ui font-bold tracking-[0.2em] text-ink-dim">
              QUERY<span className="text-accent-active">TRACE</span>
            </span>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-ui transition-colors hover:text-ink"
            >
              Source on GitHub
            </a>
            <span className="font-ui">MIT license</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <PoweredByPlatmatics site="querytrace.net" variant="inline" />
            <span className="font-ui">&copy; {new Date().getFullYear()} QueryTrace</span>
          </div>
        </div>
      </footer>
    </>
  );
}
