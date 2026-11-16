/**
 * Source-dialect profiles and the coverage contract every query result carries.
 *
 * A profile describes how the learner's text is read before it is translated
 * to SQLite. Execution always uses SQLite; the profile decides the lexical
 * rules whose meaning differs between vendors (backslash escapes, `#`
 * comments, `[bracket]` names, `+` on strings). The `legacy` profile keeps the
 * mixed heuristics that existing saved sessions were written against.
 */

export type SourceDialect = 'legacy' | 'sqlite' | 'mysql' | 'mariadb' | 'postgresql' | 'sqlserver' | 'oracle';

export const SOURCE_DIALECTS: readonly SourceDialect[] = ['legacy', 'sqlite', 'mysql', 'mariadb', 'postgresql', 'sqlserver', 'oracle'];

/** Bumped whenever a translation or coverage rule changes, so fixtures name the rules they were computed under. */
export const COMPATIBILITY_REVISION = 1;

export interface DialectProfile {
  id: SourceDialect;
  /** Label shown in the editor control. */
  label: string;
  /** `\'` inside a string literal: an escape (MySQL) or a backslash followed by the end of the literal. */
  backslashEscapes: 'auto' | 'always' | 'never';
  /** `# text` starts a comment (MySQL). */
  hashComments: boolean;
  /** `[name]` is a quoted identifier (SQL Server). */
  bracketIdentifiers: boolean;
  /** `'a' + 'b'` joins strings (SQL Server) instead of adding numbers. */
  plusConcatenation: 'auto' | 'always' | 'never';
  /** CodeMirror language dialect used for highlighting and completion. */
  editor: 'sqlite' | 'mysql' | 'mariadb' | 'postgresql' | 'mssql' | 'plsql';
  /** `FROM (SELECT ...)` without an alias is legal (Oracle, SQLite); the trace names it DERIVED. */
  unaliasedDerivedTables: boolean;
  /** `"text"` is a string literal, not a name (MySQL / MariaDB in their default mode). */
  doubleQuotedStrings: boolean;
  /** A backslash in a LIKE pattern escapes the next character without an ESCAPE clause (MySQL, MariaDB, PostgreSQL). */
  likeBackslashEscape: boolean;
  /** LIKE compares letter case (PostgreSQL, Oracle); the runtime switches SQLite's LIKE to match. */
  caseSensitiveLike: boolean;
  /** `a || b` is logical OR, not text joining (MySQL / MariaDB in their default mode). */
  pipesAreOr: boolean;
  /** GREATEST / LEAST ignore NULL arguments (PostgreSQL, SQL Server) instead of returning NULL. */
  greatestSkipsNull: boolean;
  /** GROUP_CONCAT(a, b) joins both values of each row (MySQL / MariaDB); in SQLite b is the separator. */
  groupConcatJoinsValues: boolean;
  /** Letter case covers every alphabet (all five vendors): LIKE, LOWER and UPPER fold beyond A to Z. SQLite itself folds ASCII only. */
  unicodeText: boolean;
}

