/* Differential check against a real PostgreSQL (PGlite: PostgreSQL compiled to
   WebAssembly, run in this process). Every query QueryTrace shows or accepts in
   PostgreSQL mode is run twice: through the real SqlRuntime under the
   `postgresql` profile, and on PostgreSQL itself with the same tables and
   rows. The two results must match.

   This replaces "hand-computed from the documentation" with the engine's own
   answer for one of the five vendors. MySQL, MariaDB, SQL Server and Oracle
   have no in-process build and stay hand-computed.

   Run with: npm run test:postgres */
import { PGlite, types } from '@electric-sql/pglite';
import { LESSONS, lessonForDialect } from '../lib/lessons';
import { maskSql, splitSqlStatements, topLevelMatches } from '../lib/sqlText';
import { schemaById, type SchemaDef } from '../lib/schemas';
import { SqlRuntime } from '../lib/sqlRuntime';
import type { Case } from './dialectHarness';
import { PROBES } from './dialectCases/compatibility';
import { TEXT_PROBES } from './dialectCases/text';
import { POSTGRES_CASES, POSTGRES_DATE_REGRESSIONS } from './dialectCases/releaseAcceptancePostgres';
import * as tour from './dialectCases/tour';

type Row = unknown[];

/**
 * Queries that are valid in QueryTrace's PostgreSQL mode but cannot be compared,
 * each with the reason. Anything PostgreSQL refuses that is not listed here fails the run.
 */
const NOT_COMPARABLE: Array<{ match: RegExp; reason: string }> = [
  // A mode applies its vendor's rules where meanings differ; it does not refuse
  // what only another vendor accepts. These fixtures are written in SQLite's spelling.
  { match: /\bGROUP_CONCAT\s*\(/i, reason: 'GROUP_CONCAT is not a PostgreSQL function; QueryTrace accepts it in every mode' },
  { match: /\bWHERE\s+0\b/i, reason: 'PostgreSQL wants a boolean condition; QueryTrace also accepts 0 and 1' },
];

/** Dates and timestamps as PostgreSQL prints them, not as JavaScript Date objects in this machine's time zone. */
const asWritten = (value: string) => value;
const TEXT_DATES = { [types.DATE]: asWritten, [types.TIMESTAMP]: asWritten, [types.TIMESTAMPTZ]: asWritten };

/** One value in a form both engines can be compared in. */
function canonical(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);
  // QueryTrace shows dates as text and has no separate timestamp type, so
  // PostgreSQL's "date + interval is a timestamp at midnight" is compared as the date.
  if (typeof value === 'string') {
    const midnight = value.match(/^(\d{4}-\d{2}-\d{2}) 00:00:00(?:\.0+)?$/);
    if (midnight) return midnight[1];
  }
  // PostgreSQL returns NUMERIC as text ('2.5000000000000000'); SQLite returns a number.
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value.trim()) ? Number(value) : null;
  if (number !== null && Number.isFinite(number)) return Number(number.toPrecision(9));
  return value;
}

const rowKey = (row: Row) => JSON.stringify(row.map(canonical));

function hasOuterOrderBy(sql: string): boolean {
  return topLevelMatches(maskSql(sql), /\bORDER\s+BY\b/gi).length > 0;
}

