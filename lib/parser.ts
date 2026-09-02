// Deep import: the package root is a ~2.4 MB bundle of every SQL dialect; the
// sqlite-only build keeps compile time and the client bundle small.
import { Parser } from 'node-sql-parser/build/sqlite';
import { maskSql } from './sqlText';

/** Loose structural types for the slice of the node-sql-parser AST we support. */
export interface AstExpr {
  type?: string;
  [key: string]: unknown;
}

export interface FromItem {
  db?: string | null;
  table?: string;
  as?: string | null;
  join?: string;
  on?: AstExpr;
  using?: unknown;
  expr?: { ast?: SelectAst; [key: string]: unknown };
}

export interface OrderByItem {
  expr: AstExpr;
  type?: string | null;
}

export interface LimitNode {
  seperator?: string;
  value?: Array<{ type?: string; value: number }>;
}

export interface SelectColumn {
  expr: AstExpr;
  as?: string | null;
}

export interface SelectAst {
  type: string;
  with?: unknown;
  distinct?: unknown;
  columns: SelectColumn[] | string;
  from: FromItem[] | null;
  where: AstExpr | null;
  groupby: { columns?: AstExpr[] } | AstExpr[] | null;
  having: AstExpr | null;
  orderby: OrderByItem[] | null;
  limit: LimitNode | null;
  _next?: SelectAst | null;
  set_op?: unknown;
}

export type ParseOutcome =
  | { ok: true; ast: SelectAst }
  | { ok: false; error: string };

const UNSUPPORTED = 'Not supported yet in visual mode.';

const SUPPORTED_JOINS = new Set([
  'INNER JOIN',
  'JOIN',
  'LEFT JOIN',
  'LEFT OUTER JOIN',
  'RIGHT JOIN',
  'RIGHT OUTER JOIN',
  'FULL JOIN',
  'FULL OUTER JOIN',
  'CROSS JOIN',
]);

/**
 * The sqlite grammar of node-sql-parser only knows INNER and LEFT joins.
 * SQLite itself (3.39+) executes RIGHT, FULL and CROSS joins, so those
 * keywords are swapped for a parseable spelling of the same length before
 * parsing and restored on the AST afterwards, in document order.
 */
const JOIN_KEYWORD = /\b(RIGHT|FULL|CROSS|LEFT|INNER)(\s+OUTER)?(\s+)JOIN\b|\bJOIN\b/gi;

interface JoinRewrite {
  sql: string;
  /** Canonical join kind of every JOIN keyword, in the order they appear. */
  kinds: string[];
}

function rewriteJoinKeywords(sql: string): JoinRewrite {
  const masked = maskSql(sql);
  const kinds: string[] = [];
  let out = '';
  let last = 0;
  for (const match of masked.matchAll(JOIN_KEYWORD)) {
    const index = match.index ?? 0;
    const modifier = match[1]?.toUpperCase();
    const outer = match[2] ? ' OUTER' : '';
    kinds.push(modifier ? `${modifier}${outer} JOIN` : 'JOIN');
    let replacement = match[0];
    if (modifier === 'RIGHT') replacement = `LEFT ${match[0].slice(5)}`;
    else if (modifier === 'FULL') replacement = `LEFT${match[0].slice(4)}`;
    else if (modifier === 'CROSS') replacement = `     ${match[0].slice(5)}`;
    out += sql.slice(last, index) + replacement;
    last = index + match[0].length;
  }
  return { sql: out + sql.slice(last), kinds };
}

/** Walk every FROM item that carries a JOIN keyword, in the order the text lists them. */
function forEachJoinItem(ast: SelectAst, visit: (item: FromItem) => void): void {
  const visitSelect = (select: SelectAst | null | undefined) => {
    if (!select) return;
    nestedSelects(select.columns).forEach(visitSelect);
    for (const item of select.from ?? []) {
      if (item.join) visit(item);
      if (item.expr?.ast) visitSelect(item.expr.ast);
      nestedSelects(item.on).forEach(visitSelect);
    }
    nestedSelects([select.where, select.groupby, select.having, select.orderby]).forEach(visitSelect);
    visitSelect(select._next);
  };
  visitSelect(ast);
}

function restoreJoinKinds(ast: SelectAst, kinds: string[]): void {
  let index = 0;
  forEachJoinItem(ast, (item) => {
    const kind = kinds[index++];
    if (kind) item.join = kind;
  });
}

function containsAggregate(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(containsAggregate);
  const obj = node as Record<string, unknown>;
  if (obj.type === 'select') return false;
  if (obj.type === 'aggr_func') return true;
  return Object.values(obj).some(containsAggregate);
}

function columnKey(node: AstExpr): string | null {
  if (node.type !== 'column_ref') return null;
  const table = typeof node.table === 'string' ? `${node.table.toLowerCase()}.` : '';
  const column = typeof node.column === 'string' ? node.column : null;
  return column ? `${table}${column.toLowerCase()}` : null;
}

