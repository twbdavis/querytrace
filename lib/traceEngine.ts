// Deep import: sqlite-only build, see lib/parser.ts.
import { Parser } from 'node-sql-parser/build/sqlite';
import type { AstExpr, FromItem, MutationAst, ParseOutcome, SelectAst } from './parser';
import { cteItems, cteNames, containsAggregate, groupByExprs, hasNestedSelect, queryTableNames } from './parser';
import { tidyWindowSql } from './dialect';
import type { TableMeta } from './schemas';
import { maskSql, quoteIdent } from './sqlText';
import { GROUP_PALETTE } from '../styles/theme';

/** Minimal executor interface so the engine is pure and unit-testable. */
export interface SqlExec {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
}

export type Stage =
  | 'from'
  | 'join'
  | 'where'
  | 'groupBy'
  | 'having'
  | 'subquery'
  | 'union'
  | 'select'
  | 'orderLimit'
  | 'modify';

export interface ColumnRef {
  table: string;
  column: string;
}

export interface TraceStep {
  stage: Stage;
  label: string;
  narration: string;
  activeTables: string[];
  activeColumns: ColumnRef[];
  activeEdges: string[];
  litRows: Record<string, Set<number>>;
  dimmedRows: Record<string, Set<number>>;
  groupColors?: Record<string, Record<number, string>>;
  partialResult?: { columns: string[]; rows: unknown[][] };
  /** Rows kept by an outer join despite having no match (dashed border). */
  nullExtendedRows?: Record<string, Set<number>>;
  /** Current pipeline rows as alias -> rowid maps, for click provenance. */
  tuples?: Array<Record<string, number | null>>;
  /** Alias (as written in FROM) -> canonical table name for every key in `tuples`. */
  tupleTables?: Record<string, string>;
  /** Displayed row index -> contributing rowids per table, at every traceable stage. */
  resultRowSources?: Array<Record<string, number[]>>;
  /** Character range of the clause in the original query text (for editor highlight). */
  queryRange?: { start: number; end: number };
  /**
   * Table contents to display while this step is shown, when they differ from
   * the live tables: the state before a data-changing statement ran.
   */
  tableSnapshots?: Record<string, TableSnapshot>;
}

/** A table's rows at one moment, shaped exactly like the live table data the canvas draws. */
export interface TableSnapshot {
  columns: string[];
  rows: unknown[][];
  /** SQLite rowid per row; the canvas and provenance are keyed by it. */
  rids: number[];
}

/** What a data-changing statement did, so the app can refresh tables and storage. */
export interface MutationResult {
  /** Every table's rows after the statement (cascades can touch several tables). */
  tableData: Record<string, TableSnapshot>;
  /** Tables whose rows differ from before. */
  changedTables: string[];
}

export interface StatementTrace {
  steps: TraceStep[];
  mutation?: MutationResult;
}

export interface TraceOptions {
  /**
   * Called after a data-changing statement ran but before it is kept; throw to
   * reject the change (the statement is rolled back and the message shown).
   */
  enforce?: () => void;
  /** Whether the change outlives the session (custom schemas are saved; bundled ones reset on reload). */
  persistent?: boolean;
}

export class TraceError extends Error {}

function rowCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'row' : 'rows'}`;
}

const SQLIFY_OPT = { database: 'sqlite' } as const;
const sqlifyParser = new Parser();

/** Render a single AST expression back to SQL by wrapping it in a dummy SELECT. */
function exprSql(expr: AstExpr): string {
  const dummy = {
    with: null,
    type: 'select',
    options: null,
    distinct: null,
    columns: [{ expr, as: null }],
    from: null,
    where: null,
    groupby: null,
    having: null,
    orderby: null,
    limit: null,
  };
  const sql = sqlifyParser.sqlify(dummy as never, SQLIFY_OPT);
  return tidyWindowSql(sql.replace(/^SELECT\s+/i, ''));
}

/** Render a whole SELECT (with any CTEs) back to SQLite text. */
function selectSql(ast: SelectAst): string {
  return tidyWindowSql(sqlifyParser.sqlify(ast as never, SQLIFY_OPT));
}

/** Collect every column_ref in an expression tree. Table is alias-or-null here. */
function collectColumnRefs(node: unknown, out: Array<{ table: string | null; column: string }> = []) {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collectColumnRefs(n, out));
    return out;
  }
  const obj = node as Record<string, unknown>;
  if (obj.type === 'select') return out;
  if (obj.type === 'column_ref' && typeof obj.column !== 'undefined') {
    const col = typeof obj.column === 'string' ? obj.column : columnName(obj.column);
    if (col && col !== '*') {
      out.push({ table: typeof obj.table === 'string' ? obj.table : null, column: col });
    }
  }
  Object.values(obj).forEach((v) => collectColumnRefs(v, out));
  return out;
}

/** node-sql-parser sometimes nests column names: { expr: { value: 'name' } }. */
function columnName(col: unknown): string | null {
  if (typeof col === 'string') return col;
  if (col && typeof col === 'object') {
    const obj = col as Record<string, unknown>;
    if (typeof obj.value === 'string') return obj.value;
    if (obj.expr) return columnName(obj.expr);
  }
  return null;
}

function isStarColumn(expr: AstExpr): boolean {
  if (expr.type === 'star') return true;
  if (expr.type === 'column_ref') {
    const col = (expr as Record<string, unknown>).column;
    return col === '*' || columnName(col) === '*';
  }
  return false;
}

interface TableRef {
  /** Canonical table name (schema casing). */
  table: string;
  /** SQL alias (or table name as written) used in generated queries. */
  alias: string;
}

interface EngineCtx {
  ast: SelectAst;
  db: SqlExec;
  schema: TableMeta[];
  from: FromItem[];
  refs: TableRef[];
  aliasToTable: Record<string, string>;
  whereSql: string | null;
  groupExprSqls: string[] | null;
  havingSql: string | null;
}

function resolveTable(schema: TableMeta[], table: string): TableMeta {
  const meta = schema.find((t) => t.name.toLowerCase() === table.toLowerCase());
  if (!meta) {
    throw new TraceError(
      `Unknown table "${table}". Tables in this schema: ${schema.map((t) => t.name).join(', ')}.`
    );
  }
  return meta;
}

/** Table reference as SQLite must see it: canonical name, quoted, plus the query's alias. */
function fmtRef(ctx: EngineCtx, i: number): string {
  const ref = ctx.refs[i];
  const table = quoteIdent(ref.table);
  return ref.alias.toLowerCase() === ref.table.toLowerCase() ? table : `${table} AS ${quoteIdent(ref.alias)}`;
}

/** `alias.column`, quoted so reserved words and spaces survive. */
function qualified(alias: string, column: string): string {
  return `${quoteIdent(alias)}.${quoteIdent(column)}`;
}

/** FROM clause including joins 1..k. */
function fromClause(ctx: EngineCtx, k: number): string {
  let s = fmtRef(ctx, 0);
  for (let i = 1; i <= k; i++) {
    const f = ctx.from[i];
    if (!f.join) {
      s += `, ${fmtRef(ctx, i)}`;
    } else {
      const join = f.join.toUpperCase();
      s += ` ${join} ${fmtRef(ctx, i)}`;
      if (f.on) s += ` ON ${exprSql(f.on as AstExpr)}`;
    }
  }
  return s;
}

function exec(ctx: EngineCtx, sql: string): { columns: string[]; rows: unknown[][] } {
  let res: Array<{ columns: string[]; values: unknown[][] }>;
  try {
    res = ctx.db.exec(sql);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TraceError(`SQL error: ${msg}`);
  }
  if (res.length === 0) return { columns: [], rows: [] };
  return { columns: res[0].columns, rows: res[0].values };
}

/** Read values and provenance together: separate SELECTs can use different scan orders. */
function execPipeline(ctx: EngineCtx, k: number, where: string | null) {
  const refs = ctx.refs.slice(0, k + 1);
  const cols = refs
    .map((r, i) => `${quoteIdent(r.alias)}._rowid_ AS k${i}`)
    .join(', ');
  const sql = `SELECT *, ${cols} FROM ${fromClause(ctx, k)}${where ? ` WHERE ${where}` : ''}`;
  const { columns, rows } = exec(ctx, sql);
  const displayWidth = Math.max(0, columns.length - refs.length);
  const sources: Array<Record<string, number[]>> = [];
  const displayRows: unknown[][] = [];
  const tuples = rows.map((row) => {
    const tuple: Record<string, number | null> = {};
    const source: Record<string, number[]> = {};
    for (let i = 0; i <= k; i++) {
      const v = row[displayWidth + i];
      const rid = v === null || v === undefined ? null : Number(v);
      tuple[refs[i].alias] = rid;
      const rids = (source[refs[i].table] ??= []);
      if (rid !== null && !rids.includes(rid)) rids.push(rid);
    }
    sources.push(source);
    displayRows.push(row.slice(0, displayWidth));
    return tuple;
  });
  // The results UI windows large tables. Keeping the complete stage lets a
  // pinned source row beyond the old 60-row preview remain reachable.
  return { tuples, sources, result: { columns: columns.slice(0, displayWidth), rows: displayRows } };
}

function litFromTuples(ctx: EngineCtx, tuples: Array<Record<string, number | null>>): Record<string, Set<number>> {
  const lit: Record<string, Set<number>> = {};
  for (const tuple of tuples) {
    for (const [alias, pk] of Object.entries(tuple)) {
      if (pk === null) continue;
      const table = ctx.aliasToTable[alias.toLowerCase()] ?? alias;
      (lit[table] ??= new Set()).add(pk);
    }
  }
  return lit;
}

/** Rows kept by an outer join without a partner: any tuple containing a NULL pk. */
function nullExtendedFromTuples(
  ctx: EngineCtx,
  tuples: Array<Record<string, number | null>>
): Record<string, Set<number>> | undefined {
  const out: Record<string, Set<number>> = {};
  let found = false;
  for (const tuple of tuples) {
    const hasNull = Object.values(tuple).some((v) => v === null);
    if (!hasNull) continue;
    for (const [alias, pk] of Object.entries(tuple)) {
      if (pk === null) continue;
      const table = ctx.aliasToTable[alias.toLowerCase()] ?? alias;
      (out[table] ??= new Set()).add(pk);
      found = true;
    }
  }
  return found ? out : undefined;
}

function diffSets(prev: Record<string, Set<number>>, next: Record<string, Set<number>>): Record<string, Set<number>> {
  const dimmed: Record<string, Set<number>> = {};
  for (const [table, pks] of Object.entries(prev)) {
    const kept = next[table] ?? new Set<number>();
    const gone = new Set<number>();
    pks.forEach((pk) => {
      if (!kept.has(pk)) gone.add(pk);
    });
    if (gone.size) dimmed[table] = gone;
  }
  return dimmed;
}

function allPks(ctx: EngineCtx, table: string): Set<number> {
  const { rows } = exec(ctx, `SELECT _rowid_ FROM ${quoteIdent(table)} ORDER BY _rowid_`);
  return new Set(rows.map((r) => Number(r[0])));
}

function resolveColumnRefs(ctx: EngineCtx, node: unknown): ColumnRef[] {
  const raw = collectColumnRefs(node);
  const out: ColumnRef[] = [];
  const seen = new Set<string>();
  for (const ref of raw) {
    let table = ref.table ? ctx.aliasToTable[ref.table.toLowerCase()] : undefined;
    if (!table) {
      // Unqualified column (or a select-list alias): find the owning table if unique.
      const owners = ctx.refs.filter((r) =>
        ctx.schema
          .find((t) => t.name === r.table)
          ?.columns.some((c) => c.name.toLowerCase() === ref.column.toLowerCase())
      );
      if (owners.length !== 1) continue;
      table = owners[0].table;
    }
    // Canonicalize column casing to the schema's spelling.
    const meta = ctx.schema.find((t) => t.name === table);
    const column =
      meta?.columns.find((c) => c.name.toLowerCase() === ref.column.toLowerCase())?.name ??
      ref.column;
    const key = `${table}.${column}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ table, column });
    }
  }
  return out;
}

