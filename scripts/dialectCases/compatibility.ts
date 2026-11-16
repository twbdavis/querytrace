/* Compatibility fixtures for aggregate FILTER, named windows, ROWS frames,
   TOP ... WITH TIES, Oracle ROWNUM narrowing, dialect profiles and coverage
   labels. Every expected result is hand-computed from the vendor semantics
   cited in docs/browser-sql-compatibility-plan.md; none is copied from
   SQLite's own output. */
import type { SchemaDef } from '../../lib/schemas';
import type { Case } from '../dialectHarness';

const def: SchemaDef = {
  id: 'custom',
  name: 'Compatibility fixtures',
  description: 'Filtered aggregates, window frames and tied rankings.',
  starterQuery: 'SELECT * FROM sale',
  ddl: `
    CREATE TABLE sale (id INTEGER PRIMARY KEY, grp TEXT NOT NULL, x INTEGER, p INTEGER NOT NULL, amount INTEGER NOT NULL);
    INSERT INTO sale VALUES
      (1, 'a', 1, 1, 10), (2, 'a', 1, 1, 20), (3, 'a', NULL, 1, 30), (4, 'a', 2, 0, 40),
      (5, 'b', 5, 0, 50), (6, 'b', 6, 0, 60);
    CREATE TABLE score (id INTEGER PRIMARY KEY, player TEXT NOT NULL, points INTEGER NOT NULL, team TEXT NOT NULL);
    INSERT INTO score VALUES (1, 'Ann', 100, 'red'), (2, 'Bo', 90, 'red'), (3, 'Cy', 90, 'blue'), (4, 'Di', 80, 'blue');
    CREATE TABLE tally (id INTEGER PRIMARY KEY, rows INTEGER NOT NULL, range INTEGER NOT NULL, groups TEXT NOT NULL);
    INSERT INTO tally VALUES (1, 10, 5, 'a'), (2, 20, 5, 'a'), (3, 30, 7, 'b');
  `,
};

/* ---- Aggregate FILTER ------------------------------------------------------
   Rows with p = 1 are ids 1, 2, 3 with x = 1, 1, NULL. Group b has none. */
