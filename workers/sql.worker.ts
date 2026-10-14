/// <reference lib="webworker" />

import { describeLoadFailure, SqlRuntime } from '../lib/sqlRuntime';
import type { SqlWorkerRequest, SqlWorkerResponse } from '../lib/sqlWorkerProtocol';
import type { SchemaDef } from '../lib/schemas';
import { RecoveryRequiredError } from '../lib/sqlRecovery';

const runtime = new SqlRuntime();
let queue = Promise.resolve();
let currentDef: SchemaDef | null = null;

// Serialize requests so a schema switch cannot race a query against the old connection.
self.onmessage = (event: MessageEvent<SqlWorkerRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    let completed = false;
    try {
      if (request.operation === 'loadSchema') {
        const result = await runtime.loadSchema(request.def, request.savedBytes);
        completed = true;
        currentDef = request.def;
        self.postMessage({ id: request.id, ok: true, result,
          checkpoint: { def: currentDef, databaseBytes: result.databaseBytes ?? runtime.exportSnapshot() },
        } satisfies SqlWorkerResponse);
      } else {
        const result = runtime.runQuery(request.sql);
        completed = true;
        self.postMessage({ id: request.id, ok: true, result,
          ...(result.mutation && currentDef ? { checkpoint: { def: currentDef, databaseBytes: result.mutation.databaseBytes ?? runtime.exportSnapshot() } } : {}),
        } satisfies SqlWorkerResponse);
      }
    } catch (error) {
      const failure = describeLoadFailure(error);
      self.postMessage({
        id: request.id,
        ok: false,
        error: failure.message,
        statement: failure.statement,
        ...(completed || error instanceof RecoveryRequiredError ? { recover: true } : {}),
      } satisfies SqlWorkerResponse);
    }
  });
};

self.addEventListener('close', () => runtime.close());
