/**
 * SQL functions from MySQL / MariaDB (first), PostgreSQL, SQL Server and Oracle
 * that SQLite lacks, implemented in JavaScript and registered on every
 * connection. A learner can keep writing YEAR(created_date) or LEFT(name, 3)
 * and watch the trace; the note shown with the result names the SQLite
 * equivalent so the difference between engines is still taught.
 *
 * Dates are handled as text in SQLite's own formats (YYYY-MM-DD, optionally
 * followed by HH:MM[:SS[.fff]] with a space or T). Anything else yields NULL,
 * exactly as SQLite's STRFTIME does.
 */

/** Minimal connection surface: sql.js Database, also satisfied in tests. */
export interface FunctionHost {
  create_function(name: string, fn: (...args: never[]) => unknown): unknown;
}

type Value = number | string | null | Uint8Array;

interface Parts {
  y: number;
  m: number;
  d: number;
  H: number;
  M: number;
  S: number;
  ms: number;
  /** Whether the input carried a time component (preserved by arithmetic). */
  time: boolean;
}

const DATE_RE = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?\s*(?:Z|[+-]\d{2}:?\d{2})?\s*$/;

function parts(value: Value): Parts | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    // Julian day numbers are what SQLite's own date functions use internally.
    const date = new Date((value - 2440587.5) * 86_400_000);
    return Number.isNaN(date.getTime()) ? null : fromDate(date, true);
  }
  const match = DATE_RE.exec(String(value));
  if (!match) return null;
  const [, y, m, d, H, M, S, ms] = match;
  const out: Parts = {
    y: Number(y),
    m: Number(m),
    d: Number(d),
    H: Number(H ?? 0),
    M: Number(M ?? 0),
    S: Number(S ?? 0),
    ms: Number((ms ?? '0').padEnd(3, '0')),
    time: H !== undefined,
  };
  if (out.m < 1 || out.m > 12 || out.d < 1 || out.d > daysInMonth(out.y, out.m) || out.H > 23 || out.M > 59 || out.S > 59) {
    return null;
  }
  return out;
}

function fromDate(date: Date, time: boolean): Parts {
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
    H: date.getUTCHours(),
    M: date.getUTCMinutes(),
    S: date.getUTCSeconds(),
    ms: date.getUTCMilliseconds(),
    time,
  };
}

function toDate(p: Parts): Date {
  return new Date(Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S, p.ms));
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0');

function formatDate(p: Parts): string {
  return `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`;
}

function formatDateTime(p: Parts): string {
  return `${formatDate(p)} ${pad(p.H)}:${pad(p.M)}:${pad(p.S)}`;
}

