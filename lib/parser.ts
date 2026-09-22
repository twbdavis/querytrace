// Deep import: the package root is a ~2.4 MB bundle of every SQL dialect; the
// sqlite-only build keeps compile time and the client bundle small.
import { Parser } from 'node-sql-parser/build/sqlite';
import { COMPAT_FUNCTION_NAMES, COMPAT_FUNCTION_NOTES } from './compatFunctions';
import { DialectError, splitCompound, statementKind, translateQuery, type DialectNote } from './dialect';
import { maskSql, splitSqlStatements, unquoteIdent } from './sqlText';

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

export interface CteItem {
  name: { value: string };
  stmt: { ast: SelectAst };
  columns?: unknown;
  recursive?: boolean;
}

export interface SelectAst {
  type: string;
  with?: CteItem[] | null;
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

/** The parts of an INSERT / UPDATE / DELETE AST the mutation trace reads. */
export interface MutationAst {
  type: string;
  table?: Array<{ table?: string; as?: string | null }> | null;
  columns?: string[] | null;
  set?: Array<{ column: string; value: AstExpr }> | null;
  where?: AstExpr | null;
  values?: unknown;
}

export type MutationKind = 'insert' | 'update' | 'delete';

export type ParseOutcome =
  | { ok: true; kind: 'select'; ast: SelectAst; sql: string; notes: DialectNote[] }
  | { ok: true; kind: 'compound'; branches: SelectAst[]; operators: string[]; sql: string; notes: DialectNote[] }
  | { ok: true; kind: 'mutation'; statement: MutationKind; table: string; ast: MutationAst | null; sql: string; notes: DialectNote[] }
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

/** Every SELECT nested anywhere below `node` (subqueries, derived tables, CTE bodies). */
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

/** The CTE bodies of a SELECT, in declaration order. */
export function cteItems(ast: SelectAst): CteItem[] {
  return Array.isArray(ast.with) ? ast.with : [];
}

/** Walk every FROM item that carries a JOIN keyword, in the order the text lists them. */
function forEachJoinItem(ast: SelectAst, visit: (item: FromItem) => void): void {
  const visitSelect = (select: SelectAst | null | undefined) => {
    if (!select) return;
    for (const cte of cteItems(select)) visitSelect(cte.stmt?.ast);
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

/** Aggregates the sqlite grammar reads as ordinary function calls. */
const AGGREGATE_FUNCTION_NAMES = new Set(['GROUP_CONCAT', 'STRING_AGG', 'TOTAL', 'JSON_GROUP_ARRAY', 'JSON_GROUP_OBJECT']);

function functionName(obj: Record<string, unknown>): string | null {
  const raw = obj.name as { name?: Array<{ value?: string }> } | string | undefined;
  const name = typeof raw === 'string' ? raw : raw?.name?.[0]?.value;
  return name ? name.toUpperCase() : null;
}

/** A windowed aggregate (COUNT(*) OVER (...)) is a per-row value, not a grouping aggregate. */
function isGroupingAggregate(obj: Record<string, unknown>): boolean {
  if (obj.over) return false;
  if (obj.type === 'aggr_func') return true;
  return obj.type === 'function' && AGGREGATE_FUNCTION_NAMES.has(functionName(obj) ?? '');
}

export function containsAggregate(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(containsAggregate);
  const obj = node as Record<string, unknown>;
  if (obj.type === 'select') return false;
  if (isGroupingAggregate(obj)) return true;
  return Object.values(obj).some(containsAggregate);
}

/** True when any select-list item is a window function (ROW_NUMBER() OVER ..., SUM(x) OVER ...). */
export function containsWindowFunction(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(containsWindowFunction);
  const obj = node as Record<string, unknown>;
  if (obj.type === 'select') return false;
  if ((obj.type === 'aggr_func' || obj.type === 'function') && obj.over) return true;
  return Object.values(obj).some(containsWindowFunction);
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
  // Columns inside a window function's OVER clause or arguments are per-row
  // and do not have to be grouped either.
  const aggregated = insideAggregate || isGroupingAggregate(obj) || !!obj.over;
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

function isOrdinal(expr: AstExpr): number | null {
  if (expr.type !== 'number' || typeof expr.value !== 'number') return null;
  return Number.isInteger(expr.value) ? expr.value : null;
}

/**
 * MySQL and PostgreSQL accept GROUP BY 1 / ORDER BY 2 as positions in the
 * select list. Replace grouping positions with the expression they name so the
 * trace shows the real grouping key; ORDER BY positions are native to SQLite
 * and only need a range check.
 */
function resolveOrdinals(ast: SelectAst): string | null {
  const columns = typeof ast.columns === 'string' ? null : ast.columns;
  const check = (position: number, clause: string): string | null => {
    if (position < 1 || (columns && position > columns.length)) {
      return `${clause} ${position} refers to a select-list position, but the SELECT list has ${columns?.length ?? 0} ${columns?.length === 1 ? 'item' : 'items'}.`;
    }
    return null;
  };
  const groupExprs = groupByExprs(ast);
  if (groupExprs) {
    for (let i = 0; i < groupExprs.length; i++) {
      const position = isOrdinal(groupExprs[i]);
      if (position === null) continue;
      if (!columns) return 'GROUP BY a position number needs an explicit SELECT list rather than SELECT *.';
      const error = check(position, 'GROUP BY');
      if (error) return error;
      groupExprs[i] = JSON.parse(JSON.stringify(columns[position - 1].expr)) as AstExpr;
    }
  }
  for (const item of ast.orderby ?? []) {
    const position = isOrdinal(item.expr);
    if (position === null) continue;
    const error = check(position, 'ORDER BY');
    if (error) return error;
  }
  return null;
}

function validateCourseSemantics(ast: SelectAst): string | null {
  const ordinalError = resolveOrdinals(ast);
  if (ordinalError) return ordinalError;

  const columns = typeof ast.columns === 'string' ? [] : ast.columns;
  const groupExprs = groupByExprs(ast) ?? [];
  const groupColumns = collectColumnsOutsideAggregates(groupExprs);
  const hasAggregate = columns.some((column) => containsAggregate(column.expr));

  if (ast.where && containsAggregate(ast.where)) {
    return 'Aggregate functions cannot be used in WHERE; filter aggregate results with HAVING.';
  }
  if (ast.where && containsWindowFunction(ast.where)) {
    return 'Window functions cannot be used in WHERE. Compute the value in a subquery or CTE and filter the outer query.';
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

function validateSelect(ast: SelectAst, nested = false): string | null {
  if (ast.type !== 'select') {
    const kind = typeof ast.type === 'string' ? ast.type.toUpperCase() : 'This';
    return `${UNSUPPORTED} ${kind} statements cannot be visualized here.`;
  }
  for (const cte of cteItems(ast)) {
    if (cte.recursive) return 'Recursive CTEs are not traced. Use a plain WITH name AS (SELECT ...) instead.';
    if (!cte.stmt?.ast || cte.stmt.ast.type !== 'select') return `${UNSUPPORTED} Each WITH item must be a SELECT.`;
    const error = validateSelect(cte.stmt.ast, true);
    if (error) return error;
  }
  if (ast.set_op && !String(ast.set_op).toLowerCase().startsWith('union')) {
    return `${UNSUPPORTED} Only UNION, UNION ALL, INTERSECT and EXCEPT set operations are covered.`;
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
  void nested;
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

/** Lower-cased CTE names visible to a SELECT (its own WITH clause). */
export function cteNames(ast: SelectAst): Set<string> {
  return new Set(cteItems(ast).map((cte) => cte.name.value.toLowerCase()));
}

/** All physical tables referenced by a query, including UNION/subquery branches and CTE bodies; CTE names themselves are excluded. */
export function queryTableNames(ast: SelectAst): string[] {
  const names: string[] = [];
  const visit = (select: SelectAst | null | undefined, ctes: Set<string>) => {
    if (!select) return;
    const scope = new Set([...ctes, ...cteNames(select)]);
    // Each CTE body may read the CTEs declared before it.
    const declared = new Set(ctes);
    for (const cte of cteItems(select)) {
      visit(cte.stmt?.ast, declared);
      declared.add(cte.name.value.toLowerCase());
    }
    for (const item of select.from ?? []) {
      if (item.table && !scope.has(item.table.toLowerCase())) names.push(item.table);
      if (item.expr?.ast) visit(item.expr.ast, scope);
    }
    for (const child of nestedSelects([select.columns, select.where, select.having, select.orderby])) {
      visit(child, scope);
    }
    visit(select._next, scope);
  };
  visit(ast, new Set());
  return names;
}

/** Names of emulated (non-SQLite) functions used anywhere in the AST, for the dialect note. */
function compatFunctionsUsed(node: unknown, out = new Set<string>()): Set<string> {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => compatFunctionsUsed(child, out));
    return out;
  }
  const obj = node as Record<string, unknown>;
  if (obj.type === 'function' || obj.type === 'aggr_func') {
    const name = functionName(obj);
    if (name && COMPAT_FUNCTION_NAMES.has(name)) out.add(name);
  }
  if (obj.type === 'binary_expr' && typeof obj.operator === 'string' && obj.operator.toUpperCase() === 'REGEXP') out.add('REGEXP');
  Object.values(obj).forEach((child) => compatFunctionsUsed(child, out));
  return out;
}

function functionNotes(node: unknown): DialectNote[] {
  return [...compatFunctionsUsed(node)].map((name) => ({
    from: `${name}${name === 'REGEXP' ? '' : '()'}`,
    to: COMPAT_FUNCTION_NOTES[name],
  }));
}

const parser = new Parser();

function astify(sql: string): { ok: true; ast: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, ast: parser.astify(sql, { database: 'sqlite' }) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `SQL syntax error: ${msg}` };
  }
}

function parseSelectText(sql: string, nested: boolean): { ok: true; ast: SelectAst } | { ok: false; error: string } {
  const rewritten = rewriteJoinKeywords(sql);
  const raw = astify(rewritten.sql);
  if (!raw.ok) return raw;
  let node = raw.ast;
  if (Array.isArray(node)) {
    if (node.length !== 1) return { ok: false, error: `${UNSUPPORTED} Run one statement at a time.` };
    node = node[0];
  }
  const ast = node as SelectAst;
  if (!ast || typeof ast !== 'object' || ast.type !== 'select') {
    return { ok: false, error: `${UNSUPPORTED} Only SELECT queries can be visualized.` };
  }
  restoreJoinKinds(ast, rewritten.kinds);
  const validationError = validateSelect(ast, nested);
  if (validationError) return { ok: false, error: validationError };
  return { ok: true, ast };
}

const DML_HEAD = /^\s*(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+((?:"[^"]*"|`[^`]*`|\w+)(?:\s*\.\s*(?:"[^"]*"|`[^`]*`|\w+))?)/i;

/** Strip one layer of wrapping parentheses: "(SELECT ...)" -> "SELECT ...". */
function unwrapParens(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  const masked = maskSql(trimmed);
  if (masked[0] !== '(') return trimmed;
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === '(') depth++;
    else if (masked[i] === ')' && --depth === 0) return i === masked.length - 1 ? trimmed.slice(1, -1).trim() : trimmed;
  }
  return trimmed;
}

export function parseQuery(input: string): ParseOutcome {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'Type a query to get started.' };

  if (splitSqlStatements(trimmed).length > 1) {
    return { ok: false, error: `${UNSUPPORTED} Run one statement at a time.` };
  }

  let translated;
  try {
    translated = translateQuery(trimmed);
  } catch (error) {
    if (error instanceof DialectError) return { ok: false, error: error.message };
    throw error;
  }
  const { sql, notes } = translated;

  const kind = statementKind(sql);
  if (kind === 'other') {
    const head = maskSql(sql).trim().match(/^(\w+)/)?.[1]?.toUpperCase() ?? 'This';
    if (/^(CREATE|ALTER|DROP|RENAME)$/.test(head)) {
      return {
        ok: false,
        error: `${UNSUPPORTED} ${head} changes the structure of the database. Add it to the schema script (SCHEMA button) to change the tables, then query them here.`,
      };
    }
    return { ok: false, error: `${UNSUPPORTED} Only SELECT, INSERT, UPDATE and DELETE statements run here (got ${head}).` };
  }

  if (kind !== 'select') {
    const head = maskSql(sql).match(DML_HEAD);
    if (!head) return { ok: false, error: `SQL syntax error: could not read the table name in this ${kind.toUpperCase()} statement.` };
    const table = unquoteIdent(sql.slice(head.index! + head[0].length - head[1].length, head.index! + head[0].length).split('.').pop()!.trim());
    const raw = astify(sql);
    let ast: MutationAst | null = null;
    if (raw.ok) {
      const node = Array.isArray(raw.ast) ? raw.ast[0] : raw.ast;
      ast = node as MutationAst;
      if (Array.isArray(raw.ast) && raw.ast.length !== 1) return { ok: false, error: `${UNSUPPORTED} Run one statement at a time.` };
      const selects = nestedSelects(ast);
      for (const child of selects) {
        const error = validateSelect(child, true);
        if (error) return { ok: false, error };
      }
      notes.push(...functionNotes(ast));
    } else if (!/\bON\s+CONFLICT\b/i.test(maskSql(sql))) {
      // The sqlite grammar reads every plain INSERT / UPDATE / DELETE form; an
      // unparseable statement is a real syntax error unless it is the upsert
      // clause the grammar lacks, which SQLite itself validates.
      return raw;
    }
    return { ok: true, kind: 'mutation', statement: kind, table, ast, sql, notes };
  }

  const compound = splitCompound(sql);
  if (compound.operators.some((operator) => !operator.startsWith('UNION'))) {
    const branches: SelectAst[] = [];
    for (const branch of compound.branches) {
      const text = unwrapParens(branch);
      if (!/^\s*(?:SELECT|WITH)\b/i.test(maskSql(text))) {
        return { ok: false, error: 'Each side of INTERSECT / EXCEPT must be a complete SELECT.' };
      }
      // ORDER BY / LIMIT after the last branch belong to the whole compound.
      const parsed = parseSelectText(text, true);
      if (!parsed.ok) return parsed;
      branches.push(parsed.ast);
    }
    return { ok: true, kind: 'compound', branches, operators: compound.operators, sql, notes };
  }

  const parsed = parseSelectText(sql, false);
  if (!parsed.ok) return parsed;
  notes.push(...functionNotes(parsed.ast));
  return { ok: true, kind: 'select', ast: parsed.ast, sql, notes };
}

/** Normalize the two groupby shapes node-sql-parser emits across versions. */
export function groupByExprs(ast: SelectAst): AstExpr[] | null {
  if (!ast.groupby) return null;
  if (Array.isArray(ast.groupby)) return ast.groupby.length ? ast.groupby : null;
  const cols = ast.groupby.columns;
  return cols && cols.length ? cols : null;
}