/** Find the FK edge (if any) that a join's ON condition travels along. */
function edgesForOn(ctx: EngineCtx, on: AstExpr): string[] {
  const pairs: Array<[ColumnRef, ColumnRef]> = [];
  const walk = (node: unknown) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.type === 'binary_expr' && obj.operator === '=') {
      const left = resolveColumnRefs(ctx, obj.left);
      const right = resolveColumnRefs(ctx, obj.right);
      if (left.length === 1 && right.length === 1) pairs.push([left[0], right[0]]);
    }
    Object.values(obj).forEach(walk);
  };
  walk(on);

  const edges: string[] = [];
  for (const [a, b] of pairs) {
    for (const [child, parent] of [
      [a, b],
      [b, a],
    ] as Array<[ColumnRef, ColumnRef]>) {
      const meta = ctx.schema.find((t) => t.name === child.table);
      const col = meta?.columns.find((c) => c.name === child.column);
      if (col?.fk && col.fk.table === parent.table && col.fk.column === parent.column) {
        edges.push(`${child.table}.${child.column}->${parent.table}.${parent.column}`);
      }
    }
  }
  return Array.from(new Set(edges));
}

interface SelectItem {
  sql: string;
  columns: ColumnRef[];
}

function buildSelectList(ctx: EngineCtx): SelectItem[] {
  const cols = ctx.ast.columns;
  const expandStar = (onlyAlias?: string): SelectItem[] =>
    ctx.refs
      .filter((r) => !onlyAlias || r.alias.toLowerCase() === onlyAlias.toLowerCase())
      .flatMap((r) => {
        const meta = ctx.schema.find((t) => t.name === r.table);
        return (meta?.columns ?? []).map((c) => ({
          sql: qualified(r.alias, c.name),
          columns: [{ table: r.table, column: c.name }],
        }));
      });

  if (typeof cols === 'string') return expandStar();

  const out: SelectItem[] = [];
  for (const c of cols) {
    if (isStarColumn(c.expr)) {
      const t = (c.expr as Record<string, unknown>).table;
      out.push(...expandStar(typeof t === 'string' ? t : undefined));
      continue;
    }
    const base = exprSql(c.expr);
    out.push({ sql: c.as ? `${base} AS \`${c.as}\`` : base, columns: resolveColumnRefs(ctx, c.expr) });
  }
  return out;
}

function orderBySql(ctx: EngineCtx): string {
  const ob = ctx.ast.orderby;
  if (!ob || ob.length === 0) return '';
  const parts = ob.map((o) => `${exprSql(o.expr)}${o.type ? ` ${o.type}` : ''}`);
  return ` ORDER BY ${parts.join(', ')}`;
}

function limitSql(ctx: EngineCtx): string {
  const lim = ctx.ast.limit;
  if (!lim || !lim.value || lim.value.length === 0) return '';
  const vals = lim.value.map((v) => v.value);
  if (vals.length === 1) return ` LIMIT ${vals[0]}`;
  if ((lim.seperator ?? '').toLowerCase() === 'offset') return ` LIMIT ${vals[0]} OFFSET ${vals[1]}`;
  return ` LIMIT ${vals[0]}, ${vals[1]}`;
}

function parsePkList(v: unknown): number[] {
  if (v === null || v === undefined || v === '') return [];
  return Array.from(new Set(String(v).split(',').map(Number).filter((n) => !Number.isNaN(n))));
}

function resultKey(row: unknown[]): string {
  return JSON.stringify(row.map((value) => [value === null ? 'null' : typeof value, value]));
}