function sameColumn(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.includes('.') && right.includes('.')) return false;
  return left.split('.').at(-1) === right.split('.').at(-1);
}

function collectAllColumns(node: unknown, out = new Set<string>()): Set<string> {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => collectAllColumns(child, out));
    return out;
  }
  const obj = node as AstExpr;
  if (obj.type === 'select') return out;
  const key = columnKey(obj);
  if (key && !key.endsWith('.*')) out.add(key);
  Object.values(obj).forEach((child) => collectAllColumns(child, out));
  return out;
}

function collectColumnsOutsideAggregates(
  node: unknown,
  out = new Set<string>(),
  insideAggregate = false
): Set<string> {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => collectColumnsOutsideAggregates(child, out, insideAggregate));
    return out;
  }
  const obj = node as AstExpr;
  if (obj.type === 'select') return out;
  const aggregated = insideAggregate || obj.type === 'aggr_func';
  if (!aggregated) {
    const key = columnKey(obj);
    if (key && !key.endsWith('.*')) out.add(key);
  }
  Object.values(obj).forEach((child) => collectColumnsOutsideAggregates(child, out, aggregated));
  return out;
}

function findQuotedAlias(node: unknown, aliases: Set<string>): string | null {
  if (node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findQuotedAlias(child, aliases);
      if (match) return match;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  if (
    typeof obj.type === 'string' &&
    obj.type.endsWith('_quote_string') &&
    typeof obj.value === 'string' &&
    aliases.has(obj.value.toLowerCase())
  ) {
    return obj.value;
  }
  for (const child of Object.values(obj)) {
    const match = findQuotedAlias(child, aliases);
    if (match) return match;
  }
  return null;
}

function validateCourseSemantics(ast: SelectAst): string | null {
  const columns = typeof ast.columns === 'string' ? [] : ast.columns;
  const groupExprs = groupByExprs(ast) ?? [];
  const groupColumns = collectColumnsOutsideAggregates(groupExprs);
  const hasAggregate = columns.some((column) => containsAggregate(column.expr));

  if (ast.where && containsAggregate(ast.where)) {
    return 'Aggregate functions cannot be used in WHERE; filter aggregate results with HAVING.';
  }
  if (ast.having && groupExprs.length === 0) {
    return 'HAVING operates on groups and requires a GROUP BY clause in this course.';
  }
  if ((hasAggregate || groupExprs.length > 0) && typeof ast.columns === 'string') {
    return 'SELECT * cannot be mixed with grouping or aggregate functions.';
  }

  for (const column of columns) {
    if (containsAggregate(column.expr)) continue;
    const refs = collectColumnsOutsideAggregates(column.expr);
    if (hasAggregate && groupExprs.length === 0 && refs.size > 0) {
      return 'A scalar aggregate cannot be selected with individual columns unless those columns are grouped.';
    }
    if (groupExprs.length > 0) {
      const missing = [...refs].find(
        (ref) => ![...groupColumns].some((groupColumn) => sameColumn(ref, groupColumn))
      );
      if (missing) {
        return `The non-aggregate column ${missing} must appear in the GROUP BY clause.`;
      }
    }
  }

  // QueryTrace treats a result alias as an output label, not as an input to
  // another clause. SQLite is more permissive, so normalize that distinction.
  const aliases = new Set(
    columns
      .map((column) => column.as?.toLowerCase())
      .filter((alias): alias is string => !!alias)
  );
  const laterColumns = collectColumnsOutsideAggregates([
    ast.where,
    ast.groupby,
    ast.having,
    ast.orderby,
  ]);
  const reusedAlias = [...laterColumns].find(
    (ref) => !ref.includes('.') && aliases.has(ref)
  );
  const quotedOrderAlias = findQuotedAlias(ast.orderby, aliases);
  if (reusedAlias || quotedOrderAlias) {
    return `Field alias "${quotedOrderAlias ?? reusedAlias}" cannot be referenced elsewhere in the query; repeat its expression instead.`;
  }


  if (ast.having) {
    const selectedColumns = collectAllColumns(columns.map((column) => column.expr));
    const invalidHavingColumn = [...collectColumnsOutsideAggregates(ast.having)].find(
      (ref) => ![...selectedColumns].some((selected) => sameColumn(ref, selected))
    );
    if (invalidHavingColumn) {
      return `HAVING column ${invalidHavingColumn} must also be included in the SELECT list.`;
    }
  }

  const topLevelRefs = collectAllColumns([
    ast.columns,
    ast.where,
    ast.groupby,
    ast.having,
    ast.orderby,
    ast.from?.map((item) => item.on),
  ]);
  for (const item of ast.from ?? []) {
    if (!item.table || !item.as) continue;
    const originalPrefix = `${item.table.toLowerCase()}.`;
    if ([...topLevelRefs].some((ref) => ref.startsWith(originalPrefix))) {
      return `Table "${item.table}" has alias "${item.as}"; use the alias everywhere in this query.`;
    }
  }

  return null;
}

function nestedSelects(node: unknown, out: SelectAst[] = []): SelectAst[] {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => nestedSelects(child, out));
    return out;
  }
  const obj = node as Record<string, unknown>;
  if (obj.type === 'select') {
    out.push(obj as unknown as SelectAst);
    return out;
  }
  Object.values(obj).forEach((child) => nestedSelects(child, out));
  return out;
}