const PROFILES: Record<SourceDialect, DialectProfile> = {
  legacy: { id: 'legacy', label: 'Any SQL', backslashEscapes: 'auto', hashComments: true, bracketIdentifiers: true, plusConcatenation: 'auto', editor: 'sqlite', unaliasedDerivedTables: true, doubleQuotedStrings: false, likeBackslashEscape: false, caseSensitiveLike: false, pipesAreOr: false, greatestSkipsNull: false, groupConcatJoinsValues: false, unicodeText: false },
  sqlite: { id: 'sqlite', label: 'SQLite', backslashEscapes: 'never', hashComments: false, bracketIdentifiers: true, plusConcatenation: 'never', editor: 'sqlite', unaliasedDerivedTables: true, doubleQuotedStrings: false, likeBackslashEscape: false, caseSensitiveLike: false, pipesAreOr: false, greatestSkipsNull: false, groupConcatJoinsValues: false, unicodeText: false },
  mysql: { id: 'mysql', label: 'MySQL', backslashEscapes: 'always', hashComments: true, bracketIdentifiers: false, plusConcatenation: 'never', editor: 'mysql', unaliasedDerivedTables: false, doubleQuotedStrings: true, likeBackslashEscape: true, caseSensitiveLike: false, pipesAreOr: true, greatestSkipsNull: false, groupConcatJoinsValues: true, unicodeText: true },
  mariadb: { id: 'mariadb', label: 'MariaDB', backslashEscapes: 'always', hashComments: true, bracketIdentifiers: false, plusConcatenation: 'never', editor: 'mariadb', unaliasedDerivedTables: false, doubleQuotedStrings: true, likeBackslashEscape: true, caseSensitiveLike: false, pipesAreOr: true, greatestSkipsNull: false, groupConcatJoinsValues: true, unicodeText: true },
  postgresql: { id: 'postgresql', label: 'PostgreSQL', backslashEscapes: 'never', hashComments: false, bracketIdentifiers: false, plusConcatenation: 'never', editor: 'postgresql', unaliasedDerivedTables: false, doubleQuotedStrings: false, likeBackslashEscape: true, caseSensitiveLike: true, pipesAreOr: false, greatestSkipsNull: true, groupConcatJoinsValues: false, unicodeText: true },
  sqlserver: { id: 'sqlserver', label: 'SQL Server', backslashEscapes: 'never', hashComments: false, bracketIdentifiers: true, plusConcatenation: 'always', editor: 'mssql', unaliasedDerivedTables: false, doubleQuotedStrings: false, likeBackslashEscape: false, caseSensitiveLike: false, pipesAreOr: false, greatestSkipsNull: true, groupConcatJoinsValues: false, unicodeText: true },
  oracle: { id: 'oracle', label: 'Oracle', backslashEscapes: 'never', hashComments: false, bracketIdentifiers: false, plusConcatenation: 'never', editor: 'plsql', unaliasedDerivedTables: true, doubleQuotedStrings: false, likeBackslashEscape: false, caseSensitiveLike: true, pipesAreOr: false, greatestSkipsNull: false, groupConcatJoinsValues: false, unicodeText: true },
};

export function dialectProfile(dialect: SourceDialect | undefined): DialectProfile {
  return PROFILES[dialect ?? 'legacy'] ?? PROFILES.legacy;
}

/** A saved or transmitted value becomes a known dialect, or the safe default. */
export function normalizeDialect(value: unknown): SourceDialect {
  return typeof value === 'string' && (SOURCE_DIALECTS as readonly string[]).includes(value) ? (value as SourceDialect) : 'legacy';
}

/** Syntax the compatibility layer recognised in a query, for coverage and tests. */
export type CompatFeature =
  | 'filter'
  | 'named-window'
  | 'window-frame'
  | 'window'
  | 'top-with-ties'
  | 'cte'
  | 'derived-table'
  | 'compound'
  | 'subquery';

/**
 * How much of a query the trace explains.
 * - `detailed`: every stage is shown and each result row maps back to its source rows.
 * - `components`: component results (CTEs, derived tables, branches) precede the final result; no row lineage.
 * - `result-only`: the result alone.
 */
export type ExplanationLevel = 'detailed' | 'components' | 'result-only';

export interface QueryCoverage {
  revision: number;
  dialect: SourceDialect;
  explanation: ExplanationLevel;
  /**
   * What a highlighted source row means.
   * - `rows`: the rows an output row was produced from (groups: every member row).
   * - `none`: no source association is available.
   */
  lineage: 'rows' | 'none';
  features: CompatFeature[];
  /** Plain-language limits of the explanation for this query. */
  limits: string[];
}

export const EXPLANATION_LABELS: Record<ExplanationLevel, string> = {
  detailed: 'Full trace',
  components: 'Component previews',
  'result-only': 'Result only',
};

/** The limits the explanation model has for each recognised feature. */
const FEATURE_LIMITS: Partial<Record<CompatFeature, string>> = {
  window: 'A window value is computed from other rows of its partition; highlighting shows the row each result row came from, not every row the window read.',
  'window-frame': 'Frame membership is not drawn; the frame bounds are applied by SQLite exactly as written.',
  filter: 'Highlighted group members include rows that a FILTER excluded from its aggregate.',
  'top-with-ties': 'TOP ... WITH TIES is computed with RANK() over the full ORDER BY; rows with the same rank as row n are kept.',
};

export function buildCoverage(
  dialect: SourceDialect,
  explanation: ExplanationLevel,
  features: Iterable<CompatFeature>,
  lineage: 'rows' | 'none'
): QueryCoverage {
  const list = Array.from(new Set(features));
  const limits = list.map((feature) => FEATURE_LIMITS[feature]).filter((limit): limit is string => !!limit);
  if (explanation === 'components') limits.unshift('Component results are shown before the final result; individual result rows are not traced to source rows.');
  if (explanation === 'result-only') limits.unshift('Only the result is shown for this statement.');
  return { revision: COMPATIBILITY_REVISION, dialect, explanation, lineage, features: list, limits };
}
