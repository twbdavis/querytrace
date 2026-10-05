import type { Database, SqlJsStatic } from 'sql.js';
import type { FkEdgeDef, TableMeta } from './schemas';
import {
  convertBackslashEscapes,
  convertDoubleQuotedStrings,
  convertEscapeStringLiterals,
  hasUnterminatedLiteral,
  maskSql,
  normalizePastedText,
  quoteIdent,
  replaceOutsideLiterals,
  splitSqlStatements,
  splitTopLevel,
  stripComments,
  unquoteIdent,
  type SqlStatement,
} from './sqlText';
import { registerCompatFunctions } from './compatFunctions';
import { translateCasts } from './dialect';
import { SQL_WASM_URL } from './sqlWasmAsset.generated';

export { quoteIdent, splitSqlStatements } from './sqlText';

/** A custom-schema build failure that can name the statement responsible. */
export class SchemaBuildError extends Error {
  constructor(message: string, readonly statement?: string) {
    super(message);
  }
}

let sqlJs: Promise<SqlJsStatic> | null = null;

const MAX_CUSTOM_DDL_CHARS = 300_000;
const MAX_CUSTOM_STATEMENTS = 1_500;
const MAX_CUSTOM_TABLES = 24;
const MAX_CUSTOM_COLUMNS_PER_TABLE = 40;
const MAX_CUSTOM_TOTAL_COLUMNS = 480;
const MAX_CUSTOM_ROWS_PER_TABLE = 500;
const MAX_CUSTOM_TOTAL_ROWS = 3_000;
const MAX_PERSISTED_DATABASE_BYTES = 16 * 1024 * 1024;

/** True under Node (tests and scripts), where sql.js finds its own WASM file. */
const runningInNode =
  typeof process !== 'undefined' &&
  !(process as { browser?: boolean }).browser &&
  typeof process.versions?.node === 'string';

/** Lazily initialize sql.js (the content-hashed WASM asset is served from /public). */
function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJs) {
    sqlJs = import('sql.js').then((m) =>
      m.default(runningInNode ? {} : { locateFile: () => SQL_WASM_URL })
    );
  }
  return sqlJs;
}

/* ------------------------------------------------------------------------ */
/* Custom schema scripts                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Statements other tools emit around a schema that mean nothing to a fresh
 * in-memory SQLite database: session settings, transactions, sequences,
 * permissions, and the DROP ... IF EXISTS guards of a re-runnable script.
 */
const IGNORED_STATEMENT = new RegExp(
  '^(?:' +
    [
      'USE\\b',
      'SET\\b',
      // pg_dump session settings and sequence resets: SELECT pg_catalog.set_config(...), setval(...)
      'SELECT\\s+pg_catalog\\.\\w+\\s*\\(',
      'CREATE\\s+(?:DATABASE|SCHEMA|SEQUENCE|EXTENSION|TYPE|USER|ROLE)\\b',
      'ALTER\\s+(?:DATABASE|SCHEMA|SEQUENCE|USER|ROLE)\\b',
      'DROP\\s+(?:TABLE|DATABASE|SCHEMA|INDEX|SEQUENCE|TYPE|VIEW|TRIGGER|PROCEDURE|FUNCTION)\\s+IF\\s+EXISTS\\b',
      'DROP\\s+(?:DATABASE|SCHEMA|SEQUENCE|TYPE|INDEX)\\b',
      'START\\s+TRANSACTION\\b',
      'BEGIN\\b',
      'COMMIT\\b',
      'ROLLBACK\\b',
      'SAVEPOINT\\b',
      'LOCK\\s+TABLES?\\b',
      'UNLOCK\\s+TABLES?\\b',
      'COMMENT\\s+ON\\b',
      'GRANT\\b',
      'REVOKE\\b',
      'FLUSH\\b',
      'ANALYZE\\b',
      'VACUUM\\b',
      'PRINT\\b',
      'DELIMITER\\b',
      'SELECT\\s+(?:pg_catalog\\.)?setval\\b',
      // SQL Server: ALTER TABLE t CHECK CONSTRAINT fk (enables a constraint that already exists)
      'ALTER\\s+TABLE\\b[^;]*?\\s(?:WITH\\s+)?(?:NO)?CHECK\\s+CONSTRAINT\\b',
      'ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:IF\\s+EXISTS\\s+)?\\S+\\s+(?:OWNER\\s+TO|ENGINE\\s*=|AUTO_INCREMENT\\s*=|(?:DEFAULT\\s+)?(?:CHARSET|CHARACTER\\s+SET|COLLATE)|ENABLE|DISABLE|CLUSTER|SET\\s+\\()',
      'GO$',
    ].join('|') +
    ')',
  'i'
);

const QUOTED_OR_WORD = '(?:"[^"]*"|`[^`]*`|\\[[^\\]]*\\]|\\w+)';
const TABLE_NAME = '((?:"[^"]*"|`[^`]*`|\\[[^\\]]*\\]|[^\\s(,]+))';

/** Table options MySQL, PostgreSQL and SQL Server append after the closing parenthesis of CREATE TABLE. */
const KEY_VALUE_OPTION =
  '(?:ENGINE|(?:DEFAULT\\s+)?(?:CHARSET|CHARACTER\\s+SET|COLLATE)|AUTO_INCREMENT|COMMENT|ROW_FORMAT|CHECKSUM' +
  '|MAX_ROWS|MIN_ROWS|PACK_KEYS|DELAY_KEY_WRITE|STATS_PERSISTENT|STATS_AUTO_RECALC|KEY_BLOCK_SIZE|TABLESPACE' +
  '|COMPRESSION|ENCRYPTION|CONNECTION|DATA\\s+DIRECTORY|INDEX\\s+DIRECTORY|INSERT_METHOD|PASSWORD|TYPE)';
const TABLE_OPTION_ITEM =
  `(?:${KEY_VALUE_OPTION}\\s*=?\\s*(?:'(?:''|[^'])*'|"(?:""|[^"])*"|[\\w.]+)` +
  '|WITH\\s*\\([^)]*\\)|WITHOUT\\s+OIDS|INHERITS\\s*\\([^)]*\\)|PARTITION\\s+BY\\b[^;]*' +
  `|(?:TEXTIMAGE_)?ON\\s+${QUOTED_OR_WORD})`;
