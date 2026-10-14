/* DDL and transaction regressions for the final-release query session. */
import assert from 'node:assert/strict';
import { SqlRuntime } from '../lib/sqlRuntime';
import type { SchemaDef } from '../lib/schemas';

const def: SchemaDef = {
  id: 'custom', name: 'Schema statement regression', description: '', starterQuery: 'SELECT * FROM parent',
  ddl: "CREATE TABLE parent (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO parent VALUES (1, 'same'), (2, 'same');",
};

async function main() {
  const runtime = new SqlRuntime();
  const restored = new SqlRuntime();
  let passed = 0;
  const check = (name: string, action: () => void) => {
    action();
    passed++;
    console.log(`PASS ${name}`);
  };
  const rows = (sql: string) => runtime.runQuery(sql).trace.at(-1)!.partialResult!.rows;
  const rejected = (sql: string, pattern: RegExp) => assert.throws(() => runtime.runQuery(sql), pattern);
  try {
    await runtime.loadSchema(def);
    check('CREATE includes generated columns in metadata and data', () => {
      const run = runtime.runQuery('CREATE TABLE generated_item (id INTEGER PRIMARY KEY, price INT DEFAULT 3, total INT GENERATED ALWAYS AS (price * 2) STORED)');
      assert.deepEqual(run.mutation!.schema!.find((t) => t.name === 'generated_item')!.columns.map((c) => c.name), ['id', 'price', 'total']);
      assert.deepEqual(run.mutation!.tableData.generated_item.columns, ['id', 'price', 'total']);
      assert.deepEqual(run.mutation!.changedTables, ['generated_item']);
    });
    check('DEFAULT VALUES computes defaults and generated values', () => {
      assert.deepEqual(rows('INSERT INTO generated_item DEFAULT VALUES RETURNING id, price, total'), [[1, 3, 6]]);
      assert.deepEqual(rows('SELECT total FROM generated_item'), [[6]]);
    });
    check('generated values follow UPDATE and provenance', () => {
      const run = runtime.runQuery('UPDATE generated_item SET price = 4 WHERE id = 1 RETURNING total');
      assert.deepEqual(run.trace.at(-1)!.partialResult!.rows, [[8]]);
      assert.deepEqual(run.trace.at(-1)!.resultRowSources, [{ generated_item: [1] }]);
    });
    check('generated values cannot be overwritten and prior data survives', () => {
      rejected('UPDATE generated_item SET total = 99', /generated/i);
      assert.deepEqual(rows('SELECT total FROM generated_item'), [[8]]);
    });
    check('CREATE IF NOT EXISTS preserves current schema and data', () => {
      const run = runtime.runQuery('CREATE TABLE IF NOT EXISTS generated_item (wrong TEXT)');
      assert.deepEqual(run.mutation!.changedTables, []);
      assert.deepEqual(rows('SELECT * FROM generated_item'), [[1, 4, 8]]);
    });
    check('quoted names and semicolons are single identifiers', () => {
      runtime.runQuery('CREATE TABLE "audit; events" (id INTEGER PRIMARY KEY, label TEXT)');
      assert.deepEqual(rows('INSERT INTO "audit; events" SELECT id, label FROM parent RETURNING id, label'), [[1, 'same'], [2, 'same']]);
    });
    check('INSERT SELECT upsert previews only the source SELECT', () => {
      assert.deepEqual(rows("INSERT INTO \"audit; events\" SELECT id, 'updated' FROM parent WHERE TRUE ON CONFLICT(id) DO UPDATE SET label = excluded.label RETURNING id, label"), [[1, 'updated'], [2, 'updated']]);
    });
    check('failed unique CREATE INDEX does not leave an index', () => {
      rejected('CREATE UNIQUE INDEX label_index ON parent(label)', /unique/i);
      assert.deepEqual(rows('CREATE INDEX label_index ON parent(label)'), [['label_index', 'index']]);
    });
    check('CREATE INDEX IF NOT EXISTS preserves an existing index', () => {
      const run = runtime.runQuery('CREATE INDEX IF NOT EXISTS label_index ON parent(id)');
      assert.deepEqual(run.mutation!.changedTables, []);
    });
    check('partial unique indexes enforce only their predicate', () => {
      runtime.runQuery('CREATE UNIQUE INDEX unique_high_price ON generated_item(price) WHERE price > 10');
      rows('INSERT INTO generated_item(price) VALUES (4), (12)');
      rejected('INSERT INTO generated_item(price) VALUES (12)', /unique/i);
      assert.deepEqual(rows('SELECT id, price, total FROM generated_item ORDER BY id'), [[1, 4, 8], [2, 4, 8], [3, 12, 24]]);
    });
    check('deferred foreign key failure rolls back the released savepoint', () => {
      runtime.runQuery('CREATE TABLE deferred_child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)');
      rejected('INSERT INTO deferred_child VALUES (1, 999)', /foreign key/i);
      assert.deepEqual(rows('SELECT * FROM deferred_child'), []);
      assert.deepEqual(rows('INSERT INTO deferred_child VALUES (1, 1) RETURNING *'), [[1, 1]]);
    });
    check('deferred UPDATE rejects atomically and session remains usable', () => {
      rejected('UPDATE deferred_child SET parent_id = 999', /foreign key/i);
      assert.deepEqual(rows('SELECT * FROM deferred_child'), [[1, 1]]);
    });
    check('deferred parent DELETE rejects atomically', () => {
      rejected('DELETE FROM parent WHERE id = 1', /foreign key/i);
      assert.deepEqual(rows('SELECT id FROM parent ORDER BY id'), [[1], [2]]);
    });
    check('UPDATE FROM traces only matched target rows', () => {
      const run = runtime.runQuery("UPDATE parent AS p SET label = g.price FROM generated_item g WHERE p.id = g.id AND g.id = 1 RETURNING id, label");
      const where = run.trace.find((step) => step.stage === 'where')!;
      assert.deepEqual(where.partialResult!.rows, [[1, 'same']]);
      assert.deepEqual(where.resultRowSources, [{ parent: [1] }]);
      assert.doesNotMatch(run.trace.at(-1)!.narration, /already held/);
      const empty = runtime.runQuery('UPDATE parent AS p SET label = g.price FROM generated_item g WHERE g.id = 99 RETURNING id');
      assert.deepEqual(empty.trace.find((step) => step.stage === 'where')!.partialResult!.rows, []);
    });
    check('primary key UPDATE reports the moved identity as changed', () => {
      const run = runtime.runQuery('UPDATE generated_item SET id = 10 WHERE id = 1 RETURNING id, total');
      assert.match(run.trace.at(-1)!.label, /1 row changed/);
      assert.doesNotMatch(run.trace.at(-1)!.narration, /already held/);
      assert.deepEqual(run.trace.at(-1)!.resultRowSources, [{ generated_item: [10] }]);
      rows('UPDATE generated_item SET id = 1 WHERE id = 10');
    });
    check('implicit composite foreign keys map each parent key in order', () => {
      runtime.runQuery('CREATE TABLE composite_parent (a TEXT, b INT, PRIMARY KEY (b, a))');
      const run = runtime.runQuery('CREATE TABLE composite_child (x INT, y TEXT, FOREIGN KEY(x, y) REFERENCES composite_parent)');
      const edges = run.mutation!.fkEdges!.filter((edge) => edge.target === 'composite_child');
      assert.deepEqual(edges.map((edge) => [edge.sourceHandle, edge.targetHandle]), [['b', 'x'], ['a', 'y']]);
      rows("INSERT INTO composite_parent VALUES ('A', 1)");
      rows("INSERT INTO composite_child VALUES (1, 'A')");
      rejected("INSERT INTO composite_child VALUES (2, 'A')", /foreign key/i);
    });
    check('oversized CREATE rolls back schema before the same name is reused', () => {
      rejected(`CREATE TABLE too_wide (${Array.from({ length: 41 }, (_, i) => `c${i} INT`).join(',')})`, /40-column/i);
      runtime.runQuery('CREATE TABLE too_wide (id INT)');
      assert.deepEqual(rows('SELECT * FROM too_wide'), []);
    });
    check('reserved row identity fails atomically', () => {
      rejected('CREATE TABLE reserved_column (_rowid_ INT)', /reserved|reserves/i);
      runtime.runQuery('CREATE TABLE reserved_column (id INT)');
    });
    check('WITHOUT ROWID fails atomically', () => {
      rejected('CREATE TABLE bad_rowid (id INT PRIMARY KEY) WITHOUT ROWID', /WITHOUT ROWID/i);
      runtime.runQuery('CREATE TABLE bad_rowid (id INT PRIMARY KEY)');
    });
    check('multiple CREATE statements do not execute the first', () => {
      rejected('CREATE TABLE atomic_first (id INT); CREATE TABLE atomic_second (id INT)', /one.*statement/i);
      rejected('SELECT * FROM atomic_first', /unknown|does not exist/i);
    });
    for (const sql of [
      'CREATE TEMPORARY TABLE unsupported (id INT)',
      'CREATE VIEW unsupported AS SELECT * FROM parent',
      'CREATE TABLE unsupported AS SELECT * FROM parent',
      'CREATE TABLE unsupported AS WITH p AS (SELECT * FROM parent) SELECT * FROM p',
      'CREATE TABLE unsupported LIKE parent',
    ]) check(`actionable rejection: ${sql}`, () => rejected(sql, /not supported|only|declare|temporary|views/i));
    check('post-rejection CREATE proves no partial structures remain', () => runtime.runQuery('CREATE TABLE unsupported (id INT)'));
    check('a table named generated remains queryable after CREATE', () => {
      runtime.runQuery('CREATE TABLE generated (id INTEGER PRIMARY KEY, value INT)');
      rows('INSERT INTO generated VALUES (1, 2)');
      assert.deepEqual(rows('UPDATE generated SET value = 3 RETURNING id'), [[1]]);
      assert.deepEqual(rows('SELECT id, value FROM generated'), [[1, 3]]);
    });

    const saved = runtime.runQuery('CREATE INDEX restore_index ON deferred_child(parent_id)').mutation!.databaseBytes;
    assert.ok(saved);
    const loaded = await restored.loadSchema(def, saved);
    check('new table metadata and generated data survive export and restore', () => {
      assert.deepEqual(loaded.tableData.generated_item.rows, [[1, 4, 8], [2, 4, 8], [3, 12, 24]]);
      assert.equal(loaded.schema.find((t) => t.name === 'generated_item')!.columns.length, 3);
      assert.ok(loaded.fkEdges.some((edge) => edge.source === 'parent' && edge.target === 'deferred_child'));
      assert.throws(() => restored.runQuery('INSERT INTO generated_item(price) VALUES (12)'), /unique/i);
      assert.throws(() => restored.runQuery('INSERT INTO deferred_child VALUES (2, 999)'), /foreign key/i);
      assert.deepEqual(restored.runQuery('SELECT * FROM deferred_child').trace.at(-1)!.partialResult!.rows, [[1, 1]]);
    });
    check('table count bound rolls back only the rejected CREATE', () => {
      let count = loaded.schema.length;
      while (count < 24) { runtime.runQuery(`CREATE TABLE limit_${count} (id INT)`); count++; }
      rejected('CREATE TABLE over_limit (id INT)', /24 tables/i);
      rejected('SELECT * FROM over_limit', /unknown|does not exist/i);
      assert.deepEqual(rows('SELECT id FROM parent ORDER BY id'), [[1], [2]]);
    });
    console.log(`\n${passed} schema, transaction and persistence checks passed.`);
  } finally {
    runtime.close();
    restored.close();
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
