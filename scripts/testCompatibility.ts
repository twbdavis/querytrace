/* Compatibility suite: the goal criteria G3-G12 of docs/compatibility-review.md.
   Feature fixtures run through the real SqlRuntime; the unit checks cover the
   parser encodings, clause highlighting, saved-state migration and lesson
   portability across every dialect profile.
   Run with: npm run test:compat */
import { computeClauseRanges } from '../lib/clauseRanges';
import { LESSONS, lessonDialect, lessonForDialect } from '../lib/lessons';
import { prepareParserEncodings, restoreParserEncodings } from '../lib/parserEncodings';
import { normalizeState } from '../lib/persistence';
import { SOURCE_DIALECTS, type SourceDialect } from '../lib/queryCompatibility';
import { PRELOADED_SCHEMAS, schemaById } from '../lib/schemas';
import { SqlRuntime } from '../lib/sqlRuntime';
import { runSchema, summary } from './dialectHarness';
import { PROBES } from './dialectCases/compatibility';
import { TEXT_PROBES } from './dialectCases/text';

let unitPass = 0;
let unitFail = 0;
const unitFailures: string[] = [];

function check(condition: boolean, message: string) {
  if (condition) unitPass++;
  else {
    unitFail++;
    unitFailures.push(message);
    console.log(`  FAIL ${message}`);
  }
}

