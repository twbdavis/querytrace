/**
 * Translate the query dialects of MySQL / MariaDB (first), PostgreSQL, SQL
 * Server and Oracle into the SQLite the trace engine executes. Every rewrite
 * is recorded as a note so the learner sees how the same query is spelled in
 * SQLite; constructs SQLite cannot express raise a DialectError that explains
 * the alternative instead of a raw parser message.
 *
 * Only text outside string literals and comments is ever changed.
 */
import {
  convertBackslashEscapes,
  convertBracketIdentifiers,
  convertEscapeStringLiterals,
  convertHashComments,
  hasUnterminatedLiteral,
  maskSql,
  matchingParen,
  normalizePastedText,
  operandEnd,
  operandStart,
  replaceOutsideLiterals,
  rewriteCalls,
  splitTopLevel,
  topLevelMatches,
} from './sqlText';

export interface DialectNote {
  /** What the learner wrote. */
  from: string;
  /** How SQLite spells it (or what QueryTrace substituted). */
  to: string;
}

export interface Translation {
  sql: string;
  notes: DialectNote[];
}

/** A construct with no SQLite equivalent; the message names what to write instead. */
export class DialectError extends Error {}

function fail(message: string): never {
  throw new DialectError(message);
}

const INTERVAL_UNITS: Record<string, string> = {
  year: 'YEAR', years: 'YEAR', quarter: 'QUARTER', quarters: 'QUARTER', month: 'MONTH', months: 'MONTH',
  week: 'WEEK', weeks: 'WEEK', day: 'DAY', days: 'DAY', hour: 'HOUR', hours: 'HOUR',
  minute: 'MINUTE', minutes: 'MINUTE', second: 'SECOND', seconds: 'SECOND',
};

