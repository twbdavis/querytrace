'use client';

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { LESSONS } from '@/lib/lessons';
import { PRELOADED_SCHEMAS } from '@/lib/schemas';
import {
  BookIcon,
  CloseIcon,
  ColumnsIcon,
  CrosshairIcon,
  DatabaseIcon,
  EditIcon,
  FilterIcon,
  GroupIcon,
  HavingIcon,
  HelpIcon,
  JoinIcon,
  PlayIcon,
  SortIcon,
  TableIcon,
  TerminalIcon,
} from './Icons';

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
  /** Close help and open the lessons dialog. */
  onOpenLessons: () => void;
  /** Close help and open the schema dialog. */
  onOpenSchema: () => void;
}

const REPO_URL = 'https://github.com/twbdavis/querytrace';
/** Space left above a section's top border when the navigation scrolls to it. */
const JUMP_PAD = 8;

/* --- content ------------------------------------------------------------ */

const SECTIONS: Array<{ id: string; label: string }> = [
  { id: 'overview', label: 'What QueryTrace is' },
  { id: 'screen', label: 'Around the screen' },
  { id: 'stages', label: 'How a query becomes a trace' },
  { id: 'rows', label: 'Follow the rows' },
  { id: 'playback', label: 'Playback and keyboard' },
  { id: 'lessons', label: 'Guided lessons' },
  { id: 'queries', label: 'Write your own queries' },
  { id: 'changes', label: 'Change the data' },
  { id: 'schemas', label: 'Bring your own schema' },
  { id: 'privacy', label: 'Runs in your browser' },
  { id: 'limits', label: 'What it does not do' },
  { id: 'about', label: 'Tips and about' },
];

type StageIcon = ComponentType<{ size?: number; className?: string }>;

const STAGES: Array<{ name: string; Icon: StageIcon; tone: string; what: string; see: string }> = [
  {
    name: 'FROM',
    Icon: DatabaseIcon,
    tone: 'border-accent-active text-accent-active',
    what: 'Load the source tables.',
    see: 'Every table the query names lights up on the canvas. Their rows are the starting set; everything else dims.',
  },
  {
    name: 'JOIN',
    Icon: JoinIcon,
    tone: 'border-accent-active text-accent-active',
    what: 'Match rows across tables.',
    see: 'Wires connect the joined key columns and matched rows light up together. An outer join keeps the rows with no partner and marks the missing side with a dashed gold edge.',
  },
  {
    name: 'WHERE',
    Icon: FilterIcon,
    tone: 'border-accent-filter text-accent-filter',
    what: 'Keep the rows that pass a test.',
    see: 'The columns the condition reads turn gold. Rows that fail drop out of the set, so you can count exactly what survived and why.',
  },
  {
    name: 'GROUP BY',
    Icon: GroupIcon,
    tone: 'border-accent-group text-accent-group',
    what: 'Fold rows into groups.',
    see: 'Each bucket gets its own colour. A summary row in the result maps back to every source row that fed it, not just the first one.',
  },
  {
    name: 'HAVING',
    Icon: HavingIcon,
    tone: 'border-accent-filter text-accent-filter',
    what: 'Filter the finished groups.',
    see: 'The same idea as WHERE, applied after aggregation. Whole buckets fall away instead of single rows.',
  },
  {
    name: 'SELECT',
    Icon: ColumnsIcon,
    tone: 'border-accent-result text-accent-result',
    what: 'Choose the output columns.',
    see: 'The projected columns turn mint, computed columns and aliases are resolved, and the result table fills in.',
  },
  {
    name: 'ORDER BY / LIMIT',
    Icon: SortIcon,
    tone: 'border-line-strong text-ink-dim',
    what: 'Sort and cut the result.',
    see: 'Rows reorder in place and anything past the limit is trimmed. This happens last, which is why you can sort by a column you did not select.',
  },
];

