/**
 * Replace comments and string literals with filler of the same length so
 * statement boundaries and keywords can be inspected safely. Every index in
 * the masked text lines up with the same index in the original.
 */
export function maskSql(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      out += ' '.repeat(end - i);
      i = end;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const quote = ch === '[' ? ']' : ch;
      let j = i + 1;
      while (j < n) {
        if (sql[j] === quote) {
          if (quote !== ']' && sql[j + 1] === quote) {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      // Keep the delimiters, blank the contents: a ';' or keyword inside a
      // literal or quoted name must never be mistaken for structure.
      out += sql[i] + ' '.repeat(Math.max(0, j - i - 2)) + (j - i >= 2 ? sql[j - 1] : '');
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
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
