/* Acceptance regression: invalid queries followed by twenty-five successful queries
   on ONE SqlRuntime connection, with no schema reload or session reset.
   Run with: npx tsx scripts/testQuerySequence.ts */
import assert from 'node:assert/strict';
import type { TableData } from '../lib/db';
import { provenanceFor } from '../lib/provenance';
import { SqlRuntime, type QueryRun } from '../lib/sqlRuntime';
import type { TraceStep } from '../lib/traceEngine';
import {
  QUERY_SEQUENCE_CASES,
  QUERY_SEQUENCE_REJECTIONS,
  QUERY_SEQUENCE_SCHEMA,
  type SequenceSources,
} from './querySequenceCases';

const sorted = (values: Iterable<number>) => [...values].sort((a, b) => a - b);
const normalizedSources = (sources: SequenceSources[]) => sources.map((source) =>
  Object.fromEntries(Object.entries(source).sort(([a], [b]) => a.localeCompare(b)).map(([table, rids]) => [table, sorted(rids)]))
);
const fingerprint = (run: QueryRun) => JSON.stringify(run, (_key, value: unknown) =>
  value instanceof Set ? sorted(value as Set<number>) : value
);

/** Compare click lookup to a direct scan, including a second cached lookup. */
function validateClickProvenance(step: TraceStep, tables: Record<string, TableData>) {
  for (const [table, data] of Object.entries(tables)) {
    for (const rid of data.rids) {
      const expectedResults = (step.resultRowSources ?? []).flatMap((source, index) => source[table]?.includes(rid) ? [index] : []);
      const expectedRelated: Record<string, Set<number>> = { [table]: new Set([rid]) };
      for (const tuple of step.tuples ?? []) {
        if (!Object.entries(tuple).some(([alias, tupleRid]) => (step.tupleTables?.[alias] ?? alias) === table && tupleRid === rid)) continue;
        for (const [alias, relatedRid] of Object.entries(tuple)) {
          if (relatedRid !== null) (expectedRelated[step.tupleTables?.[alias] ?? alias] ??= new Set()).add(relatedRid);
        }
      }
      const normalizeRows = (rows: Record<string, Set<number>>) => Object.fromEntries(
        Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)).map(([name, rids]) => [name, sorted(rids)])
      );
      for (let lookup = 0; lookup < 2; lookup++) {
        const got = provenanceFor(step, table, rid);
        assert.deepEqual(sorted(got.resultRows), expectedResults, `${step.stage}: ${table}/${rid} result click lookup`);
        assert.deepEqual(normalizeRows(got.rows), normalizeRows(expectedRelated), `${step.stage}: ${table}/${rid} related row lookup`);
      }
    }
  }
}

function validateTrace(run: QueryRun, sql: string, liveTables: Record<string, TableData>) {
  assert.ok(run.trace.length > 0, 'query produces a trace');
  for (const step of run.trace) {
    const tables = step.tableSnapshots ?? liveTables;
    assert.ok(step.label.trim() && step.narration.trim(), `${step.stage}: has learner-facing trace text`);
    assert.doesNotMatch(step.label + step.narration, /\bundefined\b|\bNaN\b|\[object Object\]/, `${step.stage}: trace text is valid`);
    const validRid = (table: string, rid: number) => {
      assert.ok(tables[table], `${step.stage}: ${table} is a real table`);
      assert.ok(Number.isInteger(rid) && tables[table].rids.includes(rid), `${step.stage}: ${table}/${rid} exists at this trace stage`);
    };
    for (const table of step.activeTables) assert.ok(tables[table], `${step.stage}: active table ${table} exists`);
    for (const map of [step.litRows, step.dimmedRows, step.nullExtendedRows]) {
      for (const [table, rids] of Object.entries(map ?? {})) for (const rid of rids) validRid(table, rid);
    }
    for (const tuple of step.tuples ?? []) {
      for (const [alias, rid] of Object.entries(tuple)) if (rid !== null) validRid(step.tupleTables?.[alias] ?? alias, rid);
    }
    if (step.partialResult) {
      for (const row of step.partialResult.rows) assert.equal(row.length, step.partialResult.columns.length, `${step.stage}: result row aligns with columns`);
    }
    if (step.resultRowSources) {
      assert.equal(step.resultRowSources.length, step.partialResult?.rows.length, `${step.stage}: sources align with displayed rows`);
      for (const sources of step.resultRowSources) {
        for (const [table, rids] of Object.entries(sources)) {
          assert.ok(tables[table], `${step.stage}: provenance table ${table} exists`);
          assert.equal(new Set(rids).size, rids.length, `${step.stage}: provenance has no duplicate rowids`);
          for (const rid of rids) validRid(table, rid);
        }
      }
    }
    if (step.queryRange) {
      assert.ok(step.queryRange.start >= 0 && step.queryRange.end > step.queryRange.start && step.queryRange.end <= sql.length,
        `${step.stage}: editor highlight stays inside the original query`);
    }
    validateClickProvenance(step, tables);
  }
}

