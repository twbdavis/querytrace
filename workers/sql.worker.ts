/// <reference lib="webworker" />

import { describeLoadFailure, SqlRuntime } from '../lib/sqlRuntime';
import type { SqlWorkerRequest, SqlWorkerResponse } from '../lib/sqlWorkerProtocol';

const runtime = new SqlRuntime();
let queue = Promise.resolve();

// Serialize requests so a schema switch cannot race a query against the old connection.
self.onmessage = (event: MessageEvent<SqlWorkerRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      const result =
        request.operation === 'loadSchema'
          ? await runtime.loadSchema(request.def, request.savedBytes)
          : runtime.runQuery(request.sql);
      self.postMessage({ id: request.id, ok: true, result } satisfies SqlWorkerResponse);
    } catch (error) {
      const failure = describeLoadFailure(error);
      self.postMessage({
        id: request.id,
        ok: false,
        error: failure.message,
        statement: failure.statement,
      } satisfies SqlWorkerResponse);
    }
  });
};

self.addEventListener('close', () => runtime.close());
