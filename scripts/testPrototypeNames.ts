import assert from 'node:assert/strict';
import { SqlRuntime } from '../lib/sqlRuntime';
import { ownValue } from '../lib/records';
import { provenanceFor } from '../lib/provenance';

async function main() {
  const runtime = new SqlRuntime();
  const names = ['__proto__', 'constructor', 'toString'];
  const initialPrototypeKeys = Object.getOwnPropertyNames(Object.prototype);
  const ddl = names.map((name) => `CREATE TABLE "${name}" (id INTEGER PRIMARY KEY, amount INTEGER); INSERT INTO "${name}" VALUES (1, 2), (2, 3);`).join('\n');
  const def = { id: 'custom', name: 'Prototype-name regression', description: '', starterQuery: '', ddl };
  try {
    const loaded = await runtime.loadSchema(def);
    assert.deepEqual(Object.keys(loaded.tableData), names);
    assert.equal(Object.getPrototypeOf(loaded.tableData), Object.prototype);
    for (const name of names) {
      assert.deepEqual(ownValue(loaded.tableData, name)?.rows, [[1, 2], [2, 3]]);
      const grouped = runtime.runQuery(`SELECT amount, COUNT(*) AS n FROM "${name}" GROUP BY amount ORDER BY amount;`);
      assert.deepEqual(grouped.trace.at(-1)!.partialResult!.rows, [[2, 1], [3, 1]]);
      assert.deepEqual(grouped.trace.at(-1)!.resultRowSources, [{ [name]: [1] }, { [name]: [2] }]);
      const distinct = runtime.runQuery(`SELECT DISTINCT amount FROM "${name}" ORDER BY amount;`);
      assert.deepEqual(distinct.trace.at(-1)!.partialResult!.rows, [[2], [3]]);
      assert.deepEqual(distinct.trace.at(-1)!.resultRowSources, [{ [name]: [1] }, { [name]: [2] }]);
      for (const step of structuredClone(grouped.trace)) {
        assert.equal(ownValue(step.litRows, 'missing'), undefined);
        const clicked = provenanceFor(step, name, 1);
        assert.ok(ownValue(clicked.rows, name)?.has(1));
      }
      const update = runtime.runQuery(`UPDATE "${name}" SET amount = amount + 1 WHERE id = 1 RETURNING amount;`);
      assert.deepEqual(update.trace.at(-1)!.partialResult!.rows, [[3]]);
      assert.deepEqual(update.mutation!.tableData[name].rows, [[1, 3], [2, 3]]);
      assert.ok(Object.hasOwn(update.mutation!.tableData, name));
    }
    const alias = runtime.runQuery('SELECT "__proto__".id FROM "constructor" AS "__proto__" ORDER BY id;');
    assert.deepEqual(alias.trace[0].tuples, [{ ['__proto__']: 1 }, { ['__proto__']: 2 }]);
    assert.deepEqual(alias.trace.at(-1)!.resultRowSources, [{ constructor: [1] }, { constructor: [2] }]);
    const created = runtime.runQuery('CREATE TABLE "valueOf" (id INTEGER PRIMARY KEY);');
    assert.ok(Object.hasOwn(created.mutation!.tableData, 'valueOf'));
    assert.deepEqual(runtime.runQuery('INSERT INTO "valueOf" VALUES (1) RETURNING id;').trace.at(-1)!.partialResult!.rows, [[1]]);
    for (const name of names) {
      assert.equal(ownValue(structuredClone({}), name), undefined, 'worker boundary missing-key lookup excludes inherited properties');
    }
    assert.deepEqual(Object.getOwnPropertyNames(Object.prototype), initialPrototypeKeys, 'SQL names never change global prototypes');
    console.log('PASS prototype-name schema loading, grouping, provenance, mutations, alias tuples, CREATE, and worker-boundary lookups.');
  } finally {
    runtime.close();
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