async function main() {
  assert.equal(QUERY_SEQUENCE_CASES.length, 25, 'acceptance sequence contains exactly twenty-five queries');
  const runtime = new SqlRuntime();
  const failures: string[] = [];
  let successes = 0;
  let consecutive = 0;
  let longestStreak = 0;
  const retained: Array<{ run: QueryRun; sql: string; tables: Record<string, TableData>; fingerprint: string }> = [];
  const fail = (name: string, error: unknown) => {
    const message = `${name}: ${error instanceof Error ? error.message : String(error)}`;
    failures.push(message);
    console.error(`FAIL ${message}`);
  };

  try {
    const loaded = await runtime.loadSchema(QUERY_SEQUENCE_SCHEMA);
    let tables = loaded.tableData;
    let latestBytes = loaded.databaseBytes;
    console.log('One SqlRuntime session loaded; verifying rejection and rollback recovery.');
    for (const rejection of QUERY_SEQUENCE_REJECTIONS) {
      try {
        assert.throws(() => runtime.runQuery(rejection.sql), rejection.message, rejection.name);
        console.log(`PASS rejected: ${rejection.name}`);
      } catch (error) {
        fail(rejection.name, error);
      }
    }

    for (const [index, test] of QUERY_SEQUENCE_CASES.entries()) {
      const name = `${String(index + 1).padStart(2, '0')}/25 ${test.dialect}: ${test.name}`;
      try {
        const run = runtime.runQuery(test.sql);
        if (run.mutation) {
          tables = run.mutation.tableData;
          latestBytes = run.mutation.databaseBytes ?? latestBytes;
        }
        validateTrace(run, test.sql, tables);
        const final = run.trace.at(-1)!;
        assert.deepEqual(final.partialResult?.columns, test.columns, 'final columns equal the hand-computed expectation');
        assert.deepEqual(final.partialResult?.rows, test.rows, 'ordered final rows equal the hand-computed expectation');
        if (test.sources) {
          assert.ok(final.resultRowSources, 'traceable final result has provenance');
          assert.deepEqual(normalizedSources(final.resultRowSources), normalizedSources(test.sources), 'final provenance follows the actual contributing source rows');
        }
        if (test.provenanceUnavailable) assert.equal(final.resultRowSources, undefined, 'advanced result or removed rows has no invented live provenance');
        assert.deepEqual(run.mutation?.changedTables, test.changedTables, 'only expected tables changed');
        if (test.changedTables) assert.ok(run.mutation?.databaseBytes?.length, 'custom mutation supplies persisted database bytes');
        if (test.schemaTables) {
          assert.deepEqual(run.mutation?.schema?.map((table) => table.name), test.schemaTables, 'DDL refreshes all physical table metadata');
          assert.deepEqual(Object.keys(tables), test.schemaTables, 'DDL refreshes the live table snapshots');
          const audit = run.mutation?.schema?.find((table) => table.name === 'query_audit');
          assert.deepEqual(audit?.columns.map((column) => column.name), ['audit_id', 'account_code', 'total'], 'created table has the expected columns');
          assert.ok(audit?.columns.find((column) => column.name === 'audit_id')?.pk, 'identity key is introspected');
          assert.deepEqual(audit?.columns.find((column) => column.name === 'account_code')?.fk?.table, 'account', 'created foreign key targets the original table');
          assert.equal(run.mutation?.fkEdges?.length, 2, 'DDL refreshes both original and new foreign-key edges');
        }
        for (const stage of test.requiredStages ?? []) assert.ok(run.trace.some((step) => step.stage === stage), `trace includes ${stage}`);
        retained.push({ run, sql: test.sql, tables, fingerprint: fingerprint(run) });
        successes++;
        consecutive++;
        longestStreak = Math.max(longestStreak, consecutive);
        console.log(`PASS ${name} (${run.trace.length} trace stages)`);
      } catch (error) {
        consecutive = 0;
        fail(name, error);
      }
    }

    // Later queries and writes must not change an earlier scrubber trace or
    // invalidate the provenance index cached when its rows were clicked.
    for (const item of retained) {
      try {
        assert.equal(fingerprint(item.run), item.fingerprint, 'earlier trace stays immutable after later queries');
        validateTrace(item.run, item.sql, item.tables);
      } catch (error) {
        fail(`retained trace for ${item.sql}`, error);
      }
    }
    assert.equal(longestStreak, 25, `required twenty-five consecutive successful queries; longest streak was ${longestStreak}`);

    // The acceptance streak above never reloads. A separate connection then
    // proves that its persisted bytes also retain the new schema and index.
    assert.ok(latestBytes?.length, 'final session supplies persisted database bytes');
    const restoredRuntime = new SqlRuntime();
    try {
      const restored = await restoredRuntime.loadSchema(QUERY_SEQUENCE_SCHEMA, latestBytes);
      assert.deepEqual(restored.schema.map((table) => table.name), ['account', 'purchase', 'query_audit'], 'created table survives persistence');
      assert.equal(restored.fkEdges.length, 2, 'created foreign key survives persistence');
      assert.deepEqual(restored.tableData.query_audit.rows, [[1, 'A', 26.5], [2, 'B', 20], [3, 'D', 0]], 'created-table upsert data survives persistence');
      assert.throws(() => restoredRuntime.runQuery("INSERT INTO query_audit VALUES (4, 'A', 999);"), /unique|already|duplicate/i, 'created unique index survives persistence');
      assert.throws(() => restoredRuntime.runQuery("INSERT INTO query_audit VALUES (4, 'missing', 999);"), /foreign key|refer|exist/i, 'created foreign key survives persistence');
      const final = QUERY_SEQUENCE_CASES.at(-1)!;
      const result = restoredRuntime.runQuery(final.sql);
      assert.deepEqual(result.trace.at(-1)?.partialResult?.rows, final.rows, 'restored connection reads the final correct values after constraint rejections');
      validateTrace(result, final.sql, restored.tableData);
      console.log('PASS persistence round trip: created table, index, foreign key, and upserted rows retained.');
    } finally {
      restoredRuntime.close();
    }
  } catch (error) {
    fail('session acceptance', error);
  } finally {
    runtime.close();
  }

  console.log(`\n${successes}/25 successful queries; longest consecutive streak ${longestStreak}; ${failures.length} failures.`);
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 2;
});
