/**
 * Parser-only encodings for SQLite syntax the bundled node-sql-parser grammar
 * cannot read: aggregate `FILTER (WHERE ...)` and explicit window frames.
 * Like `orderedAggregates.ts`, each construct becomes an ordinary function call
 * while the AST is analysed and serialized, and the native syntax is restored
 * before any generated SQL reaches SQLite. The markers never execute.
 */
import { DialectError, tidyWindowSql } from './dialect';
import { ORDERED_GROUP_CONCAT_MARKER, prepareOrderedAggregates, restoreOrderedAggregates } from './orderedAggregates';
import { maskSql, matchingParen, rewriteCalls, rewriteSql, splitTopLevel, topLevelMatches } from './sqlText';

export const FILTER_MARKER = 'QT_FILTER';
export const FRAME_MARKER = 'QT_FRAME';
export const RESERVED_MARKERS = [FILTER_MARKER, FRAME_MARKER, ORDERED_GROUP_CONCAT_MARKER];

/**
 * The grammar reads backslash escapes inside 'single-quoted' literals ('a\nb'
 * becomes a newline; 'a\'' fails to parse), while SQLite keeps the backslash.
 * A private-use character stands in for every backslash while the AST exists.
 * The learner's own text may contain that character, so it (and the escape
 * prefix itself) is first written as a two-character escape and restored exactly.
 */
const BACKSLASH_STAND_IN = '';
const STAND_IN_ESCAPE = '';

function maskBackslashes(sql: string): string {
  if (!/[\\]/.test(sql)) return sql;
  const escaped = sql.replace(/[]/g, (ch) => STAND_IN_ESCAPE + (ch === BACKSLASH_STAND_IN ? '0' : '1'));
  // The grammar unescapes "double-quoted" names the same way, so a column
  // called "a\b" would come back as a control character; mask every quoted token.
  return rewriteSql(escaped, {}, (text) => text, (text) => (text[0] === '[' ? text : text.replace(/\\/g, BACKSLASH_STAND_IN)));
}

function unmaskBackslashes(sql: string): string {
  if (!/[]/.test(sql)) return sql;
  return sql.replace(/([01])|/g, (_match, literal?: string) =>
    literal === undefined ? '\\' : literal === '0' ? BACKSLASH_STAND_IN : STAND_IN_ESCAPE);
}

/** Aggregates whose FILTER clause has verified semantics under SQLite. */
const FILTERABLE_AGGREGATES = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'TOTAL', 'GROUP_CONCAT', ORDERED_GROUP_CONCAT_MARKER]);

const FRAME_BOUND = String.raw`(?:UNBOUNDED\s+PRECEDING|UNBOUNDED\s+FOLLOWING|CURRENT\s+ROW|\d+\s+PRECEDING|\d+\s+FOLLOWING)`;
const FRAME_SPEC = new RegExp(String.raw`^ROWS\s+(?:BETWEEN\s+(${FRAME_BOUND})\s+AND\s+(${FRAME_BOUND})|(${FRAME_BOUND}))\s*$`, 'i');

export interface EncodedQuery {
  sql: string;
  /** True when a FILTER clause was encoded. */
  filter: boolean;
  /** True when a window frame was encoded. */
  frame: boolean;
}

/** True when the user's text names one of the internal markers. */
export function usesReservedMarker(sql: string): string | null {
  const match = maskSql(sql).match(new RegExp(String.raw`\b(${RESERVED_MARKERS.join('|')})\b`, 'i'));
  return match ? match[1].toUpperCase() : null;
}

function boundRank(bound: string): number {
  const text = bound.toUpperCase().replace(/\s+/g, ' ');
  if (text === 'UNBOUNDED PRECEDING') return Number.NEGATIVE_INFINITY;
  if (text === 'UNBOUNDED FOLLOWING') return Number.POSITIVE_INFINITY;
  if (text === 'CURRENT ROW') return 0;
  const n = Number(text.split(' ')[0]);
  return text.endsWith('PRECEDING') ? -n : n;
}

