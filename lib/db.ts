import type { Database, SqlJsStatic } from 'sql.js';
import type { FkEdgeDef, TableMeta } from './schemas';
import { SQL_WASM_URL } from './sqlWasmAsset.generated';

let sqlJs: Promise<SqlJsStatic> | null = null;

const MAX_CUSTOM_DDL_CHARS = 64_000;
const MAX_CUSTOM_STATEMENTS = 200;
const MAX_CUSTOM_TABLES = 12;
const MAX_CUSTOM_COLUMNS_PER_TABLE = 32;
const MAX_CUSTOM_TOTAL_COLUMNS = 160;
const MAX_CUSTOM_ROWS_PER_TABLE = 200;
const MAX_CUSTOM_TOTAL_ROWS = 1_000;
const MAX_PERSISTED_DATABASE_BYTES = 16 * 1024 * 1024;

/** Lazily initialize sql.js (the content-hashed WASM asset is served from /public). */
function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJs) {
    sqlJs = import('sql.js').then((m) =>
      m.default({ locateFile: () => SQL_WASM_URL })
    );
  }
  return sqlJs;
}

function validateCustomDdl(ddl: string): void {
  if (ddl.length > MAX_CUSTOM_DDL_CHARS) {
    throw new Error(`Custom schema SQL is limited to ${MAX_CUSTOM_DDL_CHARS.toLocaleString()} characters.`);
  }

  // Mask comments and string values before checking statement types. Custom
  // schemas intentionally support only the two operations exposed by the UI.
  const executable = ddl
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
  const statements = executable.split(';').map((statement) => statement.trim()).filter(Boolean);
  if (statements.length > MAX_CUSTOM_STATEMENTS) {
    throw new Error(`Custom schemas are limited to ${MAX_CUSTOM_STATEMENTS} SQL statements.`);
  }
  const unsupported = statements.find((statement) => {
    if (/^CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\b/i.test(statement)) {
      return /\bAS\s+SELECT\b/i.test(statement);
    }
    if (/^INSERT\s+INTO\b/i.test(statement)) {
      return !/\bVALUES\b/i.test(statement) || /\b(?:SELECT|WITH|PRAGMA|ATTACH)\b/i.test(statement);
    }
    return true;
  });
  if (unsupported) {
    throw new Error('Custom schemas may contain only CREATE TABLE and INSERT INTO statements.');
  }
}

/**
 * The schema builder accepts the common AUTO_INCREMENT spelling. SQLite automatically
 * assigns an omitted INTEGER PRIMARY KEY, so removing that dialect keyword
 * preserves the taught behavior while keeping the student's DDL portable here.
 */
function normalizeCourseDdl(ddl: string): string {
  return ddl.replace(/\bAUTO_INCREMENT\b/gi, '');
}

function enforceCustomSchemaLimits(db: Database, schema: TableMeta[]): void {
  if (schema.length > MAX_CUSTOM_TABLES) {
    throw new Error(`Custom schemas are limited to ${MAX_CUSTOM_TABLES} tables.`);
  }

  let totalColumns = 0;
  let totalRows = 0;
  for (const table of schema) {
    if (!table.columns.some((column) => column.pk)) {
      throw new Error(
        `Table "${table.name}" needs a PRIMARY KEY so every relation has a unique row identifier.`
      );
    }
    const primaryKeyColumns = table.columns.filter((column) => column.pk);
    const nullPrimaryKeyRows = Number(
      queryAll(
        db,
        `SELECT COUNT(*) FROM ${quoteIdent(table.name)} WHERE ${primaryKeyColumns
          .map((column) => `${quoteIdent(column.name)} IS NULL`)
          .join(' OR ')}`
      ).rows[0]?.[0] ?? 0
    );
    if (nullPrimaryKeyRows > 0) {
      throw new Error(
        `Primary-key columns in table "${table.name}" cannot contain NULL values (entity integrity).`
      );
    }
    if (table.columns.length > MAX_CUSTOM_COLUMNS_PER_TABLE) {
      throw new Error(`Table "${table.name}" exceeds the ${MAX_CUSTOM_COLUMNS_PER_TABLE}-column limit.`);
    }
    totalColumns += table.columns.length;
    const count = Number(queryAll(db, `SELECT COUNT(*) FROM ${quoteIdent(table.name)}`).rows[0]?.[0] ?? 0);
    if (count > MAX_CUSTOM_ROWS_PER_TABLE) {
      throw new Error(`Table "${table.name}" exceeds the ${MAX_CUSTOM_ROWS_PER_TABLE}-row limit.`);
    }
    totalRows += count;
  }
  if (totalColumns > MAX_CUSTOM_TOTAL_COLUMNS) {
    throw new Error(`Custom schemas are limited to ${MAX_CUSTOM_TOTAL_COLUMNS} total columns.`);
  }
  if (totalRows > MAX_CUSTOM_TOTAL_ROWS) {
    throw new Error(`Custom schemas are limited to ${MAX_CUSTOM_TOTAL_ROWS.toLocaleString()} total rows.`);
  }
}

