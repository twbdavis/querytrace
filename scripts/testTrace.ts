/* End-to-end test of parser + trace engine against every preloaded schema,
   plus every lesson query. Run with: npm run test:trace */
import initSqlJs, { type Database } from 'sql.js';
import { parseQuery } from '../lib/parser';
import { buildTrace, type TraceStep } from '../lib/traceEngine';
import { introspectSchema } from '../lib/db';
import { PRELOADED_SCHEMAS, schemaById } from '../lib/schemas';
import { LESSONS } from '../lib/lessons';

function fmtStep(s: TraceStep): string {
  const lit = Object.entries(s.litRows)
    .map(([t, set]) => `${t}:${set.size}`)
    .join(' ');
  return `  [${s.stage.padEnd(10)}] ${s.label.slice(0, 90)}  lit={${lit}} result=${s.partialResult?.rows.length ?? '-'}`;
}

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${msg}`);
    failures++;
  }
}

async function main() {
  const SQL = await initSqlJs();
  const dbs = new Map<string, Database>();
  for (const def of PRELOADED_SCHEMAS) {
    const db = new SQL.Database();
    db.run(def.ddl);
    dbs.set(def.id, db);
  }

  // --- schema introspection ------------------------------------------------
  console.log('=== introspection');
  for (const def of PRELOADED_SCHEMAS) {
    const { schema, fkEdges } = introspectSchema(dbs.get(def.id)!);
    console.log(
      `  ${def.id}: tables=[${schema.map((t) => t.name).join(', ')}] fks=${fkEdges.length}`
    );
    assert(schema.length > 0, `${def.id} should have tables`);
    assert(
      schema.every((table) => table.columns.some((column) => column.pk)),
      `${def.id} relations should all have primary keys`
    );
    assert(
      (dbs.get(def.id)!.exec('PRAGMA foreign_key_check')[0]?.values.length ?? 0) === 0,
      `${def.id} should satisfy every foreign-key constraint`
    );
  }
  {
    const donor = introspectSchema(dbs.get('donor')!);
    assert(donor.fkEdges.length === 2, 'DONOR should have 2 FK edges');
    const gift = donor.schema.find((t) => t.name === 'GIFT');
    assert(
      !!gift && gift.columns.filter((c) => c.pk).map((c) => c.name).join(',') === 'YEAR,DONORNO',
      'GIFT has the workbook composite primary key YEAR + DONORNO'
    );
    const shares = introspectSchema(dbs.get('shares')!);
    assert(
      shares.schema[0].columns.find((c) => c.name === 'SHRCODE')?.pk === true,
      'SHARES text PK should be detected'
    );
  }
  {
    // Slidesets 3/4: composite PK/FK components, defaults, nullability and
    // referential integrity must survive schema introspection.
    const db = new SQL.Database();
    db.run('PRAGMA foreign_keys = ON');
    db.run(`
      CREATE TABLE PARENT (
        PART_A INTEGER,
        PART_B INTEGER,
        LABEL VARCHAR(20) NOT NULL DEFAULT 'unlabeled',
        PRIMARY KEY (PART_A, PART_B)
      );
      CREATE TABLE CHILD (
        CHILD_ID INTEGER PRIMARY KEY,
        PART_A INTEGER,
        PART_B INTEGER,
        CONSTRAINT child_parent_fk FOREIGN KEY (PART_A, PART_B)
          REFERENCES PARENT (PART_A, PART_B) ON DELETE CASCADE
      );
      INSERT INTO PARENT (PART_A, PART_B) VALUES (1, 2);
      INSERT INTO CHILD VALUES (10, 1, 2);
    `);
    const model = introspectSchema(db);
    const parent = model.schema.find((table) => table.name === 'PARENT');
    const child = model.schema.find((table) => table.name === 'CHILD');
    assert(parent?.columns.filter((column) => column.pk).length === 2, 'both composite PK columns are marked');
    assert(child?.columns.filter((column) => column.fk).length === 2, 'both composite FK columns are marked');
    assert(model.fkEdges.length === 2, 'composite FK renders one relationship wire per component');
    const label = parent?.columns.find((column) => column.name === 'LABEL');
    assert(label?.type === 'VARCHAR(20)' && !!label.notNull, 'data type and NOT NULL are introspected');
    assert(label?.defaultValue === "'unlabeled'", 'column DEFAULT is introspected');
    assert(child?.columns.find((column) => column.name === 'PART_A')?.fk?.onDelete === 'CASCADE', 'delete rule is introspected');
    assert(db.exec('SELECT LABEL FROM PARENT')[0].values[0][0] === 'unlabeled', 'DEFAULT value applies');
    let orphanRejected = false;
    try {
      db.run('INSERT INTO CHILD VALUES (11, 9, 9)');
    } catch {
      orphanRejected = true;
    }
    assert(orphanRejected, 'referential integrity rejects an orphan foreign key');
    db.run('DELETE FROM PARENT WHERE PART_A = 1 AND PART_B = 2');
    assert(Number(db.exec('SELECT COUNT(*) FROM CHILD')[0].values[0][0]) === 0, 'ON DELETE CASCADE removes dependents');
  }

  // --- every lesson query traces cleanly ------------------------------------
  console.log('\n=== lesson queries');
  for (const lesson of LESSONS) {
    const db = dbs.get(lesson.schemaId)!;
    const { schema } = introspectSchema(db);
    const parsed = parseQuery(lesson.query);
    if (!parsed.ok) {
      console.error(`  PARSE FAILED [${lesson.id}]: ${parsed.error}`);
      failures++;
      continue;
    }
    try {
      const steps = buildTrace(parsed.ast, db, schema);
      const last = steps[steps.length - 1];
      console.log(`  ${lesson.id} (${lesson.schemaId}): ${steps.length} steps, ${last.partialResult?.rows.length} result rows`);
      assert((last.partialResult?.rows.length ?? 0) > 0, `${lesson.id} should return rows`);
      if (!steps.some((step) => step.stage === 'subquery' || step.stage === 'union')) {
        assert(!!last.resultRowSources, `${lesson.id} should have provenance`);
      }
    } catch (err) {
      console.error(`  TRACE FAILED [${lesson.id}]: ${err instanceof Error ? err.message : err}`);
      failures++;
    }
  }

  // --- spot checks on curriculum semantics ----------------------------------
  console.log('\n=== spot checks');
  const run = (schemaId: string, sql: string): TraceStep[] => {
    const db = dbs.get(schemaId)!;
    const { schema } = introspectSchema(db);
    const parsed = parseQuery(sql);
    if (!parsed.ok) throw new Error(`parse: ${parsed.error} :: ${sql}`);
    return buildTrace(parsed.ast, db, schema);
  };

  {
    // Computed column + quoted field alias + ORDER BY expression (workbook SHARES d)
    const steps = run(
      'shares',
      "SELECT SHRFIRM, SHRPRICE * SHRQTY AS 'Total Value' FROM SHARES ORDER BY SHRPRICE * SHRQTY DESC"
    );
    const last = steps[steps.length - 1];
    assert(last.partialResult?.rows[0]?.[0] === 'Royal Ostrich Farms', 'ROF has the largest total value');
    console.log('  quoted alias + computed ORDER BY: ok');
  }
  {
    // LEFT OUTER JOIN keeps donor 104 (Berdahl) NULL-extended
    const steps = run(
      'donor',
      'SELECT DLNAME, AMOUNT FROM DONOR LEFT OUTER JOIN GIFT ON DONOR.DONORNO = GIFT.DONORNO'
    );
    const join = steps.find((s) => s.stage === 'join');
    // DONORNO is INTEGER PRIMARY KEY, so it aliases the rowid: donor 104 = rowid 104.
    assert(!!join?.nullExtendedRows?.DONOR?.has(104), 'donor 104 should be NULL-extended');
    console.log('  LEFT OUTER JOIN null-extension: ok', fmtStep(join!));
  }
  {
    // COUNT(DISTINCT ...) — workbook DONOR d: donors who gave in 2012
    const steps = run('donor', "SELECT COUNT(DISTINCT DONORNO) AS 'Donors in 2012' FROM GIFT WHERE YEAR = 2012");
    const last = steps[steps.length - 1];
    assert(Number(last.partialResult?.rows[0]?.[0]) === 10, '10 donors gave in 2012');
    console.log('  COUNT(DISTINCT): ok');
  }
  {
    // Scalar aggregates represent every contributing row, not one arbitrary
    // SQLite rowid appended beside the aggregate.
    const steps = run('donor', "SELECT COUNT(*) AS 'Number of Donors' FROM DONOR");
    const last = steps[steps.length - 1];
    assert(last.resultRowSources?.[0]?.DONOR.length === 19, 'scalar COUNT provenance includes all 19 donors');
    console.log('  scalar aggregate provenance: ok');
  }
  {
    // DISTINCT is part of slideset 5 and keeps provenance from all duplicates.
    const steps = run('donor', 'SELECT DISTINCT DSTATE FROM DONOR ORDER BY DSTATE');
    const last = steps[steps.length - 1];
    assert(last.partialResult?.rows.length === 15, 'DONOR has 15 distinct states');
    const gaIndex = last.partialResult?.rows.findIndex((row) => row[0] === 'GA') ?? -1;
    assert(last.resultRowSources?.[gaIndex]?.DONOR.length === 3, 'distinct GA row traces to 3 donors');
    console.log('  SELECT DISTINCT + merged provenance: ok');
  }
  {
    // CONCAT + a quoted field alias is taught directly in slideset 5.
    const steps = run(
      'donor',
      "SELECT CONCAT(DLNAME, ', ', DFNAME) AS 'Donor Name' FROM DONOR WHERE DONORNO = 101"
    );
    assert(steps.at(-1)?.partialResult?.rows[0]?.[0] === 'Abrams, Louis', 'CONCAT joins text with separator');
    console.log('  CONCAT + field alias: ok');
  }
  {
    // HAVING on EMP — workbook EMP a: Management(75000), Marketing(~30667)...
    const steps = run(
      'emp',
      'SELECT DEPTNAME, AVG(EMPSALARY) FROM EMP GROUP BY DEPTNAME HAVING AVG(EMPSALARY) > 35000'
    );
    const last = steps[steps.length - 1];
    const depts = last.partialResult?.rows.map((r) => r[0]);
    // Averages: Management 75000, Purchasing 49500, Personnel 36333.33 pass; Marketing and Accounting fail.
    assert(
      JSON.stringify([...(depts ?? [])].sort()) ===
        JSON.stringify(['Management', 'Personnel', 'Purchasing']),
      `HAVING > 35000 keeps Management + Personnel + Purchasing (got ${JSON.stringify(depts)})`
    );
    console.log('  GROUP BY + HAVING on EMP: ok');
  }
  {
    // SALES multi-condition: brown items of type R (workbook SALES a)
    const steps = run('sales', "SELECT INAME FROM ITEM WHERE ICOLOR = 'Brown' AND ITYPE = 'R'");
    assert(steps[steps.length - 1].partialResult?.rows.length === 2, 'two brown R items');
    console.log('  SALES basic query: ok');
  }
  {
    // IS NULL (workbook SALES d)
    const steps = run('sales', 'SELECT INAME FROM ITEM WHERE ICOLOR IS NULL');
    assert(steps[steps.length - 1].partialResult?.rows[0]?.[0] === 'Star chart', 'Star chart has no color');
    console.log('  IS NULL: ok');
  }
  {
    // Case-insensitive table/column references
    const steps = run('shares', 'select shrfirm from shares where shrpe > 10');
    assert((steps[steps.length - 1].partialResult?.rows.length ?? 0) > 0, 'lowercase query works');
    console.log('  case-insensitive references: ok');
  }
  {
    // The advanced slides teach the older comma-join form and its Cartesian
    // intermediate result before WHERE applies the equijoin condition.
    const steps = run(
      'donor',
      'SELECT D.DLNAME, G.AMOUNT FROM DONOR D, GIFT G WHERE D.DONORNO = G.DONORNO'
    );
    assert(steps[1]?.stage === 'join' && steps[1].tuples?.length === 703, 'comma join forms 19 × 37 combinations');
    assert(steps.find((step) => step.stage === 'where')?.tuples?.length === 37, 'WHERE reduces Cartesian product to 37 matches');
    console.log('  comma-style join pipeline: ok');
  }
  {
    // Self-join from slideset 6: one physical EMP table plays employee and
    // manager roles under two aliases.
    const steps = run(
      'emp',
      "SELECT E.EMPFNAME, M.EMPFNAME AS 'Manager' FROM EMP E JOIN EMP M ON E.BOSS = M.EMPNO"
    );
    assert(steps.at(-1)?.partialResult?.rows.length === 11, 'self join returns all 11 employee-manager pairs');
    assert(steps.at(-1)?.resultRowSources?.[2]?.EMP.length === 2, 'self-join result merges both EMP alias sources');
    console.log('  self join aliases + provenance: ok');
  }
  {
    const union = run('donor', 'SELECT DLNAME AS NAME FROM DONOR UNION SELECT DFNAME FROM DONOR');
    const unionAll = run('donor', 'SELECT DLNAME AS NAME FROM DONOR UNION ALL SELECT DFNAME FROM DONOR');
    assert(union.at(-1)?.stage === 'union', 'UNION gets a compound final stage');
    assert(unionAll.at(-1)?.partialResult?.rows.length === 38, 'UNION ALL keeps all 38 branch rows');
    assert((union.at(-1)?.partialResult?.rows.length ?? 0) < 38, 'UNION removes duplicate names');
    console.log('  UNION / UNION ALL: ok');
  }
  {
    const steps = run(
      'donor',
      'SELECT DLNAME FROM DONOR WHERE DONORNO IN (SELECT DISTINCT DONORNO FROM GIFT)'
    );
    assert(steps[0]?.stage === 'subquery', 'subquery exposes its inner-result stage');
    assert(steps.at(-1)?.partialResult?.rows.length === 18, '18 donors have made a gift');
    console.log('  uncorrelated subquery: ok');
  }
  {
    const steps = run(
      'emp',
      'SELECT E.EMPFNAME FROM EMP E WHERE E.EMPSALARY > (SELECT AVG(I.EMPSALARY) FROM EMP I WHERE I.DEPTNAME = E.DEPTNAME)'
    );
    assert(steps[0]?.label.startsWith('CORRELATED SUBQUERY'), 'correlated subquery is identified');
    assert(steps.at(-1)?.partialResult?.rows.length === 4, '4 employees earn above their department average');
    console.log('  correlated subquery: ok');
  }
  {
    // AND binds more tightly than OR unless parentheses override it.
    const defaultPrecedence = run(
      'shares',
      'SELECT SHRCODE FROM SHARES WHERE SHRPRICE < 15 OR SHRPE = 16 AND SHRQTY < 20000'
    );
    const parenthesized = run(
      'shares',
      'SELECT SHRCODE FROM SHARES WHERE (SHRPRICE < 15 OR SHRPE = 16) AND SHRQTY < 20000'
    );
    assert(defaultPrecedence.at(-1)?.partialResult?.rows.length === 3, 'AND executes before OR');
    assert(parenthesized.at(-1)?.partialResult?.rows.length === 1, 'parentheses override Boolean precedence');
    console.log('  AND / OR precedence + parentheses: ok');
  }
  {
    const between = run('shares', 'SELECT SHRCODE FROM SHARES WHERE SHRPE BETWEEN 10 AND 13');
    const codes = between.at(-1)?.partialResult?.rows.map((row) => row[0]) ?? [];
    assert(codes.length === 5 && codes.includes('AR') && codes.includes('NG'), 'BETWEEN includes both endpoints');
    const excluded = run('shares', "SELECT SHRCODE FROM SHARES WHERE NOT SHRCODE IN ('BS', 'CS')");
    assert(excluded.at(-1)?.partialResult?.rows.length === 8, 'NOT IN excludes the two named shares');
    console.log('  BETWEEN inclusivity + NOT IN: ok');
  }
  {
    const steps = run('donor', 'SELECT SUM(AMOUNT) FROM GIFT WHERE YEAR = 2013');
    assert(Number(steps.at(-1)?.partialResult?.rows[0]?.[0]) === 6768, '2013 gifts sum to 6768');
    console.log('  workbook aggregate answer: ok');
  }
  {
    const steps = run(
      'donor',
      'SELECT Y.YEAR, Y.YEARGOAL, SUM(G.AMOUNT) FROM YEAR Y JOIN GIFT G ON Y.YEAR = G.YEAR GROUP BY Y.YEAR, Y.YEARGOAL HAVING SUM(G.AMOUNT) > Y.YEARGOAL ORDER BY Y.YEAR'
    );
    assert(
      JSON.stringify(steps.at(-1)?.partialResult?.rows.map((row) => row[0])) === JSON.stringify([2012, 2013, 2014]),
      '2012–2014 exceed the workbook yearly goals'
    );
    console.log('  YEAR table name + join/group/HAVING workbook query: ok');
  }
  {
    const steps = run(
      'shares',
      'SELECT S.SHRCODE FROM SHARES S, (SELECT AVG(SHRDIV / SHRPRICE) AS AvgYield FROM SHARES) X WHERE S.SHRDIV / S.SHRPRICE < X.AvgYield ORDER BY S.SHRCODE'
    );
    assert((steps.at(-1)?.partialResult?.rows.length ?? 0) > 0, 'derived-table average query returns shares');
    assert(steps.some((step) => step.stage === 'subquery'), 'derived table exposes an inner-query stage');
    console.log('  derived table with required alias: ok');
  }
  {
    const steps = run(
      'donor',
      `SELECT D.DLNAME
       FROM DONOR D
       WHERE NOT EXISTS (
         SELECT Y.YEAR FROM YEAR Y
         WHERE NOT EXISTS (
           SELECT G.YEAR FROM GIFT G
           WHERE G.DONORNO = D.DONORNO AND G.YEAR = Y.YEAR
         )
       )`
    );
    const names = steps.at(-1)?.partialResult?.rows.map((row) => row[0]).sort();
    assert(JSON.stringify(names) === JSON.stringify(['Beckman', 'Crowder']), 'two donors gave in every year');
    console.log('  nested correlated NOT EXISTS: ok');
  }
  {
    const steps = run('shares', 'SELECT SHRCODE FROM SHARES WHERE SHRPRICE < 0');
    assert(steps.at(-1)?.partialResult?.rows.length === 0, 'zero-row results complete normally');
    console.log('  empty result: ok');
  }
  {
    let mismatchRejected = false;
    try {
      run('donor', 'SELECT DLNAME FROM DONOR UNION SELECT DFNAME, DSTATE FROM DONOR');
    } catch (error) {
      mismatchRejected = /same number of result columns/i.test(
        error instanceof Error ? error.message : String(error)
      );
    }
    assert(mismatchRejected, 'UNION branches must have the same number of columns');
    console.log('  incompatible UNION shape: ok');
  }

  // --- clause ranges for the query-text highlight ----------------------------
  console.log('\n=== clause ranges');
  {
    const { computeClauseRanges } = await import('../lib/clauseRanges');
    const q =
      "SELECT DSTATE, SUM(AMOUNT) AS 'Total 2014'\nFROM DONOR D JOIN GIFT G ON D.DONORNO = G.DONORNO\nWHERE G.YEAR = 2014\nGROUP BY DSTATE\nORDER BY SUM(AMOUNT) DESC";
    const r = computeClauseRanges(q);
    const slice = (cr?: { start: number; end: number }) => (cr ? q.slice(cr.start, cr.end) : '');
    assert(slice(r.select).startsWith('SELECT DSTATE'), 'select range starts at SELECT');
    assert(slice(r.from) === 'FROM DONOR D', 'from range covers FROM + first table');
    assert(slice(r.joins[0]) === 'JOIN GIFT G ON D.DONORNO = G.DONORNO', 'join range covers ON');
    assert(slice(r.where) === 'WHERE G.YEAR = 2014', 'where range');
    assert(slice(r.groupBy) === 'GROUP BY DSTATE', 'group range');
    assert(slice(r.orderLimit) === 'ORDER BY SUM(AMOUNT) DESC', 'order range');
    // keywords inside string literals must not confuse the tokenizer
    const q2 = "SELECT SHRFIRM AS 'FROM WHERE' FROM SHARES WHERE SHRFIRM LIKE '%JOIN%'";
    const r2 = computeClauseRanges(q2);
    assert(q2.slice(r2.from!.start, r2.from!.end) === 'FROM SHARES', 'string literals are skipped');
    assert(r2.joins.length === 0, 'JOIN inside a string is not a clause');
    console.log('  clause ranges: ok');
  }

  // --- rejections ------------------------------------------------------------
  console.log('\n=== rejection checks');
  const REJECTED = [
    'DELETE FROM DONOR',
    'SELECT DLNAME, COUNT(*) FROM DONOR',
    'SELECT DSTATE, COUNT(*) FROM DONOR GROUP BY DCITY',
    'SELECT * FROM GIFT WHERE SUM(AMOUNT) > 100',
    "SELECT SHRPRICE * SHRQTY AS 'Total Value' FROM SHARES ORDER BY 'Total Value'",
    'SELECT DSTATE, COUNT(*) FROM DONOR GROUP BY DSTATE HAVING DCITY = \'London\'',
    'SELECT DONOR.DLNAME FROM DONOR D',
    'SELECT COUNT(*) FROM DONOR HAVING COUNT(*) > 1',
  ];
  for (const q of REJECTED) {
    const parsed = parseQuery(q);
    assert(!parsed.ok, `should reject: ${q}`);
    console.log(`  rejected OK: ${q.slice(0, 55)}...`);
  }

  console.log(failures ? `\n${failures} FAILURE(S) above.` : '\nAll trace tests passed.');
  if (failures) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
