import type { Case } from '../testDialects';
import type { SchemaDef } from '../../lib/schemas';

const def: SchemaDef = {
  id: 'custom',
  name: 'PostgreSQL adversarial cases',
  description: 'Casts, interval arithmetic, explicit NULL ordering and relational edge cases.',
  starterQuery: 'SELECT * FROM people',
  ddl: `
    CREATE TABLE department (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE people (
      id INTEGER PRIMARY KEY,
      department_id INTEGER REFERENCES department(id),
      name TEXT,
      score NUMERIC,
      joined DATE,
      enabled BOOLEAN
    );
    INSERT INTO department VALUES (1,'Engineering'),(2,'Sales'),(3,'Empty');
    INSERT INTO people VALUES
      (1,1,'Alice',10,'2024-01-31',TRUE),
      (2,1,'Bob',NULL,'2024-02-29',FALSE),
      (3,2,'Élodie',20,'2024-03-01',TRUE),
      (4,NULL,'alice',10,'2024-03-02',TRUE),
      (5,2,NULL,0,'2024-03-03',FALSE);
  `,
};

const cases: Case[] = [
  { sql: 'SELECT (score + 1)::numeric(10,2) / 2 AS n FROM people WHERE id = 1', rows: [[5.5]] },
  { sql: 'SELECT (score)::integer FROM people WHERE id = 1', rows: [[10]] },
  { sql: 'SELECT id, score::double precision / 4 AS fraction FROM people ORDER BY id', rows: [[1,2.5],[2,null],[3,5],[4,2.5],[5,0]], ordered: true },
  { sql: "SELECT '24'::integer::text AS n", rows: [['24']], columns: ['n'] },
  { sql: "SELECT CAST(CAST('24' AS INTEGER) AS TEXT)", rows: [['24']] },
  { sql: "SELECT CAST('24' AS NUMERIC) / 5, '24'::numeric / 5", rows: [[4.8,4.8]] },
  { sql: "SELECT CAST(COALESCE(CAST('24' AS INTEGER), 0) AS CHAR(2))", rows: [['24']] },
  { sql: "SELECT '2024-02-29 12:34:56'::timestamp(3) without time zone", rows: [['2024-02-29 12:34:56']] },
  { sql: "SELECT '12:34:56'::time without time zone", rows: [['12:34:56']] },
  { sql: "SELECT 'true'::boolean, 'false'::bool, '0'::boolean, NULL::boolean", rows: [[1,0,0,null]] },
  { sql: "SELECT CAST('YES' AS BOOLEAN), CAST('off' AS BOOLEAN), (-2)::boolean", rows: [[1,0,1]] },
  { sql: "SELECT 'not-a-boolean'::boolean", reject: /boolean/i },
  { sql: 'SELECT name::boolean FROM people WHERE id = 1', reject: /boolean/i },
  { sql: 'SELECT enabled::boolean FROM people WHERE id = 2', rows: [[0]] },
  { sql: "SELECT DATE '2024-01-31' + INTERVAL '1 month'", rows: [['2024-02-29']] },
  { sql: "SELECT DATE '2024-03-31' - INTERVAL '1 month'", rows: [['2024-02-29']] },
  { sql: "SELECT DATE '2024-03-01' - DATE '2024-02-28'", rows: [[2]] },
  { sql: "SELECT joined + INTERVAL '1 day' FROM people WHERE id = 2", rows: [['2024-03-01']] },
  { sql: 'SELECT id, score FROM people ORDER BY 2 ASC NULLS LAST, id', rows: [[5,0],[1,10],[4,10],[3,20],[2,null]], ordered: true },
  { sql: 'SELECT id, score FROM people ORDER BY 2 DESC NULLS FIRST, id', rows: [[2,null],[3,20],[1,10],[4,10],[5,0]], ordered: true },
  { sql: 'SELECT score AS s FROM people ORDER BY 1 NULLS LAST, id', rows: [[0],[10],[10],[20],[null]], ordered: true },
  { sql: 'SELECT COALESCE(score, 999) AS s FROM people ORDER BY 1 NULLS LAST, id', rows: [[0],[10],[10],[20],[999]], ordered: true },
  { sql: 'SELECT name FROM people ORDER BY 1 NULLS LAST', rows: [['Alice'],['Bob'],['alice'],['Élodie'],[null]], ordered: true },
  { sql: 'SELECT name FROM (SELECT name FROM people ORDER BY 1 NULLS LAST LIMIT 3) AS ordered_names', rows: [['Alice'],['Bob'],['alice']], ordered: true },
  { sql: 'SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC NULLS FIRST, id) AS rn FROM people ORDER BY rn', rows: [[2,1],[3,2],[1,3],[4,4],[5,5]], ordered: true },
  { sql: "SELECT id FROM people WHERE name ILIKE 'AL%' ORDER BY id", rows: [[1],[4]], ordered: true },
  { sql: "SELECT id FROM people WHERE name NOT ILIKE 'AL%' ORDER BY id", rows: [[2],[3]], ordered: true },
  { sql: 'SELECT DISTINCT score FROM people ORDER BY 1 NULLS LAST', rows: [[0],[10],[20],[null]], ordered: true },
  { sql: 'WITH totals AS (SELECT department_id, SUM(score) AS total FROM people GROUP BY department_id) SELECT d.name, t.total FROM department d LEFT JOIN totals t ON t.department_id = d.id ORDER BY d.id', rows: [['Engineering',10],['Sales',20],['Empty',null]], ordered: true },
  { sql: 'SELECT d.name, COUNT(p.id) AS n FROM department d LEFT JOIN people p ON p.department_id = d.id GROUP BY d.id, d.name ORDER BY d.id', rows: [['Engineering',2],['Sales',2],['Empty',0]], ordered: true },
  { sql: 'SELECT id, SUM(score) OVER (PARTITION BY department_id ORDER BY id) FROM people ORDER BY id', rows: [[1,10],[2,10],[3,20],[4,10],[5,20]], ordered: true },
  { sql: 'WITH labels (n, v) AS (SELECT name, score FROM people WHERE id < 3) SELECT n, v FROM labels ORDER BY n', rows: [['Alice',10],['Bob',null]], ordered: true },
  { sql: 'SELECT id FROM people WHERE department_id IS NOT DISTINCT FROM NULL ORDER BY id', rows: [[4]] },
  { sql: "SELECT EXTRACT(ISODOW FROM DATE '2024-03-03'), EXTRACT(WEEK FROM DATE '2023-01-01')", rows: [[7,52]] },
  { sql: "SELECT EXTRACT(ISOYEAR FROM DATE '2023-01-01'), EXTRACT(ISOYEAR FROM DATE '2024-12-30')", rows: [[2022,2025]] },
  { sql: "SELECT SPLIT_PART('a.b.c', '.', 2), SPLIT_PART('a.b.c', '.', -1), SPLIT_PART('a', '.', 3)", rows: [['b','c','']] },
  { sql: "SELECT SPLIT_PART('a.b.c', '.', 0)", reject: /field.*zero/i },
  { sql: "SELECT BTRIM('xyxtrimyyx', 'xyz'), BTRIM('  x  ')", rows: [['trim','x']] },
  { sql: "SELECT SUBSTRING('Thomas' FOR 2)", rows: [['Th']] },
];

export const PROBES = [{ label: 'PostgreSQL adversarial regressions', def, cases }];
