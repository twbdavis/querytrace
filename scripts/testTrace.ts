/* End-to-end parser and trace-engine tests against every original teaching
   schema and lesson. Run with: npm run test:trace */
import initSqlJs, { type Database } from 'sql.js';
import { introspectSchema } from '../lib/db';
import { LESSONS } from '../lib/lessons';
import { parseQuery } from '../lib/parser';
import { PRELOADED_SCHEMAS } from '../lib/schemas';
import { buildTrace, type TraceStep } from '../lib/traceEngine';

function fmtStep(step: TraceStep): string {
  const lit = Object.entries(step.litRows)
    .map(([table, rows]) => `${table}:${rows.size}`)
    .join(' ');
  return `  [${step.stage.padEnd(10)}] ${step.label.slice(0, 90)}  lit={${lit}} result=${step.partialResult?.rows.length ?? '-'}`;
}

let failures = 0;
function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`ASSERTION FAILED: ${message}`);
    failures++;
  }
}

async function main() {
  const SQL = await initSqlJs();
  const databases = new Map<string, Database>();
  for (const definition of PRELOADED_SCHEMAS) {
    const database = new SQL.Database();
    database.run('PRAGMA foreign_keys = ON');
    database.run(definition.ddl);
    databases.set(definition.id, database);
  }

  console.log('=== introspection');
  for (const definition of PRELOADED_SCHEMAS) {
    const database = databases.get(definition.id)!;
    const { schema, fkEdges } = introspectSchema(database);
    console.log(
      `  ${definition.id}: tables=[${schema.map((table) => table.name).join(', ')}] fks=${fkEdges.length}`
    );
    assert(schema.length > 0, `${definition.id} should have tables`);
    assert(
      schema.every((table) => table.columns.some((column) => column.pk)),
      `${definition.id} relations should all have primary keys`
    );
    assert(
      (database.exec('PRAGMA foreign_key_check')[0]?.values.length ?? 0) === 0,
      `${definition.id} should satisfy every foreign-key constraint`
    );
  }

  {
    const community = introspectSchema(databases.get('community')!);
    const pledge = community.schema.find((table) => table.name === 'PLEDGE');
    assert(community.fkEdges.length === 2, 'community schema should have two FK edges');
    assert(
      pledge?.columns.filter((column) => column.pk).map((column) => column.name).join(',') ===
        'CAMPAIGN_YEAR,MEMBER_ID',
      'PLEDGE should expose both composite primary-key columns'
    );
    const catalog = introspectSchema(databases.get('catalog')!);
    assert(
      catalog.schema[0].columns.find((column) => column.name === 'ITEMCODE')?.pk === true,
      'PRODUCT text primary key should be detected'
    );
  }

  {
    const database = new SQL.Database();
    database.run('PRAGMA foreign_keys = ON');
    database.run(`
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
    const model = introspectSchema(database);
    const parent = model.schema.find((table) => table.name === 'PARENT');
    const child = model.schema.find((table) => table.name === 'CHILD');
    assert(parent?.columns.filter((column) => column.pk).length === 2, 'both composite PK columns are marked');
    assert(child?.columns.filter((column) => column.fk).length === 2, 'both composite FK columns are marked');
    assert(model.fkEdges.length === 2, 'composite FK renders one wire per component');
    const label = parent?.columns.find((column) => column.name === 'LABEL');
    assert(label?.type === 'VARCHAR(20)' && !!label.notNull, 'type and NOT NULL are introspected');
    assert(label?.defaultValue === "'unlabeled'", 'DEFAULT is introspected');
    assert(child?.columns.find((column) => column.name === 'PART_A')?.fk?.onDelete === 'CASCADE', 'delete rule is introspected');
    assert(database.exec('SELECT LABEL FROM PARENT')[0].values[0][0] === 'unlabeled', 'DEFAULT applies');
    let orphanRejected = false;
    try {
      database.run('INSERT INTO CHILD VALUES (11, 9, 9)');
    } catch {
      orphanRejected = true;
    }
    assert(orphanRejected, 'referential integrity rejects an orphan');
    database.run('DELETE FROM PARENT WHERE PART_A = 1 AND PART_B = 2');
    assert(Number(database.exec('SELECT COUNT(*) FROM CHILD')[0].values[0][0]) === 0, 'cascade removes dependents');
  }

  console.log('\n=== lesson queries');
  for (const lesson of LESSONS) {
    const database = databases.get(lesson.schemaId)!;
    const { schema } = introspectSchema(database);
    const parsed = parseQuery(lesson.query);
    if (!parsed.ok) {
      console.error(`  PARSE FAILED [${lesson.id}]: ${parsed.error}`);
      failures++;
      continue;
    }
    try {
      const steps = buildTrace(parsed.ast, database, schema);
      const final = steps.at(-1)!;
      console.log(
        `  ${lesson.id} (${lesson.schemaId}): ${steps.length} steps, ${final.partialResult?.rows.length} result rows`
      );
      assert((final.partialResult?.rows.length ?? 0) > 0, `${lesson.id} should return rows`);
      if (!steps.some((step) => step.stage === 'subquery' || step.stage === 'union')) {
        assert(!!final.resultRowSources, `${lesson.id} should have provenance`);
      }
    } catch (error) {
      console.error(`  TRACE FAILED [${lesson.id}]: ${error instanceof Error ? error.message : error}`);
      failures++;
    }
  }

  console.log('\n=== spot checks');
  const run = (schemaId: string, sql: string): TraceStep[] => {
    const database = databases.get(schemaId)!;
    const { schema } = introspectSchema(database);
    const parsed = parseQuery(sql);
    if (!parsed.ok) throw new Error(`parse: ${parsed.error} :: ${sql}`);
    return buildTrace(parsed.ast, database, schema);
  };

  {
    const steps = run(
      'catalog',
      "SELECT ITEMNAME, UNITPRICE * STOCKQTY AS 'Inventory Value' FROM PRODUCT ORDER BY UNITPRICE * STOCKQTY DESC"
    );
    assert(steps.at(-1)?.partialResult?.rows[0]?.[0] === 'Glass Bottle', 'Glass Bottle has the largest inventory value');
    console.log('  quoted alias + computed ORDER BY: ok');
  }
  {
    const steps = run(
      'community',
      'SELECT LAST_NAME, AMOUNT FROM MEMBER LEFT OUTER JOIN PLEDGE ON MEMBER.MEMBER_ID = PLEDGE.MEMBER_ID'
    );
    const join = steps.find((step) => step.stage === 'join');
    assert(!!join?.nullExtendedRows?.MEMBER?.has(204), 'member 204 should be NULL-extended');
    console.log('  LEFT OUTER JOIN null-extension: ok', fmtStep(join!));
  }
  {
    const steps = run(
      'community',
      "SELECT COUNT(DISTINCT MEMBER_ID) AS 'Members in 2022' FROM PLEDGE WHERE CAMPAIGN_YEAR = 2022"
    );
    assert(Number(steps.at(-1)?.partialResult?.rows[0]?.[0]) === 6, 'six members pledged in 2022');
    console.log('  COUNT(DISTINCT): ok');
  }
  {
    const steps = run('community', "SELECT COUNT(*) AS 'Number of Members' FROM MEMBER");
    assert(steps.at(-1)?.resultRowSources?.[0]?.MEMBER.length === 12, 'scalar COUNT provenance includes all members');
    console.log('  scalar aggregate provenance: ok');
  }
  {
    const steps = run('community', 'SELECT DISTINCT REGION FROM MEMBER ORDER BY REGION');
    const final = steps.at(-1)!;
    assert(final.partialResult?.rows.length === 5, 'MEMBER has five distinct regions');
    const northwest = final.partialResult?.rows.findIndex((row) => row[0] === 'NW') ?? -1;
    assert(final.resultRowSources?.[northwest]?.MEMBER.length === 3, 'NW traces to three members');
    console.log('  SELECT DISTINCT + merged provenance: ok');
  }
  {
    const steps = run(
      'community',
      "SELECT CONCAT(LAST_NAME, ', ', FIRST_NAME) AS 'Member Name' FROM MEMBER WHERE MEMBER_ID = 201"
    );
    assert(steps.at(-1)?.partialResult?.rows[0]?.[0] === 'Navarro, Lena', 'CONCAT joins text and separator');
    console.log('  CONCAT + field alias: ok');
  }
  {
    const steps = run(
      'staff',
      'SELECT TEAM, AVG(SALARY) FROM STAFF GROUP BY TEAM HAVING AVG(SALARY) > 45000'
    );
    const teams = steps.at(-1)?.partialResult?.rows.map((row) => row[0]).sort();
    assert(JSON.stringify(teams) === JSON.stringify(['Engineering', 'Leadership']), `HAVING keeps the expected teams (got ${JSON.stringify(teams)})`);
    console.log('  GROUP BY + HAVING: ok');
  }
  {
    const steps = run(
      'makerspace',
      "SELECT MATERIAL_NAME FROM MATERIAL WHERE COLOR = 'Blue' AND MATERIAL_TYPE = 'T'"
    );
    assert(steps.at(-1)?.partialResult?.rows.length === 2, 'two blue textile materials');
    const missing = run('makerspace', 'SELECT MATERIAL_NAME FROM MATERIAL WHERE COLOR IS NULL');
    assert(missing.at(-1)?.partialResult?.rows[0]?.[0] === 'Ink Set', 'Ink Set has no color');
    console.log('  multi-condition + IS NULL: ok');
  }
  {
    const steps = run('catalog', 'select itemname from product where rating > 3');
    assert((steps.at(-1)?.partialResult?.rows.length ?? 0) > 0, 'lowercase references work');
    console.log('  case-insensitive references: ok');
  }
  {
    const steps = run(
      'community',
      'SELECT M.LAST_NAME, P.AMOUNT FROM MEMBER M, PLEDGE P WHERE M.MEMBER_ID = P.MEMBER_ID'
    );
    assert(steps[1]?.stage === 'join' && steps[1].tuples?.length === 276, 'comma join forms 12 × 23 combinations');
    assert(steps.find((step) => step.stage === 'where')?.tuples?.length === 23, 'WHERE reduces product to 23 matches');
    console.log('  comma-style join pipeline: ok');
  }
  {
    const steps = run(
      'staff',
      "SELECT S.FIRST_NAME, M.FIRST_NAME AS 'Manager' FROM STAFF S JOIN STAFF M ON S.MANAGER_ID = M.STAFF_ID"
    );
    assert(steps.at(-1)?.partialResult?.rows.length === 11, 'self join returns 11 staff-manager pairs');
    assert(steps.at(-1)?.resultRowSources?.[2]?.STAFF.length === 2, 'self-join merges both alias sources');
    console.log('  self join aliases + provenance: ok');
  }
  {
    const union = run('community', 'SELECT LAST_NAME AS NAME FROM MEMBER UNION SELECT FIRST_NAME FROM MEMBER');
    const unionAll = run('community', 'SELECT LAST_NAME AS NAME FROM MEMBER UNION ALL SELECT FIRST_NAME FROM MEMBER');
    assert(union.at(-1)?.partialResult?.rows.length === 21, 'UNION removes three duplicate first names');
    assert(unionAll.at(-1)?.partialResult?.rows.length === 24, 'UNION ALL retains all branch rows');
    console.log('  UNION / UNION ALL: ok');
  }
  {
    const steps = run(
      'community',
      'SELECT LAST_NAME FROM MEMBER WHERE MEMBER_ID IN (SELECT DISTINCT MEMBER_ID FROM PLEDGE)'
    );
    assert(steps[0]?.stage === 'subquery', 'subquery exposes its inner-result stage');
    assert(steps.at(-1)?.partialResult?.rows.length === 11, '11 members have pledged');
    console.log('  uncorrelated subquery: ok');
  }
  {
    const steps = run(
      'staff',
      'SELECT S.FIRST_NAME FROM STAFF S WHERE S.SALARY > (SELECT AVG(I.SALARY) FROM STAFF I WHERE I.TEAM = S.TEAM)'
    );
    assert(steps[0]?.label.startsWith('CORRELATED SUBQUERY'), 'correlated subquery is identified');
    assert(steps.at(-1)?.partialResult?.rows.length === 5, 'five staff exceed their team average');
    console.log('  correlated subquery: ok');
  }
  {
    const normal = run(
      'catalog',
      'SELECT ITEMCODE FROM PRODUCT WHERE UNITPRICE < 20 OR RATING = 5 AND STOCKQTY < 30'
    );
    const grouped = run(
      'catalog',
      'SELECT ITEMCODE FROM PRODUCT WHERE (UNITPRICE < 20 OR RATING = 5) AND STOCKQTY < 30'
    );
    assert(normal.at(-1)?.partialResult?.rows.length === 7, 'AND executes before OR');
    assert(grouped.at(-1)?.partialResult?.rows.length === 2, 'parentheses override precedence');
    console.log('  AND / OR precedence + parentheses: ok');
  }
  {
    const between = run('catalog', 'SELECT ITEMCODE FROM PRODUCT WHERE RATING BETWEEN 3 AND 4');
    assert(between.at(-1)?.partialResult?.rows.length === 6, 'BETWEEN includes both endpoints');
    const excluded = run('catalog', "SELECT ITEMCODE FROM PRODUCT WHERE NOT ITEMCODE IN ('BAG', 'MUG')");
    assert(excluded.at(-1)?.partialResult?.rows.length === 8, 'NOT IN excludes named rows');
    console.log('  BETWEEN inclusivity + NOT IN: ok');
  }
  {
    const total = run('community', 'SELECT SUM(AMOUNT) FROM PLEDGE WHERE CAMPAIGN_YEAR = 2024');
    assert(Number(total.at(-1)?.partialResult?.rows[0]?.[0]) === 2700, '2024 pledges sum to 2700');
    const goals = run(
      'community',
      'SELECT C.CAMPAIGN_YEAR, C.TARGET, SUM(P.AMOUNT) FROM CAMPAIGN C JOIN PLEDGE P ON C.CAMPAIGN_YEAR = P.CAMPAIGN_YEAR GROUP BY C.CAMPAIGN_YEAR, C.TARGET HAVING SUM(P.AMOUNT) > C.TARGET ORDER BY C.CAMPAIGN_YEAR'
    );
    assert(JSON.stringify(goals.at(-1)?.partialResult?.rows.map((row) => row[0])) === JSON.stringify([2022, 2024]), 'only 2022 and 2024 exceed target');
    console.log('  aggregate + join/group/HAVING: ok');
  }
  {
    const steps = run(
      'catalog',
      'SELECT P.ITEMCODE FROM PRODUCT P, (SELECT AVG(UNITPRICE) AS AvgPrice FROM PRODUCT) X WHERE P.UNITPRICE < X.AvgPrice ORDER BY P.ITEMCODE'
    );
    assert((steps.at(-1)?.partialResult?.rows.length ?? 0) > 0, 'derived-table query returns products');
    assert(steps.some((step) => step.stage === 'subquery'), 'derived table exposes inner stage');
    console.log('  derived table with required alias: ok');
  }
  {
    const steps = run(
      'community',
      `SELECT M.LAST_NAME
       FROM MEMBER M
       WHERE NOT EXISTS (
         SELECT C.CAMPAIGN_YEAR FROM CAMPAIGN C
         WHERE NOT EXISTS (
           SELECT P.CAMPAIGN_YEAR FROM PLEDGE P
           WHERE P.MEMBER_ID = M.MEMBER_ID AND P.CAMPAIGN_YEAR = C.CAMPAIGN_YEAR
         )
       )`
    );
    assert(JSON.stringify(steps.at(-1)?.partialResult?.rows.map((row) => row[0])) === JSON.stringify(['Okafor']), 'one member pledged in every campaign');
    console.log('  nested correlated NOT EXISTS: ok');
  }
  {
    const empty = run('catalog', 'SELECT ITEMCODE FROM PRODUCT WHERE UNITPRICE < 0');
    assert(empty.at(-1)?.partialResult?.rows.length === 0, 'zero-row results complete normally');
    let mismatchRejected = false;
    try {
      run('community', 'SELECT LAST_NAME FROM MEMBER UNION SELECT FIRST_NAME, REGION FROM MEMBER');
    } catch (error) {
      mismatchRejected = /same number of result columns/i.test(error instanceof Error ? error.message : String(error));
    }
    assert(mismatchRejected, 'UNION branches require equal column counts');
    console.log('  empty result + incompatible UNION rejection: ok');
  }

  console.log('\n=== clause ranges');
  {
    const { computeClauseRanges } = await import('../lib/clauseRanges');
    const query =
      "SELECT REGION, SUM(AMOUNT) AS 'Total 2024'\nFROM MEMBER M JOIN PLEDGE P ON M.MEMBER_ID = P.MEMBER_ID\nWHERE P.CAMPAIGN_YEAR = 2024\nGROUP BY REGION\nORDER BY SUM(AMOUNT) DESC";
    const ranges = computeClauseRanges(query);
    const slice = (range?: { start: number; end: number }) =>
      range ? query.slice(range.start, range.end) : '';
    assert(slice(ranges.select).startsWith('SELECT REGION'), 'select range');
    assert(slice(ranges.from) === 'FROM MEMBER M', 'from range');
    assert(slice(ranges.joins[0]) === 'JOIN PLEDGE P ON M.MEMBER_ID = P.MEMBER_ID', 'join range');
    assert(slice(ranges.where) === 'WHERE P.CAMPAIGN_YEAR = 2024', 'where range');
    assert(slice(ranges.groupBy) === 'GROUP BY REGION', 'group range');
    assert(slice(ranges.orderLimit) === 'ORDER BY SUM(AMOUNT) DESC', 'order range');
    const quoted = "SELECT ITEMNAME AS 'FROM WHERE' FROM PRODUCT WHERE ITEMNAME LIKE '%JOIN%'";
    const quotedRanges = computeClauseRanges(quoted);
    assert(quoted.slice(quotedRanges.from!.start, quotedRanges.from!.end) === 'FROM PRODUCT', 'string literals are skipped');
    assert(quotedRanges.joins.length === 0, 'JOIN inside a string is not a clause');
    console.log('  clause ranges: ok');
  }

  console.log('\n=== rejection checks');
  const rejected = [
    'DELETE FROM MEMBER',
    'SELECT LAST_NAME, COUNT(*) FROM MEMBER',
    'SELECT REGION, COUNT(*) FROM MEMBER GROUP BY CITY',
    'SELECT * FROM PLEDGE WHERE SUM(AMOUNT) > 100',
    "SELECT UNITPRICE * STOCKQTY AS 'Inventory Value' FROM PRODUCT ORDER BY 'Inventory Value'",
    "SELECT REGION, COUNT(*) FROM MEMBER GROUP BY REGION HAVING CITY = 'Cedar Bay'",
    'SELECT MEMBER.LAST_NAME FROM MEMBER M',
    'SELECT COUNT(*) FROM MEMBER HAVING COUNT(*) > 1',
  ];
  for (const query of rejected) {
    const parsed = parseQuery(query);
    assert(!parsed.ok, `should reject: ${query}`);
    console.log(`  rejected OK: ${query.slice(0, 55)}...`);
  }

  console.log(failures ? `\n${failures} FAILURE(S) above.` : '\nAll trace tests passed.');
  if (failures) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
