import assert from 'node:assert/strict';
import { SqlRuntime } from '../lib/sqlRuntime';
import type { SchemaDef } from '../lib/schemas';
import type { SqlWorkerRequest, SqlWorkerResponse } from '../lib/sqlWorkerProtocol';

const originalURL = globalThis.URL;
const originalWorker = globalThis.Worker;
const workers: ControlledWorker[] = [];
class ControlledWorker {
  runtime = new SqlRuntime();
  def: SchemaDef | null = null;
  onmessage: ((event: MessageEvent<SqlWorkerResponse>) => void) | null = null;
  constructor() { workers.push(this); }
  terminate() { this.runtime.close(); }
  postMessage(request: SqlWorkerRequest) {
    void (async () => {
      const result = request.operation === 'loadSchema' ? await this.runtime.loadSchema(request.def, request.savedBytes) : this.runtime.runQuery(request.sql);
      if (request.operation === 'loadSchema') this.def = request.def;
      const checkpoint = request.operation === 'loadSchema' || ('mutation' in result && result.mutation)
        ? { def: this.def!, databaseBytes: this.runtime.exportSnapshot() } : undefined;
      setTimeout(() => this.onmessage?.({ data: { id: request.id, ok: true, result, checkpoint } } as MessageEvent<SqlWorkerResponse>), request.operation === 'runQuery' ? 40 : 0);
    })().catch((error: Error) => this.onmessage?.({ data: { id: request.id, ok: false, error: error.message } } as MessageEvent<SqlWorkerResponse>));
  }
}

async function main() {
  // tsx's CommonJS test host has no import.meta URL; the transport uses only
  // this harmless synthetic URL and the controlled worker, never a real file.
  globalThis.URL = class extends originalURL {
    constructor(input: string | URL, base?: string | URL) { super(input, base ?? (input === '../workers/sql.worker.ts' ? 'file:///isolated/sqlWorkerClient.ts' : undefined)); }
  };
  globalThis.Worker = ControlledWorker as unknown as typeof Worker;
  const { useAppStore } = await import('../store/useAppStore');
  const def: SchemaDef = { id: 'custom', name: 'Isolated mutation race', description: '', starterQuery: 'SELECT * FROM sample;', ddl: 'CREATE TABLE sample(id INTEGER PRIMARY KEY,value INTEGER); INSERT INTO sample VALUES(1,1);' };
  const mutateAndEdit = async (value: number) => {
    const pending = useAppStore.getState().runQuery(`UPDATE sample SET value=${value} WHERE id=1;`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    useAppStore.getState().setSql('SELECT value FROM sample;');
    await pending;
  };
  try {
    assert.ok((await useAppStore.getState().loadSchema(def)).ok);
    await mutateAndEdit(2);
    assert.deepEqual(useAppStore.getState().tableData.sample.rows, [[1, 2]], 'canvas adopts acknowledged mutation');
    assert.equal(useAppStore.getState().sql, 'SELECT value FROM sample;', 'new text remains');
    assert.equal(useAppStore.getState().trace, null, 'obsolete trace stays cancelled');
    const restored = new SqlRuntime();
    try {
      const saved = await restored.loadSchema(def, useAppStore.getState().savedCustomDatabase!);
      assert.deepEqual(saved.tableData.sample.rows, [[1, 2]], 'saved checkpoint adopts acknowledged mutation');
    } finally { restored.close(); }

    const pending = useAppStore.getState().runQuery('UPDATE sample SET value=3 WHERE id=1;');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const replacement = { ...def, name: 'Replacement schema', ddl: 'CREATE TABLE sample(id INTEGER PRIMARY KEY,value INTEGER); INSERT INTO sample VALUES(1,7);' };
    await Promise.all([pending, useAppStore.getState().loadSchema(replacement)]);
    assert.deepEqual(useAppStore.getState().tableData.sample.rows, [[1, 7]], 'old mutation cannot replace the newer schema');
    const pendingBeforeFailure = useAppStore.getState().runQuery('UPDATE sample SET value=8 WHERE id=1;');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const rejectedLoad = useAppStore.getState().loadSchema({ ...def, ddl: 'CREATE TABLE broken(id INT,id INT);' });
    await pendingBeforeFailure;
    assert.equal((await rejectedLoad).ok, false);
    assert.deepEqual(useAppStore.getState().tableData.sample.rows, [[1, 8]], 'a failed schema switch preserves the acknowledged old-session mutation');
    console.log('PASS mutation/edit race: canvas, saved checkpoint, cancelled trace, successful schema switch, and failed schema switch.');
  } finally {
    for (const worker of workers) worker.terminate();
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.URL = originalURL;
  globalThis.Worker = originalWorker;
});
