import type { SchemaDef } from './schemas';
import type { LoadedSchema, QueryRun } from './sqlRuntime';

export type SqlWorkerRequest =
  | { id: number; operation: 'loadSchema'; def: SchemaDef; savedBytes?: Uint8Array }
  | { id: number; operation: 'runQuery'; sql: string };

/** Last acknowledged database, used only to recover a terminated worker. */
export interface SqlWorkerCheckpoint {
  def: SchemaDef;
  databaseBytes: Uint8Array;
}

export type SqlWorkerResponse =
  | { id: number; ok: true; result: LoadedSchema | QueryRun; checkpoint?: SqlWorkerCheckpoint }
  | { id: number; ok: false; error: string; statement?: string; recover?: true };