/** Build a fresh, resource-bounded in-memory database from schema SQL. */
export async function createDatabase(ddl: string, validateAsCustom = false): Promise<Database> {
  if (validateAsCustom) validateCustomDdl(ddl);
  const SQL = await getSqlJs();
  const db = new SQL.Database();
  try {
    // Keep accidental or hostile custom schemas from exhausting browser memory.
    db.run('PRAGMA max_page_count = 16384; PRAGMA foreign_keys = ON;');
    db.run(validateAsCustom ? normalizeCourseDdl(ddl) : ddl);
    if (validateAsCustom) {
      const { schema } = introspectSchema(db);
      enforceCustomSchemaLimits(db, schema);
    }
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

/** Restore a database previously exported by this app and reapply all safety limits. */
export async function restoreDatabase(bytes: Uint8Array, validateAsCustom = false): Promise<Database> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PERSISTED_DATABASE_BYTES) {
    throw new Error('The saved database is empty or exceeds the 16 MB restoration limit.');
  }
  const SQL = await getSqlJs();
  const db = new SQL.Database(bytes);
  try {
    db.run('PRAGMA max_page_count = 16384; PRAGMA foreign_keys = ON;');
    const integrity = queryAll(db, 'PRAGMA quick_check').rows[0]?.[0];
    if (integrity !== 'ok') throw new Error('The saved SQLite database failed its integrity check.');
    if (validateAsCustom) {
      const unsupportedObjects = queryAll(
        db,
        `SELECT name FROM sqlite_master WHERE type NOT IN ('table', 'index') AND name NOT LIKE 'sqlite_%' LIMIT 1`
      );
      if (unsupportedObjects.rows.length) {
        throw new Error('The saved custom database contains unsupported SQLite objects.');
      }
      const { schema } = introspectSchema(db);
      enforceCustomSchemaLimits(db, schema);
    }
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
}

interface Exec {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
}

export function queryAll(db: Exec, sql: string): QueryResult {
  const res = db.exec(sql);
  if (res.length === 0) return { columns: [], rows: [] };
  return { columns: res[0].columns, rows: res[0].values };
}

/**
 * Read table, column and key metadata straight out of SQLite, so any DDL a
 * user writes (PRIMARY KEY, CONSTRAINT ... FOREIGN KEY ...
 * REFERENCES parent (column)) drives the canvas without a separate config.
 */
export function introspectSchema(db: Exec): { schema: TableMeta[]; fkEdges: FkEdgeDef[] } {
  const tables = queryAll(
    db,
    `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid`
  );

  const schema: TableMeta[] = [];
  const fkEdges: FkEdgeDef[] = [];

  for (const trow of tables.rows) {
    const table = String(trow[0]);
    const createSql = String(trow[1] ?? '');
    if (/WITHOUT\s+ROWID/i.test(createSql)) {
      throw new Error(
        `Table "${table}" is declared WITHOUT ROWID; QueryTrace needs ordinary rowid tables to trace rows.`
      );
    }

    const info = queryAll(db, `PRAGMA table_info(${quoteIdent(table)})`);
    // PRAGMA table_info: cid, name, type, notnull, dflt_value, pk
    const columns = info.rows.map((r) => ({
      name: String(r[1]),
      type: String(r[2] ?? '') || undefined,
      notNull: Number(r[3]) > 0 || Number(r[5]) > 0 ? true : undefined,
      defaultValue: r[4] === null ? null : String(r[4]),
      pk: Number(r[5]) > 0 ? true : undefined,
      fk: undefined as TableMeta['columns'][number]['fk'],
    }));

    const fks = queryAll(db, `PRAGMA foreign_key_list(${quoteIdent(table)})`);
    // PRAGMA foreign_key_list: id, seq, table, from, to, on_update, on_delete, match
    for (const f of fks.rows) {
      const parent = String(f[2]);
      const from = String(f[3]);
      const to = f[4] === null ? null : String(f[4]);
      const col = columns.find((c) => c.name.toLowerCase() === from.toLowerCase());
      if (col) {
        col.fk = {
          table: parent,
          column: to ?? from,
          onUpdate: String(f[5] ?? 'NO ACTION'),
          onDelete: String(f[6] ?? 'NO ACTION'),
        };
      }
    }

    schema.push({ name: table, columns });
  }

  // FK edges once all tables are known (resolve implicit "REFERENCES parent" PKs).
  for (const t of schema) {
    for (const c of t.columns) {
      if (!c.fk) continue;
      const parent = schema.find((s) => s.name.toLowerCase() === c.fk!.table.toLowerCase());
      if (!parent) continue;
      c.fk.table = parent.name;
      const parentPk = parent.columns.find((pc) => pc.pk);
      if (!parent.columns.some((pc) => pc.name.toLowerCase() === c.fk!.column.toLowerCase())) {
        c.fk.column = parentPk?.name ?? c.fk.column;
      }
      // Drawn PK -> FK: tail at the parent's PK column, arrowhead landing on
      // the dependent table's FK column.
      fkEdges.push({
        id: `${t.name}.${c.name}->${c.fk.table}.${c.fk.column}`,
        source: c.fk.table,
        sourceHandle: c.fk.column,
        target: t.name,
        targetHandle: c.name,
      });
    }
  }

  return { schema, fkEdges };
}

export interface TableData extends QueryResult {
  /** SQLite rowid per display row; the engine tracks provenance by rowid. */
  rids: number[];
}

export function getTableData(db: Exec, table: string): TableData {
  const res = queryAll(db, `SELECT rowid AS __rid, * FROM ${quoteIdent(table)} ORDER BY rowid`);
  return {
    columns: res.columns.slice(1),
    rows: res.rows.map((r) => r.slice(1)),
    rids: res.rows.map((r) => Number(r[0])),
  };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