const filterCases: Case[] = [
  {
    sql: 'SELECT COUNT(*) FILTER (WHERE p = 1) AS c_all, COUNT(x) FILTER (WHERE p = 1) AS c_x, SUM(x) FILTER (WHERE p = 1) AS s, AVG(x) FILTER (WHERE p = 1) AS a, COUNT(DISTINCT x) FILTER (WHERE p = 1) AS d FROM sale',
    rows: [[3, 2, 2, 1, 1]], columns: ['c_all', 'c_x', 's', 'a', 'd'], coverage: 'detailed', features: ['filter'],
    note: 'COUNT(x) still skips NULL after the filter; the plan fixture',
  },
  { sql: 'SELECT grp, COUNT(*) FILTER (WHERE p = 1) AS n, SUM(x) FILTER (WHERE p = 1) AS s FROM sale GROUP BY grp ORDER BY grp', rows: [['a', 3, 2], ['b', 0, null]], ordered: true, coverage: 'detailed', lineage: true, note: 'An empty filtered count is 0; an empty filtered SUM is NULL; the group stays' },
  { sql: 'SELECT grp, COUNT(*) FILTER (WHERE p = 1) AS yes, COUNT(*) FILTER (WHERE p = 0) AS no FROM sale GROUP BY grp ORDER BY grp', rows: [['a', 3, 1], ['b', 0, 2]], ordered: true, note: 'Two differently filtered aggregates in one row' },
  { sql: 'SELECT MIN(amount) FILTER (WHERE p = 0) AS lo, MAX(amount) FILTER (WHERE p = 1) AS hi FROM sale', rows: [[40, 30]] },
  { sql: 'SELECT SUM(amount) FILTER (WHERE p = 9) AS none FROM sale', rows: [[null]], note: 'No row matches: NULL, not 0' },
  { sql: 'SELECT COUNT(*) FILTER (WHERE x = 1) AS n FROM sale', rows: [[2]], note: 'A NULL predicate excludes the row like a WHERE would' },
  { sql: 'SELECT COUNT(*) FILTER (WHERE p = 1) AS n FROM sale WHERE id > 1', rows: [[2]], note: 'The filter applies after the outer WHERE' },
  { sql: 'SELECT grp FROM sale GROUP BY grp HAVING COUNT(*) FILTER (WHERE p = 1) > 0', rows: [['a']] },
  { sql: "SELECT GROUP_CONCAT(x ORDER BY id DESC) FILTER (WHERE p = 1) AS xs FROM sale", rows: [['1,1']], note: 'Ordered aggregate under a filter; NULL x is skipped' },
  { sql: 'SELECT id, COUNT(*) FILTER (WHERE p = 1) OVER (PARTITION BY grp) AS n FROM sale ORDER BY id', rows: [[1, 3], [2, 3], [3, 3], [4, 3], [5, 0], [6, 0]], ordered: true, features: ['filter', 'window'], note: 'Filtered window aggregate' },
  { sql: 'SELECT grp FROM (SELECT grp, COUNT(*) FILTER (WHERE p = 1) AS n FROM sale GROUP BY grp) t WHERE n = 0', rows: [['b']], coverage: 'components', lineage: false, note: 'Nested scope' },
  { sql: "SELECT COUNT(*) FILTER (WHERE grp = 'FILTER (WHERE') AS n FROM sale", rows: [[0]], note: 'Literal text is never rewritten' },
  { sql: 'SELECT COUNT(*) FILTER (WHERE p = 1) AS n FROM sale WHERE 0', rows: [[0]], note: 'Empty input' },
  { sql: 'SELECT ABS(x) FILTER (WHERE p = 1) FROM sale', reject: /FILTER/ },
  { sql: 'SELECT ROW_NUMBER() FILTER (WHERE p = 1) OVER (ORDER BY id) FROM sale', reject: /FILTER/ },
  { sql: 'SELECT COUNT(*) FILTER (WHERE) FROM sale', reject: /condition/ },
];

/* ---- ROWS frames -----------------------------------------------------------
   amount by id: 10, 20, 30, 40 (grp a), 50, 60 (grp b). */
