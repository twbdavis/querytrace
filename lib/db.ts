import type { Database, SqlJsStatic } from 'sql.js';
import type { FkEdgeDef, TableMeta } from './schemas';
import { maskSql, quoteIdent, splitSqlStatements, type SqlStatement } from './sqlText';
import { SQL_WASM_URL } from './sqlWasmAsset.generated';

export { quoteIdent, splitSqlStatements } from './sqlText';

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

/** Statements other tools emit around a schema that mean nothing to a fresh in-memory database. */
const IGNORED_STATEMENT =
  /^(?:USE\b|SET\b|CREATE\s+(?:DATABASE|SCHEMA)\b|DROP\s+(?:TABLE|DATABASE|SCHEMA)\s+IF\s+EXISTS\b|START\s+TRANSACTION\b|BEGIN\b|COMMIT\b|LOCK\s+TABLES\b|UNLOCK\s+TABLES\b|GO$)/i;

/** Table options MySQL appends after the closing parenthesis of CREATE TABLE. */
const TABLE_OPTION =
  '(?:ENGINE|(?:DEFAULT\\s+)?(?:CHARSET|CHARACTER\\s+SET|COLLATE)|AUTO_INCREMENT|COMMENT|ROW_FORMAT|CHECKSUM' +
  '|MAX_ROWS|MIN_ROWS|PACK_KEYS|DELAY_KEY_WRITE|STATS_PERSISTENT|STATS_AUTO_RECALC|KEY_BLOCK_SIZE|TABLESPACE' +
  '|COMPRESSION|ENCRYPTION|CONNECTION|DATA\\s+DIRECTORY|INDEX\\s+DIRECTORY|INSERT_METHOD|PASSWORD|TYPE)';
const TABLE_OPTIONS_TAIL = new RegExp(
  `\\)\\s*(?:${TABLE_OPTION}\\s*=?\\s*(?:'(?:''|[^'])*'|"(?:""|[^"])*"|[\\w.]+)\\s*,?\\s*)+$`,
  'i'
);

/**
 * Translate the dialect-specific parts of common DDL exports (MySQL Workbench,
 * phpMyAdmin, pgAdmin, SQL Server) into SQLite so a schema copied from a
 * course project builds without hand edits. Only syntax SQLite has no
 * equivalent for is touched; the relational content stays exactly as written.
 */
/** Apply a regex replacement to SQL text while leaving literals and comments untouched. */
function replaceOutsideLiteralsIn(text: string, pattern: RegExp, replacement: string): string {
  const masked = maskSql(text);
  let result = '';
  let last = 0;
  for (const match of masked.matchAll(pattern)) {
    const index = match.index ?? 0;
    result += text.slice(last, index) + replacement;
    last = index + match[0].length;
  }
  return result + text.slice(last);
}

