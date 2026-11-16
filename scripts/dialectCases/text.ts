/* Text comparison and lexical edge cases under each profile, on a small custom
   schema with letters outside A to Z. Every expected row is hand-computed from
   the vendors' documented behaviour:
     - MySQL, MariaDB and SQL Server ignore letter case in LIKE for every alphabet;
     - PostgreSQL and Oracle compare letter case, and ILIKE / LOWER / UPPER cover every alphabet;
     - SQLite ignores the case of A to Z only, in LIKE, LOWER and UPPER alike.
   The cases of one probe run in order on one connection, which the index
   cases at the end of the first probe rely on. */
import type { Case } from '../dialectHarness';
import type { SchemaDef } from '../../lib/schemas';

const people = `
  CREATE TABLE person (id INTEGER PRIMARY KEY, name TEXT NOT NULL, town TEXT);
  INSERT INTO person VALUES
    (1, 'École', 'Évry'), (2, 'ANNA', 'Århus'), (3, 'bob', NULL),
    (4, 'Ægir', 'oslo'), (5, 'a_b', 'x'), (6, 'Zoë', 'ÜLM');
`;

const textDef: SchemaDef = {
  id: 'custom',
  name: 'Text comparison fixtures',
  description: 'Names and towns with letters outside A to Z.',
  starterQuery: 'SELECT * FROM person',
  ddl: people,
};

