import type { SchemaDef } from '../../lib/schemas';
import type { Case } from '../testDialects';

const def: SchemaDef = {
  id: 'custom', name: 'Result and grouping edge cases', description: '', starterQuery: 'SELECT * FROM item',
  ddl: `
    CREATE TABLE item (id INTEGER PRIMARY KEY, category TEXT, amount INTEGER, title TEXT);
    INSERT INTO item VALUES (1, 'A', 4, 'one'), (2, 'A', 7, 'two'), (3, 'B', 3, 'three');
    CREATE TABLE empty_table (code TEXT PRIMARY KEY, value INTEGER);
  `,
};

const cases: Case[] = [
  { sql: 'SELECT * FROM empty_table', columns: ['code', 'value'], rows: [] },
  { sql: 'SELECT id, title AS label FROM item WHERE id > 10', columns: ['id', 'label'], rows: [] },
  { sql: 'SELECT * FROM item LIMIT 0', columns: ['id', 'category', 'amount', 'title'], rows: [] },
  { sql: 'WITH x AS (SELECT id AS key FROM item WHERE id > 10) SELECT key FROM x', columns: ['key'], rows: [] },
  { sql: 'SELECT category, COUNT(*) + amount FROM item GROUP BY category', reject: /non-aggregate column amount.*GROUP BY/i },
  { sql: 'SELECT COUNT(*) + amount FROM item', reject: /scalar aggregate.*individual columns/i },
  { sql: 'SELECT category, CASE WHEN COUNT(*) > 0 THEN amount END FROM item GROUP BY category', reject: /non-aggregate column amount.*GROUP BY/i },
  { sql: "SELECT COUNT(*) AS n FROM item GROUP BY category HAVING category = 'A'", columns: ['n'], rows: [[2]] },
  { sql: 'SELECT category FROM item GROUP BY category HAVING SUM(amount) > 5', rows: [['A']] },
  { sql: 'SELECT COUNT(*) AS count, SUM(amount) AS sum, MIN(amount) AS min, MAX(amount) AS max, AVG(amount) AS avg FROM item', columns: ['count', 'sum', 'min', 'max', 'avg'], rows: [[3, 14, 3, 7, 14 / 3]] },
  { sql: "SELECT title || '!' AS full FROM item WHERE id = 1", columns: ['full'], rows: [['one!']] },
  { sql: 'SELECT category FROM item GROUP BY category HAVING amount > 3', reject: /non-aggregate HAVING column amount.*GROUP BY/i },
  { sql: 'SELECT title, SUM(amount) + id AS total FROM item GROUP BY id ORDER BY id', rows: [['one', 5], ['two', 9], ['three', 6]], ordered: true },
  { sql: "INSERT INTO item VALUES (4, 'C', 5, 'four') RETURNING id, title", columns: ['id', 'title'], rows: [[4, 'four']] },
  { sql: 'UPDATE item SET amount = amount WHERE id = 1 RETURNING id, amount', columns: ['id', 'amount'], rows: [[1, 4]] },
  { sql: 'UPDATE item SET amount = amount + 1 WHERE id IN (1, 2) RETURNING id, amount * 2 AS doubled', columns: ['id', 'doubled'], rows: [[1, 10], [2, 16]] },
  { sql: 'UPDATE item SET amount = 9 WHERE id = 99 RETURNING id, title', columns: ['id', 'title'], rows: [] },
  { sql: "INSERT INTO item VALUES (4, 'C', 6, 'four') ON CONFLICT(id) DO UPDATE SET amount = excluded.amount RETURNING amount", columns: ['amount'], rows: [[6]] },
  { sql: "INSERT INTO item VALUES (4, 'C', 6, 'four') ON CONFLICT(id) DO NOTHING RETURNING id", columns: ['id'], rows: [] },
  { sql: 'DELETE FROM item WHERE id = 4 RETURNING title;', columns: ['title'], rows: [['four']] },
  { sql: 'DELETE FROM item WHERE id = 99 RETURNING *', columns: ['id', 'category', 'amount', 'title'], rows: [] },
  { sql: "INSERT INTO item VALUES (1, 'D', 9, 'duplicate') RETURNING id", reject: /unique|already/i },
  { sql: 'SELECT id, amount FROM item ORDER BY id', rows: [[1, 5], [2, 8], [3, 3]], ordered: true },
  { sql: "INSERT INTO item VALUES (5, 'D', 1, 'returning') RETURNING title || '; RETURNING' AS label; -- keep comment", columns: ['label'], rows: [['returning; RETURNING']] },
  { sql: "UPDATE item SET title = 'RETURNING' WHERE id = 3", columns: ['id', 'category', 'amount', 'title'], rows: [[3, 'B', 3, 'RETURNING']] },
  { sql: "UPDATE item SET title = 'updated' WHERE title = 'RETURNING' -- RETURNING is a value", columns: ['id', 'category', 'amount', 'title'], rows: [[3, 'B', 3, 'updated']] },
  { sql: "SELECT title FROM item WHERE id = 3", rows: [['updated']] },
];

export const PROBES = [{ def, label: 'result_and_grouping_edges', cases }];
