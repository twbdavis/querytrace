import type { SchemaDef } from './schemas';
import type { LoadedSchema, QueryRun } from './sqlRuntime';

export type SqlWorkerRequest =
  | { id: number; operation: 'loadSchema'; def: SchemaDef; savedBytes?: Uint8Array }
  | { id: number; operation: 'runQuery'; sql: string };

export type SqlWorkerResponse =
  | { id: number; ok: true; result: LoadedSchema | QueryRun }
  | { id: number; ok: false; error: string; statement?: string };
