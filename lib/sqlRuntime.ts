import type { Database } from 'sql.js';
import { assignQueryRanges } from './clauseRanges';
import {
  createDatabase,
  enforceCustomSchemaLimits,
  exportDatabase,
  getTableData,
  introspectSchema,
  restoreDatabase,
  SchemaBuildError,
  type TableData,
} from './db';
import type { DialectNote } from './dialect';
import { parseQuery, queryTableNames } from './parser';
import type { FkEdgeDef, SchemaDef, TableMeta } from './schemas';
import { traceStatement, TraceError, type TraceStep } from './traceEngine';

const MAX_QUERY_CHARS = 20_000;
const MAX_JOIN_CANDIDATES = 250_000;

export interface LoadedSchema {
  schema: TableMeta[];
  fkEdges: FkEdgeDef[];
  tableData: Record<string, TableData>;
  /** Only custom databases are exported; built-ins are cheaper to rebuild from their tiny DDL. */
  databaseBytes?: Uint8Array;
}

/** Everything one statement produced: the stages, dialect notes, and any data change. */
export interface QueryRun {
  trace: TraceStep[];
  /** How the learner's dialect was rewritten for SQLite, for display beside the result. */
  notes: DialectNote[];
  /** Present when the statement changed rows: refreshed tables and, for custom schemas, the bytes to save. */
  mutation?: {
    tableData: Record<string, TableData>;
    changedTables: string[];
    databaseBytes?: Uint8Array;
  };
}

/** A schema build failure that can point at the statement responsible. */
export interface SchemaLoadFailure {
  message: string;
  /** Original text of the failing statement, when one statement is to blame. */
  statement?: string;
}

/** Owns the only live SQLite connection. Intended to run inside the SQL Web Worker. */
export class SqlRuntime {
  private db: Database | null = null;
  private schema: TableMeta[] = [];
  private tableData: Record<string, TableData> = {};
  private isCustom = false;

  async loadSchema(def: SchemaDef, savedBytes?: Uint8Array): Promise<LoadedSchema> {
    const isCustom = def.id === 'custom';
    const nextDb = savedBytes
      ? await restoreDatabase(savedBytes, isCustom)
      : await createDatabase(def.ddl, isCustom);

    try {
      const { schema, fkEdges } = introspectSchema(nextDb);
      if (schema.length === 0) {
        throw new SchemaBuildError('No tables were created. Add at least one CREATE TABLE statement.');
      }
      const tableData: Record<string, TableData> = {};
      for (const table of schema) tableData[table.name] = getTableData(nextDb, table.name);

      this.db?.close();
      this.db = nextDb;
      this.schema = schema;
      this.tableData = tableData;
      this.isCustom = isCustom;
      return {
        schema,
        fkEdges,
        tableData,
        databaseBytes: isCustom ? exportDatabase(nextDb) : undefined,
      };
    } catch (error) {
      nextDb.close();
      throw error;
    }
  }

  runQuery(sql: string): QueryRun {
    if (!this.db) throw new Error('SQLite is still starting. Try again in a moment.');
    if (sql.length > MAX_QUERY_CHARS) {
      throw new Error(`Queries are limited to ${MAX_QUERY_CHARS.toLocaleString()} characters.`);
    }

    const parsed = parseQuery(sql);
    if (!parsed.ok) throw new TraceError(parsed.error);

    const selects = parsed.kind === 'select' ? [parsed.ast] : parsed.kind === 'compound' ? parsed.branches : [];
    for (const select of selects) {
      let candidateRows = 1;
      for (const tableName of queryTableNames(select)) {
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
    }

    const db = this.db;
    const { steps, mutation } = traceStatement(parsed, sql, db, this.schema, {
      enforce: this.isCustom ? () => enforceCustomSchemaLimits(db, this.schema) : undefined,
      persistent: this.isCustom,
    });
    assignQueryRanges(steps, sql);

    if (!mutation) return { trace: steps, notes: parsed.notes };
    this.tableData = mutation.tableData;
    return {
      trace: steps,
      notes: parsed.notes,
      mutation: {
        tableData: mutation.tableData,
        changedTables: mutation.changedTables,
        databaseBytes: this.isCustom ? exportDatabase(db) : undefined,
      },
    };
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.schema = [];
    this.tableData = {};
  }
}

/** Serialize any load error for the worker boundary. */
export function describeLoadFailure(error: unknown): SchemaLoadFailure {
  if (error instanceof SchemaBuildError) return { message: error.message, statement: error.statement };
  return { message: error instanceof Error ? error.message : String(error) };
}