/** Validate a frame clause against the supported subset and normalise its spelling. */
function normalizeFrame(frame: string): string {
  const compact = frame.trim().replace(/\s+/g, ' ');
  const keyword = compact.match(/^(ROWS|RANGE|GROUPS)\b/i)?.[1].toUpperCase();
  if (keyword && keyword !== 'ROWS') {
    throw new DialectError(`${keyword} frames are not supported yet; only ROWS frames are. Write ROWS BETWEEN ... AND ... to count rows, or omit the frame.`);
  }
  if (/\bEXCLUDE\b/i.test(compact)) {
    throw new DialectError('EXCLUDE options on a window frame are not supported. Omit the EXCLUDE clause.');
  }
  const match = compact.match(FRAME_SPEC);
  if (!match) {
    throw new DialectError(`The window frame "${compact}" is not supported. Use ROWS BETWEEN <start> AND <end> with UNBOUNDED PRECEDING, n PRECEDING, CURRENT ROW, n FOLLOWING or UNBOUNDED FOLLOWING.`);
  }
  const start = match[1] ?? match[3];
  const end = match[2] ?? 'CURRENT ROW';
  if (boundRank(start) > boundRank(end)) {
    throw new DialectError(`The window frame "${compact}" ends before it starts. The start bound must not come after the end bound.`);
  }
  if (/^UNBOUNDED\s+FOLLOWING$/i.test(start) || /^UNBOUNDED\s+PRECEDING$/i.test(end)) {
    throw new DialectError(`The window frame "${compact}" is not valid: UNBOUNDED FOLLOWING cannot start a frame and UNBOUNDED PRECEDING cannot end one.`);
  }
  return `ROWS BETWEEN ${start.toUpperCase().replace(/\s+/g, ' ')} AND ${end.toUpperCase().replace(/\s+/g, ' ')}`;
}

/**
 * `agg(args) FILTER (WHERE cond)` -> `QT_FILTER(agg(args), cond)`.
 * The aggregate keeps its own node so grouping analysis still sees it.
 */
function encodeFilters(sql: string): { sql: string; found: boolean } {
  let text = sql;
  let found = false;
  for (let guard = 0; guard < 500; guard++) {
    const masked = maskSql(text);
    const filter = masked.match(/\)\s*FILTER\s*\(\s*WHERE\b/i);
    if (!filter || filter.index === undefined) break;
    const close = filter.index;
    // Walk back to the aggregate call this FILTER belongs to.
    let depth = 0;
    let open = -1;
    for (let i = close; i >= 0; i--) {
      if (masked[i] === ')') depth++;
      else if (masked[i] === '(' && --depth === 0) {
        open = i;
        break;
      }
    }
    const head = open === -1 ? null : masked.slice(0, open).match(/([A-Za-z_]\w*)\s*$/);
    if (!head || head.index === undefined) {
      throw new DialectError('FILTER (WHERE ...) must directly follow an aggregate call, for example COUNT(*) FILTER (WHERE paid = 1).');
    }
    const name = head[1].toUpperCase();
    if (!FILTERABLE_AGGREGATES.has(name)) {
      throw new DialectError(`FILTER (WHERE ...) is supported on COUNT, SUM, AVG, MIN, MAX, TOTAL and GROUP_CONCAT, not on ${head[1]}().`);
    }
    const filterOpen = close + filter[0].lastIndexOf('(');
    const filterClose = matchingParen(masked, filterOpen);
    if (filterClose === -1) throw new DialectError('FILTER (WHERE ...) is missing its closing parenthesis.');
    const whereAt = filter.index + filter[0].length - 'WHERE'.length;
    const condition = text.slice(whereAt + 'WHERE'.length, filterClose).trim();
    if (!maskSql(condition).trim()) throw new DialectError('FILTER (WHERE ...) needs a condition.');
    const aggregate = text.slice(head.index, close + 1);
    text = `${text.slice(0, head.index)}${FILTER_MARKER}(${aggregate}, ${condition})${text.slice(filterClose + 1)}`;
    found = true;
  }
  return { sql: text, found };
}