const TABLE_OPTIONS_TAIL = new RegExp(`\\)\\s*(?:${TABLE_OPTION_ITEM}\\s*,?\\s*)+$`, 'i');

const INTEGER_TYPES = '(?:TINYINT|SMALLINT|MEDIUMINT|BIGINT|INTEGER|INT)';

/** Keywords after which a `schema.` prefix names a table (never a column). */
const TABLE_POSITION = new RegExp(
  '\\b(CREATE\\s+(?:TEMP(?:ORARY)?\\s+)?TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?|INSERT\\s+(?:OR\\s+\\w+\\s+|IGNORE\\s+)?INTO' +
    '|REPLACE\\s+INTO|UPDATE(?:\\s+ONLY)?|DELETE\\s+FROM(?:\\s+ONLY)?|TRUNCATE(?:\\s+TABLE)?|REFERENCES' +
    `|ALTER\\s+TABLE(?:\\s+ONLY)?(?:\\s+IF\\s+EXISTS)?)(\\s+)(${QUOTED_OR_WORD}\\.)(?=[\\w"\`[])`,
  'gi'
);

function sameTable(a: string, b: string): boolean {
  return unquoteIdent(a).toLowerCase() === unquoteIdent(b).toLowerCase();
}

/** Remove "(10)" prefix lengths from a key column list: PRIMARY KEY (name(10)) -> PRIMARY KEY (name). */
function stripPrefixLengths(text: string): string {
  return replaceOutsideLiterals(
    text,
    /\b(PRIMARY\s+KEY|UNIQUE)\s*\(((?:[^()]|\(\s*\d+\s*\))*)\)/gi,
    (original, match) => `${match[1]} (${original.slice(match[1].length, -1).replace(/^\s*\(/, '').replace(/\(\s*\d+\s*\)/g, '')})`
  );
}

/**
 * Rewrite the column definitions of a CREATE TABLE body (or of one ALTER TABLE
 * MODIFY definition) into SQLite's column grammar: auto-numbered keys become
 * plain INTEGER so SQLite assigns them, and type decorations SQLite has no
 * words for are dropped.
 */
