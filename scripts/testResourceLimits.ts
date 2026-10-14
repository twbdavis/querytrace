import assert from 'node:assert/strict';
import { createDatabase, queryAll } from '../lib/db';
import { withResultBudget } from '../lib/resourceLimits';
import { SqlRuntime } from '../lib/sqlRuntime';
import type { SchemaDef } from '../lib/schemas';

async function main() {
  let passed = 0;
  const check = (name: string, run: () => void) => { run(); passed++; console.log(`PASS ${name}`); };
  const database = await createDatabase('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO sample VALUES (1, \'original\');');
  const series = (count: number, expression: string) => `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${count}) SELECT ${expression} FROM n`;
  const scalar = (sql: string) => queryAll(database, sql).rows[0]?.[0];
  const limit = /browser (?:result )?limit/;
  try {
    check('streaming stops above 50,000 rows and frees the statement', () => {
      assert.throws(() => queryAll(database, series(50_001, 'i')), limit);
      assert.equal(scalar('SELECT 7'), 7);
    });
    check('wide results are bounded by cells independently of rows', () => {
      assert.throws(() => queryAll(database, series(12_501, Array(40).fill('i').join(','))), limit);
    });
    check('SQLite strings are bounded before entering the trace', () => {
      assert.throws(() => scalar("SELECT printf('%.*c',100001,120)"), /100,000-character/);
    });
    check('binary results and function inputs are bounded before decoding', () => {
      assert.throws(() => scalar('SELECT zeroblob(100001)'), /100,000-byte/);
      assert.throws(() => scalar('SELECT REVERSE(zeroblob(100001))'), /100,000-byte/);
      assert.deepEqual(scalar('SELECT zeroblob(3)'), new Uint8Array(3));
    });
    check('result bytes have a separate cumulative limit', () => {
      assert.throws(() => queryAll(database, series(47, "printf('%.*c',90000,120)")), limit);
      assert.throws(() => withResultBudget(database, () => {
        queryAll(database, series(30, "printf('%.*c',90000,120)"));
        queryAll(database, series(30, "printf('%.*c',90000,120)"));
      }), limit);
      assert.equal(queryAll(database, series(30, "printf('%.*c',90000,120)")).rows.length, 30, 'a failed request does not consume the next request budget');
    });
    check('SQLite allocation failures remain recoverable', () => {
      assert.throws(() => scalar('SELECT randomblob(100000000)'), /memory/i);
      assert.equal(scalar('SELECT 9'), 9);
    });
    check('compatibility functions reject excessive output before allocating it', () => {
      for (const expression of ["REPEAT('xx',1000000000)", "LPAD('x',1000000000,'a')", "RPAD('x',1000000000,'a')", 'SPACE(1000000000)']) {
        assert.throws(() => scalar(`SELECT ${expression}`), /100,000-character/);
      }
      assert.equal(String(scalar("SELECT REPEAT('x',10001)")).length, 10001, 'valid counts are not silently truncated');
      assert.equal(scalar("SELECT REPEAT('',1e30)"), '');
      assert.equal(scalar("SELECT LPAD('ab',5,'xy')"), 'xyxab');
      assert.equal(scalar("SELECT RPAD('ab',5,'xy')"), 'abxyx');
    });
    check('ambiguous regular expressions fail promptly and simple patterns work', () => {
      for (const pattern of ['^(a|aa)+$', '(a+)+$', 'a+a+$', '(a)\\1+', 'a{1000000}', '^' + 'a?'.repeat(50) + 'a'.repeat(50) + '$']) {
        assert.throws(() => scalar(`SELECT REGEXP('${pattern}', 'aaaaaaaaaaaaaaaaaaaaaaaaaa!')`), /pattern limits/);
      }
      assert.equal(scalar("SELECT REGEXP('^[A-Z]+$', 'HELLO')"), 1);
      assert.equal(scalar("SELECT REGEXP('^item[0-9]{1,3}$', 'item42')"), 1);
      assert.equal(scalar("SELECT REGEXP('^item[0-9]{1,3}$', 'bad')"), 0);
    });
  } finally { database.close(); }

  const runtime = new SqlRuntime();
  const def: SchemaDef = { id: 'custom', name: 'Resource limits', description: '', starterQuery: 'SELECT * FROM sample',
    ddl: `CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO sample VALUES ${Array.from({ length: 300 }, (_, i) => `(${i + 1},'original')`).join(',')};` };
  try {
    await runtime.loadSchema(def);
    const rows = (sql: string) => runtime.runQuery(sql).trace.at(-1)!.partialResult!.rows;
    check('DML exceeding the cumulative trace budget rolls back completely', () => {
      assert.throws(() => runtime.runQuery("UPDATE sample SET value = REPEAT('x',8000)"), /browser result limit/);
      assert.deepEqual(rows('SELECT COUNT(*) AS n FROM sample WHERE value = \'original\''), [[300]]);
      assert.deepEqual(rows("UPDATE sample SET value = 'changed' WHERE id = 1 RETURNING value"), [['changed']]);
    });
    check('oversized writes roll back and keep the prior acknowledged data', () => {
      assert.throws(() => runtime.runQuery("UPDATE sample SET value = REPEAT('x',100001) WHERE id = 1"), /100,000-character/);
      assert.deepEqual(rows('SELECT value FROM sample WHERE id = 1'), [['changed']]);
    });
    // Bundled sessions can be mutated too and must obey the same capacity cap.
    await runtime.loadSchema({ ...def, id: 'resource-test-builtin', ddl: 'CREATE TABLE sample (id INTEGER PRIMARY KEY); INSERT INTO sample VALUES ' + Array.from({ length: 500 }, (_, i) => `(${i + 1})`).join(',') });
    check('bundled sessions enforce row caps on DML as well as CREATE', () => {
      assert.throws(() => runtime.runQuery('INSERT INTO sample VALUES (501)'), /500-row limit/);
      assert.deepEqual(rows('SELECT COUNT(*) AS n FROM sample'), [[500]]);
    });
    const wideDdl = ['wide_a', 'wide_b'].map((table) => `CREATE TABLE ${table} (id INT PRIMARY KEY, value TEXT); INSERT INTO ${table} VALUES ${Array.from({ length: 30 }, (_, i) => `(${i},REPEAT('x',90000))`).join(',')};`).join('\n');
    await assert.rejects(runtime.loadSchema({ ...def, ddl: wideDdl }), /browser result limit/);
    check('schema load bounds all tables together and preserves the previous database on rejection', () => {
      assert.deepEqual(rows('SELECT COUNT(*) AS n FROM sample'), [[500]]);
    });
    await runtime.loadSchema({ ...def, ddl: `CREATE TABLE sample (id INT PRIMARY KEY, value TEXT); INSERT INTO sample VALUES ${Array.from({ length: 250 }, (_, i) => `(${i},REPEAT('x',10000))`).join(',')};` });
    check('CREATE snapshot overflow rolls back new structure', () => {
      assert.throws(() => runtime.runQuery('CREATE TABLE rejected_structure (id INT)'), /browser result limit/);
      assert.throws(() => runtime.runQuery('SELECT * FROM rejected_structure'), /unknown table/i);
      assert.deepEqual(rows('SELECT COUNT(*) AS n FROM sample'), [[250]]);
    });
  } finally { runtime.close(); }
  console.log(`${passed} resource containment checks passed.`);
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
