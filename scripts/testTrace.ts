/* End-to-end parser and trace-engine tests against every bundled schema and
   lesson. Run with: npm run test:trace */
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
      const final = buildTrace(parsed.ast, database, schema).at(-1);
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

  console.log('\n=== rejection checks');
  const rejected = [
    'DELETE FROM ATTENDEE',
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
