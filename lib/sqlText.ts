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

function unescapeBackslashes(literal: string): string {
  return literal.replace(/\\([\s\S])/g, (_, ch: string) => BACKSLASH_ESCAPES[ch] ?? ch);
}

/** Rewrite MySQL-style backslash escapes inside single-quoted literals into SQL's doubled quotes. */
export function convertBackslashEscapes(sql: string): string {
  return rewriteSql(
    sql,
    { backslashEscapes: true },
    (text) => text,
    (text) => (text[0] === "'" ? unescapeBackslashes(text) : text)
  );
}

/**
 * PostgreSQL escape strings: E'It\'s' becomes 'It''s'. Only the E-prefixed
 * literals use backslash escapes, so they are converted one at a time.
 */
export function convertEscapeStringLiterals(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const comment = commentEnd(sql, i);
    if (comment !== -1) {
      out += sql.slice(i, comment);
      i = comment;
      continue;
    }
    const ch = sql[i];
    if ((ch === 'E' || ch === 'e') && sql[i + 1] === "'" && !/[\w"`\]]/.test(sql[i - 1] ?? '')) {
      const end = literalEnd(sql, i + 1, true);
      if (end !== -1) {
        out += unescapeBackslashes(sql.slice(i + 1, end));
        i = end;
        continue;
      }
    }
    if (isQuote(ch)) {
      const end = literalEnd(sql, i, false);
      const stop = end === -1 ? n : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** MySQL reads "text" as a string; SQLite reads it as a name. Rewrite such literals to 'text'. */
export function convertDoubleQuotedStrings(sql: string): string {
  return rewriteSql(
    sql,
    {},
    (text) => text,
    (text, terminated) => {
      if (text[0] !== '"' || !terminated) return text;
      const inner = text.slice(1, -1).replace(/""/g, '"').replace(/'/g, "''");
      return `'${inner}'`;
    }
  );
}

/**
 * Apply a regex to the masked form of `text` and let `replace` rebuild each
 * match from its original (unmasked) characters, so literals are never edited
 * and quoted names keep their content.
 */
export function replaceOutsideLiterals(
  text: string,
  pattern: RegExp,
  replace: string | ((original: string, match: RegExpMatchArray) => string),
  options: ScanOptions = {}
): string {
  const masked = maskSql(text, options);
  const global = pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
  let result = '';
  let last = 0;
  for (const match of masked.matchAll(global)) {
    const index = match.index ?? 0;
    const original = text.slice(index, index + match[0].length);
    result += text.slice(last, index) + (typeof replace === 'string' ? replace : replace(original, match));
    last = index + match[0].length;
  }
  return result + text.slice(last);
}

/**
 * Repair what word processors and e-mail clients do to pasted SQL: a byte
 * order mark, curly quotes in place of straight ones, and non-breaking spaces.
 * Curly quotes are only converted when the text has no straight single quotes
 * at all (the whole script was "smartened"); otherwise a curly apostrophe is
 * data inside a normal string and must stay.
 */
export function normalizePastedText(sql: string): string {
  let text = sql.replace(/^﻿/, '');
  if (/[‘’“”]/.test(text) && !text.includes("'")) {
    text = text.replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"');
  }
  // Exotic whitespace outside literals is just whitespace to SQL.
  text = replaceOutsideLiterals(text, /[   -​  　]/g, ' ');
  return text;
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

/* ------------------------------------------------------------------------ */
/* Structural scanning helpers for dialect translation                       */
/* ------------------------------------------------------------------------ */

/** SQL Server [bracketed] names become standard "double-quoted" identifiers. */
export function convertBracketIdentifiers(sql: string): string {
  return rewriteSql(
    sql,
    {},
    (text) => text,
    (text, terminated) =>
      text[0] === '[' && terminated ? quoteIdent(text.slice(1, -1)) : text
  );
}

/** MySQL `# comment` lines become standard `-- comment` lines. */
export function convertHashComments(sql: string): string {
  return rewriteSql(
    sql,
    {},
    (text) => (text[0] === '#' ? `--${text.slice(1)}` : text),
    (text) => text
  );
}

/** Index of the parenthesis that closes the one at `open` in masked text, or -1. */
export function matchingParen(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '(') depth++;
    else if (masked[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

const OPERAND_CHAR = /[\w.$]/;

/**
 * Start index of the operand that ends just before `end` (exclusive) in
 * masked text: a literal, a parenthesized group with an optional function
 * name, or a dotted identifier / number. Returns `end` when nothing qualifies.
 */
export function operandStart(masked: string, end: number): number {
  let i = end;
  while (i > 0 && /\s/.test(masked[i - 1])) i--;
  if (i === 0) return end;
  const last = masked[i - 1];
  if (last === ')') {
    let depth = 0;
    let j = i - 1;
    for (; j >= 0; j--) {
      if (masked[j] === ')') depth++;
      else if (masked[j] === '(' && --depth === 0) break;
    }
    if (j < 0) return end;
    // A function call owns the parentheses that follow its name.
    let k = j;
    while (k > 0 && /\s/.test(masked[k - 1])) k--;
    let nameStart = k;
    while (nameStart > 0 && /[\w.]/.test(masked[nameStart - 1])) nameStart--;
    return nameStart < k && /[A-Za-z_]/.test(masked[nameStart]) ? nameStart : j;
  }
  if (last === "'" || last === '"' || last === '`') {
    const open = masked.lastIndexOf(last, i - 2);
    return open === -1 ? end : open;
  }
  let j = i;
  while (j > 0 && OPERAND_CHAR.test(masked[j - 1])) j--;
  return j < i ? j : end;
}

/**
 * End index (exclusive) of the operand that starts at or after `start` in
 * masked text: a literal, a parenthesized group, or an identifier / number
 * optionally followed by a call's argument list. Returns `start` when nothing qualifies.
 */
export function operandEnd(masked: string, start: number): number {
  let i = start;
  while (i < masked.length && /\s/.test(masked[i])) i++;
  if (i >= masked.length) return start;
  const first = masked[i];
  if (first === '(') {
    const close = matchingParen(masked, i);
    return close === -1 ? start : close + 1;
  }
  if (first === "'" || first === '"' || first === '`') {
    const close = masked.indexOf(first, i + 1);
    return close === -1 ? start : close + 1;
  }
  if (first === '-' || first === '+') i++;
  let j = i;
  while (j < masked.length && OPERAND_CHAR.test(masked[j])) j++;
  if (j === i) return start;
  let k = j;
  while (k < masked.length && /\s/.test(masked[k])) k++;
  if (masked[k] === '(') {
    const close = matchingParen(masked, k);
    return close === -1 ? j : close + 1;
  }
  return j;
}

export interface CallSite {
  /** Function name exactly as written. */
  name: string;
  /** Top-level arguments, trimmed, in original text. */
  args: string[];
  /** Raw text between the parentheses. */
  inner: string;
  /** The whole call as written. */
  text: string;
}

/**
 * Rewrite every call to one of `names` (case-insensitive, outside literals and
 * comments). Innermost calls are processed first so nested calls compose.
 * `replace` returns the replacement text, or null to keep the call as written.
 */
export function rewriteCalls(
  sql: string,
  names: string[],
  replace: (call: CallSite) => string | null
): string {
  const alternatives = names.join('|');
  const pattern = new RegExp(String.raw`(?<![\w.` + '`' + String.raw`"\]])(${alternatives})\s*\(`, 'gi');
  const head = new RegExp(String.raw`^(${alternatives})\s*\(`, 'i');
  const starts = [...maskSql(sql).matchAll(pattern)].map((match) => match.index ?? 0).reverse();
  let text = sql;
  for (const start of starts) {
    const masked = maskSql(text);
    const match = masked.slice(start).match(head);
    if (!match) continue;
    const open = start + match[0].length - 1;
    const close = matchingParen(masked, open);
    if (close === -1) continue;
    const inner = text.slice(open + 1, close);
    const replacement = replace({
      name: match[1],
      args: splitTopLevel(inner),
      inner,
      text: text.slice(start, close + 1),
    });
    if (replacement !== null) text = text.slice(0, start) + replacement + text.slice(close + 1);
  }
  return text;
}

/** Locate a keyword at parenthesis depth 0 of masked text. Returns every match index. */
export function topLevelMatches(masked: string, pattern: RegExp): RegExpMatchArray[] {
  const global = pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
  const out: RegExpMatchArray[] = [];
  const depthAt: number[] = new Array(masked.length);
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === '(') depth++;
    depthAt[i] = depth;
    if (masked[i] === ')') depth = Math.max(0, depth - 1);
  }
  for (const match of masked.matchAll(global)) {
    if (depthAt[match.index ?? 0] === 0) out.push(match);
  }
  return out;
}
