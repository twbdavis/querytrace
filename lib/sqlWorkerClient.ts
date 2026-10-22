'use client';

import type { SchemaDef } from './schemas';
import type { LoadedSchema, QueryRun } from './sqlRuntime';
import type { SqlWorkerCheckpoint, SqlWorkerRequest, SqlWorkerResponse } from './sqlWorkerProtocol';

/** A worker failure; schema builds may name the statement that failed. */
export class WorkerRequestError extends Error {
  constructor(message: string, readonly statement?: string) {
    super(message);
  }
}

let worker: Worker | null = null;
let nextId = 1;
let checkpoint: SqlWorkerCheckpoint | null = null;
let dispatchQueue = Promise.resolve();
const QUERY_DEADLINE_MS = 10_000;
const LOAD_DEADLINE_MS = 15_000;
type SqlWorkerPayload =
  | { operation: 'loadSchema'; def: SchemaDef; savedBytes?: Uint8Array }
  | { operation: 'runQuery'; sql: string };
const pending = new Map<
  number,
  { resolve: (value: LoadedSchema | QueryRun) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
>();

function stopWorker(error: Error): void {
  const stopped = worker;
  worker = null;
  stopped?.terminate();
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const active = new Worker(new URL('../workers/sql.worker.ts', import.meta.url), {
    type: 'module',
    name: 'querytrace-sql',
  });
  worker = active;
  active.onmessage = (event: MessageEvent<SqlWorkerResponse>) => {
    if (worker !== active) return;
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    if (!response.ok && response.recover) {
      stopWorker(new WorkerRequestError(`${response.error} The SQL worker was restarted; your last successful database will be restored before the next query.`, response.statement));
      return;
    }
    pending.delete(response.id);
    clearTimeout(request.timer);
    if (response.ok) {
      if (response.checkpoint) checkpoint = response.checkpoint;
      request.resolve(response.result);
    }
    else request.reject(new WorkerRequestError(response.error, response.statement));
  };
  active.onerror = (event) => {
    if (worker !== active) return;
    const error = new Error(event.message || 'The SQL worker stopped unexpectedly.');
    stopWorker(error);
  };
  active.onmessageerror = () => {
    if (worker === active) stopWorker(new Error('The SQL worker response could not be read. Try the query again.'));
  };
  return active;
}

function send<T extends LoadedSchema | QueryRun>(
  payload: SqlWorkerPayload
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const active = getWorker();
    const duration = payload.operation === 'loadSchema' ? LOAD_DEADLINE_MS : QUERY_DEADLINE_MS;
    const timer = setTimeout(() => {
      if (worker !== active || !pending.has(id)) return;
      stopWorker(new WorkerRequestError(`The ${payload.operation === 'loadSchema' ? 'schema build' : 'query'} exceeded ${duration / 1000} seconds. The SQL worker was restarted; your last successful database is preserved. Try a smaller query.`));
    }, duration);
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      timer,
    });
    try {
      active.postMessage({ ...payload, id } as SqlWorkerRequest);
    } catch (error) {
      stopWorker(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function request<T extends LoadedSchema | QueryRun>(payload: SqlWorkerPayload): Promise<T> {
  const queued = dispatchQueue.then(async () => {
    if (!worker && checkpoint && payload.operation === 'runQuery') {
      try {
        await send<LoadedSchema>({ operation: 'loadSchema', def: checkpoint.def, savedBytes: checkpoint.databaseBytes });
      } catch (error) {
        stopWorker(new Error('The saved SQL session could not be restored.'));
        throw error;
      }
    }
    return send<T>(payload);
  });
  // Begin each deadline only once its predecessor has finished, and retain a
  // usable queue after rejection. The worker also serializes received requests.
  dispatchQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

export function loadSchemaInWorker(def: SchemaDef, savedBytes?: Uint8Array): Promise<LoadedSchema> {
  return request<LoadedSchema>({ operation: 'loadSchema', def, savedBytes });
}

export function runQueryInWorker(sql: string): Promise<QueryRun> {
  return request<QueryRun>({ operation: 'runQuery', sql });
}
