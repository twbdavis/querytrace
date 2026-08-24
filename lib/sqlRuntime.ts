import type { Database } from 'sql.js';
import { assignQueryRanges } from './clauseRanges';
import { createDatabase, getTableData, introspectSchema, restoreDatabase, type TableData } from './db';
import { parseQuery, queryTableNames } from './parser';
import type { FkEdgeDef, SchemaDef, TableMeta } from './schemas';
import { buildTrace, TraceError, type TraceStep } from './traceEngine';

const MAX_QUERY_CHARS = 20_000;
const MAX_JOIN_CANDIDATES = 250_000;

export interface LoadedSchema {
  schema: TableMeta[];
  fkEdges: FkEdgeDef[];
  tableData: Record<string, TableData>;
  /** Only custom databases are exported; built-ins are cheaper to rebuild from their tiny DDL. */
  databaseBytes?: Uint8Array;
}

/** Owns the only live SQLite connection. Intended to run inside the SQL Web Worker. */
export class SqlRuntime {
  private db: Database | null = null;
  private schema: TableMeta[] = [];
  private tableData: Record<string, TableData> = {};

  async loadSchema(def: SchemaDef, savedBytes?: Uint8Array): Promise<LoadedSchema> {
    const isCustom = def.id === 'custom';
    const nextDb = savedBytes
      ? await restoreDatabase(savedBytes, isCustom)
      : await createDatabase(def.ddl, isCustom);

    try {
      const { schema, fkEdges } = introspectSchema(nextDb);
      if (schema.length === 0) {
        throw new Error('No tables were created. Add at least one CREATE TABLE statement.');
      }
      const tableData: Record<string, TableData> = {};
      for (const table of schema) tableData[table.name] = getTableData(nextDb, table.name);

      this.db?.close();
      this.db = nextDb;
      this.schema = schema;
      this.tableData = tableData;
      return {
        schema,
        fkEdges,
        tableData,
        databaseBytes: isCustom ? nextDb.export() : undefined,
      };
    } catch (error) {
      nextDb.close();
      throw error;
    }
  }

  runQuery(sql: string): TraceStep[] {
    if (!this.db) throw new Error('SQLite is still starting. Try again in a moment.');
    if (sql.length > MAX_QUERY_CHARS) {
      throw new Error(`Queries are limited to ${MAX_QUERY_CHARS.toLocaleString()} characters.`);
    }

    const parsed = parseQuery(sql);
    if (!parsed.ok) throw new TraceError(parsed.error);

    let candidateRows = 1;
    for (const tableName of queryTableNames(parsed.ast)) {
      const table = Object.entries(this.tableData).find(
        ([name]) => name.toLowerCase() === tableName.toLowerCase()
      )?.[1];
      candidateRows *= Math.max(table?.rows.length ?? 1, 1);
      if (candidateRows > MAX_JOIN_CANDIDATES) {
        throw new TraceError(
          'This join could examine too many row combinations for an interactive browser trace. Add a narrower schema or fewer joins.'
        );
      }
    }

    const trace = buildTrace(parsed.ast, this.db, this.schema);
    assignQueryRanges(trace, sql);
    return trace;
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.schema = [];
    this.tableData = {};
  }
}
