/* Shared harness for the dialect and compatibility suites: load a schema into
   the real SqlRuntime, run each case, and compare with hand-computed results
   (not merely with SQLite's own answer, so a wrong translation cannot hide). */
import { SqlRuntime } from '../lib/sqlRuntime';
import type { ExplanationLevel, SourceDialect } from '../lib/queryCompatibility';
import type { SchemaDef } from '../lib/schemas';

type Row = unknown[];
interface Case {
  sql: string;
  /** Expected final rows (order-insensitive unless `ordered`). */
  rows?: Row[];
  ordered?: boolean;
  /** Expected to be rejected; optional regex the message must match. */
  reject?: RegExp | true;
  /** Just must succeed. */
  ok?: true;
  /** Expected columns. */
  columns?: string[];
  /** Expected number of rows only. */
  count?: number;
  note?: string;
  /** Print the rejection message (or the final rows) for manual review. */
  show?: true;
  /** Source dialect the query is read as (default: legacy mixed rules). */
  dialect?: SourceDialect;
  /** Expected explanation level of the result. */
  coverage?: ExplanationLevel;
  /** The final stage must carry (true) or lack (false) row lineage. */
  lineage?: boolean;
  /** Every listed feature must be reported in the coverage metadata. */
  features?: string[];
  /** A plain SQLite spelling of the same query, run under the `sqlite` profile; its rows must match. */
  reference?: string;
}

const norm = (v: unknown) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(10)) : v);
const key = (r: Row) => JSON.stringify(r.map(norm));

let pass = 0;
let fail = 0;
const failures: string[] = [];

async function runSchema(def: SchemaDef, label: string, cases: Case[]) {
  const rt = new SqlRuntime();
  try {
    await rt.loadSchema(def);
  } catch (e) {
    fail++;
    failures.push(`[${label}] SCHEMA LOAD FAILED: ${(e as Error).message}`);
    console.log(`  !! ${label}: schema load failed: ${(e as Error).message}`);
    return;
  }
  console.log(`\n=== ${label}`);
  for (const c of cases) {
    const shown = c.sql.replace(/\s+/g, ' ').slice(0, 100);
    let result;
    let err: Error | null = null;
    try {
      result = rt.runQuery(c.sql, { dialect: c.dialect });
    } catch (e) {
      err = e as Error;
    }
    const report = (msg: string) => {
      fail++;
      failures.push(`[${label}] ${shown}\n      ${msg}`);
      console.log(`  FAIL ${shown}\n       ${msg}`);
    };
    if (c.reject) {
      if (!err) {
        const final = result!.trace.at(-1)!.partialResult;
        report(`expected rejection, got ${final?.rows.length} rows: ${JSON.stringify(final?.rows.slice(0, 3))}`);
      } else if (c.reject !== true && !c.reject.test(err.message)) {
        report(`rejected, but message mismatch: ${err.message}`);
      } else {
        pass++;
        if (c.show) console.log(`  msg  ${shown}
       -> ${err.message}`);
      }
      continue;
    }
    if (err) {
      report(`unexpected rejection: ${err.constructor.name}: ${err.message}`);
      continue;
    }
    const final = result!.trace.at(-1)!.partialResult;
    const got = final?.rows ?? [];
    const dirty = result!.trace.some((s) => /undefined|NaN|\[object/.test(s.label + s.narration));
    if (dirty) {
      report(`dirty label/narration: ${result!.trace.map((s) => s.label).join(' | ')}`);
      continue;
    }
    if (c.columns && JSON.stringify(final?.columns) !== JSON.stringify(c.columns)) {
      report(`columns ${JSON.stringify(final?.columns)} != ${JSON.stringify(c.columns)}`);
      continue;
    }
    if (c.count !== undefined && got.length !== c.count) {
      report(`row count ${got.length} != ${c.count}: ${JSON.stringify(got.slice(0, 4))}`);
      continue;
    }
    if (c.dialect && result!.coverage.dialect !== c.dialect) {
      report(`query ran under ${result!.coverage.dialect}, expected ${c.dialect}`);
      continue;
    }
    if (c.coverage && result!.coverage.explanation !== c.coverage) {
      report(`coverage ${result!.coverage.explanation} != ${c.coverage}`);
      continue;
    }
    if (c.lineage !== undefined && !!result!.trace.at(-1)!.resultRowSources !== c.lineage) {
      report(`final stage lineage ${!!result!.trace.at(-1)!.resultRowSources} != ${c.lineage}`);
      continue;
    }
    if (result!.coverage.explanation !== 'detailed' && result!.trace.some((s) => !!s.resultRowSources)) {
      report(`coverage ${result!.coverage.explanation} but a stage carries resultRowSources`);
      continue;
    }
    if (c.features) {
      const missing = c.features.filter((f) => !result!.coverage.features.includes(f as never));
      if (missing.length) {
        report(`coverage features ${JSON.stringify(result!.coverage.features)} lack ${missing.join(', ')}`);
        continue;
      }
    }
    if (c.rows) {
      const a = got.map(key);
      const b = c.rows.map(key);
      if (!c.ordered) {
        a.sort();
        b.sort();
      }
      if (a.length !== b.length || a.some((r, i) => r !== b[i])) {
        report(`rows differ.\n       got      ${JSON.stringify(got)}\n       expected ${JSON.stringify(c.rows)}\n       notes: ${JSON.stringify(result!.notes)}`);
        continue;
      }
    }
    if (c.reference) {
      let expected: Row[];
      try {
        expected = rt.runQuery(c.reference, { dialect: 'sqlite' }).trace.at(-1)!.partialResult?.rows ?? [];
      } catch (e) {
        report(`reference query failed: ${(e as Error).message}`);
        continue;
      }
      const a = got.map(key);
      const b = expected.map(key);
      if (!c.ordered) {
        a.sort();
        b.sort();
      }
      if (a.length !== b.length || a.some((r, i) => r !== b[i])) {
        report(`rows differ from the SQLite reference.
       got       ${JSON.stringify(got)}
       reference ${JSON.stringify(expected)}
       notes: ${JSON.stringify(result!.notes)}`);
        continue;
      }
    }
    pass++;
    if (c.show) console.log(`  rows ${shown}
       -> ${JSON.stringify(final?.columns)} ${JSON.stringify(got.slice(0, 6))} notes=${JSON.stringify(result!.notes)}`);
  }
  rt.close();
}

/** Totals and failure list of every runSchema call so far. */
function summary() {
  return { pass, fail, failures };
}

export { runSchema, summary, type Case };

