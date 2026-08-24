import type { SchemaDef } from './schemas';
import type { LoadedSchema } from './sqlRuntime';
import type { TraceStep } from './traceEngine';

export type SqlWorkerRequest =
  | { id: number; operation: 'loadSchema'; def: SchemaDef; savedBytes?: Uint8Array }
  | { id: number; operation: 'runQuery'; sql: string };

export type SqlWorkerResponse =
  | { id: number; ok: true; result: LoadedSchema | TraceStep[] }
  | { id: number; ok: false; error: string };
