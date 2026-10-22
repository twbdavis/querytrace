import type { SchemaDef } from '../lib/schemas';

export type SequenceSources = Record<string, number[]>;

export interface QuerySequenceCase {
  name: string;
  dialect: 'MariaDB' | 'MySQL' | 'PostgreSQL';
  sql: string;
  columns: string[];
  /** Hand-computed results, including deterministic ordering. */
  rows: unknown[][];
  /** Exact final provenance when the engine can trace this query's pipeline. */
  sources?: SequenceSources[];
  /** Advanced SELECTs and deleted rows deliberately have no live row provenance. */
  provenanceUnavailable?: true;
  changedTables?: string[];
  /** DDL must refresh the physical table schema and its foreign-key metadata. */
  schemaTables?: string[];
  requiredStages?: string[];
}

const purchaseColumns = ['id', 'account_code', 'amount', 'note', 'posted_on'];
const account = (rid: number): SequenceSources => ({ account: [rid] });
const purchase = (...rids: number[]): SequenceSources => ({ purchase: rids });
const joined = (rid: number, ...purchases: number[]): SequenceSources => ({ account: [rid], purchase: purchases });

export const QUERY_SEQUENCE_SCHEMA: SchemaDef = {
  id: 'custom',
  name: 'Consecutive query regression',
  description: 'Small deterministic accounts and purchases fixture for query-session acceptance testing.',
  starterQuery: 'SELECT code, name FROM account ORDER BY code;',
  // Text keys are intentionally inserted out of alphabetical order. Account
  // rowids are B=1, A=2, C=3, D=4; purchase rowids equal their INTEGER keys.
  ddl: `
CREATE TABLE account (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE purchase (
  id INTEGER PRIMARY KEY,
  account_code TEXT NOT NULL REFERENCES account(code),
  amount DECIMAL(8,2),
  note TEXT,
  posted_on DATE NOT NULL
);
INSERT INTO account VALUES
  ('B', 'Ben O''Hara', 'south', 1),
  ('A', 'Alice', 'north', 1),
  ('C', 'Cy', NULL, 0),
  ('D', 'Dana', 'north', 1);
INSERT INTO purchase VALUES
  (10, 'B', 12.5, 'A;B', '2025-01-10'),
  (11, 'B', 7.5, '50%_off', '2025-01-11'),
  (12, 'A', 20, 'O''Hara', '2025-02-12'),
  (13, 'C', NULL, NULL, '2025-02-13'),
  (14, 'A', 5, 'same', '2025-02-14');
`,
};

/** All rejected statements run before the uninterrupted twenty-five-query sequence. */
export const QUERY_SEQUENCE_REJECTIONS = [
  { name: 'invalid syntax', sql: 'SELECT FROM account;', message: /syntax|parse|expected/i },
  { name: 'unknown column', sql: 'SELECT nonexistent_column FROM account;', message: /column|nonexistent/i },
  {
    name: 'multi-row mutation rolls back its first insertion',
    sql: "INSERT INTO purchase VALUES (15, 'A', 3.5, 'must roll back', '2025-03-04'), (10, 'A', 1, 'duplicate', '2025-03-04');",
    message: /unique|already|duplicate/i,
  },
  {
    name: 'foreign key failure does not poison the session',
    sql: "INSERT INTO purchase VALUES (99, 'missing', 1, 'orphan', '2025-03-04');",
    message: /foreign key|refer|exist/i,
  },
  { name: 'multiple statements are rejected together', sql: 'SELECT code FROM account; DELETE FROM account;', message: /one statement/i },
  {
    name: 'unsupported explicit window frame recovers cleanly',
    sql: 'SELECT SUM(amount) OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM purchase;',
    message: /window frames.*not supported/i,
  },
  {
    name: 'failed CREATE does not replace an existing table',
    sql: 'CREATE TABLE account (replacement INTEGER PRIMARY KEY);',
    message: /already exists|already a table|duplicate/i,
  },
  {
    name: 'invalid CREATE does not leave a partial schema object',
    sql: 'CREATE TABLE broken_audit (id INTEGER, id TEXT);',
    message: /duplicate column|duplicate.*id/i,
  },
];

