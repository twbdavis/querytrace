import type { TraceStep } from './traceEngine';

export interface CharRange {
  start: number;
  end: number;
}

interface Token {
  text: string;
  start: number;
}

/** Word tokens outside strings, quoted identifiers and comments. */
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) i += 2; // doubled-quote escape
          else {
            i++;
            break;
          }
        } else i++;
      }
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_]/.test(sql[i])) i++;
      tokens.push({ text: sql.slice(start, i).toUpperCase(), start });
      continue;
    }
    i++;
  }
  return tokens;
}

export interface ClauseRanges {
  select?: CharRange;
  from?: CharRange;
  joins: CharRange[];
  where?: CharRange;
  groupBy?: CharRange;
  having?: CharRange;
  orderLimit?: CharRange;
}

/**
 * Locate each top-level clause of a (subquery-free) SELECT statement in the
 * original text, so trace steps can light up the SQL they are executing.
 */
export function computeClauseRanges(sql: string): ClauseRanges {
  const tokens = tokenize(sql);
  const at = (kw: string) => tokens.find((t) => t.text === kw)?.start;

  const selectStart = at('SELECT');
  const fromStart = at('FROM');
  const whereStart = at('WHERE');
  const havingStart = at('HAVING');
  const groupTok = tokens.find((t, i) => t.text === 'GROUP' && tokens[i + 1]?.text === 'BY');
  const orderTok = tokens.find((t, i) => t.text === 'ORDER' && tokens[i + 1]?.text === 'BY');
  const limitStart = at('LIMIT');

  // Each JOIN keyword, extended left over INNER/LEFT/RIGHT/FULL/CROSS/OUTER modifiers.
  const joinStarts: number[] = [];
  tokens.forEach((t, i) => {
    if (t.text !== 'JOIN') return;
    let s = i;
    if (tokens[s - 1]?.text === 'OUTER') s--;
    if (['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS'].includes(tokens[s - 1]?.text ?? '')) s--;
    joinStarts.push(tokens[s].start);
  });

  const trimEnd = (start: number, end: number): CharRange => {
    let e = end;
    while (e > start && /\s/.test(sql[e - 1])) e--;
    return { start, end: e };
  };
  const firstAfter = (pos: number, ...candidates: Array<number | undefined>): number => {
    const after = candidates.filter((c): c is number => c !== undefined && c > pos);
    return after.length ? Math.min(...after) : sql.length;
  };

  const groupStart = groupTok?.start;
  const orderStart = orderTok?.start ?? limitStart;
  const ranges: ClauseRanges = { joins: [] };

  if (selectStart !== undefined) {
    ranges.select = trimEnd(selectStart, fromStart ?? sql.length);
  }
  if (fromStart !== undefined) {
    ranges.from = trimEnd(
      fromStart,
      firstAfter(fromStart, joinStarts[0], whereStart, groupStart, havingStart, orderStart)
    );
  }
  joinStarts.forEach((js, i) => {
    ranges.joins.push(
      trimEnd(js, firstAfter(js, joinStarts[i + 1], whereStart, groupStart, havingStart, orderStart))
    );
  });
  if (whereStart !== undefined) {
    ranges.where = trimEnd(whereStart, firstAfter(whereStart, groupStart, havingStart, orderStart));
  }
  if (groupStart !== undefined) {
    ranges.groupBy = trimEnd(groupStart, firstAfter(groupStart, havingStart, orderStart));
  }
  if (havingStart !== undefined) {
    ranges.having = trimEnd(havingStart, firstAfter(havingStart, orderStart));
  }
  if (orderStart !== undefined) {
    ranges.orderLimit = trimEnd(orderStart, sql.length);
  }
  return ranges;
}

/** Attach the matching text range to every step of a freshly built trace. */
export function assignQueryRanges(steps: TraceStep[], sql: string): void {
  const ranges = computeClauseRanges(sql);
  let joinIdx = 0;
  for (const step of steps) {
    switch (step.stage) {
      case 'select':
        step.queryRange = ranges.select;
        break;
      case 'from':
        step.queryRange = ranges.from;
        break;
      case 'join':
        step.queryRange = ranges.joins[joinIdx++];
        break;
      case 'where':
        step.queryRange = ranges.where;
        break;
      case 'groupBy':
        step.queryRange = ranges.groupBy;
        break;
      case 'having':
        step.queryRange = ranges.having;
        break;
      case 'subquery':
      case 'union':
        step.queryRange = { start: 0, end: sql.length };
        break;
      case 'orderLimit':
        step.queryRange = ranges.orderLimit;
        break;
    }
  }
}