const frameCases: Case[] = [
  { sql: 'SELECT id, SUM(amount) OVER (ORDER BY id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS s FROM sale WHERE id <= 3 ORDER BY id', rows: [[1, 10], [2, 30], [3, 50]], ordered: true, coverage: 'detailed', features: ['window', 'window-frame'], note: 'The plan fixture' },
  { sql: 'SELECT id, SUM(amount) OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS s FROM sale WHERE id <= 3 ORDER BY id', rows: [[1, 10], [2, 30], [3, 60]], ordered: true },
  { sql: 'SELECT id, SUM(amount) OVER (PARTITION BY grp ORDER BY id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS s FROM sale ORDER BY id', rows: [[1, 10], [2, 30], [3, 50], [4, 70], [5, 50], [6, 110]], ordered: true, note: 'Partition edges clip the frame' },
  { sql: 'SELECT id, AVG(amount) OVER (ORDER BY id ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) AS moving FROM sale ORDER BY id', rows: [[1, 15], [2, 20], [3, 30], [4, 40], [5, 50], [6, 55]], ordered: true },
  { sql: "SELECT id, SUM(amount) OVER (ORDER BY id ROWS BETWEEN 1 FOLLOWING AND 2 FOLLOWING) AS ahead FROM sale WHERE grp = 'a' ORDER BY id", rows: [[1, 50], [2, 70], [3, 40], [4, null]], ordered: true, note: 'Forward and empty frames' },
  { sql: 'SELECT id, SUM(amount) OVER (ORDER BY id ROWS UNBOUNDED PRECEDING) AS running FROM sale ORDER BY id', rows: [[1, 10], [2, 30], [3, 60], [4, 100], [5, 150], [6, 210]], ordered: true, note: 'Short frame form' },
  { sql: 'SELECT id, SUM(amount) OVER (ORDER BY id ROWS 1 PRECEDING) AS s FROM sale ORDER BY id', rows: [[1, 10], [2, 30], [3, 50], [4, 70], [5, 90], [6, 110]], ordered: true },
  { sql: 'SELECT id, SUM(amount) OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running FROM sale ORDER BY id DESC', rows: [[6, 210], [5, 150], [4, 100], [3, 60], [2, 30], [1, 10]], ordered: true, note: 'Final ORDER BY differs from the window order' },
  { sql: "SELECT id, SUM(amount) OVER (ORDER BY p, id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS s FROM sale WHERE grp = 'a' ORDER BY id", rows: [[1, 50], [2, 30], [3, 50], [4, 40]], ordered: true, note: 'Duplicate sort values are ordered by the tie-breaker the query names' },
  { sql: 'SELECT id, SUM(x) OVER (ORDER BY id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS s FROM sale ORDER BY id', rows: [[1, 1], [2, 2], [3, 1], [4, 2], [5, 7], [6, 11]], ordered: true, note: 'NULL arguments are skipped inside the frame' },
  { sql: "SELECT id, LAST_VALUE(amount) OVER (ORDER BY id ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING) AS nxt FROM sale WHERE grp = 'a' ORDER BY id", rows: [[1, 20], [2, 30], [3, 40], [4, 40]], ordered: true, note: 'Frame-sensitive value function' },
  { sql: 'SELECT grp, SUM(SUM(amount)) OVER (ORDER BY grp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative FROM sale GROUP BY grp ORDER BY grp', rows: [['a', 100], ['b', 210]], ordered: true, note: 'Window computed after grouping' },
  { sql: 'SELECT id, SUM(amount) OVER (ORDER BY id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS s, SUM(amount) OVER (PARTITION BY grp ORDER BY id) AS implicit FROM sale ORDER BY id', rows: [[1, 10, 10], [2, 30, 30], [3, 50, 60], [4, 70, 100], [5, 90, 50], [6, 110, 110]], ordered: true, note: 'An explicit frame beside an implicit one leaves the implicit default alone' },
  { sql: 'SELECT id, SUM(amount) OVER (ORDER BY id RANGE BETWEEN 1 PRECEDING AND CURRENT ROW) FROM sale', reject: /RANGE/ },
  { sql: 'SELECT id, SUM(amount) OVER (ORDER BY id GROUPS BETWEEN 1 PRECEDING AND CURRENT ROW) FROM sale', reject: /GROUPS/ },
  { sql: 'SELECT id, SUM(amount) OVER (ORDER BY id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW EXCLUDE CURRENT ROW) FROM sale', reject: /EXCLUDE/ },
  { sql: 'SELECT id, SUM(amount) OVER (PARTITION BY grp ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) FROM sale', reject: /ORDER BY/ },
  { sql: 'SELECT id, SUM(amount) OVER (ORDER BY id ROWS BETWEEN CURRENT ROW AND 1 PRECEDING) FROM sale', reject: /ends before/ },
  { sql: 'SELECT id, ROW_NUMBER() OVER (ORDER BY id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) FROM sale', reject: /ignores a window frame/ },
  { sql: 'SELECT id, SUM(amount) OVER (ORDER BY id ROWS BETWEEN 1 PRECEDING AND UNBOUNDED PRECEDING) FROM sale', reject: /not valid|ends before/ },
  // ROWS, RANGE and GROUPS are legal column names; only the keyword after a complete sort item starts a frame.
  { sql: 'SELECT id, SUM(rows) OVER (ORDER BY rows) AS s FROM tally ORDER BY id', rows: [[1, 10], [2, 30], [3, 60]], ordered: true, note: 'A column named rows is not a frame' },
  { sql: 'SELECT id, SUM(rows) OVER (PARTITION BY groups ORDER BY range, id) AS s FROM tally ORDER BY id', rows: [[1, 10], [2, 30], [3, 30]], ordered: true, note: 'Columns named groups and range' },
  { sql: 'SELECT id, SUM(rows) OVER (ORDER BY rows ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS s FROM tally ORDER BY id', rows: [[1, 10], [2, 30], [3, 50]], ordered: true, features: ['window', 'window-frame'], note: 'The column, then the frame keyword' },
  { sql: 'SELECT id, SUM(rows) OVER (PARTITION BY groups ORDER BY t.range DESC, rows ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS s FROM tally t ORDER BY id', rows: [[1, 10], [2, 30], [3, 30]], ordered: true },
  { sql: 'SELECT id, SUM(rows) OVER (ORDER BY rows RANGE BETWEEN 1 PRECEDING AND CURRENT ROW) FROM tally', reject: /RANGE/, note: 'A real RANGE frame after a column named rows is still refused' },
];

