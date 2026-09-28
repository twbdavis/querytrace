/* Differential stress test for the trace engine. Every query runs through
   SqlRuntime (the worker's path) and, in parallel, its translated SQLite text
   runs directly against a twin database. The two must agree, and every trace
   must satisfy the provenance invariants the UI relies on.

   Run with: npx tsx scripts/fuzzTrace.ts [--verbose] [--json path] */
import type { Database } from 'sql.js';
import { createDatabase, type TableData } from '../lib/db';
import { PRELOADED_SCHEMAS, type SchemaDef, type TableMeta } from '../lib/schemas';
import { SqlRuntime } from '../lib/sqlRuntime';
import { TraceError, type TraceStep } from '../lib/traceEngine';
import { parseQuery } from '../lib/parser';
import { CUSTOM_SCHEMAS, type FuzzSchema } from './fuzzSchemas';
import { queriesFor } from './fuzzQueries';

type Outcome =
  | 'ok'
  | 'refused' // runtime raised a TraceError while SQLite itself accepted the SQL
  | 'rejected' // both refused (expected for invalid SQL); message quality checked
  | 'crash' // a non-TraceError escaped the runtime
  | 'mismatch' // final rows differ from SQLite's own answer
  | 'accepted-invalid' // runtime produced a result where SQLite errors
  | 'invariant' // trace shape violates a UI invariant
  | 'leak' // the database changed after a read-only statement
  | 'nondeterministic'
  | 'slow';

interface Finding {
  schema: string;
  query: string;
  outcome: Outcome;
  detail: string;
  ms: number;
}

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const jsonPath = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const SLOW_MS = 400;

const norm = (v: unknown): unknown =>
  v instanceof Uint8Array ? `BLOB(${v.length} bytes)` : typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'number' ? Number(v.toPrecision(12)) : v;
const rowKey = (row: unknown[]) => JSON.stringify(row.map(norm));

function dump(db: Database): string {
  const names = db
    .exec("SELECT type || ':' || name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY 1")[0]
    ?.values.map((r) => String(r[0])) ?? [];
  const temp = db.exec('SELECT name FROM sqlite_temp_master ORDER BY 1')[0]?.values.map((r) => String(r[0])) ?? [];
  const parts = [names.join('|'), `temp=${temp.join('|')}`];
  for (const entry of names) {
    if (!entry.startsWith('table:')) continue;
    const table = entry.slice(6);
    const rows = db.exec(`SELECT _rowid_, * FROM "${table.replace(/"/g, '""')}" ORDER BY _rowid_`)[0]?.values ?? [];
    parts.push(`${table}:${rows.map(rowKey).join(';')}`);
  }
  return parts.join('\n');
}

function stepsKey(steps: TraceStep[]): string {
  return JSON.stringify(steps, (_k, v) => (v instanceof Set ? [...v].sort((a, b) => a - b) : v));
}

function checkInvariants(steps: TraceStep[], schema: TableMeta[], rowids: Map<string, Set<number>>, sqlLength: number): string | null {
  const tables = new Set(schema.map((t) => t.name));
  if (steps.length === 0) return 'trace has no steps';
  for (const [i, step] of steps.entries()) {
    const at = `step ${i} (${step.stage})`;
    if (!step.label) return `${at}: empty label`;
    if (!step.narration) return `${at}: empty narration`;
    for (const t of step.activeTables) if (!tables.has(t)) return `${at}: activeTables names unknown table ${t}`;
    for (const rec of [step.litRows, step.dimmedRows, step.nullExtendedRows ?? {}]) {
      for (const [t, ids] of Object.entries(rec)) {
        if (!tables.has(t)) return `${at}: row set names unknown table ${t}`;
        const known = rowids.get(t)!;
        for (const id of ids) {
          if (!Number.isInteger(id)) return `${at}: non-integer rowid ${String(id)} for ${t}`;
          if (!known.has(id) && !step.tableSnapshots) return `${at}: rowid ${id} does not exist in ${t}`;
        }
      }
    }
    for (const [t, ids] of Object.entries(step.litRows)) {
      const dimmed = step.dimmedRows[t];
      if (dimmed) for (const id of ids) if (dimmed.has(id)) return `${at}: rowid ${id} of ${t} is both lit and dimmed`;
    }
    if (step.partialResult) {
      const { columns, rows } = step.partialResult;
      for (const row of rows) if (row.length !== columns.length) return `${at}: result row width ${row.length} != ${columns.length} columns`;
      if (step.resultRowSources && step.resultRowSources.length !== rows.length) {
        return `${at}: resultRowSources has ${step.resultRowSources.length} entries for ${rows.length} rows`;
      }
    }
    for (const src of step.resultRowSources ?? []) {
      for (const [t, ids] of Object.entries(src)) {
        if (!tables.has(t)) return `${at}: provenance names unknown table ${t}`;
        for (const id of ids) if (!rowids.get(t)!.has(id) && !step.tableSnapshots) return `${at}: provenance rowid ${id} missing from ${t}`;
      }
    }
    if (step.tuples) {
      if (!step.tupleTables) return `${at}: tuples without tupleTables`;
      for (const tuple of step.tuples) {
        for (const [alias, id] of Object.entries(tuple)) {
          const t = step.tupleTables[alias];
          if (!t) return `${at}: tuple alias ${alias} has no table`;
          if (!tables.has(t)) return `${at}: tupleTables maps ${alias} to unknown ${t}`;
          if (id !== null && !rowids.get(t)!.has(id) && !step.tableSnapshots) return `${at}: tuple rowid ${id} missing from ${t}`;
        }
      }
    }
    if (step.queryRange) {
      const { start, end } = step.queryRange;
      if (start < 0 || end > sqlLength || start > end) return `${at}: queryRange ${start}-${end} outside 0-${sqlLength}`;
    }
  }
  return null;
}