function directExec(db: SqlExec, sql: string): { columns: string[]; rows: unknown[][] } {
  try {
    const result = db.exec(sql);
    return result.length
      ? { columns: result[0].columns, rows: result[0].values }
      : { columns: [], rows: [] };
  } catch (error) {
    throw new TraceError(`SQL error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function collectNestedSelects(node: unknown, out: SelectAst[] = []): SelectAst[] {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => collectNestedSelects(child, out));
    return out;
  }
  const obj = node as Record<string, unknown>;
  if (obj.type === 'select') {
    out.push(obj as unknown as SelectAst);
    return out;
  }
  Object.values(obj).forEach((child) => collectNestedSelects(child, out));
  return out;
}

/**
 * One step per CTE, in declaration order: each is run with the CTEs declared
 * before it, so a CTE that builds on another shows its own rows.
 */
function buildCtePrelude(ast: SelectAst, db: SqlExec, schema: TableMeta[]): TraceStep[] {
  const items = cteItems(ast);
  return items.map((cte, index) => {
    const probe = {
      with: items.slice(0, index + 1),
      type: 'select',
      options: null,
      distinct: null,
      columns: [{ expr: { type: 'star', value: '*' }, as: null }],
      from: [{ db: null, table: cte.name.value, as: null }],
      where: null,
      groupby: null,
      having: null,
      orderby: null,
      limit: null,
    };
    const partialResult = limitPreview(directExec(db, selectSql(probe as unknown as SelectAst)));
    const earlier = new Set(items.slice(0, index).map((item) => item.name.value.toLowerCase()));
    const activeTables = Array.from(new Set(queryTableNames(cte.stmt.ast)))
      .filter((name) => !earlier.has(name.toLowerCase()))
      .map((name) => resolveTable(schema, name).name);
    return {
      stage: 'subquery' as const,
      label: `WITH ${cte.name.value} - ${rowCountLabel(partialResult.rows.length)}`,
      narration: `The common table expression ${cte.name.value} is evaluated first and behaves like a temporary table for the rest of the statement${index > 0 ? ', including any CTE declared after it' : ''}.`,
      activeTables,
      activeColumns: [],
      activeEdges: [],
      litRows: {},
      dimmedRows: {},
      partialResult,
    };
  });
}

function buildSubqueryPrelude(ast: SelectAst, db: SqlExec, schema: TableMeta[]): TraceStep[] {
  const nested = collectNestedSelects([
    ast.columns,
    ast.from?.map((item) => item.expr),
    ast.where,
    ast.groupby,
    ast.having,
    ast.orderby,
  ]);
  const ctes = cteNames(ast);
  return nested.map((child, index) => {
    const childSql = selectSql(child);
    const activeTables = Array.from(new Set(queryTableNames(child)))
      .filter((name) => !ctes.has(name.toLowerCase()))
      .map((name) => resolveTable(schema, name).name);
    let partialResult: { columns: string[]; rows: unknown[][] } | undefined;
    let correlated = false;
    try {
      // A subquery over a CTE needs the WITH clause in front of it to run alone.
      const standalone = ctes.size ? selectSql({ ...child, with: cteItems(ast) }) : childSql;
      partialResult = limitPreview(directExec(db, standalone));
    } catch {
      correlated = true;
    }
    return {
      stage: 'subquery' as const,
      label: `${correlated ? 'CORRELATED ' : ''}SUBQUERY ${index + 1}${partialResult ? ` - ${rowCountLabel(partialResult.rows.length)}` : ''}`,
      narration: correlated
        ? 'This correlated subquery is evaluated once for each candidate row from the outer query because it refers to an outer-table value.'
        : 'SQLite evaluates this inner SELECT first. Its result is then supplied to the surrounding query as a value, list, or derived table.',
      activeTables,
      activeColumns: [],
      activeEdges: [],
      litRows: {},
      dimmedRows: {},
      partialResult,
    };
  });
}

/**
 * UNION and subquery plans are executed faithfully by SQLite. Their internal
 * optimizer plan cannot be decomposed into reliable rowid stages, so expose
 * the course-level inner/branch results followed by the exact final result.
 */
function buildAdvancedTrace(ast: SelectAst, db: SqlExec, schema: TableMeta[]): TraceStep[] {
  const steps: TraceStep[] = [];
  const physicalTables = Array.from(new Set(queryTableNames(ast))).map(
    (name) => resolveTable(schema, name).name
  );
  const base = {
    activeTables: physicalTables,
    activeColumns: [] as ColumnRef[],
    activeEdges: [] as string[],
    litRows: {} as Record<string, Set<number>>,
    dimmedRows: {} as Record<string, Set<number>>,
  };

  steps.push(...buildCtePrelude(ast, db, schema));
  steps.push(...buildSubqueryPrelude(ast, db, schema));

  if (ast._next) {
    let branch: SelectAst | null | undefined = ast;
    let branchIndex = 1;
    while (branch) {
      const isolated = { ...branch, _next: null, set_op: null, with: cteItems(ast) };
      const branchSql = selectSql(isolated as unknown as SelectAst);
      const partialResult = limitPreview(directExec(db, branchSql));
      steps.push({
        stage: 'union',
        label: `UNION BRANCH ${branchIndex} - ${rowCountLabel(partialResult.rows.length)}`,
        narration: `This SELECT produces branch ${branchIndex}. UNION combines compatible branch columns; UNION removes duplicates while UNION ALL keeps them.`,
        ...base,
        partialResult,
      });
      branch = branch._next;
      branchIndex++;
    }
  }

  const sql = selectSql(ast);
  const result = directExec(db, sql);
  const hasCte = cteItems(ast).length > 0;
  steps.push({
    stage: ast._next ? 'union' : 'select',
    label: `${ast._next ? String(ast.set_op ?? 'UNION').toUpperCase() : 'SELECT'} - final ${rowCountLabel(result.rows.length)}`,
    narration: ast._next
      ? 'The branch rows are combined now. Corresponding columns must be compatible, and the final ORDER BY, if present, uses names from the first SELECT.'
      : hasCte
        ? 'The main SELECT reads the CTE results as if they were tables and produces the final rows. The displayed result is executed directly by SQLite.'
        : 'The outer query consumes the subquery result and produces the final rows. The displayed result is executed directly by SQLite.',
    ...base,
    partialResult: result,
  });
  return steps;
}

/** INTERSECT / EXCEPT (and mixed) compounds: SQLite runs the whole statement; each branch is previewed first. */
function buildCompoundTrace(
  branches: SelectAst[],
  operators: string[],
  sql: string,
  db: SqlExec,
  schema: TableMeta[]
): TraceStep[] {
  const physicalTables = Array.from(
    new Set(branches.flatMap((branch) => queryTableNames(branch).map((name) => resolveTable(schema, name).name)))
  );
  const base = {
    activeTables: physicalTables,
    activeColumns: [] as ColumnRef[],
    activeEdges: [] as string[],
    litRows: {} as Record<string, Set<number>>,
    dimmedRows: {} as Record<string, Set<number>>,
  };
  const steps: TraceStep[] = branches.map((branch, index) => {
    // ORDER BY / LIMIT written after the last branch apply to the whole compound.
    const isolated = index === branches.length - 1 ? { ...branch, orderby: null, limit: null } : branch;
    const partialResult = limitPreview(directExec(db, selectSql(isolated)));
    const operator = index === 0 ? null : operators[index - 1];
    return {
      stage: 'union' as const,
      label: `${operator ? `${operator} ` : ''}BRANCH ${index + 1} - ${rowCountLabel(partialResult.rows.length)}`,
      narration:
        index === 0
          ? 'This SELECT produces the first branch. Each branch must return the same number of columns.'
          : operator === 'INTERSECT'
            ? 'INTERSECT keeps only rows that appear in both branches (duplicates removed).'
            : operator === 'EXCEPT'
              ? 'EXCEPT keeps rows of the earlier result that do not appear in this branch (duplicates removed).'
              : 'UNION stacks this branch onto the earlier rows; UNION ALL keeps duplicates.',
      ...base,
      partialResult,
    };
  });
  const result = directExec(db, sql);
  const distinctOps = Array.from(new Set(operators)).join(' / ');
  steps.push({
    stage: 'union',
    label: `${distinctOps} - final ${rowCountLabel(result.rows.length)}`,
    narration: `The set operation${operators.length > 1 ? 's are' : ' is'} applied left to right, then any final ORDER BY and LIMIT. The displayed result is executed directly by SQLite.`,
    ...base,
    partialResult: result,
  });
  return steps;
}

/** A SELECT with no FROM clause (SELECT 1 + 1, SELECT NOW()): one stage, evaluated directly. */
function buildScalarTrace(ast: SelectAst, db: SqlExec): TraceStep[] {
  const result = directExec(db, selectSql(ast));
  return [
    {
      stage: 'select',
      label: `SELECT - ${rowCountLabel(result.rows.length)}`,
      narration: 'Without a FROM clause there are no source rows: each expression is evaluated once and returned as a single result row.',
      activeTables: [],
      activeColumns: [],
      activeEdges: [],
      litRows: {},
      dimmedRows: {},
      partialResult: result,
    },
  ];
}

/* ------------------------------------------------------------------------ */
/* Data-changing statements                                                  */
/* ------------------------------------------------------------------------ */

function snapshotTable(db: SqlExec, table: string): TableSnapshot {
  const res = directExec(db, `SELECT _rowid_ AS __rid, * FROM ${quoteIdent(table)} ORDER BY _rowid_`);
  return {
    columns: res.columns.slice(1),
    rows: res.rows.map((row) => row.slice(1)),
    rids: res.rows.map((row) => Number(row[0])),
  };
}

function snapshotAll(db: SqlExec, schema: TableMeta[]): Record<string, TableSnapshot> {
  return Object.fromEntries(schema.map((table) => [table.name, snapshotTable(db, table.name)]));
}

function sameRow(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]) || (value === null && b[index] === null));
}

interface TableDiff {
  inserted: number[];
  deleted: number[];
  modified: number[];
}

function diffSnapshots(before: TableSnapshot, after: TableSnapshot): TableDiff {
  const beforeRows = new Map(before.rids.map((rid, index) => [rid, before.rows[index]]));
  const afterRows = new Map(after.rids.map((rid, index) => [rid, after.rows[index]]));
  const diff: TableDiff = { inserted: [], deleted: [], modified: [] };
  for (const [rid, row] of afterRows) {
    const previous = beforeRows.get(rid);
    if (!previous) diff.inserted.push(rid);
    else if (!sameRow(previous, row)) diff.modified.push(rid);
  }
  for (const rid of beforeRows.keys()) if (!afterRows.has(rid)) diff.deleted.push(rid);
  return diff;
}

/** Turn SQLite's constraint messages into a sentence a learner can act on. */
function explainMutationError(message: string, statement: string, table: string): string {
  const verb = statement.toUpperCase();
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return statement === 'delete'
      ? `The ${verb} was rejected: other rows still refer to the ${table} rows you tried to remove (FOREIGN KEY constraint). Delete or update the dependent rows first, or declare ON DELETE CASCADE in the schema. No rows were changed.`
      : `The ${verb} was rejected: a foreign-key value does not match any row in the parent table (FOREIGN KEY constraint failed). Insert the parent row first or use an existing key. No rows were changed.`;
  }
  if (/UNIQUE constraint failed: ([\w."]+)/i.test(message)) {
    const column = message.match(/UNIQUE constraint failed: ([\w."]+)/i)![1];
    return `The ${verb} was rejected: ${column} already holds that value and must stay unique (primary keys and UNIQUE columns cannot repeat). No rows were changed.`;
  }
  if (/NOT NULL constraint failed: ([\w."]+)/i.test(message)) {
    const column = message.match(/NOT NULL constraint failed: ([\w."]+)/i)![1];
    return `The ${verb} was rejected: ${column} is declared NOT NULL, so it needs a value. No rows were changed.`;
  }
  if (/CHECK constraint failed/i.test(message)) {
    return `The ${verb} was rejected by a CHECK constraint on ${table}. No rows were changed.`;
  }
  if (/has (\d+) columns but (\d+) values were supplied/i.test(message)) {
    return `${message}. List the columns explicitly, INSERT INTO ${table} (col1, col2, ...) VALUES (...), or supply one value per column. No rows were changed.`;
  }
  return `${message.replace(/\.\s*$/, '')}. No rows were changed.`;
}

/** Character range of the statement head: the verb up to and including the table name. */
function headRange(sql: string): { start: number; end: number } | undefined {
  const match = maskSql(sql).match(/^\s*(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+(?:"[^"]*"|`[^`]*`|\[[^\]]*\]|\w+)(?:\s*\.\s*(?:"[^"]*"|`[^`]*`|\[[^\]]*\]|\w+))?/i);
  if (!match) return undefined;
  const start = match[0].length - match[0].trimStart().length;
  return { start, end: match[0].length };
}

/**
 * Trace INSERT / UPDATE / DELETE: the table before the change, the rows the
 * WHERE clause selects, then the applied change with every affected table.
 * The statement runs inside a savepoint and is rolled back when SQLite (or the
 * custom-schema limits) reject it, so a failed attempt never leaves partial data.
 */
function buildMutationTrace(
  statement: 'insert' | 'update' | 'delete',
  tableName: string,
  ast: MutationAst | null,
  sql: string,
  originalSql: string,
  db: SqlExec,
  schema: TableMeta[],
  options: TraceOptions
): StatementTrace {
  const table = resolveTable(schema, tableName).name;
  const meta = schema.find((t) => t.name === table)!;
  const verb = statement === 'insert' ? `INSERT INTO ${table}` : statement === 'update' ? `UPDATE ${table}` : `DELETE FROM ${table}`;

  // Column checks give the same friendly messages as SELECT gets.
  if (ast) {
    const fakeSelect: SelectAst = {
      type: 'select',
      columns: [
        ...(ast.set ?? []).map((assignment) => ({ expr: { type: 'column_ref', table: null, column: assignment.column }, as: null })),
        ...(ast.set ?? []).map((assignment) => ({ expr: assignment.value, as: null })),
      ],
      from: [{ db: null, table, as: ast.table?.[0]?.as ?? null }],
      where: ast.where ?? null,
      groupby: null,
      having: null,
      orderby: null,
      limit: null,
    };
    if (statement === 'insert' && Array.isArray(ast.columns)) {
      for (const column of ast.columns) {
        if (!meta.columns.some((c) => c.name.toLowerCase() === String(column).toLowerCase())) {
          throw new TraceError(`Unknown column "${column}" in ${table}. Its columns are: ${meta.columns.map((c) => c.name).join(', ')}.`);
        }
      }
    }
    validateColumnReferences(fakeSelect, schema);
    for (const child of collectNestedSelects(ast)) {
      for (const name of queryTableNames(child)) resolveTable(schema, name);
    }
  }

  const before = snapshotAll(db, schema);
  const tableBefore = before[table];
  const allRids = new Set(tableBefore.rids);
  const steps: TraceStep[] = [];
  const tupleTables = { [table]: table };
  const tuplesFor = (rids: number[]) => rids.map((rid) => ({ [table]: rid }));
  const rowsFor = (snapshot: TableSnapshot, rids: number[]) => {
    const index = new Map(snapshot.rids.map((rid, i) => [rid, i]));
    return rids.map((rid) => snapshot.rows[index.get(rid)!]).filter((row) => row !== undefined);
  };
  const sourcesFor = (rids: number[]) => rids.map((rid) => ({ [table]: [rid] }));

  steps.push({
    stage: 'from',
    label: `${verb} - ${rowCountLabel(tableBefore.rids.length)} before`,
    narration:
      statement === 'insert'
        ? `The ${table} table holds ${rowCountLabel(tableBefore.rids.length)} before the statement runs. New rows will be appended and must satisfy its keys and constraints.`
        : `${statement === 'update' ? 'UPDATE' : 'DELETE'} starts from every row of ${table}: all ${rowCountLabel(tableBefore.rids.length)} are candidates until the WHERE clause narrows them.`,
    activeTables: [table],
    activeColumns: [],
    activeEdges: [],
    litRows: statement === 'insert' ? {} : { [table]: new Set(allRids) },
    dimmedRows: {},
    tuples: statement === 'insert' ? undefined : tuplesFor(tableBefore.rids),
    tupleTables,
    partialResult: { columns: tableBefore.columns, rows: tableBefore.rows },
    resultRowSources: sourcesFor(tableBefore.rids),
    tableSnapshots: before,
    queryRange: headRange(originalSql),
  });

  // INSERT ... SELECT shows the rows it reads first.
  const source = maskSql(sql).match(/^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+\S+(?:\s*\([^)]*\))?\s+(?=(?:SELECT|WITH)\b)/i);
  if (statement === 'insert' && source) {
    const partialResult = limitPreview(directExec(db, sql.slice(source[0].length)));
    steps.push({
      stage: 'subquery',
      label: `SOURCE SELECT - ${rowCountLabel(partialResult.rows.length)}`,
      narration: 'INSERT ... SELECT reads its rows from another query first; each result row becomes one new row.',
      activeTables: Array.from(new Set(collectNestedSelects(ast).flatMap((child) => queryTableNames(child)).map((name) => resolveTable(schema, name).name))),
      activeColumns: [],
      activeEdges: [],
      litRows: {},
      dimmedRows: {},
      partialResult,
      tableSnapshots: before,
    });
  }

  let matched: number[] = tableBefore.rids;
  if (statement !== 'insert') {
    const whereSql = ast?.where ? exprSql(ast.where) : null;
    if (whereSql) {
      const alias = ast?.table?.[0]?.as;
      const fromSql = alias ? `${quoteIdent(table)} AS ${quoteIdent(alias)}` : quoteIdent(table);
      matched = exec({ db } as EngineCtx, `SELECT _rowid_ FROM ${fromSql} WHERE ${whereSql}`).rows.map((row) => Number(row[0]));
      const kept = new Set(matched);
      const dimmed = new Set([...allRids].filter((rid) => !kept.has(rid)));
      steps.push({
        stage: 'where',
        label: `WHERE ${whereSql} - ${rowCountLabel(matched.length)} ${matched.length === 1 ? 'matches' : 'match'}`,
        narration: `The condition ${whereSql} picks the rows the ${statement.toUpperCase()} will touch: ${rowCountLabel(matched.length)} ${matched.length === 1 ? 'matches' : 'match'}, ${dimmed.size} ${dimmed.size === 1 ? 'is' : 'are'} left alone.`,
        activeTables: [table],
        activeColumns: resolveColumnRefs(
          { schema, refs: [{ table, alias: alias ?? table }], aliasToTable: { [table.toLowerCase()]: table, ...(alias ? { [alias.toLowerCase()]: table } : {}) } } as EngineCtx,
          ast!.where
        ),
        activeEdges: [],
        litRows: { [table]: kept },
        dimmedRows: dimmed.size ? { [table]: dimmed } : {},
        tuples: tuplesFor(matched),
        tupleTables,
        partialResult: { columns: tableBefore.columns, rows: rowsFor(tableBefore, matched) },
        resultRowSources: sourcesFor(matched),
        tableSnapshots: before,
      });
    } else {
      steps.push({
        stage: 'where',
        label: `(no WHERE) - all ${rowCountLabel(matched.length)} selected`,
        narration: `There is no WHERE clause, so every row of ${table} is affected. Add WHERE key = value to change only specific rows.`,
        activeTables: [table],
        activeColumns: [],
        activeEdges: [],
        litRows: { [table]: new Set(allRids) },
        dimmedRows: {},
        tuples: tuplesFor(matched),
        tupleTables,
        partialResult: { columns: tableBefore.columns, rows: tableBefore.rows },
        resultRowSources: sourcesFor(matched),
        tableSnapshots: before,
      });
    }
  }

  // Apply inside a savepoint so a rejected statement leaves nothing behind.
  directExec(db, 'SAVEPOINT qt_mutation');
  try {
    directExec(db, sql);
    options.enforce?.();
  } catch (error) {
    directExec(db, 'ROLLBACK TO qt_mutation; RELEASE qt_mutation');
    // SQLite's own messages keep their "SQL error" prefix unless a friendlier
    // explanation applies; a limit rejection is already worded for the learner.
    const fromSqlite = error instanceof TraceError;
    const message = error instanceof Error ? error.message.replace(/^SQL error: /, '') : String(error);
    const explained = explainMutationError(message, statement, table);
    throw new TraceError(fromSqlite && explained.startsWith(message.replace(/\.\s*$/, '')) ? `SQL error: ${explained}` : explained);
  }
  directExec(db, 'RELEASE qt_mutation');

  const after = snapshotAll(db, schema);
  const diffs = Object.fromEntries(schema.map((t) => [t.name, diffSnapshots(before[t.name], after[t.name])]));
  const changedTables = schema.map((t) => t.name).filter((name) => {
    const diff = diffs[name];
    return diff.inserted.length + diff.deleted.length + diff.modified.length > 0;
  });
  const main = diffs[table];
  const lit: Record<string, Set<number>> = {};
  for (const name of changedTables) {
    const touched = [...diffs[name].inserted, ...diffs[name].modified];
    if (touched.length) lit[name] = new Set(touched);
  }

  const describe = (name: string, diff: TableDiff): string => {
    const parts: string[] = [];
    if (diff.inserted.length) parts.push(`${rowCountLabel(diff.inserted.length)} added`);
    if (diff.modified.length) parts.push(`${rowCountLabel(diff.modified.length)} changed`);
    if (diff.deleted.length) parts.push(`${rowCountLabel(diff.deleted.length)} removed`);
    return `${name}: ${parts.join(', ') || 'no change'}`;
  };
  const cascades = changedTables.filter((name) => name !== table);
  const summary =
    statement === 'insert'
      ? `${rowCountLabel(main.inserted.length)} added${main.modified.length ? `, ${rowCountLabel(main.modified.length)} replaced` : ''}`
      : statement === 'update'
        ? `${rowCountLabel(main.modified.length)} changed`
        : `${rowCountLabel(main.deleted.length)} removed`;
  const unchangedNote =
    statement === 'update' && matched.length > main.modified.length
      ? ` ${matched.length - main.modified.length} matched ${matched.length - main.modified.length === 1 ? 'row' : 'rows'} already held the new values.`
      : '';
  const cascadeNote = cascades.length
    ? ` Foreign-key rules also changed ${cascades.map((name) => describe(name, diffs[name])).join('; ')}.`
    : '';
  const persistence = options.persistent
    ? ' The change is saved with your custom schema.'
    : ' The change lives in this session: choose the schema again under SCHEMA to restore the original rows.';

  const shown = statement === 'delete' ? main.deleted : [...main.inserted, ...main.modified];
  const shownSnapshot = statement === 'delete' ? tableBefore : after[table];
  steps.push({
    stage: 'modify',
    label: `${verb} - ${summary}`,
    narration:
      (statement === 'insert'
        ? `SQLite appends the new ${main.inserted.length === 1 ? 'row' : 'rows'} after checking keys, NOT NULL and foreign-key constraints.`
        : statement === 'update'
          ? `The SET clause rewrites the matched rows in place; keys and constraints are checked on the new values.`
          : `The matched rows are removed from ${table}.`) +
      unchangedNote +
      cascadeNote +
      persistence,
    activeTables: changedTables.length ? changedTables : [table],
    activeColumns: statement === 'update' && ast?.set ? ast.set.map((assignment) => ({ table, column: meta.columns.find((c) => c.name.toLowerCase() === assignment.column.toLowerCase())?.name ?? assignment.column })) : [],
    activeEdges: [],
    litRows: lit,
    dimmedRows: {},
    tuples: statement === 'delete' ? undefined : tuplesFor(shown),
    tupleTables,
    partialResult: { columns: shownSnapshot.columns, rows: rowsFor(shownSnapshot, shown) },
    resultRowSources: statement === 'delete' ? undefined : sourcesFor(shown),
    queryRange: { start: 0, end: originalSql.length },
  });

  return { steps, mutation: { tableData: after, changedTables } };
}

/**
 * Trace any parsed statement. SELECTs get the stage-by-stage pipeline;
 * compounds and data changes get their own step sequences.
 */
export function traceStatement(
  parsed: Exclude<ParseOutcome, { ok: false }>,
  originalSql: string,
  db: SqlExec,
  schema: TableMeta[],
  options: TraceOptions = {}
): StatementTrace {
  if (parsed.kind === 'mutation') {
    return buildMutationTrace(parsed.statement, parsed.table, parsed.ast, parsed.sql, originalSql, db, schema, options);
  }
  if (parsed.kind === 'compound') {
    for (const branch of parsed.branches) {
      for (const name of queryTableNames(branch)) resolveTable(schema, name);
      validateColumnReferences(branch, schema);
    }
    return { steps: buildCompoundTrace(parsed.branches, parsed.operators, parsed.sql, db, schema) };
  }
  return { steps: buildTrace(parsed.ast, db, schema) };
}

interface Scope {
  /** alias (lowercase) -> canonical table name, for physical tables in this SELECT. */
  tables: Map<string, string>;
  /** Derived-table and CTE aliases (lowercase) -> their output columns, or null when they cannot be predicted. */
  derived: Map<string, string[] | null>;
  parent: Scope | null;
}

/**
 * The column names a SELECT produces, as SQLite would name them: an alias,
 * the column's own name, or the expression text. Null when a wildcard expands
 * a source whose columns are unknown.
 */
function outputColumns(
  select: SelectAst,
  columnsOfTable: (table: string) => string[] | null,
  scope: Scope
): string[] | null {
  const sourceColumns = (alias: string): string[] | null => {
    for (let s: Scope | null = scope; s; s = s.parent) {
      if (s.derived.has(alias)) return s.derived.get(alias) ?? null;
      const table = s.tables.get(alias);
      if (table) return columnsOfTable(table);
    }
    return null;
  };
  const fromAliases = (select.from ?? []).map((item) => (item.as ?? item.table ?? '').toLowerCase());
  const expandAll = (): string[] | null => {
    const out: string[] = [];
    for (const alias of fromAliases) {
      const columns = sourceColumns(alias);
      if (!columns) return null;
      out.push(...columns);
    }
    return out;
  };
  if (typeof select.columns === 'string') return expandAll();
  const out: string[] = [];
  for (const column of select.columns) {
    if (isStarColumn(column.expr)) {
      const qualifier = (column.expr as Record<string, unknown>).table;
      const expanded = typeof qualifier === 'string' ? sourceColumns(qualifier.toLowerCase()) : expandAll();
      if (!expanded) return null;
      out.push(...expanded);
      continue;
    }
    if (column.as) {
      out.push(column.as);
      continue;
    }
    if (column.expr.type === 'column_ref') {
      const name = columnName(column.expr.column);
      if (!name) return null;
      const qualifier = typeof column.expr.table === 'string' ? column.expr.table.toLowerCase() : null;
      const owners = qualifier ? [qualifier] : fromAliases;
      // Canonical spelling from the source when it is known.
      const canonical = owners
        .map((alias) => sourceColumns(alias)?.find((candidate) => candidate.toLowerCase() === name.toLowerCase()))
        .find((candidate) => !!candidate);
      out.push(canonical ?? name);
      continue;
    }
    out.push(exprSql(column.expr));
  }
  return out;
}

/**
 * SQLite reads an unknown double-quoted name as a string literal, so a typo
 * such as SELECT GIVEN_NAM would silently return the text 'GIVEN_NAM'. Check
 * every column reference against the loaded schema first and explain the miss.
 */
export function validateColumnReferences(ast: SelectAst, schema: TableMeta[]): void {
  const tableByName = new Map(schema.map((table) => [table.name.toLowerCase(), table]));
  const columnsOf = (table: string) =>
    tableByName.get(table.toLowerCase())?.columns.map((column) => column.name) ?? [];
  const hasColumn = (table: string, column: string) =>
    columnsOf(table).some((name) => name.toLowerCase() === column.toLowerCase());

  const lookupColumns = (table: string) => (tableByName.has(table.toLowerCase()) ? columnsOf(table) : null);
  const derivedHas = (columns: string[] | null | undefined, column: string) =>
    !!columns?.some((name) => name.toLowerCase() === column.toLowerCase());

  const check = (select: SelectAst, parent: Scope | null): Scope => {
    // CTE names act like derived tables for the whole statement; each CTE body
    // may itself read the CTEs declared before it.
    const ctes = cteItems(select);
    let outer = parent;
    if (ctes.length) {
      const cteScope: Scope = { tables: new Map(), derived: new Map(), parent };
      for (const cte of ctes) {
        const bodyScope = check(cte.stmt.ast, cteScope);
        cteScope.derived.set(cte.name.value.toLowerCase(), outputColumns(cte.stmt.ast, lookupColumns, bodyScope));
      }
      outer = cteScope;
    }
    const scope: Scope = { tables: new Map(), derived: new Map(), parent: outer };
    for (const item of select.from ?? []) {
      const alias = (item.as ?? item.table ?? '').toLowerCase();
      if (item.expr?.ast) {
        const innerScope = check(item.expr.ast, scope);
        scope.derived.set(alias, outputColumns(item.expr.ast, lookupColumns, innerScope));
      } else if (item.table) {
        const cteColumns = outer?.derived.get(item.table.toLowerCase());
        if (outer?.derived.has(item.table.toLowerCase())) {
          scope.derived.set(alias, cteColumns ?? null);
          continue;
        }
        const meta = tableByName.get(item.table.toLowerCase());
        if (meta) scope.tables.set(alias, meta.name);
      }
    }
    const visible = (node: unknown) => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(visible);
        return;
      }
      const obj = node as Record<string, unknown>;
      if (obj.type === 'select') {
        check(obj as unknown as SelectAst, scope);
        return;
      }
      if (obj.type === 'column_ref') {
        const column = columnName(obj.column);
        const qualifier = typeof obj.table === 'string' ? obj.table : null;
        if (column && column !== '*') verify(qualifier, column, scope);
      }
      Object.values(obj).forEach(visible);
    };
    // Derived tables in FROM were checked above; only their ON conditions remain.
    visible([select.columns, select.from?.map((item) => item.on), select.where, select.groupby, select.having, select.orderby]);
    if (select._next) check(select._next, parent);
    return scope;
  };

  const verify = (qualifier: string | null, column: string, scope: Scope) => {
    if (qualifier) {
      const key = qualifier.toLowerCase();
      for (let s: Scope | null = scope; s; s = s.parent) {
        if (s.derived.has(key)) {
          const columns = s.derived.get(key);
          if (columns && !derivedHas(columns, column)) {
            throw new TraceError(
              `Unknown column "${column}" in ${qualifier}. That subquery provides: ${columns.join(', ')}.`
            );
          }
          return;
        }
        const table = s.tables.get(key);
        if (table) {
          if (!hasColumn(table, column)) {
            throw new TraceError(
              `Unknown column "${column}" in ${table}. Its columns are: ${columnsOf(table).join(', ')}.`
            );
          }
          return;
        }
      }
      throw new TraceError(
        `"${qualifier}" is not a table or alias in this query's FROM clause, so ${qualifier}.${column} cannot be resolved.`
      );
    }
    // Unqualified: the nearest scope that has the column wins. Within one
    // scope, two tables offering the same name is an ambiguity SQLite would
    // refuse; explain which qualifier to add instead of echoing its error.
    const candidates: Array<{ name: string; columns: string[] }> = [];
    for (let s: Scope | null = scope; s; s = s.parent) {
      const derivedOwners = [...s.derived.entries()].filter(([, columns]) => derivedHas(columns, column));
      if (derivedOwners.length) return;
      // A subquery with unpredictable columns may supply the name; stay quiet.
      if ([...s.derived.values()].some((columns) => columns === null)) return;
      const owners = [...s.tables.entries()].filter(([, table]) => hasColumn(table, column));
      if (owners.length > 1) {
        const choices = owners.map(([alias, table]) => {
          const spelled = alias === table.toLowerCase() ? table : alias;
          return `${spelled}.${columnsOf(table).find((name) => name.toLowerCase() === column.toLowerCase()) ?? column}`;
        });
        throw new TraceError(
          `Column "${column}" exists in ${owners.map(([, table]) => table).join(' and ')}, so SQLite cannot tell which one you mean. Write ${choices.join(' or ')}.`
        );
      }
      if (owners.length) return;
      for (const table of s.tables.values()) candidates.push({ name: table, columns: columnsOf(table) });
      for (const [alias, columns] of s.derived) candidates.push({ name: `${alias} (subquery)`, columns: columns ?? [] });
    }
    if (column.toUpperCase() === 'ROWNUM') {
      throw new TraceError('ROWNUM is Oracle-specific. Use ORDER BY ... LIMIT n to keep the first n rows.');
    }
    const unique = candidates.filter((candidate, index) => candidates.findIndex((other) => other.name === candidate.name) === index);
    const names = unique.map((candidate) => candidate.name);
    const elsewhere = schema.filter((table) => !names.includes(table.name) && hasColumn(table.name, column)).map((table) => table.name);
    const hint = elsewhere.length ? ` ${elsewhere.join(' and ')} ${elsewhere.length === 1 ? 'has' : 'have'} a column with that name, but ${elsewhere.length === 1 ? 'it is' : 'they are'} not in this query's FROM clause.` : '';
    if (unique.length === 0) {
      throw new TraceError(`Unknown column "${column}": the query has no FROM clause, so there is no table to read it from.${hint}`);
    }
    throw new TraceError(
      `Unknown column "${column}". ${
        unique.length === 1
          ? `${unique[0].name} has: ${unique[0].columns.join(', ')}.`
          : `None of ${names.join(', ')} has a column with that name.`
      }${hint}`
    );
  };

  check(ast, null);
}