/* ---- Named windows ---------------------------------------------------------- */
const namedWindowCases: Case[] = [
  { sql: 'SELECT id, SUM(amount) OVER w AS s FROM sale WINDOW w AS (PARTITION BY grp ORDER BY id) ORDER BY id', rows: [[1, 10], [2, 30], [3, 60], [4, 100], [5, 50], [6, 110]], ordered: true, coverage: 'detailed', features: ['named-window', 'window'] },
  { sql: 'SELECT id, SUM(amount) OVER w AS s, COUNT(*) OVER w AS n FROM sale WINDOW w AS (PARTITION BY grp ORDER BY id) ORDER BY id', rows: [[1, 10, 1], [2, 30, 2], [3, 60, 3], [4, 100, 4], [5, 50, 1], [6, 110, 2]], ordered: true, note: 'Repeated use' },
  { sql: 'SELECT id, SUM(amount) OVER w AS s FROM sale WINDOW w AS (ORDER BY id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) ORDER BY id', rows: [[1, 10], [2, 30], [3, 50], [4, 70], [5, 90], [6, 110]], ordered: true, features: ['named-window', 'window-frame'], note: 'Definition with frame' },
  { sql: 'SELECT id, COUNT(*) OVER w AS n, SUM(amount) OVER v AS s FROM sale WINDOW w AS (PARTITION BY grp), v AS (ORDER BY id) ORDER BY id', rows: [[1, 4, 10], [2, 4, 30], [3, 4, 60], [4, 4, 100], [5, 2, 150], [6, 2, 210]], ordered: true, note: 'Two definitions' },
  { sql: 'SELECT grp, SUM(amount) AS total, RANK() OVER w AS r FROM sale GROUP BY grp WINDOW w AS (ORDER BY SUM(amount) DESC) ORDER BY grp', rows: [['a', 100, 2], ['b', 110, 1]], ordered: true, note: 'WINDOW clause after GROUP BY' },
  { sql: 'SELECT id, s, COUNT(*) OVER w AS n FROM (SELECT id, SUM(amount) OVER w AS s FROM sale WINDOW w AS (ORDER BY id)) t WINDOW w AS (PARTITION BY id) ORDER BY id', rows: [[1, 10, 1], [2, 30, 1], [3, 60, 1], [4, 100, 1], [5, 150, 1], [6, 210, 1]], ordered: true, coverage: 'components', note: 'The same name means something different in each scope' },
  { sql: "SELECT 'OVER w' AS t, COUNT(*) OVER w AS n FROM sale WHERE grp = 'b' WINDOW w AS (PARTITION BY grp)", rows: [['OVER w', 2], ['OVER w', 2]], note: 'Literal text is never rewritten' },
  { sql: 'SELECT id, SUM(amount) OVER w AS s FROM sale WINDOW w AS () ORDER BY id', rows: [[1, 210], [2, 210], [3, 210], [4, 210], [5, 210], [6, 210]], ordered: true, note: 'Empty specification' },
  { sql: 'SELECT id, SUM(amount) OVER v AS s FROM sale WINDOW w AS (ORDER BY id)', reject: /not defined/ },
  { sql: 'SELECT id, SUM(amount) OVER w AS s FROM sale WINDOW w AS (ORDER BY id), w AS (PARTITION BY grp)', reject: /twice/ },
  { sql: 'SELECT id, SUM(amount) OVER w2 AS s FROM sale WINDOW w AS (PARTITION BY grp), w2 AS (w ORDER BY id)', reject: /inheritance/ },
  { sql: 'SELECT id, SUM(amount) OVER (w ORDER BY id) AS s FROM sale WINDOW w AS (PARTITION BY grp)', reject: /inheritance/ },
  { sql: 'SELECT id FROM (SELECT id FROM sale WINDOW w AS (ORDER BY id)) t WHERE SUM(amount) OVER w > 0', reject: true, note: 'A nested definition is not visible outside its scope' },
];

