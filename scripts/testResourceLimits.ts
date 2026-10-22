import assert from 'node:assert/strict';
import { createDatabase, exportDatabase, queryAll, restoreDatabase } from '../lib/db';
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
    check('SQLite integers are read exactly and unsupported results are rejected', () => {
      for (const value of ['9007199254740992', '9007199254740993', '-9007199254740992', '-9007199254740993', '9223372036854775807', '-9223372036854775808']) {
        assert.throws(() => scalar(`SELECT ${value}`), /exact browser tracing/);
        assert.equal(scalar(`SELECT CAST(${value} AS TEXT)`), value, 'an explicit text conversion preserves every digit');
        assert.equal(typeof scalar(`SELECT CAST(${value} AS REAL)`), 'number', 'REAL values retain SQLite floating-point semantics');
      }
      assert.deepEqual(queryAll(database, 'SELECT -9007199254740991, 9007199254740991, 1.5').rows, [[Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1.5]]);
      assert.equal(scalar('SELECT 7'), 7, 'a rejected result frees its statement');
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

  const exactRuntime = new SqlRuntime();
  const exactDef: SchemaDef = { ...def, ddl: 'CREATE TABLE sample(id INTEGER PRIMARY KEY, value INTEGER); INSERT INTO sample VALUES(1,7);' };
  const exactRows = (sql: string) => exactRuntime.runQuery(sql).trace.at(-1)!.partialResult!.rows;
  try {
    await exactRuntime.loadSchema(exactDef);
    check('unsafe integer mutations and RETURNING results roll back atomically', () => {
      assert.throws(() => exactRows('SELECT 9007199254740991 + 1'), /exact browser tracing/);
      assert.deepEqual(exactRows('SELECT CAST(9007199254740993 AS TEXT)'), [['9007199254740993']]);
      for (const sql of [
        'INSERT INTO sample VALUES(9007199254740992,8)',
        'INSERT INTO sample VALUES(2,9007199254740993)',
        'UPDATE sample SET id=-9007199254740992 WHERE id=1',
        'UPDATE sample SET value=9007199254740993 WHERE id=1',
        'UPDATE sample SET value=8 WHERE id=1 RETURNING 9007199254740993',
      ]) {
        assert.throws(() => exactRuntime.runQuery(sql), /exact browser tracing/, sql);
        assert.deepEqual(exactRows('SELECT * FROM sample'), [[1, 7]], 'failed writes leave the old rows intact');
      }
    });
    const unsafeImports = [
      "CREATE TABLE unsafe(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO unsafe VALUES(9007199254740992,'first'),(9007199254740993,'second');",
      'CREATE TABLE unsafe(value INTEGER); INSERT INTO unsafe VALUES(-9007199254740993);',
      "CREATE TABLE unsafe(value TEXT); INSERT INTO unsafe(rowid,value) VALUES(9007199254740992,'hidden row identity');",
    ];
    for (const ddl of unsafeImports) {
      await assert.rejects(exactRuntime.loadSchema({ ...exactDef, ddl }), /exact browser tracing/);
      const unsafeDatabase = await createDatabase(ddl);
      let bytes: Uint8Array;
      try { bytes = exportDatabase(unsafeDatabase); }
      finally { unsafeDatabase.close(); }
      await assert.rejects(restoreDatabase(bytes, true), /exact browser tracing/);
      await assert.rejects(exactRuntime.loadSchema(exactDef, bytes), /exact browser tracing/);
    }
    check('unsafe imports and restored integer identities preserve the working database', () => {
      assert.deepEqual(exactRows('SELECT * FROM sample'), [[1, 7]]);
    });
    await exactRuntime.loadSchema({ ...exactDef, ddl: 'CREATE TABLE sample(id INTEGER PRIMARY KEY,value INTEGER); INSERT INTO sample VALUES(-9007199254740991,1),(9007199254740991,2);' });
    check('safe boundary row identities stay distinct and their mutations are traced', () => {
      const run = exactRuntime.runQuery('UPDATE sample SET value=3 WHERE id=9007199254740991');
      assert.deepEqual(run.trace.at(-1)!.partialResult!.rows, [[Number.MAX_SAFE_INTEGER, 3]]);
      assert.deepEqual(run.mutation!.changedTables, ['sample']);
      assert.deepEqual(run.trace.at(-1)!.resultRowSources, [{ sample: [Number.MAX_SAFE_INTEGER] }]);
      assert.deepEqual(exactRows('SELECT * FROM sample ORDER BY id'), [[Number.MIN_SAFE_INTEGER, 1], [Number.MAX_SAFE_INTEGER, 3]]);
      assert.throws(() => exactRuntime.runQuery('INSERT INTO sample(value) VALUES(4)'), /exact browser tracing/, 'an automatically assigned unsafe rowid is also rejected');
      assert.deepEqual(exactRows('SELECT COUNT(*) FROM sample'), [[2]]);
    });
    await exactRuntime.loadSchema({ ...exactDef, ddl: 'CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES(\'original\');' });
    check('hidden rowids are validated before writes commit', () => {
      assert.throws(() => exactRuntime.runQuery("UPDATE sample SET rowid=9007199254740993"), /exact browser tracing/);
      assert.deepEqual(exactRows('SELECT rowid,value FROM sample'), [[1, 'original']]);
    });
  } finally { exactRuntime.close(); }
  console.log(`${passed} resource containment checks passed.`);
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
