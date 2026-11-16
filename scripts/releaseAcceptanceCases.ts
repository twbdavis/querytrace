import { SOURCE_DIALECTS, dialectProfile, type SourceDialect } from '../lib/queryCompatibility';
import type { Case } from './dialectHarness';
import { MYSQL_CASES, MARIADB_CASES } from './dialectCases/releaseAcceptanceMysql';
import { POSTGRES_CASES } from './dialectCases/releaseAcceptancePostgres';
import { SQLSERVER_CASES, ORACLE_CASES } from './dialectCases/releaseAcceptanceVendors';
import { SQLITE_CASES, LEGACY_CASES } from './dialectCases/releaseAcceptanceSqlite';

export const RELEASE_CASES: Record<SourceDialect, Case[]> = {
  legacy: LEGACY_CASES, sqlite: SQLITE_CASES, mysql: MYSQL_CASES, mariadb: MARIADB_CASES,
  postgresql: POSTGRES_CASES, sqlserver: SQLSERVER_CASES, oracle: ORACLE_CASES,
};

// Both the runtime and browser suites enforce the quota. Deliberate refusals,
// duplicate statements and success-without-result assertions cannot fill it.
export function validateReleaseCases(): void {
  for (const dialect of SOURCE_DIALECTS) {
    const cases = RELEASE_CASES[dialect];
    const label = dialectProfile(dialect).label;
    if (cases.length !== 15) throw new Error(`${label}: expected exactly 15 acceptance queries`);
    const unique = new Set(cases.map(({ sql }) => sql.trim().replace(/\s+/g, ' ').toLowerCase()));
    if (unique.size !== 15) throw new Error(`${label}: acceptance queries must be distinct`);
    for (const query of cases) {
      if (query.dialect !== dialect || query.reject || !query.rows || !query.note) {
        throw new Error(`${label}: each query needs its own profile, exact rows and feature description`);
      }
      if (!/^\s*(?:SELECT|WITH)\b/i.test(query.sql)) throw new Error(`${label}: acceptance must be read-only`);
    }
  }
}

export const SYNTAX_REJECTIONS: Case[] = SOURCE_DIALECTS.flatMap((dialect) => [
  { dialect, sql: 'SELECT FROM SCREENING', reject: true, note: 'Missing projection' },
  { dialect, sql: 'SELECT FILM_TITLE FROM SCREENING WHERE )', reject: true, note: 'Unbalanced predicate' },
]);