/** One session, one schema load, exactly twenty-five consecutive successful queries. */
export const QUERY_SEQUENCE_CASES: QuerySequenceCase[] = [
  {
    name: 'quoted identifiers and text-key provenance after sorting', dialect: 'MySQL',
    sql: 'SELECT `code`, `name` FROM `account` ORDER BY `code`;',
    columns: ['code', 'name'], rows: [['A', 'Alice'], ['B', "Ben O'Hara"], ['C', 'Cy'], ['D', 'Dana']],
    sources: [account(2), account(1), account(3), account(4)], requiredStages: ['from', 'select', 'orderLimit'],
  },
  {
    name: 'NULL predicates and IFNULL', dialect: 'MariaDB',
    sql: "SELECT code, IFNULL(region, 'unknown') AS region_label, LEFT('😀north', 1) AS symbol FROM account WHERE region IS NULL OR region = 'north' ORDER BY code;",
    columns: ['code', 'region_label', 'symbol'], rows: [['A', 'north', '😀'], ['C', 'unknown', '😀'], ['D', 'north', '😀']],
    sources: [account(2), account(3), account(4)], requiredStages: ['where'],
  },
  {
    name: 'case-insensitive matching and PostgreSQL concatenation', dialect: 'PostgreSQL',
    sql: "SELECT code, name || '!' AS label FROM account WHERE name ILIKE 'a%' OR name ILIKE '%hara' ORDER BY code;",
    columns: ['code', 'label'], rows: [['A', 'Alice!'], ['B', "Ben O'Hara!"]], sources: [account(2), account(1)],
  },
  {
    name: 'JOIN then WHERE then descending sort', dialect: 'MySQL',
    sql: 'SELECT a.code, p.id, p.amount FROM account a JOIN purchase p ON p.account_code = a.code WHERE p.amount >= 10 ORDER BY p.amount DESC, p.id;',
    columns: ['code', 'id', 'amount'], rows: [['A', 12, 20], ['B', 10, 12.5]],
    sources: [joined(2, 12), joined(1, 10)], requiredStages: ['join', 'where', 'orderLimit'],
  },
  {
    name: 'LEFT JOIN keeps unmatched rows without inventing sources', dialect: 'MariaDB',
    sql: 'SELECT a.code, p.id, p.amount FROM account a LEFT JOIN purchase p ON p.account_code = a.code ORDER BY a.code, p.id;',
    columns: ['code', 'id', 'amount'], rows: [['A', 12, 20], ['A', 14, 5], ['B', 10, 12.5], ['B', 11, 7.5], ['C', 13, null], ['D', null, null]],
    sources: [joined(2, 12), joined(2, 14), joined(1, 10), joined(1, 11), joined(3, 13), joined(4)], requiredStages: ['join'],
  },
  {
    name: 'three-valued logic excludes NULL from a negated comparison', dialect: 'PostgreSQL',
    sql: "SELECT id, CAST('false' AS BOOLEAN) AS disabled FROM purchase WHERE NOT (amount > 10) ORDER BY id;",
    columns: ['id', 'disabled'], rows: [[11, 0], [14, 0]], sources: [purchase(11), purchase(14)],
  },
  {
    name: 'outer-join aggregates distinguish NULL amounts and zero matches', dialect: 'MySQL',
    sql: "SELECT a.code, COUNT(p.id) AS orders, COUNT(p.amount) AS priced, SUM(p.amount) AS total, GROUP_CONCAT(p.id ORDER BY p.id DESC SEPARATOR '|') AS purchase_ids FROM account a LEFT JOIN purchase p ON p.account_code = a.code GROUP BY a.code ORDER BY a.code;",
    columns: ['code', 'orders', 'priced', 'total', 'purchase_ids'], rows: [['A', 2, 2, 25, '14|12'], ['B', 2, 2, 20, '11|10'], ['C', 1, 0, null, '13'], ['D', 0, 0, null, null]],
    sources: [joined(2, 12, 14), joined(1, 10, 11), joined(3, 13), joined(4)], requiredStages: ['groupBy'],
  },
  {
    name: 'HAVING filters groups after aggregation', dialect: 'MariaDB',
    sql: 'SELECT account_code, SUM(amount) AS total FROM purchase GROUP BY account_code HAVING SUM(amount) >= 20 ORDER BY total DESC, account_code;',
    columns: ['account_code', 'total'], rows: [['A', 25], ['B', 20]],
    sources: [purchase(12, 14), purchase(10, 11)], requiredStages: ['groupBy', 'having'],
  },
  {
    name: 'MySQL comma pagination follows the requested sort', dialect: 'MySQL',
    sql: 'SELECT id, amount, 10 * 2 DIV 3 AS quotient FROM purchase ORDER BY amount DESC, id LIMIT 1, 2;',
    columns: ['id', 'amount', 'quotient'], rows: [[10, 12.5, 6], [11, 7.5, 6]], sources: [purchase(10), purchase(11)], requiredStages: ['orderLimit'],
  },
  {
    name: 'CTE aggregation joins back to base rows', dialect: 'PostgreSQL',
    sql: 'WITH totals AS (SELECT account_code, SUM(amount) AS total FROM purchase GROUP BY account_code) SELECT a.code, COALESCE(t.total, 0) AS total FROM account a LEFT JOIN totals t ON t.account_code = a.code ORDER BY a.code;',
    columns: ['code', 'total'], rows: [['A', 25], ['B', 20], ['C', 0], ['D', 0]], provenanceUnavailable: true, requiredStages: ['subquery', 'select'],
  },
  {
    name: 'partitioned window ranking and running totals', dialect: 'MariaDB',
    sql: 'SELECT id, account_code, ROW_NUMBER() OVER (PARTITION BY account_code ORDER BY id) AS n, SUM(amount) OVER (PARTITION BY account_code ORDER BY id) AS running FROM purchase ORDER BY account_code, id;',
    columns: ['id', 'account_code', 'n', 'running'], rows: [[12, 'A', 1, 20], [14, 'A', 2, 25], [10, 'B', 1, 12.5], [11, 'B', 2, 20], [13, 'C', 1, null]],
    sources: [purchase(12), purchase(14), purchase(10), purchase(11), purchase(13)],
  },
  {
    name: 'escaped apostrophe and semicolon inside a string', dialect: 'MySQL',
    sql: String.raw`SELECT id, note FROM purchase WHERE note = 'A;B' OR note = 'O\'Hara' ORDER BY id;`,
    columns: ['id', 'note'], rows: [[10, 'A;B'], [12, "O'Hara"]], sources: [purchase(10), purchase(12)],
  },
  {
    name: 'correlated EXISTS sees a NULL purchase amount', dialect: 'PostgreSQL',
    sql: 'SELECT a.code FROM account a WHERE EXISTS (SELECT 1 FROM purchase p WHERE p.account_code = a.code AND p.amount IS NULL) ORDER BY a.code;',
    columns: ['code'], rows: [['C']], sources: [account(3)], requiredStages: ['subquery', 'select'],
  },
  {
    name: 'INSERT survives subsequent queries in the same session', dialect: 'MySQL',
    sql: "INSERT INTO purchase VALUES (15, 'A', 3.5, 'new;row', '2025-03-04');",
    columns: purchaseColumns, rows: [[15, 'A', 3.5, 'new;row', '2025-03-04']], sources: [purchase(15)], changedTables: ['purchase'], requiredStages: ['modify'],
  },
  {
    name: 'read after INSERT recomputes joined aggregates', dialect: 'MariaDB',
    sql: "SELECT a.code, COUNT(p.id) AS orders, SUM(p.amount) AS total FROM account a JOIN purchase p ON p.account_code = a.code WHERE a.code = 'A' GROUP BY a.code;",
    columns: ['code', 'orders', 'total'], rows: [['A', 3, 28.5]], sources: [joined(2, 12, 14, 15)], requiredStages: ['join', 'groupBy'],
  },
  {
    name: 'UPDATE changes values without replacing row identity', dialect: 'PostgreSQL',
    sql: "UPDATE purchase SET amount = amount + 2.5, note = 'revised' WHERE id = 15 RETURNING id, amount;",
    columns: ['id', 'amount'], rows: [[15, 6]], sources: [purchase(15)], changedTables: ['purchase'], requiredStages: ['where', 'modify'],
  },
  {
    name: 'read after UPDATE with PostgreSQL cast and date formatting', dialect: 'PostgreSQL',
    sql: "SELECT id, (amount + 0)::numeric(10,2)::text AS amount, TO_CHAR(posted_on, 'YYYY-MM-DD') AS posted FROM purchase WHERE id = 15;",
    columns: ['id', 'amount', 'posted'], rows: [[15, '6.0', '2025-03-04']], sources: [purchase(15)],
  },
  {
    name: 'DELETE shows the removed row and its prior trace', dialect: 'MariaDB',
    sql: 'DELETE FROM purchase WHERE id = 15;', columns: purchaseColumns,
    rows: [[15, 'A', 6, 'revised', '2025-03-04']], provenanceUnavailable: true, changedTables: ['purchase'], requiredStages: ['where', 'modify'],
  },
  {
    name: 'read after DELETE contains only original purchases', dialect: 'MySQL',
    sql: "SELECT id, amount FROM purchase WHERE account_code = 'A' ORDER BY id;",
    columns: ['id', 'amount'], rows: [[12, 20], [14, 5]], sources: [purchase(12), purchase(14)],
  },
  {
    name: 'final full-session aggregate and NULL provenance stay intact', dialect: 'MariaDB',
    sql: 'SELECT a.code, COUNT(p.id) AS orders, COALESCE(SUM(p.amount), 0) AS total FROM account a LEFT JOIN purchase p ON p.account_code = a.code GROUP BY a.code ORDER BY total DESC, a.code;',
    columns: ['code', 'orders', 'total'], rows: [['A', 2, 25], ['B', 2, 20], ['C', 1, 0], ['D', 0, 0]],
    sources: [joined(2, 12, 14), joined(1, 10, 11), joined(3, 13), joined(4)], requiredStages: ['join', 'groupBy', 'orderLimit'],
  },
  {
    name: 'CREATE PostgreSQL identity table with a foreign key in the live session', dialect: 'PostgreSQL',
    sql: 'CREATE TABLE query_audit (audit_id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, account_code TEXT NOT NULL REFERENCES account(code), total NUMERIC(10,2) NOT NULL DEFAULT 0);',
    columns: ['object', 'type'], rows: [['query_audit', 'table']], provenanceUnavailable: true,
    changedTables: ['query_audit'], schemaTables: ['account', 'purchase', 'query_audit'], requiredStages: ['create'],
  },
  {
    name: 'CREATE MySQL unique index used by the following upsert', dialect: 'MySQL',
    sql: 'CREATE UNIQUE INDEX `audit_account_unique` ON `query_audit` (`account_code`);',
    columns: ['object', 'type'], rows: [['audit_account_unique', 'index']], provenanceUnavailable: true,
    changedTables: [], schemaTables: ['account', 'purchase', 'query_audit'], requiredStages: ['create'],
  },
  {
    name: 'INSERT SELECT populates the newly created identity table from grouped data', dialect: 'MariaDB',
    sql: 'INSERT INTO query_audit (account_code, total) SELECT account_code, SUM(amount) FROM purchase WHERE amount IS NOT NULL GROUP BY account_code ORDER BY account_code;',
    columns: ['audit_id', 'account_code', 'total'], rows: [[1, 'A', 25], [2, 'B', 20]],
    sources: [{ query_audit: [1] }, { query_audit: [2] }], changedTables: ['query_audit'], requiredStages: ['subquery', 'modify'],
  },
  {
    name: 'PostgreSQL upsert updates and inserts together using the created index', dialect: 'PostgreSQL',
    sql: "INSERT INTO query_audit (audit_id, account_code, total) VALUES (1, 'A', 26.5), (3, 'D', 0) ON CONFLICT(account_code) DO UPDATE SET total = excluded.total RETURNING audit_id, account_code, total;",
    columns: ['audit_id', 'account_code', 'total'], rows: [[1, 'A', 26.5], [3, 'D', 0]],
    sources: [{ query_audit: [1] }, { query_audit: [3] }], changedTables: ['query_audit'], requiredStages: ['modify'],
  },
  {
    name: 'final readback joins the created table and distinguishes missing from zero totals', dialect: 'MariaDB',
    sql: "SELECT a.code, q.audit_id, IFNULL(q.total, -1) AS total, CASE WHEN q.audit_id IS NULL THEN 'unrecorded' WHEN q.total = 0 THEN 'zero' ELSE 'paid' END AS status FROM account a LEFT JOIN query_audit q ON q.account_code = a.code ORDER BY a.code;",
    columns: ['code', 'audit_id', 'total', 'status'], rows: [['A', 1, 26.5, 'paid'], ['B', 2, 20, 'paid'], ['C', null, -1, 'unrecorded'], ['D', 3, 0, 'zero']],
    sources: [{ account: [2], query_audit: [1] }, { account: [1], query_audit: [2] }, { account: [3], query_audit: [] }, { account: [4], query_audit: [3] }],
    requiredStages: ['join', 'orderLimit'],
  },
];