function isQuery(sql: string): boolean {
  return /^\s*(?:SELECT|WITH|\()/i.test(maskSql(sql));
}

interface Source {
  label: string;
  def: SchemaDef;
  queries: string[];
}

const postgresCases = (cases: Case[]) =>
  cases.filter((item) => !item.reject && (item.dialect === 'postgresql')).map((item) => item.sql);
/** Fixtures written without a profile whose syntax is PostgreSQL's own (FILTER, frames, named windows). */
const nativeCases = (cases: Case[]) =>
  cases.filter((item) => !item.reject && (item.dialect === undefined || item.dialect === 'postgresql')).map((item) => item.sql);

function sources(): Source[] {
  const festival = schemaById('festival')!;
  const observatory = schemaById('observatory')!;
  const marine = schemaById('marine')!;
  const lessons = new Map<string, string[]>();
  for (const lesson of LESSONS) {
    const list = lessons.get(lesson.schemaId) ?? [];
    list.push(lessonForDialect(lesson, 'postgresql').query);
    lessons.set(lesson.schemaId, list);
  }
  const probe = (label: string) => PROBES.find((item) => item.label === label)!;
  const text = (label: string) => TEXT_PROBES.find((item) => item.label === label)!;
  return [
    { label: 'release acceptance / festival', def: festival, queries: postgresCases(POSTGRES_CASES) },
    { label: 'release date arithmetic regressions', def: festival, queries: postgresCases(POSTGRES_DATE_REGRESSIONS) },
    { label: 'tour / festival', def: festival, queries: postgresCases(tour.postgresqlFestival) },
    { label: 'tour / observatory', def: observatory, queries: postgresCases(tour.postgresqlObservatory) },
    { label: 'tour / marine', def: marine, queries: postgresCases(tour.postgresqlMarine) },
    ...[...lessons].map(([schemaId, queries]) => ({ label: `lessons in PostgreSQL spelling / ${schemaId}`, def: schemaById(schemaId)!, queries })),
    { label: 'aggregate FILTER fixtures', def: probe('compat aggregate FILTER').def, queries: nativeCases(probe('compat aggregate FILTER').cases) },
    { label: 'ROWS frame fixtures', def: probe('compat ROWS frames').def, queries: nativeCases(probe('compat ROWS frames').cases) },
    { label: 'named window fixtures', def: probe('compat named windows').def, queries: nativeCases(probe('compat named windows').cases) },
    { label: 'text comparison fixtures', def: text('text: LIKE, ILIKE, LOWER and UPPER per profile').def, queries: postgresCases(text('text: LIKE, ILIKE, LOWER and UPPER per profile').cases) },
  ];
}

async function main() {
  const postgres = new PGlite();
  const version = (await postgres.query<{ version: string }>('SELECT version() AS version')).rows[0].version;
  console.log(`Comparing against ${version.split(' on ')[0]} (PGlite)`);

  let pass = 0;
  let fail = 0;
  let skipped = 0;
  const failures: string[] = [];
  const report = (label: string, sql: string, message: string) => {
    fail++;
    const shown = sql.replace(/\s+/g, ' ').slice(0, 110);
    failures.push(`[${label}] ${shown}\n      ${message}`);
    console.log(`  FAIL ${shown}\n       ${message}`);
  };

  for (const source of sources()) {
    console.log(`\n=== ${source.label}`);
    // The same script builds both databases, so both hold the same rows.
    await postgres.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    try {
      for (const statement of splitSqlStatements(source.def.ddl)) await postgres.exec(statement.text);
    } catch (error) {
      report(source.label, source.def.ddl, `PostgreSQL could not build the schema: ${(error as Error).message}`);
      continue;
    }
    const runtime = new SqlRuntime();
    await runtime.loadSchema(source.def);

    for (const sql of source.queries) {
      if (!isQuery(sql)) {
        skipped++;
        console.log(`  skip (changes data; only queries are compared) ${sql.replace(/\s+/g, ' ').slice(0, 80)}`);
        continue;
      }
      const excluded = NOT_COMPARABLE.find((item) => item.match.test(sql));
      if (excluded) {
        skipped++;
        console.log(`  skip (${excluded.reason}) ${sql.replace(/\s+/g, ' ').slice(0, 80)}`);
        continue;
      }
      let ours: Row[];
      try {
        ours = runtime.runQuery(sql, { dialect: 'postgresql' }).trace.at(-1)?.partialResult?.rows ?? [];
      } catch (error) {
        report(source.label, sql, `QueryTrace refused it: ${(error as Error).message}`);
        continue;
      }
      let theirs: Row[];
      try {
        theirs = (await postgres.query<Row>(sql.trim().replace(/;+\s*$/, ''), [], { rowMode: 'array', parsers: TEXT_DATES })).rows;
      } catch (error) {
        report(source.label, sql, `PostgreSQL refused it: ${(error as Error).message}`);
        continue;
      }
      const ordered = hasOuterOrderBy(sql);
      const left = ours.map(rowKey);
      const right = theirs.map(rowKey);
      if (!ordered) {
        left.sort();
        right.sort();
      }
      if (left.length === right.length && left.every((row, index) => row === right[index])) {
        pass++;
      } else {
        report(source.label, sql, `rows differ${ordered ? '' : ' (compared without order)'}\n       QueryTrace: ${JSON.stringify(left.slice(0, 6))}\n       PostgreSQL: ${JSON.stringify(right.slice(0, 6))}`);
      }
    }
    runtime.close();
  }
  await postgres.close();

  console.log(`\n=== ${pass} passed, ${fail} failed, ${skipped} skipped`);
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
