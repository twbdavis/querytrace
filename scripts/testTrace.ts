/* End-to-end parser and trace-engine tests against every bundled schema and
   lesson. Run with: npm run test:trace */
import initSqlJs, { type Database } from 'sql.js';
import { registerCompatFunctions } from '../lib/compatFunctions';
import { getTableData, introspectSchema } from '../lib/db';
import { LESSONS } from '../lib/lessons';
import { parseQuery } from '../lib/parser';
import { PRELOADED_SCHEMAS } from '../lib/schemas';
import { traceStatement, type TraceStep } from '../lib/traceEngine';

/** Parse and trace one statement the way the worker does. */
function traceSql(sql: string, database: Database, schema: ReturnType<typeof introspectSchema>['schema']): TraceStep[] {
  const parsed = parseQuery(sql);
  if (!parsed.ok) throw new Error(`parse: ${parsed.error} :: ${sql}`);
  return traceStatement(parsed, sql, database, schema).steps;
}

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
    registerCompatFunctions(database);
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
    const festival = introspectSchema(databases.get('festival')!);
    const reservation = festival.schema.find((table) => table.name === 'RESERVATION');
    assert(festival.fkEdges.length === 3, 'festival schema should have three FK edges');
    assert(
      reservation?.columns.filter((column) => column.pk).map((column) => column.name).join(',') ===
        'ATTENDEE_ID,SCREENING_ID',
      'RESERVATION should expose both composite primary-key columns'
    );
    const transit = introspectSchema(databases.get('transit')!);
    assert(
      transit.schema[0].columns.find((column) => column.name === 'ROUTE_CODE')?.pk === true,
      'FERRY_ROUTE text primary key should be detected'
    );
  }

  console.log('\n=== bundled schema edge checks');
  const expectedShape: Record<string, Record<string, number>> = {
    observatory: { ASTRONOMER: 6, TELESCOPE: 4, TARGET: 7, OBSERVATION: 10 },
    transit: { FERRY_ROUTE: 10 },
    festival: { ATTENDEE: 12, VENUE: 5, SCREENING: 6, RESERVATION: 23 },
    marine: { REEF: 6, DIVER: 6, SPECIES: 10, SIGHTING: 14 },
    orchard: { ORCHARD_PLOT: 10 },
  };
  for (const definition of PRELOADED_SCHEMAS) {
    const database = databases.get(definition.id)!;
    assert(definition.starterQuery.trimEnd().endsWith(';'), `${definition.id} starter query ends with a semicolon`);
    for (const [table, expectedRows] of Object.entries(expectedShape[definition.id])) {
      const actualRows = Number(database.exec(`SELECT COUNT(*) FROM "${table}";`)[0].values[0][0]);
      assert(actualRows === expectedRows, `${definition.id}.${table} contains ${expectedRows} rows`);
    }
    const parsed = parseQuery(definition.starterQuery);
    assert(parsed.ok, `${definition.id} starter query parses with its trailing semicolon`);
    if (parsed.ok) {
      const { schema } = introspectSchema(database);
      const final = traceStatement(parsed, definition.starterQuery, database, schema).steps.at(-1);
      assert((final?.partialResult?.rows.length ?? 0) > 0, `${definition.id} starter query returns rows`);
    }
  }
  assert(
    LESSONS.every((lesson) => lesson.query.trimEnd().endsWith(';')),
    'every lesson query ends with a semicolon'
  );

  {
    const festival = databases.get('festival')!;
    let duplicateRejected = false;
    try {
      festival.run("INSERT INTO RESERVATION VALUES (301, 701, 1, 'Confirmed');");
    } catch {
      duplicateRejected = true;
    }
    assert(duplicateRejected, 'festival composite key rejects a duplicate reservation');

    let orphanRejected = false;
    try {
      festival.run("INSERT INTO RESERVATION VALUES (999, 701, 1, 'Confirmed');");
    } catch {
      orphanRejected = true;
    }
    assert(orphanRejected, 'festival foreign key rejects an unknown attendee');
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
      const steps = traceStatement(parsed, lesson.query, database, schema).steps;
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
    return traceSql(sql, database, schema);
  };

  {
    const endpoints = run('marine', 'SELECT REEF_ID FROM REEF WHERE DEPTH_M BETWEEN 9 AND 18;');
    assert(endpoints.at(-1)?.partialResult?.rows.length === 3, 'BETWEEN retains both depth endpoints');
    const threeValued = run('marine', "SELECT SPECIES_CODE FROM SPECIES WHERE NOT TAG_COLOR = 'Blue';");
    assert(threeValued.at(-1)?.partialResult?.rows.length === 6, 'ordinary comparisons do not include NULL values');
    const quotedSemicolon = run('festival', "SELECT FILM_TITLE FROM SCREENING WHERE FILM_TITLE = 'A;B';");
    assert(quotedSemicolon.at(-1)?.partialResult?.rows.length === 0, 'a semicolon inside text is not a statement boundary');
    const withComment = run('transit', "SELECT ROUTE_CODE FROM FERRY_ROUTE WHERE ROUTE_CODE = 'B01'; -- one route");
    assert(withComment.at(-1)?.partialResult?.rows.length === 1, 'a trailing comment after a semicolon is accepted');
    const multiple = parseQuery('SELECT ROUTE_CODE FROM FERRY_ROUTE; SELECT ROUTE_NAME FROM FERRY_ROUTE;');
    assert(!multiple.ok && /one statement at a time/i.test(multiple.error), 'multiple query statements are rejected');
    console.log('  semicolon + boundary + NULL edge cases: ok');
  }
  {
    const steps = run(
      'transit',
      "SELECT ROUTE_NAME, FARE * SCHEDULED_TRIPS AS 'Daily Potential' FROM FERRY_ROUTE ORDER BY FARE * SCHEDULED_TRIPS DESC"
    );
    assert(steps.at(-1)?.partialResult?.rows[0]?.[0] === 'North Sound', 'North Sound has the largest daily ticket potential');
    console.log('  quoted alias + computed ORDER BY: ok');
  }
  {
    const steps = run(
      'festival',
      'SELECT FAMILY_NAME, SCREENING_ID FROM ATTENDEE LEFT OUTER JOIN RESERVATION ON ATTENDEE.ATTENDEE_ID = RESERVATION.ATTENDEE_ID'
    );
    const join = steps.find((step) => step.stage === 'join');
    assert(!!join?.nullExtendedRows?.ATTENDEE?.has(312), 'attendee 312 should be NULL-extended');
    console.log('  LEFT OUTER JOIN null-extension: ok', fmtStep(join!));
  }
  {
    const steps = run(
      'festival',
      "SELECT COUNT(DISTINCT ATTENDEE_ID) AS 'Audience' FROM RESERVATION WHERE SCREENING_ID = 703"
    );
    assert(Number(steps.at(-1)?.partialResult?.rows[0]?.[0]) === 4, 'four attendees reserved screening 703');
    console.log('  COUNT(DISTINCT): ok');
  }
  {
    const steps = run('marine', "SELECT COUNT(*) AS 'Sightings' FROM SIGHTING");
    assert(steps.at(-1)?.resultRowSources?.[0]?.SIGHTING.length === 14, 'scalar COUNT provenance includes all sightings');
    console.log('  scalar aggregate provenance: ok');
  }
  {
    const steps = run('festival', 'SELECT DISTINCT PASS_TYPE FROM ATTENDEE ORDER BY PASS_TYPE');
    const final = steps.at(-1)!;
    assert(final.partialResult?.rows.length === 4, 'ATTENDEE has four distinct pass types');
    const weekend = final.partialResult?.rows.findIndex((row) => row[0] === 'Weekend') ?? -1;
    assert(final.resultRowSources?.[weekend]?.ATTENDEE.length === 3, 'Weekend traces to three attendees');
    console.log('  SELECT DISTINCT + merged provenance: ok');
  }
  {
    const steps = run(
      'observatory',
      "SELECT CONCAT(GIVEN_NAME, ' ', FAMILY_NAME) AS 'Observer' FROM ASTRONOMER WHERE ASTRONOMER_ID = 1"
    );
    assert(steps.at(-1)?.partialResult?.rows[0]?.[0] === 'Mina Solberg', 'CONCAT joins text and separator');
    console.log('  CONCAT + field alias: ok');
  }
  {
    const steps = run(
      'orchard',
      'SELECT ZONE, AVG(TREE_COUNT) FROM ORCHARD_PLOT GROUP BY ZONE HAVING AVG(TREE_COUNT) > 110'
    );
    const zones = steps.at(-1)?.partialResult?.rows.map((row) => row[0]).sort();
    assert(JSON.stringify(zones) === JSON.stringify(['North', 'South']), `HAVING keeps the expected zones (got ${JSON.stringify(zones)})`);
    console.log('  GROUP BY + HAVING: ok');
  }
  {
    const steps = run(
      'marine',
      "SELECT COMMON_NAME FROM SPECIES WHERE TAG_COLOR = 'Blue' AND SPECIES_GROUP = 'Fish'"
    );
    assert(steps.at(-1)?.partialResult?.rows.length === 2, 'two fish species have blue tags');
    const missing = run('marine', 'SELECT COMMON_NAME FROM SPECIES WHERE TAG_COLOR IS NULL');
    assert(missing.at(-1)?.partialResult?.rows[0]?.[0] === 'Ribbon Eel', 'Ribbon Eel has no tag color');
    console.log('  multi-condition + IS NULL: ok');
  }
  {
    const steps = run('transit', 'select route_name from ferry_route where fare > 10');
    assert((steps.at(-1)?.partialResult?.rows.length ?? 0) > 0, 'lowercase references work');
    console.log('  case-insensitive references: ok');
  }
  {
    const steps = run(
      'observatory',
      'SELECT T.TELESCOPE_NAME, O.OBSERVED_ON FROM TELESCOPE T, OBSERVATION O WHERE T.TELESCOPE_ID = O.TELESCOPE_ID'
    );
    assert(steps[1]?.stage === 'join' && steps[1].tuples?.length === 40, 'comma join forms 4 × 10 combinations');
    assert(steps.find((step) => step.stage === 'where')?.tuples?.length === 10, 'WHERE reduces the product to 10 matches');
    console.log('  comma-style join pipeline: ok');
  }
  {
    const steps = run(
      'orchard',
      "SELECT P.PLOT_NAME, B.PLOT_NAME AS 'Parent' FROM ORCHARD_PLOT P JOIN ORCHARD_PLOT B ON P.PARENT_PLOT_ID = B.PLOT_ID"
    );
    assert(steps.at(-1)?.partialResult?.rows.length === 10, 'self join returns 10 plot-parent pairs');
    assert(steps.at(-1)?.resultRowSources?.[2]?.ORCHARD_PLOT.length === 2, 'self-join merges both alias sources');
    console.log('  self join aliases + provenance: ok');
  }
  {
    const union = run('festival', 'SELECT CITY AS PLACE FROM ATTENDEE UNION SELECT CITY FROM VENUE');
    const unionAll = run('festival', 'SELECT CITY AS PLACE FROM ATTENDEE UNION ALL SELECT CITY FROM VENUE');
    assert(union.at(-1)?.partialResult?.rows.length === 6, 'UNION removes duplicate cities');
    assert(unionAll.at(-1)?.partialResult?.rows.length === 17, 'UNION ALL retains all branch rows');
    console.log('  UNION / UNION ALL: ok');
  }
  {
    const steps = run(
      'festival',
      'SELECT FAMILY_NAME FROM ATTENDEE WHERE ATTENDEE_ID IN (SELECT DISTINCT ATTENDEE_ID FROM RESERVATION)'
    );
    assert(steps[0]?.stage === 'subquery', 'subquery exposes its inner-result stage');
    assert(steps.at(-1)?.partialResult?.rows.length === 11, '11 attendees have reservations');
    console.log('  uncorrelated subquery: ok');
  }
  {
    const steps = run(
      'orchard',
      'SELECT P.PLOT_NAME FROM ORCHARD_PLOT P WHERE P.TREE_COUNT > (SELECT AVG(I.TREE_COUNT) FROM ORCHARD_PLOT I WHERE I.ZONE = P.ZONE)'
    );
    assert(steps[0]?.label.startsWith('CORRELATED SUBQUERY'), 'correlated subquery is identified');
    assert(steps.at(-1)?.partialResult?.rows.length === 3, 'three plots exceed their zone average');
    console.log('  correlated subquery: ok');
  }
  {
    const normal = run(
      'transit',
      'SELECT ROUTE_CODE FROM FERRY_ROUTE WHERE FARE < 9 OR NIGHT_SERVICE = 1 AND CROSSING_MIN < 30'
    );
    const grouped = run(
      'transit',
      'SELECT ROUTE_CODE FROM FERRY_ROUTE WHERE (FARE < 9 OR NIGHT_SERVICE = 1) AND CROSSING_MIN < 30'
    );
    assert(normal.at(-1)?.partialResult?.rows.length === 4, 'AND executes before OR');
    assert(grouped.at(-1)?.partialResult?.rows.length === 3, 'parentheses override precedence');
    console.log('  AND / OR precedence + parentheses: ok');
  }
  {
    const between = run('transit', 'SELECT ROUTE_CODE FROM FERRY_ROUTE WHERE CROSSING_MIN BETWEEN 20 AND 40');
    assert(between.at(-1)?.partialResult?.rows.length === 3, 'BETWEEN includes both endpoints');
    const excluded = run('transit', "SELECT ROUTE_CODE FROM FERRY_ROUTE WHERE NOT ROUTE_CODE IN ('B01', 'M01')");
    assert(excluded.at(-1)?.partialResult?.rows.length === 8, 'NOT IN excludes named rows');
    console.log('  BETWEEN inclusivity + NOT IN: ok');
  }
  {
    const total = run('marine', 'SELECT SUM(COUNT_SEEN) FROM SIGHTING WHERE REEF_ID = \'BLU\'');
    assert(Number(total.at(-1)?.partialResult?.rows[0]?.[0]) === 15, 'Bluebell Shelf sightings total 15 animals');
    const popular = run(
      'festival',
      "SELECT V.VENUE_NAME, SUM(R.SEATS) FROM VENUE V JOIN SCREENING S ON V.VENUE_ID = S.VENUE_ID JOIN RESERVATION R ON S.SCREENING_ID = R.SCREENING_ID WHERE S.SCREENING_DAY = 'Saturday' GROUP BY V.VENUE_NAME HAVING SUM(R.SEATS) > 5 ORDER BY V.VENUE_NAME"
    );
    assert(JSON.stringify(popular.at(-1)?.partialResult?.rows.map((row) => row[0])) === JSON.stringify(['Beacon Theater', 'Orchard Cinema']), 'two Saturday venues exceed five reserved seats');
    console.log('  aggregate + join/group/HAVING: ok');
  }
  {
    const steps = run(
      'transit',
      'SELECT R.ROUTE_CODE FROM FERRY_ROUTE R, (SELECT AVG(FARE) AS AvgFare FROM FERRY_ROUTE) X WHERE R.FARE < X.AvgFare ORDER BY R.ROUTE_CODE'
    );
    assert((steps.at(-1)?.partialResult?.rows.length ?? 0) > 0, 'derived-table query returns routes');
    assert(steps.some((step) => step.stage === 'subquery'), 'derived table exposes inner stage');
    console.log('  derived table with required alias: ok');
  }
  {
    const steps = run(
      'festival',
      `SELECT A.FAMILY_NAME
       FROM ATTENDEE A
       WHERE NOT EXISTS (
         SELECT S.SCREENING_ID FROM SCREENING S
         WHERE S.VENUE_ID = 44 AND NOT EXISTS (
           SELECT R.SCREENING_ID FROM RESERVATION R
           WHERE R.ATTENDEE_ID = A.ATTENDEE_ID AND R.SCREENING_ID = S.SCREENING_ID
         )
       )`
    );
    assert(JSON.stringify(steps.at(-1)?.partialResult?.rows.map((row) => row[0])) === JSON.stringify(['Dlamini', 'Gupta', 'Ibarra', 'Kwon']), 'four attendees booked every screening at venue 44');
    console.log('  nested correlated NOT EXISTS: ok');
  }
  {
    const empty = run('transit', 'SELECT ROUTE_CODE FROM FERRY_ROUTE WHERE FARE < 0');
    assert(empty.at(-1)?.partialResult?.rows.length === 0, 'zero-row results complete normally');
    let mismatchRejected = false;
    try {
      run('festival', 'SELECT CITY FROM ATTENDEE UNION SELECT VENUE_NAME, CAPACITY FROM VENUE');
    } catch (error) {
      mismatchRejected = /same number of result columns/i.test(error instanceof Error ? error.message : String(error));
    }
    assert(mismatchRejected, 'UNION branches require equal column counts');
    console.log('  empty result + incompatible UNION rejection: ok');
  }
  {
    const right = run(
      'festival',
      'SELECT R.SCREENING_ID, A.FAMILY_NAME FROM RESERVATION R RIGHT JOIN ATTENDEE A ON R.ATTENDEE_ID = A.ATTENDEE_ID'
    );
    const rightJoin = right.find((step) => step.stage === 'join');
    assert(!!rightJoin?.label.startsWith('RIGHT JOIN ATTENDEE'), `RIGHT JOIN is parsed and labeled (got "${rightJoin?.label}")`);
    assert(right.at(-1)?.partialResult?.rows.length === 24, 'RIGHT JOIN keeps the attendee without reservations');
    assert(!!rightJoin?.nullExtendedRows?.ATTENDEE?.has(312), 'RIGHT JOIN marks attendee 312 as NULL-extended');
    const full = run(
      'festival',
      'SELECT A.FAMILY_NAME, R.SCREENING_ID FROM ATTENDEE A FULL OUTER JOIN RESERVATION R ON A.ATTENDEE_ID = R.ATTENDEE_ID'
    );
    assert(!!full.find((step) => step.stage === 'join')?.label.startsWith('FULL OUTER JOIN'), 'FULL OUTER JOIN is preserved');
    const cross = run('observatory', 'SELECT T.TELESCOPE_NAME FROM TELESCOPE T CROSS JOIN TARGET X');
    assert(cross.find((step) => step.stage === 'join')?.tuples?.length === 28, 'CROSS JOIN forms 4 × 7 combinations');
    const inner = run('festival', 'SELECT * FROM SCREENING S INNER JOIN VENUE V ON S.VENUE_ID = V.VENUE_ID');
    assert(!!inner.find((step) => step.stage === 'join')?.label.startsWith('INNER JOIN VENUE'), 'INNER JOIN keeps its spelling');
    const { assignQueryRanges } = await import('../lib/clauseRanges');
    const rightSql = 'SELECT S.FILM_TITLE FROM SCREENING S RIGHT OUTER JOIN VENUE V ON S.VENUE_ID = V.VENUE_ID';
    const ranged = run('festival', rightSql);
    assignQueryRanges(ranged, rightSql);
    const joinRange = ranged.find((step) => step.stage === 'join')?.queryRange;
    assert(
      !!joinRange && rightSql.slice(joinRange.start, joinRange.end).startsWith('RIGHT OUTER JOIN VENUE'),
      'RIGHT OUTER JOIN clause range starts at the modifier'
    );
    console.log('  RIGHT / FULL / CROSS joins: ok');
  }
  {
    const { provenanceFor } = await import('../lib/provenance');
    const steps = run(
      'observatory',
      'SELECT a.GIVEN_NAME, o.OBSERVED_ON FROM astronomer a JOIN observation o ON a.ASTRONOMER_ID = o.ASTRONOMER_ID'
    );
    const join = steps.find((step) => step.stage === 'join')!;
    assert(join.tupleTables?.a === 'ASTRONOMER' && join.tupleTables?.o === 'OBSERVATION', 'steps carry an alias -> table map');
    const firstPair = join.tuples![0];
    const fromAstronomer = provenanceFor(join, 'ASTRONOMER', firstPair.a!);
    assert((fromAstronomer.rows.OBSERVATION?.size ?? 0) > 0, 'clicking an aliased parent row lights its join partners');
    const fromObservation = provenanceFor(join, 'OBSERVATION', firstPair.o!);
    assert(fromObservation.rows.ASTRONOMER?.size === 1, 'clicking an aliased child row lights its parent');
    const selfJoin = run(
      'orchard',
      'SELECT P.PLOT_NAME, B.PLOT_NAME FROM ORCHARD_PLOT P JOIN ORCHARD_PLOT B ON P.PARENT_PLOT_ID = B.PLOT_ID'
    );
    const selfStep = selfJoin.find((step) => step.stage === 'join')!;
    const rootPlot = provenanceFor(selfStep, 'ORCHARD_PLOT', 1);
    assert((rootPlot.rows.ORCHARD_PLOT?.size ?? 0) > 1, 'self-join provenance spans both aliases of the same table');
    // Indexing must preserve outer-join NULLs, duplicate self-join roles,
    // aggregate result sources, and per-step isolation on repeated probes.
    const fixture: TraceStep = {
      ...join,
      tuples: [{ a: 1, b: 1, c: null }, { a: 2, b: 1, c: 8 }, { a: 3, b: 4, c: 9 }],
      tupleTables: { a: 'P', b: 'P', c: 'C' },
      resultRowSources: [{ P: [1, 2], C: [8] }, { P: [3, 4], C: [9] }],
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const parent = provenanceFor(fixture, 'P', 1);
      assert([...parent.rows.P].sort().join(',') === '1,2', 'index preserves self-join partners without unrelated rows');
      assert([...parent.rows.C].join(',') === '8', 'index excludes NULL-extended partners');
      assert([...parent.resultRows].join(',') === '0', 'index maps aggregate results to their original indices');
      const missing = provenanceFor(fixture, 'P', 99);
      assert(missing.rows.P.size === 1 && missing.resultRows.size === 0, 'unmatched probe retains only itself');
    }
    const nextStage = { ...fixture, tuples: [], resultRowSources: [] };
    assert(provenanceFor(nextStage, 'P', 1).resultRows.size === 0, 'index never leaks across trace steps');
    console.log('  alias-aware provenance: ok');
  }
  {
    const { provenanceFor } = await import('../lib/provenance');
    const database = new SQL.Database();
    database.run(`
      CREATE TABLE trace_parent (code TEXT PRIMARY KEY, category TEXT);
      CREATE TABLE trace_child (parent_code TEXT, note TEXT);
      INSERT INTO trace_parent VALUES ('beta', 'keep'), ('alpha', 'keep'), ('gone', 'drop'), ('empty', 'solo');
      INSERT INTO trace_child VALUES ('beta', 'same'), ('beta', 'same'), ('alpha', 'same'), ('gone', 'same');
      CREATE INDEX trace_category ON trace_parent(category, code);
    `);
    const schema = introspectSchema(database).schema;
    const steps = traceSql(`SELECT p.category, COUNT(c.parent_code) AS n
      FROM trace_parent p LEFT JOIN trace_child c ON p.code = c.parent_code
      WHERE p.code <> 'gone' GROUP BY p.category HAVING COUNT(*) >= 2 ORDER BY COUNT(c.parent_code) DESC`, database, schema);
    const expectedCounts = [1, 2, 2, 1, 1, 1, 1];
    steps.forEach((step, i) => {
      assert(step.resultRowSources?.length === step.partialResult?.rows.length, `${step.stage}: every intermediate row has aligned sources`);
      assert(provenanceFor(step, 'trace_parent', 1).resultRows.size === expectedCounts[i], `${step.stage}: pin follows text-key row through duplicates and aggregation`);
      if (['from', 'join', 'where'].includes(step.stage)) {
        step.partialResult!.rows.forEach((row, index) => {
          const source = step.resultRowSources![index];
          const expectedRid = ['beta', 'alpha', 'gone', 'empty'].indexOf(String(row[0])) + 1;
          assert(source.trace_parent?.[0] === expectedRid, `${step.stage}: source identity comes from the displayed row, not a separate scan order`);
        });
      }
    });
    const joined = steps.find((step) => step.stage === 'join')!;
    const unmatched = [...provenanceFor(joined, 'trace_parent', 4).resultRows][0];
    assert(joined.resultRowSources![unmatched].trace_child.length === 0, 'NULL-extended rows do not invent child provenance');
    assert(provenanceFor(steps.find((step) => step.stage === 'where')!, 'trace_parent', 3).resultRows.size === 0, 'WHERE removes eliminated row highlights');
    assert(provenanceFor(steps.find((step) => step.stage === 'having')!, 'trace_parent', 4).resultRows.size === 0, 'HAVING removes eliminated group highlights');

    database.run(`CREATE TABLE trace_many (id INTEGER PRIMARY KEY);
      INSERT INTO trace_many VALUES ${Array.from({ length: 120 }, (_, i) => `(${i + 1})`).join(',')};`);
    const largeSteps = traceSql('SELECT m.id FROM trace_many m CROSS JOIN trace_parent p WHERE m.id > 0', database, introspectSchema(database).schema);
    for (const step of largeSteps) {
      const matches = provenanceFor(step, 'trace_many', 120).resultRows;
      assert(matches.size === (step.stage === 'from' ? 1 : 4), `${step.stage}: pin remains available beyond the former 60-row preview`);
      assert([...matches].every((index) => step.partialResult!.rows[index][0] === 120), `${step.stage}: far-away pin points to its real displayed rows`);
    }
    database.close();
    console.log('  intermediate row provenance and full previews: ok');
  }
  {
    const database = new SQL.Database();
    database.run('PRAGMA foreign_keys = ON');
    database.run(`
      CREATE TABLE "Order" ("Order Id" INTEGER PRIMARY KEY, "Group" TEXT);
      CREATE TABLE line_item (id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES "Order"("Order Id"), qty INTEGER);
      CREATE TABLE staging_rows (label TEXT, amount INTEGER);
      INSERT INTO "Order" VALUES (1, 'a'), (2, 'b');
      INSERT INTO line_item VALUES (10, 1, 5), (11, 2, 6);
      INSERT INTO staging_rows VALUES ('x', 1), ('x', 1);
    `);
    const { schema } = introspectSchema(database);
    const trace = (sql: string) => traceSql(sql, database, schema);
    const reserved = trace('SELECT o."Group", l.qty FROM "Order" o JOIN line_item l ON o."Order Id" = l.order_id');
    assert(reserved.at(-1)?.partialResult?.rows.length === 2, 'reserved-word table and column names are quoted in generated SQL');
    const star = trace('SELECT * FROM "Order"');
    assert(JSON.stringify(star.at(-1)?.partialResult?.columns) === JSON.stringify(['Order Id', 'Group']), 'SELECT * keeps spaced column names');
    assert(star.at(-1)?.activeColumns.map((c) => c.column).join(',') === 'Order Id,Group', 'SELECT * highlights every selected column');
    const qualifiedStar = trace('SELECT O.* FROM "Order" o');
    assert(qualifiedStar.at(-1)?.activeColumns.length === 2, 'qualified wildcard highlights its columns with case-insensitive aliases');
    const keyless = trace('SELECT label, COUNT(*) FROM staging_rows GROUP BY label');
    assert(keyless.at(-1)?.partialResult?.rows[0]?.[1] === 2, 'tables without a primary key are traced by rowid');
    console.log('  quoted identifiers + keyless tables: ok');
  }
  {
    const expectError = (schemaId: string, sql: string, pattern: RegExp, label: string) => {
      let message = '';
      try {
        run(schemaId, sql);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert(pattern.test(message), `${label} (got "${message}")`);
    };
    expectError('observatory', 'SELECT GIVEN_NAM FROM ASTRONOMER', /Unknown column "GIVEN_NAM"\. ASTRONOMER has: ASTRONOMER_ID/, 'misspelled column is reported instead of returning a string literal');
    expectError('observatory', 'SELECT A.NOPE FROM ASTRONOMER A', /Unknown column "NOPE" in ASTRONOMER/, 'qualified misspelling names the table');
    expectError('observatory', 'SELECT Z.GIVEN_NAME FROM ASTRONOMER A', /"Z" is not a table or alias/, 'unknown alias is reported');
    expectError('observatory', 'SELECT GIVEN_NAME FROM ASTRONOMERS', /Unknown table "ASTRONOMERS"/, 'unknown table is reported');
    const correlated = run(
      'orchard',
      'SELECT P.PLOT_NAME FROM ORCHARD_PLOT P WHERE P.TREE_COUNT > (SELECT AVG(I.TREE_COUNT) FROM ORCHARD_PLOT I WHERE I.ZONE = P.ZONE)'
    );
    assert(correlated.at(-1)?.partialResult?.rows.length === 3, 'outer-scope references inside subqueries still validate');
    const literal = run('marine', 'SELECT COMMON_NAME FROM SPECIES WHERE TAG_COLOR = "Blue"');
    assert((literal.at(-1)?.partialResult?.rows.length ?? 0) > 0, 'double-quoted text is still accepted as a literal');
    console.log('  unknown column / table diagnostics: ok');
  }

  console.log('\n=== custom schema DDL normalization');
  {
    const { prepareCustomDdl } = await import('../lib/db');
    const build = (ddl: string): Database => {
      const database = new SQL.Database();
      database.run('PRAGMA foreign_keys = ON');
      for (const statement of prepareCustomDdl(ddl)) {
        try {
          database.run(statement.sql);
        } catch (error) {
          throw new Error(`${statement.summary}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return database;
    };
    const mysqlExport = `
      -- phpMyAdmin style export
      SET FOREIGN_KEY_CHECKS=0;
      CREATE DATABASE IF NOT EXISTS course;
      USE course;
      DROP TABLE IF EXISTS \`customers\`;
      CREATE TABLE \`customers\` (
        \`customer_id\` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'surrogate key',
        \`company_name\` VARCHAR(100) NOT NULL,
        \`tier\` ENUM('gold','silver') DEFAULT 'silver',
        \`notes\` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`customer_id\`),
        UNIQUE KEY \`uq_company\` (\`company_name\`),
        KEY \`idx_tier\` (\`tier\`)
      ) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Engine=Fake; still a comment';
      CREATE TABLE equipment (
        equipment_id INT PRIMARY KEY,
        customer_id INT UNSIGNED,
        model VARCHAR(50),
        CONSTRAINT fk_equipment_customer FOREIGN KEY fk_idx (customer_id) REFERENCES customers (customer_id) ON DELETE SET NULL
      ) ENGINE=MyISAM;
      CREATE TABLE import_equipment (equipment_id TEXT, model TEXT) ENGINE=MyISAM;
      INSERT INTO customers (company_name, tier) VALUES ('Acme; ENGINE=Fake', 'gold'), ('Bolt', 'silver');
      INSERT IGNORE INTO customers (customer_id, company_name) VALUES (1, 'Duplicate');
      INSERT INTO equipment VALUES (1, 1, 'GenX'), (2, 2, 'GenY');
      INSERT INTO import_equipment VALUES ('E1', 'GenX');
      COMMIT;
    `;
    const mysql = build(mysqlExport);
    const model = introspectSchema(mysql);
    assert(model.schema.map((table) => table.name).join(',') === 'customers,equipment,import_equipment', `MySQL export builds all tables (got ${model.schema.map((table) => table.name).join(',')})`);
    assert(model.fkEdges.length === 1 && model.fkEdges[0].source === 'customers', 'MySQL FOREIGN KEY with an index name still becomes an edge');
    assert(Number(mysql.exec('SELECT COUNT(*) FROM customers')[0].values[0][0]) === 2, 'INSERT IGNORE is honored and semicolons in text are kept');
    assert(mysql.exec("SELECT company_name FROM customers WHERE customer_id = 1")[0].values[0][0] === 'Acme; ENGINE=Fake', 'string literals are not rewritten');
    assert(model.schema[0].columns.find((column) => column.name === 'tier')?.type === 'TEXT', 'ENUM becomes TEXT');
    assert(!model.schema[2].columns.some((column) => column.pk), 'a keyless staging table is accepted');

    const postgresAndSqlServer = build(`
      CREATE TABLE dbo.departments (
        department_id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL
      );
      GO
      CREATE TABLE [dbo].[staff] (
        staff_id INT IDENTITY(1,1) PRIMARY KEY,
        department_id INT REFERENCES dbo.departments (department_id),
        [full name] NVARCHAR(80)
      );
      INSERT INTO dbo.departments (name) VALUES ('Physics');
      INSERT INTO dbo.staff (department_id, [full name]) VALUES (1, 'Ada');
    `);
    const pgModel = introspectSchema(postgresAndSqlServer);
    assert(pgModel.schema.length === 2 && pgModel.fkEdges.length === 1, 'SERIAL, IDENTITY, GO and dbo. prefixes are translated');
    assert(pgModel.schema[1].columns.some((column) => column.name === 'full name'), 'bracketed identifiers survive');

    const expectDdlError = (ddl: string, pattern: RegExp, label: string) => {
      let message = '';
      try {
        build(ddl);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert(pattern.test(message), `${label} (got "${message}")`);
    };
    expectDdlError(
      'CREATE TABLE a (id INT PRIMARY KEY); CREATE TABLE b (id INT, ID TEXT);',
      /^CREATE TABLE b: duplicate column name: ID/,
      'errors name the statement that failed'
    );
    expectDdlError(
      "CREATE TABLE a (id INT PRIMARY KEY); INSERT INTO a VALUES (1), (1);",
      /^INSERT INTO a: UNIQUE constraint failed/,
      'insert errors name their table'
    );
    expectDdlError("ATTACH DATABASE 'x' AS y;", /cannot use ATTACH, DETACH or PRAGMA/, 'ATTACH is rejected by name');
    expectDdlError('CREATE TABLE t AS SELECT 1 AS x;', /AS SELECT is not supported/, 'CREATE TABLE AS SELECT is rejected');
    expectDdlError('CREATE VIEW v AS SELECT 1;', /Views, triggers, procedures and functions are not part/, 'CREATE VIEW is explained');
    expectDdlError('SELECT * FROM x;', /Run SELECT queries from the query editor/, 'SELECT in the script points to the editor');
    expectDdlError('COPY t (a) FROM stdin;', /COPY \.\.\. FROM stdin/, 'COPY is explained');
    expectDdlError('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) INSERT INTO t SELECT x FROM c;', /Recursive queries are not allowed|only CREATE TABLE, INSERT/, 'recursive CTEs are refused');
    console.log('  dialect normalization + statement-level errors: ok');
  }

  console.log('\n=== INSERT / UPDATE / DELETE / ALTER dialect coverage');
  {
    const { buildCustomDatabase, prepareCustomDdl } = await import('../lib/db');
    const build = async (ddl: string): Promise<Database> => buildCustomDatabase(SQL, prepareCustomDdl(ddl));
    const count = (database: Database, sql: string) => Number(database.exec(sql)[0]?.values[0]?.[0] ?? 0);

    // MySQL dump: # comments, \' escapes, INSERT ... SET, REPLACE, upsert, NOW(), FK checks off.
    const mysql = await build(`
      # phpMyAdmin dump
      SET FOREIGN_KEY_CHECKS=0;
      /*!40101 SET NAMES utf8mb4 */;
      CREATE TABLE \`customers\` (
        \`id\` INT(11) NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(60) NOT NULL,
        \`joined\` DATETIME DEFAULT NOW(),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      CREATE TABLE \`orders\` (
        \`id\` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`customer_id\` INT NOT NULL,
        \`note\` TEXT,
        KEY \`fk_idx\` (\`customer_id\`),
        CONSTRAINT \`fk_orders_customers\` FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
      -- child rows first, as dumps often do
      INSERT INTO \`orders\` VALUES (1, 1, 'Ship to O\\'Brien; urgent'), (2, 2, "double quoted");
      INSERT INTO \`customers\` (\`id\`, \`name\`) VALUES (1, 'O\\'Brien'), (2, 'Ada');
      INSERT INTO customers SET id = 3, name = 'Set form';
      REPLACE INTO customers (id, name) VALUES (3, 'Replaced');
      INSERT INTO customers (id, name) VALUES (2, 'Dup') ON DUPLICATE KEY UPDATE name = VALUES(name);
      INSERT IGNORE INTO customers (id, name) VALUES (1, 'Ignored');
      UPDATE customers SET name = UPPER(name) WHERE id = 1;
      DELETE FROM orders WHERE note LIKE '%double%';
      SET FOREIGN_KEY_CHECKS=1;
      COMMIT;
    `);
    assert(count(mysql, 'SELECT COUNT(*) FROM customers') === 3, 'MySQL dump: three customers after REPLACE, upsert and IGNORE');
    assert(mysql.exec("SELECT name FROM customers WHERE id = 1")[0].values[0][0] === "O'BRIEN", "backslash-escaped quote converted and UPDATE applied");
    assert(mysql.exec('SELECT name FROM customers WHERE id = 2')[0].values[0][0] === 'Dup', 'ON DUPLICATE KEY UPDATE became an upsert');
    assert(mysql.exec('SELECT name FROM customers WHERE id = 3')[0].values[0][0] === 'Replaced', 'INSERT ... SET and REPLACE INTO work');
    assert(count(mysql, 'SELECT COUNT(*) FROM orders') === 1, 'child rows inserted before parents are accepted; DELETE applied');
    assert(mysql.exec("SELECT note FROM orders")[0].values[0][0] === "Ship to O'Brien; urgent", 'escaped quote and semicolon inside a literal survive');
    assert(count(mysql, 'PRAGMA foreign_keys') === 1, 'foreign keys are re-enabled after an out-of-order load');

    // pg_dump: public. prefixes, ::casts, nextval, ALTER TABLE ONLY ... ADD CONSTRAINT, COMMENT ON, setval.
    const postgres = await build(`
      SET statement_timeout = 0;
      \\connect course
      CREATE SEQUENCE public.department_id_seq;
      CREATE TABLE public.department (
          id integer NOT NULL DEFAULT nextval('public.department_id_seq'::regclass),
          name character varying(50) NOT NULL,
          founded date DEFAULT '2000-01-01'::date
      );
      CREATE TABLE public.staff (
          id integer NOT NULL,
          department_id integer,
          full_name text,
          active boolean DEFAULT true
      );
      COMMENT ON TABLE public.staff IS 'people';
      INSERT INTO public.department (name) VALUES (E'Physics'), ('Maths');
      INSERT INTO public.staff (id, department_id, full_name, active) VALUES (1, 1, 'Ada', true), (2, 2, 'Grace', false);
      ALTER TABLE ONLY public.department ADD CONSTRAINT department_pkey PRIMARY KEY (id);
      ALTER TABLE ONLY public.staff
          ADD CONSTRAINT staff_pkey PRIMARY KEY (id),
          ADD CONSTRAINT staff_department_fkey FOREIGN KEY (department_id) REFERENCES public.department(id) ON DELETE SET NULL;
      SELECT pg_catalog.setval('public.department_id_seq', 2, true);
      CREATE INDEX staff_department_idx ON public.staff USING btree (department_id);
      UPDATE public.staff SET active = true WHERE id = 2;
    `);
    const pgModel = introspectSchema(postgres);
    assert(pgModel.schema.find((t) => t.name === 'department')?.columns.find((c) => c.name === 'id')?.pk === true, 'ALTER TABLE ADD PRIMARY KEY is folded into CREATE TABLE');
    assert(pgModel.fkEdges.length === 1, 'ALTER TABLE ADD FOREIGN KEY becomes an edge');
    assert(count(postgres, 'SELECT COUNT(*) FROM department') === 2 && count(postgres, 'SELECT MAX(id) FROM department') === 2, 'nextval column auto-numbers like a sequence');
    assert(count(postgres, 'SELECT COUNT(*) FROM staff WHERE active = 1') === 2, 'UPDATE applied; boolean literals accepted');

    // SQL Server: N'' strings, GETDATE(), IDENTITY, BEGIN TRANSACTION, [brackets], GO batches.
    const sqlServer = await build(`
      SET IDENTITY_INSERT [dbo].[course] ON
      GO
      BEGIN TRANSACTION
      CREATE TABLE [dbo].[course] (
        [course_id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [title] NVARCHAR(100) NOT NULL,
        [created] DATETIME2 DEFAULT GETDATE()
      );
      GO
      INSERT INTO [dbo].[course] ([course_id], [title]) VALUES (10, N'Databases'), (11, N'Networks');
      UPDATE [dbo].[course] SET [title] = N'Advanced Databases' WHERE [course_id] = 10;
      DELETE FROM [dbo].[course] WHERE [course_id] = 11;
      COMMIT TRANSACTION
      GO
    `);
    assert(sqlServer.exec('SELECT title FROM course')[0].values.length === 1, 'SQL Server batch: UPDATE and DELETE applied');
    assert(sqlServer.exec('SELECT title FROM course')[0].values[0][0] === 'Advanced Databases', 'N-prefixed strings are plain text');

    // Oracle: VARCHAR2, NUMBER, TO_DATE, SYSDATE, TRUNCATE.
    const oracle = await build(`
      CREATE TABLE patient (
        patient_id NUMBER(6) PRIMARY KEY,
        surname VARCHAR2(40) NOT NULL,
        admitted DATE DEFAULT SYSDATE
      );
      INSERT INTO patient VALUES (1, 'Okafor', TO_DATE('2024-03-05', 'YYYY-MM-DD'));
      INSERT INTO patient VALUES (2, 'Lind', TO_DATE('2024-04-06 10:30', 'YYYY-MM-DD HH24:MI'));
      TRUNCATE TABLE patient;
      INSERT INTO patient (patient_id, surname) VALUES (3, 'Reyes');
    `);
    assert(count(oracle, 'SELECT COUNT(*) FROM patient') === 1, 'TRUNCATE empties the table before the final insert');
    assert(String(oracle.exec("SELECT admitted FROM patient")[0].values[0][0]).length >= 19, 'SYSDATE default became CURRENT_TIMESTAMP');

    // Referential errors after the order-insensitive retry name the orphan.
    const orphan = await build(`
      CREATE TABLE parent_t (id INT PRIMARY KEY);
      CREATE TABLE child_t (id INT PRIMARY KEY, parent_id INT REFERENCES parent_t(id));
      INSERT INTO child_t VALUES (1, 999);
    `).then(() => '', (error: Error) => error.message);
    assert(/FOREIGN KEY constraint failed: child_t has a row with parent_id = 999, but no parent_t row/.test(orphan), `orphan rows are explained (got "${orphan}")`);

    let modifyMessage = '';
    try {
      prepareCustomDdl('CREATE TABLE t (id INT PRIMARY KEY, n INT); ALTER TABLE t MODIFY n BIGINT;');
    } catch (error) {
      modifyMessage = error instanceof Error ? error.message : String(error);
    }
    assert(/cannot change a column's definition afterwards/.test(modifyMessage), 'ALTER TABLE MODIFY gets a specific explanation');
    const addColumn = await build('CREATE TABLE t (id INT PRIMARY KEY); ALTER TABLE t ADD extra TEXT DEFAULT \'x\', ADD INDEX ix (extra); INSERT INTO t (id) VALUES (1);');
    assert(addColumn.exec('SELECT extra FROM t')[0].values[0][0] === 'x', 'ALTER TABLE ADD column runs natively while ADD INDEX is dropped');
    console.log('  INSERT / UPDATE / DELETE / ALTER dialects: ok');

    console.log('\n=== CREATE TABLE / INSERT edge cases');
    const failure = async (ddl: string): Promise<string> =>
      build(ddl).then(() => '', (error: Error) => error.message);
    const cell = (database: Database, sql: string) => database.exec(sql)[0]?.values[0]?.[0];

    // Pasted from Word / Outlook: BOM, curly quotes, non-breaking spaces, CRLF.
    const pasted = await build(
      '﻿CREATE TABLE notes (id INT PRIMARY KEY, body TEXT);\r\n' +
        'INSERT INTO notes VALUES (1, ‘It’s here’);\r\n'.replace('‘It’s here’', '‘Word text’')
    );
    assert(cell(pasted, 'SELECT body FROM notes') === 'Word text', 'BOM, NBSP and smart quotes from a word processor are repaired');
    const curlyData = await build("CREATE TABLE q (id INT PRIMARY KEY, body TEXT); INSERT INTO q VALUES (1, 'O’Brien');");
    assert(cell(curlyData, 'SELECT body FROM q') === 'O’Brien', 'a curly apostrophe inside a normal string is kept as data');

    // Columns whose names look like keywords the normalizer handles.
    const keywordColumns = await build(`
      CREATE TABLE \`cars\` (
        \`id\` INT(11) NOT NULL AUTO_INCREMENT,
        \`key\` INT(11) DEFAULT NULL,
        \`index\` VARCHAR(20) DEFAULT "n/a",
        \`engine\` VARCHAR(30) COLLATE NOCASE,
        \`comment\` TEXT,
        \`charset\` VARCHAR(10),
        \`type\` ENUM('a','b') DEFAULT 'a',
        \`flag\` BIT(1) DEFAULT b'1',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_key\` (\`key\`),
        KEY \`ix_index\` (\`index\`(10)) USING BTREE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='engine, key and index are column names here';
      INSERT INTO cars (\`key\`, \`index\`, \`engine\`, \`comment\`, \`charset\`) VALUES (7, "idx", "v8", "fine; really", "utf8");
      INSERT INTO cars (\`key\`) VALUES (7);
    `.replace('INSERT INTO cars (`key`) VALUES (7);', ''));
    const carsModel = introspectSchema(keywordColumns);
    assert(
      carsModel.schema[0].columns.map((c) => c.name).join(',') === 'id,key,index,engine,comment,charset,type,flag',
      `columns named key/index/engine/comment/charset survive (got ${carsModel.schema[0].columns.map((c) => c.name).join(',')})`
    );
    assert(cell(keywordColumns, 'SELECT `index` FROM cars') === 'idx' && cell(keywordColumns, 'SELECT id FROM cars') === 1, 'MySQL double-quoted strings and auto id work');
    assert(cell(keywordColumns, 'SELECT flag FROM cars') === 1, "b'1' bit literal becomes 1");
    assert(/UNIQUE constraint failed/.test(await failure('CREATE TABLE u (id INT PRIMARY KEY, k INT, UNIQUE KEY uq (k)); INSERT INTO u VALUES (1, 5), (2, 5);')), 'UNIQUE KEY is kept as a constraint rather than dropped');
    const nocase = await build("CREATE TABLE n (id INT PRIMARY KEY, name TEXT COLLATE NOCASE); INSERT INTO n VALUES (1, 'Ada');");
    assert(cell(nocase, "SELECT COUNT(*) FROM n WHERE name = 'ADA'") === 1, 'SQLite COLLATE NOCASE is preserved');

    // Type spellings from other engines.
    const types = await build(`
      CREATE TABLE [dbo].[mixed] (
        [id] INT IDENTITY(1,1) NOT NULL,
        [title] NVARCHAR(MAX) NULL,
        [code] VARCHAR2(10 CHAR),
        [tags] text[],
        [amount] MONEY DEFAULT ((0)),
        [created] DATETIME2(7) DEFAULT (getdate()),
        [stamp] TIMESTAMP DEFAULT TIMESTAMP '2024-01-01 00:00:00',
        CONSTRAINT [PK_mixed] PRIMARY KEY CLUSTERED ([id] ASC) WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF) ON [PRIMARY]
      ) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY];
      INSERT INTO [dbo].[mixed] ([title], [code], [tags]) VALUES (N'Wide', 'AB', 'x');
    `);
    assert(cell(types, 'SELECT id FROM mixed') === 1 && cell(types, 'SELECT stamp FROM mixed') === '2024-01-01 00:00:00', 'SQL Server / Oracle / Postgres type decorations are stripped');

    // INSERT shapes.
    const inserts = await build(`
      CREATE TABLE p (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT 'anon', qty INT DEFAULT 0);
      INSERT INTO p () VALUES ();
      INSERT LOW_PRIORITY INTO p (name) VALUE ('single');
      INSERT INTO p (id, name, qty) VALUES
        (10, 'It''s "quoted"', 0x1F),
        (11, 'semi;colon -- not a comment /* nor this */', -3),
        (12, '中文 émoji 🙂', 1e2);
      INSERT INTO p (name) SELECT name || '2' FROM p WHERE id = 10;
    `);
    assert(cell(inserts, 'SELECT COUNT(*) FROM p') === 6, 'empty VALUES (), VALUE, multi-row, hex, negative, scientific and INSERT ... SELECT all load');
    assert(cell(inserts, "SELECT name FROM p WHERE id = 12") === '中文 émoji 🙂', 'unicode data round-trips');
    assert(cell(inserts, 'SELECT name FROM p WHERE id = 11') === 'semi;colon -- not a comment /* nor this */', 'comment markers inside strings are data');
    assert(/SQLite has no DEFAULT keyword inside VALUES/.test(await failure('CREATE TABLE d (id INT PRIMARY KEY, n INT DEFAULT 1); INSERT INTO d VALUES (1, DEFAULT);')), 'DEFAULT inside VALUES gets a specific explanation');
    assert(/INSERT INTO d: table d has 2 columns but 3 values were supplied/.test(await failure('CREATE TABLE d (id INT PRIMARY KEY, n INT); INSERT INTO d VALUES (1, 2, 3);')), 'a column-count mismatch names the statement');
    assert(/CREATE TABLE d: table d already exists/.test(await failure('CREATE TABLE d (id INT PRIMARY KEY); CREATE TABLE d (x INT);')), 'a duplicate table names the statement');
    assert(/No tables|only sets up data|Remove/.test(await failure('-- nothing but comments\n# and more\n')) || (await failure('-- only comments\n')) === '', 'a comment-only script does not crash the builder');

    // Forward references: child table created before its parent.
    const forward = await build(`
      CREATE TABLE enrollment (id INT PRIMARY KEY, student_id INT REFERENCES student(id));
      INSERT INTO enrollment VALUES (1, 100);
      CREATE TABLE student (id INT PRIMARY KEY, name TEXT);
      INSERT INTO student VALUES (100, 'Ada');
    `);
    assert(cell(forward, 'SELECT COUNT(*) FROM enrollment') === 1 && cell(forward, 'PRAGMA foreign_keys') === 1, 'a child table referencing a table created later still loads with keys enforced');

    // A column literally named rowid must not hijack row tracing.
    const rowidColumn = await build('CREATE TABLE legacy (rowid TEXT, note TEXT); INSERT INTO legacy VALUES (\'A\', \'first\'), (\'B\', \'second\');');
    const legacyData = getTableData(rowidColumn, 'legacy');
    assert(JSON.stringify(legacyData.rids) === '[1,2]' && legacyData.columns.join(',') === 'rowid,note', 'a user column named rowid does not replace the real row numbers');
    const legacyTrace = traceSql("SELECT note FROM legacy WHERE rowid = 'B'", rowidColumn, introspectSchema(rowidColumn).schema);
    assert(legacyTrace.at(-1)?.resultRowSources?.[0]?.legacy[0] === 2, 'tracing uses _rowid_ so provenance survives a rowid column');
    assert(/reserves for tracing rows/.test(await failure('CREATE TABLE r (_rowid_ INT PRIMARY KEY);')), 'a column named _rowid_ is refused with an explanation');

    // Schema prefixes other than dbo/public, quoted names, TEMP tables, IF NOT EXISTS.
    const prefixed = await build(`
      CREATE TEMPORARY TABLE IF NOT EXISTS hr."Employee Roster" (id INT PRIMARY KEY, dept_id INT REFERENCES hr.dept(id));
      CREATE TABLE hr.dept (id INT PRIMARY KEY, name TEXT);
      INSERT INTO hr.dept VALUES (1, 'Ops');
      INSERT INTO hr."Employee Roster" VALUES (7, 1);
      UPDATE hr."Employee Roster" SET dept_id = 1 WHERE id = 7;
      DELETE FROM hr.dept WHERE id = 99;
    `);
    const prefixedModel = introspectSchema(prefixed);
    assert(prefixedModel.schema.map((t) => t.name).join('|') === 'Employee Roster|dept' && prefixedModel.fkEdges.length === 1, `schema prefixes are dropped at every table position (got ${prefixedModel.schema.map((t) => t.name).join('|')})`);
    console.log('  CREATE TABLE / INSERT edge cases: ok');
  }

  console.log('\n=== clause ranges');
  {
    const { computeClauseRanges } = await import('../lib/clauseRanges');
    const query =
      "SELECT V.VENUE_NAME, SUM(R.SEATS) AS 'Saturday Seats'\nFROM VENUE V JOIN SCREENING S ON V.VENUE_ID = S.VENUE_ID\nJOIN RESERVATION R ON S.SCREENING_ID = R.SCREENING_ID\nWHERE S.SCREENING_DAY = 'Saturday'\nGROUP BY V.VENUE_NAME\nORDER BY SUM(R.SEATS) DESC";
    const ranges = computeClauseRanges(query);
    const slice = (range?: { start: number; end: number }) =>
      range ? query.slice(range.start, range.end) : '';
    assert(slice(ranges.select).startsWith('SELECT V.VENUE_NAME'), 'select range');
    assert(slice(ranges.from) === 'FROM VENUE V', 'from range');
    assert(slice(ranges.joins[0]) === 'JOIN SCREENING S ON V.VENUE_ID = S.VENUE_ID', 'first join range');
    assert(slice(ranges.where) === "WHERE S.SCREENING_DAY = 'Saturday'", 'where range');
    assert(slice(ranges.groupBy) === 'GROUP BY V.VENUE_NAME', 'group range');
    assert(slice(ranges.orderLimit) === 'ORDER BY SUM(R.SEATS) DESC', 'order range');
    const quoted = "SELECT FILM_TITLE AS 'FROM WHERE' FROM SCREENING WHERE FILM_TITLE LIKE '%JOIN%'";
    const quotedRanges = computeClauseRanges(quoted);
    assert(quoted.slice(quotedRanges.from!.start, quotedRanges.from!.end) === 'FROM SCREENING', 'string literals are skipped');
    assert(quotedRanges.joins.length === 0, 'JOIN inside a string is not a clause');
    console.log('  clause ranges: ok');
  }

  console.log('\n=== dialect translation (MySQL / MariaDB first, PostgreSQL, SQL Server, Oracle)');
  {
    const { translateQuery } = await import('../lib/dialect');
    const notesOf = (sql: string) => {
      const parsed = parseQuery(sql);
      if (!parsed.ok) throw new Error(`${parsed.error} :: ${sql}`);
      return parsed.notes.map((note) => note.from);
    };
    const rows = (schemaId: string, sql: string) => run(schemaId, sql).at(-1)!.partialResult!.rows;
    const expectError = (schemaId: string, sql: string, pattern: RegExp, label: string) => {
      let message = '';
      try {
        run(schemaId, sql);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert(pattern.test(message), `${label} (got "${message}")`);
    };

    // SQL Server / Oracle row limiting.
    const top = run('transit', 'SELECT TOP 3 ROUTE_NAME FROM FERRY_ROUTE ORDER BY FARE DESC');
    assert(top.at(-1)?.partialResult?.rows.length === 3 && top.at(-1)?.partialResult?.rows[0][0] === 'Island Express', 'TOP n becomes LIMIT n after ORDER BY');
    assert(notesOf('SELECT TOP 3 ROUTE_NAME FROM FERRY_ROUTE').includes('TOP 3'), 'TOP is explained in a note');
    assert(rows('transit', 'SELECT ROUTE_NAME FROM FERRY_ROUTE ORDER BY FARE OFFSET 8 ROWS FETCH NEXT 5 ROWS ONLY').length === 2, 'OFFSET ... FETCH NEXT becomes LIMIT ... OFFSET');
    assert(rows('transit', 'SELECT ROUTE_NAME FROM FERRY_ROUTE WHERE ROWNUM <= 4').length === 4, 'Oracle ROWNUM <= n becomes LIMIT n');
    assert(rows('transit', "SELECT ROUTE_NAME FROM FERRY_ROUTE WHERE TERMINAL_ZONE = 'Central' AND ROWNUM < 3 ORDER BY FARE").length === 2, 'trailing AND ROWNUM < n becomes LIMIT n - 1');
    const { assignQueryRanges: assignRanges } = await import('../lib/clauseRanges');
    const topSql = 'SELECT TOP 2 ROUTE_NAME FROM FERRY_ROUTE';
    const topSteps = run('transit', topSql);
    assignRanges(topSteps, topSql);
    assert(topSteps.at(-1)?.stage === 'orderLimit' && topSteps.at(-1)?.queryRange?.start === 7, 'the LIMIT stage highlights the TOP keyword in the original text');

    // MySQL spellings.
    assert(rows('festival', 'SELECT `FAMILY_NAME` FROM `ATTENDEE` WHERE `CITY` = "Juniper Bay"').length === 3, 'backtick names and double-quoted strings read like MySQL');
    assert(rows('festival', "SELECT FAMILY_NAME FROM ATTENDEE WHERE FAMILY_NAME ILIKE 'a%'").length === 1, 'ILIKE becomes LIKE');
    assert(rows('festival', "SELECT FAMILY_NAME FROM ATTENDEE WHERE FAMILY_NAME RLIKE '^[A-C]'").length === 3, 'RLIKE / REGEXP work through the JavaScript regexp function');
    assert(rows('transit', 'SELECT ROUTE_CODE FROM FERRY_ROUTE WHERE SCHEDULED_TRIPS DIV 5 = 2').length === 4, 'a DIV b becomes integer division');
    assert(rows('festival', "SELECT PASS_TYPE, GROUP_CONCAT(FAMILY_NAME SEPARATOR ' | ') FROM ATTENDEE GROUP BY PASS_TYPE").find((row) => row[0] === 'Weekend')?.[1] === 'Adebayo | El-Amin | Ibarra', 'GROUP_CONCAT ... SEPARATOR becomes the two-argument form and counts as an aggregate');
    assert(rows('transit', "SELECT IF(NIGHT_SERVICE = 1, 'night', 'day') AS SERVICE, IFNULL(NULL, 'x'), NVL(NULL, 'y'), ISNULL(NULL, 'z') FROM FERRY_ROUTE WHERE ROUTE_CODE = 'H22'")[0].join(',') === 'night,x,y,z', 'IF / IFNULL / NVL / ISNULL evaluate');
    assert(rows('transit', 'SELECT ROUTE_CODE FROM FERRY_ROUTE WHERE FARE > .5 AND FARE <=> FARE').length === 10, 'leading-dot decimals and <=> are translated');
    assert(rows('transit', 'SELECT ROUTE_CODE FROM FERRY_ROUTE # MySQL comment\nWHERE FARE < 5').length === 1, '# comments are accepted');
    assert(rows('festival', "SELECT FAMILY_NAME FROM ATTENDEE WHERE GIVEN_NAME = N'Nia' OR FAMILY_NAME = 'O\\'Neil'").length === 1, "N'' prefixes and backslash-escaped quotes are translated");
    assert(rows('transit', 'SELECT LEFT(ROUTE_NAME, 3), RIGHT(ROUTE_NAME, 4), LEN(ROUTE_NAME), LCASE(ROUTE_CODE), UCASE(ROUTE_NAME), REPEAT(\'ab\', 2), LPAD(ROUTE_CODE, 5, \'0\'), REVERSE(\'abc\'), SUBSTRING_INDEX(ROUTE_NAME, \' \', 1), LOCATE(\'Loop\', ROUTE_NAME), CONCAT_WS(\'-\', ROUTE_CODE, ROUTE_NAME) FROM FERRY_ROUTE WHERE ROUTE_CODE = \'B01\'')[0].join('|') === 'Bay|Loop|8|b01|BAY LOOP|abab|00B01|cba|Bay|5|B01-Bay Loop', 'MySQL / SQL Server string functions are emulated');
    assert(rows('transit', 'SELECT MOD(SCHEDULED_TRIPS, 5), CEILING(FARE), TRUNCATE(FARE, 0), GREATEST(FARE, 10), LEAST(FARE, 10), POWER(2, 3), FORMAT(FARE, 1) FROM FERRY_ROUTE WHERE ROUTE_CODE = \'B01\'')[0].join('|') === '4|9|8|10|8.5|8|8.5', 'MySQL numeric functions are emulated');
    assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(rows('transit', 'SELECT NOW() FROM FERRY_ROUTE LIMIT 1')[0][0])), 'NOW() returns a SQLite-style timestamp');
    const dates = rows('observatory', "SELECT YEAR(OBSERVED_ON), MONTH(OBSERVED_ON), DAY(OBSERVED_ON), DAYNAME(OBSERVED_ON), MONTHNAME(OBSERVED_ON), QUARTER(OBSERVED_ON), WEEK(OBSERVED_ON), DAYOFWEEK(OBSERVED_ON), WEEKDAY(OBSERVED_ON), DAYOFYEAR(OBSERVED_ON), LAST_DAY(OBSERVED_ON), DATE_FORMAT(OBSERVED_ON, '%d/%m/%Y %W %b %e%%'), DATEDIFF('2026-03-20', OBSERVED_ON), DATE_ADD(OBSERVED_ON, INTERVAL 1 MONTH), DATE_SUB(OBSERVED_ON, INTERVAL 12 DAY), OBSERVED_ON + INTERVAL 2 YEAR, EXTRACT(YEAR FROM OBSERVED_ON), DATE_TRUNC('month', OBSERVED_ON), TO_CHAR(OBSERVED_ON, 'DD Mon YYYY'), STR_TO_DATE('15/03/2026', '%d/%m/%Y'), TO_DATE('2026-03-15', 'YYYY-MM-DD'), DATEADD(day, 10, OBSERVED_ON), DATEDIFF(day, OBSERVED_ON, '2026-03-22'), TIMESTAMPDIFF(MONTH, OBSERVED_ON, '2026-06-30'), DATEPART(year, OBSERVED_ON) FROM OBSERVATION WHERE OBSERVATION_ID = 5001");
    assert(
      JSON.stringify(dates[0]) === JSON.stringify([2026, 3, 12, 'Thursday', 'March', 1, 11, 5, 3, 71, '2026-03-31', '12/03/2026 Thursday Mar 12%', 8, '2026-04-12', '2026-02-28', '2028-03-12', 2026, '2026-03-01 00:00:00', '12 Mar 2026', '2026-03-15', '2026-03-15', '2026-03-22', 10, 3, 2026]),
      `MySQL / PostgreSQL / SQL Server / Oracle date functions agree on a fixed date (got ${JSON.stringify(dates[0])})`
    );
    assert(rows('transit', "SELECT DATE_ADD('2024-01-31', INTERVAL 1 MONTH), DATE_ADD('2024-01-31 10:00:00', INTERVAL 1 DAY), DATE_ADD('2024-03-01', INTERVAL -1 DAY) FROM FERRY_ROUTE LIMIT 1")[0].join('|') === '2024-02-29|2024-02-01 10:00:00|2024-02-29', 'month arithmetic clamps like MySQL and keeps a time component');
    assert(rows('transit', 'SELECT YEAR(NULL), DATE_FORMAT(\'not a date\', \'%Y\'), LEFT(NULL, 2), MOD(5, 0) FROM FERRY_ROUTE LIMIT 1')[0].every((value) => value === null), 'emulated functions return NULL for NULL or unreadable input');
    const noteNames = notesOf("SELECT YEAR(OBSERVED_ON), DATEDIFF('2026-03-20', OBSERVED_ON) FROM OBSERVATION WHERE OBSERVED_ON REGEXP '^2026'");
    assert(noteNames.includes('YEAR()') && noteNames.includes('DATEDIFF()') && noteNames.includes('REGEXP'), `emulated functions are named in the notes (got ${noteNames.join(', ')})`);

    // PostgreSQL spellings.
    assert(rows('transit', "SELECT FARE::text, SCHEDULED_TRIPS::numeric, '2026-01-05'::date, CAST(FARE AS UNSIGNED), CAST(FARE AS CHAR(5)), CAST('2026-01-05 10:00' AS DATETIME) FROM FERRY_ROUTE WHERE ROUTE_CODE = 'B01'")[0].join('|') === '8.5|14|2026-01-05|8|8.5|2026-01-05 10:00:00', '::casts and MySQL / SQL Server CAST types map onto SQLite types');
    assert(rows('festival', "SELECT SUBSTRING(FAMILY_NAME FROM 1 FOR 3), TRIM(BOTH 'A' FROM 'ABBA'), POSITION('e' IN FAMILY_NAME), CONCAT(GIVEN_NAME, ' ', FAMILY_NAME) FROM ATTENDEE WHERE ATTENDEE_ID = 301")[0].join('|') === 'Ade|BB|3|Nia Adebayo', 'SUBSTRING FROM FOR, TRIM FROM and POSITION IN are translated');
    const nullsLast = rows('marine', 'SELECT TAG_COLOR FROM SPECIES ORDER BY TAG_COLOR NULLS LAST');
    assert(nullsLast[0][0] === 'Blue' && nullsLast.at(-1)?.[0] === null && nullsLast.at(-2)?.[0] === null, 'NULLS LAST is emulated with an IS NULL sort key');
    const nullsFirst = rows('marine', 'SELECT TAG_COLOR FROM SPECIES ORDER BY TAG_COLOR DESC NULLS FIRST');
    assert(nullsFirst[0][0] === null && nullsFirst[2][0] === 'Yellow', 'NULLS FIRST keeps the DESC direction of the column itself');
    assert(rows('marine', "SELECT COMMON_NAME FROM SPECIES WHERE TAG_COLOR IS DISTINCT FROM 'Blue'").length === 8, 'IS DISTINCT FROM is null-safe (NULL rows count as different)');
    assert(rows('transit', 'SELECT 1 + 1, UPPER(\'x\')')[0].join(',') === '2,X', 'a SELECT without FROM evaluates once');
    assert(rows('transit', 'SELECT 42 FROM DUAL')[0][0] === 42, 'Oracle FROM DUAL is dropped');
    assert(rows('transit', 'SELECT ROUTE_CODE FROM FERRY_ROUTE FOR UPDATE').length === 10, 'FOR UPDATE is dropped');

    // Set operations beyond UNION.
    const intersect = run('festival', 'SELECT CITY FROM ATTENDEE INTERSECT SELECT CITY FROM VENUE');
    assert(intersect.at(-1)?.partialResult?.rows.length === 5 && intersect.filter((step) => step.stage === 'union').length === 3, 'INTERSECT shows both branches and the final result');
    assert(run('festival', 'SELECT CITY FROM ATTENDEE EXCEPT SELECT CITY FROM VENUE ORDER BY CITY').at(-1)?.partialResult?.rows.map((row) => row[0]).join(',') === 'Marrow Glen', 'EXCEPT keeps cities with attendees but no venue, honoring a final ORDER BY');
    assert(run('festival', 'SELECT CITY FROM ATTENDEE MINUS SELECT CITY FROM VENUE').at(-1)?.partialResult?.rows.length === 1, 'Oracle MINUS becomes EXCEPT');
    assert(run('festival', 'SELECT CITY FROM ATTENDEE WHERE PASS_TYPE = \'Day\' UNION SELECT CITY FROM VENUE INTERSECT SELECT CITY FROM ATTENDEE').at(-1)?.partialResult?.rows.length === 6, 'mixed UNION and INTERSECT compounds run left to right');
    expectError('festival', 'SELECT CITY FROM ATTENDEE INTERSECT SELECT NOPE FROM VENUE', /Unknown column "NOPE"/, 'compound branches are column-checked');

    // Constructs without a SQLite equivalent explain the alternative.
    expectError('transit', 'SELECT DISTINCT ON (TERMINAL_ZONE) ROUTE_NAME FROM FERRY_ROUTE', /DISTINCT ON is PostgreSQL-only/, 'DISTINCT ON is explained');
    expectError('festival', 'SELECT FAMILY_NAME FROM ATTENDEE NATURAL JOIN RESERVATION', /NATURAL JOIN is not visualized/, 'NATURAL JOIN is explained');
    expectError('transit', 'SELECT TERMINAL_ZONE, COUNT(*) FROM FERRY_ROUTE GROUP BY TERMINAL_ZONE WITH ROLLUP', /ROLLUP/, 'WITH ROLLUP is explained');
    expectError('transit', 'SELECT ROUTE_NAME FROM FERRY_ROUTE WHERE FARE > ALL (SELECT FARE FROM FERRY_ROUTE WHERE NIGHT_SERVICE = 1)', /no ALL \/ ANY \/ SOME/, 'ALL / ANY quantifiers are explained');
    expectError('transit', 'SELECT TOP 10 PERCENT ROUTE_NAME FROM FERRY_ROUTE', /TOP n PERCENT/, 'TOP PERCENT is explained');
    expectError('transit', 'SELECT @total := SUM(FARE) FROM FERRY_ROUTE', /Session variables/, 'MySQL session variables are explained');
    expectError('transit', 'SELECT ROUTE_NAME INTO ROUTE_COPY FROM FERRY_ROUTE', /SELECT \.\.\. INTO/, 'SELECT INTO is explained');
    expectError('transit', 'SELECT ROUTE_NAME FROM FERRY_ROUTE WHERE FARE > 1 - INTERVAL 1 PARSEC', /INTERVAL 1 is not understood/, 'unknown INTERVAL units are explained');
    expectError('transit', 'CREATE TABLE extra (id INT)', /CREATE changes the structure/, 'DDL in the editor points to the schema builder');
    expectError('transit', 'SELECT ROUTE_NAME FROM FERRY_ROUTE WHERE NIGHT_SERVICE = 1 AND ROWNUM_X <= 5', /Unknown column "ROWNUM_X"/, 'lookalike names still get the normal unknown-column message');
    expectError('transit', 'SELECT ROUTE_NAME FROM FERRY_ROUTE WHERE ROWNUM <= 5 AND NIGHT_SERVICE = 1', /ROWNUM is Oracle-specific/, 'ROWNUM in the middle of a WHERE is explained');
    assert(translateQuery("SELECT x FROM t WHERE y = 'TOP 5 :: ILIKE' -- TOP 9").sql === "SELECT x FROM t WHERE y = 'TOP 5 :: ILIKE' -- TOP 9", 'literals and comments are never rewritten');
    console.log('  dialect translation: ok');
  }

  console.log('\n=== CTEs, window functions, CASE, ordinals');
  {
    const rows = (schemaId: string, sql: string) => run(schemaId, sql).at(-1)!.partialResult!.rows;
    const expectError = (schemaId: string, sql: string, pattern: RegExp, label: string) => {
      let message = '';
      try {
        run(schemaId, sql);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert(pattern.test(message), `${label} (got "${message}")`);
    };
    const cte = run('festival', 'WITH saturday AS (SELECT SCREENING_ID, FILM_TITLE FROM SCREENING WHERE SCREENING_DAY = \'Saturday\') SELECT s.FILM_TITLE, COUNT(*) AS bookings FROM saturday s JOIN RESERVATION r ON s.SCREENING_ID = r.SCREENING_ID GROUP BY s.FILM_TITLE ORDER BY COUNT(*) DESC');
    assert(cte[0].stage === 'subquery' && cte[0].label.startsWith('WITH saturday - 3 rows'), `a CTE gets its own stage (got "${cte[0].label}")`);
    assert(cte.at(-1)?.partialResult?.rows.length === 3 && cte.at(-1)?.partialResult?.rows[0][1] === 5, `the main query reads the CTE like a table (got ${JSON.stringify(cte.at(-1)?.partialResult?.rows)})`);
    const chained = run('marine', 'WITH fish AS (SELECT SPECIES_CODE FROM SPECIES WHERE SPECIES_GROUP = \'Fish\'), seen AS (SELECT g.REEF_ID FROM SIGHTING g JOIN fish f ON g.SPECIES_CODE = f.SPECIES_CODE) SELECT DISTINCT r.REEF_NAME FROM REEF r JOIN seen ON r.REEF_ID = seen.REEF_ID ORDER BY r.REEF_NAME');
    assert(chained.filter((step) => step.stage === 'subquery').length === 2 && chained[1].label.startsWith('WITH seen - 8 rows'), `chained CTEs each show their rows (got "${chained[1].label}")`);
    assert(chained.at(-1)?.partialResult?.rows.length === 4, 'a CTE built on another CTE resolves');
    expectError('marine', 'WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 5) SELECT n FROM c', /Recursive CTEs are not traced/, 'recursive CTEs are refused with guidance');
    expectError('marine', 'WITH fish AS (SELECT SPECIES_CODE FROM SPECIES) SELECT NOPE FROM fish', /Unknown column "NOPE"\. fish \(subquery\) has: SPECIES_CODE/, 'columns selected from a CTE are checked instead of becoming string literals');
    expectError('marine', 'WITH fish AS (SELECT SPECIES_CODE AS code FROM SPECIES) SELECT f.SPECIES_CODE FROM fish f', /Unknown column "SPECIES_CODE" in f\. That subquery provides: code/, 'a CTE exposes its aliases, not the original column names');
    assert(run('marine', 'WITH fish AS (SELECT SPECIES_CODE AS code, COMMON_NAME FROM SPECIES) SELECT f.code, COMMON_NAME FROM fish f').at(-1)?.partialResult?.rows.length === 10, 'CTE aliases and pass-through columns resolve');
    expectError('marine', 'SELECT x.NOPE FROM (SELECT SPECIES_CODE, COUNT(*) AS n FROM SIGHTING GROUP BY SPECIES_CODE) x', /Unknown column "NOPE" in x\. That subquery provides: SPECIES_CODE, n/, 'derived-table columns are checked too');
    assert(run('marine', 'SELECT x.n FROM (SELECT SPECIES_CODE, COUNT(*) AS n FROM SIGHTING GROUP BY SPECIES_CODE) x WHERE x.n > 1').at(-1)?.partialResult?.rows.length === 4, 'derived-table aliases resolve');
    assert(run('marine', 'SELECT * FROM (SELECT * FROM REEF) r WHERE r.DEPTH_M > 20').at(-1)?.partialResult?.rows.length === 3, 'wildcards through a derived table expand to the source columns');
    expectError('marine', 'WITH fish AS (SELECT NOPE FROM SPECIES) SELECT SPECIES_CODE FROM fish', /Unknown column "NOPE"\. SPECIES has/, 'CTE bodies get the friendly column check');

    const ranked = run('marine', 'SELECT REEF_ID, COMMON_NAME, COUNT_SEEN, ROW_NUMBER() OVER (PARTITION BY REEF_ID ORDER BY COUNT_SEEN DESC) AS rank_in_reef, COUNT(*) OVER () AS total FROM SIGHTING JOIN SPECIES ON SIGHTING.SPECIES_CODE = SPECIES.SPECIES_CODE WHERE COUNT_SEEN > 2');
    const final = ranked.at(-1)!;
    assert(final.partialResult?.rows.length === 10 && final.partialResult.rows.every((row) => row[4] === 10), 'window functions are per-row values, not aggregates');
    assert(final.partialResult?.rows.filter((row) => row[3] === 1).length === 6, 'ROW_NUMBER restarts per partition');
    assert(!final.label.includes('PARTITION BY NULL') && final.label.includes('OVER ()'), `the parser-only partition is hidden from labels (got "${final.label}")`);
    assert(final.resultRowSources?.[0]?.SIGHTING.length === 1, 'window rows keep single-row provenance');
    expectError('marine', 'SELECT COMMON_NAME FROM SPECIES WHERE ROW_NUMBER() OVER (ORDER BY COMMON_NAME) <= 3', /Window functions cannot be used in WHERE/, 'window functions in WHERE are explained');
    expectError('marine', 'SELECT SUM(COUNT_SEEN) OVER (ORDER BY SIGHTING_ID ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM SIGHTING', /Window frames/, 'window frames are explained');

    const cased = rows('transit', "SELECT ROUTE_NAME, CASE WHEN FARE < 6 THEN 'budget' WHEN FARE < 12 THEN 'standard' ELSE 'premium' END AS tier, CASE NIGHT_SERVICE WHEN 1 THEN 'yes' ELSE 'no' END FROM FERRY_ROUTE ORDER BY CASE WHEN FARE < 6 THEN 0 ELSE 1 END, ROUTE_NAME");
    assert(cased[0][0] === 'Marsh Shuttle' && cased[0][1] === 'budget' && cased[0][2] === 'no', 'searched and simple CASE work in SELECT and ORDER BY');
    assert(rows('transit', "SELECT TERMINAL_ZONE, SUM(CASE WHEN NIGHT_SERVICE = 1 THEN 1 ELSE 0 END) AS night_routes FROM FERRY_ROUTE GROUP BY TERMINAL_ZONE ORDER BY 1").map((row) => row.join(':')).join(',') === 'Central:2,East:0,North:2,Offshore:0,South:0,West:1', 'CASE inside an aggregate works with ORDER BY position');

    const ordinal = run('festival', 'SELECT PASS_TYPE, COUNT(*) FROM ATTENDEE GROUP BY 1 ORDER BY 2 DESC, 1');
    assert(!!ordinal.find((step) => step.stage === 'groupBy')?.label.startsWith('GROUP BY "PASS_TYPE"'), `GROUP BY 1 is shown as the column it names (got "${ordinal.find((step) => step.stage === 'groupBy')?.label}")`);
    assert(ordinal.at(-1)?.partialResult?.rows.length === 4, 'GROUP BY / ORDER BY positions run');
    expectError('festival', 'SELECT PASS_TYPE FROM ATTENDEE GROUP BY 3', /GROUP BY 3 refers to a select-list position/, 'out-of-range positions are explained');
    expectError('festival', 'SELECT PASS_TYPE FROM ATTENDEE ORDER BY 0', /ORDER BY 0 refers to/, 'ORDER BY 0 is explained');
    console.log('  CTEs, window functions, CASE, ordinals: ok');
  }

  console.log('\n=== column diagnostics over user-shaped schemas');
  {
    const database = new SQL.Database();
    database.run('PRAGMA foreign_keys = ON');
    registerCompatFunctions(database);
    database.run(`
      CREATE TABLE customers (customer_id VARCHAR(50) PRIMARY KEY, company_name VARCHAR(100) NOT NULL, status VARCHAR(50), created_date DATE);
      CREATE TABLE equipment (equipment_id VARCHAR(50) PRIMARY KEY, customer_id VARCHAR(50), model VARCHAR(50), capacity_kw INT, status VARCHAR(50),
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL ON UPDATE CASCADE);
      CREATE TABLE import_equipment (equipment_id TEXT, customer_id TEXT, model TEXT, capacity_kw TEXT, status TEXT);
      INSERT INTO customers VALUES ('C1', 'Acme', 'Active', '2024-01-15'), ('C2', 'Bolt', 'Inactive', '2024-06-01');
      INSERT INTO equipment VALUES ('E1', 'C1', 'GenX', 100, 'Active'), ('E2', 'C1', 'GenY', 250, 'Retired'), ('E3', NULL, 'GenZ', 50, 'Active');
      INSERT INTO import_equipment VALUES ('E1', 'C1', 'GenX', '100', 'Active'), ('E9', 'C1', 'Gen9', '9', 'Active');
    `);
    const { schema } = introspectSchema(database);
    const trace = (sql: string) => traceSql(sql, database, schema);
    const expectError = (sql: string, pattern: RegExp, label: string) => {
      let message = '';
      try {
        trace(sql);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert(pattern.test(message), `${label} (got "${message}")`);
    };
    expectError('SELECT status FROM customers c JOIN equipment e ON c.customer_id = e.customer_id', /Column "status" exists in customers and equipment[\s\S]*Write c\.status or e\.status/, 'ambiguous columns name both tables and the qualifiers to use');
    expectError('SELECT customer_id FROM customers JOIN equipment ON customers.customer_id = equipment.customer_id', /Write customers\.customer_id or equipment\.customer_id/, 'unaliased ambiguous columns suggest table-qualified names');
    expectError('SELECT c.status FROM customers c JOIN equipment e ON c.customer_id = e.customer_id ORDER BY status', /Column "status" exists in customers and equipment/, 'an ambiguous ORDER BY name is explained the same way (SQLite rejects it too)');
    assert(trace('SELECT c.status FROM customers c JOIN equipment e ON c.customer_id = e.customer_id ORDER BY c.status').at(-1)?.partialResult?.rows.length === 2, 'a qualified ORDER BY name resolves');
    assert(trace('SELECT e.model FROM equipment e WHERE e.customer_id IN (SELECT customer_id FROM customers WHERE status = \'Active\')').at(-1)?.partialResult?.rows.length === 2, 'an inner query resolves its own tables before the outer ones');
    expectError('SELECT capacity_kw FROM customers', /Unknown column "capacity_kw"\. customers has: [\s\S]*equipment and import_equipment have a column with that name, but they are not in this query's FROM clause/, 'unknown columns point to the tables that do have them');
    expectError('SELECT model FROM equipmen', /Unknown table "equipmen"/, 'unknown tables are reported');
    assert(trace("SELECT model FROM import_equipment WHERE capacity_kw > 60").at(-1)?.partialResult?.rows.length === 1, 'TEXT columns compare as text (a staging-table trap SQLite shares with strict typing)');
    assert(trace('SELECT model FROM import_equipment WHERE CAST(capacity_kw AS UNSIGNED) > 60').at(-1)?.partialResult?.rows.length === 1, 'casting a TEXT column compares numerically');
    assert(trace('SELECT c.company_name, COUNT(e.equipment_id) AS units FROM customers c LEFT JOIN equipment e ON c.customer_id = e.customer_id GROUP BY c.company_name').at(-1)?.partialResult?.rows.map((row) => row.join(':')).join(',') === 'Acme:2,Bolt:0', 'LEFT JOIN with COUNT(column) counts zero for unmatched parents');
    assert(trace('SELECT * FROM customers c JOIN equipment e ON c.customer_id = e.customer_id').at(-1)?.partialResult?.columns.filter((column) => column === 'status').length === 2, 'SELECT * over a join keeps duplicate column names');
    assert(trace('SELECT company_name FROM customers WHERE YEAR(created_date) = 2024 AND created_date >= DATE_SUB(\'2024-12-31\', INTERVAL 8 MONTH)').at(-1)?.partialResult?.rows.length === 1, 'MySQL date functions work over user schemas');
    database.close();
    console.log('  column diagnostics: ok');
  }

  console.log('\n=== INSERT / UPDATE / DELETE in the query editor');
  {
    const database = new SQL.Database();
    database.run('PRAGMA foreign_keys = ON');
    registerCompatFunctions(database);
    database.run(`
      CREATE TABLE customers (customer_id VARCHAR(50) PRIMARY KEY, company_name VARCHAR(100) NOT NULL UNIQUE, status VARCHAR(50) DEFAULT 'Active');
      CREATE TABLE equipment (equipment_id VARCHAR(50) PRIMARY KEY, customer_id VARCHAR(50) REFERENCES customers(customer_id) ON DELETE CASCADE, model VARCHAR(50));
      CREATE TABLE archive (equipment_id VARCHAR(50), model VARCHAR(50));
      INSERT INTO customers VALUES ('C1', 'Acme', 'Active'), ('C2', 'Bolt', 'Inactive'), ('C3', 'Cog', 'Inactive');
      INSERT INTO equipment VALUES ('E1', 'C1', 'GenX'), ('E2', 'C1', 'GenY'), ('E3', 'C2', 'GenZ');
    `);
    const { schema } = introspectSchema(database);
    const count = (sql: string) => Number(database.exec(sql)[0]?.values[0]?.[0] ?? 0);
    const mutate = (sql: string, options: Parameters<typeof traceStatement>[4] = {}) => {
      const parsed = parseQuery(sql);
      if (!parsed.ok) throw new Error(`${parsed.error} :: ${sql}`);
      assert(parsed.kind === 'mutation', `${sql} is recognized as a data change`);
      return traceStatement(parsed, sql, database, schema, options);
    };
    const failure = (sql: string, options: Parameters<typeof traceStatement>[4] = {}) => {
      try {
        mutate(sql, options);
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };

    const insert = mutate("INSERT INTO customers (customer_id, company_name) VALUES ('C4', 'Dyno')");
    assert(insert.steps.map((step) => step.stage).join(',') === 'from,modify', `INSERT traces the table before and the applied change (got ${insert.steps.map((step) => step.stage).join(',')})`);
    assert(insert.steps[0].tableSnapshots?.customers.rows.length === 3 && insert.steps[0].partialResult?.rows.length === 3, 'the first stage snapshots the table before the change');
    assert(insert.steps[1].label === 'INSERT INTO customers - 1 row added' && insert.steps[1].litRows.customers?.has(4), 'the applied stage lights the new row');
    assert(insert.steps[1].partialResult?.rows[0]?.join(',') === 'C4,Dyno,Active', 'the result shows the inserted row with its DEFAULT applied');
    assert(insert.mutation?.changedTables.join(',') === 'customers' && insert.mutation.tableData.customers.rows.length === 4, 'the mutation reports refreshed table data');
    assert(count('SELECT COUNT(*) FROM customers') === 4, 'the row is really inserted');
    assert(insert.steps[0].queryRange?.end === 'INSERT INTO customers'.length, 'the first stage highlights the statement head');

    const update = mutate("UPDATE customers SET status = 'Closed' WHERE status = 'Inactive'");
    assert(update.steps.map((step) => step.stage).join(',') === 'from,where,modify', 'UPDATE traces candidates, the WHERE match and the change');
    assert(update.steps[1].litRows.customers?.size === 2 && update.steps[1].dimmedRows.customers?.size === 2, 'the WHERE stage lights matched rows and dims the rest');
    assert(update.steps[2].label === 'UPDATE customers - 2 rows changed' && update.steps[2].activeColumns[0]?.column === 'status', 'the applied stage names the changed count and SET column');
    assert(update.steps[2].tableSnapshots === undefined && update.steps[1].tableSnapshots?.customers.rows[1][2] === 'Inactive', 'earlier stages keep the before-state while the final stage shows live data');
    assert(count("SELECT COUNT(*) FROM customers WHERE status = 'Closed'") === 2, 'the update is applied');

    const noop = mutate("UPDATE customers SET status = 'Closed' WHERE customer_id = 'C2'");
    assert(noop.steps.at(-1)?.label === 'UPDATE customers - 0 rows changed' && /already held the new values/.test(noop.steps.at(-1)!.narration), 'an UPDATE that changes nothing says so');

    const cascade = mutate("DELETE FROM customers WHERE customer_id = 'C1'");
    assert(cascade.steps.at(-1)?.label === 'DELETE FROM customers - 1 row removed', 'DELETE reports the removed count');
    assert(/Foreign-key rules also changed equipment: 2 rows removed/.test(cascade.steps.at(-1)!.narration), `ON DELETE CASCADE effects are narrated (got "${cascade.steps.at(-1)!.narration}")`);
    assert(cascade.mutation?.changedTables.join(',') === 'customers,equipment', 'cascaded tables are reported as changed');
    assert(cascade.steps.at(-1)?.partialResult?.rows[0]?.[1] === 'Acme' && cascade.steps.at(-1)?.resultRowSources === undefined, 'the result lists the removed rows without live provenance');
    assert(count('SELECT COUNT(*) FROM equipment') === 1, 'dependent rows are cascaded away');

    const whole = mutate('UPDATE archive SET model = UPPER(model)');
    assert(whole.steps[1].label.startsWith('(no WHERE)') && /every row of archive is affected/.test(whole.steps[1].narration), 'a missing WHERE is called out');

    const copy = mutate("INSERT INTO archive (equipment_id, model) SELECT equipment_id, model FROM equipment WHERE model LIKE 'Gen%'");
    assert(copy.steps.map((step) => step.stage).join(',') === 'from,subquery,modify' && copy.steps[1].partialResult?.rows.length === 1, 'INSERT ... SELECT shows the source rows first');
    assert(copy.steps.at(-1)?.label === 'INSERT INTO archive - 1 row added', 'INSERT ... SELECT reports the added count');

    const mysql = mutate("INSERT IGNORE INTO customers (customer_id, company_name) VALUES ('C4', 'Duplicate')");
    assert(mysql.steps.at(-1)?.label === 'INSERT INTO customers - 0 rows added', 'INSERT IGNORE skips the duplicate');
    const upsert = mutate("INSERT INTO customers (customer_id, company_name) VALUES ('C4', 'Dyno') ON DUPLICATE KEY UPDATE status = VALUES(company_name)");
    assert(upsert.steps.at(-1)?.label === 'INSERT INTO customers - 0 rows added, 1 row replaced' && count("SELECT COUNT(*) FROM customers WHERE status = 'Dyno'") === 1, `ON DUPLICATE KEY UPDATE becomes an upsert (got "${upsert.steps.at(-1)?.label}")`);
    const replace = mutate("REPLACE INTO customers (customer_id, company_name) VALUES ('C2', 'Bolt Ltd')");
    assert(database.exec("SELECT company_name FROM customers WHERE customer_id = 'C2'")[0].values[0][0] === 'Bolt Ltd' && count('SELECT COUNT(*) FROM customers') === 3, 'REPLACE INTO replaces the row without adding one');
    assert(replace.steps.at(-1)!.label.startsWith('INSERT INTO customers - '), 'REPLACE is reported as an insert with its counts');
    const parsedReplace = parseQuery("REPLACE INTO customers (customer_id, company_name) VALUES ('C2', 'Bolt Ltd')");
    assert(parsedReplace.ok && parsedReplace.notes.some((note) => note.from === 'REPLACE INTO'), 'MySQL INSERT forms are noted');
    const truncate = mutate('TRUNCATE TABLE archive');
    assert(truncate.steps.at(-1)?.label === 'DELETE FROM archive - 1 row removed' && count('SELECT COUNT(*) FROM archive') === 0, `TRUNCATE becomes DELETE FROM (got "${truncate.steps.at(-1)?.label}")`);

    // Rejected statements roll back completely and explain themselves.
    assert(/The INSERT was rejected: customers.customer_id already holds that value/.test(failure("INSERT INTO customers VALUES ('C2', 'Other', 'x')")), `duplicate keys are explained (got "${failure("INSERT INTO customers VALUES ('C2', 'Other', 'x')")}")`);
    assert(/foreign-key value does not match any row in the parent table/.test(failure("INSERT INTO equipment VALUES ('E9', 'C999', 'Ghost')")), 'orphan inserts are explained');
    assert(/company_name is declared NOT NULL/.test(failure("INSERT INTO customers (customer_id) VALUES ('C5')")), 'NOT NULL violations are explained');
    assert(/table customers has 3 columns but 2 values were supplied/.test(failure("INSERT INTO customers VALUES ('C5', 'Five')")), 'value-count mismatches are explained');
    assert(/Unknown column "nope" in customers/.test(failure("INSERT INTO customers (customer_id, nope) VALUES ('C5', 1)")), 'unknown INSERT columns are explained');
    assert(/Unknown column "nope"\. customers has/.test(failure("UPDATE customers SET nope = 1 WHERE customer_id = 'C2'")), 'unknown SET columns are explained');
    assert(/Unknown column "nope"/.test(failure("DELETE FROM customers WHERE nope = 1")), 'unknown WHERE columns in DELETE are explained');
    assert(/Unknown table "nowhere"/.test(failure('DELETE FROM nowhere')), 'unknown tables in DML are explained');
    const before = count('SELECT COUNT(*) FROM customers');
    const limited = failure("INSERT INTO customers (customer_id, company_name) VALUES ('C7', 'Seven')", { enforce: () => { throw new Error('Table "customers" exceeds the 500-row limit.'); } });
    assert(/exceeds the 500-row limit\. No rows were changed/.test(limited) && count('SELECT COUNT(*) FROM customers') === before, 'custom-schema limits roll the statement back');
    const multi = parseQuery("INSERT INTO customers VALUES ('C8', 'Eight', 'x'); DELETE FROM customers");
    assert(!multi.ok && /one statement at a time/.test(multi.error), 'multiple statements are still rejected');
    const persistent = mutate("UPDATE customers SET status = 'Open' WHERE customer_id = 'C3'", { persistent: true });
    assert(/saved with your custom schema/.test(persistent.steps.at(-1)!.narration) && /choose the schema again/.test(noop.steps.at(-1)!.narration), 'the narration says whether the change is kept');
    database.close();
    console.log('  INSERT / UPDATE / DELETE tracing: ok');
  }

  console.log('\n=== connection settings survive a database export');
  {
    const { buildCustomDatabase, exportDatabase, prepareCustomDdl } = await import('../lib/db');
    const database = buildCustomDatabase(
      SQL,
      prepareCustomDdl(`
        CREATE TABLE parent_t (id INT PRIMARY KEY);
        CREATE TABLE child_t (id INT PRIMARY KEY, parent_id INT REFERENCES parent_t(id) ON DELETE CASCADE);
        INSERT INTO parent_t VALUES (1); INSERT INTO child_t VALUES (10, 1);
      `)
    );
    const bytes = exportDatabase(database);
    assert(bytes.byteLength > 0, 'export produces bytes');
    assert(Number(database.exec('PRAGMA foreign_keys')[0].values[0][0]) === 1, 'foreign keys stay enforced after export (sql.js reopens the connection)');
    assert(Number(database.exec('PRAGMA max_page_count')[0].values[0][0]) === 16384, 'the memory bound stays applied after export');
    assert(database.exec("SELECT YEAR('2026-01-05')")[0].values[0][0] === 2026, 'dialect functions are re-registered after export');
    database.run('DELETE FROM parent_t WHERE id = 1');
    assert(Number(database.exec('SELECT COUNT(*) FROM child_t')[0].values[0][0]) === 0, 'ON DELETE CASCADE still fires on the exported connection');
    database.close();
    console.log('  export keeps connection settings: ok');
  }

  console.log('\n=== lesson "try it" suggestions');
  {
    const tryIts: Array<[string, string, number]> = [
      ['transit', 'SELECT * FROM FERRY_ROUTE;', 10],
      ['marine', "SELECT REEF_NAME, DEPTH_M FROM REEF WHERE SECTOR = 'East';", 2],
      ['transit', "SELECT ROUTE_CODE, ROUTE_NAME, FARE FROM FERRY_ROUTE WHERE FARE < 9 OR NIGHT_SERVICE = 1 AND NOT TERMINAL_ZONE = 'West';", 6],
      ['transit', 'SELECT ROUTE_NAME, SCHEDULED_TRIPS * CROSSING_MIN AS \'Trip Minutes\' FROM FERRY_ROUTE ORDER BY SCHEDULED_TRIPS * CROSSING_MIN;', 10],
      ['festival', "SELECT FILM_TITLE, GENRE FROM SCREENING WHERE GENRE IN ('Comedy', 'Animation');", 2],
      ['festival', 'SELECT VENUE_NAME, CAPACITY FROM VENUE WHERE CAPACITY BETWEEN 90 AND 150;', 3],
      ['festival', 'SELECT PASS_TYPE FROM ATTENDEE ORDER BY PASS_TYPE;', 12],
      ['festival', 'SELECT DISTINCT CITY FROM ATTENDEE;', 6],
      ['observatory', "SELECT CONCAT(GIVEN_NAME, ' ', FAMILY_NAME, ' (', HOME_CITY, ')') AS 'Observer' FROM ASTRONOMER;", 6],
      ['marine', 'SELECT MIN(DEPTH_M), MAX(DEPTH_M) FROM REEF;', 1],
      ['marine', 'SELECT SPECIES_CODE, COMMON_NAME FROM SPECIES WHERE TAG_COLOR IS NOT NULL;', 8],
      ['festival', 'SELECT PASS_TYPE, COUNT(*) FROM ATTENDEE GROUP BY PASS_TYPE;', 4],
      ['orchard', 'SELECT ZONE, AVG(TREE_COUNT) FROM ORCHARD_PLOT GROUP BY ZONE HAVING COUNT(*) >= 3;', 3],
      ['festival', 'SELECT S.FILM_TITLE, R.SEATS FROM SCREENING S JOIN RESERVATION R ON S.SCREENING_ID = R.SCREENING_ID;', 23],
      ['observatory', 'SELECT T.TELESCOPE_NAME, O.OBSERVED_ON FROM TELESCOPE T, OBSERVATION O;', 40],
      ['festival', 'SELECT A.GIVEN_NAME, A.FAMILY_NAME, R.SCREENING_ID FROM ATTENDEE A JOIN RESERVATION R ON A.ATTENDEE_ID = R.ATTENDEE_ID;', 23],
      ['festival', "SELECT S.GENRE, SUM(R.SEATS) AS 'Saturday Seats' FROM VENUE V JOIN SCREENING S ON V.VENUE_ID = S.VENUE_ID JOIN RESERVATION R ON S.SCREENING_ID = R.SCREENING_ID WHERE S.SCREENING_DAY = 'Saturday' GROUP BY S.GENRE ORDER BY SUM(R.SEATS) DESC;", 3],
      ['marine', "SELECT S.COMMON_NAME, G.COUNT_SEEN, R.REEF_NAME, D.DIVER_NAME FROM SPECIES S JOIN SIGHTING G ON S.SPECIES_CODE = G.SPECIES_CODE JOIN REEF R ON G.REEF_ID = R.REEF_ID JOIN DIVER D ON G.DIVER_ID = D.DIVER_ID WHERE S.SPECIES_GROUP = 'Fish' AND R.SECTOR = 'North';", 5],
      ['orchard', "SELECT P.PLOT_NAME, B.PLOT_NAME AS 'Parent Block' FROM ORCHARD_PLOT P JOIN ORCHARD_PLOT B ON P.PARENT_PLOT_ID = B.PLOT_ID WHERE P.ZONE = 'South';", 3],
      ['festival', "SELECT CITY AS 'Festival City' FROM ATTENDEE UNION ALL SELECT CITY FROM VENUE;", 17],
      ['transit', 'SELECT ROUTE_CODE, ROUTE_NAME, FARE FROM FERRY_ROUTE WHERE FARE < (SELECT MAX(FARE) FROM FERRY_ROUTE) ORDER BY FARE;', 9],
    ];
    for (const [schemaId, sql, expected] of tryIts) {
      const final = run(schemaId, sql).at(-1)!;
      assert(final.partialResult?.rows.length === expected, `try-it query returns ${expected} rows: ${sql.slice(0, 70)} (got ${final.partialResult?.rows.length})`);
    }
    const disappears = run('festival', 'SELECT A.GIVEN_NAME, A.FAMILY_NAME, R.SCREENING_ID FROM ATTENDEE A LEFT OUTER JOIN RESERVATION R ON A.ATTENDEE_ID = R.ATTENDEE_ID').at(-1)!.partialResult!.rows;
    assert(disappears.length === 24 && disappears.some((row) => row[1] === 'Lopes' && row[2] === null), 'lesson 14: Lopes is the attendee who disappears with an inner join');
    assert(!!LESSONS.find((lesson) => lesson.id === 'join-group')?.tryIt.includes('S.GENRE in place of V.VENUE_NAME'), 'lesson 15 try-it tells the learner to change the SELECT list as well');
    console.log('  lesson try-it suggestions: ok');
  }

  console.log('\n=== rejection checks');
  const rejected = [
    'SELECT FAMILY_NAME, COUNT(*) FROM ATTENDEE',
    'SELECT PASS_TYPE, COUNT(*) FROM ATTENDEE GROUP BY CITY',
    'SELECT * FROM SIGHTING WHERE SUM(COUNT_SEEN) > 10',
    "SELECT FARE * SCHEDULED_TRIPS AS 'Potential' FROM FERRY_ROUTE ORDER BY 'Potential'",
    "SELECT PASS_TYPE, COUNT(*) FROM ATTENDEE GROUP BY PASS_TYPE HAVING CITY = 'Juniper Bay'",
    'SELECT ATTENDEE.FAMILY_NAME FROM ATTENDEE A',
    'SELECT COUNT(*) FROM ATTENDEE HAVING COUNT(*) > 1',
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