/* ---- TOP n WITH TIES (SQL Server) ------------------------------------------
   points desc: Ann 100, Bo 90, Cy 90, Di 80. */
const tiesCases: Case[] = [
  { sql: 'SELECT TOP 2 WITH TIES player FROM score ORDER BY points DESC', rows: [['Ann'], ['Bo'], ['Cy']], dialect: 'sqlserver', coverage: 'components', lineage: false, features: ['top-with-ties'], note: 'Boundary tie keeps both 90s' },
  { sql: 'SELECT TOP 3 WITH TIES player FROM score ORDER BY points DESC', rows: [['Ann'], ['Bo'], ['Cy']], dialect: 'sqlserver', note: 'RANK, not DENSE_RANK: Di (80) is rank 4' },
  { sql: 'SELECT TOP 1 WITH TIES player FROM score ORDER BY points DESC', rows: [['Ann']], dialect: 'sqlserver' },
  { sql: 'SELECT TOP 0 WITH TIES player FROM score ORDER BY points DESC', rows: [], dialect: 'sqlserver' },
  { sql: 'SELECT TOP 10 WITH TIES player FROM score ORDER BY points DESC', count: 4, dialect: 'sqlserver', note: 'Fewer than n rows' },
  { sql: 'SELECT TOP 2 player FROM score ORDER BY points DESC', count: 2, dialect: 'sqlserver', note: 'Without WITH TIES the limit is exact' },
  { sql: 'SELECT TOP 1 WITH TIES player FROM score ORDER BY team', rows: [['Cy'], ['Di']], dialect: 'sqlserver', note: 'Tie on a text key' },
  { sql: 'SELECT TOP 2 WITH TIES player FROM score ORDER BY team, points DESC', rows: [['Cy'], ['Di']], dialect: 'sqlserver', note: 'Multiple sort keys, no tie at the boundary' },
  { sql: 'SELECT TOP 2 WITH TIES player, points AS pts FROM score ORDER BY pts DESC', rows: [['Ann', 100], ['Bo', 90], ['Cy', 90]], columns: ['player', 'pts'], dialect: 'sqlserver', note: 'Alias in ORDER BY' },
  { sql: 'SELECT TOP 2 WITH TIES player, points FROM score ORDER BY 2 DESC', rows: [['Ann', 100], ['Bo', 90], ['Cy', 90]], columns: ['player', 'points'], dialect: 'sqlserver', note: 'Position in ORDER BY' },
  { sql: 'SELECT TOP 2 WITH TIES player, points * 2 FROM score ORDER BY points DESC', rows: [['Ann', 200], ['Bo', 180], ['Cy', 180]], dialect: 'sqlserver', note: 'Unaliased expression keeps a column of its own' },
  { sql: 'SELECT TOP 2 WITH TIES * FROM score ORDER BY points DESC', rows: [[1, 'Ann', 100, 'red'], [2, 'Bo', 90, 'red'], [3, 'Cy', 90, 'blue']], columns: ['id', 'player', 'points', 'team'], dialect: 'sqlserver' },
  { sql: 'SELECT TOP 1 WITH TIES s.player FROM score s ORDER BY s.points DESC', rows: [['Ann']], dialect: 'sqlserver' },
  { sql: 'SELECT TOP 1 WITH TIES team, MAX(points) AS best FROM score GROUP BY team ORDER BY best DESC', rows: [['red', 100]], dialect: 'sqlserver' },
  { sql: 'SELECT TOP 1 WITH TIES team, COUNT(*) AS n FROM score GROUP BY team ORDER BY n DESC', rows: [['blue', 2], ['red', 2]], dialect: 'sqlserver', note: 'Grouped tie' },
  { sql: 'SELECT TOP 2 WITH TIES player FROM score ORDER BY points DESC', rows: [['Ann'], ['Bo'], ['Cy']], note: 'The legacy profile reads T-SQL too' },
  { sql: 'SELECT TOP 2 WITH TIES player FROM score', reject: /ORDER BY/, dialect: 'sqlserver' },
  { sql: 'SELECT DISTINCT TOP 2 WITH TIES team FROM score ORDER BY team', reject: /DISTINCT/, dialect: 'sqlserver' },
  { sql: 'SELECT TOP 2 WITH TIES player FROM score ORDER BY points DESC OFFSET 1 ROWS', reject: /OFFSET|FETCH|LIMIT/, dialect: 'sqlserver' },
];

