'use client';

import type { SchemaDef } from './schemas';
import type { LoadedSchema } from './sqlRuntime';
import type { SqlWorkerRequest, SqlWorkerResponse } from './sqlWorkerProtocol';
import type { TraceStep } from './traceEngine';

let worker: Worker | null = null;
let nextId = 1;
type SqlWorkerPayload =
  | { operation: 'loadSchema'; def: SchemaDef; savedBytes?: Uint8Array }
  | { operation: 'runQuery'; sql: string };
const pending = new Map<
  number,
  { resolve: (value: LoadedSchema | TraceStep[]) => void; reject: (error: Error) => void }
>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/sql.worker.ts', import.meta.url), {
    type: 'module',
    name: 'querytrace-sql',
  });
  worker.onmessage = (event: MessageEvent<SqlWorkerResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.ok) request.resolve(response.result);
    else request.reject(new Error(response.error));
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'The SQL worker stopped unexpectedly.');
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function request<T extends LoadedSchema | TraceStep[]>(
  payload: SqlWorkerPayload
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    getWorker().postMessage({ ...payload, id } as SqlWorkerRequest);
  });
}

export function loadSchemaInWorker(def: SchemaDef, savedBytes?: Uint8Array): Promise<LoadedSchema> {
  return request<LoadedSchema>({ operation: 'loadSchema', def, savedBytes });
}

export function runQueryInWorker(sql: string): Promise<TraceStep[]> {
  return request<TraceStep[]>({ operation: 'runQuery', sql });
}
