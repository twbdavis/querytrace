import { SOURCE_DIALECTS, dialectProfile } from '../lib/queryCompatibility';
import { schemaById } from '../lib/schemas';
import { runSchema, summary } from './dialectHarness';
import { RELEASE_CASES, SYNTAX_REJECTIONS, validateReleaseCases } from './releaseAcceptanceCases';
import { MYSQL_REJECTIONS } from './dialectCases/releaseAcceptanceMysql';
import { POSTGRES_DATE_REGRESSIONS } from './dialectCases/releaseAcceptancePostgres';
import { VENDOR_REGRESSION_CASES } from './dialectCases/releaseAcceptanceVendors';

async function main() {
  validateReleaseCases();
  const schema = schemaById('festival')!;
  const scoreboard: string[] = [];
  for (const dialect of SOURCE_DIALECTS) {
    const before = summary();
    const label = dialectProfile(dialect).label;
    await runSchema(schema, `release / ${label}`, RELEASE_CASES[dialect]);
    const after = summary();
    scoreboard.push(`${label}: ${after.pass - before.pass}/15 unique queries passed; ${after.fail - before.fail} failed`);
  }
  console.log('\n' + scoreboard.join('\n'));
  console.log('\nAdditional syntax refusals and bug regressions (excluded from the 15-query quota):');
  await runSchema(schema, 'release / malformed SQL', SYNTAX_REJECTIONS);
  await runSchema(schema, 'release / unsupported MySQL aggregates', MYSQL_REJECTIONS);
  await runSchema(schema, 'release / PostgreSQL date expressions', POSTGRES_DATE_REGRESSIONS);
  await runSchema(schema, 'release / vendor boundaries', VENDOR_REGRESSION_CASES);
  const { pass, fail, failures } = summary();
  for (const failure of failures) console.error(failure);
  console.log(`\nRelease acceptance: ${pass} passed, ${fail} failed (105 required successful queries).`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