/* ---- LIKE, ILIKE, LOWER and UPPER ------------------------------------------- */
const likeCases: Case[] = [
  // Case is ignored in every alphabet.
  { dialect: 'mysql', sql: "SELECT name FROM person WHERE name LIKE 'é%'", rows: [['École']], note: 'é matches É in MySQL' },
  { dialect: 'sqlserver', sql: "SELECT name FROM person WHERE name LIKE '%ÆG%'", rows: [['Ægir']] },
  { dialect: 'mariadb', sql: "SELECT name FROM person WHERE name NOT LIKE 'É%' ORDER BY id", rows: [['ANNA'], ['bob'], ['Ægir'], ['a_b'], ['Zoë']], ordered: true },
  { dialect: 'mysql', sql: "SELECT name FROM person WHERE town LIKE 'å%' OR town LIKE 'OSLO' ORDER BY id", rows: [['ANNA'], ['Ægir']], ordered: true },
  { dialect: 'mysql', sql: "SELECT name FROM person WHERE name LIKE 'zo_'", rows: [['Zoë']], note: '_ is one character, whatever its width in bytes' },
  { dialect: 'mysql', sql: "SELECT name FROM person WHERE name LIKE 'A!_B' ESCAPE '!'", rows: [['a_b']], note: 'ESCAPE with the replaced LIKE' },
  { dialect: 'mysql', sql: "SELECT name FROM person WHERE name LIKE 'a\\_b'", rows: [['a_b']], note: 'The backslash escape MySQL assumes' },
  { dialect: 'mysql', sql: "SELECT name FROM person WHERE name LIKE 'a_b' ORDER BY id", rows: [['a_b']], ordered: true },
  { dialect: 'mysql', sql: "SELECT name FROM person WHERE town LIKE '%' ORDER BY id", rows: [['École'], ['ANNA'], ['Ægir'], ['a_b'], ['Zoë']], ordered: true, note: 'NULL never matches' },
  { dialect: 'mysql', sql: "SELECT name LIKE NULL AS n, 5 LIKE '5' AS five, name LIKE 'an%a' AS anna FROM person WHERE id = 2", rows: [[null, 1, 1]], note: 'NULL in, NULL out; numbers compare as text' },
  { dialect: 'mysql', sql: "SELECT name FROM person WHERE name LIKE 'x' ESCAPE 'ab'", reject: /single character/ },
  { dialect: 'sqlserver', sql: "SELECT name FROM person WHERE name LIKE '%%%b' ORDER BY id", rows: [['bob'], ['a_b']], ordered: true, note: 'Repeated % and a retry after a partial match' },
  // SQLite and the mixed default: A to Z only.
  { dialect: 'sqlite', sql: "SELECT name FROM person WHERE name LIKE 'é%'", rows: [], note: 'SQLite does not fold É' },
  { dialect: 'sqlite', sql: "SELECT name FROM person WHERE name LIKE 'anna'", rows: [['ANNA']] },
  { dialect: 'legacy', sql: "SELECT name FROM person WHERE name LIKE 'é%' OR name LIKE 'anna'", rows: [['ANNA']], note: 'Any SQL keeps SQLite’s meaning' },
  // PostgreSQL and Oracle: case matters in LIKE.
  { dialect: 'postgresql', sql: "SELECT name FROM person WHERE name LIKE 'É%'", rows: [['École']] },
  { dialect: 'postgresql', sql: "SELECT name FROM person WHERE name LIKE 'é%'", rows: [] },
  { dialect: 'postgresql', sql: "SELECT name FROM person WHERE name ILIKE 'é%'", rows: [['École']], note: 'ILIKE covers every alphabet' },
  { dialect: 'postgresql', sql: "SELECT name FROM person WHERE name ILIKE '%Ë'", rows: [['Zoë']] },
  { dialect: 'oracle', sql: "SELECT name FROM person WHERE UPPER(name) LIKE 'ÉC%'", rows: [['École']] },
  { dialect: 'oracle', sql: "SELECT name FROM person WHERE name LIKE 'anna'", rows: [] },
  // LOWER and UPPER.
  { dialect: 'postgresql', sql: 'SELECT LOWER(name) AS l, UPPER(town) AS u FROM person WHERE id IN (1, 4) ORDER BY id', rows: [['école', 'ÉVRY'], ['ægir', 'OSLO']], ordered: true },
  { dialect: 'sqlite', sql: 'SELECT LOWER(name) AS l, UPPER(town) AS u FROM person WHERE id = 1', rows: [['École', 'ÉVRY']], note: 'SQLite changes A to Z only' },
  { dialect: 'legacy', sql: 'SELECT LOWER(name) AS l FROM person WHERE id = 1', rows: [['École']] },
  { dialect: 'mysql', sql: "SELECT name FROM person WHERE LOWER(name) = 'école'", rows: [['École']] },
  { dialect: 'sqlserver', sql: "SELECT name FROM person WHERE UPPER(name) = 'ZOË'", rows: [['Zoë']] },
  // The rules follow the request, in either direction, and survive a data change.
  { dialect: 'mysql', sql: "INSERT INTO person VALUES (7, 'Ångström', 'Ås')", ok: true },
  { dialect: 'postgresql', sql: "SELECT name FROM person WHERE name LIKE 'å%'", rows: [] },
  { dialect: 'mysql', sql: "SELECT name FROM person WHERE name LIKE 'å%'", rows: [['Ångström']] },
  { dialect: 'sqlite', sql: "SELECT name FROM person WHERE name LIKE 'å%'", rows: [] },
  { dialect: 'sqlserver', sql: "DELETE FROM person WHERE name LIKE 'ångström'", ok: true },
  { dialect: 'legacy', sql: 'SELECT COUNT(*) AS n FROM person', rows: [[6]] },
  // An index built on LIKE needs SQLite's own function: it can still be created
  // after other modes ran, and from then on LIKE keeps SQLite's meaning here.
  { dialect: 'mysql', sql: "CREATE INDEX person_b ON person (town) WHERE name LIKE 'b%'", ok: true, note: 'Created on a connection whose LIKE had been replaced' },
  { dialect: 'mysql', sql: "SELECT name FROM person WHERE name LIKE 'é%'", rows: [], note: 'Pinned to SQLite’s LIKE by the index' },
  { dialect: 'postgresql', sql: "SELECT name FROM person WHERE name LIKE 'anna'", rows: [['ANNA']], note: 'Pinned: not case-sensitive here' },
  { dialect: 'postgresql', sql: "SELECT name FROM person WHERE name ILIKE 'é%'", rows: [['École']], note: 'ILIKE lower-cases both sides itself, so it is unaffected' },
  { dialect: 'sqlserver', sql: "CREATE INDEX person_c ON person (town) WHERE name LIKE 'c%'", ok: true },
  { dialect: 'sqlite', sql: "INSERT INTO person VALUES (8, 'bea', 'Bonn')", ok: true, note: 'The partial index is maintained with the function it was built on' },
  { dialect: 'mysql', sql: "SELECT name FROM person WHERE name LIKE 'B%' ORDER BY id", rows: [['bob'], ['bea']], ordered: true },
];

