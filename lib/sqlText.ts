export interface ScanOptions {
  /** Treat a backslash inside a single-quoted literal as an escape (MySQL dumps). */
  backslashEscapes?: boolean;
}

/** Index just past the literal that opens at `start`, or -1 when it never closes. */
function literalEnd(sql: string, start: number, backslashEscapes: boolean): number {
  const open = sql[start];
  const close = open === '[' ? ']' : open;
  let j = start + 1;
  while (j < sql.length) {
    const ch = sql[j];
    if (backslashEscapes && open === "'" && ch === '\\') {
      j += 2;
      continue;
    }
    if (ch === close) {
      if (close !== ']' && sql[j + 1] === close) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return -1;
}

/** Index just past the comment that starts at `i`, or -1 when no comment starts there. */
function commentEnd(sql: string, i: number): number {
  const ch = sql[i];
  if ((ch === '-' && sql[i + 1] === '-') || ch === '#') {
    const newline = sql.indexOf('\n', i);
    return newline === -1 ? sql.length : newline;
  }
  if (ch === '/' && sql[i + 1] === '*') {
    const close = sql.indexOf('*/', i + 2);
    return close === -1 ? sql.length : close + 2;
  }
  return -1;
}

function isQuote(ch: string): boolean {
  return ch === "'" || ch === '"' || ch === '`' || ch === '[';
}

/**
 * Walk SQL text once, handing every comment and literal to the callbacks and
 * copying everything else verbatim. Both callbacks return replacement text.
 */
function rewriteSql(
  sql: string,
  options: ScanOptions,
  onComment: (text: string) => string,
  onLiteral: (text: string, terminated: boolean) => string
): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const comment = commentEnd(sql, i);
    if (comment !== -1) {
      out += onComment(sql.slice(i, comment));
      i = comment;
      continue;
    }
    if (isQuote(ch)) {
      const end = literalEnd(sql, i, options.backslashEscapes ?? false);
      const stop = end === -1 ? n : end;
      out += onLiteral(sql.slice(i, stop), end !== -1);
      i = stop;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Replace comments and literal contents with blanks of the same length so
 * statement boundaries and keywords can be inspected safely. Every index in
 * the masked text lines up with the same index in the original. Quote
 * delimiters are kept so quoted names remain recognizable as names.
 */
export function maskSql(sql: string, options: ScanOptions = {}): string {
  return rewriteSql(
    sql,
    options,
    (text) => ' '.repeat(text.length),
    (text, terminated) =>
      terminated
        ? text[0] + ' '.repeat(text.length - 2) + text[text.length - 1]
        : text[0] + ' '.repeat(text.length - 1)
  );
}

/** True when a literal opens but never closes under the given scanning rules. */
export function hasUnterminatedLiteral(sql: string, options: ScanOptions = {}): boolean {
  let unterminated = false;
  rewriteSql(
    sql,
    options,
    (text) => text,
    (text, terminated) => {
      if (!terminated) unterminated = true;
      return text;
    }
  );
  return unterminated;
}

/** Blank out every comment (dash-dash, hash and block comments) while leaving literals intact. Same length as the input. */
export function stripComments(sql: string, options: ScanOptions = {}): string {
  return rewriteSql(
    sql,
    options,
    (text) => text.replace(/[^\n]/g, ' '),
    (text) => text
  );
}

const BACKSLASH_ESCAPES: Record<string, string> = {
  "'": "''",
  '"': '"',
  '\\': '\\',
  n: '\n',
  r: '\r',
  t: '\t',
  0: '',
  Z: '',
  b: '\b',
};

/** Rewrite MySQL-style backslash escapes inside single-quoted literals into SQL's doubled quotes. */
export function convertBackslashEscapes(sql: string): string {
  return rewriteSql(
    sql,
    { backslashEscapes: true },
    (text) => text,
    (text) => {
      if (text[0] !== "'") return text;
      return text.replace(/\\([\s\S])/g, (_, ch: string) => BACKSLASH_ESCAPES[ch] ?? ch);
    }
  );
}

export interface SqlStatement {
  /** Original statement text, without its terminating semicolon. */
  text: string;
  /** The same statement with comments and string literals masked. */
  masked: string;
}

/** Split a script into statements on semicolons that are outside comments and literals. */
export function splitSqlStatements(sql: string): SqlStatement[] {
  const masked = maskSql(sql);
  const statements: SqlStatement[] = [];
  let start = 0;
  for (let i = 0; i <= masked.length; i++) {
    if (i === masked.length || masked[i] === ';') {
      const maskedText = masked.slice(start, i);
      if (maskedText.trim()) {
        statements.push({ text: sql.slice(start, i).trim(), masked: maskedText.trim() });
      }
      start = i + 1;
    }
  }
  return statements;
}

/** Split text on commas that sit outside parentheses, literals and comments. */
export function splitTopLevel(text: string): string[] {
  const masked = maskSql(text);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

const SIMPLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Words SQLite refuses as bare identifiers; quoting them keeps generated SQL valid. */
const RESERVED_WORDS = new Set([
  'ABORT', 'ACTION', 'ADD', 'AFTER', 'ALL', 'ALTER', 'ALWAYS', 'ANALYZE', 'AND', 'AS', 'ASC', 'ATTACH',
  'AUTOINCREMENT', 'BEFORE', 'BEGIN', 'BETWEEN', 'BY', 'CASCADE', 'CASE', 'CAST', 'CHECK', 'COLLATE',
  'COLUMN', 'COMMIT', 'CONFLICT', 'CONSTRAINT', 'CREATE', 'CROSS', 'CURRENT', 'CURRENT_DATE',
  'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'DATABASE', 'DEFAULT', 'DEFERRABLE', 'DEFERRED', 'DELETE',
  'DESC', 'DETACH', 'DISTINCT', 'DO', 'DROP', 'EACH', 'ELSE', 'END', 'ESCAPE', 'EXCEPT', 'EXCLUDE',
  'EXCLUSIVE', 'EXISTS', 'EXPLAIN', 'FAIL', 'FILTER', 'FIRST', 'FOLLOWING', 'FOR', 'FOREIGN', 'FROM',
  'FULL', 'GENERATED', 'GLOB', 'GROUP', 'GROUPS', 'HAVING', 'IF', 'IGNORE', 'IMMEDIATE', 'IN', 'INDEX',
  'INDEXED', 'INITIALLY', 'INNER', 'INSERT', 'INSTEAD', 'INTERSECT', 'INTO', 'IS', 'ISNULL', 'JOIN',
  'KEY', 'LAST', 'LEFT', 'LIKE', 'LIMIT', 'MATCH', 'MATERIALIZED', 'NATURAL', 'NO', 'NOT', 'NOTHING',
  'NOTNULL', 'NULL', 'NULLS', 'OF', 'OFFSET', 'ON', 'OR', 'ORDER', 'OTHERS', 'OUTER', 'OVER',
  'PARTITION', 'PLAN', 'PRAGMA', 'PRECEDING', 'PRIMARY', 'QUERY', 'RAISE', 'RANGE', 'RECURSIVE',
  'REFERENCES', 'REGEXP', 'REINDEX', 'RELEASE', 'RENAME', 'REPLACE', 'RESTRICT', 'RETURNING', 'RIGHT',
  'ROLLBACK', 'ROW', 'ROWS', 'SAVEPOINT', 'SELECT', 'SET', 'TABLE', 'TEMP', 'TEMPORARY', 'THEN', 'TIES',
  'TO', 'TRANSACTION', 'TRIGGER', 'UNBOUNDED', 'UNION', 'UNIQUE', 'UPDATE', 'USING', 'VACUUM', 'VALUES',
  'VIEW', 'VIRTUAL', 'WHEN', 'WHERE', 'WINDOW', 'WITH', 'WITHOUT',
]);

/** Double-quote an identifier for SQLite, escaping embedded quotes. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quote an identifier only when SQLite would otherwise misread it. */
export function quoteIdentIfNeeded(name: string): string {
  return SIMPLE_IDENTIFIER.test(name) && !RESERVED_WORDS.has(name.toUpperCase()) ? name : quoteIdent(name);
}

/** Strip the quoting from an identifier as written (`"Name"`, `` `Name` ``, `[Name]`). */
export function unquoteIdent(name: string): string {
  const trimmed = name.trim();
  const open = trimmed[0];
  if (open === '"' && trimmed.endsWith('"')) return trimmed.slice(1, -1).replace(/""/g, '"');
  if (open === '`' && trimmed.endsWith('`')) return trimmed.slice(1, -1).replace(/``/g, '`');
  if (open === '[' && trimmed.endsWith(']')) return trimmed.slice(1, -1);
  return trimmed;
}