const LEGEND: Array<{ swatch: string; name: string; means: string }> = [
  {
    swatch: 'bg-accent-active',
    name: 'Periwinkle',
    means: 'active tables, join keys, connection wires, the current stage, and rows lit by the trace',
  },
  {
    swatch: 'bg-accent-filter',
    name: 'Gold',
    means: 'columns read by WHERE and HAVING; a dashed gold edge marks a row an outer join kept without a match',
  },
  { swatch: 'bg-accent-group', name: 'Orchid', means: 'GROUP BY columns and the buckets they produce' },
  {
    swatch: 'bg-accent-result',
    name: 'Mint',
    means: 'projected columns, result rows, and the row you are following or have pinned',
  },
  { swatch: 'bg-accent-error', name: 'Rose', means: 'query errors and data changes a constraint rejected' },
];

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl + ↵', 'Run the query (Cmd + ↵ on a Mac)'],
  ['Space', 'Play or pause the trace'],
  ['← →', 'Step one stage back or forward'],
  ['R', 'Return to the first stage'],
  ['Esc', 'Close a dialog'],
];

const DIALECTS: Array<{ name: string; examples: string }> = [
  {
    name: 'MySQL / MariaDB',
    examples: 'RLIKE, DIV, <=>, GROUP_CONCAT ... SEPARATOR, backslash escapes, # comments',
  },
  { name: 'PostgreSQL', examples: 'ILIKE, x::type casts, EXTRACT, IS DISTINCT FROM, NULLS FIRST / LAST' },
  { name: 'SQL Server', examples: "TOP n, [bracketed] names, LEN, GETDATE, CONVERT, N'...' literals" },
  { name: 'Oracle', examples: 'ROWNUM, FETCH FIRST n ROWS ONLY, MINUS, NVL, TO_CHAR, FROM DUAL' },
];

const TIPS = [
  'Point at a row in a table or in the results to light up where it came from. Click or tap to pin the trace so it stays while you scrub.',
  'Queries written the MySQL, PostgreSQL, SQL Server or Oracle way are translated to SQLite. The rewrite appears under the editor so you learn both spellings.',
  'INSERT, UPDATE and DELETE run against the loaded tables and show the rows before and after the change.',
  'Drag tables to rearrange the schema. Pinch or scroll to zoom the canvas.',
  'On larger screens, collapse the query and result panels to give the schema more room.',
  'Run a lesson, then edit its query one clause at a time and run it again. Watching a single change move through the stages is the fastest way to build intuition.',
];

const SCREEN_AREAS: Array<{ Icon: StageIcon; name: string; text: string }> = [
  {
    Icon: DatabaseIcon,
    name: 'Schema canvas',
    text: 'Every table in the loaded schema, drawn as a node with its columns and rows. Keys are marked and foreign keys are wired between tables. Drag to move, scroll or pinch to zoom.',
  },
  {
    Icon: TerminalIcon,
    name: 'Query panel',
    text: 'A SQL editor with highlighting. Run with the RUN button or Ctrl + Enter. Errors, and any rewrites made for SQLite, appear directly beneath it.',
  },
  {
    Icon: TableIcon,
    name: 'Results panel',
    text: 'The output of the current stage, not just the final answer. Point at a result row to see which source rows produced it.',
  },
  {
    Icon: PlayIcon,
    name: 'Playback dock',
    text: 'One chip per stage with a short narration. Play, pause, step, and change speed here. The chips scroll on small screens.',
  },
];

/* --- small pieces ------------------------------------------------------- */

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 font-ui text-[15px] font-bold tracking-tight text-ink">{children}</h3>;
}

function Body({ children }: { children: ReactNode }) {
  return <p className="mb-3 max-w-[62ch] text-[12px] leading-relaxed text-ink-dim last:mb-0">{children}</p>;
}

function Term({ children }: { children: ReactNode }) {
  return <code className="rounded bg-node px-1 py-px font-data text-[11px] text-ink">{children}</code>;
}

function Section({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section
      id={`help-${id}`}
      data-help-section={id}
      aria-labelledby={`help-${id}-title`}
      className="border-t border-line py-6 first:border-t-0 first:pt-0 last:pb-2"
    >
      {children}
    </section>
  );
}

/** Join names into a sentence: "a, b and c." */
function listNames(names: string[]): ReactNode {
  return names.map((name, i) => (
    <span key={name}>
      <span className="text-ink">{name}</span>
      {i < names.length - 2 ? ', ' : i === names.length - 2 ? ' and ' : '.'}
    </span>
  ));
}