/* ---- Oracle ROWNUM ------------------------------------------------------------ */
const rownumCases: Case[] = [
  { sql: 'SELECT player FROM score WHERE ROWNUM <= 2 ORDER BY points', reject: /ROWNUM/, dialect: 'oracle', note: 'ROWNUM is numbered before ORDER BY sorts' },
  { sql: 'SELECT * FROM (SELECT player FROM score ORDER BY points, player) t WHERE ROWNUM <= 2', rows: [['Di'], ['Bo']], ordered: true, dialect: 'oracle', note: 'The nested form is exact' },
  { sql: 'SELECT player FROM score WHERE ROWNUM <= 2', count: 2, dialect: 'oracle' },
];

/* ---- Profiles change interpretation ------------------------------------------ */
const profileCases: Case[] = [
  { sql: "SELECT 'x' + 'y' AS s", rows: [['xy']], dialect: 'sqlserver' },
  { sql: "SELECT 'x' + 'y' AS s", rows: [['xy']], dialect: 'legacy' },
  { sql: "SELECT 'x' + 'y' AS s", rows: [[0]], dialect: 'mysql', note: 'MySQL adds the numeric values of the strings' },
  { sql: "SELECT 'x' + 'y' AS s", rows: [[0]], dialect: 'postgresql', note: 'No concatenation heuristic outside SQL Server' },
  { sql: 'SELECT [player] FROM score WHERE id = 1', rows: [['Ann']], dialect: 'sqlserver' },
  { sql: 'SELECT [player] FROM score WHERE id = 1', rows: [['Ann']], dialect: 'legacy' },
  { sql: 'SELECT [player] FROM score WHERE id = 1', reject: /bracket/i, dialect: 'postgresql' },
  { sql: 'SELECT [player] FROM score WHERE id = 1', reject: /bracket/i, dialect: 'mysql' },
  { sql: 'SELECT 1 AS n # trailing comment', rows: [[1]], dialect: 'mysql' },
  { sql: 'SELECT 1 AS n # trailing comment', rows: [[1]], dialect: 'legacy' },
  { sql: 'SELECT 1 AS n # trailing comment', reject: true, dialect: 'postgresql' },
  { sql: "SELECT 'It\\'s' AS t", rows: [["It's"]], dialect: 'mysql' },
  { sql: "SELECT 'It\\'s' AS t", rows: [["It's"]], dialect: 'mariadb' },
  { sql: "SELECT 'It\\'s' AS t", rows: [["It's"]], dialect: 'legacy' },
  { sql: "SELECT 'It\\'s' AS t", reject: true, dialect: 'postgresql', note: "Standard strings: the literal ends at the second quote and the rest is a syntax error" },
  { sql: "SELECT 'a\\\\b' AS t", rows: [['a\\b']], dialect: 'mysql', note: 'A doubled backslash is one backslash in MySQL' },
  { sql: "SELECT 'a\\\\b' AS t", rows: [['a\\\\b']], dialect: 'postgresql', note: 'Backslashes are ordinary characters in standard strings' },
  { sql: "SELECT 'C:\\new\\table' AS p", rows: [['C:\\new\\table']], dialect: 'postgresql', note: 'The parser must not turn \\n and \\t into control characters' },
  { sql: "SELECT 'C:\\new\\table' AS p", rows: [['C:\\new\\table']], dialect: 'sqlite' },
  { sql: "SELECT 'C:\\new\\table' AS p", rows: [['C:\new\table']], dialect: 'mysql', note: 'MySQL reads \\n and \\t as newline and tab' },
  { sql: "SELECT p FROM (SELECT 'a\\b' AS p) t WHERE p = 'a\\b'", rows: [['a\\b']], dialect: 'postgresql', note: 'Literal survives the derived-table serializer' },
  { sql: "SELECT player FROM score WHERE team <> 'red\\'", rows: [['Ann'], ['Bo'], ['Cy'], ['Di']], dialect: 'sqlite', note: "A literal ending in a backslash is still a complete literal" },
  { sql: 'SELECT player FROM score WHERE id = 1', rows: [['Ann']], dialect: 'sqlite' },
  { sql: 'SELECT player FROM score WHERE id = 1', rows: [['Ann']], dialect: 'oracle' },
];

