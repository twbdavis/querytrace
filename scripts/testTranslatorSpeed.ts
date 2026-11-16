/* Long pastes must translate in a blink. Each shape repeats one construct the
   translator rewrites until the query is close to the 20,000 character limit,
   then times the translation under every profile that reads the construct.
   The bound is far above the measured time so a slow machine does not fail it,
   and far below what a loop that re-reads the whole query per construct costs.
   Run with: npm run test:speed */
import { translateQuery } from '../lib/dialect';
import { prepareParserEncodings } from '../lib/parserEncodings';
import type { SourceDialect } from '../lib/queryCompatibility';

const LIMIT_CHARS = 19_500;
const BOUND_MS = 1_500;

interface Shape {
  label: string;
  dialects: SourceDialect[];
  build: (n: number) => string;
  /** True when every occurrence was rewritten: no rewrite may stop part-way through a long query. */
  settled?: (translated: string, dialect: SourceDialect) => boolean;
}

const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

const list = (n: number, item: (i: number) => string) => Array.from({ length: n }, (_, i) => item(i)).join(', ');

const SHAPES: Shape[] = [
  { label: 'x::type casts', dialects: ['postgresql', 'legacy'], build: (n) => `SELECT ${list(n, (i) => `ATTENDEE_ID::text AS c${i}`)} FROM ATTENDEE`, settled: (sql) => !sql.includes('::') },
  { label: 'chained casts', dialects: ['postgresql'], build: (n) => `SELECT ${list(n, (i) => `ATTENDEE_ID::integer::text::varchar(5) AS c${i}`)} FROM ATTENDEE`, settled: (sql) => !sql.includes('::') },
  { label: 'date arithmetic', dialects: ['postgresql', 'oracle', 'legacy'], build: (n) => `SELECT ${list(n, (i) => `'2025-01-${String((i % 28) + 1).padStart(2, '0')}' - '2025-01-01' AS c${i}`)} FROM ATTENDEE`, settled: (sql) => count(sql, /DATEDIFF[(]/g) === count(sql, / AS c[0-9]+/g) },
  { label: 'INTERVAL arithmetic', dialects: ['mysql', 'postgresql', 'legacy'], build: (n) => `SELECT ${list(n, (i) => `DATE_ADD('2024-01-01', INTERVAL ${i} DAY) AS c${i}`)} FROM ATTENDEE` },
  { label: '+ on strings', dialects: ['sqlserver', 'legacy'], build: (n) => `SELECT ${list(n, (i) => `'a${i}' + GIVEN_NAME + '!' AS c${i}`)} FROM ATTENDEE`, settled: (sql) => !sql.includes('+') },
  { label: '|| as OR', dialects: ['mysql', 'mariadb'], build: (n) => `SELECT ${list(n, (i) => `ATTENDEE_ID = ${i} || ATTENDEE_ID = ${i + 1} AS c${i}`)} FROM ATTENDEE`, settled: (sql) => !sql.includes('||') },
  { label: 'ILIKE', dialects: ['postgresql', 'legacy'], build: (n) => `SELECT GIVEN_NAME FROM ATTENDEE WHERE ${Array.from({ length: n }, (_, i) => `GIVEN_NAME ILIKE 'a${i}%'`).join(' OR ')}`, settled: (sql) => !/ILIKE/i.test(sql) },
  { label: 'LIKE backslash escapes', dialects: ['mysql', 'postgresql'], build: (n) => `SELECT GIVEN_NAME FROM ATTENDEE WHERE ${Array.from({ length: n }, (_, i) => `GIVEN_NAME LIKE 'a${i}\\_%'`).join(' OR ')}`, settled: (sql) => count(sql, /ESCAPE/g) === count(sql, /LIKE/g) },
  { label: 'LOWER / UPPER', dialects: ['mysql', 'postgresql', 'sqlserver', 'oracle'], build: (n) => `SELECT ${list(n, (i) => `LOWER(GIVEN_NAME) || UPPER(CITY) AS c${i}`)} FROM ATTENDEE` },
  { label: 'GREATEST / LEAST', dialects: ['postgresql', 'sqlserver', 'mysql'], build: (n) => `SELECT ${list(n, (i) => `GREATEST(ATTENDEE_ID, ${i}, LEAST(${i}, 3)) AS c${i}`)} FROM ATTENDEE` },
  { label: 'function renames', dialects: ['legacy', 'mysql', 'oracle'], build: (n) => `SELECT ${list(n, (i) => `IFNULL(NVL(GIVEN_NAME, 'x'), CONCAT('a', '${i}')) AS c${i}`)} FROM ATTENDEE` },
  { label: 'GROUP_CONCAT / STRING_AGG', dialects: ['mysql', 'postgresql', 'sqlserver'], build: (n) => `SELECT ${list(n, (i) => `GROUP_CONCAT(GIVEN_NAME ORDER BY GIVEN_NAME SEPARATOR '${i}') AS c${i}`)} FROM ATTENDEE` },
  { label: '"text" strings', dialects: ['mysql', 'mariadb'], build: (n) => `SELECT ${list(n, (i) => `"value ${i}" AS c${i}`)} FROM ATTENDEE` },
  { label: '[bracketed] names', dialects: ['sqlserver', 'legacy'], build: (n) => `SELECT ${list(n, (i) => `[GIVEN_NAME] AS [c ${i}]`)} FROM [ATTENDEE]` },
  { label: 'window frames', dialects: ['postgresql', 'legacy'], build: (n) => `SELECT ${list(n, (i) => `SUM(ATTENDEE_ID) OVER (ORDER BY ATTENDEE_ID ROWS BETWEEN ${i % 5} PRECEDING AND CURRENT ROW) AS c${i}`)} FROM ATTENDEE` },
  { label: 'aggregate FILTER', dialects: ['postgresql', 'legacy'], build: (n) => `SELECT ${list(n, (i) => `COUNT(*) FILTER (WHERE ATTENDEE_ID > ${i}) AS c${i}`)} FROM ATTENDEE` },
  { label: 'named windows', dialects: ['postgresql', 'legacy'], build: (n) => `SELECT ${list(n, (i) => `SUM(ATTENDEE_ID) OVER w AS c${i}`)} FROM ATTENDEE WINDOW w AS (ORDER BY ATTENDEE_ID)` },
  { label: 'nested TOP', dialects: ['sqlserver'], build: (n) => `SELECT GIVEN_NAME FROM ATTENDEE WHERE ${Array.from({ length: n }, (_, i) => `ATTENDEE_ID IN (SELECT TOP ${(i % 9) + 1} ATTENDEE_ID FROM RESERVATION)`).join(' OR ')}`, settled: (sql) => !/TOP/i.test(sql) },
  { label: 'UNION ALL chain', dialects: ['legacy', 'oracle'], build: (n) => Array.from({ length: n }, (_, i) => `SELECT GIVEN_NAME, ${i} AS n FROM ATTENDEE WHERE ATTENDEE_ID = 301`).join(' UNION ALL ') },
  { label: 'wide IN list', dialects: ['legacy', 'mysql'], build: (n) => `SELECT GIVEN_NAME FROM ATTENDEE WHERE ATTENDEE_ID IN (${list(n, (i) => String(i))})` },
  { label: 'CASE with LIKE', dialects: ['postgresql', 'mysql'], build: (n) => `SELECT ${list(n, (i) => `CASE WHEN GIVEN_NAME LIKE 'a${i}%' THEN 1 ELSE 0 END AS c${i}`)} FROM ATTENDEE` },
  { label: 'comments', dialects: ['mysql', 'legacy'], build: (n) => `SELECT GIVEN_NAME FROM ATTENDEE WHERE 1 = 1${Array.from({ length: n }, (_, i) => `\n  AND ATTENDEE_ID <> ${i} # note ${i}`).join('')}` },
];

/** The largest repetition count whose query still fits the editor's limit. */
function sized(build: (n: number) => string): string {
  let low = 1;
  let high = 2;
  while (build(high).length <= LIMIT_CHARS) { low = high; high *= 2; }
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (build(middle).length <= LIMIT_CHARS) low = middle;
    else high = middle;
  }
  return build(low);
}

let pass = 0;
let fail = 0;
const failures: string[] = [];
let slowest = { label: '', ms: 0 };

for (const shape of SHAPES) {
  const sql = sized(shape.build);
  for (const dialect of shape.dialects) {
    const started = performance.now();
    let outcome = 'translated';
    let unsettled = false;
    try {
      const translated = translateQuery(sql, { dialect });
      prepareParserEncodings(translated.sql);
      unsettled = shape.settled ? !shape.settled(translated.sql, dialect) : false;
      if (unsettled) outcome = 'STOPPED PART-WAY';
    } catch (error) {
      // A refusal is a valid outcome here; only the time it took is under test.
      outcome = `refused (${(error as Error).message.slice(0, 50)})`;
    }
    const ms = performance.now() - started;
    const label = `${shape.label} under ${dialect}`;
    if (ms > slowest.ms) slowest = { label, ms };
    const line = `${label.padEnd(42)} ${String(sql.length).padStart(6)} chars ${ms.toFixed(0).padStart(6)} ms  ${outcome}`;
    if (ms <= BOUND_MS && !unsettled) {
      pass++;
      console.log(`  ok   ${line}`);
    } else {
      fail++;
      failures.push(line);
      console.log(`  FAIL ${line}`);
    }
  }
}

console.log(`\nSlowest: ${slowest.label} at ${slowest.ms.toFixed(0)} ms (bound ${BOUND_MS} ms).`);
console.log(`=== ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const failure of failures) console.log(`  ${failure}`);
}
process.exit(fail ? 1 : 0);