const CAST_TYPES: Array<[RegExp, string | null]> = [
  [/^(?:UNSIGNED|SIGNED)(?:\s+INT(?:EGER)?)?$/i, 'INTEGER'],
  [/^(?:TINY|SMALL|MEDIUM|BIG)?INT(?:EGER)?(?:\s*\(\s*\d+\s*\))?$/i, 'INTEGER'],
  [/^(?:INT2|INT4|INT8|SERIAL|BIGSERIAL|NUMBER\s*\(\s*\d+\s*\))$/i, 'INTEGER'],
  [/^(?:N?VAR)?CHAR(?:ACTER)?(?:\s+VARYING)?(?:\s*\(\s*(?:\d+|MAX)\s*\))?$/i, 'TEXT'],
  [/^(?:N?TEXT|STRING|VARCHAR2(?:\s*\(\s*\d+(?:\s+(?:CHAR|BYTE))?\s*\))?|CITEXT|CLOB)$/i, 'TEXT'],
  [/^(?:DECIMAL|DEC|NUMERIC|NUMBER|MONEY|SMALLMONEY)(?:\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?$/i, 'NUMERIC'],
  [/^(?:FLOAT|FLOAT4|FLOAT8|DOUBLE(?:\s+PRECISION)?|REAL|BINARY_DOUBLE|BINARY_FLOAT)(?:\s*\(\s*\d+\s*\))?$/i, 'REAL'],
  [/^(?:BOOL|BOOLEAN|BIT)$/i, null],
];

function castTarget(type: string): { sqlite: string } | { fn: string } | { passthrough: true } | null {
  const trimmed = type.trim();
  if (/^DATE$/i.test(trimmed)) return { fn: 'DATE' };
  if (/^(?:DATETIME2?|TIMESTAMP(?:\s+with(?:out)?\s+time\s+zone)?|TIMESTAMPTZ|SMALLDATETIME)(?:\s*\(\s*\d+\s*\))?$/i.test(trimmed)) return { fn: 'DATETIME' };
  if (/^TIME(?:\s+with(?:out)?\s+time\s+zone)?(?:\s*\(\s*\d+\s*\))?$/i.test(trimmed)) return { fn: 'TIME' };
  for (const [pattern, sqlite] of CAST_TYPES) {
    if (pattern.test(trimmed)) return sqlite === null ? { passthrough: true } : { sqlite };
  }
  return null;
}

/** "3", "-3", "(n)" or an expression → a SQL expression string. */
function wrapNumber(expr: string): string {
  const trimmed = expr.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return trimmed;
  const masked = maskSql(trimmed);
  if (masked[0] === '(' && matchingParen(masked, 0) === masked.length - 1) return trimmed;
  return `(${trimmed})`;
}

function readInterval(text: string): { n: string; unit: string } | null {
  const masked = maskSql(text);
  const match = masked.match(/^\s*INTERVAL\s+/i);
  if (!match) return null;
  const body = text.slice(match[0].length).trim();
  // PostgreSQL: INTERVAL '7 days' / INTERVAL '1 month'
  const quoted = body.match(/^'\s*(-?\d+(?:\.\d+)?)\s*([A-Za-z]+)\s*'$/);
  if (quoted) {
    const unit = INTERVAL_UNITS[quoted[2].toLowerCase()];
    return unit ? { n: quoted[1], unit } : null;
  }
  // MySQL: INTERVAL 7 DAY / INTERVAL (n + 1) MONTH / INTERVAL '7' DAY
  const spaced = maskSql(body).match(/\s+([A-Za-z]+)\s*$/);
  if (!spaced) return null;
  const unit = INTERVAL_UNITS[spaced[1].toLowerCase()];
  if (!unit) return null;
  const n = body.slice(0, body.length - spaced[0].length).trim().replace(/^'(-?\d+)'$/, '$1');
  return n ? { n, unit } : null;
}

export function translateQuery(input: string): Translation {
  const notes: DialectNote[] = [];
  const seen = new Set<string>();
  const note = (from: string, to: string) => {
    const key = `${from}→${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    notes.push({ from, to });
  };

  let sql = normalizePastedText(input);

  // --- Literals and comments ------------------------------------------------------
  if (/\\'/.test(sql) && hasUnterminatedLiteral(sql) && !hasUnterminatedLiteral(sql, { backslashEscapes: true })) {
    sql = convertBackslashEscapes(sql);
    note("'It\\'s'", "'It''s'");
  }
  if (/(?<![\w"`\]])[Ee]'/.test(sql)) sql = convertEscapeStringLiterals(sql);
  sql = convertHashComments(sql);
  if (sql.includes('[')) {
    const converted = convertBracketIdentifiers(sql);
    if (converted !== sql) {
      note('[name]', '"name"');
      sql = converted;
    }
  }
  const rewrite = (pattern: RegExp, replacement: string | ((original: string, match: RegExpMatchArray) => string)) => {
    const next = replaceOutsideLiterals(sql, pattern, replacement);
    const changed = next !== sql;
    sql = next;
    return changed;
  };
  if (rewrite(/(?<![\w"`\]])N(?=')/g, '')) note("N'text'", "'text'");
  if (rewrite(/\b(?:DATE|TIME|TIMESTAMP)\s+(?=')/gi, '')) note("DATE '2024-01-01'", "'2024-01-01'");
  if (rewrite(/(?<![\w.])\.(?=\d)/g, '0.')) note('.5', '0.5');

  // --- Constructs SQLite cannot express -------------------------------------------
  const masked0 = maskSql(sql);
  if (/\bSELECT\s+DISTINCT\s+ON\s*\(/i.test(masked0)) {
    fail('DISTINCT ON is PostgreSQL-only. Use GROUP BY with MIN()/MAX(), or a window function with ROW_NUMBER() OVER (PARTITION BY ...).');
  }
  if (/\bNATURAL\s+(?:INNER\s+|LEFT\s+|RIGHT\s+|FULL\s+)?(?:OUTER\s+)?JOIN\b/i.test(masked0)) {
    fail('NATURAL JOIN is not visualized. Spell the match out: JOIN table2 ON table1.column = table2.column.');
  }
  if (/\bWITH\s+ROLLUP\b|\b(?:ROLLUP|CUBE|GROUPING\s+SETS)\s*\(/i.test(masked0)) {
    fail('ROLLUP / CUBE totals are not supported by SQLite. Run a second query with UNION ALL for the grand total.');
  }
  if (/\bFILTER\s*\(\s*WHERE\b/i.test(masked0)) {
    fail('FILTER (WHERE ...) on an aggregate is not supported in visual mode. Use SUM(CASE WHEN condition THEN 1 ELSE 0 END) or COUNT(CASE WHEN condition THEN 1 END) instead.');
  }
  if (/\bWINDOW\s+\w+\s+AS\s*\(/i.test(masked0)) {
    fail('Named WINDOW clauses are not supported in visual mode. Write the OVER (...) specification inline.');
  }
  if (/\bOVER\s*\([^)]*\b(?:ROWS|RANGE|GROUPS)\s+(?:BETWEEN|UNBOUNDED|CURRENT|\d)/i.test(masked0)) {
    fail('Window frames (ROWS BETWEEN ...) are not supported in visual mode. Use OVER (PARTITION BY ... ORDER BY ...) without a frame.');
  }
  if (/^\s*(?:WITH\b[\s\S]*?\)\s*)?SELECT\b[\s\S]*?\bINTO\s+(?:"[^"]*"|\w+)\s+FROM\b/i.test(masked0)) {
    fail('SELECT ... INTO creates a table in SQL Server. Trace the SELECT on its own here; new tables belong in the schema script (SCHEMA button).');
  }
  if (/(?<![\w'"])@\w+/.test(masked0) || /:=/.test(masked0)) {
    fail('Session variables (@name, :=) are MySQL-specific and not available in a query trace. Replace the variable with its value.');
  }
  if (/\b(?:CROSS|OUTER)\s+APPLY\b|\bLATERAL\b|\bPIVOT\s*\(|\bUNPIVOT\s*\(/i.test(masked0)) {
    fail('APPLY, LATERAL and PIVOT are not supported by SQLite. Rewrite the query with a JOIN or a subquery in FROM.');
  }
  if (/\bSELECT\s+TOP\b[^;]*?\bPERCENT\b/i.test(masked0)) {
    fail('TOP n PERCENT is SQL Server-only. Use LIMIT with the exact number of rows instead.');
  }
  if (/\bSIMILAR\s+TO\b/i.test(masked0)) fail('SIMILAR TO is PostgreSQL-only. Use LIKE, or a REGEXP pattern.');
  if (/\bWITH\s+RECURSIVE\b/i.test(masked0)) {
    fail('Recursive CTEs are not traced. Use a plain WITH name AS (SELECT ...) or a self-join for one level of hierarchy.');
  }
  if (/\b(?:ALL|ANY|SOME)\s*\(\s*SELECT\b/i.test(masked0)) {
    fail('SQLite has no ALL / ANY / SOME quantifiers. Compare against an aggregate instead: x > (SELECT MAX(y) FROM ...) for ALL, or use IN / EXISTS for ANY.');
  }
  if (/\bGROUP_CONCAT\s*\(\s*DISTINCT\b[^)]*\bSEPARATOR\b/i.test(masked0)) {
    fail('SQLite cannot combine DISTINCT with a custom separator in GROUP_CONCAT. Drop the SEPARATOR (SQLite uses a comma) or the DISTINCT.');
  }

  // --- Whole-statement forms -------------------------------------------------------
  const top = maskSql(sql).match(/^(\s*(?:WITH\b[\s\S]*?\)\s*)?SELECT\s+(?:DISTINCT\s+)?)TOP\s*\(?\s*(\d+)\s*\)?(?:\s+WITH\s+TIES)?\s+/i);
  if (top) {
    const count = top[2];
    sql = sql.slice(0, top[1].length) + sql.slice(top[0].length);
    if (!/\bLIMIT\b/i.test(maskSql(sql))) {
      sql = `${sql.replace(/;?\s*$/, '')} LIMIT ${count}`;
    }
    note(`TOP ${count}`, `LIMIT ${count}`);
  }
  if (rewrite(/\bOFFSET\s+(\d+)\s+ROWS?\s+FETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS?\s+ONLY\b/gi, (_, match) => `LIMIT ${match[2]} OFFSET ${match[1]}`)) {
    note('OFFSET m ROWS FETCH NEXT n ROWS ONLY', 'LIMIT n OFFSET m');
  }
  if (rewrite(/\bFETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS?\s+ONLY\b/gi, (_, match) => `LIMIT ${match[1]}`)) {
    note('FETCH FIRST n ROWS ONLY', 'LIMIT n');
  }
  if (rewrite(/\bOFFSET\s+(\d+)\s+ROWS?\b(?!\s*FETCH)/gi, (_, match) => `LIMIT -1 OFFSET ${match[1]}`)) {
    note('OFFSET n ROWS', 'LIMIT -1 OFFSET n');
  }
  if (rewrite(/\bLIMIT\s+ALL\b/gi, '')) note('LIMIT ALL', '(no limit)');
  if (rewrite(/^(\s*(?:WITH\b[\s\S]*?\)\s*)?SELECT\s+)ALL\b\s*/i, (original, match) => original.slice(0, match[1].length))) note('SELECT ALL', 'SELECT');
  if (rewrite(/\bFROM\s+DUAL\b/gi, '')) note('FROM DUAL', '(no FROM needed)');
  if (rewrite(/\s+FOR\s+(?:UPDATE|SHARE)(?:\s+(?:NOWAIT|SKIP\s+LOCKED))?\s*$/i, '')) note('FOR UPDATE', '(no row locking in a trace)');
  if (rewrite(/\bMINUS\b/gi, 'EXCEPT')) note('MINUS', 'EXCEPT');
  if (rewrite(/^(\s*)TRUNCATE\s+(?:TABLE\s+)?/i, (_, match) => `${match[1]}DELETE FROM `)) note('TRUNCATE TABLE t', 'DELETE FROM t');
  if (rewrite(/^(\s*)INSERT\s+IGNORE\s+INTO\b/i, (_, match) => `${match[1]}INSERT OR IGNORE INTO`)) note('INSERT IGNORE INTO', 'INSERT OR IGNORE INTO');
  if (rewrite(/^(\s*)REPLACE\s+INTO\b/i, (_, match) => `${match[1]}INSERT OR REPLACE INTO`)) note('REPLACE INTO', 'INSERT OR REPLACE INTO');
  if (rewrite(/^(\s*)INSERT\s+(?:LOW_PRIORITY|DELAYED|HIGH_PRIORITY)\s+INTO\b/i, (_, match) => `${match[1]}INSERT INTO`)) note('INSERT LOW_PRIORITY INTO', 'INSERT INTO');
  if (/^\s*INSERT\b[\s\S]*\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i.test(maskSql(sql))) {
    const upsert = maskSql(sql).match(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i)!;
    const after = replaceOutsideLiterals(sql.slice(upsert.index! + upsert[0].length), /\bVALUES\s*\(\s*(`[^`]*`|"[^"]*"|\w+)\s*\)/gi, (_, match) => `excluded.${match[1]}`);
    sql = `${sql.slice(0, upsert.index)}ON CONFLICT DO UPDATE SET${after}`;
    note('ON DUPLICATE KEY UPDATE col = VALUES(col)', 'ON CONFLICT DO UPDATE SET col = excluded.col');
  }
  {
    // MySQL "INSERT INTO t SET a = 1, b = 'x'" -> column list plus VALUES.
    const setForm = maskSql(sql).match(/^(\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(?:"[^"]*"|`[^`]*`|\w+)(?:\s*\.\s*(?:"[^"]*"|`[^`]*`|\w+))?\s+)SET\s+/i);
    if (setForm) {
      const assignments = splitTopLevel(sql.slice(setForm[0].length)).map((assignment) => {
        const eq = maskSql(assignment).indexOf('=');
        return eq === -1 ? null : { column: assignment.slice(0, eq).trim(), value: assignment.slice(eq + 1).trim() };
      });
      if (assignments.every((assignment) => assignment !== null)) {
        const columns = assignments.map((assignment) => assignment!.column).join(', ');
        const values = assignments.map((assignment) => assignment!.value).join(', ');
        sql = `${sql.slice(0, setForm[1].length).replace(/\s+$/, '')} (${columns}) VALUES (${values})`;
        note('INSERT INTO t SET a = 1', 'INSERT INTO t (a) VALUES (1)');
      }
    }
  }
  if (rewrite(/^(\s*INSERT\b[^(]*?)\bVALUE\s*(?=\()/i, (original) => `${original.slice(0, -'VALUE'.length).trimEnd()} VALUES `)) note('VALUE (...)', 'VALUES (...)');
  // Oracle row limiting: WHERE ROWNUM <= n on its own, or AND ROWNUM <= n at the end of a WHERE.
  {
    let limit: number | null = null;
    const readLimit = (match: RegExpMatchArray) => {
      limit = match[1] === '<' ? Number(match[2]) - 1 : Number(match[2]);
      return '';
    };
    const alone = /\s*\bWHERE\s+ROWNUM\s*(<=|<)\s*(\d+)(?=\s*$|\s*;|\s+ORDER\b)/i;
    const trailing = /\s+AND\s+ROWNUM\s*(<=|<)\s*(\d+)(?=\s*$|\s*;|\s+ORDER\b|\s+GROUP\b)/i;
    if (alone.test(maskSql(sql))) rewrite(alone, (_, match) => readLimit(match));
    else if (trailing.test(maskSql(sql))) rewrite(trailing, (_, match) => readLimit(match));
    if (limit !== null) {
      if (!/\bLIMIT\b/i.test(maskSql(sql))) sql = `${sql.replace(/;?\s*$/, '')} LIMIT ${limit}`;
      note('ROWNUM <= n', `LIMIT ${limit}`);
    }
  }

  // --- Operators -------------------------------------------------------------------
  if (rewrite(/\bILIKE\b/gi, 'LIKE')) note('ILIKE', 'LIKE (SQLite LIKE already ignores case for ASCII letters)');
  if (rewrite(/\bRLIKE\b/gi, 'REGEXP')) note('RLIKE', 'REGEXP');
  if (rewrite(/\bIS\s+NOT\s+DISTINCT\s+FROM\b/gi, 'IS')) note('IS NOT DISTINCT FROM', 'IS');
  if (rewrite(/\bIS\s+DISTINCT\s+FROM\b/gi, 'IS NOT')) note('IS DISTINCT FROM', 'IS NOT');
  if (rewrite(/<=>/g, 'IS')) note('<=>', 'IS (null-safe equality)');
  if (rewrite(/\bNOTNULL\b/gi, 'IS NOT NULL')) note('NOTNULL', 'IS NOT NULL');
  if (rewrite(/\bISNULL\b(?!\s*\()/gi, 'IS NULL')) note('ISNULL', 'IS NULL');
  if (rewrite(/\bISNULL\s*\(/gi, 'IFNULL(')) note('ISNULL(a, b)', 'IFNULL(a, b)');
  if (rewrite(/\bSYSDATE\b(?!\s*\()/gi, 'CURRENT_TIMESTAMP')) note('SYSDATE', 'CURRENT_TIMESTAMP');
  if (rewrite(/\bSYSDATE\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP')) note('SYSDATE()', 'CURRENT_TIMESTAMP');
  if (rewrite(/\b(CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP|LOCALTIMESTAMP|LOCALTIME)\s*\(\s*\d*\s*\)/gi, (_, match) => match[1].toUpperCase().replace('LOCALTIMESTAMP', 'CURRENT_TIMESTAMP').replace('LOCALTIME', 'CURRENT_TIME'))) {
    note('CURRENT_DATE()', 'CURRENT_DATE (no parentheses)');
  }

  // a DIV b (MySQL integer division)
  for (;;) {
    const masked = maskSql(sql);
    const div = masked.match(/\s+DIV\s+/i);
    if (!div || div.index === undefined) break;
    const leftStart = operandStart(masked, div.index);
    const rightEnd = operandEnd(masked, div.index + div[0].length);
    if (leftStart === div.index || rightEnd === div.index + div[0].length) fail('a DIV b could not be translated; write CAST(a / b AS INTEGER) instead.');
    const left = sql.slice(leftStart, div.index).trim();
    const right = sql.slice(div.index + div[0].length, rightEnd).trim();
    sql = `${sql.slice(0, leftStart)}CAST(${left} / ${right} AS INTEGER)${sql.slice(rightEnd)}`;
    note('a DIV b', 'CAST(a / b AS INTEGER)');
  }

  // PostgreSQL casts: expr::type
  for (;;) {
    const masked = maskSql(sql);
    const cast = masked.match(/::\s*([A-Za-z_][\w ]*?(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)(?![\w(])/);
    if (!cast || cast.index === undefined) break;
    const start = operandStart(masked, cast.index);
    if (start === cast.index) fail('A ::type cast needs a value on its left, for example price::integer.');
    const expr = sql.slice(start, cast.index).trim();
    const typeText = cast[1].trim();
    const target = castTarget(typeText);
    if (!target) fail(`SQLite has no ${typeText} type. Cast to INTEGER, REAL, NUMERIC or TEXT instead.`);
    const replacement =
      'fn' in target ? `${target.fn}(${expr})` : 'passthrough' in target ? `(${expr})` : `CAST(${expr} AS ${target.sqlite})`;
    sql = `${sql.slice(0, start)}${replacement}${sql.slice(cast.index + cast[0].length)}`;
    note(`${expr}::${typeText}`, replacement);
  }

  // --- Interval arithmetic ----------------------------------------------------------
  sql = rewriteCalls(sql, ['DATE_ADD', 'DATE_SUB', 'ADDDATE', 'SUBDATE', 'TIMESTAMPADD'], (call) => {
    if (call.args.length !== 2) return null;
    const interval = readInterval(call.args[1]);
    if (!interval) return null;
    const name = call.name.toUpperCase();
    note(`${name}(d, ${call.args[1].trim()})`, `${name}(d, ${wrapNumber(interval.n)}, '${interval.unit}')`);
    return `${name}(${call.args[0].trim()}, ${wrapNumber(interval.n)}, '${interval.unit}')`;
  });
  for (;;) {
    const masked = maskSql(sql);
    const interval = masked.match(/([+-])\s*INTERVAL\s+/i);
    if (!interval || interval.index === undefined) break;
    const intervalStart = interval.index + interval[0].length - 'INTERVAL '.length;
    const afterKeyword = interval.index + interval[0].length;
    // The amount is a quoted string, a number, or a parenthesized expression, followed by the unit word (MySQL) or nothing (PostgreSQL string form).
    const amountEnd = operandEnd(masked, afterKeyword);
    if (amountEnd === afterKeyword) fail('INTERVAL needs an amount and a unit, for example INTERVAL 7 DAY.');
    let end = amountEnd;
    const unitMatch = masked.slice(amountEnd).match(/^\s+([A-Za-z]+)\b/);
    if (unitMatch && INTERVAL_UNITS[unitMatch[1].toLowerCase()]) end = amountEnd + unitMatch[0].length;
    const parsed = readInterval(sql.slice(intervalStart, end));
    if (!parsed) fail(`INTERVAL ${sql.slice(afterKeyword, end).trim()} is not understood. Use INTERVAL n DAY / MONTH / YEAR / HOUR / MINUTE / SECOND.`);
    const leftStart = operandStart(masked, interval.index);
    if (leftStart === interval.index) fail('INTERVAL arithmetic needs a date on its left, for example order_date + INTERVAL 7 DAY.');
    const left = sql.slice(leftStart, interval.index).trim();
    const fn = interval[1] === '-' ? 'DATE_SUB' : 'DATE_ADD';
    const replacement = `${fn}(${left}, ${wrapNumber(parsed.n)}, '${parsed.unit}')`;
    sql = `${sql.slice(0, leftStart)}${replacement}${sql.slice(end)}`;
    note(`${left} ${interval[1]} INTERVAL ${parsed.n} ${parsed.unit}`, replacement);
  }
  if (/\bINTERVAL\b/i.test(maskSql(sql))) {
    fail('INTERVAL is only understood in date arithmetic: date + INTERVAL n unit, or DATE_ADD(date, INTERVAL n unit).');
  }

  // --- Function spellings -------------------------------------------------------------
  sql = rewriteCalls(sql, ['EXTRACT'], (call) => {
    const match = call.inner.match(/^\s*(\w+)\s+FROM\s+([\s\S]+)$/i);
    if (!match) return null;
    const unit = match[1].toUpperCase();
    const expr = match[2].trim();
    const map: Record<string, string> = {
      YEAR: `YEAR(${expr})`, MONTH: `MONTH(${expr})`, DAY: `DAY(${expr})`, HOUR: `HOUR(${expr})`,
      MINUTE: `MINUTE(${expr})`, SECOND: `SECOND(${expr})`, DOW: `QT_DOW(${expr})`, DOY: `DAYOFYEAR(${expr})`,
      WEEK: `WEEK(${expr})`, QUARTER: `QUARTER(${expr})`, EPOCH: `UNIXEPOCH(${expr})`, ISODOW: `(QT_DOW(${expr}) + 6) % 7 + 1`,
    };
    const replacement = map[unit];
    if (!replacement) fail(`EXTRACT(${unit} FROM ...) is not supported. Use YEAR, MONTH, DAY, HOUR, MINUTE, SECOND, DOW, DOY, WEEK, QUARTER or EPOCH.`);
    note(`EXTRACT(${unit} FROM ${expr})`, replacement);
    return replacement;
  });
  sql = rewriteCalls(sql, ['SUBSTRING', 'SUBSTR'], (call) => {
    const match = call.inner.match(/^([\s\S]+?)\s+FROM\s+([\s\S]+?)(?:\s+FOR\s+([\s\S]+))?$/i);
    if (!match || call.args.length !== 1) return null;
    const replacement = `SUBSTR(${match[1].trim()}, ${match[2].trim()}${match[3] ? `, ${match[3].trim()}` : ''})`;
    note('SUBSTRING(s FROM a FOR n)', 'SUBSTR(s, a, n)');
    return replacement;
  });
  sql = rewriteCalls(sql, ['TRIM'], (call) => {
    const match = call.inner.match(/^\s*(?:(BOTH|LEADING|TRAILING)\s+)?(?:('(?:''|[^'])*'|"(?:""|[^"])*")\s+)?FROM\s+([\s\S]+)$/i);
    if (!match) return null;
    const side = (match[1] ?? 'BOTH').toUpperCase();
    const fn = side === 'LEADING' ? 'LTRIM' : side === 'TRAILING' ? 'RTRIM' : 'TRIM';
    const replacement = `${fn}(${match[3].trim()}${match[2] ? `, ${match[2]}` : ''})`;
    note(`TRIM(${side} ... FROM s)`, replacement.replace(match[3].trim(), 's'));
    return replacement;
  });
  sql = rewriteCalls(sql, ['POSITION'], (call) => {
    const match = call.inner.match(/^([\s\S]+?)\s+IN\s+([\s\S]+)$/i);
    if (!match || call.args.length !== 1) return null;
    note('POSITION(needle IN s)', 'INSTR(s, needle)');
    return `INSTR(${match[2].trim()}, ${match[1].trim()})`;
  });
  sql = rewriteCalls(sql, ['GROUP_CONCAT', 'STRING_AGG', 'LISTAGG'], (call) => {
    const name = call.name.toUpperCase();
    let inner = call.inner;
    let separator: string | null = null;
    const masked = maskSql(inner);
    const sep = masked.match(/\s+SEPARATOR\s+/i);
    if (sep && sep.index !== undefined) {
      separator = inner.slice(sep.index + sep[0].length).trim();
      inner = inner.slice(0, sep.index);
    }
    const order = maskSql(inner).match(/\s+ORDER\s+BY\s+[\s\S]*$/i);
    if (order && order.index !== undefined) {
      inner = inner.slice(0, order.index);
      note(`${name}(... ORDER BY ...)`, `${name}(...) (SQLite concatenates in scan order)`);
    }
    if (!sep && !order && name !== 'LISTAGG') return null;
    const args = splitTopLevel(inner);
    if (name === 'LISTAGG') {
      note('LISTAGG(x, sep) WITHIN GROUP (ORDER BY ...)', 'GROUP_CONCAT(x, sep)');
      return `GROUP_CONCAT(${args.join(', ')})`;
    }
    if (separator !== null) note(`GROUP_CONCAT(x SEPARATOR ${separator})`, `GROUP_CONCAT(x, ${separator})`);
    return `${name}(${[...args, ...(separator !== null ? [separator] : [])].join(', ')})`;
  });
  if (rewrite(/\)\s*WITHIN\s+GROUP\s*\(\s*ORDER\s+BY\b[^)]*\)/gi, ')')) note('WITHIN GROUP (ORDER BY ...)', '(dropped)');
  sql = rewriteCalls(sql, ['CONVERT'], (call) => {
    if (call.args.length === 1 && /^\s*[\s\S]+\s+USING\s+\w+\s*$/i.test(maskSql(call.inner))) {
      note('CONVERT(x USING charset)', 'x');
      return `(${call.inner.replace(/\s+USING\s+\w+\s*$/i, '').trim()})`;
    }
    if (call.args.length < 2 || call.args.length > 3) return null;
    // SQL Server puts the type first; MySQL puts the value first.
    const typeFirst = castTarget(call.args[0]) !== null && castTarget(call.args[1]) === null;
    const value = typeFirst ? call.args[1] : call.args[0];
    const type = typeFirst ? call.args[0] : call.args[1];
    note(`CONVERT(${typeFirst ? `${type.trim()}, x` : `x, ${type.trim()}`})`, `CAST(x AS ${type.trim()})`);
    return `CAST(${value.trim()} AS ${type.trim()})`;
  });
  sql = rewriteCalls(sql, ['CAST'], (call) => {
    const match = maskSql(call.inner).match(/\s+AS\s+([\s\S]+)$/i);
    if (!match || match.index === undefined) return null;
    const expr = call.inner.slice(0, match.index).trim();
    const typeText = call.inner.slice(match.index + match[0].length - match[1].length).trim();
    if (/^(?:INTEGER|REAL|NUMERIC|TEXT|BLOB)$/i.test(typeText)) return null;
    const target = castTarget(typeText);
    if (!target) fail(`SQLite has no ${typeText} type. Cast to INTEGER, REAL, NUMERIC or TEXT instead.`);
    const replacement =
      'fn' in target ? `${target.fn}(${expr})` : 'passthrough' in target ? `(${expr})` : `CAST(${expr} AS ${target.sqlite})`;
    note(`CAST(x AS ${typeText})`, replacement.replace(expr, 'x'));
    return replacement;
  });
  // T-SQL / MySQL unit keywords are bare words; quote them so they are not read as columns.
  sql = rewriteCalls(sql, ['DATEADD', 'DATEDIFF', 'DATEPART', 'DATENAME', 'TIMESTAMPDIFF', 'TIMESTAMPADD', 'DATE_TRUNC'], (call) => {
    if (!call.args.length) return null;
    const first = call.args[0].trim();
    if (!/^[A-Za-z]+$/.test(first) || (call.name.toUpperCase() === 'DATEDIFF' && call.args.length !== 3)) return null;
    return `${call.name}('${first}', ${call.args.slice(1).join(', ')})`;
  });
  // The emulated functions are registered with one argument count each; the
  // shorter spellings are padded to that shape (MySQL DATEDIFF(a, b) is a - b in days).
  sql = rewriteCalls(sql, ['DATEDIFF'], (call) =>
    call.args.length === 2 ? `DATEDIFF('day', ${call.args[1].trim()}, ${call.args[0].trim()})` : null
  );
  sql = rewriteCalls(sql, ['DATE_ADD', 'ADDDATE', 'DATE_SUB', 'SUBDATE'], (call) => {
    if (call.args.length !== 2) return null;
    note(`${call.name.toUpperCase()}(d, n)`, `${call.name.toUpperCase()}(d, n, 'DAY')`);
    return `${call.name}(${call.args[0].trim()}, ${call.args[1].trim()}, 'DAY')`;
  });
  sql = rewriteCalls(sql, ['LOCATE'], (call) => (call.args.length === 2 ? `LOCATE(${call.args.join(', ')}, 1)` : null));
  sql = rewriteCalls(sql, ['LPAD', 'RPAD'], (call) => (call.args.length === 2 ? `${call.name}(${call.args.join(', ')}, ' ')` : null));
  sql = rewriteCalls(sql, ['TO_CHAR', 'TO_DATE'], (call) => (call.args.length === 1 ? `${call.name}(${call.args[0]}, NULL)` : null));
  sql = rewriteCalls(sql, ['TRUNC'], (call) => (call.args.length === 1 ? `TRUNC(${call.args[0]}, 0)` : null));
  sql = rewriteCalls(sql, ['WEEK'], (call) => (call.args.length === 2 ? `WEEK(${call.args[0]})` : null));
  sql = rewriteCalls(sql, ['GREATEST', 'LEAST'], (call) => {
    const replacement = call.name.toUpperCase() === 'GREATEST' ? 'MAX' : 'MIN';
    note(`${call.name.toUpperCase()}(a, b)`, `${replacement}(a, b) (SQLite's multi-argument MAX / MIN)`);
    return `${replacement}(${call.inner})`;
  });
  sql = rewriteCalls(sql, ['FORMAT'], (call) => {
    // MySQL FORMAT(x, decimals) vs SQLite FORMAT(printf-style, ...): a numeric second argument means MySQL.
    if (call.args.length !== 2 || !/^\d+$/.test(call.args[1].trim())) return null;
    note(`FORMAT(x, ${call.args[1].trim()})`, `PRINTF('%.${call.args[1].trim()}f', x)`);
    return `PRINTF('%.${call.args[1].trim()}f', ${call.args[0].trim()})`;
  });

  // --- NULLS FIRST / LAST ---------------------------------------------------------------
  for (;;) {
    const masked = maskSql(sql);
    const nulls = topLevelMatches(masked, /\s+NULLS\s+(FIRST|LAST)\b/i)[0];
    if (!nulls || nulls.index === undefined) {
      if (/\bNULLS\s+(?:FIRST|LAST)\b/i.test(masked)) fail('NULLS FIRST / LAST inside a subquery is not supported here; sort the outer query instead.');
      break;
    }
    const before = masked.slice(0, nulls.index);
    const clauseStart = Math.max(before.search(/\bORDER\s+BY\s+(?![\s\S]*\bORDER\s+BY\b)/i), 0);
    const orderBy = before.slice(clauseStart).match(/^ORDER\s+BY\s+/i);
    if (!orderBy) fail('NULLS FIRST / LAST is only understood inside ORDER BY.');
    const itemsStart = clauseStart + orderBy[0].length;
    const itemStart = Math.max(itemsStart, ...topLevelMatches(before.slice(itemsStart), /,/g).map((m) => itemsStart + (m.index ?? 0) + 1));
    let item = sql.slice(itemStart, nulls.index).trim();
    const direction = item.match(/\s+(ASC|DESC)$/i);
    if (direction) item = item.slice(0, -direction[0].length).trim();
    const last = nulls[1].toUpperCase() === 'LAST';
    const replacement = `(${item} IS NULL) ${last ? 'ASC' : 'DESC'}, ${item}${direction ? ` ${direction[1].toUpperCase()}` : ''}`;
    const spacer = sql[itemStart - 1] === ',' ? ' ' : '';
    sql = `${sql.slice(0, itemStart)}${spacer}${replacement}${sql.slice(nulls.index + nulls[0].length)}`;
    note(`ORDER BY x NULLS ${last ? 'LAST' : 'FIRST'}`, `ORDER BY (x IS NULL) ${last ? 'ASC' : 'DESC'}, x`);
  }

  // --- Window functions: the parser insists on PARTITION BY, SQLite does not -------------
  // A constant partition is one partition, so this is purely a parsing aid; the
  // trace renders the specification back without it (tidyWindowSql).
  rewrite(/\bOVER\s*\(\s*(?!PARTITION\b)/gi, 'OVER (PARTITION BY NULL ');

  return { sql: sql.trim(), notes };
}

/** Which kind of statement a query is, judged from its first keyword (comments skipped). */
export function statementKind(sql: string): 'select' | 'insert' | 'update' | 'delete' | 'other' {
  const head = maskSql(sql).replace(/^[\s;]+/, '').match(/^(?:(WITH|SELECT|INSERT|REPLACE|UPDATE|DELETE|TRUNCATE|VALUES)\b|(\())/i);
  const word = (head?.[1] ?? head?.[2])?.toUpperCase();
  if (word === 'SELECT' || word === 'WITH' || word === '(' || word === 'VALUES') return 'select';
  if (word === 'INSERT' || word === 'REPLACE') return 'insert';
  if (word === 'UPDATE') return 'update';
  if (word === 'DELETE' || word === 'TRUNCATE') return 'delete';
  return 'other';
}

/** Split a compound query on top-level set operators, keeping the operators. */
export function splitCompound(sql: string): { branches: string[]; operators: string[] } {
  const masked = maskSql(sql);
  const matches = topLevelMatches(masked, /\b(UNION\s+ALL|UNION|INTERSECT|EXCEPT)\b/gi);
  const branches: string[] = [];
  const operators: string[] = [];
  let last = 0;
  for (const match of matches) {
    branches.push(sql.slice(last, match.index).trim());
    operators.push(match[1].replace(/\s+/g, ' ').toUpperCase());
    last = (match.index ?? 0) + match[0].length;
  }
  branches.push(sql.slice(last).trim());
  return { branches, operators };
}

/** Render a window specification the way SQLite prints it, hiding the parser-only partition. */
export function tidyWindowSql(sql: string): string {
  return sql.replace(/OVER \(PARTITION BY NULL\s*\)/g, 'OVER ()').replace(/OVER \(PARTITION BY NULL\s+/g, 'OVER (');
}
