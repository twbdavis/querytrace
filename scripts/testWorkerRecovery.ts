/* Exercise the actual client source with an isolated controllable worker.
   No browser/user database or deliberately expensive SQL is touched. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import type { Database } from 'sql.js';
import { queryAll } from '../lib/db';
import type { SchemaDef } from '../lib/schemas';
import type { LoadedSchema, QueryRun } from '../lib/sqlRuntime';
import type { SqlWorkerRequest, SqlWorkerResponse } from '../lib/sqlWorkerProtocol';
import { describeLoadFailure, SqlRuntime } from '../lib/sqlRuntime';
import { RecoveryRequiredError } from '../lib/sqlRecovery';

const originalTimeout = globalThis.setTimeout;
const originalWorker = globalThis.Worker;
const def: SchemaDef = { id: 'custom', name: 'Isolated worker recovery', description: '', ddl: '', starterQuery: 'READ' };

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: MessageEvent<SqlWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  state = 0;
  requests: SqlWorkerRequest[] = [];
  constructor() { ControlledWorker.instances.push(this); }
  terminate() { this.terminated = true; }
  postMessage(request: SqlWorkerRequest) {
    this.requests.push(request);
    if (request.operation === 'loadSchema' && request.def.name === 'HANG_LOAD') return;
    if (request.operation === 'runQuery' && request.sql === 'HANG_MUTATE') { this.state = 99; return; }
    if (request.operation === 'runQuery' && request.sql === 'POST_FAILURE') throw new Error('simulated postMessage failure');
    originalTimeout(() => {
      if (this.terminated) return;
      if (request.operation === 'loadSchema') {
        this.state = request.savedBytes?.[0] ?? 1;
        this.reply({ id: request.id, ok: true, result: { schema: [], fkEdges: [], tableData: {} }, checkpoint: { def: request.def, databaseBytes: new Uint8Array([this.state]) } });
      } else if (request.sql === 'CRASH') this.onerror?.({ message: 'simulated worker crash' } as ErrorEvent);
      else if (request.sql === 'MESSAGE_FAILURE') this.onmessageerror?.();
      else if (request.sql === 'RECOVERY_FAILURE') {
        this.state = 99;
        this.reply({ id: request.id, ok: false, recover: true, error: 'simulated checkpoint failure after commit' });
      }
      else if (request.sql === 'BAD_SQL') this.reply({ id: request.id, ok: false, error: 'simulated invalid SQL' });
      else {
        if (request.sql === 'MUTATE') this.state = 2;
        this.reply({ id: request.id, ok: true, result: { trace: [{ stage: 'select', label: 'Controlled result', narration: 'Isolated worker fixture.', activeTables: [], activeColumns: [], activeEdges: [], litRows: {}, dimmedRows: {}, partialResult: { columns: ['value'], rows: [[this.state]] } }], notes: [] },
          ...(request.sql === 'MUTATE' ? { checkpoint: { def, databaseBytes: new Uint8Array([this.state]) } } : {}),
        });
      }
    }, 1);
  }
  reply(response: SqlWorkerResponse) { this.onmessage?.({ data: response } as MessageEvent<SqlWorkerResponse>); }
}

async function main() {
  globalThis.Worker = ControlledWorker as unknown as typeof Worker;
  // Accelerate only the production deadlines; worker response scheduling
  // still uses the real timer, avoiding host CPU/memory exhaustion.
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) =>
    originalTimeout(callback as (...args: unknown[]) => void, delay === 10_000 || delay === 15_000 ? 20 : delay, ...args)
  ) as unknown as typeof setTimeout;
  const path = resolve('lib/sqlWorkerClient.ts');
  const source = readFileSync(path, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path).href));
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const client = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`) as {
    loadSchemaInWorker: (schema: SchemaDef) => Promise<LoadedSchema>;
    runQueryInWorker: (sql: string) => Promise<QueryRun>;
  };
  const read = async () => (await client.runQueryInWorker('READ')).trace.at(-1)!.partialResult!.rows;
  await client.loadSchemaInWorker(def);
  await client.runQueryInWorker('MUTATE');
  assert.deepEqual(await read(), [[2]]);

  // An unacknowledged mutation must not replace the last confirmed checkpoint.
  const previous = ControlledWorker.instances.at(-1)!;
  const outcomes = await Promise.allSettled([client.runQueryInWorker('HANG_MUTATE'), client.runQueryInWorker('READ'), client.runQueryInWorker('READ')]);
  assert.equal(outcomes[0].status, 'rejected');
  assert.match((outcomes[0] as PromiseRejectedResult).reason.message, /exceeded 10 seconds/);
  assert.ok(previous.terminated);
  for (const outcome of outcomes.slice(1)) {
    assert.equal(outcome.status, 'fulfilled');
    assert.deepEqual((outcome as PromiseFulfilledResult<QueryRun>).value.trace.at(-1)!.partialResult!.rows, [[2]]);
  }
  assert.equal(ControlledWorker.instances.at(-1)!.requests[0].operation, 'loadSchema', 'replacement worker restores before running queued queries');

  previous.onerror?.({ message: 'late stale error' } as ErrorEvent);
  previous.reply({ id: 1, ok: true, result: { schema: [], fkEdges: [], tableData: {} }, checkpoint: { def, databaseBytes: new Uint8Array([77]) } });
  assert.deepEqual(await read(), [[2]], 'stale events cannot terminate the replacement or replace its checkpoint');

  for (const sql of ['CRASH', 'POST_FAILURE', 'MESSAGE_FAILURE', 'RECOVERY_FAILURE']) {
    const failed = ControlledWorker.instances.at(-1)!;
    await assert.rejects(client.runQueryInWorker(sql));
    assert.ok(failed.terminated);
    assert.deepEqual(await read(), [[2]], `${sql}: confirmed database and queue recover`);
  }
  await assert.rejects(client.runQueryInWorker('BAD_SQL'), /invalid SQL/);
  assert.deepEqual(await read(), [[2]], 'ordinary SQL rejection does not destroy the session');
  await assert.rejects(client.loadSchemaInWorker({ ...def, name: 'HANG_LOAD' }), /exceeded 15 seconds/);
  assert.deepEqual(await read(), [[2]], 'a stalled replacement schema retains the previous confirmed database');
  await verifyCommittedSnapshotFailure();
  await verifyWorkerResponseFailures();
  console.log('PASS worker deadlines, queued recovery, checkpoint rollback, crash/post/message/export failures, stale events, and SQL rejection.');
}

async function verifyCommittedSnapshotFailure() {
  const runtime = new SqlRuntime();
  try {
    await runtime.loadSchema({ ...def, ddl: 'CREATE TABLE sample (id INTEGER PRIMARY KEY, value INTEGER); INSERT INTO sample VALUES (1, 1);' });
    const database = (runtime as unknown as { db: Database }).db;
    const originalExport = database.export;
    for (const sql of ['UPDATE sample SET value = 2 WHERE id = 1', 'CREATE TABLE added (id INTEGER PRIMARY KEY)']) {
      database.export = () => { throw new Error('simulated export failure'); };
      assert.throws(() => runtime.runQuery(sql), (error: unknown) => error instanceof RecoveryRequiredError);
      database.export = originalExport;
    }
    // These committed changes are deliberately not described as rolled back:
    // the recovery flag makes the client replace this runtime from its ACK.
    assert.deepEqual(runtime.runQuery('SELECT value FROM sample').trace.at(-1)!.partialResult!.rows, [[2]]);
    assert.deepEqual(queryAll(database, "SELECT name FROM sqlite_master WHERE name = 'added'").rows, [['added']]);
  } finally { runtime.close(); }
}

async function verifyWorkerResponseFailures() {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previousSelf = globals.self;
  const previousFixture = globals.__workerRecoveryFixture;
  const source = readFileSync(resolve('workers/sql.worker.ts'), 'utf8').replace(/^import .*;\r?$/gm, '');
  try {
    for (const fault of ['checkpoint', 'query-response', 'load-response'] as const) {
      let armed = false;
      let instance: FixtureRuntime | undefined;
      class FixtureRuntime extends SqlRuntime {
        constructor() { super(); instance = this; }
        override exportSnapshot() {
          if (armed && fault === 'checkpoint') throw new Error('simulated checkpoint failure');
          return super.exportSnapshot();
        }
      }
      let resolveResponse: ((response: SqlWorkerResponse) => void) | undefined;
      const surface = {
        onmessage: undefined as ((event: MessageEvent<SqlWorkerRequest>) => void) | undefined,
        addEventListener: () => undefined,
        postMessage: (response: SqlWorkerResponse) => {
          if (armed && response.ok && fault !== 'checkpoint') throw new Error('simulated response delivery failure');
          resolveResponse?.(response);
        },
      };
      globals.self = surface;
      globals.__workerRecoveryFixture = { SqlRuntime: FixtureRuntime, describeLoadFailure, RecoveryRequiredError };
      const compiled = ts.transpileModule(`const { SqlRuntime, describeLoadFailure, RecoveryRequiredError } = globalThis.__workerRecoveryFixture;\n${source}\n// ${fault}`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
      await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
      const dispatch = (request: SqlWorkerRequest) => new Promise<SqlWorkerResponse>((resolveResponsePromise, reject) => {
        const timer = originalTimeout(() => reject(new Error('The isolated worker fixture did not respond.')), 1_000);
        resolveResponse = (response) => { clearTimeout(timer); resolveResponsePromise(response); };
        surface.onmessage!({ data: request } as MessageEvent<SqlWorkerRequest>);
      });
      try {
        const schema = { ...def, id: 'fixture-builtin', ddl: 'CREATE TABLE sample (id INTEGER PRIMARY KEY, value INTEGER); INSERT INTO sample VALUES (1, 1);' };
        const loaded = await dispatch({ id: 1, operation: 'loadSchema', def: schema });
        assert.equal(loaded.ok, true);
        const invalid = await dispatch({ id: 2, operation: 'runQuery', sql: 'SELECT * FROM missing_table' });
        assert.equal(invalid.ok, false);
        assert.ok(!invalid.ok && !invalid.recover, 'ordinary rejected SQL leaves the worker usable');
        armed = true;
        const failed = await dispatch(fault === 'load-response'
          ? { id: 3, operation: 'loadSchema', def: { ...schema, ddl: schema.ddl.replace('(1, 1)', '(1, 3)') } }
          : { id: 3, operation: 'runQuery', sql: 'UPDATE sample SET value = 2 WHERE id = 1' });
        assert.ok(!failed.ok && failed.recover, `${fault}: an unacknowledged state change requires client recovery`);
        assert.deepEqual(instance!.runQuery('SELECT value FROM sample').trace.at(-1)!.partialResult!.rows, [[fault === 'load-response' ? 3 : 2]], 'the fixture confirms the changed state exists before client termination');
      } finally { instance?.close(); }
    }
  } finally {
    if (previousSelf === undefined) delete globals.self; else globals.self = previousSelf;
    if (previousFixture === undefined) delete globals.__workerRecoveryFixture; else globals.__workerRecoveryFixture = previousFixture;
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.setTimeout = originalTimeout;
  globalThis.Worker = originalWorker;
});