/* ---- Coverage labels ------------------------------------------------------------ */
const coverageCases: Case[] = [
  { sql: 'SELECT player FROM score WHERE points > 85', coverage: 'detailed', lineage: true, count: 3 },
  { sql: 'WITH top AS (SELECT player, points FROM score WHERE points > 85) SELECT player FROM top', coverage: 'components', lineage: false, features: ['cte'], count: 3 },
  { sql: 'SELECT player FROM (SELECT player, points FROM score) t WHERE points > 85', coverage: 'components', lineage: false, features: ['derived-table'], count: 3 },
  { sql: 'SELECT player FROM score WHERE id = 1 UNION SELECT player FROM score WHERE id = 2', coverage: 'components', lineage: false, features: ['compound'], count: 2 },
  { sql: 'SELECT player FROM score WHERE id = 1 INTERSECT SELECT player FROM score WHERE id = 1', coverage: 'components', lineage: false, features: ['compound'], count: 1 },
  { sql: 'SELECT 1 + 1 AS two', coverage: 'result-only', lineage: false, rows: [[2]] },
  { sql: 'SELECT player, RANK() OVER (ORDER BY points DESC) AS r FROM score', coverage: 'detailed', lineage: true, features: ['window'], count: 4 },
  { sql: 'SELECT player FROM score WHERE points = (SELECT MAX(points) FROM score)', coverage: 'detailed', features: ['subquery'], rows: [['Ann']] },
  { sql: "INSERT INTO score VALUES (5, 'Ed', 70, 'red')", coverage: 'detailed', ok: true },
  { sql: 'DELETE FROM score WHERE id = 5', coverage: 'detailed', ok: true },
  { sql: "SELECT QT_FRAME('ROWS') FROM score", reject: /reserved/ },
  { sql: 'SELECT QT_FILTER(COUNT(*), 1) FROM score', reject: /reserved/ },
  { sql: 'SELECT QT_ORDERED_GROUP_CONCAT(0, player) FROM score', reject: /reserved/ },
];

export const PROBES = [
  { label: 'compat aggregate FILTER', def, cases: filterCases },
  { label: 'compat ROWS frames', def, cases: frameCases },
  { label: 'compat named windows', def, cases: namedWindowCases },
  { label: 'compat TOP WITH TIES', def, cases: tiesCases },
  { label: 'compat Oracle ROWNUM', def, cases: rownumCases },
  { label: 'compat dialect profiles', def, cases: profileCases },
  { label: 'compat coverage labels', def, cases: coverageCases },
];
