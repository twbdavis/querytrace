/**
 * Schema-aware date arithmetic. PostgreSQL and Oracle subtract two DATE
 * columns to a day count and add days to a DATE column with + n; SQLite
 * would add the numbers it finds at the start of the text ('1980-12-17' + 30
 * is 2010). With the loaded schema the column types are known, so these
 * expressions become the DATEDIFF / DATE_ADD calls the trace already supports.
 */
import type { DialectNote } from './dialect';
import { cteItems, type AstExpr, type MutationAst, type SelectAst } from './parser';
import type { TableMeta } from './schemas';

interface Scope {
  /** alias (lower-case) -> table metadata for the physical tables of one SELECT. */
  tables: Map<string, TableMeta>;
  parent: Scope | null;
}

const DATE_TYPE = /\b(?:DATE|TIME|TIMESTAMP)\b/i;
const DATE_FUNCTIONS = new Set([
  'DATE', 'DATETIME', 'NOW', 'CURDATE', 'GETDATE', 'SYSDATETIME', 'DATE_ADD', 'DATE_SUB', 'ADDDATE', 'SUBDATE', 'DATEADD',
  'ADD_MONTHS', 'LAST_DAY', 'STR_TO_DATE', 'TO_DATE', 'DATE_TRUNC', 'TIMESTAMPADD',
]);

function functionName(node: AstExpr): string | null {
  const raw = node.name as { name?: Array<{ value?: string }> } | string | undefined;
  const name = typeof raw === 'string' ? raw : raw?.name?.[0]?.value;
  return name ? name.toUpperCase() : null;
}

function columnType(node: AstExpr, scope: Scope): string | undefined {
  if (node.type !== 'column_ref' || typeof node.column !== 'string') return undefined;
  const column = node.column.toLowerCase();
  const qualifier = typeof node.table === 'string' ? node.table.toLowerCase() : null;
  for (let s: Scope | null = scope; s; s = s.parent) {
    if (qualifier) {
      const table = s.tables.get(qualifier);
      if (table) return table.columns.find((c) => c.name.toLowerCase() === column)?.type;
      continue;
    }
    for (const table of s.tables.values()) {
      const meta = table.columns.find((c) => c.name.toLowerCase() === column);
      if (meta) return meta.type;
    }
  }
  return undefined;
}

function isDate(node: AstExpr, scope: Scope): boolean {
  if (node.type === 'column_ref') return DATE_TYPE.test(columnType(node, scope) ?? '');
  if (node.type === 'function' || node.type === 'aggr_func') {
    const name = functionName(node) ?? '';
    if (DATE_FUNCTIONS.has(name)) return true;
    // MIN(hired_on), COALESCE(returned_on, CURRENT_DATE): a date when an argument is.
    if (/^(?:MIN|MAX|COALESCE|IFNULL|NVL|NULLIF|FIRST_VALUE|LAST_VALUE|LAG|LEAD)$/.test(name)) {
      const args = (node.args as { value?: unknown; expr?: unknown } | undefined);
      const list = Array.isArray(args?.value) ? (args!.value as AstExpr[]) : args?.expr ? [args.expr as AstExpr] : [];
      return list.some((arg) => isDate(arg, scope));
    }
    return false;
  }
  if (node.type === 'single_quote_string') return /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(String(node.value));
  if (node.type === 'binary_expr' && node.parentheses) return isDate(node.left as AstExpr, scope);
  return false;
}

function numberValue(node: AstExpr): number | null {
  if (node.type === 'number' && typeof node.value === 'number') return node.value;
  if (node.type === 'unary_expr' && node.operator === '-' ) {
    const inner = numberValue(node.expr as AstExpr);
    return inner === null ? null : -inner;
  }
  return null;
}

function call(name: string, args: AstExpr[]): AstExpr {
  return { type: 'function', name: { name: [{ type: 'default', value: name }] }, args: { type: 'expr_list', value: args }, over: null };
}

const text = (value: string): AstExpr => ({ type: 'single_quote_string', value });
const number = (value: number): AstExpr => ({ type: 'number', value });

