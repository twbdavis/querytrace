/* Dialect tour: every source-dialect profile gets its own set of idiomatic
   queries, read under that profile through the real SqlRuntime and compared
   with hand-computed rows (and, where given, a plain SQLite reference).
   Run with: npm run test:tour */
import { schemaById } from '../lib/schemas';
import { runSchema, summary } from './dialectHarness';
import * as tour from './dialectCases/tour';

const festival = schemaById('festival')!;
const observatory = schemaById('observatory')!;
const marine = schemaById('marine')!;

async function main() {
  await runSchema(festival, 'MySQL / festival', tour.mysqlFestival);
  await runSchema(observatory, 'MySQL / observatory', tour.mysqlObservatory);
  await runSchema(festival, 'MariaDB / festival', tour.mariadbFestival);
  await runSchema(observatory, 'MariaDB / observatory', tour.mariadbObservatory);
  await runSchema(festival, 'PostgreSQL / festival', tour.postgresqlFestival);
  await runSchema(observatory, 'PostgreSQL / observatory', tour.postgresqlObservatory);
  await runSchema(marine, 'PostgreSQL / marine', tour.postgresqlMarine);
  await runSchema(festival, 'SQL Server / festival', tour.sqlserverFestival);
  await runSchema(observatory, 'SQL Server / observatory', tour.sqlserverObservatory);
  await runSchema(festival, 'Oracle / festival', tour.oracleFestival);
  await runSchema(observatory, 'Oracle / observatory', tour.oracleObservatory);
  await runSchema(marine, 'Oracle / marine', tour.oracleMarine);
  await runSchema(festival, 'SQLite / festival', tour.sqliteFestival);
  await runSchema(observatory, 'SQLite / observatory', tour.sqliteObservatory);

  const { pass, fail, failures } = summary();
  console.log(`\n=== ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('\nFAILURES:');
    for (const failure of failures) console.log(`  ${failure}`);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
