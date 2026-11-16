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
import { buildCoverage, dialectProfile, normalizeDialect, type DialectProfile, type QueryCoverage, type SourceDialect } from './queryCompatibility';
import type { FkEdgeDef, SchemaDef, TableMeta } from './schemas';
import { explainMutationError, traceStatement, TraceError, type TraceStep } from './traceEngine';
import { withResultBudget } from './resourceLimits';
import { installUnicodeLike } from './unicodeLike';
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
  /** What the stages explain and what a highlighted source row means for this statement. */
  coverage: QueryCoverage;
  /** Present after data or structure changes: refreshed tables and custom database bytes. */
  mutation?: {
    tableData: Record<string, TableData>;
    changedTables: string[];
    schema?: TableMeta[];
    fkEdges?: FkEdgeDef[];
    databaseBytes?: Uint8Array;
  };
}

/** Per-request execution options, captured when Run is pressed and never read from mutable state later. */
export interface QueryOptions {
  dialect?: SourceDialect;
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

  /** Run one statement under the given source dialect; the options are fixed for this request. */
  runQuery(sql: string, options: QueryOptions = {}): QueryRun {
    if (!this.db) throw new Error('SQLite is still starting. Try again in a moment.');
    return withResultBudget(this.db, () => this.runBoundedQuery(sql, normalizeDialect(options.dialect)));
  }

  /**
   * Give LIKE the meaning this request's profile needs, on a connection whose
   * current state is not assumed (an export in between reopens it). PostgreSQL
   * and Oracle compare letter case; MySQL, MariaDB and SQL Server ignore it in
   * every alphabet; SQLite itself ignores it for A to Z only.
   *
   * SQLite will not build an index or a generated column on a LIKE that was
   * switched or replaced, and one built on its own LIKE would disagree with a
   * changed one. So: a schema that already has such an object keeps SQLite's
   * LIKE in every mode (returns true, for a note), and a CREATE that mentions
   * LIKE first gets a fresh connection with SQLite's own function.
   */
  private applyLikeRules(db: Database, profile: DialectProfile, create: { mentionsLike: boolean } | null): boolean {
    const changed = () => db.exec("SELECT 1 FROM pragma_function_list WHERE name = 'like' AND builtin = 0 LIMIT 1").length > 0;
    if (create) {
      // sql.js reopens the database on export, which drops every replaced function.
      if (create.mentionsLike && changed()) exportDatabase(db);
      return false;
    }
    const wantsOwnRules = profile.caseSensitiveLike || profile.unicodeText;
    const pinned = wantsOwnRules && db.exec(
      `SELECT 1 FROM sqlite_master WHERE instr(lower(sql), 'like') > 0
         AND (type = 'index' OR instr(lower(sql), 'generated') > 0 OR instr(lower(sql), ' as (') > 0) LIMIT 1`
    ).length > 0;
    if (pinned || !wantsOwnRules) {
      if (changed()) db.run('PRAGMA case_sensitive_like = OFF');
    } else if (profile.caseSensitiveLike) {
      db.run('PRAGMA case_sensitive_like = ON');
    } else {
      installUnicodeLike(db);
    }
    return pinned;
  }

  private runBoundedQuery(sql: string, dialect: SourceDialect): QueryRun {
    if (!this.db) throw new Error('SQLite is still starting. Try again in a moment.');
    if (sql.length > MAX_QUERY_CHARS) {
      throw new Error(`Queries are limited to ${MAX_QUERY_CHARS.toLocaleString()} characters.`);
    }

    const profile = dialectProfile(dialect);
    const statement = splitSqlStatements(normalizePastedText(sql))[0];
    const mentionsLike = !!statement && /\bLIKE\b/i.test(statement.masked);
    if (statement && /^CREATE\b/i.test(statement.masked.trim())) {
      this.applyLikeRules(this.db, profile, { mentionsLike });
      const run = runCreateStatement(this.db, sql, this.schema, this.isCustom, dialect);
      this.schema = run.mutation!.schema!;
      this.tableData = run.mutation!.tableData;
      return { ...run, coverage: buildCoverage(dialect, 'result-only', [], 'none') };
    }
    // Set per request, so every stage query of this trace agrees with the result.
    const likePinned = this.applyLikeRules(this.db, profile, null);

    const parsed = parseQuery(sql, { schema: this.schema, dialect });
    if (!parsed.ok) throw new TraceError(parsed.error);

    const selects = parsed.kind === 'select' ? [parsed.ast] : parsed.kind === 'compound' ? parsed.branches : [];
    // Each UNION branch runs on its own, so the candidate count is per branch,
    // not the product of every branch's tables.
    const branches = selects.flatMap((select) => {
      const chain: typeof select[] = [];
      for (let branch: typeof select | null | undefined = select; branch; branch = branch._next) chain.push({ ...branch, _next: null });
      return chain;
    });
    for (const select of branches) {
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
    const { steps, mutation, notes: engineNotes, explanation } = traced;
    assignQueryRanges(steps, sql);
    let notes = [...parsed.notes, ...(engineNotes ?? [])];
    if (likePinned && mentionsLike) {
      // The translator's note describes the profile's LIKE, which this schema cannot have.
      notes = [
        ...notes.filter((note) => note.from !== 'LIKE'),
        { from: 'LIKE', to: `SQLite's LIKE, which ignores the case of A to Z only (an index or generated column in this schema is built on it, so it cannot follow ${profile.label} rules here)` },
      ];
    }
    // Source-row associations exist only where a step carries them; a label
    // must never promise lineage the steps do not provide.
    const lineage = steps.some((step) => !!step.resultRowSources) ? 'rows' : 'none';
    const coverage = buildCoverage(dialect, explanation, parsed.features, lineage);

    if (!mutation) return { trace: steps, notes, coverage };
    this.tableData = mutation.tableData;
    return {
      trace: steps,
      notes,
      coverage,
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