function validateSelect(ast: SelectAst, nested = false): string | null {
  if (ast.type !== 'select') return `${UNSUPPORTED} Only SELECT queries can be visualized.`;
  if (ast.with) return `${UNSUPPORTED} CTEs (WITH) are not part of the course query sequence.`;
  if (ast.set_op && !String(ast.set_op).toLowerCase().startsWith('union')) {
    return `${UNSUPPORTED} Only UNION and UNION ALL set operations are covered.`;
  }
  if ((!ast.from || ast.from.length === 0) && !nested && !ast._next) {
    return `${UNSUPPORTED} The query needs a FROM clause over the loaded tables.`;
  }

  for (let i = 0; i < (ast.from?.length ?? 0); i++) {
    const item = ast.from![i];
    if (item.expr) {
      if (!item.expr.ast || item.expr.ast.type !== 'select') {
        return `${UNSUPPORTED} The FROM expression is not a SELECT-derived table.`;
      }
      if (!item.as) return 'Every derived table in FROM must have an alias.';
    } else if (!item.table) {
      return `${UNSUPPORTED} A FROM item is missing its table name.`;
    }
    if (item.join) {
      const join = item.join.toUpperCase();
      if (!SUPPORTED_JOINS.has(join)) {
        return `${UNSUPPORTED} Only JOIN, LEFT/RIGHT/FULL OUTER JOIN and CROSS JOIN are visualized (got "${item.join}").`;
      }
      if (item.using) {
        return `${UNSUPPORTED} JOIN ... USING is not covered; spell the condition out with ON table1.column = table2.column.`;
      }
      if (join === 'CROSS JOIN') {
        if (item.on) return 'A CROSS JOIN pairs every row with every row and takes no ON condition; use JOIN ... ON to match keys.';
      } else if (!item.on) {
        return `${UNSUPPORTED} Every explicit JOIN needs an ON condition.`;
      }
    }
  }

  const semanticError = validateCourseSemantics(ast);
  if (semanticError) return semanticError;

  const children = nestedSelects([
    ast.columns,
    ast.from?.map((item) => item.expr),
    ast.where,
    ast.groupby,
    ast.having,
    ast.orderby,
  ]);
  for (const child of children) {
    const error = validateSelect(child, true);
    if (error) return error;
  }
  if (ast._next) return validateSelect(ast._next, true);
  return null;
}

export function hasNestedSelect(ast: SelectAst): boolean {
  return nestedSelects([
    ast.columns,
    ast.from?.map((item) => item.expr),
    ast.where,
    ast.groupby,
    ast.having,
    ast.orderby,
  ]).length > 0;
}

/** All physical tables referenced by a query, including UNION/subquery branches. */
export function queryTableNames(ast: SelectAst): string[] {
  const names: string[] = [];
  const visit = (select: SelectAst | null | undefined) => {
    if (!select) return;
    for (const item of select.from ?? []) {
      if (item.table) names.push(item.table);
      if (item.expr?.ast) visit(item.expr.ast);
    }
    for (const child of nestedSelects([select.columns, select.where, select.having, select.orderby])) {
      visit(child);
    }
    visit(select._next);
  };
  visit(ast);
  return names;
}

export function parseQuery(sql: string): ParseOutcome {
  const trimmed = sql.trim();
  if (!trimmed) return { ok: false, error: 'Type a query to get started.' };

  const parser = new Parser();
  const rewritten = rewriteJoinKeywords(trimmed);
  let raw: unknown;
  try {
    raw = parser.astify(rewritten.sql, { database: 'sqlite' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `SQL syntax error: ${msg}` };
  }

  if (Array.isArray(raw)) {
    if (raw.length !== 1) {
      return { ok: false, error: `${UNSUPPORTED} Run one statement at a time.` };
    }
    raw = raw[0];
  }

  const ast = raw as SelectAst;
  if (ast && typeof ast === 'object' && ast.type === 'select') restoreJoinKinds(ast, rewritten.kinds);

  const validationError = validateSelect(ast);
  if (validationError) return { ok: false, error: validationError };

  return { ok: true, ast };
}

/** Normalize the two groupby shapes node-sql-parser emits across versions. */
export function groupByExprs(ast: SelectAst): AstExpr[] | null {
  if (!ast.groupby) return null;
  if (Array.isArray(ast.groupby)) return ast.groupby.length ? ast.groupby : null;
  const cols = ast.groupby.columns;
  return cols && cols.length ? cols : null;
}
