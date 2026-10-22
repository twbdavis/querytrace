import assert from 'node:assert/strict';
import { SqlRuntime } from '../lib/sqlRuntime';
import type { SchemaDef } from '../lib/schemas';
import type { SqlWorkerRequest, SqlWorkerResponse } from '../lib/sqlWorkerProtocol';

const originalURL = globalThis.URL;
const originalWorker = globalThis.Worker;
const workers: ControlledWorker[] = [];
const loadRequests: string[] = [];
let loadDelay = 0;
let queryRequests = 0;
class ControlledWorker {
  runtime = new SqlRuntime();
  def: SchemaDef | null = null;
  onmessage: ((event: MessageEvent<SqlWorkerResponse>) => void) | null = null;
  constructor() { workers.push(this); }
  terminate() { this.runtime.close(); }
  postMessage(request: SqlWorkerRequest) {
    void (async () => {
      if (request.operation === 'loadSchema') loadRequests.push(request.def.id);
      if (request.operation === 'loadSchema' && loadDelay) await new Promise((resolve) => setTimeout(resolve, loadDelay));
      if (request.operation === 'runQuery') queryRequests++;
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
    assert.equal((await useAppStore.getState().resumeCustomSchema()).ok, false, 'resume reports a missing checkpoint');
    assert.equal(useAppStore.getState().schemaLoading, false, 'missing checkpoints release the loading state');
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

    loadDelay = 40;
    useAppStore.getState().setCustomDdlDraft(replacement.ddl);
    const loading = useAppStore.getState().loadSchema(replacement);
    assert.equal(useAppStore.getState().schemaLoading, true);
    const before = queryRequests;
    await useAppStore.getState().runQuery('UPDATE sample SET value=99;');
    assert.equal(queryRequests, before, 'queries submitted during schema replacement never reach the worker');
    const newerDraft = `${replacement.ddl}\n-- keep editing while building`;
    useAppStore.getState().setCustomDdlDraft(newerDraft);
    assert.equal((await loading).ok, true);
    assert.equal(useAppStore.getState().schemaLoading, false);
    assert.equal(useAppStore.getState().customDdlDraft, newerDraft, 'a successful build preserves newer edits');
    assert.deepEqual(useAppStore.getState().tableData.sample.rows, [[1, 7]]);
    loadDelay = 0;

    await Promise.all([
      useAppStore.getState().runQuery('UPDATE sample SET value=value+1;'),
      useAppStore.getState().runQuery('UPDATE sample SET value=value+1;'),
    ]);
    assert.deepEqual(useAppStore.getState().tableData.sample.rows, [[1, 9]], 'accepted queries stay ordered through persistence');
    await useAppStore.getState().loadSchema({ ...def, id: 'other-session' });
    assert.equal((await useAppStore.getState().resumeCustomSchema()).ok, true);
    assert.deepEqual(useAppStore.getState().tableData.sample.rows, [[1, 9]], 'resume loads the saved checkpoint, including mutations');
    assert.equal(useAppStore.getState().customDdlDraft, newerDraft, 'resuming does not consume an unbuilt draft');
    loadDelay = 40;
    const acceptedLoad = useAppStore.getState().loadSchema(replacement);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const laterFailure = useAppStore.getState().loadSchema({ ...def, ddl: 'CREATE TABLE broken(id INT,id INT);' });
    assert.equal((await acceptedLoad).cancelled, true);
    assert.equal((await laterFailure).ok, false);
    assert.deepEqual(useAppStore.getState().tableData.sample.rows, [[1, 7]], 'a superseded successful worker load remains coherent if the newer load fails');
    await useAppStore.getState().runQuery('SELECT value FROM sample;');
    assert.deepEqual(useAppStore.getState().trace?.at(-1)?.partialResult?.rows, [[7]]);

    loadDelay = 0;
    useAppStore.getState().setCustomDdlDraft(newerDraft);
    const mutationBeforeResume = useAppStore.getState().runQuery('UPDATE sample SET value=8;');
    const resumeAfterMutation = useAppStore.getState().resumeCustomSchema();
    await mutationBeforeResume;
    assert.equal((await resumeAfterMutation).ok, true);
    assert.deepEqual(useAppStore.getState().tableData.sample.rows, [[1, 8]], 'resume waits for the accepted mutation checkpoint');

    loadDelay = 40;
    const laterSession = { ...def, id: 'later-session', ddl: 'CREATE TABLE sample(id INTEGER PRIMARY KEY,value INTEGER); INSERT INTO sample VALUES(1,31);' };
    const mutationBeforeCancelledResume = useAppStore.getState().runQuery('UPDATE sample SET value=9;');
    const supersededResume = useAppStore.getState().resumeCustomSchema();
    const laterSessionLoad = useAppStore.getState().loadSchema(laterSession);
    assert.equal((await supersededResume).cancelled, true, 'a later schema choice supersedes a resume waiting for a mutation');
    assert.equal(useAppStore.getState().schemaLoading, true, 'cancelled resume cannot clear the newer load indicator');
    await mutationBeforeCancelledResume;
    assert.equal((await laterSessionLoad).ok, true);
    assert.equal(useAppStore.getState().schemaDef.id, laterSession.id);
    assert.deepEqual(useAppStore.getState().tableData.sample.rows, [[1, 31]]);
    assert.equal(useAppStore.getState().customDdlDraft, newerDraft, 'cancelled resume preserves the draft');
    assert.equal((await useAppStore.getState().resumeCustomSchema()).ok, true);
    assert.deepEqual(useAppStore.getState().tableData.sample.rows, [[1, 9]], 'superseding resume never discards the accepted custom mutation');

    const mutationBeforeFailedChoice = useAppStore.getState().runQuery('UPDATE sample SET value=10;');
    const cancelledBeforeFailedChoice = useAppStore.getState().resumeCustomSchema();
    const failedChoice = useAppStore.getState().loadSchema({ ...def, ddl: 'CREATE TABLE broken(id INT,id INT);' });
    assert.equal((await cancelledBeforeFailedChoice).cancelled, true);
    await mutationBeforeFailedChoice;
    assert.equal((await failedChoice).ok, false);
    assert.equal(useAppStore.getState().schemaLoading, false, 'a failed newer choice releases its loading state');
    assert.deepEqual(useAppStore.getState().tableData.sample.rows, [[1, 10]], 'a failed later choice preserves the previous database, not an older resume');

    // With persistence unavailable in this Node host, its async read still
    // yields once. Select another schema specifically during that read.
    const loadsBeforeReadRace = loadRequests.length;
    const resumeDuringRead = useAppStore.getState().resumeCustomSchema();
    await Promise.resolve();
    const choiceDuringRead = useAppStore.getState().loadSchema(laterSession);
    assert.equal((await resumeDuringRead).cancelled, true, 'a later choice also supersedes resume during its persistence read');
    assert.equal(useAppStore.getState().schemaLoading, true);
    assert.equal((await choiceDuringRead).ok, true);
    assert.deepEqual(loadRequests.slice(loadsBeforeReadRace), [laterSession.id], 'obsolete resume never reaches the worker');

    const acceptedResume = useAppStore.getState().resumeCustomSchema();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const failedAfterAcceptedResume = useAppStore.getState().loadSchema({ ...def, ddl: 'CREATE TABLE broken(id INT,id INT);' });
    assert.equal((await acceptedResume).cancelled, true);
    assert.equal((await failedAfterAcceptedResume).ok, false);
    assert.equal(useAppStore.getState().schemaLoading, false);
    assert.deepEqual(useAppStore.getState().tableData.sample.rows, [[1, 10]], 'an already accepted resume stays coherent if the newer choice fails');
    await useAppStore.getState().runQuery('SELECT value FROM sample;');
    assert.deepEqual(useAppStore.getState().trace?.at(-1)?.partialResult?.rows, [[10]], 'worker and visible schema agree after cancellation and failure');
    console.log('PASS store races: mutation/edit, saved checkpoint, schema replacement, query gating, newer drafts, queued mutations, and resume ordering across pending writes, persistence reads, and later failures.');
  } finally {
    for (const worker of workers) worker.terminate();
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.URL = originalURL;
  globalThis.Worker = originalWorker;
});