function rewriteExpr(node: unknown, scope: Scope, notes: DialectNote[]): unknown {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((child) => rewriteExpr(child, scope, notes));
  const obj = node as AstExpr;
  if (obj.type === 'select') return rewriteSelect(obj as unknown as SelectAst, scope, notes);
  const out: AstExpr = Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, rewriteExpr(value, scope, notes)]));
  if (out.type !== 'binary_expr' || (out.operator !== '+' && out.operator !== '-')) return out;
  const left = out.left as AstExpr;
  const right = out.right as AstExpr;
  const leftDate = isDate(left, scope);
  const rightDate = isDate(right, scope);
  const rightNumber = numberValue(right);
  const leftNumber = numberValue(left);
  const note = (from: string, to: string) => {
    if (!notes.some((n) => n.from === from)) notes.push({ from, to });
  };
  if (leftDate && rightNumber !== null) {
    note(`date ${out.operator} n`, `${out.operator === '-' ? 'DATE_SUB' : 'DATE_ADD'}(date, n, 'DAY') (SQLite's ${out.operator} would add to the year digits of the text)`);
    return call(out.operator === '-' ? 'DATE_SUB' : 'DATE_ADD', [left, number(rightNumber), text('DAY')]);
  }
  if (out.operator === '+' && rightDate && leftNumber !== null) {
    note('n + date', "DATE_ADD(date, n, 'DAY')");
    return call('DATE_ADD', [right, number(leftNumber), text('DAY')]);
  }
  if (out.operator === '-' && leftDate && rightDate) {
    note('date - date', "DATEDIFF('day', earlier, later) (SQLite would subtract the year digits of the text)");
    return call('DATEDIFF', [text('day'), right, left]);
  }
  return out;
}

function scopeFor(select: SelectAst, parent: Scope | null, schema: TableMeta[]): Scope {
  const tables = new Map<string, TableMeta>();
  const ctes = new Set(cteItems(select).map((cte) => cte.name.value.toLowerCase()));
  for (const item of select.from ?? []) {
    if (!item.table || item.expr || ctes.has(item.table.toLowerCase())) continue;
    const meta = schema.find((t) => t.name.toLowerCase() === item.table!.toLowerCase());
    if (meta) tables.set((item.as ?? item.table).toLowerCase(), meta);
  }
  return { tables, parent };
}

function rewriteSelect(select: SelectAst, parent: Scope | null, notes: DialectNote[], schema?: TableMeta[]): SelectAst {
  const tables = schema ?? [...collectSchema(parent)];
  const scope = scopeFor(select, parent, tables);
  const out: SelectAst = { ...select };
  if (Array.isArray(select.with)) {
    out.with = select.with.map((cte) => ({ ...cte, stmt: { ...cte.stmt, ast: rewriteSelect(cte.stmt.ast, scope, notes, tables) } }));
  }
  if (select.from) {
    out.from = select.from.map((item) => ({
      ...item,
      on: item.on ? (rewriteExpr(item.on, scope, notes) as AstExpr) : item.on,
      expr: item.expr?.ast ? { ...item.expr, ast: rewriteSelect(item.expr.ast, scope, notes, tables) } : item.expr,
    }));
  }
  if (typeof select.columns !== 'string') {
    out.columns = select.columns.map((column) => ({ ...column, expr: rewriteExpr(column.expr, scope, notes) as AstExpr }));
  }
  out.where = select.where ? (rewriteExpr(select.where, scope, notes) as AstExpr) : select.where;
  out.having = select.having ? (rewriteExpr(select.having, scope, notes) as AstExpr) : select.having;
  if (select.groupby) out.groupby = rewriteExpr(select.groupby, scope, notes) as SelectAst['groupby'];
  if (select.orderby) out.orderby = select.orderby.map((item) => ({ ...item, expr: rewriteExpr(item.expr, scope, notes) as AstExpr }));
  if (select._next) out._next = rewriteSelect(select._next, parent, notes, tables);
  return out;
}

/** The schema is threaded through scopes so nested rewrites can resolve tables. */
const schemaByScope = new WeakMap<Scope, TableMeta[]>();
function collectSchema(scope: Scope | null): TableMeta[] {
  for (let s: Scope | null = scope; s; s = s.parent) {
    const found = schemaByScope.get(s);
    if (found) return found;
  }
  return [];
}

/** Rewrite date +/- arithmetic throughout a SELECT, independently of deduplicated display notes. */
export function rewriteDateArithmeticInSelect(ast: SelectAst, schema: TableMeta[], notes: DialectNote[]): SelectAst {
  const root: Scope = { tables: new Map(), parent: null };
  schemaByScope.set(root, schema);
  return rewriteSelect(ast, root, notes, schema);
}

/** Rewrite date arithmetic in the SET values and WHERE clause of a data change. */
export function rewriteDateArithmeticInMutation(ast: MutationAst, table: TableMeta | undefined, alias: string | null | undefined, notes: DialectNote[]): MutationAst {
  if (!table) return ast;
  const scope: Scope = { tables: new Map([[(alias ?? table.name).toLowerCase(), table], [table.name.toLowerCase(), table]]), parent: null };
  const out: MutationAst = {
    ...ast,
    set: ast.set ? ast.set.map((assignment) => ({ ...assignment, value: rewriteExpr(assignment.value, scope, notes) as AstExpr })) : ast.set,
    where: ast.where ? (rewriteExpr(ast.where, scope, notes) as AstExpr) : ast.where,
  };
  return out;
}