function encodingRoundTrips() {
  console.log('\n=== parser encodings round-trip');
  const cases: Array<[string, string]> = [
    ['SELECT COUNT(*) FILTER (WHERE p = 1) FROM t', 'SELECT COUNT(*) FILTER (WHERE p = 1) FROM t'],
    ["SELECT GROUP_CONCAT(x, ',') FILTER (WHERE p = 1) FROM t", "SELECT GROUP_CONCAT(x, ',') FILTER (WHERE p = 1) FROM t"],
    ['SELECT SUM(a) OVER (PARTITION BY g ORDER BY id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) FROM t', 'SELECT SUM(a) OVER (PARTITION BY g ORDER BY id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) FROM t'],
    ['SELECT SUM(a) OVER (PARTITION BY NULL ORDER BY id ROWS UNBOUNDED PRECEDING) FROM t', 'SELECT SUM(a) OVER (PARTITION BY NULL ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM t'],
    ["SELECT 'FILTER (WHERE x)' AS t, COUNT(*) FILTER (WHERE p = 1) OVER (PARTITION BY NULL ORDER BY id ROWS BETWEEN 2 PRECEDING AND 1 FOLLOWING) FROM t", "SELECT 'FILTER (WHERE x)' AS t, COUNT(*) FILTER (WHERE p = 1) OVER (PARTITION BY NULL ORDER BY id ROWS BETWEEN 2 PRECEDING AND 1 FOLLOWING) FROM t"],
  ];
  for (const [input, expected] of cases) {
    const encoded = prepareParserEncodings(input);
    check(!/\bFILTER\s*\(|\bROWS\b/i.test(encoded.sql.replace(/'[^']*'/g, "''")), `encoded form has no native syntax outside literals: ${encoded.sql}`);
    const restored = restoreParserEncodings(encoded.sql).replace(/\s+/g, ' ');
    check(restored === expected, `round trip\n       got      ${restored}\n       expected ${expected}`);
  }
  check(restoreParserEncodings('SELECT 1') === 'SELECT 1', 'restore is a no-op without markers');
}

function clauseHighlighting() {
  console.log('\n=== clause ranges are scope-aware');
  const filtered = 'SELECT COUNT(*) FILTER (WHERE p = 1) AS n FROM sale WHERE id > 1';
  const ranges = computeClauseRanges(filtered);
  check(ranges.where?.start === filtered.lastIndexOf('WHERE'), `FILTER (WHERE ...) is not the outer WHERE: ${JSON.stringify(ranges.where)}`);
  const framed = 'SELECT id, SUM(amount) OVER (ORDER BY id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS s FROM sale ORDER BY id';
  const frameRanges = computeClauseRanges(framed);
  check(frameRanges.orderLimit?.start === framed.lastIndexOf('ORDER BY'), `window ORDER BY is not the outer ORDER BY: ${JSON.stringify(frameRanges.orderLimit)}`);
  check(frameRanges.select?.end === framed.indexOf(' FROM'), `SELECT range spans the window expression: ${JSON.stringify(frameRanges.select)}`);
  const cte = 'WITH t AS (SELECT id FROM sale WHERE id > 2) SELECT id FROM t WHERE id < 5';
  const cteRanges = computeClauseRanges(cte);
  check(cteRanges.where?.start === cte.lastIndexOf('WHERE'), `CTE body WHERE is not the outer WHERE: ${JSON.stringify(cteRanges.where)}`);
  const plain = 'SELECT a, b FROM t WHERE a > 1 GROUP BY a HAVING COUNT(*) > 1 ORDER BY a LIMIT 2';
  const plainRanges = computeClauseRanges(plain);
  check(plainRanges.groupBy?.start === plain.indexOf('GROUP BY') && plainRanges.having?.start === plain.indexOf('HAVING') && plainRanges.orderLimit?.start === plain.indexOf('ORDER BY'), 'simple SELECT ranges are unchanged');
}

function savedStateMigration() {
  console.log('\n=== saved state keeps lesson progress and validates the dialect');
  const old = normalizeState({ version: 3, customRevision: 2, lastSchemaId: 'festival', ranLessons: { projection: true, where: true } });
  check(!!old && old.version === 3, 'STATE_VERSION is unchanged');
  check(!!old && Object.keys(old.ranLessons).length === 2, 'a state saved before the dialect existed keeps ranLessons');
  check(!!old && old.lastSchemaId === 'festival', 'a state saved before the dialect existed keeps its schema');
  check(old?.queryDialect === 'legacy', `missing dialect defaults to legacy (got ${old?.queryDialect})`);
  const bogus = normalizeState({ version: 3, customRevision: 0, lastSchemaId: 'observatory', ranLessons: { projection: true }, queryDialect: 'db2' });
  check(bogus?.queryDialect === 'legacy', 'an unknown dialect value falls back to legacy');
  check(!!bogus && bogus.ranLessons.projection === true, 'an unknown dialect value does not disturb progress');
  const mysql = normalizeState({ version: 3, customRevision: 0, lastSchemaId: 'observatory', ranLessons: {}, queryDialect: 'mysql' });
  check(mysql?.queryDialect === 'mysql', 'a known dialect value is kept');
  const older = normalizeState({ version: 2, lastSchemaId: 'observatory', ranLessons: { projection: true } });
  check(!!older && Object.keys(older.ranLessons).length === 0 && older.queryDialect === 'legacy', 'the older-curriculum rule is unchanged');
}

/** Hand-computed rows where a vendor reads a lesson's portable spelling differently from the other profiles. */
const CASE_SENSITIVE_THE = JSON.stringify([['Signal from the Attic', 'Thriller']]);
const VENDOR_MEANING: Record<string, Partial<Record<SourceDialect, string>>> = {
  'like-in-between': { postgresql: CASE_SENSITIVE_THE, oracle: CASE_SENSITIVE_THE },
};

async function lessonsUnderEveryProfile() {
  console.log('\n=== lessons return the same rows under every profile');
  const runtimes = new Map<string, SqlRuntime>();
  for (const definition of PRELOADED_SCHEMAS) {
    const runtime = new SqlRuntime();
    await runtime.loadSchema(definition);
    runtimes.set(definition.id, runtime);
  }
  for (const lesson of LESSONS) {
    const runtime = runtimes.get(lesson.schemaId);
    const definition = schemaById(lesson.schemaId);
    if (!runtime || !definition) {
      check(false, `lesson ${lesson.id} names an unknown schema ${lesson.schemaId}`);
      continue;
    }
    let reference: string | null = null;
    const runAs = async (query: string, dialect: SourceDialect): Promise<string> => {
      try {
        const run = runtime.runQuery(query, { dialect });
        if (run.mutation) await runtime.loadSchema(definition);
        return JSON.stringify(run.trace.at(-1)?.partialResult?.rows ?? null);
      } catch (error) {
        return `ERROR ${(error as Error).message}`;
      }
    };
    for (const dialect of SOURCE_DIALECTS) {
      // The portable spelling must mean the same thing under every profile,
      // except where the vendor itself reads it differently: PostgreSQL and
      // Oracle compare letter case in LIKE, so '%the%' misses "The Last
      // Pollinator" there. Those profiles show a variant, checked below.
      const rows = await runAs(lesson.query, dialect);
      if (reference === null) reference = rows;
      const vendorMeaning = VENDOR_MEANING[lesson.id]?.[dialect];
      check(rows === (vendorMeaning ?? reference), `lesson ${lesson.id} under ${dialect}: ${rows.slice(0, 120)} != ${(vendorMeaning ?? reference).slice(0, 120)}`);
      if (vendorMeaning) check(lessonForDialect(lesson, dialect).variant, `lesson ${lesson.id} has a ${dialect} variant because its portable spelling means something else there`);
      // A vendor variant must return the portable lesson's rows under its own profile.
      const shown = lessonForDialect(lesson, dialect);
      if (!shown.variant) continue;
      check(shown.query.trimEnd().endsWith(';'), `lesson ${lesson.id} ${dialect} variant ends with a semicolon`);
      check(shown.query !== lesson.query, `lesson ${lesson.id} ${dialect} variant differs from the portable spelling`);
      const variantRows = await runAs(shown.query, dialect);
      check(variantRows === reference, `lesson ${lesson.id} ${dialect} variant: ${variantRows.slice(0, 120)} != ${reference.slice(0, 120)}`);
    }
    const expectedKeys = { sqlite: 'sqlite', mysql: 'mysql', mariadb: 'mysql', postgresql: 'postgresql', sqlserver: 'sqlserver', oracle: 'oracle' } as const;
    for (const [profile, key] of Object.entries(expectedKeys)) {
      check(lessonDialect(profile as SourceDialect) === key, `${profile} shows the ${key} lesson spelling`);
    }
    check(lessonDialect('legacy') === null, 'the legacy profile shows the portable spelling');
  }
  for (const runtime of runtimes.values()) runtime.close();
}

/** The note beside the result must say which LIKE ran: the profile's, or SQLite's when an index pins it. */
async function likeNotes() {
  console.log('\n=== LIKE notes say which rules ran');
  const build = async (extra: string) => {
    const runtime = new SqlRuntime();
    await runtime.loadSchema({
      id: 'custom', name: 'LIKE notes', description: '', starterQuery: 'SELECT * FROM t',
      ddl: `CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO t VALUES (1, 'Anna'), (2, 'abe'); ${extra}`,
    });
    return runtime;
  };
  const likeNote = (runtime: SqlRuntime, dialect: SourceDialect) =>
    runtime.runQuery("SELECT name FROM t WHERE name LIKE 'a%' ORDER BY id", { dialect });
  const plain = await build('');
  const free = likeNote(plain, 'postgresql');
  check(JSON.stringify(free.trace.at(-1)?.partialResult?.rows) === '[["abe"]]', 'PostgreSQL LIKE compares letter case on an ordinary schema');
  check(free.notes.some((note) => note.from === 'LIKE' && /comparing letter case as PostgreSQL does/.test(note.to)), 'the note names PostgreSQL rules');
  check(!likeNote(plain, 'mysql').notes.some((note) => note.from === 'LIKE'), 'MySQL LIKE on an ordinary schema needs no note');
  plain.close();

  const indexed = await build("CREATE INDEX t_a ON t (id) WHERE name LIKE 'A%';");
  for (const dialect of ['postgresql', 'oracle', 'mysql', 'sqlserver'] as SourceDialect[]) {
    const pinned = likeNote(indexed, dialect);
    check(JSON.stringify(pinned.trace.at(-1)?.partialResult?.rows) === '[["Anna"],["abe"]]', `an index on LIKE keeps SQLite's LIKE under ${dialect}`);
    const notes = pinned.notes.filter((note) => note.from === 'LIKE');
    check(notes.length === 1 && /cannot follow .+ rules here/.test(notes[0].to), `the note under ${dialect} says LIKE kept SQLite's meaning (got ${JSON.stringify(notes)})`);
  }
  check(!likeNote(indexed, 'sqlite').notes.some((note) => note.from === 'LIKE'), 'SQLite mode needs no note on the indexed schema');
  indexed.close();
}

async function main() {
  for (const probe of [...PROBES, ...TEXT_PROBES]) await runSchema(probe.def, probe.label, probe.cases);
  await likeNotes();
  encodingRoundTrips();
  clauseHighlighting();
  savedStateMigration();
  await lessonsUnderEveryProfile();
  const fixtures = summary();
  const pass = fixtures.pass + unitPass;
  const fail = fixtures.fail + unitFail;
  console.log(`\n=== ${pass} passed, ${fail} failed`);
  const failures = [...fixtures.failures, ...unitFailures];
  if (failures.length) {
    console.log('\nFAILURES:');
    for (const failure of failures) console.log(`  ${failure}`);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