function normalizeStatement(statement: SqlStatement): string {
  let { text } = statement;
  const isCreateTable = /^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\b/i.test(statement.masked);

  // Match against masked text (so literals are never touched), edit the original.
  const replaceOutsideLiterals = (pattern: RegExp, replacement: string) => {
    text = replaceOutsideLiteralsIn(text, pattern, replacement);
  };

  // A SQL Server schema prefix ("dbo.customers", "[dbo].[customers]") would
  // name an attached database in SQLite. The quoted forms are matched on the
  // original text because the mask blanks quoted names.
  replaceOutsideLiterals(/\bdbo\.(?=[\w"`[])/gi, '');
  text = text.replace(/(?:\[dbo\]|"dbo"|`dbo`)\.(?=[\w"`[])/gi, '');

  if (isCreateTable) {
    // SQLite assigns an omitted key itself only for a column typed exactly
    // INTEGER, so an auto-numbered "INT(11) NOT NULL AUTO_INCREMENT" or
    // "INT IDENTITY(1,1)" column is retyped and the identity keyword dropped.
    replaceOutsideLiterals(
      /\b(?:TINYINT|SMALLINT|MEDIUMINT|BIGINT|INTEGER|INT)\b(?:\s*\(\s*\d+\s*\))?(\s+UNSIGNED)?(?=[^,()]*?\bAUTO_INCREMENT\b)/gi,
      'INTEGER'
    );
    replaceOutsideLiterals(/\bAUTO_INCREMENT\b(?!\s*=)/gi, '');
    replaceOutsideLiterals(
      /\b(?:TINYINT|SMALLINT|BIGINT|INTEGER|INT)\b\s+IDENTITY\s*(?:\(\s*\d+\s*,\s*\d+\s*\))?/gi,
      'INTEGER'
    );
    replaceOutsideLiterals(/\bIDENTITY\s*(?:\(\s*\d+\s*,\s*\d+\s*\))?/gi, '');
    replaceOutsideLiterals(/\b(?:BIG|SMALL)?SERIAL\b/gi, 'INTEGER');
    // MySQL column attributes with no SQLite counterpart.
    replaceOutsideLiterals(/\bON\s+UPDATE\s+CURRENT_TIMESTAMP(?:\s*\(\s*\d*\s*\))?/gi, '');
    replaceOutsideLiterals(/\bCHARACTER\s+SET\s+\w+/gi, '');
    replaceOutsideLiterals(/\bCHARSET\s+\w+/gi, '');
    replaceOutsideLiterals(/\bCOLLATE\s+\w+/gi, '');
    replaceOutsideLiterals(/\bCOMMENT\s+(?:'(?:''|[^'])*'|"(?:""|[^"])*")/gi, '');
    replaceOutsideLiterals(/\bZEROFILL\b/gi, '');
    // "INT(11) UNSIGNED": SQLite allows a size only at the end of a type name.
    replaceOutsideLiterals(/\bUNSIGNED\b/gi, '');
    replaceOutsideLiterals(/\b(?:ENUM|SET)\s*\((?:\s*'(?:''|[^'])*'\s*,?)+\s*\)/gi, 'TEXT');
    // Inline secondary indexes: SQLite only accepts them as separate CREATE
    // INDEX statements, and the canvas does not draw them anyway.
    replaceOutsideLiterals(
      /,\s*(?:UNIQUE\s+(?:KEY|INDEX)|(?:FULLTEXT|SPATIAL)\s+(?:KEY|INDEX)?|KEY|INDEX)\s+(?:`[^`]*`|"[^"]*"|\w+)\s*(?:USING\s+\w+\s*)?\([^)]*\)/gi,
      ''
    );
    replaceOutsideLiterals(/\bUNIQUE\s+(?:KEY|INDEX)\s*\(/gi, 'UNIQUE (');
    replaceOutsideLiterals(/\bFOREIGN\s+KEY\s+(?:`[^`]*`|"[^"]*"|\w+)\s*\(/gi, 'FOREIGN KEY (');
    // ENGINE=InnoDB and friends after the column list.
    const tail = maskSql(text).match(TABLE_OPTIONS_TAIL);
    if (tail && tail.index !== undefined) text = `${text.slice(0, tail.index)})`;
  } else if (/^INSERT\s+IGNORE\b/i.test(statement.masked)) {
    text = text.replace(/^INSERT\s+IGNORE\b/i, 'INSERT OR IGNORE');
  }
  return text;
}

export interface PreparedStatement {
  /** SQLite-ready text of the statement. */
  sql: string;
  /** What the statement does and to which table, for error messages. */
  summary: string;
}

// Quoted names are blank inside the mask, so match the delimiters themselves.
const TABLE_NAME_PATTERN = '((?:"[^"]*"|`[^`]*`|\\[[^\\]]*\\]|[^\\s(]+))';
const CREATE_TABLE_HEAD = new RegExp(
  `^CREATE\\s+(?:TEMP(?:ORARY)?\\s+)?TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${TABLE_NAME_PATTERN}`,
  'i'
);
const INSERT_HEAD = new RegExp(`^INSERT\\s+(?:OR\\s+IGNORE\\s+)?INTO\\s+${TABLE_NAME_PATTERN}`, 'i');

/** Normalize, validate and split a custom-schema script into executable statements. */
export function prepareCustomDdl(ddl: string): PreparedStatement[] {
  if (ddl.length > MAX_CUSTOM_DDL_CHARS) {
    throw new Error(`Custom schema SQL is limited to ${MAX_CUSTOM_DDL_CHARS.toLocaleString()} characters.`);
  }
  // SQL Server scripts separate batches with a bare GO line instead of a semicolon.
  const script = replaceOutsideLiteralsIn(ddl, /^[ \t]*GO[ \t]*(?=\r?\n|$)/gim, ';');
  const statements = splitSqlStatements(script).filter(
    (statement) => !IGNORED_STATEMENT.test(statement.masked)
  );
  if (statements.length > MAX_CUSTOM_STATEMENTS) {
    throw new Error(`Custom schemas are limited to ${MAX_CUSTOM_STATEMENTS} SQL statements.`);
  }

  // Custom schemas intentionally support only the two operations exposed by the UI.
  return statements.map((statement) => {
    const normalized = normalizeStatement(statement);
    // Drop comments that precede the statement so its first keyword is at index 0.
    const sql = normalized.slice(maskSql(normalized).match(/^\s*/)![0].length);
    const masked = maskSql(sql);
    // The captured name sits at the end of the match; read it from the
    // original text since the mask blanks quoted names.
    const nameOf = (match: RegExpMatchArray) =>
      sql.slice(match[0].length - match[1].length, match[0].length);
    const create = masked.match(CREATE_TABLE_HEAD);
    const insert = masked.match(INSERT_HEAD);
    if (create) {
      if (/\bAS\s+SELECT\b/i.test(masked)) {
        throw new Error(
          `CREATE TABLE ... AS SELECT is not supported here. Declare the columns of ${nameOf(create)} explicitly.`
        );
      }
      return { sql, summary: `CREATE TABLE ${nameOf(create)}` };
    }
    if (insert) {
      if (!/\bVALUES\b/i.test(masked) || /\b(?:SELECT|WITH|PRAGMA|ATTACH)\b/i.test(masked)) {
        throw new Error(`INSERT INTO ${nameOf(insert)} must list its rows with VALUES (...).`);
      }
      return { sql, summary: `INSERT INTO ${nameOf(insert)}` };
    }
    const compact = sql.replace(/\s+/g, ' ').trim();
    const preview = compact.length > 60 ? `${compact.slice(0, 60)}…` : compact;
    throw new Error(
      `Custom schemas may contain only CREATE TABLE and INSERT INTO statements. Remove or rewrite: ${preview}`
    );
  });
}

function enforceCustomSchemaLimits(db: Database, schema: TableMeta[]): void {
  if (schema.length > MAX_CUSTOM_TABLES) {
    throw new Error(`Custom schemas are limited to ${MAX_CUSTOM_TABLES} tables.`);
  }

  let totalColumns = 0;
  let totalRows = 0;
  for (const table of schema) {
    // Tables without a declared key (import/staging tables, for example) are
    // still traceable: SQLite's rowid identifies their rows on the canvas.
    const primaryKeyColumns = table.columns.filter((column) => column.pk);
    const nullPrimaryKeyRows = primaryKeyColumns.length
      ? Number(
          queryAll(
            db,
            `SELECT COUNT(*) FROM ${quoteIdent(table.name)} WHERE ${primaryKeyColumns
              .map((column) => `${quoteIdent(column.name)} IS NULL`)
              .join(' OR ')}`
          ).rows[0]?.[0] ?? 0
        )
      : 0;
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
  const statements = validateAsCustom ? prepareCustomDdl(ddl) : null;
  const SQL = await getSqlJs();
  const db = new SQL.Database();
  try {
    // Keep accidental or hostile custom schemas from exhausting browser memory.
    db.run('PRAGMA max_page_count = 16384; PRAGMA foreign_keys = ON;');
    if (statements) {
      // One statement at a time, so an error names the statement that caused it.
      for (const statement of statements) {
        try {
          db.run(statement.sql);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`${statement.summary}: ${message}`);
        }
      }
    } else {
      db.run(ddl);
    }
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