/** Same shape as the input: a date stays a date, a datetime keeps its time. */
function formatLike(p: Parts): string {
  return p.time ? formatDateTime(p) : formatDate(p);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 0 = Sunday. */
function dayOfWeek(p: Parts): number {
  return toDate(p).getUTCDay();
}

function dayOfYear(p: Parts): number {
  const start = Date.UTC(p.y, 0, 1);
  return Math.floor((Date.UTC(p.y, p.m - 1, p.d) - start) / 86_400_000) + 1;
}

/** ISO-8601 week number (MySQL WEEK(d, 3), PostgreSQL EXTRACT(WEEK)). */
function isoWeek(p: Parts): number {
  const date = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

const UNIT_ALIASES: Record<string, string> = {
  year: 'year', years: 'year', yy: 'year', yyyy: 'year', y: 'year',
  quarter: 'quarter', quarters: 'quarter', qq: 'quarter', q: 'quarter',
  month: 'month', months: 'month', mm: 'month', mon: 'month',
  week: 'week', weeks: 'week', wk: 'week', ww: 'week', w: 'week',
  day: 'day', days: 'day', dd: 'day', d: 'day', dayofyear: 'day', dy: 'day',
  hour: 'hour', hours: 'hour', hh: 'hour', h: 'hour',
  minute: 'minute', minutes: 'minute', mi: 'minute', n: 'minute', min: 'minute',
  second: 'second', seconds: 'second', ss: 'second', s: 'second', sec: 'second',
};

function unitOf(value: Value): string | null {
  if (value === null || value === undefined) return null;
  return UNIT_ALIASES[String(value).trim().toLowerCase()] ?? null;
}

/** Add `n` units the way MySQL DATE_ADD does: month arithmetic clamps to the month's last day. */
function addInterval(p: Parts, n: number, unit: string): Parts {
  if (!Number.isFinite(n)) return p;
  const whole = Math.trunc(n);
  if (unit === 'year' || unit === 'quarter' || unit === 'month') {
    const months = unit === 'year' ? whole * 12 : unit === 'quarter' ? whole * 3 : whole;
    const total = p.y * 12 + (p.m - 1) + months;
    const y = Math.floor(total / 12);
    const m = total - y * 12 + 1;
    return { ...p, y, m, d: Math.min(p.d, daysInMonth(y, m)) };
  }
  const ms =
    unit === 'week' ? whole * 7 * 86_400_000
    : unit === 'day' ? whole * 86_400_000
    : unit === 'hour' ? n * 3_600_000
    : unit === 'minute' ? n * 60_000
    : n * 1000;
  const out = fromDate(new Date(toDate(p).getTime() + Math.round(ms)), p.time || unit === 'hour' || unit === 'minute' || unit === 'second');
  return out;
}

function diffUnits(a: Parts, b: Parts, unit: string): number {
  if (unit === 'year') return a.y - b.y;
  if (unit === 'quarter') return (a.y - b.y) * 4 + (Math.ceil(a.m / 3) - Math.ceil(b.m / 3));
  if (unit === 'month') return (a.y - b.y) * 12 + (a.m - b.m);
  const ms = toDate(a).getTime() - toDate(b).getTime();
  if (unit === 'week') return Math.trunc(ms / (7 * 86_400_000));
  if (unit === 'day') return Math.trunc((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86_400_000);
  if (unit === 'hour') return Math.trunc(ms / 3_600_000);
  if (unit === 'minute') return Math.trunc(ms / 60_000);
  return Math.trunc(ms / 1000);
}

/** MySQL DATE_FORMAT specifiers. Unknown letters pass through unchanged. */
function dateFormat(p: Parts, format: string): string {
  const h12 = p.H % 12 === 0 ? 12 : p.H % 12;
  const specifiers: Record<string, () => string> = {
    Y: () => pad(p.y, 4),
    y: () => pad(p.y % 100),
    m: () => pad(p.m),
    c: () => String(p.m),
    M: () => MONTHS[p.m - 1],
    b: () => MONTHS[p.m - 1].slice(0, 3),
    d: () => pad(p.d),
    e: () => String(p.d),
    D: () => `${p.d}${[11, 12, 13].includes(p.d % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][Math.min(p.d % 10, 4)] ?? 'th'}`,
    j: () => pad(dayOfYear(p), 3),
    W: () => DAYS[dayOfWeek(p)],
    a: () => DAYS[dayOfWeek(p)].slice(0, 3),
    w: () => String(dayOfWeek(p)),
    H: () => pad(p.H),
    k: () => String(p.H),
    h: () => pad(h12),
    I: () => pad(h12),
    l: () => String(h12),
    i: () => pad(p.M),
    s: () => pad(p.S),
    S: () => pad(p.S),
    f: () => pad(p.ms * 1000, 6),
    p: () => (p.H < 12 ? 'AM' : 'PM'),
    r: () => `${pad(h12)}:${pad(p.M)}:${pad(p.S)} ${p.H < 12 ? 'AM' : 'PM'}`,
    T: () => `${pad(p.H)}:${pad(p.M)}:${pad(p.S)}`,
    u: () => pad(isoWeek(p)),
    v: () => pad(isoWeek(p)),
    U: () => pad(Math.floor((dayOfYear(p) + 6 - dayOfWeek(p)) / 7)),
    '%': () => '%',
  };
  return format.replace(/%(.)/g, (whole, letter: string) => specifiers[letter]?.() ?? whole);
}

/** Oracle / PostgreSQL TO_CHAR date patterns (the common subset). */
function toChar(p: Parts, format: string): string {
  const h12 = p.H % 12 === 0 ? 12 : p.H % 12;
  const tokens: Array<[RegExp, () => string]> = [
    [/^YYYY/, () => pad(p.y, 4)],
    [/^YY/, () => pad(p.y % 100)],
    [/^MONTH/, () => MONTHS[p.m - 1].toUpperCase()],
    [/^Month/, () => MONTHS[p.m - 1]],
    [/^MON/, () => MONTHS[p.m - 1].slice(0, 3).toUpperCase()],
    [/^Mon/, () => MONTHS[p.m - 1].slice(0, 3)],
    [/^MM/, () => pad(p.m)],
    [/^DDD/, () => pad(dayOfYear(p), 3)],
    [/^DD/, () => pad(p.d)],
    [/^DAY/, () => DAYS[dayOfWeek(p)].toUpperCase()],
    [/^Day/, () => DAYS[dayOfWeek(p)]],
    [/^DY/, () => DAYS[dayOfWeek(p)].slice(0, 3).toUpperCase()],
    [/^Dy/, () => DAYS[dayOfWeek(p)].slice(0, 3)],
    [/^D/, () => String(dayOfWeek(p) + 1)],
    [/^HH24/, () => pad(p.H)],
    [/^HH12/, () => pad(h12)],
    [/^HH/, () => pad(h12)],
    [/^MI/, () => pad(p.M)],
    [/^SS/, () => pad(p.S)],
    [/^AM|^PM/, () => (p.H < 12 ? 'AM' : 'PM')],
    [/^Q/, () => String(Math.ceil(p.m / 3))],
    [/^WW/, () => pad(Math.ceil(dayOfYear(p) / 7))],
    [/^IW/, () => pad(isoWeek(p))],
  ];
  let out = '';
  let rest = format;
  while (rest.length) {
    const token = tokens.find(([pattern]) => pattern.test(rest));
    if (token) {
      const length = rest.match(token[0])![0].length;
      out += token[1]();
      rest = rest.slice(length);
    } else {
      out += rest[0];
      rest = rest.slice(1);
    }
  }
  return out;
}

/**
 * Parse text with a MySQL STR_TO_DATE / Oracle TO_DATE pattern into the
 * canonical SQLite spelling. Returns null when the text does not fit.
 */
function parseWithFormat(text: string, format: string): Parts | null {
  const fields: Record<string, number> = {};
  let i = 0;
  const tokens = /%(.)|YYYY|YY|MM|DD|HH24|HH12|HH|MI|SS|Mon|MON|Month|MONTH/g;
  let last = 0;
  const literalMatches = (literal: string) => {
    if (text.slice(i, i + literal.length).toLowerCase() !== literal.toLowerCase()) return false;
    i += literal.length;
    return true;
  };
  const readNumber = (max: number) => {
    const match = /^\d+/.exec(text.slice(i, i + max));
    if (!match) return null;
    i += match[0].length;
    return Number(match[0]);
  };
  const readMonthName = () => {
    const rest = text.slice(i).toLowerCase();
    const index = MONTHS.findIndex((name) => rest.startsWith(name.toLowerCase()) || rest.startsWith(name.slice(0, 3).toLowerCase()));
    if (index === -1) return null;
    i += rest.startsWith(MONTHS[index].toLowerCase()) ? MONTHS[index].length : 3;
    return index + 1;
  };
  for (const match of format.matchAll(tokens)) {
    if (!literalMatches(format.slice(last, match.index))) return null;
    last = (match.index ?? 0) + match[0].length;
    const token = match[1] ? `%${match[1]}` : match[0].toUpperCase();
    let value: number | null;
    switch (token) {
      case '%Y': case 'YYYY': value = readNumber(4); fields.y = value ?? NaN; break;
      case '%y': case 'YY': value = readNumber(2); fields.y = value === null ? NaN : value + (value < 70 ? 2000 : 1900); break;
      case '%m': case '%c': case 'MM': value = readNumber(2); fields.m = value ?? NaN; break;
      case '%d': case '%e': case 'DD': value = readNumber(2); fields.d = value ?? NaN; break;
      case '%H': case '%k': case 'HH24': case 'HH': case 'HH12': value = readNumber(2); fields.H = value ?? NaN; break;
      case '%h': case '%I': case '%l': value = readNumber(2); fields.H = value ?? NaN; break;
      case '%i': case 'MI': value = readNumber(2); fields.M = value ?? NaN; break;
      case '%s': case '%S': case 'SS': value = readNumber(2); fields.S = value ?? NaN; break;
      case '%M': case '%b': case 'MON': case 'MONTH': value = readMonthName(); fields.m = value ?? NaN; break;
      case '%p': {
        const marker = text.slice(i, i + 2).toUpperCase();
        if (marker !== 'AM' && marker !== 'PM') return null;
        i += 2;
        if (marker === 'PM' && (fields.H ?? 0) < 12) fields.H = (fields.H ?? 0) + 12;
        if (marker === 'AM' && fields.H === 12) fields.H = 0;
        break;
      }
      case '%%': if (!literalMatches('%')) return null; break;
      default: return null;
    }
    if (Object.values(fields).some((n) => Number.isNaN(n))) return null;
  }
  if (!literalMatches(format.slice(last)) || i < text.trim().length) return null;
  if (fields.y === undefined || fields.m === undefined || fields.d === undefined) return null;
  const hasTime = fields.H !== undefined || fields.M !== undefined || fields.S !== undefined;
  const out: Parts = { y: fields.y, m: fields.m, d: fields.d, H: fields.H ?? 0, M: fields.M ?? 0, S: fields.S ?? 0, ms: 0, time: hasTime };
  return parts(formatDateTime(out)) ? out : null;
}

function text(value: Value): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Uint8Array ? new TextDecoder().decode(value) : String(value);
}

function num(value: Value): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(n) ? null : n;
}

function nowParts(): Parts {
  return fromDate(new Date(), true);
}

/** Describe each emulated function for the note shown beside a trace. */
export const COMPAT_FUNCTION_NOTES: Record<string, string> = {
  NOW: 'NOW() is MySQL; SQLite spells it CURRENT_TIMESTAMP or DATETIME(\'now\').',
  CURDATE: 'CURDATE() is MySQL; SQLite spells it CURRENT_DATE or DATE(\'now\').',
  CURTIME: 'CURTIME() is MySQL; SQLite spells it CURRENT_TIME.',
  GETDATE: 'GETDATE() is SQL Server; SQLite spells it CURRENT_TIMESTAMP.',
  SYSDATETIME: 'SYSDATETIME() is SQL Server; SQLite spells it CURRENT_TIMESTAMP.',
  UTC_TIMESTAMP: 'UTC_TIMESTAMP() is MySQL; SQLite spells it CURRENT_TIMESTAMP.',
  YEAR: 'YEAR(d) is MySQL; SQLite reads the year with STRFTIME(\'%Y\', d).',
  MONTH: 'MONTH(d) is MySQL; SQLite reads the month with STRFTIME(\'%m\', d).',
  DAY: 'DAY(d) is MySQL; SQLite reads the day with STRFTIME(\'%d\', d).',
  DAYOFMONTH: 'DAYOFMONTH(d) is MySQL; SQLite reads the day with STRFTIME(\'%d\', d).',
  HOUR: 'HOUR(d) is MySQL; SQLite uses STRFTIME(\'%H\', d).',
  MINUTE: 'MINUTE(d) is MySQL; SQLite uses STRFTIME(\'%M\', d).',
  SECOND: 'SECOND(d) is MySQL; SQLite uses STRFTIME(\'%S\', d).',
  DAYOFWEEK: 'DAYOFWEEK(d) is MySQL (1 = Sunday); SQLite uses STRFTIME(\'%w\', d) + 1.',
  WEEKDAY: 'WEEKDAY(d) is MySQL (0 = Monday); SQLite uses (STRFTIME(\'%w\', d) + 6) % 7.',
  DAYOFYEAR: 'DAYOFYEAR(d) is MySQL; SQLite uses STRFTIME(\'%j\', d).',
  WEEK: 'WEEK(d) is MySQL; SQLite uses STRFTIME(\'%W\', d).',
  QUARTER: 'QUARTER(d) is MySQL; SQLite has no direct equivalent ((month + 2) / 3).',
  DAYNAME: 'DAYNAME(d) is MySQL; SQLite has no built-in day names.',
  MONTHNAME: 'MONTHNAME(d) is MySQL; SQLite has no built-in month names.',
  LAST_DAY: 'LAST_DAY(d) is MySQL / Oracle; SQLite uses DATE(d, \'start of month\', \'+1 month\', \'-1 day\').',
  DATE_FORMAT: 'DATE_FORMAT(d, fmt) is MySQL; SQLite formats dates with STRFTIME(fmt, d).',
  STR_TO_DATE: 'STR_TO_DATE(text, fmt) is MySQL; SQLite has no parsing function, so store ISO dates.',
  TO_CHAR: 'TO_CHAR(d, fmt) is Oracle / PostgreSQL; SQLite formats dates with STRFTIME.',
  TO_DATE: 'TO_DATE(text, fmt) is Oracle / PostgreSQL; SQLite has no parsing function, so store ISO dates.',
  DATEDIFF: 'DATEDIFF is MySQL (days) / SQL Server (unit first); SQLite subtracts JULIANDAY values.',
  TIMESTAMPDIFF: 'TIMESTAMPDIFF(unit, a, b) is MySQL; SQLite subtracts JULIANDAY or UNIXEPOCH values.',
  DATE_ADD: 'DATE_ADD(d, INTERVAL n unit) is MySQL; SQLite spells it DATE(d, \'+n unit\').',
  ADDDATE: 'ADDDATE is MySQL; SQLite spells it DATE(d, \'+n days\').',
  DATE_SUB: 'DATE_SUB(d, INTERVAL n unit) is MySQL; SQLite spells it DATE(d, \'-n unit\').',
  SUBDATE: 'SUBDATE is MySQL; SQLite spells it DATE(d, \'-n days\').',
  DATEADD: 'DATEADD(unit, n, d) is SQL Server; SQLite spells it DATE(d, \'+n unit\').',
  TIMESTAMPADD: 'TIMESTAMPADD(unit, n, d) is MySQL; SQLite spells it DATETIME(d, \'+n unit\').',
  DATEPART: 'DATEPART(unit, d) is SQL Server; SQLite uses STRFTIME.',
  DATENAME: 'DATENAME(unit, d) is SQL Server; SQLite has no built-in names.',
  DATE_TRUNC: 'DATE_TRUNC(unit, d) is PostgreSQL; SQLite uses DATE(d, \'start of month\') and friends.',
  QT_DOW: 'EXTRACT(DOW FROM d) is PostgreSQL; SQLite uses STRFTIME(\'%w\', d).',
  LEN: 'LEN(s) is SQL Server; SQLite spells it LENGTH(s).',
  LCASE: 'LCASE(s) is MySQL; SQLite spells it LOWER(s).',
  UCASE: 'UCASE(s) is MySQL; SQLite spells it UPPER(s).',
  LEFT: 'LEFT(s, n) is MySQL / SQL Server; SQLite spells it SUBSTR(s, 1, n).',
  RIGHT: 'RIGHT(s, n) is MySQL / SQL Server; SQLite spells it SUBSTR(s, -n).',
  MID: 'MID(s, start, len) is MySQL; SQLite spells it SUBSTR(s, start, len).',
  LOCATE: 'LOCATE(needle, s) is MySQL; SQLite spells it INSTR(s, needle) with the arguments swapped.',
  CHARINDEX: 'CHARINDEX(needle, s) is SQL Server; SQLite spells it INSTR(s, needle).',
  LPAD: 'LPAD is MySQL / Oracle; SQLite has no padding function (use PRINTF or SUBSTR).',
  RPAD: 'RPAD is MySQL / Oracle; SQLite has no padding function.',
  REPEAT: 'REPEAT(s, n) is MySQL; SQLite has no direct equivalent.',
  SPACE: 'SPACE(n) is MySQL / SQL Server; SQLite has no direct equivalent.',
  REVERSE: 'REVERSE(s) is MySQL / SQL Server; SQLite has no direct equivalent.',
  SUBSTRING_INDEX: 'SUBSTRING_INDEX is MySQL; SQLite has no direct equivalent.',
  CHAR_LENGTH: 'CHAR_LENGTH(s) is MySQL / PostgreSQL; SQLite spells it LENGTH(s).',
  CHARACTER_LENGTH: 'CHARACTER_LENGTH(s) is standard SQL; SQLite spells it LENGTH(s).',
  ASCII: 'ASCII(s) is MySQL / SQL Server; SQLite spells it UNICODE(s).',
  CHR: 'CHR(n) is Oracle / PostgreSQL; SQLite spells it CHAR(n).',
  INITCAP: 'INITCAP(s) is Oracle / PostgreSQL; SQLite has no direct equivalent.',
  REGEXP_LIKE: 'REGEXP_LIKE is Oracle / MySQL 8; SQLite spells it s REGEXP pattern.',
  REGEXP: 'REGEXP is not built into SQLite; QueryTrace supplies a JavaScript implementation.',
  MOD: 'MOD(a, b) is MySQL / Oracle; SQLite spells it a % b.',
  CEILING: 'CEILING(x) is MySQL / SQL Server; SQLite spells it CEIL(x).',
  TRUNCATE: 'TRUNCATE(x, d) is MySQL; SQLite has no direct equivalent (use CAST or ROUND).',
  TRUNC: 'TRUNC(x) is Oracle / PostgreSQL; SQLite spells it CAST(x AS INTEGER).',
  RAND: 'RAND() is MySQL; SQLite spells it (RANDOM() + 9223372036854775808) / 18446744073709551616.',
  NVL: 'NVL(a, b) is Oracle; SQLite spells it IFNULL(a, b).',
  NVL2: 'NVL2(a, b, c) is Oracle; SQLite spells it IIF(a IS NOT NULL, b, c).',
  LN: 'LN(x) is MySQL / PostgreSQL; SQLite spells it LOG(x).',
  ISDATE: 'ISDATE(x) is SQL Server; SQLite has no direct equivalent.',
  FORMAT_NUMBER: 'FORMAT(x, d) is MySQL; SQLite spells it PRINTF(\'%.2f\', x) for two decimals.',
};

/** Register every compatibility function on a connection. Idempotent per connection. */
export function registerCompatFunctions(db: FunctionHost): void {
  const define = (name: string, fn: (...args: Value[]) => unknown) => {
    db.create_function(name, fn as (...args: never[]) => unknown);
  };
  const dateFn = (name: string, fn: (p: Parts) => unknown) =>
    define(name, (value: Value) => {
      const p = parts(value);
      return p === null ? null : fn(p);
    });

  // --- Current date and time -------------------------------------------------
  define('NOW', () => formatDateTime(nowParts()));
  define('GETDATE', () => formatDateTime(nowParts()));
  define('SYSDATETIME', () => formatDateTime(nowParts()));
  define('UTC_TIMESTAMP', () => formatDateTime(nowParts()));
  define('CURDATE', () => formatDate(nowParts()));
  define('CURTIME', () => {
    const p = nowParts();
    return `${pad(p.H)}:${pad(p.M)}:${pad(p.S)}`;
  });

  // --- Date parts --------------------------------------------------------------
  dateFn('YEAR', (p) => p.y);
  dateFn('MONTH', (p) => p.m);
  dateFn('DAY', (p) => p.d);
  dateFn('DAYOFMONTH', (p) => p.d);
  dateFn('HOUR', (p) => p.H);
  dateFn('MINUTE', (p) => p.M);
  dateFn('SECOND', (p) => p.S);
  dateFn('DAYOFWEEK', (p) => dayOfWeek(p) + 1);
  dateFn('WEEKDAY', (p) => (dayOfWeek(p) + 6) % 7);
  dateFn('QT_DOW', (p) => dayOfWeek(p));
  dateFn('DAYOFYEAR', (p) => dayOfYear(p));
  dateFn('WEEK', (p) => isoWeek(p));
  dateFn('QUARTER', (p) => Math.ceil(p.m / 3));
  dateFn('DAYNAME', (p) => DAYS[dayOfWeek(p)]);
  dateFn('MONTHNAME', (p) => MONTHS[p.m - 1]);
  dateFn('LAST_DAY', (p) => formatDate({ ...p, d: daysInMonth(p.y, p.m) }));
  define('DATEPART', (unit: Value, value: Value) => {
    const p = parts(value);
    const u = unitOf(unit);
    if (p === null || u === null) return null;
    switch (u) {
      case 'year': return p.y;
      case 'quarter': return Math.ceil(p.m / 3);
      case 'month': return p.m;
      case 'week': return isoWeek(p);
      case 'day': return p.d;
      case 'hour': return p.H;
      case 'minute': return p.M;
      default: return p.S;
    }
  });
  define('DATENAME', (unit: Value, value: Value) => {
    const p = parts(value);
    const u = unitOf(unit) ?? String(unit).toLowerCase();
    if (p === null) return null;
    if (u === 'month') return MONTHS[p.m - 1];
    if (u === 'weekday' || u === 'dw') return DAYS[dayOfWeek(p)];
    return String(p.y);
  });

  // --- Formatting and parsing --------------------------------------------------
  define('DATE_FORMAT', (value: Value, format: Value) => {
    const p = parts(value);
    const f = text(format);
    return p === null || f === null ? null : dateFormat(p, f);
  });
  define('STR_TO_DATE', (value: Value, format: Value) => {
    const s = text(value);
    const f = text(format);
    if (s === null || f === null) return null;
    const p = parseWithFormat(s, f);
    return p === null ? null : formatLike(p);
  });
  define('TO_CHAR', (value: Value, format: Value) => {
    const f = text(format);
    if (value === null) return null;
    const p = parts(value);
    if (p === null || f === null) return text(value);
    return toChar(p, f);
  });
  define('TO_DATE', (value: Value, format: Value) => {
    const s = text(value);
    const f = text(format);
    if (s === null) return null;
    if (f === null) return parts(s) ? formatLike(parts(s)!) : null;
    const p = parseWithFormat(s, f);
    return p === null ? null : formatLike(p);
  });
  define('DATE_TRUNC', (unit: Value, value: Value) => {
    const p = parts(value);
    const u = unitOf(unit);
    if (p === null || u === null) return null;
    const t: Parts = { ...p, time: true };
    switch (u) {
      case 'year': return formatDateTime({ ...t, m: 1, d: 1, H: 0, M: 0, S: 0 });
      case 'quarter': return formatDateTime({ ...t, m: Math.floor((p.m - 1) / 3) * 3 + 1, d: 1, H: 0, M: 0, S: 0 });
      case 'month': return formatDateTime({ ...t, d: 1, H: 0, M: 0, S: 0 });
      case 'week': {
        const shift = (dayOfWeek(p) + 6) % 7;
        return formatDateTime({ ...addInterval({ ...t, H: 0, M: 0, S: 0 }, -shift, 'day'), time: true });
      }
      case 'day': return formatDateTime({ ...t, H: 0, M: 0, S: 0 });
      case 'hour': return formatDateTime({ ...t, M: 0, S: 0 });
      case 'minute': return formatDateTime({ ...t, S: 0 });
      default: return formatDateTime(t);
    }
  });

  // --- Date arithmetic ----------------------------------------------------------
  const add = (sign: 1 | -1) => (value: Value, n: Value, unit: Value) => {
    const p = parts(value);
    const count = num(n);
    const u = unitOf(unit);
    if (p === null || count === null || u === null) return null;
    return formatLike(addInterval(p, sign * count, u));
  };
  // sql.js registers one arity per name, so the translator pads the MySQL
  // two-argument forms (ADDDATE(d, 3) = 3 days) and DATEDIFF(a, b) to these shapes.
  define('DATE_ADD', add(1));
  define('ADDDATE', add(1));
  define('DATE_SUB', add(-1));
  define('SUBDATE', add(-1));
  define('DATEADD', (unit: Value, n: Value, value: Value) => add(1)(value, n, unit));
  define('TIMESTAMPADD', (unit: Value, n: Value, value: Value) => add(1)(value, n, unit));
  define('DATEDIFF', (unit: Value, a: Value, b: Value) => {
    // SQL Server: DATEDIFF(unit, start, end) = end - start.
    const pa = parts(a);
    const pb = parts(b);
    const u = unitOf(unit);
    return pa === null || pb === null || u === null ? null : diffUnits(pb, pa, u);
  });
  define('TIMESTAMPDIFF', (unit: Value, a: Value, b: Value) => {
    const pa = parts(a);
    const pb = parts(b);
    const u = unitOf(unit);
    return pa === null || pb === null || u === null ? null : diffUnits(pb, pa, u);
  });

  // --- Strings -------------------------------------------------------------------
  const str = (name: string, fn: (s: string, ...rest: Value[]) => unknown) =>
    define(name, (value: Value, ...rest: Value[]) => {
      const s = text(value);
      return s === null ? null : fn(s, ...rest);
    });
  define('LEN', (value: Value) => {
    const s = text(value);
    return s === null ? null : s.replace(/\s+$/, '').length;
  });
  define('CHAR_LENGTH', (value: Value) => text(value)?.length ?? null);
  define('CHARACTER_LENGTH', (value: Value) => text(value)?.length ?? null);
  define('LCASE', (value: Value) => text(value)?.toLowerCase() ?? null);
  define('UCASE', (value: Value) => text(value)?.toUpperCase() ?? null);
  define('LEFT', (value: Value, n: Value) => {
    const s = text(value);
    const count = num(n);
    return s === null || count === null ? null : s.slice(0, Math.max(0, Math.trunc(count)));
  });
  define('RIGHT', (value: Value, n: Value) => {
    const s = text(value);
    const count = num(n);
    if (s === null || count === null) return null;
    const k = Math.max(0, Math.trunc(count));
    return k === 0 ? '' : s.slice(-k);
  });
  define('MID', (value: Value, start: Value, length: Value) => {
    const s = text(value);
    const from = num(start);
    const len = num(length);
    if (s === null || from === null || len === null) return null;
    const begin = from > 0 ? from - 1 : from < 0 ? Math.max(0, s.length + from) : 0;
    return s.slice(begin, begin + Math.max(0, len));
  });
  define('LOCATE', (needle: Value, haystack: Value, position: Value) => {
    const n = text(needle);
    const h = text(haystack);
    const from = num(position);
    if (n === null || h === null || from === null) return null;
    const index = h.indexOf(n, Math.max(0, from - 1));
    return index === -1 ? 0 : index + 1;
  });
  define('CHARINDEX', (needle: Value, haystack: Value) => {
    const n = text(needle);
    const h = text(haystack);
    return n === null || h === null ? null : h.toLowerCase().indexOf(n.toLowerCase()) + 1;
  });
  const padWith = (side: 'left' | 'right') => (value: Value, length: Value, fill: Value) => {
    const s = text(value);
    const len = num(length);
    const f = text(fill) ?? ' ';
    if (s === null || len === null) return null;
    const target = Math.max(0, Math.trunc(len));
    if (s.length >= target) return s.slice(0, target);
    if (!f.length) return s;
    const filler = f.repeat(Math.ceil((target - s.length) / f.length)).slice(0, target - s.length);
    return side === 'left' ? filler + s : s + filler;
  };
  define('LPAD', padWith('left'));
  define('RPAD', padWith('right'));
  define('REPEAT', (value: Value, n: Value) => {
    const s = text(value);
    const count = num(n);
    return s === null || count === null ? null : s.repeat(Math.min(10_000, Math.max(0, Math.trunc(count))));
  });
  define('SPACE', (n: Value) => {
    const count = num(n);
    return count === null ? null : ' '.repeat(Math.min(10_000, Math.max(0, Math.trunc(count))));
  });
  str('REVERSE', (s) => Array.from(s).reverse().join(''));
  define('SUBSTRING_INDEX', (value: Value, delimiter: Value, count: Value) => {
    const s = text(value);
    const d = text(delimiter);
    const n = num(count);
    if (s === null || d === null || n === null) return null;
    if (!d.length || n === 0) return '';
    const pieces = s.split(d);
    return n > 0 ? pieces.slice(0, n).join(d) : pieces.slice(Math.max(0, pieces.length + n)).join(d);
  });
  str('ASCII', (s) => (s.length ? s.codePointAt(0) ?? 0 : 0));
  define('CHR', (n: Value) => {
    const code = num(n);
    return code === null ? null : String.fromCodePoint(Math.max(0, Math.min(0x10ffff, Math.trunc(code))));
  });
  str('INITCAP', (s) => s.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase()));
  // Patterns are bounded in size and may not nest quantifiers, so a typo cannot
  // send the worker into catastrophic backtracking.
  const NESTED_QUANTIFIER = /\([^()]*[*+}][^()]*\)\s*[*+{]/;
  const regexpMatch = (pattern: Value, value: Value) => {
    const p = text(pattern);
    const v = text(value);
    if (p === null || v === null) return null;
    if (p.length > 200 || v.length > 10_000 || NESTED_QUANTIFIER.test(p)) return 0;
    try {
      return new RegExp(p).test(v) ? 1 : 0;
    } catch {
      return 0;
    }
  };
  define('REGEXP', regexpMatch);
  define('REGEXP_LIKE', (value: Value, pattern: Value) => regexpMatch(pattern, value));

  // --- Numbers -------------------------------------------------------------------
  define('MOD', (a: Value, b: Value) => {
    const x = num(a);
    const y = num(b);
    return x === null || y === null || y === 0 ? null : x % y;
  });
  define('CEILING', (a: Value) => {
    const x = num(a);
    return x === null ? null : Math.ceil(x);
  });
  define('TRUNCATE', (a: Value, digits: Value) => {
    const x = num(a);
    const d = num(digits);
    if (x === null || d === null) return null;
    const factor = 10 ** Math.trunc(d);
    return Math.trunc(x * factor) / factor;
  });
  define('TRUNC', (a: Value, digits: Value) => {
    const x = num(a);
    const d = num(digits);
    if (x === null || d === null) return null;
    const factor = 10 ** Math.trunc(d);
    return Math.trunc(x * factor) / factor;
  });
  define('RAND', () => Math.random());
  define('LN', (a: Value) => {
    const x = num(a);
    return x === null || x <= 0 ? null : Math.log(x);
  });
  // --- NULL handling --------------------------------------------------------------
  define('NVL', (a: Value, b: Value) => (a === null || a === undefined ? b : a));
  define('NVL2', (a: Value, b: Value, c: Value) => (a === null || a === undefined ? c : b));
  define('ISDATE', (value: Value) => (parts(value) === null ? 0 : 1));
}

/** Names registered above, for note generation after parsing. */
export const COMPAT_FUNCTION_NAMES = new Set(Object.keys(COMPAT_FUNCTION_NOTES).filter((name) => name !== 'FORMAT_NUMBER'));
