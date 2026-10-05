/* Dialect regression suite: schema scripts the way MySQL / MariaDB, PostgreSQL,
   SQL Server and Oracle tools export them, plus queries and data changes in
   each dialect, checked against hand-computed results (not merely against
   SQLite's own answer, so a wrong translation cannot hide).
   Run with: npm run test:dialects */
import { SqlRuntime } from '../lib/sqlRuntime';
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
      result = rt.runQuery(c.sql);
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
    pass++;
    if (c.show) console.log(`  rows ${shown}
       -> ${JSON.stringify(final?.columns)} ${JSON.stringify(got.slice(0, 6))} notes=${JSON.stringify(result!.notes)}`);
  }
  rt.close();
}

export { runSchema, type Case };

async function main() {
  const modules = await Promise.all([
    import('./dialectCases/exports'),
    import('./dialectCases/tools'),
    import('./dialectCases/queries'),
    import('./dialectCases/pasted'),
    import('./dialectCases/final'),
  ]);
  for (const module of modules) for (const p of module.PROBES) await runSchema(p.def, p.label, p.cases);
  console.log(`\n=== ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log(`  ${f}`);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
