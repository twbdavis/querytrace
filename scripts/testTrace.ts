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
    console.log('  alias-aware provenance: ok');
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
    const trace = (sql: string) => {
      const parsed = parseQuery(sql);
      if (!parsed.ok) throw new Error(parsed.error);
      return buildTrace(parsed.ast, database, schema);
    };
    const reserved = trace('SELECT o."Group", l.qty FROM "Order" o JOIN line_item l ON o."Order Id" = l.order_id');
    assert(reserved.at(-1)?.partialResult?.rows.length === 2, 'reserved-word table and column names are quoted in generated SQL');
    const star = trace('SELECT * FROM "Order"');
    assert(JSON.stringify(star.at(-1)?.partialResult?.columns) === JSON.stringify(['Order Id', 'Group']), 'SELECT * keeps spaced column names');
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