async function loadPair(def: SchemaDef): Promise<{ runtime: SqlRuntime; oracle: Database; schema: TableMeta[]; tableData: Record<string, TableData> }> {
  const runtime = new SqlRuntime();
  const loaded = await runtime.loadSchema(def);
  const oracle = await createDatabase(def.ddl, def.id === 'custom');
  return { runtime, oracle, schema: loaded.schema, tableData: loaded.tableData };
}

function rowidsOf(db: Database, schema: TableMeta[]): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const t of schema) {
    const rows = db.exec(`SELECT _rowid_ FROM "${t.name.replace(/"/g, '""')}"`)[0]?.values ?? [];
    out.set(t.name, new Set(rows.map((r) => Number(r[0]))));
  }
  return out;
}

const hasTopLevelOrderBy = (sql: string) => /\border\s+by\b/i.test(sql) && !/\)\s*$/.test(sql.trim());

async function main() {
  const findings: Finding[] = [];
  const counts: Record<Outcome, number> = {
    ok: 0, refused: 0, rejected: 0, crash: 0, mismatch: 0, 'accepted-invalid': 0, invariant: 0, leak: 0, nondeterministic: 0, slow: 0,
  };
  let total = 0;
  const timings: Array<{ schema: string; query: string; ms: number }> = [];

  const defs: SchemaDef[] = [...PRELOADED_SCHEMAS, ...CUSTOM_SCHEMAS];
  for (const def of defs) {
    const key = (def as FuzzSchema).key ?? def.id;
    let pair: Awaited<ReturnType<typeof loadPair>>;
    try {
      pair = await loadPair(def);
    } catch (e) {
      counts.crash++;
      const detail = e instanceof Error ? e.message : String(e);
      findings.push({ schema: key, query: '<schema load>', outcome: 'crash', detail, ms: 0 });
      console.log(`\n=== ${key}: SCHEMA FAILED TO LOAD\n      ${detail.slice(0, 400)}`);
      continue;
    }
    const { runtime, oracle, schema, tableData } = pair;
    const queries = queriesFor(key, schema, tableData);
    console.log(`\n=== ${key} (${schema.length} tables, ${queries.length} queries)`);

    for (const q of queries) {
      total++;
      const sql = q.sql;
      const record = (outcome: Outcome, detail: string, ms: number) => {
        counts[outcome]++;
        findings.push({ schema: key, query: sql, outcome, detail, ms });
        if (verbose || outcome !== 'ok') {
          const shown = sql.replace(/\s+/g, ' ').slice(0, 110);
          if (outcome !== 'ok') console.log(`  [${outcome.toUpperCase()}] ${shown}\n      ${detail.slice(0, 300)}`);
        }
      };

      const parsed = parseQuery(sql, { schema });
      const isMutation = parsed.ok && parsed.kind === 'mutation';
      const before = dump(oracle);

      // Oracle: SQLite's own answer to the translated text, or its error.
      let oracleRows: unknown[][] | null = null;
      let oracleColumns: string[] = [];
      let oracleError: string | null = null;
      if (q.skipOracle) {
        // nothing: SQLite's own run would be too expensive here
      } else if (parsed.ok) {
        oracle.run('SAVEPOINT fz');
        try {
          const res = oracle.exec(parsed.sql);
          oracleColumns = res[0]?.columns ?? [];
          oracleRows = res[0]?.values ?? [];
          oracle.run('RELEASE fz');
        } catch (e) {
          oracleError = e instanceof Error ? e.message : String(e);
          oracle.run('ROLLBACK TO fz; RELEASE fz');
        }
      } else {
        oracleError = `parse: ${parsed.error}`;
      }

      // Runtime, twice for determinism.
      const started = performance.now();
      let steps: TraceStep[] | null = null;
      let runtimeError: Error | null = null;
      try {
        steps = runtime.runQuery(sql).trace;
      } catch (e) {
        runtimeError = e instanceof Error ? e : new Error(String(e));
      }
      const ms = performance.now() - started;
      timings.push({ schema: key, query: sql, ms });

      if (runtimeError) {
        const msg = runtimeError.message;
        const dirty = /undefined|\[object|cannot read|is not a function|of null|of undefined|NaN/i.test(msg);
        if (!(runtimeError instanceof TraceError) || dirty) {
          record('crash', `${runtimeError.constructor.name}: ${msg}`, ms);
          continue;
        }
        if (oracleError) {
          if (q.expect === 'ok') record('refused', `expected success but refused: ${msg}`, ms);
          else record('rejected', msg, ms);
        } else if (q.expect === 'refused' || q.expect === 'either') {
          record('rejected', msg, ms);
        } else {
          record('refused', msg, ms);
        }
        // A refused mutation must leave the database as it was.
        if (isMutation) {
          const rt = (runtime as unknown as { db: Database }).db;
          if (dump(rt) !== before) record('leak', 'refused statement changed the database', ms);
        }
        continue;
      }

      if (!steps) continue;
      if (oracleError && !isMutation) {
        if (q.lenient) {
          record('ok', `accepted on purpose; SQLite says: ${oracleError}`, ms);
          continue;
        }
        record('accepted-invalid', `SQLite says: ${oracleError}`, ms);
        continue;
      }

      const rowids = rowidsOf((runtime as unknown as { db: Database }).db, schema);
      const inv = checkInvariants(steps, schema, rowids, sql.length);
      if (inv) {
        record('invariant', inv, ms);
        continue;
      }

      const final = steps.at(-1)!.partialResult;
      if (!isMutation && oracleRows && !/random\s*\(/i.test(sql)) {
        const got = final?.rows ?? [];
        const ordered = hasTopLevelOrderBy(parsed.ok ? parsed.sql : sql);
        const a = got.map(rowKey);
        const b = oracleRows.map(rowKey);
        if (!ordered) {
          a.sort();
          b.sort();
        }
        if (a.length !== b.length || a.some((row, i) => row !== b[i])) {
          const firstDiff = a.findIndex((row, i) => row !== b[i]);
          record(
            'mismatch',
            `rows ${got.length} vs SQLite ${oracleRows.length}${firstDiff >= 0 ? `; first difference at ${firstDiff}: ${a[firstDiff] ?? '-'} vs ${b[firstDiff] ?? '-'}` : ''}`,
            ms
          );
          continue;
        }
        if ((final?.columns.length ?? 0) !== oracleColumns.length) {
          record('mismatch', `columns ${JSON.stringify(final?.columns)} vs SQLite ${JSON.stringify(oracleColumns)}`, ms);
          continue;
        }
      }

      const rt = (runtime as unknown as { db: Database }).db;
      if (isMutation) {
        if (!q.skipOracle && dump(rt) !== dump(oracle)) {
          record('mismatch', 'database differs from SQLite after the statement', ms);
          continue;
        }
      } else if (dump(rt) !== before) {
        record('leak', 'read-only statement changed the database', ms);
        continue;
      }

      if (!isMutation && !/random|current_|now\(|sysdate|getdate|julianday\(\)|date\(\)|time\(\)|datetime\(\)/i.test(sql)) {
        let again: TraceStep[] | null = null;
        try {
          again = runtime.runQuery(sql).trace;
        } catch {
          again = null;
        }
        if (!again || stepsKey(again) !== stepsKey(steps)) {
          record('nondeterministic', 'second run produced a different trace', ms);
          continue;
        }
      }

      if (ms > SLOW_MS) {
        record('slow', `${ms.toFixed(0)} ms`, ms);
        continue;
      }
      record('ok', `${steps.length} steps, ${final?.rows.length ?? 0} rows`, ms);
    }
    runtime.close();
    oracle.close();
  }

  timings.sort((a, b) => b.ms - a.ms);
  console.log('\n=== slowest');
  for (const t of timings.slice(0, 8)) console.log(`  ${t.ms.toFixed(0).padStart(5)} ms  ${t.schema}  ${t.query.replace(/\s+/g, ' ').slice(0, 90)}`);
  const totalMs = timings.reduce((s, t) => s + t.ms, 0);
  console.log(`\n=== summary: ${total} queries, ${totalMs.toFixed(0)} ms total, ${(totalMs / total).toFixed(1)} ms average`);
  for (const [k, v] of Object.entries(counts)) if (v) console.log(`  ${k.padEnd(18)} ${v}`);
  if (jsonPath) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(jsonPath, JSON.stringify(findings, null, 1));
    console.log(`  report: ${jsonPath}`);
  }
  const bad = counts.crash + counts.mismatch + counts['accepted-invalid'] + counts.invariant + counts.leak + counts.nondeterministic;
  process.exit(bad > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