/* ---- Reserved names and the private-use stand-in ------------------------------ */
const lexicalCases: Case[] = [
  { dialect: 'mysql', sql: "SELECT 'it\\'s QT_FILTER(1)' AS v", rows: [["it's QT_FILTER(1)"]], note: 'A reserved name inside a MySQL string with an escaped quote is text' },
  { dialect: 'mysql', sql: "SELECT 'QT_FRAME(' AS v", rows: [['QT_FRAME(']] },
  { dialect: 'mysql', sql: 'SELECT QT_FILTER(1) AS v', reject: /reserved by QueryTrace/ },
  { dialect: 'postgresql', sql: 'SELECT id, QT_FRAME(1) FROM person', reject: /reserved by QueryTrace/ },
  { dialect: 'legacy', sql: "SELECT 'ab' AS v, LENGTH('ab') AS n", rows: [['ab', 3]], note: 'A private-use character in the text survives parsing' },
  { dialect: 'legacy', sql: "SELECT 'xy' AS v", rows: [['xy']] },
  { dialect: 'mysql', sql: "SELECT 'a\\\\bc' AS v, LENGTH('a\\\\bc') AS n", rows: [['a\\bc', 5]], note: 'An escaped backslash and the private-use character side by side' },
  { dialect: 'postgresql', sql: "SELECT 'a\\b' AS v", rows: [['a\\b']], note: 'A backslash is an ordinary character in PostgreSQL' },
  { dialect: 'sqlite', sql: "SELECT name FROM person WHERE name = 'a' OR id = 3", rows: [['bob']] },
];

/* ---- CREATE typed in the editor follows the mode ------------------------------ */
const createCases: Case[] = [
  { dialect: 'postgresql', sql: 'CREATE TABLE probe_b ([id] INTEGER PRIMARY KEY)', reject: /\[bracketed\] names are SQL Server syntax, not PostgreSQL/ },
  { dialect: 'postgresql', sql: 'CREATE TABLE probe_c (id INTEGER PRIMARY KEY) # trailing', reject: /# starts a comment in MySQL and MariaDB, not in PostgreSQL/ },
  { dialect: 'oracle', sql: 'CREATE TABLE probe_c ([id] INTEGER PRIMARY KEY)', reject: /not Oracle/ },
  { dialect: 'mysql', sql: 'CREATE TABLE probe_m ([id] INTEGER PRIMARY KEY)', reject: /not MySQL/ },
  { dialect: 'mysql', sql: 'CREATE TABLE probe_a (id INTEGER PRIMARY KEY, note VARCHAR(10) DEFAULT "none") # MySQL comment', ok: true, note: '"none" is a string in MySQL' },
  { dialect: 'mysql', sql: 'INSERT INTO probe_a (id) VALUES (1)', ok: true },
  { dialect: 'mysql', sql: 'SELECT note FROM probe_a', rows: [['none']] },
  { dialect: 'mysql', sql: "CREATE TABLE probe_f (id INTEGER PRIMARY KEY, note VARCHAR(20) DEFAULT 'it\\'s')", ok: true, note: 'Backslash escape in a default' },
  { dialect: 'mysql', sql: 'INSERT INTO probe_f (id) VALUES (1)', ok: true },
  { dialect: 'mysql', sql: 'SELECT note FROM probe_f', rows: [["it's"]] },
  { dialect: 'sqlserver', sql: 'CREATE TABLE probe_d ([id] INTEGER PRIMARY KEY, [full name] VARCHAR(20))', ok: true },
  { dialect: 'sqlserver', sql: "INSERT INTO probe_d VALUES (1, 'Ada Lovelace')", ok: true },
  { dialect: 'sqlserver', sql: 'SELECT [full name] FROM probe_d', rows: [['Ada Lovelace']] },
  { dialect: 'legacy', sql: 'CREATE TABLE probe_e ([id] INTEGER PRIMARY KEY) # the mixed rules still accept both', ok: true },
  { dialect: 'postgresql', sql: 'CREATE TABLE probe_g ("id" INTEGER PRIMARY KEY, "note" VARCHAR(10))', ok: true, note: 'Double quotes are names in PostgreSQL' },
  { dialect: 'postgresql', sql: "INSERT INTO probe_g VALUES (1, 'x')", ok: true },
  { dialect: 'postgresql', sql: 'SELECT "note" FROM probe_g', rows: [['x']] },
];

export const TEXT_PROBES = [
  { label: 'text: LIKE, ILIKE, LOWER and UPPER per profile', def: textDef, cases: likeCases },
  { label: 'text: reserved names and private-use characters', def: textDef, cases: lexicalCases },
  { label: 'text: CREATE follows the mode', def: textDef, cases: createCases },
];
