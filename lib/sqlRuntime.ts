import { emptyRecord } from './records';
import type { Database } from 'sql.js';
import { runCreateStatement } from './createStatement';
import { normalizePastedText, splitSqlStatements } from './sqlText';
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
import { explainMutationError, traceStatement, TraceError, type TraceStep } from './traceEngine';
import { withResultBudget } from './resourceLimits';
import { snapshotAfterCommit } from './sqlRecovery';

const MAX_QUERY_CHARS = 20_000;
/** Row combinations a trace may materialize: every intermediate join stage is kept for scrubbing. */
const MAX_JOIN_CANDIDATES = 50_000;

export interface LoadedSchema {
  schema: TableMeta[];
  fkEdges: FkEdgeDef[];
  tableData: Record<string, TableData>;
  /** Recovery snapshot; custom schemas also persist these bytes between visits. */
  databaseBytes?: Uint8Array;
}

/** Everything one statement produced: the stages, dialect notes, and any data change. */
export interface QueryRun {
  trace: TraceStep[];
  /** How the learner's dialect was rewritten for SQLite, for display beside the result. */
  notes: DialectNote[];
  /** Present after data or structure changes: refreshed tables and custom database bytes. */
  mutation?: {
    tableData: Record<string, TableData>;
    changedTables: string[];
    schema?: TableMeta[];
    fkEdges?: FkEdgeDef[];
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
      const loaded = withResultBudget(nextDb, () => {
        const { schema, fkEdges } = introspectSchema(nextDb);
        if (schema.length === 0) {
          throw new SchemaBuildError('No tables were created. Add at least one CREATE TABLE statement.');
        }
        const tableData = emptyRecord<TableData>();
        for (const table of schema) tableData[table.name] = getTableData(nextDb, table.name);
        // Export before replacing the working connection: an unsuccessful
        // payload/snapshot build must leave the previous session intact.
        return { schema, fkEdges, tableData: Object.fromEntries(Object.entries(tableData)), databaseBytes: exportDatabase(nextDb) };
      });
      this.db?.close();
      this.db = nextDb;
      this.schema = loaded.schema;
      this.tableData = loaded.tableData;
      this.isCustom = isCustom;
      return loaded;
    } catch (error) {
      nextDb.close();
      throw error;
    }
  }

  runQuery(sql: string): QueryRun {
    if (!this.db) throw new Error('SQLite is still starting. Try again in a moment.');
    return withResultBudget(this.db, () => this.runBoundedQuery(sql));
  }

  private runBoundedQuery(sql: string): QueryRun {
    if (!this.db) throw new Error('SQLite is still starting. Try again in a moment.');
    if (sql.length > MAX_QUERY_CHARS) {
      throw new Error(`Queries are limited to ${MAX_QUERY_CHARS.toLocaleString()} characters.`);
    }

    const statement = splitSqlStatements(normalizePastedText(sql))[0];
    if (statement && /^CREATE\b/i.test(statement.masked.trim())) {
      const run = runCreateStatement(this.db, sql, this.schema, this.isCustom);
      this.schema = run.mutation!.schema!;
      this.tableData = run.mutation!.tableData;
      return run;
    }

    const parsed = parseQuery(sql, { schema: this.schema });
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
            `This join could examine ${candidateRows.toLocaleString()} row combinations, more than the ${MAX_JOIN_CANDIDATES.toLocaleString()} an interactive browser trace can hold. Join fewer tables at once, or add the ON conditions that match the keys.`
          );
        }
      }
    }

    const db = this.db;
    // Result/snapshot limits can fail after the mutation's own trace stage.
    // Keep the entire trace atomic until all intermediate results are bounded.
    const writing = parsed.kind === 'mutation';
    if (writing) db.run('SAVEPOINT qt_request');
    let traced: ReturnType<typeof traceStatement>;
    try {
      traced = traceStatement(parsed, sql, db, this.schema, {
        enforce: () => enforceCustomSchemaLimits(db, this.schema),
        persistent: this.isCustom,
      });
      if (writing) {
        try { db.run('RELEASE qt_request'); }
        catch (error) {
          throw new TraceError(explainMutationError(error instanceof Error ? error.message : String(error), parsed.statement, parsed.table));
        }
      }
    } catch (error) {
      if (writing) db.run('ROLLBACK TO qt_request; RELEASE qt_request');
      throw error;
    }
    const { steps, mutation, notes: engineNotes } = traced;
    assignQueryRanges(steps, sql);
    const notes = [...parsed.notes, ...(engineNotes ?? [])];

    if (!mutation) return { trace: steps, notes };
    this.tableData = mutation.tableData;
    return {
      trace: steps,
      notes,
      mutation: {
        tableData: mutation.tableData,
        changedTables: mutation.changedTables,
        databaseBytes: this.isCustom ? snapshotAfterCommit(() => exportDatabase(db)) : undefined,
      },
    };
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.schema = [];
    this.tableData = {};
  }

  /** Last acknowledged state lets the client recover after terminating a busy worker. */
  exportSnapshot(): Uint8Array {
    if (!this.db) throw new Error('No database is loaded.');
    return exportDatabase(this.db);
  }
}

/** Serialize any load error for the worker boundary. */
export function describeLoadFailure(error: unknown): SchemaLoadFailure {
  if (error instanceof SchemaBuildError) return { message: error.message, statement: error.statement };
  return { message: error instanceof Error ? error.message : String(error) };
}