/**
 * Decompose a parsed SELECT into visual execution stages.
 * Pure with respect to inputs: (ast, db, schema) -> TraceStep[].
 */
export function buildTrace(ast: SelectAst, db: SqlExec, schema: TableMeta[]): TraceStep[] {
  for (const name of queryTableNames(ast)) resolveTable(schema, name);
  validateColumnReferences(ast, schema);
  if (!ast.from || ast.from.length === 0) {
    if (ast._next) return buildAdvancedTrace(ast, db, schema);
    return buildScalarTrace(ast, db);
  }
  const hasDerivedTable = (ast.from ?? []).some((item) => !!item.expr);
  if (ast._next || hasDerivedTable || cteItems(ast).length) return buildAdvancedTrace(ast, db, schema);

  const from = (ast.from ?? []) as FromItem[];
  const refs: TableRef[] = from.map((f) => ({
    table: resolveTable(schema, f.table!).name,
    alias: f.as ?? f.table!,
  }));
  const aliasToTable: Record<string, string> = {};
  refs.forEach((r) => {
    aliasToTable[r.alias.toLowerCase()] = r.table;
    aliasToTable[r.table.toLowerCase()] = r.table;
  });

  const ctx: EngineCtx = {
    ast,
    db,
    schema,
    from,
    refs,
    aliasToTable,
    whereSql: ast.where ? exprSql(ast.where) : null,
    groupExprSqls: null,
    havingSql: ast.having ? exprSql(ast.having) : null,
  };
  const groupExprs = groupByExprs(ast);
  ctx.groupExprSqls = groupExprs ? groupExprs.map((g) => exprSql(g)) : null;

  const steps: TraceStep[] = hasNestedSelect(ast) ? buildSubqueryPrelude(ast, db, schema) : [];
  const nJoins = from.length - 1;
  const allTableNames = Array.from(new Set(refs.map((r) => r.table)));

  // ---- Stage: FROM -------------------------------------------------------
  const basePipeline = execPipeline(ctx, 0, null);
  let tuples = basePipeline.tuples;
  const basePks = new Set(tuples.map((tuple) => tuple[refs[0].alias]!));
  let lit: Record<string, Set<number>> = { [refs[0].table]: new Set(basePks) };

  steps.push({
    stage: 'from',
    label: `FROM ${refs[0].table} - ${rowCountLabel(basePks.size)}`,
    narration: `Execution starts with the ${refs[0].table} table. All ${basePks.size} of its rows are candidates until a later clause removes them.`,
    activeTables: [refs[0].table],
    activeColumns: [],
    activeEdges: [],
    litRows: cloneSets(lit),
    dimmedRows: {},
    tuples,
    partialResult: basePipeline.result,
    resultRowSources: basePipeline.sources,
  });

  // ---- Stage: JOIN (one step per join) ----------------------------------
  for (let i = 1; i <= nJoins; i++) {
    const f = from[i];
    const joinType = f.join ? f.join.toUpperCase() : 'CROSS JOIN';
    const onSql = f.on ? exprSql(f.on) : null;
    const pipeline = execPipeline(ctx, i, null);
    tuples = pipeline.tuples;
    const nextLit = litFromTuples(ctx, tuples);
    const nullExt = nullExtendedFromTuples(ctx, tuples);

    // Diff previously-lit tables, and dim never-matched rows of the new table.
    const prevWithNew: Record<string, Set<number>> = {
      ...lit,
      [refs[i].table]: allPks(ctx, refs[i].table),
    };
    const dimmed = diffSets(prevWithNew, nextLit);

    const matches = tuples.filter((t) => Object.values(t).every((v) => v !== null)).length;
    const unmatched = nullExt ? Object.values(nullExt).reduce((n, s) => n + s.size, 0) : 0;

    let narration = onSql
      ? `For each surviving row, SQLite looks for rows in ${refs[i].table} where ${onSql} holds. ${matches} matched ${matches === 1 ? 'pair lights' : 'pairs light'} up along the key columns.`
      : `The ${f.join ? 'CROSS JOIN' : 'comma-style join'} first forms a Cartesian product with ${matches} row combinations. ${f.join ? 'Every row pairs with every row of the other table.' : 'The WHERE clause must then keep only the related pairs.'}`;
    if (onSql && /^(LEFT|RIGHT|FULL)\b/.test(joinType)) {
      narration += ` Because this is a ${joinType}, ${unmatched} unmatched ${unmatched === 1 ? 'row is' : 'rows are'} kept anyway and padded with NULLs (dashed border).`;
    } else if (onSql) {
      narration += ` Rows on either side with no partner are eliminated.`;
    }

    steps.push({
      stage: 'join',
      label: onSql
        ? `${joinType} ${refs[i].table} ON ${onSql} - ${matches} matches`
        : `CROSS JOIN ${refs[i].table} - ${matches} combinations`,
      narration,
      activeTables: refs.slice(0, i + 1).map((r) => r.table),
      activeColumns: resolveColumnRefs(ctx, f.on),
      activeEdges: f.on ? edgesForOn(ctx, f.on) : [],
      litRows: cloneSets(nextLit),
      dimmedRows: dimmed,
      nullExtendedRows: nullExt,
      tuples,
      partialResult: pipeline.result,
      resultRowSources: pipeline.sources,
    });
    lit = nextLit;
  }

  // ---- Stage: WHERE ------------------------------------------------------
  if (ctx.whereSql) {
    const pipeline = execPipeline(ctx, nJoins, ctx.whereSql);
    tuples = pipeline.tuples;
    const nextLit = litFromTuples(ctx, tuples);
    const dimmed = diffSets(lit, nextLit);
    const cut = Object.values(dimmed).reduce((n, s) => n + s.size, 0);
    const kept = tuples.length;

    steps.push({
      stage: 'where',
      label: `WHERE ${ctx.whereSql} - ${rowCountLabel(kept)} ${kept === 1 ? 'passes' : 'pass'}`,
      narration: `The condition ${ctx.whereSql} is tested against every row. ${kept} ${kept === 1 ? 'row passes' : 'rows pass'}; ${cut} ${cut === 1 ? 'row fades' : 'rows fade'} out because the condition is false for them.`,
      activeTables: allTableNames,
      activeColumns: resolveColumnRefs(ctx, ast.where),
      activeEdges: ast.where ? edgesForOn(ctx, ast.where) : [],
      litRows: cloneSets(nextLit),
      dimmedRows: dimmed,
      nullExtendedRows: nullExtendedFromTuples(ctx, tuples),
      tuples,
      partialResult: pipeline.result,
      resultRowSources: pipeline.sources,
    });
    lit = nextLit;
  }

  // ---- Stage: GROUP BY / HAVING -----------------------------------------
  interface GroupInfo {
    key: string;
    keyValues: unknown[];
    color: string;
    pksPerTable: Record<string, number[]>;
    count: number;
  }
  let groups: GroupInfo[] | null = null;
  let groupColorByKey: Record<string, string> = {};

  if (ctx.groupExprSqls) {
    const gN = ctx.groupExprSqls.length;
    const gsel = ctx.groupExprSqls.map((g, i) => `${g} AS __grp${i}`);
    const csel = refs.map((r, i) => `GROUP_CONCAT(${quoteIdent(r.alias)}._rowid_) AS __pks${i}`);
    const whereFrag = ctx.whereSql ? ` WHERE ${ctx.whereSql}` : '';
    const groupFrag = ` GROUP BY ${ctx.groupExprSqls.join(', ')}`;
    const baseSql = `SELECT ${[...gsel, ...csel].join(', ')}, COUNT(*) AS __cnt FROM ${fromClause(ctx, nJoins)}${whereFrag}${groupFrag}`;

    const readGroups = (sql: string): GroupInfo[] => {
      const { rows } = exec(ctx, sql);
      return rows.map((row, gi) => {
        const keyValues = row.slice(0, gN);
        const key = JSON.stringify(keyValues);
        const pksPerTable: Record<string, number[]> = {};
        refs.forEach((r, ri) => {
          pksPerTable[r.table] = Array.from(
            new Set([...(pksPerTable[r.table] ?? []), ...parsePkList(row[gN + ri])])
          );
        });
        return {
          key,
          keyValues,
          color: GROUP_PALETTE[gi % GROUP_PALETTE.length],
          pksPerTable,
          count: Number(row[gN + refs.length]),
        };
      });
    };

    groups = readGroups(baseSql);
    groups.forEach((g) => {
      groupColorByKey[g.key] = g.color;
    });

    const groupColors: Record<string, Record<number, string>> = {};
    for (const g of groups) {
      for (const [table, pks] of Object.entries(g.pksPerTable)) {
        for (const pk of pks) {
          (groupColors[table] ??= {})[pk] = g.color;
        }
      }
    }

    steps.push({
      stage: 'groupBy',
      label: `GROUP BY ${ctx.groupExprSqls.join(', ')} - ${groups.length} groups`,
      narration: `Surviving rows are bucketed by ${ctx.groupExprSqls.join(', ')}. ${groups.length} ${groups.length === 1 ? 'group forms' : 'groups form'}; every row wearing the same color belongs to the same group and will collapse into one result row.`,
      activeTables: allTableNames,
      activeColumns: resolveColumnRefs(ctx, groupExprs),
      activeEdges: [],
      litRows: cloneSets(lit),
      dimmedRows: {},
      groupColors,
      tuples,
      resultRowSources: groups.map((group) => group.pksPerTable),
      partialResult: {
        columns: [...ctx.groupExprSqls, 'COUNT(*)'],
        rows: groups.map((g) => [...g.keyValues, g.count]),
      },
    });

    if (ctx.havingSql) {
      const survivors = readGroups(`${baseSql} HAVING ${ctx.havingSql}`);
      const surviving = new Set(survivors.map((g) => g.key));
      // Keep the colors assigned in the GROUP BY step.
      survivors.forEach((g) => {
        g.color = groupColorByKey[g.key] ?? g.color;
      });

      const keptLit: Record<string, Set<number>> = {};
      const keptColors: Record<string, Record<number, string>> = {};
      for (const g of survivors) {
        for (const [table, pks] of Object.entries(g.pksPerTable)) {
          for (const pk of pks) {
            (keptLit[table] ??= new Set()).add(pk);
            (keptColors[table] ??= {})[pk] = g.color;
          }
        }
      }
      const dimmed = diffSets(lit, keptLit);
      const cutGroups = groups.length - survivors.length;

      steps.push({
        stage: 'having',
        label: `HAVING ${ctx.havingSql} - ${survivors.length} of ${groups.length} groups survive`,
        narration: `HAVING filters whole groups, not individual rows. ${survivors.length} ${survivors.length === 1 ? 'group satisfies' : 'groups satisfy'} ${ctx.havingSql}; ${cutGroups} ${cutGroups === 1 ? 'group fades' : 'groups fade'} out together with every row inside ${cutGroups === 1 ? 'it' : 'them'}.`,
        activeTables: allTableNames,
        activeColumns: resolveColumnRefs(ctx, ast.having),
        activeEdges: [],
        litRows: cloneSets(keptLit),
        dimmedRows: dimmed,
        groupColors: keptColors,
        tuples,
        resultRowSources: survivors.map((group) => group.pksPerTable),
        partialResult: {
          columns: [...ctx.groupExprSqls, 'COUNT(*)'],
          rows: survivors.map((g) => [...g.keyValues, g.count]),
        },
      });
      lit = keptLit;
      groups = survivors;
      groupColorByKey = Object.fromEntries(survivors.map((g) => [g.key, g.color]));
    }
  }

  // ---- Stage: SELECT (projection) ---------------------------------------
  const selectItems = buildSelectList(ctx);
  const nSel = selectItems.length;
  // Window functions (COUNT(*) OVER ...) are per-row values, not aggregates.
  const scalarAggregate =
    !ctx.groupExprSqls &&
    typeof ast.columns !== 'string' &&
    ast.columns.some((column) => containsAggregate(column.expr));
  const groupedProvenance = !!ctx.groupExprSqls || scalarAggregate;
  const provCols = groupedProvenance
    ? refs.map((r, i) => `GROUP_CONCAT(${quoteIdent(r.alias)}._rowid_) AS __prov${i}`)
    : refs.map((r, i) => `${quoteIdent(r.alias)}._rowid_ AS __prov${i}`);

  const coreFrom =
    `FROM ${fromClause(ctx, nJoins)}` +
    (ctx.whereSql ? ` WHERE ${ctx.whereSql}` : '') +
    (ctx.groupExprSqls ? ` GROUP BY ${ctx.groupExprSqls.join(', ')}` : '') +
    (ctx.havingSql && ctx.groupExprSqls ? ` HAVING ${ctx.havingSql}` : '');

  const selectSql = selectItems.map((s) => s.sql).join(', ');
  const projectionSql = `SELECT ${[selectSql, ...provCols].join(', ')} ${coreFrom}`;
  const displayProjectionSql = `SELECT ${ast.distinct ? 'DISTINCT ' : ''}${selectSql} ${coreFrom}`;

  const readResult = (sql: string) => {
    const { columns, rows } = exec(ctx, sql);
    const displayColumns = columns.slice(0, nSel);
    const displayRows = rows.map((r) => r.slice(0, nSel));
    const sources: Array<Record<string, number[]>> = rows.map((r) => {
      const src: Record<string, number[]> = {};
      refs.forEach((ref, ri) => {
        const v = r[nSel + ri];
        const pks = groupedProvenance
          ? parsePkList(v)
          : v === null || v === undefined
            ? []
            : [Number(v)];
        src[ref.table] = Array.from(new Set([...(src[ref.table] ?? []), ...pks]));
      });
      return src;
    });
    return { displayColumns, displayRows, sources };
  };

  const baseProj = readResult(projectionSql);
  const attachDistinctSources = (sql: string) => {
    const display = exec(ctx, sql);
    const sourceByRow = new Map<string, Record<string, Set<number>>>();
    baseProj.displayRows.forEach((row, index) => {
      const key = resultKey(row);
      const merged = sourceByRow.get(key) ?? {};
      for (const [table, pks] of Object.entries(baseProj.sources[index] ?? {})) {
        const target = (merged[table] ??= new Set<number>());
        pks.forEach((pk) => target.add(pk));
      }
      sourceByRow.set(key, merged);
    });
    return {
      displayColumns: display.columns,
      displayRows: display.rows,
      sources: display.rows.map((row) =>
        Object.fromEntries(
          Object.entries(sourceByRow.get(resultKey(row)) ?? {}).map(([table, pks]) => [
            table,
            [...pks],
          ])
        )
      ),
    };
  };

  const proj = ast.distinct ? attachDistinctSources(displayProjectionSql) : baseProj;
  const projLit: Record<string, Set<number>> = {};
  proj.sources.forEach((src) => {
    for (const [table, pks] of Object.entries(src)) {
      pks.forEach((pk) => (projLit[table] ??= new Set()).add(pk));
    }
  });

  steps.push({
    stage: 'select',
    label: `SELECT ${ast.distinct ? 'DISTINCT ' : ''}${selectItems.map((s) => s.sql).join(', ')} - ${rowCountLabel(proj.displayRows.length)}`,
    narration: ctx.groupExprSqls
      ? `Each surviving group collapses into a single result row, and only the requested expressions are kept. Aggregates like COUNT and AVG are computed per group.`
      : scalarAggregate
        ? `The scalar aggregate collapses all surviving rows into one result value. Every source row contributes to that value.`
        : ast.distinct
          ? `Projection keeps the requested columns, then DISTINCT removes duplicate result rows while preserving their contributing sources.`
      : `Projection keeps only the requested columns. Each result row on the right traces back to the highlighted source rows; click a result row to see them.`,
    activeTables: allTableNames,
    activeColumns: selectItems.flatMap((item) => item.columns),
    activeEdges: [],
    litRows: cloneSets(projLit),
    dimmedRows: diffSets(lit, projLit),
    groupColors: groups ? colorsFromGroups(groups) : undefined,
    tuples,
    resultRowSources: proj.sources,
    partialResult: { columns: proj.displayColumns, rows: proj.displayRows },
  });
  lit = projLit;

  // ---- Stage: ORDER BY / LIMIT ------------------------------------------
  const ob = orderBySql(ctx);
  const lim = limitSql(ctx);
  if (ob || lim) {
    const finalRes = ast.distinct
      ? attachDistinctSources(`${displayProjectionSql}${ob}${lim}`)
      : readResult(`${projectionSql}${ob}${lim}`);
    const finalLit: Record<string, Set<number>> = {};
    finalRes.sources.forEach((src) => {
      for (const [table, pks] of Object.entries(src)) {
        pks.forEach((pk) => (finalLit[table] ??= new Set()).add(pk));
      }
    });

    const pieces: string[] = [];
    if (ob) pieces.push(`rows are sorted by ${ob.replace(/^ ORDER BY /, '')}`);
    if (lim) pieces.push(`only the ${lim.replace(/^ LIMIT /, 'first ')} ${lim.includes(',') || lim.includes('OFFSET') ? 'window of rows is' : 'rows are'} kept`);

    steps.push({
      stage: 'orderLimit',
      label: `${ob ? `ORDER BY${ob.replace(/^ ORDER BY/, '')}` : ''}${ob && lim ? ' ' : ''}${lim ? lim.trim() : ''} - final ${rowCountLabel(finalRes.displayRows.length)}`,
      narration: `Finally, ${pieces.join(', and ')}. Sorting and limiting happen last, after filtering, grouping and projection are all done.`,
      activeTables: allTableNames,
      activeColumns: ast.orderby ? resolveColumnRefs(ctx, ast.orderby) : [],
      activeEdges: [],
      litRows: cloneSets(finalLit),
      dimmedRows: diffSets(lit, finalLit),
      groupColors: groups ? colorsFromGroups(groups) : undefined,
      tuples,
      resultRowSources: finalRes.sources,
      partialResult: { columns: finalRes.displayColumns, rows: finalRes.displayRows },
    });
  }

  // Tuples are keyed by the alias used in generated SQL; let the UI map each
  // alias back to the table node it belongs to (self-joins have two aliases).
  const tupleTables = Object.fromEntries(refs.map((r) => [r.alias, r.table]));
  for (const step of steps) if (step.tuples) step.tupleTables = tupleTables;

  return steps;

  function colorsFromGroups(gs: GroupInfo[]): Record<string, Record<number, string>> {
    const colors: Record<string, Record<number, string>> = {};
    for (const g of gs) {
      for (const [table, pks] of Object.entries(g.pksPerTable)) {
        for (const pk of pks) (colors[table] ??= {})[pk] = g.color;
      }
    }
    return colors;
  }
}

function cloneSets(rec: Record<string, Set<number>>): Record<string, Set<number>> {
  return Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, new Set(v)]));
}

function limitPreview(res: { columns: string[]; rows: unknown[][] }, max = 60) {
  return { columns: res.columns, rows: res.rows.slice(0, max) };
}
