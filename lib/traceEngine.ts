// Deep import: sqlite-only build, see lib/parser.ts.
import { Parser } from 'node-sql-parser/build/sqlite';
import type { AstExpr, FromItem, SelectAst } from './parser';
import { groupByExprs, hasNestedSelect, queryTableNames } from './parser';
import type { TableMeta } from './schemas';
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
  | 'orderLimit';

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
  /** Current pipeline rows as table -> rowid maps, for click provenance. */
  tuples?: Array<Record<string, number | null>>;
  /** For select/orderLimit steps: result row index -> contributing rowids per table. */
  resultRowSources?: Array<Record<string, number[]>>;
  /** Character range of the clause in the original query text (for editor highlight). */
  queryRange?: { start: number; end: number };
}

export class TraceError extends Error {}


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
  return sql.replace(/^SELECT\s+/i, '');
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

function fmtRef(ctx: EngineCtx, i: number): string {
  const f = ctx.from[i];
  return f.as ? `${f.table!} ${f.as}` : f.table!;
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
      s += ` ${join} ${fmtRef(ctx, i)} ON ${exprSql(f.on as AstExpr)}`;
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

/** Run the pipeline through join k (+ optional WHERE) selecting only rowids. */
function execTuples(ctx: EngineCtx, k: number, where: string | null): Array<Record<string, number | null>> {
  const cols = ctx.refs
    .slice(0, k + 1)
    .map((r, i) => `${r.alias}.rowid AS k${i}`)
    .join(', ');
  const sql = `SELECT ${cols} FROM ${fromClause(ctx, k)}${where ? ` WHERE ${where}` : ''}`;
  const { rows } = exec(ctx, sql);
  return rows.map((row) => {
    const tuple: Record<string, number | null> = {};
    for (let i = 0; i <= k; i++) {
      const v = row[i];
      tuple[ctx.refs[i].alias] = v === null || v === undefined ? null : Number(v);
    }
    return tuple;
  });
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
  const { rows } = exec(ctx, `SELECT rowid FROM "${table}" ORDER BY rowid`);
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
}

function buildSelectList(ctx: EngineCtx): SelectItem[] {
  const cols = ctx.ast.columns;
  const expandStar = (onlyAlias?: string): SelectItem[] =>
    ctx.refs
      .filter((r) => !onlyAlias || r.alias === onlyAlias)
      .flatMap((r) => {
        const meta = ctx.schema.find((t) => t.name === r.table);
        return (meta?.columns ?? []).map((c) => ({ sql: `${r.alias}.${c.name}` }));
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
    out.push({ sql: c.as ? `${base} AS \`${c.as}\`` : base });
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

function astContainsType(node: unknown, type: string): boolean {
  if (node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((child) => astContainsType(child, type));
  const obj = node as Record<string, unknown>;
  if (obj.type === 'select') return false;
  return obj.type === type || Object.values(obj).some((child) => astContainsType(child, type));
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

function buildSubqueryPrelude(ast: SelectAst, db: SqlExec, schema: TableMeta[]): TraceStep[] {
  const nested = collectNestedSelects([
    ast.columns,
    ast.from?.map((item) => item.expr),
    ast.where,
    ast.groupby,
    ast.having,
    ast.orderby,
  ]);
  return nested.map((child, index) => {
    const childSql = sqlifyParser.sqlify(child as never, SQLIFY_OPT);
    const activeTables = Array.from(new Set(queryTableNames(child))).map(
      (name) => resolveTable(schema, name).name
    );
    let partialResult: { columns: string[]; rows: unknown[][] } | undefined;
    let correlated = false;
    try {
      partialResult = limitPreview(directExec(db, childSql));
    } catch {
      correlated = true;
    }
    return {
      stage: 'subquery' as const,
      label: `${correlated ? 'CORRELATED ' : ''}SUBQUERY ${index + 1}${partialResult ? ` - ${partialResult.rows.length} rows` : ''}`,
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

  steps.push(...buildSubqueryPrelude(ast, db, schema));

  if (ast._next) {
    let branch: SelectAst | null | undefined = ast;
    let branchIndex = 1;
    while (branch) {
      const isolated = { ...branch, _next: null, set_op: null };
      const branchSql = sqlifyParser.sqlify(isolated as never, SQLIFY_OPT);
      const partialResult = limitPreview(directExec(db, branchSql));
      steps.push({
        stage: 'union',
        label: `UNION BRANCH ${branchIndex} - ${partialResult.rows.length} rows`,
        narration: `This SELECT produces branch ${branchIndex}. UNION combines compatible branch columns; UNION removes duplicates while UNION ALL keeps them.`,
        ...base,
        partialResult,
      });
      branch = branch._next;
      branchIndex++;
    }
  }

  const sql = sqlifyParser.sqlify(ast as never, SQLIFY_OPT);
  const result = directExec(db, sql);
  steps.push({
    stage: ast._next ? 'union' : 'select',
    label: `${ast._next ? String(ast.set_op ?? 'UNION').toUpperCase() : 'SELECT'} - ${result.rows.length} final rows`,
    narration: ast._next
      ? 'The branch rows are combined now. Corresponding columns must be compatible, and the final ORDER BY—if present—uses names from the first SELECT.'
      : 'The outer query consumes the subquery result and produces the final rows. The displayed result is executed directly by SQLite.',
    ...base,
    partialResult: result,
  });
  return steps;
}

/**
 * Decompose a parsed SELECT into visual execution stages.
 * Pure with respect to inputs: (ast, db, schema) -> TraceStep[].
 */
export function buildTrace(ast: SelectAst, db: SqlExec, schema: TableMeta[]): TraceStep[] {
  const hasDerivedTable = (ast.from ?? []).some((item) => !!item.expr);
  if (ast._next || hasDerivedTable) return buildAdvancedTrace(ast, db, schema);

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
  const basePks = allPks(ctx, refs[0].table);
  let tuples: Array<Record<string, number | null>> = Array.from(basePks).map((pk) => ({
    [refs[0].alias]: pk,
  }));
  let lit: Record<string, Set<number>> = { [refs[0].table]: new Set(basePks) };

  steps.push({
    stage: 'from',
    label: `FROM ${refs[0].table} - ${basePks.size} rows`,
    narration: `Execution starts with the ${refs[0].table} table. All ${basePks.size} of its rows are candidates until a later clause removes them.`,
    activeTables: [refs[0].table],
    activeColumns: [],
    activeEdges: [],
    litRows: cloneSets(lit),
    dimmedRows: {},
    tuples,
    partialResult: exec(ctx, `SELECT * FROM ${fmtRef(ctx, 0)}`),
  });

  // ---- Stage: JOIN (one step per join) ----------------------------------
  for (let i = 1; i <= nJoins; i++) {
    const f = from[i];
    const joinType = f.join ? f.join.toUpperCase() : 'CROSS JOIN';
    const onSql = f.on ? exprSql(f.on) : null;
    tuples = execTuples(ctx, i, null);
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
      : `The comma-style join first forms a Cartesian product with ${matches} row combinations. The WHERE clause must then keep only the related pairs.`;
    if (onSql && (joinType.startsWith('LEFT') || joinType.startsWith('RIGHT'))) {
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
      partialResult: limitPreview(exec(ctx, `SELECT * FROM ${fromClause(ctx, i)}`)),
    });
    lit = nextLit;
  }

  // ---- Stage: WHERE ------------------------------------------------------
  if (ctx.whereSql) {
    tuples = execTuples(ctx, nJoins, ctx.whereSql);
    const nextLit = litFromTuples(ctx, tuples);
    const dimmed = diffSets(lit, nextLit);
    const cut = Object.values(dimmed).reduce((n, s) => n + s.size, 0);
    const kept = tuples.length;

    steps.push({
      stage: 'where',
      label: `WHERE ${ctx.whereSql} - ${kept} rows pass`,
      narration: `The condition ${ctx.whereSql} is tested against every row. ${kept} ${kept === 1 ? 'row passes' : 'rows pass'}; ${cut} ${cut === 1 ? 'row fades' : 'rows fade'} out because the condition is false for them.`,
      activeTables: allTableNames,
      activeColumns: resolveColumnRefs(ctx, ast.where),
      activeEdges: ast.where ? edgesForOn(ctx, ast.where) : [],
      litRows: cloneSets(nextLit),
      dimmedRows: dimmed,
      nullExtendedRows: nullExtendedFromTuples(ctx, tuples),
      tuples,
      partialResult: limitPreview(
        exec(ctx, `SELECT * FROM ${fromClause(ctx, nJoins)} WHERE ${ctx.whereSql}`)
      ),
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
    const csel = refs.map((r, i) => `GROUP_CONCAT(${r.alias}.rowid) AS __pks${i}`);
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
  const scalarAggregate =
    !ctx.groupExprSqls &&
    typeof ast.columns !== 'string' &&
    ast.columns.some((column) => astContainsType(column.expr, 'aggr_func'));
  const groupedProvenance = !!ctx.groupExprSqls || scalarAggregate;
  const provCols = groupedProvenance
    ? refs.map((r, i) => `GROUP_CONCAT(${r.alias}.rowid) AS __prov${i}`)
    : refs.map((r, i) => `${r.alias}.rowid AS __prov${i}`);

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
    label: `SELECT ${ast.distinct ? 'DISTINCT ' : ''}${selectItems.map((s) => s.sql).join(', ')} - ${proj.displayRows.length} rows`,
    narration: ctx.groupExprSqls
      ? `Each surviving group collapses into a single result row, and only the requested expressions are kept. Aggregates like COUNT and AVG are computed per group.`
      : scalarAggregate
        ? `The scalar aggregate collapses all surviving rows into one result value. Every source row contributes to that value.`
        : ast.distinct
          ? `Projection keeps the requested columns, then DISTINCT removes duplicate result rows while preserving their contributing sources.`
      : `Projection keeps only the requested columns. Each result row on the right traces back to the highlighted source rows; click a result row to see them.`,
    activeTables: allTableNames,
    activeColumns: resolveColumnRefs(
      ctx,
      typeof ast.columns === 'string' ? null : ast.columns.map((c) => c.expr)
    ),
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
      label: `${ob ? `ORDER BY${ob.replace(/^ ORDER BY/, '')}` : ''}${ob && lim ? ' ' : ''}${lim ? lim.trim() : ''} - ${finalRes.displayRows.length} final rows`,
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