function normalizeColumnDefinitions(input: string): string {
  let text = input;
  const sub = (pattern: RegExp, replacement: string | ((original: string, match: RegExpMatchArray) => string)) => {
    text = replaceOutsideLiterals(text, pattern, replacement);
  };
  // SQLite assigns an omitted key itself only for a column typed exactly
  // INTEGER, so an auto-numbered "INT(11) NOT NULL AUTO_INCREMENT",
  // "INT IDENTITY(1,1)" or "integer GENERATED ALWAYS AS IDENTITY" column is
  // retyped and the identity keyword dropped.
  sub(
    new RegExp(
      `\\b${INTEGER_TYPES}\\b(?:\\s*\\(\\s*\\d+\\s*\\))?(\\s+UNSIGNED)?(?=[^,()]*?\\b(?:AUTO_INCREMENT|IDENTITY)\\b)`,
      'gi'
    ),
    'INTEGER'
  );
  sub(/\bAUTO_INCREMENT\b(?!\s*=)/gi, '');
  // SQL Server column-level "FOREIGN KEY REFERENCES parent(id)": SQLite spells the column form without FOREIGN KEY.
  sub(/\bFOREIGN\s+KEY\s+(?=REFERENCES\b)/gi, '');
  // MySQL Workbench 8 appends VISIBLE / INVISIBLE to every index.
  sub(/\)\s*(?:IN)?VISIBLE\b/gi, ')');
  // SQL Server scripts bracket type names ([int], [nvarchar](50)); the mask
  // treats brackets as quoting, so unwrap the known type names first.
  text = text.replace(
    /\[(u?(?:tiny|small|big)?int|integer|bit|(?:small)?money|decimal|numeric|float|real|date|datetime2?|smalldatetime|datetimeoffset|time|timestamp|n?char|n?varchar|n?text|binary|varbinary|image|uniqueidentifier|xml|sql_variant|hierarchyid|geography|geometry|rowversion)\](?=\s*[(\s,)])/gi,
    '$1'
  );
  // PostgreSQL 10+ / Oracle 12c identity columns: "GENERATED {ALWAYS | BY DEFAULT} AS IDENTITY [(options)]".
  sub(
    new RegExp(`\\b${INTEGER_TYPES}\\b\\s+(?:NOT\\s+NULL\\s+)?GENERATED\\s+(?:ALWAYS|BY\\s+DEFAULT)(?:\\s+ON\\s+NULL)?\\s+AS\\s+IDENTITY\\b(?:\\s*\\([^)]*\\))?`, 'gi'),
    (original) => (/\bNOT\s+NULL\b/i.test(original) ? 'INTEGER NOT NULL' : 'INTEGER')
  );
  sub(/\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT)(?:\s+ON\s+NULL)?\s+AS\s+IDENTITY\b(?:\s*\([^)]*\))?/gi, '');
  sub(new RegExp(`\\b${INTEGER_TYPES}\\b\\s+IDENTITY\\s*(?:\\(\\s*\\d+\\s*,\\s*\\d+\\s*\\))?`, 'gi'), 'INTEGER');
  sub(/\bIDENTITY\s*(?:\(\s*\d+\s*,\s*\d+\s*\))?/gi, '');
  sub(/\b(?:BIG|SMALL)?SERIAL\b/gi, 'INTEGER');
  // A DECIMAL(8,2) column must divide like a decimal (24.00 / 7 = 3.43). SQLite's
  // NUMERIC affinity would store 24.00 as the integer 24 and divide to 3, so
  // the type gets a REAL marker (the canvas shows the declared type without it).
  sub(/(?<!\bREAL\s)\b(?:DECIMAL|DEC|NUMERIC|NUMBER)\s*\(\s*\d+\s*,\s*[1-9]\d*\s*\)/gi, (original) => `REAL ${original}`);
  sub(/(?<!\bREAL\s)\b(?:NUMBER|(?:SMALL)?MONEY)\b(?!\s*\()/gi, (original) => `REAL ${original}`);
  // pg_dump: "id integer NOT NULL DEFAULT nextval('t_id_seq')" plus a later
  // ALTER TABLE ... ADD PRIMARY KEY; without the DEFAULT the folded INTEGER
  // PRIMARY KEY auto-assigns exactly like the sequence did.
  sub(/\bDEFAULT\s+nextval\s*\([^)]*\)/gi, '');
  // Generated keys: SQLite can produce a random UUID itself.
  sub(
    /\bDEFAULT\s+(?:\(\s*)?(?:gen_random_uuid|uuid_generate_v4|uuid|newid|newsequentialid|sys_guid)\s*\(\s*\)(?:\s*\))?/gi,
    "DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))))"
  );
  // Any other function-call default needs SQLite's parentheses: DEFAULT (expr).
  sub(/\bDEFAULT\s+(?!\()([A-Za-z_]\w*\s*\((?:[^()]|\([^()]*\))*\))/gi, (original, match) => `${original.slice(0, original.length - match[1].length)}(${match[1]})`);
  // Type spellings SQLite's "TYPE(n)" grammar rejects.
  sub(/\(\s*MAX\s*\)/gi, ''); // NVARCHAR(MAX)
  // PostgreSQL "timestamp(3) with time zone": SQLite wants the size last, and keeps no zone.
  sub(/\b(TIMESTAMP|TIME)(?:\s*\(\s*\d+\s*\))?\s+WITH(?:OUT)?\s+TIME\s+ZONE\b/gi, (_, match) => match[1]);
  sub(/\(\s*(\d+)\s+(?:CHAR|BYTE)\s*\)/gi, (_, match) => `(${match[1]})`); // VARCHAR2(50 CHAR)
  // text[] (the mask blanks bracketed names too, so confirm the brackets are really empty)
  sub(/(?<=\w)\s*\[\s*\]/g, (original) => (/^\s*\[\s*\]$/.test(original) ? '' : original));
  // MySQL column attributes with no SQLite counterpart.
  sub(/\bON\s+UPDATE\s+CURRENT_TIMESTAMP(?:\s*\(\s*\d*\s*\))?/gi, '');
  sub(/\bCHARACTER\s+SET\s+\w+/gi, '');
  sub(/\bCHARSET\s+\w+/gi, '');
  // COLLATE is SQLite syntax too (NOCASE etc.); only foreign collation names go.
  sub(/\bCOLLATE\s+(?!(?:BINARY|NOCASE|RTRIM)\b)(?:"[^"]*"|`[^`]*`|\w+)/gi, '');
  sub(/\bCOMMENT\s+(?:'(?:''|[^'])*'|"(?:""|[^"])*")/gi, '');
  sub(/\bZEROFILL\b/gi, '');
  // "INT(11) UNSIGNED": SQLite allows a size only at the end of a type name.
  sub(/\bUNSIGNED\b/gi, '');
  sub(/\b(?:ENUM|SET)\s*\((?:\s*'(?:''|[^'])*'\s*,?)+\s*\)/gi, 'TEXT');
  // SQL Server and Oracle constraint decorations.
  sub(/\b(?:NON)?CLUSTERED\b/gi, '');
  sub(/\bWITH\s*\([^)]*\)/gi, '');
  sub(/\b(?:TEXTIMAGE_)?ON\s+(?:\[\s*\]|PRIMARY\b)/gi, '');
  sub(/\b(?:ENABLE|DISABLE)(?:\s+(?:NO)?VALIDATE)?\b/gi, '');
  sub(/\bUSING\s+(?:BTREE|HASH)\b/gi, '');
  return text;
}

/**
 * Translate the dialect-specific parts of common exports (MySQL Workbench,
 * phpMyAdmin, pgAdmin / pg_dump, SQL Server Management Studio, Oracle) into
 * SQLite so a schema copied from a course project builds without hand edits.
 * Only syntax SQLite has no equivalent for is touched; the relational content
 * stays exactly as written.
 */
function normalizeStatement(statement: SqlStatement): string {
  let text = statement.text;
  const sub = (pattern: RegExp, replacement: string | ((original: string, match: RegExpMatchArray) => string)) => {
    text = replaceOutsideLiterals(text, pattern, replacement);
  };
  const head = (pattern: RegExp) => pattern.test(maskSql(text));

  // --- Every statement -----------------------------------------------------
  // SQL Server scripts omit INTO: INSERT [dbo].[t] (...) VALUES (...).
  text = text.replace(/^INSERT\s+(?!INTO\b|OR\s|IGNORE\b|LOW_PRIORITY\b|DELAYED\b|HIGH_PRIORITY\b)/i, 'INSERT INTO ');
  // Schema prefixes ("hr.employees", "[dbo].[course]", "public.staff") would
  // name an attached database in SQLite. Strip them where a table name is
  // expected; column references such as t.col are left alone.
  sub(TABLE_POSITION, (original, match) => original.slice(0, match[1].length + match[2].length));
  // PostgreSQL casts ('2024-01-01'::date, nextval('seq'::regclass), 'x'::timestamp without time zone).
  sub(
    /::\s*(?:character\s+varying|double\s+precision|bit\s+varying|(?:timestamp|time)(?:\s+with(?:out)?\s+time\s+zone)?|\w+)(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(?:\s*\[\s*\])*/gi,
    ''
  );
  // National string prefix: N'text'. (E'text' was unescaped earlier.)
  sub(/(?<![\w"`\]])N(?=')/g, '');
  // Typed literals: DATE '2024-01-01', TIMESTAMP '...'.
  sub(/\b(?:DATE|TIME|TIMESTAMP)\s+(?=')/gi, '');
  // MySQL bit literals: b'1'.
  sub(/\bb' *'/gi, (original) => String(parseInt(original.slice(2, -1), 2) || 0));
  // Current date/time in other dialects.
  sub(
    /\b(?:NOW|GETDATE|SYSDATETIME|CURRENT_TIMESTAMP|LOCALTIMESTAMP)\s*\(\s*\d*\s*\)|\bSYSDATE\b|\bLOCALTIMESTAMP\b/gi,
    'CURRENT_TIMESTAMP'
  );
  sub(/\bCURDATE\s*\(\s*\)|\bCURRENT_DATE\s*\(\s*\)/gi, 'CURRENT_DATE');
  sub(/\bCURTIME\s*\(\s*\)|\bCURRENT_TIME\s*\(\s*\)/gi, 'CURRENT_TIME');
  // Oracle TO_DATE of an ISO literal is just that literal.
  text = text.replace(
    /\bTO_DATE\s*\(\s*('\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2})?)?')\s*,\s*'[^']*'\s*\)/gi,
    '$1'
  );

  // --- CREATE TABLE ----------------------------------------------------------
  if (head(/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\b/i)) {
    // Temporary tables live outside the schema the canvas reads; make them ordinary.
    sub(/^CREATE\s+TEMP(?:ORARY)?\s+TABLE\b/i, 'CREATE TABLE');
    text = normalizeColumnDefinitions(text);
    // Inline secondary indexes: SQLite only accepts them as separate CREATE
    // INDEX statements, and the canvas does not draw them anyway. A column
    // that happens to be called "key" keeps its "key INT(11)" definition: the
    // parenthesis after an index name holds column names, not a size.
    sub(
      new RegExp(
        `,\\s*(?:(?:FULLTEXT|SPATIAL)\\s+(?:KEY|INDEX)?|KEY|INDEX)\\s+${QUOTED_OR_WORD}\\s*(?:USING\\s+\\w+\\s*)?\\((?![\\s\\d,]*\\))(?:[^()]|\\([^()]*\\))*\\)(?:\\s*COMMENT\\s+'[^']*')?`,
        'gi'
      ),
      ''
    );
    // UNIQUE KEY name (cols) carries meaning: keep it as a UNIQUE constraint.
    sub(new RegExp(`\\bUNIQUE\\s+(?:KEY|INDEX)\\s+(?:${QUOTED_OR_WORD}\\s*)?(?:USING\\s+\\w+\\s*)?\\(`, 'gi'), 'UNIQUE (');
    sub(new RegExp(`\\bFOREIGN\\s+KEY\\s+${QUOTED_OR_WORD}\\s*\\(`, 'gi'), 'FOREIGN KEY (');
    text = stripPrefixLengths(text);
    // ENGINE=InnoDB and friends after the column list.
    const tail = maskSql(text).match(TABLE_OPTIONS_TAIL);
    if (tail && tail.index !== undefined) text = `${text.slice(0, tail.index)})`;
    return text;
  }

  // PostgreSQL timestamptz literals end in a zone offset ('2025-07-01 10:00:00+00');
  // SQLite's date functions read "+HH:MM" only, so a bare "+HH" gets its minutes and a zero offset goes.
  if (head(/^(?:INSERT|REPLACE|UPDATE)\b/i)) {
    text = text.replace(/('\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(?:Z|[+-]00(?::?00)?)'/g, "$1'");
    text = text.replace(/('\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?[+-]\d{2})'/g, "$1:00'");
  }
  // CAST(N'2024-01-01' AS Date) and CONVERT(...) in row data.
  if (head(/^(?:INSERT|REPLACE|UPDATE)\b/i) && /\b(?:CAST|CONVERT)\s*\(/i.test(maskSql(text))) {
    try {
      text = translateCasts(text);
    } catch {
      // An unknown type is left for SQLite to report against the statement.
    }
  }

  // --- INSERT ----------------------------------------------------------------
  if (head(/^(?:INSERT|REPLACE)\b/i)) {
    text = text.replace(/^REPLACE\s+INTO\b/i, 'INSERT OR REPLACE INTO');
    text = text.replace(/^INSERT\s+(?:LOW_PRIORITY|DELAYED|HIGH_PRIORITY)\s+/i, 'INSERT ');
    text = text.replace(/^INSERT\s+IGNORE\s+INTO\b/i, 'INSERT OR IGNORE INTO');
    text = text.replace(/^INSERT\s+INTO\s+TABLE\b/i, 'INSERT INTO');
    // MySQL accepts the singular VALUE.
    sub(/\bVALUE\s*(?=\()/gi, 'VALUES ');
    // MySQL "INSERT INTO t () VALUES ()".
    sub(
      new RegExp(`^(INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${TABLE_NAME})\\s*\\(\\s*\\)\\s*VALUES\\s*\\(\\s*\\)\\s*$`, 'i'),
      (original, match) => `${original.slice(0, match[1].length)} DEFAULT VALUES`
    );
    // MySQL "INSERT INTO t SET a = 1, b = 'x'" -> column list plus VALUES.
    const setForm = maskSql(text).match(
      new RegExp(`^(INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${TABLE_NAME}\\s+)SET\\s+`, 'i')
    );
    if (setForm) {
      const assignments = splitTopLevel(text.slice(setForm[0].length)).map((assignment) => {
        const eq = maskSql(assignment).indexOf('=');
        return eq === -1
          ? null
          : { column: assignment.slice(0, eq).trim(), value: assignment.slice(eq + 1).trim() };
      });
      if (assignments.every((assignment) => assignment !== null)) {
        const columns = assignments.map((assignment) => assignment!.column).join(', ');
        const values = assignments.map((assignment) => assignment!.value).join(', ');
        text = `${text.slice(0, setForm[1].length).replace(/\s+$/, '')} (${columns}) VALUES (${values})`;
      }
    }
    // MySQL upsert -> SQLite upsert; VALUES(col) becomes excluded.col.
    const upsert = maskSql(text).match(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i);
    if (upsert && upsert.index !== undefined) {
      const before = text.slice(0, upsert.index);
      const after = text
        .slice(upsert.index + upsert[0].length)
        .replace(/\bVALUES\s*\(\s*(`[^`]*`|"[^"]*"|\w+)\s*\)/gi, 'excluded.$1');
      text = `${before}ON CONFLICT DO UPDATE SET${after}`;
    }
    return text;
  }

  // --- CREATE INDEX ------------------------------------------------------------
  if (head(/^CREATE\s+(?:UNIQUE\s+)?(?:(?:NON)?CLUSTERED\s+)?INDEX\b/i)) {
    // SQL Server: CREATE NONCLUSTERED INDEX ... ON [PRIMARY]; the storage words mean nothing here.
    sub(/\b(?:NON)?CLUSTERED\b/gi, '');
    sub(/\b(?:TEXTIMAGE_)?ON\s+(?:\[\s*\]|PRIMARY\b)\s*$/i, '');
    sub(/\bCONCURRENTLY\b/gi, '');
    sub(new RegExp(`\\bON(\\s+)(${QUOTED_OR_WORD}\\.)(?=[\\w"\`[])`, 'i'), (original, match) => original.slice(0, 2 + match[1].length));
    sub(/\bUSING\s+\w+/gi, '');
    sub(/\b(?:INCLUDE|WITH)\s*\([^)]*\)/gi, '');
    sub(/\bTABLESPACE\s+\w+/gi, '');
    return text;
  }

  // --- UPDATE / DELETE / TRUNCATE / ALTER -------------------------------------
  text = text.replace(/^TRUNCATE\s+(?:TABLE\s+)?/i, 'DELETE FROM ');
  text = text.replace(/^DELETE\s+FROM\s+ONLY\b/i, 'DELETE FROM');
  text = text.replace(/^UPDATE\s+ONLY\b/i, 'UPDATE');
  text = text.replace(/^ALTER\s+TABLE\s+ONLY\b/i, 'ALTER TABLE');
  return text;
}

export interface PreparedStatement {
  /** SQLite-ready text of the statement. */
  sql: string;
  /** What the statement does and to which table, for error messages. */
  summary: string;
  /** The statement as the author wrote it, so an error can point at it. */
  source: string;
}

interface Classified extends PreparedStatement {
  kind: 'create' | 'insert' | 'update' | 'delete' | 'index' | 'alter';
  table: string;
}

const CREATE_TABLE_HEAD = new RegExp(`^CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${TABLE_NAME}`, 'i');
const INSERT_HEAD = new RegExp(`^INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${TABLE_NAME}`, 'i');
const UPDATE_HEAD = new RegExp(`^UPDATE\\s+(?:OR\\s+\\w+\\s+)?${TABLE_NAME}`, 'i');
const DELETE_HEAD = new RegExp(`^DELETE\\s+FROM\\s+${TABLE_NAME}`, 'i');
const INDEX_HEAD = new RegExp(
  `^CREATE\\s+(?:UNIQUE\\s+)?(?:(?:NON)?CLUSTERED\\s+)?INDEX(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+(?:${TABLE_NAME}\\s+)?ON\\s+${TABLE_NAME}`,
  'i'
);
const ALTER_HEAD = new RegExp(`^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${TABLE_NAME}\\s+`, 'i');

/**
 * Read the table name a head pattern captured from the original text (the
 * mask blanks quoted names). Every head pattern ends with the name, followed
 * at most by whitespace, so it sits at the end of the match.
 */
function captured(sql: string, match: RegExpMatchArray, group: number): string {
  const trailing = match[0].length - match[0].trimEnd().length;
  const end = (match.index ?? 0) + match[0].length - trailing;
  return sql.slice(end - match[group].length, end);
}

function classify(sql: string, source: string): Classified {
  const masked = maskSql(sql);
  const compact = sql.replace(/\s+/g, ' ').trim();
  const preview = compact.length > 60 ? `${compact.slice(0, 60)}…` : compact;
  const reject = (message: string): never => {
    throw new SchemaBuildError(message, source);
  };
  if (/\b(?:ATTACH|DETACH|PRAGMA)\b/i.test(masked)) {
    reject(`Custom schemas cannot use ATTACH, DETACH or PRAGMA. Remove: ${preview}`);
  }
  if (/\bRECURSIVE\b/i.test(masked)) {
    reject(`Recursive queries are not allowed in a schema script. Remove: ${preview}`);
  }

  let match = masked.match(CREATE_TABLE_HEAD);
  if (match) {
    const table = captured(sql, match, 1);
    if (/\bAS\s+SELECT\b/i.test(masked)) {
      reject(`CREATE TABLE ... AS SELECT is not supported here. Declare the columns of ${table} explicitly.`);
    }
    if (/\bLIKE\b/i.test(masked) && !/\(/.test(masked)) {
      reject(`CREATE TABLE ... LIKE is not supported here. Declare the columns of ${table} explicitly.`);
    }
    return { sql, source, summary: `CREATE TABLE ${table}`, kind: 'create', table };
  }
  if ((match = masked.match(INSERT_HEAD))) {
    const table = captured(sql, match, 1);
    const values = masked.search(/\bVALUES\b/i);
    if (values !== -1 && /\bDEFAULT\b/i.test(masked.slice(values))) {
      reject(
        `INSERT INTO ${table}: SQLite has no DEFAULT keyword inside VALUES. Leave that column out of the column list and it receives its default.`
      );
    }
    return { sql, source, summary: `INSERT INTO ${table}`, kind: 'insert', table };
  }
  if ((match = masked.match(UPDATE_HEAD))) {
    const table = captured(sql, match, 1);
    return { sql, source, summary: `UPDATE ${table}`, kind: 'update', table };
  }
  if ((match = masked.match(DELETE_HEAD))) {
    const table = captured(sql, match, 1);
    return { sql, source, summary: `DELETE FROM ${table}`, kind: 'delete', table };
  }
  if ((match = masked.match(INDEX_HEAD))) {
    const table = captured(sql, match, 2);
    return { sql, source, summary: `CREATE INDEX ON ${table}`, kind: 'index', table };
  }
  if ((match = masked.match(ALTER_HEAD))) {
    const table = captured(sql, match, 1);
    return { sql, source, summary: `ALTER TABLE ${table}`, kind: 'alter', table };
  }

  if (/^SELECT\b/i.test(masked)) {
    reject(`Run SELECT queries from the query editor; the schema script only sets up data. Remove: ${preview}`);
  }
  if (/^COPY\b/i.test(masked)) {
    reject(`COPY ... FROM stdin (PostgreSQL) cannot be imported. Export the rows as INSERT statements instead: ${preview}`);
  }
  if (/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:VIEW|TRIGGER|PROCEDURE|FUNCTION|MATERIALIZED)\b/i.test(masked)) {
    reject(`Views, triggers, procedures and functions are not part of a QueryTrace schema. Remove: ${preview}`);
  }
  if (/^(?:DROP|RENAME)\b/i.test(masked)) {
    reject(`A schema script builds a fresh database, so ${preview} has nothing to act on. Remove it.`);
  }
  return reject(
    `Custom schemas may contain only CREATE TABLE, INSERT, UPDATE, DELETE, CREATE INDEX and ALTER TABLE statements. Remove or rewrite: ${preview}`
  );
}

/**
 * Fold "ALTER TABLE t ADD CONSTRAINT ..." into the CREATE TABLE it belongs to.
 * SQLite cannot add constraints after the fact, but pg_dump and MySQL
 * Workbench always create tables first and add keys afterwards, so rewriting
 * the earlier statement before anything runs is exactly equivalent.
 */
function foldAlterStatements(statements: Classified[]): Classified[] {
  const out: Classified[] = [];
  for (const statement of statements) {
    if (statement.kind !== 'alter') {
      out.push(statement);
      continue;
    }
    const head = maskSql(statement.sql).match(ALTER_HEAD)!;
    const body = statement.sql.slice(head[0].length);
    const create = out.find((s) => s.kind === 'create' && sameTable(s.table, statement.table));
    for (const rawAction of splitTopLevel(body)) {
      // SQL Server: ALTER TABLE t WITH CHECK ADD CONSTRAINT ...
      const action = rawAction.replace(/^WITH\s+(?:NO)?CHECK\s+/i, '');
      const masked = maskSql(action);
      // SQL Server scripts a column default as its own constraint.
      const defaultFor = masked.match(new RegExp(`^ADD\\s+(?:CONSTRAINT\\s+${QUOTED_OR_WORD}\\s+)?DEFAULT\\s+`, 'i'));
      if (defaultFor) {
        const rest = action.slice(defaultFor[0].length);
        const forAt = maskSql(rest).search(/\s+FOR\s+/i);
        if (create && forAt !== -1) {
          const value = rest.slice(0, forAt).trim();
          const column = unquoteIdent(rest.slice(forAt).replace(/^\s+FOR\s+/i, '').trim());
          create.sql = addColumnDefault(create.sql, column, value);
        }
        continue;
      }
      const constraint = masked.match(
        new RegExp(`^ADD\\s+(?:CONSTRAINT\\s+${QUOTED_OR_WORD}\\s+)?(FOREIGN\\s+KEY|PRIMARY\\s+KEY|UNIQUE(?:\\s+(?:KEY|INDEX))?|CHECK)\\b`, 'i')
      );
      if (constraint) {
        if (!create) {
          throw new SchemaBuildError(
            `${statement.summary} adds a constraint, but ${statement.table} is not created in this script.`,
            statement.source
          );
        }
        let clause = action.replace(/^ADD\s+/i, '');
        clause = replaceOutsideLiterals(clause, new RegExp(`\\bUNIQUE\\s+(?:KEY|INDEX)\\s+(?:${QUOTED_OR_WORD}\\s*)?\\(`, 'gi'), 'UNIQUE (');
        clause = replaceOutsideLiterals(clause, new RegExp(`\\bFOREIGN\\s+KEY\\s+${QUOTED_OR_WORD}\\s*\\(`, 'gi'), 'FOREIGN KEY (');
        clause = replaceOutsideLiterals(clause, /\bUSING\s+INDEX\s+TABLESPACE\s+\w+|\bUSING\s+(?:BTREE|HASH)\b|\b(?:NON)?CLUSTERED\b|\bWITH\s*\([^)]*\)|\bNOT\s+VALID\b|\b(?:ENABLE|DISABLE)(?:\s+(?:NO)?VALIDATE)?\b/gi, '');
        clause = stripPrefixLengths(clause);
        const closing = create.sql.lastIndexOf(')');
        create.sql = `${create.sql.slice(0, closing).replace(/\s+$/, '')},\n  ${clause.trim()}\n)`;
        continue;
      }
      if (/^ADD\s+(?:(?:UNIQUE|FULLTEXT|SPATIAL)\s+)?(?:INDEX|KEY)\b/i.test(masked)) continue; // no canvas meaning
      if (/^DROP\s+(?:FOREIGN\s+KEY|PRIMARY\s+KEY|INDEX|KEY|CONSTRAINT|CHECK)\b/i.test(masked)) continue;
      if (/^(?:ENGINE|AUTO_INCREMENT|(?:DEFAULT\s+)?(?:CHARSET|CHARACTER\s+SET|COLLATE)|COMMENT|ROW_FORMAT|OWNER\s+TO|ENABLE|DISABLE|CLUSTER|SET\s+\(|RESET\s+\()/i.test(masked)) {
        continue;
      }
      // PostgreSQL column tweaks after CREATE: a serial's nextval() default is
      // what INTEGER PRIMARY KEY already does; other defaults fold into the column.
      const alterColumn = masked.match(new RegExp(`^ALTER\\s+COLUMN\\s+(${QUOTED_OR_WORD})\\s+`, 'i'));
      if (alterColumn) {
        const column = unquoteIdent(action.slice(alterColumn[0].length - alterColumn[1].length - alterColumn[0].match(/\s+$/)![0].length, alterColumn[0].length).trim());
        const rest = action.slice(alterColumn[0].length);
        const setDefault = maskSql(rest).match(/^SET\s+DEFAULT\s+/i);
        if (setDefault && create) {
          const value = rest.slice(setDefault[0].length).trim();
          if (!/\bnextval\s*\(/i.test(value)) create.sql = addColumnDefault(create.sql, column, value);
          continue;
        }
        if (/^(?:DROP\s+DEFAULT|SET\s+NOT\s+NULL|DROP\s+NOT\s+NULL|SET\s+STATISTICS|SET\s+STORAGE|SET\s+\(|RESET\s+\(|ADD\s+GENERATED|DROP\s+IDENTITY)\b/i.test(maskSql(rest))) continue;
      }
      // phpMyAdmin exports a column's final definition afterwards:
      // "ALTER TABLE t MODIFY id int(11) NOT NULL AUTO_INCREMENT". Replace the
      // column's definition in CREATE TABLE before anything runs; CHANGE does
      // the same when it keeps the name.
      const modify = masked.match(new RegExp(`^(?:MODIFY|CHANGE)\\s+(?:COLUMN\\s+)?(${QUOTED_OR_WORD})\\s+`, 'i'));
      if (modify && create) {
        const column = unquoteIdent(action.slice(modify[0].length - modify[1].length - modify[0].match(/\s+$/)![0].length, modify[0].length).trim());
        let definition = action.slice(modify[0].length).trim();
        if (/^CHANGE\b/i.test(masked)) {
          const renamed = maskSql(definition).match(new RegExp(`^(${QUOTED_OR_WORD})\\s+`, 'i'));
          if (!renamed || unquoteIdent(definition.slice(0, renamed[1].length)) !== column) {
            throw new SchemaBuildError(
              `${statement.summary}: SQLite cannot rename and redefine a column afterwards. Put the final definition in CREATE TABLE ${statement.table} instead.`,
              statement.source
            );
          }
          definition = definition.slice(renamed[0].length).trim();
        }
        definition = normalizeColumnDefinitions(definition).replace(/\s+(?:FIRST|AFTER\s+\S+)\s*$/i, '').trim();
        const replaced = replaceColumnDefinition(create.sql, column, definition);
        if (replaced === null) {
          throw new SchemaBuildError(`${statement.summary}: CREATE TABLE ${statement.table} has no column ${column}.`, statement.source);
        }
        create.sql = replaced;
        continue;
      }
      if (/^(?:MODIFY|CHANGE|ALTER\s+COLUMN)\b/i.test(masked)) {
        throw new SchemaBuildError(
          `${statement.summary}: SQLite cannot change a column's definition afterwards. Put the final definition in CREATE TABLE ${statement.table} instead.`,
          statement.source
        );
      }
      // ADD COLUMN, DROP COLUMN, RENAME: SQLite runs these natively, one action per statement.
      const single = action.replace(/^ADD\s+(?!COLUMN\b)/i, 'ADD COLUMN ');
      out.push({ ...statement, sql: `${head[0]}${single}` });
    }
  }
  return out;
}

/** Swap a CREATE TABLE column's definition (its own line) for a new one; null when the column is not found. */
function replaceColumnDefinition(createSql: string, column: string, definition: string): string | null {
  const name = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^([ \\t]*)(?:"${name}"|\`${name}\`|\\[${name}\\]|${name})\\s+[^,\\n]*?(,?)[ \\t]*$`, 'im');
  if (!pattern.test(createSql)) return null;
  return createSql.replace(pattern, (_, indent: string, comma: string) => `${indent}${quoteIdent(column)} ${definition}${comma}`);
}

/** Give a CREATE TABLE column a DEFAULT when its definition has none. */
function addColumnDefault(createSql: string, column: string, value: string): string {
  const name = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^([ \\t]*(?:"${name}"|\`${name}\`|\\[${name}\\]|${name})\\s+[^,\\n]*?)(,?)[ \\t]*$`, 'im');
  return createSql.replace(pattern, (line, definition: string, comma: string) =>
    /\bDEFAULT\b/i.test(definition) ? line : `${definition} DEFAULT ${value}${comma}`
  );
}

/**
 * pg_dump writes table rows as COPY ... FROM stdin blocks: tab-separated
 * lines ending with a line holding "\.". Turn each block into an INSERT so
 * the rest of the pipeline sees ordinary SQL. Values are quoted as text;
 * SQLite's column affinity converts numbers on the way in.
 */
function convertCopyBlocks(script: string): string {
  const copyBlock = /^[ \t]*COPY\s+([^\s(]+)\s*(\([^)]*\))?\s+FROM\s+stdin\b[^;\n]*;[ \t]*\r?\n([\s\S]*?)^\\\.[ \t]*$/gim;
  const unescape = (field: string) =>
    field.replace(/\\(.)/g, (_, ch: string) => ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v' } as Record<string, string>)[ch] ?? ch);
  const value = (field: string) => (field === '\\N' ? 'NULL' : `'${unescape(field).replace(/'/g, "''")}'`);
  return script.replace(copyBlock, (_, table: string, columns: string | undefined, body: string) => {
    const rows = body.split(/\r?\n/).filter((line) => line.length > 0);
    if (rows.length === 0) return '';
    const tuples = rows.map((line) => `(${line.split('\t').map(value).join(', ')})`);
    return `INSERT INTO ${table} ${columns ?? ''} VALUES\n${tuples.join(',\n')};`;
  });
}

/** Does the script read like MySQL, where "text" is a string and \' escapes a quote? */
function looksLikeMySql(script: string): boolean {
  if (/`/.test(script) || /\bENGINE\s*=/i.test(script) || /^\s*#/m.test(script)) return true;
  // \' escapes a quote in MySQL; PostgreSQL uses it only inside E'...' literals.
  return /\\'/.test(script) && !/(?<![\w"`\]])E'/.test(script);
}

/** Normalize, validate and split a custom-schema script into executable statements. */
export function prepareCustomDdl(ddl: string): PreparedStatement[] {
  if (ddl.length > MAX_CUSTOM_DDL_CHARS) {
    throw new Error(`Custom schema SQL is limited to ${MAX_CUSTOM_DDL_CHARS.toLocaleString()} characters.`);
  }
  let script = convertCopyBlocks(normalizePastedText(ddl));
  if (looksLikeMySql(script)) {
    // MySQL dumps escape quotes as \' ; adopt that reading when it parses cleanly.
    if (/\\/.test(script) && !hasUnterminatedLiteral(script, { backslashEscapes: true })) {
      script = convertBackslashEscapes(script);
    }
    script = convertDoubleQuotedStrings(script);
  } else {
    script = convertEscapeStringLiterals(script);
  }
  // Comments go first so '#' (MySQL) never reaches SQLite and ';' inside them is inert.
  script = stripComments(script);
  // SQL Server separates batches with a bare GO line; psql meta-commands start with a backslash.
  script = replaceOutsideLiterals(script, /^[ \t]*GO[ \t]*(?=\r?\n|$)/gim, ';');
  // T-SQL also runs several statements per batch with no semicolons between
  // them, so a statement head at the start of a line closes the one before it.
  script = replaceOutsideLiterals(
    script,
    /^[ \t]*(?=(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE\s+TABLE|ALTER\s+TABLE|SET\s+IDENTITY_INSERT)\b)/gim,
    ';'
  );
  script = replaceOutsideLiterals(script, /^[ \t]*\\\w.*$/gm, '');
  // T-SQL leaves transaction and session lines unterminated; keep them from
  // swallowing the statement on the next line.
  script = replaceOutsideLiterals(
    script,
    /^[ \t]*(?:BEGIN|COMMIT|ROLLBACK)(?:[ \t]+TRAN(?:SACTION)?)?(?:[ \t]+\w+)?[ \t]*;?[ \t]*(?=\r?\n|$)/gim,
    ';'
  );
  script = replaceOutsideLiterals(
    script,
    /^[ \t]*SET[ \t]+\w+(?:[ \t]+[^\s;]+)?[ \t]+(?:ON|OFF)[ \t]*;?[ \t]*(?=\r?\n|$)/gim,
    ';'
  );

  const statements = splitSqlStatements(script).filter(
    (statement) => !IGNORED_STATEMENT.test(statement.masked)
  );
  if (statements.length > MAX_CUSTOM_STATEMENTS) {
    throw new Error(`Custom schemas are limited to ${MAX_CUSTOM_STATEMENTS.toLocaleString()} SQL statements.`);
  }

  const classified = statements.map((statement) => {
    const normalized = normalizeStatement(statement);
    // Drop leading whitespace so the first keyword is at index 0.
    return classify(normalized.slice(maskSql(normalized).match(/^\s*/)![0].length), statement.text);
  });
  return foldAlterStatements(classified).map(({ sql, summary, source }) => ({ sql, summary, source }));
}

/* ------------------------------------------------------------------------ */
/* Building and restoring databases                                          */
/* ------------------------------------------------------------------------ */

/** Apply every size and integrity limit to a custom database; throws on the first violation. */
export function enforceCustomSchemaLimits(db: Exec, schema: TableMeta[]): void {
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

/** Run prepared statements one at a time, so an error names the statement that caused it. */
function runStatements(db: Database, statements: PreparedStatement[]): void {
  for (const statement of statements) {
    try {
      db.run(statement.sql);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SchemaBuildError(`${statement.summary}: ${message}`, statement.source);
    }
  }
}

/** Explain the first row that violates a foreign key, naming the columns and values involved. */
function describeForeignKeyViolation(db: Database): string | null {
  // PRAGMA foreign_key_check: table, rowid, parent, fkid
  const violation = queryAll(db, 'PRAGMA foreign_key_check').rows[0];
  if (!violation) return null;
  const [table, rowid, parent, fkid] = violation.map((value) => String(value));
  const fk = queryAll(db, `PRAGMA foreign_key_list(${quoteIdent(table)})`).rows.filter(
    (row) => String(row[0]) === fkid
  );
  if (!fk.length) return `FOREIGN KEY constraint failed: a row in ${table} refers to a missing ${parent} row.`;
  const fromColumns = fk.map((row) => String(row[3]));
  const toColumns = fk.map((row) => (row[4] === null ? 'its primary key' : String(row[4])));
  const values = queryAll(
    db,
    `SELECT ${fromColumns.map(quoteIdent).join(', ')} FROM ${quoteIdent(table)} WHERE _rowid_ = ${Number(rowid)}`
  ).rows[0];
  const pairs = fromColumns.map((column, i) => `${column} = ${values?.[i] === null ? 'NULL' : JSON.stringify(values?.[i])}`);
  return `FOREIGN KEY constraint failed: ${table} has a row with ${pairs.join(', ')}, but no ${parent} row has that value in ${toColumns.join(', ')}.`;
}

/** Per-connection settings: the memory bound, referential integrity, and the dialect function library. */
function applyConnectionSettings(db: Database, foreignKeys: boolean): void {
  db.run(`PRAGMA max_page_count = 16384; PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'};`);
  registerCompatFunctions(db);
}

/** Keep accidental or hostile custom schemas from exhausting browser memory. */
function openBoundedDatabase(SQL: SqlJsStatic, foreignKeys: boolean): Database {
  const db = new SQL.Database();
  applyConnectionSettings(db, foreignKeys);
  return db;
}

/**
 * Serialize a database for storage. sql.js implements export() by closing and
 * reopening the connection, which silently resets PRAGMAs and drops every
 * registered function, so the connection settings are restored afterwards.
 */
export function exportDatabase(db: Database): Uint8Array {
  const bytes = db.export();
  applyConnectionSettings(db, true);
  return bytes;
}

/** Execute a prepared custom-schema script into a new database and apply every limit. */
export function buildCustomDatabase(SQL: SqlJsStatic, statements: PreparedStatement[]): Database {
  let db = openBoundedDatabase(SQL, true);
  try {
    try {
      runStatements(db, statements);
    } catch {
      // Exports insert child rows before parents, reference tables created
      // later, or add keys last (MySQL with FOREIGN_KEY_CHECKS=0, pg_dump).
      // Accept the script when its final state is consistent; otherwise report
      // the statement that still fails, or the first orphan precisely.
      db.close();
      db = openBoundedDatabase(SQL, false);
      runStatements(db, statements);
      const violation = describeForeignKeyViolation(db);
      if (violation) throw new Error(violation);
      db.run('PRAGMA foreign_keys = ON;');
    }
    const { schema } = introspectSchema(db);
    enforceCustomSchemaLimits(db, schema);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

/** Build a fresh, resource-bounded in-memory database from schema SQL. */
export async function createDatabase(ddl: string, validateAsCustom = false): Promise<Database> {
  const statements = validateAsCustom ? prepareCustomDdl(ddl) : null;
  const SQL = await getSqlJs();
  if (statements) return buildCustomDatabase(SQL, statements);
  const db = openBoundedDatabase(SQL, true);
  try {
    db.run(ddl);
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
    applyConnectionSettings(db, true);
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
      // The REAL marker in front of a decimal type (see normalizeColumnDefinitions) is an affinity hint, not the declared type.
      type: String(r[2] ?? '').replace(/^REAL\s+(?=(?:DECIMAL|DEC|NUMERIC|NUMBER|MONEY|SMALLMONEY)\b)/i, '') || undefined,
      notNull: Number(r[3]) > 0 || Number(r[5]) > 0 ? true : undefined,
      defaultValue: r[4] === null ? null : String(r[4]),
      pk: Number(r[5]) > 0 ? true : undefined,
      fk: undefined as TableMeta['columns'][number]['fk'],
    }));
    if (columns.some((column) => column.name.toLowerCase() === '_rowid_')) {
      throw new Error(
        `Table "${table}" has a column named _rowid_, which QueryTrace reserves for tracing rows. Rename it.`
      );
    }

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

/**
 * `_rowid_` rather than `rowid`: a user table may legitimately have a column
 * called rowid (imports often do), and SQLite then makes the bare word mean
 * that column. The underscored alias always means the real row number.
 */
export function getTableData(db: Exec, table: string): TableData {
  const res = queryAll(db, `SELECT _rowid_ AS __rid, * FROM ${quoteIdent(table)} ORDER BY _rowid_`);
  return {
    columns: res.columns.slice(1),
    rows: res.rows.map((r) => r.slice(1)),
    rids: res.rows.map((r) => Number(r[0])),
  };
}