/* --- modal ------------------------------------------------------------- */

export function HelpModal({ open, onClose, onOpenLessons, onOpenSchema }: HelpModalProps) {
  const pressedBackdrop = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const jumpTarget = useRef<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(SECTIONS[0].id);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Track which section is under the reader so the navigation follows along.
  // A clicked target stays selected until its scroll settles or the reader takes over.
  useEffect(() => {
    if (!open) return;
    const root = scrollRef.current;
    if (!root) return;
    setActive(SECTIONS[0].id);
    jumpTarget.current = null;
    let frame = 0;
    const update = () => {
      frame = 0;
      const target = jumpTarget.current;
      if (target) {
        const el = root.querySelector<HTMLElement>(`[data-help-section="${target}"]`);
        const maxScroll = root.scrollHeight - root.clientHeight;
        const goal = Math.min(el ? el.offsetTop - JUMP_PAD : 0, maxScroll);
        if (Math.abs(root.scrollTop - goal) < 2) jumpTarget.current = null;
        setActive(target);
        return;
      }
      const line = root.scrollTop + root.clientHeight * 0.35;
      let current = SECTIONS[0].id;
      root.querySelectorAll<HTMLElement>('[data-help-section]').forEach((el) => {
        if (el.offsetTop <= line) current = el.dataset.helpSection ?? current;
      });
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const release = () => {
      jumpTarget.current = null;
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('wheel', release, { passive: true });
    root.addEventListener('touchstart', release, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('wheel', release);
      root.removeEventListener('touchstart', release);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [open]);

  // Keep the selected entry visible in the strip on narrow screens.
  useEffect(() => {
    if (!open) return;
    const btn = navRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [open, active]);

  const jump = (id: string) => {
    const root = scrollRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-help-section="${id}"]`);
    if (!root || !el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    jumpTarget.current = id;
    setActive(id);
    root.scrollTo({ top: el.offsetTop - JUMP_PAD, behavior: reduce ? 'auto' : 'smooth' });
  };

  const primaryBtn =
    'inline-flex cursor-pointer items-center gap-1.5 rounded border border-accent-active bg-accent-active/10 px-3 py-1.5 font-ui text-[10px] font-bold tracking-wider text-accent-active transition-colors hover:bg-accent-active/20 active:translate-y-px max-sm:min-h-10';
  const secondaryBtn =
    'inline-flex cursor-pointer items-center gap-1.5 rounded border border-line-strong px-3 py-1.5 font-ui text-[10px] font-bold tracking-wider text-ink transition-colors hover:border-accent-active hover:text-accent-active active:translate-y-px max-sm:min-h-10';

  if (!open) return null;

  return (
    <div
      className="modal-backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm max-sm:items-end max-sm:p-0"
      // Close only for a press that starts and ends on the backdrop, so a
      // drag that begins inside the dialog (selecting text) never closes it.
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const startedOnBackdrop = pressedBackdrop.current;
        pressedBackdrop.current = false;
        if (startedOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Help"
        className="modal-dialog-enter flex max-h-[88vh] w-full max-w-5xl flex-col rounded-md border border-line-strong bg-panel max-sm:h-[100dvh] max-sm:max-h-none max-sm:rounded-none max-sm:border-0"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3 max-sm:min-h-14 max-sm:px-3 max-sm:pt-[calc(0.75rem+env(safe-area-inset-top))]">
          <span className="inline-flex items-center gap-2 font-ui text-[12px] font-bold uppercase tracking-[0.2em] text-ink">
            <HelpIcon size={14} className="text-accent-active" />
            help
          </span>
          <button
            onClick={onClose}
            aria-label="Close help"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-ink-dim transition-colors hover:bg-white/5 hover:text-ink max-sm:h-9 max-sm:w-9"
          >
            <CloseIcon size={13} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 max-md:flex-col">
          {/* Section navigation: a column on wide screens, a scrolling strip on narrow ones. */}
          <nav
            ref={navRef}
            aria-label="Help sections"
            className="scrollbar-none shrink-0 border-line max-md:flex max-md:gap-1 max-md:overflow-x-auto max-md:border-b max-md:px-3 max-md:py-2 md:w-52 md:overflow-y-auto md:border-r md:px-2 md:py-3"
          >
            {SECTIONS.map((s) => {
              const isActive = s.id === active;
              return (
                <button
                  key={s.id}
                  onClick={() => jump(s.id)}
                  aria-current={isActive ? 'true' : undefined}
                  className={`block cursor-pointer rounded-md text-left font-ui text-[11px] transition-colors max-md:shrink-0 max-md:whitespace-nowrap max-md:border max-md:px-2.5 max-md:py-1.5 md:w-full md:px-2.5 md:py-1.5 ${
                    isActive
                      ? 'bg-accent-active/10 text-accent-active max-md:border-accent-active'
                      : 'text-ink-dim hover:bg-white/5 hover:text-ink max-md:border-line'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </nav>

          <div
            ref={scrollRef}
            className="relative min-h-0 flex-1 overflow-y-auto px-6 py-5 max-sm:px-4 max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]"
          >
            {/* ------------------------------------------------ overview */}
            <Section id="overview">
              <h3
                id="help-overview-title"
                className="mb-3 max-w-[26ch] font-ui text-[22px] font-bold leading-tight tracking-tight text-ink sm:text-[26px]"
              >
                See where every row in a result comes from.
              </h3>
              <Body>
                QueryTrace is a visual SQL learning tool. You write a query, or pick one from a lesson, and instead of
                getting a result table and nothing else, you get the whole story: the tables it touched, the rows it
                matched, the rows it threw away, the groups it built, and the columns it finally kept. Each step is a
                stage you can play, pause, and scrub through like a video.
              </Body>
              <Body>
                It exists because SQL is easy to read and hard to picture. A textbook tells you a{' '}
                <Term>LEFT JOIN</Term> keeps unmatched rows. QueryTrace shows you the exact unmatched rows, dashed in
                gold, sitting in the result with nulls beside them. Once you have seen that, you do not forget it.
              </Body>
              <div className="my-4 grid gap-3 sm:grid-cols-[1.4fr_1fr]">
                <div className="rounded-md border border-line bg-node p-3">
                  <div className="mb-1 font-ui text-[12px] font-bold text-ink">Who it is for</div>
                  <ul className="space-y-1 text-[11px] leading-relaxed text-ink-dim">
                    <li>Students meeting joins, grouping, and subqueries for the first time.</li>
                    <li>Instructors who want to show a query stage by stage on a projector.</li>
                    <li>Developers who know SQL but want to check what a tricky query really does.</li>
                  </ul>
                </div>
                <div className="rounded-md border border-line bg-node p-3">
                  <div className="mb-1 font-ui text-[12px] font-bold text-ink">What it costs</div>
                  <p className="text-[11px] leading-relaxed text-ink-dim">
                    Nothing. No account, no sign-up, no server. It is open source under the MIT license and the
                    database runs inside this browser tab.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={onOpenLessons} className={primaryBtn}>
                  <BookIcon size={11} />
                  OPEN LESSONS
                </button>
                <button onClick={onOpenSchema} className={secondaryBtn}>
                  <DatabaseIcon size={11} />
                  LOAD A SCHEMA
                </button>
              </div>
            </Section>

            {/* ------------------------------------------------ screen */}
            <Section id="screen">
              <Heading>
                <span id="help-screen-title">Around the screen</span>
              </Heading>
              <Body>
                The schema fills the whole window. Everything else floats above it and can be collapsed when you want
                more room.
              </Body>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {SCREEN_AREAS.map(({ Icon, name, text }) => (
                  <div key={name} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line text-accent-active">
                      <Icon size={12} />
                    </span>
                    <div>
                      <dt className="font-ui text-[12px] font-bold text-ink">{name}</dt>
                      <dd className="text-[11px] leading-relaxed text-ink-dim">{text}</dd>
                    </div>
                  </div>
                ))}
              </dl>
              <p className="mt-3 max-w-[62ch] text-[12px] leading-relaxed text-ink-dim">
                <span className="text-ink">Top bar:</span> SCHEMA opens the schema builder, LESSONS opens the guided
                lessons, and the question mark opens this help. On a phone the query and results live in a sheet at
                the bottom of the screen.
              </p>
            </Section>

            {/* ------------------------------------------------ stages */}
            <Section id="stages">
              <Heading>
                <span id="help-stages-title">How a query becomes a trace</span>
              </Heading>
              <Body>
                A database does not read a query top to bottom. It starts with the tables, joins them, filters, groups,
                filters again, and only then picks columns and sorts. QueryTrace runs your query in exactly that order
                and stops after each stage so you can see what the data looks like at that moment.
              </Body>
              <ol className="my-4 max-w-[78ch] space-y-2">
                {STAGES.map(({ name, Icon, tone, what, see }) => (
                  <li key={name} className="flex gap-3">
                    <span
                      className={`mt-0.5 inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-2 font-ui text-[9px] font-bold tracking-wider ${tone}`}
                    >
                      <Icon size={11} />
                      {name}
                    </span>
                    <p className="text-[11px] leading-relaxed text-ink-dim">
                      <span className="text-ink">{what}</span> {see}
                    </p>
                  </li>
                ))}
              </ol>
              <Body>
                Three more chips show up when the query calls for them. <Term>INNER</Term> traces a subquery, derived
                table, or CTE branch on its own before the outer query uses it. <Term>UNION</Term> stacks the branches
                of a set operation. <Term>APPLY</Term> is the moment an INSERT, UPDATE or DELETE actually changes the
                tables.
              </Body>
              <Body>
                Every stage keeps a complete record of which source rows are still in play, so scrubbing backwards
                restores earlier states exactly. Nothing is approximated or animated for effect; the highlights are
                computed from the real rows.
              </Body>
            </Section>

            {/* ------------------------------------------------ rows */}
            <Section id="rows">
              <Heading>
                <span id="help-rows-title">Follow the rows</span>
              </Heading>
              <Body>
                This is the part that makes QueryTrace different from running a query anywhere else. Point at any row,
                in a table or in the results, and everything connected to it lights up at once: the rows it came from
                in other tables, the wires between them, and the result rows it contributed to.
              </Body>
              <div className="my-4 flex items-start gap-3 rounded-md border border-line bg-node p-3">
                <CrosshairIcon size={16} className="mt-0.5 shrink-0 text-accent-result" />
                <div className="text-[11px] leading-relaxed text-ink-dim">
                  <span className="text-ink">Hover to preview, click to pin.</span> A pinned row keeps its highlight
                  while you step through the stages, so you can watch one customer, one order, or one measurement
                  travel from its table all the way into the result. Click it again, or click empty canvas, to release
                  it. You can still hover other rows while one is pinned.
                </div>
              </div>
              <div className="mb-2 font-ui text-[12px] font-bold text-ink">What the colours mean</div>
              <ul className="space-y-1.5">
                {LEGEND.map(({ swatch, name, means }) => (
                  <li key={name} className="flex items-baseline gap-2.5 text-[11px] leading-relaxed text-ink-dim">
                    <span className={`relative top-px inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${swatch}`} />
                    <span>
                      <span className="text-ink">{name}:</span> {means}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>

            {/* ------------------------------------------------ playback */}
            <Section id="playback">
              <Heading>
                <span id="help-playback-title">Playback and keyboard</span>
              </Heading>
              <Body>
                A trace plays like a short film with one frame per stage. Play it through once to get the shape of the
                query, then step through it slowly and watch a single row. The dock offers half, normal, and double
                speed; the narration under each chip says what that stage kept or dropped and how many rows are left.
              </Body>
              <dl className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
                {SHORTCUTS.map(([keys, what]) => (
                  <div key={what} className="flex items-center justify-between gap-3 border-b border-line/60 py-1">
                    <dt>
                      <kbd className="whitespace-nowrap">{keys}</kbd>
                    </dt>
                    <dd className="text-right text-[11px] text-ink-dim">{what}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 max-w-[62ch] text-[12px] leading-relaxed text-ink-dim">
                Playback shortcuts pause while you are typing in the editor, so Space and the arrow keys behave
                normally there.
              </p>
            </Section>

            {/* ------------------------------------------------ lessons */}
            <Section id="lessons">
              <Heading>
                <span id="help-lessons-title">Guided lessons</span>
              </Heading>
              <Body>
                {LESSONS.length} lessons take you from choosing columns to feeding one query into another. Each one
                names the idea it teaches, gives you a query that shows it, and ends with a small change to try. The
                first group, Foundations, covers filtering, calculation, patterns, DISTINCT, aggregates, GROUP BY and
                HAVING. The second, Combining data, covers joins in every form, self-joins, set operations, and
                subqueries.
              </Body>
              <Body>
                <span className="text-ink">RUN</span> loads the right schema, restores its original rows if you changed
                them, and plays the trace. <span className="text-ink">LOAD INTO EDITOR</span> puts the query in the
                editor without running it, so you can edit it first. Lessons you have run get a check mark, and that
                progress is kept in this browser.
              </Body>
              <button onClick={onOpenLessons} className={primaryBtn}>
                <BookIcon size={11} />
                OPEN LESSONS
              </button>
            </Section>

            {/* ------------------------------------------------ queries */}
            <Section id="queries">
              <Heading>
                <span id="help-queries-title">Write your own queries</span>
              </Heading>
              <Body>
                Anything you would write in an introductory or intermediate course traces in full: SELECT and DISTINCT,
                comparisons with AND, OR, NOT and parentheses, LIKE, IN, BETWEEN, IS NULL, computed columns, CASE,
                aliases, the five standard aggregates, GROUP BY and HAVING, ORDER BY in mixed directions, LIMIT, inner,
                left, right, full and cross joins, comma-style and multi-table joins, self-joins, UNION, INTERSECT and
                EXCEPT, correlated and uncorrelated subqueries, derived tables, CTEs, and window functions such as{' '}
                <Term>ROW_NUMBER() OVER (...)</Term>.
              </Body>
              <Body>
                Names are checked against the schema before anything runs. A misspelled column is reported as an error,
                with a pointer to the table that does hold it, instead of silently becoming a text literal. A column
                that exists in two joined tables is reported with the qualifiers you can use.
              </Body>
              <div className="mb-2 font-ui text-[12px] font-bold text-ink">Write it the way you learned it</div>
              <Body>
                The engine underneath is SQLite, but you do not have to write SQLite. Queries in the spelling of the
                four big databases are translated before they run, and each rewrite is listed under the editor, so you
                see both the dialect you know and the portable form. Functions SQLite lacks, such as{' '}
                <Term>YEAR</Term>, <Term>DATE_FORMAT</Term>, <Term>DATEDIFF</Term>, <Term>LEFT</Term>, <Term>NVL</Term>{' '}
                and <Term>TO_CHAR</Term>, are provided too.
              </Body>
              <dl className="grid gap-2 sm:grid-cols-2">
                {DIALECTS.map(({ name, examples }) => (
                  <div key={name} className="rounded-md border border-line bg-node px-3 py-2">
                    <dt className="font-ui text-[11px] font-bold text-ink">{name}</dt>
                    <dd className="font-data text-[10px] leading-relaxed text-ink-dim">{examples}</dd>
                  </div>
                ))}
              </dl>
            </Section>

            {/* ------------------------------------------------ changes */}
            <Section id="changes">
              <Heading>
                <span id="help-changes-title">Change the data</span>
              </Heading>
              <Body>
                <Term>INSERT</Term>, <Term>UPDATE</Term> and <Term>DELETE</Term> run in the same editor and get their
                own stages: the table as it was, the rows the WHERE clause selected, and then the applied change with
                every table it touched, including rows removed or nulled by <Term>ON DELETE CASCADE</Term> and{' '}
                <Term>SET NULL</Term>. It is the clearest way to see what a cascade actually does.
              </Body>
              <Body>
                Each statement runs inside a savepoint. If a primary key, NOT NULL, CHECK or foreign key constraint
                rejects it, the change is rolled back and the reason is spelled out. Changes to a bundled schema last
                for the session and lessons restore the original rows before they run. Changes to a schema you imported
                are saved with it.
              </Body>
            </Section>

            {/* ------------------------------------------------ schemas */}
            <Section id="schemas">
              <Heading>
                <span id="help-schemas-title">Bring your own schema</span>
              </Heading>
              <Body>
                {PRELOADED_SCHEMAS.length} bundled schemas ship with the app, each a small fictional world with a few
                related tables: {listNames(PRELOADED_SCHEMAS.map((s) => s.name))} They are small enough to read at a
                glance and rich enough to make joins interesting.
              </Body>
              <Body>
                When you want your own tables, paste a SQL script into the schema builder. It accepts{' '}
                <Term>CREATE TABLE</Term>, <Term>INSERT</Term>, <Term>UPDATE</Term>, <Term>DELETE</Term>,{' '}
                <Term>CREATE INDEX</Term> and <Term>ALTER TABLE</Term> as exported by MySQL Workbench, phpMyAdmin,
                pgAdmin, pg_dump, SQL Server Management Studio or Oracle tools. Engine options, column attributes,
                identity columns, casts, GO separators and schema prefixes are translated automatically. Text pasted
                from Word or e-mail is repaired too.
              </Body>
              <Body>
                Statements run one at a time, so an error names the statement that failed and the builder selects it
                in your script. Rows may be inserted before their parents, as dumps do; the script is accepted when the
                final state satisfies every foreign key. Custom schemas are saved in this browser so they are waiting
                for you next time.
              </Body>
              <button onClick={onOpenSchema} className={secondaryBtn}>
                <DatabaseIcon size={11} />
                LOAD A SCHEMA
              </button>
            </Section>

            {/* ------------------------------------------------ privacy */}
            <Section id="privacy">
              <Heading>
                <span id="help-privacy-title">Runs in your browser</span>
              </Heading>
              <Body>
                The database is SQLite compiled to WebAssembly, running in a Web Worker inside this tab. Your queries
                and your schema scripts never leave your computer. There is no account and nothing to configure, which
                also means it works in a classroom without anyone provisioning anything.
              </Body>
              <Body>
                Lesson progress, imported schemas, and the editor draft are saved in browser storage when it is
                available. That storage belongs to this browser profile on this device. Clearing site data removes it,
                and a private window starts fresh. If you want to keep a schema, keep the script.
              </Body>
            </Section>

            {/* ------------------------------------------------ limits */}
            <Section id="limits">
              <Heading>
                <span id="help-limits-title">What it does not do</span>
              </Heading>
              <Body>
                QueryTrace teaches the logical order of a query. It is not a display of SQLite&apos;s internal query
                plan, and it says nothing about indexes or performance. A real engine may evaluate things in a
                different physical order and still produce the same rows.
              </Body>
              <Body>
                Compound and derived-table queries show each branch&apos;s result and the exact final result rather
                than a full row-by-row trace through every level. Constructs SQLite cannot express, such as{' '}
                <Term>DISTINCT ON</Term>, <Term>NATURAL JOIN</Term>, <Term>ROLLUP</Term>, window frames and session
                variables, are refused with the alternative spelled out. Structural statements such as CREATE and ALTER
                belong in the schema builder, and the editor will send you there.
              </Body>
            </Section>

            {/* ------------------------------------------------ tips + about */}
            <Section id="about">
              <Heading>
                <span id="help-about-title">Tips</span>
              </Heading>
              <ul className="mb-6 max-w-[62ch] space-y-1.5 text-[11px] leading-relaxed text-ink-dim">
                {TIPS.map((tip) => (
                  <li key={tip} className="flex gap-2">
                    <EditIcon size={11} className="mt-0.5 shrink-0 text-accent-active" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
              <Heading>About</Heading>
              <Body>
                QueryTrace is a personal learning project by Thomas Davis, released under the MIT license. It is built
                with Next.js, React, SQLite compiled to WebAssembly, React Flow and CodeMirror, and every change runs
                through a trace-engine test suite and browser checks in Chromium, Firefox and WebKit before it ships.
                All bundled scenarios and records are fictional.
              </Body>
              <div className="flex flex-wrap gap-2">
                <a href={REPO_URL} target="_blank" rel="noreferrer" className={secondaryBtn}>
                  SOURCE ON GITHUB
                </a>
                <a href={`${REPO_URL}/issues/new/choose`} target="_blank" rel="noreferrer" className={secondaryBtn}>
                  REPORT A BUG
                </a>
                <a
                  href={`${REPO_URL}/blob/main/docs/architecture.md`}
                  target="_blank"
                  rel="noreferrer"
                  className={secondaryBtn}
                >
                  HOW TRACING WORKS
                </a>
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
