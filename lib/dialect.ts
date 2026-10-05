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
  // Decimal casts divide like decimals; SQLite's NUMERIC would turn 24.00 into the integer 24.
  [/^(?:DECIMAL|DEC|NUMERIC|NUMBER|MONEY|SMALLMONEY)(?:\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?$/i, 'REAL'],
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


/**
 * Rewrite CAST(x AS dialect-type) and CONVERT(...) into SQLite's four storage
 * classes or its date functions. Shared by the query translator and the schema
 * loader: CAST(N'1980-05-20' AS Date) in an SSMS export must become
 * DATE('1980-05-20'), not SQLite's numeric cast of the text (1980).
 */
export function translateCasts(input: string, note: (from: string, to: string) => void = () => {}): string {
  let sql = input;
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
  return sql;
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

  // SQL Server #temp tables, before # is read as a MySQL comment marker.
  if (/\bINTO\s+#{1,2}\w+/i.test(sql)) {
    fail('SELECT ... INTO #temp creates a temporary table in SQL Server. Trace the SELECT on its own here, or put the rows in a CTE: WITH temp AS (SELECT ...) SELECT ... FROM temp.');
  }
  if (/\b(?:FROM|JOIN|UPDATE|INTO)\s+#{1,2}\w+/i.test(sql)) {
    fail('#temp tables are SQL Server session objects and do not exist here. Use a CTE (WITH name AS (SELECT ...)) or add the table to the schema script.');
  }

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
  // A GO line pasted along with the query from SSMS is a batch separator, not SQL.
  if (rewrite(/\s*\n\s*GO\s*;?\s*$/i, '')) note('GO', '(batch separator, dropped)');
  if (rewrite(/(?<![\w"`\]])N(?=')/g, '')) note("N'text'", "'text'");
  if (rewrite(/\b(?:DATE|TIME|TIMESTAMP)\s+(?=')/gi, '')) note("DATE '2024-01-01'", "'2024-01-01'");
  // Date arithmetic with an unmistakable date operand: PostgreSQL and Oracle
  // subtract two dates to a day count and add days to a date, while SQLite
  // would subtract the numeric prefixes of the text ('2025-01-15' - '2025-01-01' = 0).
  // A bare column (hired_on + 30) cannot be told from a number here and is left alone.
  for (let guard = 0; guard < 100; guard++) {
    const masked = maskSql(sql);
    const isDateOperand = (text: string) =>
      /^'\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?'$/.test(text) ||
      /^(?:CURRENT_DATE|CURRENT_TIMESTAMP|SYSDATE)$/i.test(text) ||
      /^(?:NOW|CURDATE|GETDATE|SYSDATETIME|DATE|DATETIME)\s*\(/i.test(text);
    const isName = (text: string) => /^[A-Za-z_"`][\w."`]*$/.test(text) && !/^(?:INTERVAL|AND|OR|NOT|IS|IN|LIKE|BETWEEN|AS|FROM|WHERE)$/i.test(text);
    const isInteger = (text: string) => /^-?\d+$/.test(text);
    let done = true;
    for (const op of masked.matchAll(/[+-]/g)) {
      const at = op.index ?? 0;
      const leftStart = operandStart(masked, at);
      const rightEnd = operandEnd(masked, at + 1);
      if (leftStart === at || rightEnd === at + 1) continue;
      const left = sql.slice(leftStart, at).trim();
      const right = sql.slice(at + 1, rightEnd).trim();
      const sign = masked[at];
      const leftDate = isDateOperand(left);
      const rightDate = isDateOperand(right);
      let replacement: string | null = null;
      if (leftDate && isInteger(right)) {
        replacement = `${sign === '-' ? 'DATE_SUB' : 'DATE_ADD'}(${left}, ${right}, 'DAY')`;
        note(`date ${sign} n`, `${sign === '-' ? 'DATE_SUB' : 'DATE_ADD'}(date, n, 'DAY')`);
      } else if (sign === '+' && rightDate && isInteger(left)) {
        replacement = `DATE_ADD(${right}, ${left}, 'DAY')`;
        note('n + date', "DATE_ADD(date, n, 'DAY')");
      } else if (sign === '-' && ((leftDate && (rightDate || isName(right))) || (rightDate && isName(left)))) {
        replacement = `DATEDIFF('day', ${right}, ${left})`;
        note('date - date', "DATEDIFF('day', earlier, later) (SQLite would subtract the numbers inside the text)");
      }
      if (!replacement) continue;
      sql = `${sql.slice(0, leftStart)}${replacement}${sql.slice(rightEnd)}`;
      done = false;
      break;
    }
    if (done) break;
  }
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
  if (/^\s*(?:WITH\b[\s\S]*?\)\s*)?SELECT\b[\s\S]*?\bINTO\s+(?:"[^"]*"|#{0,2}\w+)\s+FROM\b/i.test(masked0)) {
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
  if (/\(\s*\+\s*\)/.test(masked0)) {
    fail('The (+) outer-join marker is Oracle-only. Write LEFT JOIN table2 ON table1.column = table2.column instead.');
  }
  if (/\bARRAY\s*\[/i.test(masked0) || /\bARRAY_AGG\s*\(/i.test(masked0)) {
    fail('Arrays are PostgreSQL-only. Compare with IN (a, b, c), and collect values with GROUP_CONCAT(column, \', \').');
  }
  if (/\bAGE\s*\(/i.test(masked0)) {
    fail("AGE() is PostgreSQL-only. Use DATEDIFF('day', earlier, later) for a day count, or JULIANDAY(later) - JULIANDAY(earlier).");
  }
  if (/\b(?:UPDATE|DELETE)\s+TOP\s*\(/i.test(masked0)) {
    fail('UPDATE / DELETE TOP (n) is SQL Server-only. Use WHERE key IN (SELECT key FROM table ORDER BY ... LIMIT n) to pick the rows.');
  }
  if (/^\s*UPDATE\s+(\w+)\s+SET\b[\s\S]*\bFROM\s+(?:"[^"]*"|\[[^\]]*\]|\w+)\s+(?:AS\s+)?\1\b/i.test(masked0)) {
    fail('UPDATE alias SET ... FROM table alias is SQL Server-only. Write UPDATE table SET column = value FROM other WHERE table.key = other.key.');
  }
  if (/^\s*UPDATE\b[\s\S]*?\bJOIN\b[\s\S]*?\bSET\b/i.test(masked0)) {
    fail('UPDATE ... JOIN ... SET is MySQL-only. Write UPDATE table SET ... WHERE key IN (SELECT key FROM other WHERE ...), or UPDATE table SET ... FROM other WHERE table.key = other.key.');
  }
  if (/^\s*DELETE\s+(?!FROM\b|TOP\b)(?:\w+\s*,\s*)*\w+(?:\s*\.\s*\*)?\s+FROM\b/i.test(masked0)) {
    fail('DELETE alias FROM ... JOIN is MySQL-only. Write DELETE FROM table WHERE key IN (SELECT key FROM other WHERE ...).');
  }
  if (/^\s*DELETE\s+FROM\s+\S+(?:\s+(?:AS\s+)?\w+)?\s+USING\b/i.test(masked0)) {
    fail('DELETE ... USING is PostgreSQL-only. Write DELETE FROM table WHERE key IN (SELECT key FROM other WHERE ...), or WHERE EXISTS (SELECT 1 FROM other WHERE ...).');
  }
  {
    const kind0 = statementKind(sql);
    if ((kind0 === 'update' || kind0 === 'delete') && topLevelMatches(masked0, /\b(?:ORDER\s+BY|LIMIT)\b/gi).length) {
      fail('ORDER BY / LIMIT on UPDATE and DELETE is MySQL-only (SQLite needs a special build). Use WHERE key IN (SELECT key FROM table ORDER BY ... LIMIT n) to choose the rows.');
    }
  }
  // SQL Server table hints change locking, not results.
  if (rewrite(/\s+WITH\s*\(\s*(?:NOLOCK|READUNCOMMITTED|READCOMMITTED|REPEATABLEREAD|SERIALIZABLE|ROWLOCK|PAGLOCK|TABLOCK|TABLOCKX|UPDLOCK|XLOCK|HOLDLOCK|NOWAIT|READPAST|FORCESEEK|FORCESCAN)(?:\s*,\s*\w+)*\s*\)/gi, '')) {
    note('WITH (NOLOCK)', '(no locking hints in a trace)');
  }
  // PostgreSQL regular-expression operators.
  if (/(?<=[\w)'"\]]\s{0,8})!?~\*(?=\s*['(\w])/.test(masked0)) {
    fail("The ~* operator (case-insensitive regular expression) is PostgreSQL-only. Use LOWER(column) REGEXP 'pattern' with a lower-case pattern.");
  }
  if (rewrite(/(?<=[\w)'"\]]\s{0,8})(!?)~(?=\s*['(\w])/g, (_, match) => (match[1] ? ' NOT REGEXP ' : ' REGEXP '))) {
    note("column ~ 'pattern'", "column REGEXP 'pattern'");
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
  {
    // PostgreSQL allows OFFSET on its own; SQLite needs a LIMIT in front of it.
    const masked = maskSql(sql);
    if (topLevelMatches(masked, /\bLIMIT\b/gi).length === 0 && topLevelMatches(masked, /\bOFFSET\s+\d+/gi).length) {
      rewrite(/\bOFFSET\s+(\d+)/i, (_, match) => `LIMIT -1 OFFSET ${match[1]}`);
      note('OFFSET n', 'LIMIT -1 OFFSET n (SQLite needs a LIMIT before OFFSET)');
    }
  }
  if (rewrite(/^(\s*(?:WITH\b[\s\S]*?\)\s*)?SELECT\s+)ALL\b\s*/i, (original, match) => original.slice(0, match[1].length))) note('SELECT ALL', 'SELECT');
  if (rewrite(/\bFROM\s+DUAL\b/gi, '')) note('FROM DUAL', '(no FROM needed)');
  if (rewrite(/\s+FOR\s+(?:UPDATE|SHARE)(?:\s+(?:NOWAIT|SKIP\s+LOCKED))?\s*$/i, '')) note('FOR UPDATE', '(no row locking in a trace)');
  if (rewrite(/\bMINUS\b/gi, 'EXCEPT')) note('MINUS', 'EXCEPT');
  if (rewrite(/^(\s*)TRUNCATE\s+(?:TABLE\s+)?/i, (_, match) => `${match[1]}DELETE FROM `)) {
    note('TRUNCATE TABLE t', 'DELETE FROM t');
    // PostgreSQL options after the table name.
    rewrite(/\s+(?:(?:RESTART|CONTINUE)\s+IDENTITY)(?:\s+(?:CASCADE|RESTRICT))?\s*;?\s*$|\s+(?:CASCADE|RESTRICT)\s*;?\s*$/i, '');
  }
  // SQL Server lets FROM be omitted: DELETE dbo.t WHERE ...
  if (rewrite(/^(\s*)DELETE\s+(?!FROM\b|TOP\b)(?=(?:"[^"]*"|`[^`]*`|\[[^\]]*\]|\w+)\s*(?:\.|\s+WHERE\b|\s*;?\s*$))/i, (_, match) => `${match[1]}DELETE FROM `)) {
    note('DELETE table', 'DELETE FROM table');
  }
  if (rewrite(/^(\s*)INSERT\s+IGNORE\s+INTO\b/i, (_, match) => `${match[1]}INSERT OR IGNORE INTO`)) note('INSERT IGNORE INTO', 'INSERT OR IGNORE INTO');
  if (rewrite(/^(\s*)REPLACE\s+INTO\b/i, (_, match) => `${match[1]}INSERT OR REPLACE INTO`)) note('REPLACE INTO', 'INSERT OR REPLACE INTO');
  if (rewrite(/^(\s*)INSERT\s+(?:LOW_PRIORITY|DELAYED|HIGH_PRIORITY)\s+INTO\b/i, (_, match) => `${match[1]}INSERT INTO`)) note('INSERT LOW_PRIORITY INTO', 'INSERT INTO');
  // SQL Server lets INTO be omitted: INSERT dbo.t (...) VALUES (...).
  if (rewrite(/^(\s*)INSERT\s+(?!INTO\b|OR\s|IGNORE\b|LOW_PRIORITY\b|DELAYED\b|HIGH_PRIORITY\b)/i, (_, match) => `${match[1]}INSERT INTO `)) note('INSERT table', 'INSERT INTO table');
  // A schema prefix on the changed table (public.book, dbo.Employee): SQLite has one schema.
  if (
    rewrite(
      /^(\s*(?:INSERT\s+(?:OR\s+\w+\s+|IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+)(?:"[^"]*"|`[^`]*`|\[[^\]]*\]|\w+)\s*\.\s*(?=[\w"`[])/i,
      (_, match) => match[1]
    )
  ) {
    note('schema.table', 'table (SQLite has a single schema)');
  }
  // PostgreSQL and Oracle alias the changed table without AS; SQLite needs the keyword.
  if (
    rewrite(
      /^(\s*UPDATE(?:\s+OR\s+\w+)?\s+(?:"[^"]*"|`[^`]*`|\w+))\s+(?!AS\b|SET\b)(\w+)(?=\s+SET\b)/i,
      (original, match) => `${original.slice(0, match[1].length)} AS ${match[2]}`
    ) ||
    rewrite(
      /^(\s*DELETE\s+FROM\s+(?:"[^"]*"|`[^`]*`|\w+))\s+(?!AS\b|WHERE\b|RETURNING\b|INDEXED\b|NOT\b)(\w+)(?=\s*(?:WHERE\b|RETURNING\b|;|$))/i,
      (original, match) => `${original.slice(0, match[1].length)} AS ${match[2]}`
    )
  ) {
    note('UPDATE table t SET ...', 'UPDATE table AS t SET ...');
  }
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
  if (rewrite(/^(\s*INSERT\b[\s\S]*?)\bVALUE\s*(?=\()/i, (original, match) => `${original.slice(0, match[1].length).trimEnd()} VALUES `)) note('VALUE (...)', 'VALUES (...)');
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

  // SQL Server joins strings with +; SQLite's + adds numbers. A + whose
  // operand is a string literal, a string function, a text cast, or a value
  // already joined with || becomes ||. (A chain resolves one + at a time.)
  {
    const STRING_FUNCTION = /^(?:UPPER|LOWER|UCASE|LCASE|LEFT|RIGHT|SUBSTRING|SUBSTR|MID|CONCAT|CONCAT_WS|TRIM|LTRIM|RTRIM|REPLACE|REVERSE|REPEAT|REPLICATE|LPAD|RPAD|INITCAP|FORMAT|STR|CHAR|NCHAR|CHR|SPACE|STUFF|TO_CHAR|DATE_FORMAT|DATENAME|MONTHNAME|DAYNAME|GROUP_CONCAT|STRING_AGG|QUOTENAME|TRANSLATE)\s*\(/i;
    const TEXT_CAST = /^(?:CAST\s*\([\s\S]*\bAS\s+N?(?:VAR)?CHAR(?:ACTER)?\b|CONVERT\s*\(\s*N?(?:VAR)?CHAR(?:ACTER)?\b|CAST\s*\([\s\S]*\bAS\s+(?:N?TEXT|STRING)\s*\))/i;
    const stringy = (text: string) => text.startsWith("'") || STRING_FUNCTION.test(text) || TEXT_CAST.test(text);
    for (let guard = 0; guard < 200; guard++) {
      const masked = maskSql(sql);
      let found: number | null = null;
      for (const plus of masked.matchAll(/\+/g)) {
        const at = plus.index ?? 0;
        const leftStart = operandStart(masked, at);
        const rightEnd = operandEnd(masked, at + 1);
        if (leftStart === at || rightEnd === at + 1) continue;
        const left = sql.slice(leftStart, at).trim();
        const right = sql.slice(at + 1, rightEnd).trim();
        const joinedBefore = /\|\|\s*$/.test(masked.slice(0, leftStart));
        const joinedAfter = /^\s*\|\|/.test(masked.slice(rightEnd));
        if (stringy(left) || stringy(right) || joinedBefore || joinedAfter) {
          found = at;
          break;
        }
      }
      if (found === null) break;
      sql = `${sql.slice(0, found)}||${sql.slice(found + 1)}`;
      note("'text' + column", "'text' || column (SQLite's + adds numbers)");
    }
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

  // a MOD b (MySQL / Oracle spelling of the remainder operator)
  for (;;) {
    const masked = maskSql(sql);
    const mod = masked.match(/\s+MOD\s+(?!\()/i);
    if (!mod || mod.index === undefined) break;
    const leftStart = operandStart(masked, mod.index);
    const rightEnd = operandEnd(masked, mod.index + mod[0].length);
    if (leftStart === mod.index || rightEnd === mod.index + mod[0].length) fail('a MOD b could not be translated; write a % b instead.');
    const left = sql.slice(leftStart, mod.index).trim();
    const right = sql.slice(mod.index + mod[0].length, rightEnd).trim();
    sql = `${sql.slice(0, leftStart)}MOD(${left}, ${right})${sql.slice(rightEnd)}`;
    note('a MOD b', "MOD(a, b) (SQLite's a % b works on whole numbers only)");
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
      WEEK: `WEEK(${expr}, 3)`, QUARTER: `QUARTER(${expr})`, EPOCH: `UNIXEPOCH(${expr})`, ISODOW: `(QT_DOW(${expr}) + 6) % 7 + 1`,
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
  sql = translateCasts(sql, note);
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
  sql = rewriteCalls(sql, ['WEEK'], (call) => (call.args.length === 1 ? `WEEK(${call.args[0]}, 0)` : null));
  sql = rewriteCalls(sql, ['GREATEST', 'LEAST'], (call) => {
    const replacement = call.name.toUpperCase() === 'GREATEST' ? 'MAX' : 'MIN';
    note(`${call.name.toUpperCase()}(a, b)`, `${replacement}(a, b) (SQLite's multi-argument MAX / MIN)`);
    return `${replacement}(${call.inner})`;
  });
  sql = rewriteCalls(sql, ['FORMAT'], (call) => {
    // MySQL FORMAT(x, decimals) vs SQLite FORMAT(printf-style, ...): a numeric second argument means MySQL.
    if (call.args.length === 2 && /^\d+$/.test(call.args[1].trim())) {
      note(`FORMAT(x, ${call.args[1].trim()})`, `PRINTF('%.${call.args[1].trim()}f', x)`);
      return `PRINTF('%.${call.args[1].trim()}f', ${call.args[0].trim()})`;
    }
    // SQL Server FORMAT(value, '.NET pattern'): a quoted second argument without printf
    // specifiers is a date pattern (yyyy-MM-dd) or a numeric pattern (N2, C, F0).
    const pattern = call.args.length >= 2 ? call.args[1].trim().match(/^'([^']*)'$/) : null;
    if (!pattern || pattern[1].includes('%')) return null;
    const numeric = pattern[1].match(/^([NFC])(\d*)$/i);
    if (numeric) {
      const decimals = numeric[2] === '' ? 2 : Number(numeric[2]);
      note(`FORMAT(x, '${pattern[1]}')`, `PRINTF('%.${decimals}f', x)`);
      return `PRINTF('%.${decimals}f', ${call.args[0].trim()})`;
    }
    const DOTNET: Record<string, string> = {
      yyyy: '%Y', yy: '%y', MMMM: '%M', MMM: '%b', MM: '%m', M: '%c', dddd: '%W', ddd: '%a', dd: '%d', d: '%e',
      HH: '%H', H: '%k', hh: '%h', h: '%l', mm: '%i', ss: '%s', tt: '%p', fff: '%f',
    };
    if (!/yyyy|MM|dd|HH|hh|mm|ss/.test(pattern[1])) return null;
    const converted = pattern[1].replace(/yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|ss|tt|fff|%/g, (token) => (token === '%' ? '%%' : DOTNET[token] ?? token));
    note(`FORMAT(d, '${pattern[1]}')`, `DATE_FORMAT(d, '${converted}')`);
    return `DATE_FORMAT(${call.args[0].trim()}, '${converted}')`;
  });
  // Spellings of functions SQLite or the compatibility library already has under another name.
  sql = rewriteCalls(sql, ['POW'], (call) => {
    note('POW(x, y)', 'POWER(x, y)');
    return `POWER(${call.inner})`;
  });
  sql = rewriteCalls(sql, ['TIME_FORMAT'], (call) => {
    note('TIME_FORMAT(t, fmt)', 'DATE_FORMAT(t, fmt)');
    return `DATE_FORMAT(${call.inner})`;
  });
  sql = rewriteCalls(sql, ['REPLICATE'], (call) => {
    note('REPLICATE(s, n)', 'REPEAT(s, n)');
    return `REPEAT(${call.inner})`;
  });
  sql = rewriteCalls(sql, ['DATE_PART'], (call) => {
    if (call.args.length !== 2) return null;
    note("DATE_PART('unit', d)", "DATEPART('unit', d)");
    return `DATEPART(${call.inner})`;
  });
  // Oracle DECODE(expr, search1, result1, ..., default) is a CASE expression.
  sql = rewriteCalls(sql, ['DECODE'], (call) => {
    if (call.args.length < 3) return null;
    const [subject, ...rest] = call.args.map((arg) => arg.trim());
    const fallback = rest.length % 2 === 1 ? rest.pop() : null;
    const branches: string[] = [];
    for (let i = 0; i < rest.length; i += 2) {
      const search = rest[i];
      branches.push(/^NULL$/i.test(search) ? `WHEN ${subject} IS NULL THEN ${rest[i + 1]}` : `WHEN ${subject} = ${search} THEN ${rest[i + 1]}`);
    }
    note('DECODE(x, a, r1, b, r2, default)', 'CASE WHEN x = a THEN r1 WHEN x = b THEN r2 ELSE default END');
    return `CASE ${branches.join(' ')}${fallback !== null && fallback !== undefined ? ` ELSE ${fallback}` : ''} END`;
  });

  // --- NULLS FIRST / LAST ---------------------------------------------------------------
  // Works at any depth: a subquery's ORDER BY or a window's OVER (ORDER BY ...).
  for (;;) {
    const masked = maskSql(sql);
    const nullsAt = masked.search(/\s+NULLS\s+(?:FIRST|LAST)\b/i);
    if (nullsAt === -1) break;
    const nulls = masked.slice(nullsAt).match(/^\s+NULLS\s+(FIRST|LAST)\b/i)!;
    // The expression this applies to starts after the nearest ORDER BY or
    // comma at the same parenthesis depth.
    let depth = 0;
    let enclosingStart = 0;
    for (let i = nullsAt - 1; i >= 0; i--) {
      const ch = masked[i];
      if (ch === ')') depth++;
      else if (ch === '(') {
        if (depth === 0) {
          enclosingStart = i + 1;
          break;
        }
        depth--;
      }
    }
    const segment = masked.slice(enclosingStart, nullsAt);
    const orderBy = topLevelMatches(segment, /\bORDER\s+BY\s+/gi).at(-1);
    if (!orderBy || orderBy.index === undefined) fail('NULLS FIRST / LAST is only understood inside ORDER BY.');
    const itemsStart = enclosingStart + orderBy.index + orderBy[0].length;
    const lastComma = topLevelMatches(masked.slice(itemsStart, nullsAt), /,/g).at(-1);
    const itemStart = lastComma && lastComma.index !== undefined ? itemsStart + lastComma.index + 1 : itemsStart;
    let item = sql.slice(itemStart, nullsAt).trim();
    const direction = item.match(/\s+(ASC|DESC)$/i);
    if (direction) item = item.slice(0, -direction[0].length).trim();
    const last = nulls[1].toUpperCase() === 'LAST';
    const replacement = `(${item} IS NULL) ${last ? 'ASC' : 'DESC'}, ${item}${direction ? ` ${direction[1].toUpperCase()}` : ''}`;
    const spacer = sql[itemStart - 1] === ',' ? ' ' : '';
    sql = `${sql.slice(0, itemStart)}${spacer}${replacement}${sql.slice(nullsAt + nulls[0].length)}`;
    note(`ORDER BY x NULLS ${last ? 'LAST' : 'FIRST'}`, `ORDER BY (x IS NULL) ${last ? 'ASC' : 'DESC'}, x`);
  }

  // --- Window functions: the parser insists on PARTITION BY, SQLite does not -------------
  // A constant partition is one partition, so this is purely a parsing aid; the
  // trace renders the specification back without it (tidyWindowSql).
  rewrite(/\bOVER\s*\(\s*(?!PARTITION\b)/gi, 'OVER (PARTITION BY NULL ');

  return { sql: wrapIntegerCompatCalls(sql).trim(), notes };
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

/**
 * Emulated functions that answer with a whole number. sql.js hands every
 * JavaScript number to SQLite as a REAL, so YEAR(d) || '-' || MONTH(d) would
 * read "2026.0-3.0"; the translator wraps these calls in CAST(... AS INTEGER)
 * and the trace hides the wrapper again (tidyWindowSql).
 */
const INTEGER_COMPAT_FUNCTIONS = [
  'YEAR', 'MONTH', 'DAY', 'DAYOFMONTH', 'HOUR', 'MINUTE', 'SECOND', 'DAYOFWEEK', 'WEEKDAY', 'QT_DOW', 'DAYOFYEAR',
  'WEEK', 'QUARTER', 'DATEPART', 'DATEDIFF', 'TIMESTAMPDIFF', 'LEN', 'CHAR_LENGTH', 'CHARACTER_LENGTH', 'LOCATE',
  'CHARINDEX', 'ASCII', 'CEILING', 'ISDATE',
];

function wrapIntegerCompatCalls(sql: string): string {
  return rewriteCalls(sql, INTEGER_COMPAT_FUNCTIONS, (call) => `CAST(${call.text} AS INTEGER)`);
}

const INTEGER_CAST_PATTERN = new RegExp(String.raw`\bCAST\s*\(\s*(${INTEGER_COMPAT_FUNCTIONS.join('|')})\s*\(`, 'i');

/** Render a window specification the way SQLite prints it, hiding the parser-only partition. */
export function tidyWindowSql(sql: string): string {
  return sql.replace(/OVER \(PARTITION BY NULL\s*\)/g, 'OVER ()').replace(/OVER \(PARTITION BY NULL\s+/g, 'OVER (');
}

/** Display form of translated SQL: the integer wrappers around emulated functions are hidden. */
export function tidyIntegerCasts(sql: string): string {
  let text = sql;
  for (;;) {
    const masked = maskSql(text);
    const match = masked.match(INTEGER_CAST_PATTERN);
    if (!match || match.index === undefined) break;
    const castOpen = masked.indexOf('(', match.index);
    const callOpen = match.index + match[0].length - 1;
    const callClose = matchingParen(masked, callOpen);
    const castClose = matchingParen(masked, castOpen);
    if (callClose === -1 || castClose === -1 || !/^\s*AS\s+INTEGER\s*$/i.test(masked.slice(callClose + 1, castClose))) break;
    const start = castOpen + 1 + (masked.slice(castOpen + 1).match(/^\s*/)?.[0].length ?? 0);
    text = text.slice(0, match.index) + text.slice(start, callClose + 1) + text.slice(castClose + 1);
  }
  return text;
}
