import type { SchemaDef } from '../../lib/schemas';
import type { Case } from '../testDialects';

const cases: Case[] = [
  { sql: "SELECT CHAR_LENGTH('😀x') AS chars, CHARACTER_LENGTH('😀x') AS chars2", rows: [[2, 2]], note: 'Characters are Unicode code points, not UTF-16 units' },
  { sql: "SELECT CHAR_LENGTH(NULL) AS missing, CHAR_LENGTH('') AS empty", rows: [[null, 0]] },
  { sql: "SELECT LEFT('😀x', 1) AS first, RIGHT('x😀', 1) AS last", rows: [['😀', '😀']] },
  { sql: "SELECT LEFT('😀x', 0) AS first, RIGHT('x😀', 0) AS last", rows: [['', '']] },
  { sql: "SELECT LEFT('😀x', 10) AS first, RIGHT('x😀', 10) AS last", rows: [['😀x', 'x😀']] },
  { sql: "SELECT LEFT(NULL, 1) AS first, RIGHT('x😀', NULL) AS last", rows: [[null, null]] },
  { sql: "SELECT MID('a😀b', 2, 1) AS middle, MID('a😀b', -2, 1) AS backwards", rows: [['😀', '😀']] },
  { sql: "SELECT MID('a😀b', 3, 1) AS last, MID('a😀b', 2, 2) AS tail", rows: [['b', '😀b']] },
  { sql: "SELECT MID('a😀b', 0, 2) AS zero, MID('a😀b', 2, 0) AS empty", rows: [['', '']] },
  { sql: "SELECT MID('a😀b', -4, 2) AS before_start, MID('a😀b', 4, 2) AS after_end", rows: [['', '']] },
  { sql: "SELECT LOCATE('x', '😀x') AS pos, LOCATE('😀', 'a😀b😀', 3) AS after_start", rows: [[2, 4]] },
  { sql: "SELECT LOCATE('x', '😀x😀x', 3) AS after_start, LOCATE('z', '😀x') AS missing", rows: [[4, 0]] },
  { sql: "SELECT LOCATE(NULL, '😀x') AS missing, LOCATE('x', NULL) AS missing2", rows: [[null, null]] },
  { sql: "SELECT CHARINDEX('x', '😀X') AS pos, LEN('😀x  ') AS chars", rows: [[2, 2]] },
  { sql: "SELECT LPAD('x', 4, NULL) AS l, RPAD('x', 4, NULL) AS r", rows: [[null, null]] },
  { sql: "SELECT LPAD(NULL, 4, 'x') AS missing, RPAD('x', NULL, 'x') AS missing2", rows: [[null, null]] },
  { sql: "SELECT LPAD('😀x', 1, 'a') AS l, RPAD('😀x', 1, 'a') AS r", rows: [['😀', '😀']] },
  { sql: "SELECT LPAD('x', 4, '😀a') AS l, RPAD('x', 4, '😀a') AS r", rows: [['😀a😀x', 'x😀a😀']] },
  { sql: "SELECT LPAD('😀', 3) AS l, RPAD('😀', 3) AS r", rows: [['  😀', '😀  ']] },
  { sql: "SELECT LPAD('😀', 0, 'x') AS l, RPAD('😀', 0, 'x') AS r", rows: [['', '']] },
  { sql: 'SELECT 10 * 2 DIV 3 AS whole, 10 * 2 MOD 3 AS remainder', rows: [[6, 2]], note: 'DIV and MOD share left associative precedence with multiplication' },
  { sql: 'SELECT 10 DIV 3 DIV 2 AS chained, 20 MOD 6 DIV 2 AS mixed, 20 DIV 6 MOD 2 AS other', rows: [[1, 1, 1]] },
  { sql: 'SELECT 2 + 10 * 2 DIV 3 AS sum, 10 DIV 2 * 3 AS product', rows: [[8, 15]] },
  { sql: 'SELECT 10 * -2 DIV 3 AS whole, -10 * 2 MOD 3 AS remainder', rows: [[-6, -2]] },
  { sql: 'SELECT 10 DIV -(3) AS grouped_sign, 10 MOD - (3) AS remainder', rows: [[-3, 1]] },
  { sql: 'SELECT 10 DIV (2 + 1) AS grouped_div, 10 MOD (2 + 1) AS grouped_mod, MOD (10, 3) AS fn', rows: [[3, 1, 1]] },
  { sql: 'SELECT 10 / 2 DIV 3 AS whole, (10 + 2) DIV 5 AS grouped', rows: [[1, 2]] },
  { sql: 'SELECT CAST(CAST(5 AS INTEGER) AS INTEGER) AS nested, CAST(12 DIV 5 AS SIGNED) AS whole', rows: [[5, 2]] },
  { sql: 'SELECT id, CHAR_LENGTH(label) AS chars, LEFT(label, 1) AS first FROM unicode_edge ORDER BY id', rows: [[1, 2, '😀'], [2, 3, 'a'], [3, null, null]], ordered: true },
  { sql: "SELECT id, LPAD(label, 4, '😀') AS padded FROM unicode_edge WHERE label IS NOT NULL ORDER BY id", rows: [[1, '😀😀😀x'], [2, '😀a😀b']], ordered: true },
  { sql: 'SELECT id FROM unicode_edge ORDER BY id LIMIT 1, 2', rows: [[2], [3]], ordered: true },
  { sql: "SELECT GROUP_CONCAT(label, ':', id ORDER BY id SEPARATOR '|') AS labels FROM unicode_edge", rows: [['😀x:1|a😀b:2']], note: 'MySQL aggregate expressions concatenate per row and skip NULL rows' },
  { sql: "INSERT INTO unicode_edge (id, label) VALUES (4, '😀z') ON DUPLICATE KEY UPDATE label = VALUES(label)", ok: true },
  { sql: "INSERT INTO unicode_edge (id, label) VALUES (4, '😀q') ON DUPLICATE KEY UPDATE label = VALUES(label)", ok: true },
  { sql: 'SELECT CHAR_LENGTH(label), RIGHT(label, 1) FROM unicode_edge WHERE id = 4', rows: [[2, 'q']] },
  { sql: "UPDATE unicode_edge u SET label = CONCAT_WS('-', LEFT(label, 1), RIGHT(label, 1)) WHERE u.id = 4", ok: true },
  { sql: 'SELECT label FROM unicode_edge WHERE id = 4', rows: [['😀-q']] },
  { sql: 'DELETE FROM unicode_edge u WHERE u.id = 4', ok: true },
  { sql: 'SELECT COUNT(*) FROM unicode_edge', rows: [[3]] },
];

function definition(name: string): SchemaDef {
  return {
    id: 'custom', name, description: '', starterQuery: 'SELECT * FROM unicode_edge',
    ddl: `CREATE TABLE \`unicode_edge\` (\`id\` INT PRIMARY KEY, \`label\` VARCHAR(20)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO \`unicode_edge\` VALUES (1, '😀x'), (2, 'a😀b'), (3, NULL);`,
  };
}

export const PROBES = [
  { label: 'edge MySQL Unicode and arithmetic', def: definition('MySQL edge cases'), cases },
  { label: 'edge MariaDB Unicode and arithmetic', def: definition('MariaDB edge cases'), cases },
];