const FRAME_INSENSITIVE = new Set(['ROW_NUMBER', 'RANK', 'DENSE_RANK', 'PERCENT_RANK', 'CUME_DIST', 'NTILE', 'LAG', 'LEAD']);

/** Upper-cased name of the call that precedes the OVER at `overAt`, when it is a plain call. */
function windowCallee(masked: string, overAt: number): string | null {
  const before = masked.slice(0, overAt);
  if (!/\)\s*$/.test(before)) return null;
  const close = before.lastIndexOf(')');
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (masked[i] === ')') depth++;
    else if (masked[i] === '(' && --depth === 0) {
      return masked.slice(0, i).match(/([A-Za-z_]\w*)\s*$/)?.[1].toUpperCase() ?? null;
    }
  }
  return null;
}

/**
 * `OVER (PARTITION BY p ORDER BY o ROWS BETWEEN a AND b)` ->
 * `OVER (PARTITION BY p, QT_FRAME('ROWS BETWEEN A AND B') ORDER BY o)`.
 * The partition list is the only place the grammar accepts an arbitrary
 * expression inside OVER; a constant extra partition key does not change
 * the window while the marker is present, and it is removed before execution.
 */
function encodeFrames(sql: string): { sql: string; found: boolean } {
  let text = sql;
  let found = false;
  for (let guard = 0; guard < 500; guard++) {
    const masked = maskSql(text);
    let replaced = false;
    for (const over of masked.matchAll(/\bOVER\s*\(/gi)) {
      const open = (over.index ?? 0) + over[0].length - 1;
      const close = matchingParen(masked, open);
      if (close === -1) continue;
      const innerMasked = masked.slice(open + 1, close);
      // ROWS, RANGE and GROUPS are also legal column names. Where a value is
      // expected (after BY, a comma, a qualifier or an operator) the word is a
      // column; the frame keyword only ever follows a complete sort or partition item.
      const frame = topLevelMatches(innerMasked, /\b(?:ROWS|RANGE|GROUPS)\b/gi).find((candidate) =>
        candidate.index !== undefined &&
        !/(?:\b(?:BY|AND|OR|NOT|WHEN|THEN|ELSE)|[,.+\-*/%=<>|(])\s*$/i.test(innerMasked.slice(0, candidate.index))
      );
      if (!frame || frame.index === undefined) continue;
      const inner = text.slice(open + 1, close);
      const frameText = inner.slice(frame.index);
      const normalized = normalizeFrame(frameText);
      // Ranking and offset functions ignore a frame; accepting one would be a silent simplification.
      const callee = windowCallee(masked, over.index ?? 0);
      if (callee && FRAME_INSENSITIVE.has(callee)) {
        throw new DialectError(`${callee}() ignores a window frame, so "${normalized}" would have no effect. Remove the frame, or use an aggregate such as SUM or AVG.`);
      }
      const spec = inner.slice(0, frame.index);
      const specMasked = innerMasked.slice(0, frame.index);
      const orderBy = topLevelMatches(specMasked, /\bORDER\s+BY\b/gi)[0];
      if (!orderBy || orderBy.index === undefined) {
        throw new DialectError('A window frame needs an ORDER BY inside OVER (...) so the frame has a row order to count along, for example OVER (ORDER BY id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW).');
      }
      const partition = topLevelMatches(specMasked, /\bPARTITION\s+BY\b/gi)[0];
      const marker = `${FRAME_MARKER}('${normalized}')`;
      const partitionText = partition ? spec.slice(0, orderBy.index).replace(/\s+$/, '') : null;
      const rebuilt = partitionText !== null
        ? `${partitionText}, ${marker} ${spec.slice(orderBy.index)}`
        : `PARTITION BY ${marker} ${spec}`;
      text = `${text.slice(0, open + 1)}${rebuilt.trim()}${text.slice(close)}`;
      found = true;
      replaced = true;
      break;
    }
    if (!replaced) break;
  }
  return { sql: text, found };
}

/** Encode every construct the parser cannot read. Throws DialectError for unsupported forms. */
export function prepareParserEncodings(sql: string): EncodedQuery {
  const ordered = prepareOrderedAggregates(sql);
  const filters = encodeFilters(ordered);
  const frames = encodeFrames(filters.sql);
  return { sql: maskBackslashes(frames.sql), filter: filters.found, frame: frames.found };
}

function restoreFrames(sql: string): string {
  let text = sql;
  for (let guard = 0; guard < 500; guard++) {
    const masked = maskSql(text);
    const marker = masked.match(new RegExp(String.raw`\b${FRAME_MARKER}\s*\(`, 'i'));
    if (!marker || marker.index === undefined) break;
    const start = marker.index;
    const open = start + marker[0].length - 1;
    const close = matchingParen(masked, open);
    if (close === -1) break;
    const frame = text.slice(open + 1, close).trim().replace(/^'|'$/g, '');
    // The enclosing OVER ( ... ) is the nearest unmatched parenthesis before the marker.
    let depth = 0;
    let overOpen = -1;
    for (let i = start - 1; i >= 0; i--) {
      if (masked[i] === ')') depth++;
      else if (masked[i] === '(') {
        if (depth === 0) {
          overOpen = i;
          break;
        }
        depth--;
      }
    }
    const overClose = overOpen === -1 ? -1 : matchingParen(masked, overOpen);
    if (overClose === -1) break;
    // Remove the marker together with the comma that joined it to the partition list.
    let removeStart = start;
    let removeEnd = close + 1;
    const before = text.slice(0, start);
    const trailingComma = before.match(/,\s*$/);
    if (trailingComma && trailingComma.index !== undefined) removeStart = trailingComma.index;
    else {
      const after = text.slice(removeEnd).match(/^\s*,\s*/);
      if (after) removeEnd += after[0].length;
      else {
        // The marker was the only partition key.
        const partition = before.match(/PARTITION\s+BY\s*$/i);
        if (partition && partition.index !== undefined) removeStart = partition.index;
      }
    }
    const inner = `${text.slice(overOpen + 1, removeStart)}${text.slice(removeEnd, overClose)}`.trim();
    text = `${text.slice(0, overOpen + 1)}${inner}${inner ? ' ' : ''}${frame}${text.slice(overClose)}`;
  }
  return text;
}

function restoreFilters(sql: string): string {
  return rewriteCalls(sql, [FILTER_MARKER], (call) => {
    const args = splitTopLevel(call.inner);
    if (args.length < 2) return null;
    return `${args[0].trim()} FILTER (WHERE ${args.slice(1).join(',').trim()})`;
  });
}

/** Put the native syntax back in place of each marker call. Repeatable: text without markers is returned as is. */
function restoreMarkers(sql: string): string {
  return /QT_/i.test(sql) ? restoreFilters(restoreOrderedAggregates(restoreFrames(sql))) : sql;
}

/**
 * Restore native SQLite syntax in parser-derived SQL. Safe to call on text
 * without markers. The backslash stand-ins are resolved exactly once here, so
 * call this once per text: a second pass would read a restored private-use
 * character as a stand-in.
 */
export function restoreParserEncodings(sql: string): string {
  return unmaskBackslashes(restoreMarkers(sql));
}

/**
 * Serialized AST text back to executable SQLite. Frames are restored before the
 * parser-only `PARTITION BY NULL` is hidden, because the frame marker sits in
 * that partition list; the markers are then restored once more for whatever
 * the hiding exposed, and the backslashes last.
 */
export function restoreParsedSql(sql: string): string {
  const tidied = tidyWindowSql(restoreMarkers(sql));
  return unmaskBackslashes(restoreMarkers(tidied));
}
