/* Dialect regression suite: schema scripts the way MySQL / MariaDB, PostgreSQL,
   SQL Server and Oracle tools export them, plus queries and data changes in
   each dialect, checked against hand-computed results.
   Run with: npm run test:dialects */
import { runSchema, summary } from './dialectHarness';

export type { Case } from './dialectHarness';

async function main() {
  const modules = await Promise.all([
    import('./dialectCases/exports'),
    import('./dialectCases/tools'),
    import('./dialectCases/queries'),
    import('./dialectCases/pasted'),
    import('./dialectCases/final'),
    import('./dialectCases/edgeRuntime'),
    import('./dialectCases/edgeMysql'),
    import('./dialectCases/edgePostgres'),
    import('./dialectCases/edgeAggregates'),
    import('./dialectCases/releasePostgres'),
    import('./dialectCases/releaseMysql'),
  ]);
  for (const module of modules) for (const p of module.PROBES) await runSchema(p.def, p.label, p.cases);
  const { pass, fail, failures } = summary();
  console.log(`\n=== ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log(`  ${f}`);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
