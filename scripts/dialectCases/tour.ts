/* Dialect tour: ten to thirty idiomatic queries per source-dialect profile,
   each read under that profile and checked against hand-computed rows from the
   preloaded festival, observatory and marine datasets (lib/schemas.ts). Where a
   plain SQLite spelling of the same query exists it is given as `reference`
   and must return the same rows, so a translation cannot silently drift. The
   last cases of each profile are the refusals that profile must give. */
import type { Case } from '../dialectHarness';

/* Shared expectations ------------------------------------------------------
   Attendees by city, given names sorted:
     Juniper Bay: Ines, Nia, Sol | Lake Arden: Jae, Mira | Maple Cross: Tomas
     Marrow Glen: Luca, Oskar | Pine Harbor: Rami, Thabo | Stonebridge: Freya, Sara
   Venues by capacity desc: Beacon 180, Riverside 150, Foundry 120, Orchard 95, Maple 60.
   Confirmed seats per attendee: 301:3 302:1 303:4 304:2 305:4 306:2 307:5 309:3 310:2 311:3;
   308 only has a waitlist row, 312 has none. */
const NAMES_BY_CITY = (sep: string) => [
  ['Juniper Bay', ['Ines', 'Nia', 'Sol'].join(sep)],
  ['Lake Arden', ['Jae', 'Mira'].join(sep)],
  ['Maple Cross', 'Tomas'],
  ['Marrow Glen', ['Luca', 'Oskar'].join(sep)],
  ['Pine Harbor', ['Rami', 'Thabo'].join(sep)],
  ['Stonebridge', ['Freya', 'Sara'].join(sep)],
];
const NAMES_BY_CITY_REF = "SELECT CITY, GROUP_CONCAT(GIVEN_NAME, ', ' ORDER BY GIVEN_NAME) AS names FROM ATTENDEE GROUP BY CITY ORDER BY CITY";
const SEATS_BY_VENUE: unknown[][] = [['Beacon Theater', 12], ['Foundry Hall', 4], ['Maple Microcinema', 3], ['Orchard Cinema', 5], ['Riverside Screen', 5]];

/* ---- MySQL ----------------------------------------------------------- */
export const mysqlFestival: Case[] = [
  { dialect: 'mysql', sql: 'SELECT `GIVEN_NAME`, `CITY` FROM `ATTENDEE` WHERE `PASS_TYPE` = \'Student\' ORDER BY `GIVEN_NAME`', rows: [['Rami', 'Pine Harbor'], ['Thabo', 'Pine Harbor'], ['Tomas', 'Maple Cross']], ordered: true, reference: "SELECT GIVEN_NAME, CITY FROM ATTENDEE WHERE PASS_TYPE = 'Student' ORDER BY GIVEN_NAME", note: 'Backtick names' },
  { dialect: 'mysql', sql: "SELECT COUNT(*) AS n FROM ATTENDEE WHERE CITY <> 'It\\'s' # a trailing comment", rows: [[12]], note: 'Backslash escape and # comment' },
  { dialect: 'mysql', sql: "SELECT CONCAT(GIVEN_NAME, ' ', FAMILY_NAME) AS full_name FROM ATTENDEE WHERE ATTENDEE_ID = 301", rows: [['Nia Adebayo']], reference: "SELECT GIVEN_NAME || ' ' || FAMILY_NAME AS full_name FROM ATTENDEE WHERE ATTENDEE_ID = 301" },
  { dialect: 'mysql', sql: "SELECT CITY, GROUP_CONCAT(GIVEN_NAME ORDER BY GIVEN_NAME SEPARATOR ', ') AS names FROM ATTENDEE GROUP BY CITY ORDER BY CITY", rows: NAMES_BY_CITY(', '), ordered: true, reference: NAMES_BY_CITY_REF, note: 'GROUP_CONCAT with ORDER BY and SEPARATOR' },
  { dialect: 'mysql', sql: 'SELECT FILM_TITLE FROM SCREENING ORDER BY SCREENING_ID LIMIT 2, 2', rows: [['Signal from the Attic'], ['Kite City']], ordered: true, note: 'LIMIT offset, count' },
  { dialect: 'mysql', sql: "SELECT FILM_TITLE, IF(GENRE = 'Documentary', 'doc', 'other') AS kind FROM SCREENING WHERE VENUE_ID = 41 ORDER BY SCREENING_ID", rows: [['Paper Moons', 'other'], ['Tide Atlas', 'doc']], ordered: true, reference: "SELECT FILM_TITLE, CASE WHEN GENRE = 'Documentary' THEN 'doc' ELSE 'other' END AS kind FROM SCREENING WHERE VENUE_ID = 41 ORDER BY SCREENING_ID", note: 'IF(cond, a, b)' },
  { dialect: 'mysql', sql: 'SELECT a.GIVEN_NAME FROM ATTENDEE a WHERE NOT EXISTS (SELECT 1 FROM RESERVATION r WHERE r.ATTENDEE_ID = a.ATTENDEE_ID) ORDER BY a.GIVEN_NAME', rows: [['Tomas']], note: 'Correlated NOT EXISTS' },
  { dialect: 'mysql', sql: "SELECT v.VENUE_NAME, COALESCE(SUM(r.SEATS), 0) AS seats FROM VENUE v LEFT JOIN SCREENING s ON s.VENUE_ID = v.VENUE_ID LEFT JOIN RESERVATION r ON r.SCREENING_ID = s.SCREENING_ID AND r.STATUS = 'Confirmed' GROUP BY v.VENUE_NAME ORDER BY v.VENUE_NAME", rows: SEATS_BY_VENUE, ordered: true, note: 'Two LEFT JOINs with a filtered join condition' },
  { dialect: 'mysql', sql: 'SELECT SCREENING_ID, SCREENING_ID DIV 100 AS hundreds, SCREENING_ID MOD 7 AS m FROM SCREENING WHERE SCREENING_ID <= 702 ORDER BY SCREENING_ID', rows: [[701, 7, 1], [702, 7, 2]], ordered: true, reference: 'SELECT SCREENING_ID, SCREENING_ID / 100 AS hundreds, SCREENING_ID % 7 AS m FROM SCREENING WHERE SCREENING_ID <= 702 ORDER BY SCREENING_ID', note: 'DIV and MOD operators' },
  { dialect: 'mysql', sql: "SELECT UCASE(SUBSTRING_INDEX(FILM_TITLE, ' ', 1)) AS first_word, CHAR_LENGTH(FILM_TITLE) AS len FROM SCREENING WHERE SCREENING_ID = 703", rows: [['SIGNAL', 21]], note: 'String functions' },
  { dialect: 'mysql', sql: "SELECT GIVEN_NAME FROM ATTENDEE WHERE GIVEN_NAME RLIKE '^[JN]' ORDER BY GIVEN_NAME", rows: [['Jae'], ['Nia']], ordered: true, note: 'RLIKE' },
  { dialect: 'mysql', sql: 'SELECT GENRE, COUNT(*) AS n FROM SCREENING GROUP BY GENRE HAVING n > 1', rows: [['Documentary', 2]], note: 'Alias in HAVING' },
  { dialect: 'mysql', sql: "SELECT ATTENDEE_ID, SUM(SEATS) AS total FROM RESERVATION WHERE STATUS = 'Confirmed' GROUP BY ATTENDEE_ID ORDER BY total DESC, ATTENDEE_ID LIMIT 3", rows: [[307, 5], [303, 4], [305, 4]], ordered: true },
  { dialect: 'mysql', sql: 'SELECT "FILM_TITLE" AS t FROM SCREENING WHERE SCREENING_ID = 705', rows: [['FILM_TITLE']], note: 'MySQL reads "..." as a string literal, so this is the text, not the column' },
  { dialect: 'mysql', sql: 'SELECT COUNT(*) AS "How many" FROM SCREENING', rows: [[6]], columns: ['How many'], note: 'A quoted alias after AS is still a name' },
  { dialect: 'mysql', sql: 'SELECT "say ""hi""" AS s, "it\'s" AS t, "tab\\"quote" AS u', rows: [['say "hi"', "it's", 'tab"quote']], note: 'Doubled quotes, a bare apostrophe and a backslash-escaped quote inside a double-quoted string' },
  { dialect: 'mysql', sql: 'SELECT FILM_TITLE FROM SCREENING WHERE GENRE = "Comedy"', rows: [['Second Breakfast']], reference: "SELECT FILM_TITLE FROM SCREENING WHERE GENRE = 'Comedy'", note: 'Double-quoted comparison value' },
  { dialect: 'mysql', sql: "SELECT FILM_TITLE FROM SCREENING WHERE FILM_TITLE LIKE 'Paper\\_Moons'", rows: [], note: 'Escaped underscore matches a literal underscore only (audit fix)' },
  { dialect: 'mysql', sql: "SELECT FILM_TITLE FROM SCREENING WHERE FILM_TITLE LIKE 'Paper\\_%' OR FILM_TITLE LIKE 'Kite%'", rows: [['Kite City']], note: 'Escaped wildcard in one pattern, free wildcard in another' },
  { dialect: 'mysql', sql: 'SELECT CAST(AVG(CAPACITY) AS DECIMAL(10,1)) AS avg_cap FROM VENUE', rows: [[121]], note: 'DECIMAL scale rounds: 605 / 5 = 121.0' },
  { dialect: 'mysql', sql: "SELECT CAST(VENUE_NAME AS CHAR(6)) AS short FROM VENUE WHERE VENUE_ID = 41", rows: [['Beacon']], note: 'CHAR(n) cuts the text' },
  { dialect: 'mysql', sql: 'SELECT [FILM_TITLE] FROM SCREENING', reject: /bracket|SQL Server/i, note: 'Brackets are not MySQL' },
  { dialect: 'mysql', sql: 'SELECT * FROM (SELECT VENUE_NAME FROM VENUE WHERE CAPACITY > 100)', reject: /alias/i, note: 'MySQL requires an alias on a derived table' },
  // Release fixes: || is OR, GROUP_CONCAT(a, b) joins both values, GREATEST returns NULL on any NULL, LIKE ignores case.
  { dialect: 'mysql', sql: "SELECT 'a' || 'b' AS v, 1 || 0 AS w", rows: [[0, 1]], note: '|| is logical OR in MySQL: two non-numeric strings are both false' },
  { dialect: 'mysql', sql: 'SELECT GIVEN_NAME FROM ATTENDEE WHERE ATTENDEE_ID = 301 || ATTENDEE_ID = 302 ORDER BY ATTENDEE_ID', rows: [['Nia'], ['Oskar']], ordered: true, reference: 'SELECT GIVEN_NAME FROM ATTENDEE WHERE ATTENDEE_ID = 301 OR ATTENDEE_ID = 302 ORDER BY ATTENDEE_ID', note: '|| between two conditions' },
  { dialect: 'mysql', sql: "SELECT GROUP_CONCAT(VENUE_ID, '-' ORDER BY VENUE_ID) AS v FROM VENUE", rows: [['41-,42-,43-,44-,45-']], note: 'GROUP_CONCAT(a, b) joins both values; the separator stays a comma' },
  { dialect: 'mysql', sql: "SELECT GROUP_CONCAT(VENUE_ID, '-') AS v FROM VENUE WHERE VENUE_ID IN (41, 42)", rows: [['41-,42-']] },
  { dialect: 'mysql', sql: 'SELECT GREATEST(1, NULL, 3) AS g, LEAST(4, 2, 9) AS l', rows: [[null, 2]], note: 'MySQL GREATEST is NULL when any argument is NULL' },
  { dialect: 'mysql', sql: "SELECT FILM_TITLE FROM SCREENING WHERE FILM_TITLE LIKE '%the%' ORDER BY SCREENING_ID", rows: [['The Last Pollinator'], ['Signal from the Attic']], ordered: true, note: 'LIKE ignores letter case under the default collation' },
];

export const mysqlObservatory: Case[] = [
  { dialect: 'mysql', sql: "SELECT OBSERVATION_ID, DATE_FORMAT(OBSERVED_ON, '%Y/%m') AS ym FROM OBSERVATION WHERE MONTH(OBSERVED_ON) = 5 ORDER BY OBSERVATION_ID", rows: [[5009, '2026/05'], [5010, '2026/05']], ordered: true, reference: "SELECT OBSERVATION_ID, strftime('%Y/%m', OBSERVED_ON) AS ym FROM OBSERVATION WHERE CAST(strftime('%m', OBSERVED_ON) AS INTEGER) = 5 ORDER BY OBSERVATION_ID" },
  { dialect: 'mysql', sql: 'SELECT DATE_ADD(OBSERVED_ON, INTERVAL 7 DAY) AS later FROM OBSERVATION WHERE OBSERVATION_ID = 5001', rows: [['2026-03-19']], reference: "SELECT date(OBSERVED_ON, '+7 days') AS later FROM OBSERVATION WHERE OBSERVATION_ID = 5001" },
  { dialect: 'mysql', sql: "SELECT DATEDIFF('2026-04-05', '2026-03-12') AS d", rows: [[24]], note: 'MySQL DATEDIFF(later, earlier)' },
  { dialect: 'mysql', sql: 'SELECT OBSERVATION_ID FROM OBSERVATION WHERE YEAR(OBSERVED_ON) = 2026 AND DAYOFMONTH(OBSERVED_ON) > 15 ORDER BY OBSERVATION_ID', rows: [[5003], [5004], [5008]], ordered: true },
];

/* ---- MariaDB --------------------------------------------------------- */
export const mariadbFestival: Case[] = [
  { dialect: 'mariadb', sql: "SELECT `s`.`FILM_TITLE` AS `title` FROM `SCREENING` `s` WHERE `s`.`GENRE` = 'Comedy'", rows: [['Second Breakfast']], columns: ['title'] },
  { dialect: 'mariadb', sql: "SELECT COUNT(*) AS n # how many are waiting\nFROM RESERVATION WHERE STATUS = 'Waitlist'", rows: [[2]], note: '# comment mid-statement' },
  { dialect: 'mariadb', sql: "SELECT COUNT(*) AS n FROM ATTENDEE WHERE FAMILY_NAME <> 'O\\'Neil'", rows: [[12]], note: 'Backslash-escaped quote' },
  { dialect: 'mariadb', sql: 'SELECT GROUP_CONCAT(DISTINCT GENRE ORDER BY GENRE) AS genres FROM SCREENING', rows: [['Animation,Comedy,Documentary,Drama,Thriller']] },
  { dialect: 'mariadb', sql: 'SELECT VENUE_NAME FROM VENUE ORDER BY CAPACITY DESC LIMIT 2 OFFSET 1', rows: [['Riverside Screen'], ['Foundry Hall']], ordered: true },
  { dialect: 'mariadb', sql: "SELECT CONCAT_WS(', ', FAMILY_NAME, GIVEN_NAME) AS who FROM ATTENDEE WHERE ATTENDEE_ID = 305", rows: [['El-Amin, Sara']] },
  { dialect: 'mariadb', sql: "SELECT FILM_TITLE, IFNULL(NULLIF(GENRE, 'Drama'), 'n/a') AS g FROM SCREENING WHERE VENUE_ID = 41 ORDER BY SCREENING_ID", rows: [['Paper Moons', 'n/a'], ['Tide Atlas', 'Documentary']], ordered: true },
  { dialect: 'mariadb', sql: 'SELECT a.GIVEN_NAME, t.total FROM ATTENDEE a JOIN (SELECT ATTENDEE_ID, SUM(SEATS) AS total FROM RESERVATION GROUP BY ATTENDEE_ID) t ON t.ATTENDEE_ID = a.ATTENDEE_ID WHERE t.total >= 4 ORDER BY a.GIVEN_NAME', rows: [['Ines', 4], ['Mira', 5], ['Sara', 4]], ordered: true, coverage: 'components', note: 'Derived table join' },
  { dialect: 'mariadb', sql: 'SELECT 1 + 1 AS two FROM DUAL', rows: [[2]] },
  { dialect: 'mariadb', sql: "SELECT FILM_TITLE, LCASE(GENRE) AS g, LOCATE('e', FILM_TITLE) AS e FROM SCREENING WHERE SCREENING_ID = 702", rows: [['The Last Pollinator', 'documentary', 3]] },
  { dialect: 'mariadb', sql: "SELECT GIVEN_NAME FROM ATTENDEE WHERE GIVEN_NAME REGEXP '^[JN]' ORDER BY GIVEN_NAME", rows: [['Jae'], ['Nia']], ordered: true },
  { dialect: 'mariadb', sql: "SELECT COUNT(*) AS n FROM RESERVATION WHERE STATUS <=> 'Waitlist'", rows: [[2]], note: 'Null-safe equality' },
  { dialect: 'mariadb', sql: 'SELECT VENUE_NAME FROM VENUE WHERE CITY = "Stonebridge"', rows: [['Foundry Hall']], reference: "SELECT VENUE_NAME FROM VENUE WHERE CITY = 'Stonebridge'", note: 'Double-quoted string' },
  { dialect: 'mariadb', sql: 'SELECT "VENUE_NAME" AS v, VENUE_NAME AS "Venue" FROM VENUE WHERE VENUE_ID = 42', rows: [['VENUE_NAME', 'Foundry Hall']], columns: ['v', 'Venue'], note: 'Literal before, name after AS' },
  { dialect: 'mariadb', sql: "INSERT IGNORE INTO VENUE VALUES (41, 'Duplicate', 'Nowhere', 1)", ok: true, note: 'INSERT IGNORE: primary key 41 exists, so nothing changes' },
  { dialect: 'mariadb', sql: 'SELECT COUNT(*) AS n FROM VENUE', rows: [[5]], note: 'The ignored insert left the table alone' },
  { dialect: 'mariadb', sql: 'SELECT 0 || 0 AS none, NULL || 1 AS one', rows: [[0, 1]], note: '|| is logical OR in MariaDB' },
  { dialect: 'mariadb', sql: "SELECT GROUP_CONCAT(DISTINCT CITY, '!' ORDER BY CITY) AS v FROM VENUE", rows: [['Juniper Bay!,Lake Arden!,Maple Cross!,Pine Harbor!,Stonebridge!']], note: 'Both arguments are values' },
];

export const mariadbObservatory: Case[] = [
  { dialect: 'mariadb', sql: 'SELECT OBSERVATION_ID, DAYNAME(OBSERVED_ON) AS d FROM OBSERVATION WHERE OBSERVATION_ID = 5001', rows: [[5001, 'Thursday']], note: '2026-03-12 is a Thursday' },
  { dialect: 'mariadb', sql: "SELECT OBSERVATION_ID FROM OBSERVATION WHERE OBSERVED_ON BETWEEN '2026-04-01' AND '2026-04-30' ORDER BY OBSERVATION_ID", rows: [[5005], [5006], [5007], [5008]], ordered: true },
];

/* ---- PostgreSQL ------------------------------------------------------- */
export const postgresqlFestival: Case[] = [
  { dialect: 'postgresql', sql: "SELECT GIVEN_NAME FROM ATTENDEE WHERE GIVEN_NAME ILIKE 's%' ORDER BY GIVEN_NAME", rows: [['Sara'], ['Sol']], ordered: true },
  { dialect: 'postgresql', sql: 'SELECT "film_title" AS "Film" FROM "screening" WHERE "genre" = \'Thriller\'', rows: [['Signal from the Attic']], columns: ['Film'], note: 'Double-quoted names and alias (lower case, as PostgreSQL stores unquoted names)' },
  { dialect: 'postgresql', sql: "SELECT CAPACITY::TEXT || ' seats' AS label FROM VENUE WHERE VENUE_ID = 45", rows: [['60 seats']], note: ':: cast' },
  { dialect: 'postgresql', sql: "SELECT '12'::INTEGER + 1 AS n", rows: [[13]] },
  { dialect: 'postgresql', sql: "SELECT 'It''s' AS s, LENGTH('a\\b') AS n", rows: [["It's", 3]], note: 'Standard strings: a backslash is a plain character' },
  { dialect: 'postgresql', sql: "SELECT CITY, STRING_AGG(GIVEN_NAME, ', ' ORDER BY GIVEN_NAME) AS names FROM ATTENDEE GROUP BY CITY ORDER BY CITY", rows: NAMES_BY_CITY(', '), ordered: true, reference: NAMES_BY_CITY_REF },
  { dialect: 'postgresql', sql: 'SELECT VENUE_NAME FROM VENUE ORDER BY CAPACITY DESC OFFSET 1 ROWS FETCH FIRST 2 ROWS ONLY', rows: [['Riverside Screen'], ['Foundry Hall']], ordered: true },
  { dialect: 'postgresql', sql: "SELECT GENRE, COUNT(*) FILTER (WHERE SCREENING_DAY = 'Saturday') AS sat FROM SCREENING GROUP BY GENRE ORDER BY GENRE", rows: [['Animation', 1], ['Comedy', 0], ['Documentary', 1], ['Drama', 0], ['Thriller', 1]], ordered: true, features: ['filter'] },
  { dialect: 'postgresql', sql: "SELECT COUNT(*) AS n FROM RESERVATION WHERE STATUS IS DISTINCT FROM 'Confirmed'", rows: [[2]] },
  { dialect: 'postgresql', sql: 'WITH totals AS (SELECT ATTENDEE_ID, SUM(SEATS) AS total FROM RESERVATION GROUP BY ATTENDEE_ID) SELECT ATTENDEE_ID, total, RANK() OVER (ORDER BY total DESC) AS rk FROM totals WHERE total >= 4 ORDER BY rk, ATTENDEE_ID', rows: [[307, 5, 1], [303, 4, 2], [305, 4, 2]], ordered: true, features: ['cte', 'window'] },
  { dialect: 'postgresql', sql: "SELECT SUBSTRING(FILM_TITLE FROM 1 FOR 5) AS s, POSITION('Moon' IN FILM_TITLE) AS p FROM SCREENING WHERE SCREENING_ID = 701", rows: [['Paper', 7]], reference: "SELECT SUBSTR(FILM_TITLE, 1, 5) AS s, INSTR(FILM_TITLE, 'Moon') AS p FROM SCREENING WHERE SCREENING_ID = 701" },
  { dialect: 'postgresql', sql: "SELECT COUNT(*) AS n FROM SCREENING WHERE TRUE AND GENRE <> 'Drama'", rows: [[5]] },
  { dialect: 'postgresql', sql: "SELECT GIVEN_NAME FROM ATTENDEE WHERE GIVEN_NAME ~ '^[JN]' ORDER BY GIVEN_NAME", rows: [['Jae'], ['Nia']], ordered: true, note: '~ regular expression match' },
  { dialect: 'postgresql', sql: "SELECT FILM_TITLE FROM SCREENING WHERE FILM_TITLE LIKE 'Paper\\_Moons'", rows: [], note: 'PostgreSQL LIKE escapes with a backslash by default (audit fix)' },
  { dialect: 'postgresql', sql: "SELECT ROUND(AVG(CAPACITY)::numeric(10,2), 2) AS a, 2.75::numeric(10,1) AS b FROM VENUE", rows: [[121, 2.8]], note: ':: casts with a scale round' },
  { dialect: 'postgresql', sql: "SELECT POSITION(' FROM ' IN 'x FROM y') AS p, SUBSTRING('a FOR b' FROM 3 FOR 3) AS s", rows: [[2, 'FOR']], note: 'Keywords inside string arguments are not clauses (audit fix)' },
  { dialect: 'postgresql', sql: 'SELECT DISTINCT ON (GENRE) GENRE, FILM_TITLE FROM SCREENING ORDER BY GENRE, SCREENING_ID', reject: /DISTINCT ON/i },
  { dialect: 'postgresql', sql: 'SELECT COUNT(*) AS n FROM ATTENDEE # not a comment here', reject: /MySQL/i, note: '# is not a comment in PostgreSQL' },
  { dialect: 'postgresql', sql: 'SELECT [FILM_TITLE] FROM SCREENING', reject: /bracket|SQL Server/i },
  // Release fixes: LIKE compares letter case, ILIKE does not, GREATEST / LEAST skip NULL.
  { dialect: 'postgresql', sql: "SELECT FILM_TITLE FROM SCREENING WHERE FILM_TITLE LIKE '%the%' ORDER BY SCREENING_ID", rows: [['Signal from the Attic']], ordered: true, note: "LIKE is case-sensitive: '%the%' misses The Last Pollinator" },
  { dialect: 'mysql', sql: "SELECT FILM_TITLE FROM SCREENING WHERE FILM_TITLE LIKE '%the%' ORDER BY SCREENING_ID", rows: [['The Last Pollinator'], ['Signal from the Attic']], ordered: true, note: 'The case-sensitive setting does not leak into the next request' },
  { dialect: 'postgresql', sql: "SELECT FILM_TITLE FROM SCREENING WHERE FILM_TITLE LIKE 'The%'", rows: [['The Last Pollinator']] },
  { dialect: 'postgresql', sql: "SELECT FILM_TITLE FROM SCREENING WHERE FILM_TITLE LIKE 'the%'", rows: [] },
  { dialect: 'postgresql', sql: "SELECT FILM_TITLE FROM SCREENING WHERE FILM_TITLE ILIKE '%THE%' ORDER BY SCREENING_ID", rows: [['The Last Pollinator'], ['Signal from the Attic']], ordered: true, note: 'ILIKE folds both sides' },
  { dialect: 'postgresql', sql: "SELECT FILM_TITLE FROM SCREENING WHERE FILM_TITLE NOT ILIKE '%t%' ORDER BY SCREENING_ID", rows: [['Paper Moons']], ordered: true, note: 'NOT ILIKE' },
  { dialect: 'postgresql', sql: "SELECT GIVEN_NAME FROM ATTENDEE WHERE GIVEN_NAME || ' ' || FAMILY_NAME ILIKE 'nia a%'", rows: [['Nia']], note: 'ILIKE over a joined value folds the whole value' },
  { dialect: 'postgresql', sql: 'SELECT GREATEST(1, NULL, 3) AS g, LEAST(NULL, 5, 2) AS l, GREATEST(NULL, NULL) AS n', rows: [[3, 2, null]], note: 'NULL arguments are skipped; all NULL stays NULL' },
  { dialect: 'postgresql', sql: 'SELECT VENUE_ID, GREATEST(CAPACITY) AS g FROM VENUE ORDER BY VENUE_ID', rows: [[41, 180], [42, 120], [43, 95], [44, 150], [45, 60]], ordered: true, note: 'One argument is the value itself, not the MAX aggregate' },
];

export const postgresqlObservatory: Case[] = [
  { dialect: 'postgresql', sql: 'SELECT OBSERVATION_ID FROM OBSERVATION WHERE EXTRACT(MONTH FROM OBSERVED_ON::date) = 4 ORDER BY OBSERVATION_ID', rows: [[5005], [5006], [5007], [5008]], ordered: true },
  { dialect: 'postgresql', sql: "SELECT '2026-04-05'::date - '2026-03-12'::date AS d, OBSERVED_ON::date - '2026-03-01'::date AS since FROM OBSERVATION WHERE OBSERVATION_ID = 5001", rows: [[24, 11]], note: '::date operands in date arithmetic (audit fix)' },
  { dialect: 'postgresql', sql: "SELECT DATE '2026-03-12' + 7 AS later, DATE '2026-04-05' - DATE '2026-03-12' AS d", rows: [['2026-03-19', 24]], note: 'Date arithmetic' },
  { dialect: 'postgresql', sql: "SELECT OBSERVED_ON::date + INTERVAL '1 month' AS later FROM OBSERVATION WHERE OBSERVATION_ID = 5001", rows: [['2026-04-12']] },
];

export const postgresqlMarine: Case[] = [
  { dialect: 'postgresql', sql: 'SELECT COMMON_NAME FROM SPECIES ORDER BY TAG_COLOR NULLS FIRST, COMMON_NAME LIMIT 3', rows: [['Day Octopus'], ['Ribbon Eel'], ['Cleaner Wrasse']], ordered: true, note: 'NULLS FIRST, then the two Blue tags by name' },
];

/* ---- SQL Server ------------------------------------------------------- */
export const sqlserverFestival: Case[] = [
  { dialect: 'sqlserver', sql: 'SELECT TOP 3 VENUE_NAME FROM VENUE ORDER BY CAPACITY DESC', rows: [['Beacon Theater'], ['Riverside Screen'], ['Foundry Hall']], ordered: true, reference: 'SELECT VENUE_NAME FROM VENUE ORDER BY CAPACITY DESC LIMIT 3' },
  { dialect: 'sqlserver', sql: 'SELECT TOP 2 WITH TIES ATTENDEE_ID, SUM(SEATS) AS total FROM RESERVATION GROUP BY ATTENDEE_ID ORDER BY total DESC', rows: [[307, 5], [303, 4], [305, 4]], features: ['top-with-ties'], note: 'Ties with the second row are kept' },
  { dialect: 'sqlserver', sql: "SELECT [FILM_TITLE] AS [Film] FROM [SCREENING] WHERE [GENRE] = 'Comedy'", rows: [['Second Breakfast']], columns: ['Film'] },
  { dialect: 'sqlserver', sql: "SELECT GIVEN_NAME + ' ' + FAMILY_NAME AS full_name FROM ATTENDEE WHERE ATTENDEE_ID = 304", rows: [['Thabo Dlamini']], reference: "SELECT GIVEN_NAME || ' ' || FAMILY_NAME AS full_name FROM ATTENDEE WHERE ATTENDEE_ID = 304", note: '+ joins strings' },
  { dialect: 'sqlserver', sql: "SELECT LEN(FILM_TITLE) AS n, LEFT(FILM_TITLE, 4) AS l, CHARINDEX('City', FILM_TITLE) AS p FROM SCREENING WHERE SCREENING_ID = 704", rows: [[9, 'Kite', 6]] },
  { dialect: 'sqlserver', sql: "SELECT ISNULL(NULLIF(STATUS, 'Waitlist'), 'pending') AS st FROM RESERVATION WHERE ATTENDEE_ID = 308", rows: [['pending']] },
  { dialect: 'sqlserver', sql: "SELECT FILM_TITLE, IIF(SCREENING_DAY = 'Saturday', 1, 0) AS sat FROM SCREENING WHERE VENUE_ID = 41 ORDER BY SCREENING_ID", rows: [['Paper Moons', 0], ['Tide Atlas', 1]], ordered: true },
  { dialect: 'sqlserver', sql: 'SELECT VENUE_NAME FROM VENUE ORDER BY CAPACITY DESC OFFSET 1 ROWS FETCH NEXT 2 ROWS ONLY', rows: [['Riverside Screen'], ['Foundry Hall']], ordered: true },
  { dialect: 'sqlserver', sql: "SELECT COUNT(*) AS n FROM ATTENDEE WITH (NOLOCK) WHERE CITY = N'Juniper Bay'", rows: [[3]], note: 'NOLOCK hint and N-string' },
  { dialect: 'sqlserver', sql: "SELECT CITY, STRING_AGG(GIVEN_NAME, ', ') WITHIN GROUP (ORDER BY GIVEN_NAME) AS names FROM ATTENDEE GROUP BY CITY ORDER BY CITY", rows: NAMES_BY_CITY(', '), ordered: true, reference: NAMES_BY_CITY_REF },
  { dialect: 'sqlserver', sql: 'WITH ranked AS (SELECT FILM_TITLE, ROW_NUMBER() OVER (PARTITION BY SCREENING_DAY ORDER BY CAPACITY DESC) AS rn FROM SCREENING s JOIN VENUE v ON v.VENUE_ID = s.VENUE_ID) SELECT FILM_TITLE FROM ranked WHERE rn = 1 ORDER BY FILM_TITLE', rows: [['Paper Moons'], ['Second Breakfast'], ['Tide Atlas']], ordered: true, note: 'Largest venue per day' },
  { dialect: 'sqlserver', sql: 'SELECT CASE WHEN GETDATE() IS NOT NULL THEN 1 ELSE 0 END AS ok', rows: [[1]] },
  { dialect: 'sqlserver', sql: "SELECT REPLICATE('ab', 2) AS r, LEN('a\\b') AS n", rows: [['abab', 3]], note: 'A backslash is a plain character' },
  { dialect: 'sqlserver', sql: 'SELECT 1 AS x\nGO', rows: [[1]], note: 'Batch separator dropped' },
  { dialect: 'sqlserver', sql: 'SELECT TOP 2 VENUE_NAME FROM VENUE ORDER BY CAPACITY DESC -- the two largest', rows: [['Beacon Theater'], ['Riverside Screen']], ordered: true, note: 'LIMIT lands before the trailing comment (audit fix)' },
  { dialect: 'sqlserver', sql: 'SELECT TOP 2 VENUE_NAME FROM VENUE ORDER BY CAPACITY DESC; -- note', rows: [['Beacon Theater'], ['Riverside Screen']], ordered: true },
  { dialect: 'sqlserver', sql: 'SELECT FILM_TITLE FROM SCREENING WHERE VENUE_ID IN (SELECT TOP 1 VENUE_ID FROM VENUE ORDER BY CAPACITY DESC) ORDER BY SCREENING_ID', rows: [['Paper Moons'], ['Tide Atlas']], ordered: true, note: 'TOP inside a subquery (audit fix)' },
  { dialect: 'sqlserver', sql: 'WITH big AS (SELECT TOP 2 VENUE_ID FROM VENUE ORDER BY CAPACITY DESC) SELECT COUNT(*) AS n FROM SCREENING WHERE VENUE_ID IN (SELECT VENUE_ID FROM big)', rows: [[3]], note: 'TOP inside a CTE: Beacon (2 screenings) and Riverside (1)' },
  { dialect: 'sqlserver', sql: 'SELECT * FROM (SELECT TOP 1 WITH TIES VENUE_NAME FROM VENUE ORDER BY CAPACITY DESC) t', reject: /outer SELECT/i },
  { dialect: 'sqlserver', sql: 'SELECT TOP 2 WITH TIES ATTENDEE_ID, SUM(SEATS) AS total FROM RESERVATION GROUP BY ATTENDEE_ID ORDER BY total DESC', features: ['top-with-ties'], count: 3, note: 'Coverage reports the learner constructs only' },
  { dialect: 'sqlserver', sql: 'SELECT TOP 1 WITH TIES VENUE_NAME AS __qt_rank FROM VENUE ORDER BY CAPACITY DESC', reject: /reserved/i },
  { dialect: 'sqlserver', sql: 'SELECT CAST(2.345 AS DECIMAL(5,2)) AS d, CAST(123.456 AS NUMERIC(6,0)) AS n', rows: [[2.35, 123]], note: 'DECIMAL(p, s) rounds to s places (audit fix)' },
  { dialect: 'sqlserver', sql: 'SELECT COUNT(*) AS n FROM ATTENDEE # not a comment here', reject: /MySQL/i },
  { dialect: 'sqlserver', sql: 'SELECT TOP 2 VENUE_NAME FROM VENUE ORDER BY CAPACITY DESC LIMIT 1', reject: /TOP|LIMIT/i, note: 'TOP and LIMIT together are refused' },
  // Release fixes: GREATEST / LEAST skip NULL (SQL Server 2022), WITH TIES refuses a window sort key with a way forward.
  { dialect: 'sqlserver', sql: 'SELECT GREATEST(1, NULL, 3) AS g, LEAST(NULL, 5, 2) AS l', rows: [[3, 2]], note: 'NULL arguments are skipped' },
  { dialect: 'sqlserver', sql: "SELECT FILM_TITLE FROM SCREENING WHERE FILM_TITLE LIKE '%the%' ORDER BY SCREENING_ID", rows: [['The Last Pollinator'], ['Signal from the Attic']], ordered: true, note: 'LIKE ignores letter case under the default collation' },
  { dialect: 'sqlserver', sql: 'SELECT TOP 2 WITH TIES GIVEN_NAME, RANK() OVER (ORDER BY ATTENDEE_ID) AS r FROM ATTENDEE ORDER BY r', reject: /cannot be ordered by a window function/ },
  { dialect: 'sqlserver', sql: 'SELECT TOP 2 WITH TIES GIVEN_NAME, r FROM (SELECT GIVEN_NAME, RANK() OVER (ORDER BY CITY) AS r FROM ATTENDEE) AS ranked ORDER BY r', rows: [['Ines', 1], ['Nia', 1], ['Sol', 1]], note: 'The spelling the refusal recommends: three attendees tie on the first city' },
];

export const sqlserverObservatory: Case[] = [
  { dialect: 'sqlserver', sql: 'SELECT DATEADD(day, 7, OBSERVED_ON) AS later, DATEPART(month, OBSERVED_ON) AS m FROM OBSERVATION WHERE OBSERVATION_ID = 5001', rows: [['2026-03-19', 3]] },
  { dialect: 'sqlserver', sql: "SELECT DATEDIFF(day, '2026-03-12', '2026-04-05') AS d", rows: [[24]], note: 'SQL Server DATEDIFF(unit, start, end)' },
  { dialect: 'sqlserver', sql: "SELECT TOP 1 OBSERVATION_ID, DATENAME(month, OBSERVED_ON) AS m FROM OBSERVATION WHERE OBSERVED_ON >= '2026-05-01' ORDER BY OBSERVATION_ID", rows: [[5009, 'May']] },
];

/* ---- Oracle ------------------------------------------------------------ */
export const oracleFestival: Case[] = [
  { dialect: 'oracle', sql: 'SELECT 1 + 1 AS two FROM DUAL', rows: [[2]] },
  { dialect: 'oracle', sql: "SELECT NVL(NULLIF(STATUS, 'Waitlist'), 'pending') AS st FROM RESERVATION WHERE ATTENDEE_ID = 308", rows: [['pending']] },
  { dialect: 'oracle', sql: "SELECT DECODE(GENRE, 'Drama', 'D', 'Comedy', 'C', 'X') AS code FROM SCREENING WHERE VENUE_ID = 45", rows: [['C']], reference: "SELECT CASE GENRE WHEN 'Drama' THEN 'D' WHEN 'Comedy' THEN 'C' ELSE 'X' END AS code FROM SCREENING WHERE VENUE_ID = 45" },
  { dialect: 'oracle', sql: 'SELECT GIVEN_NAME || \' \' || FAMILY_NAME AS "Full Name" FROM ATTENDEE WHERE ATTENDEE_ID = 307', rows: [['Mira Gupta']], columns: ['Full Name'] },
  { dialect: 'oracle', sql: 'SELECT * FROM (SELECT VENUE_NAME FROM VENUE ORDER BY CAPACITY DESC) WHERE ROWNUM <= 2', rows: [['Beacon Theater'], ['Riverside Screen']], ordered: true, note: 'Nested ROWNUM: sort first, then number' },
  { dialect: 'oracle', sql: 'SELECT VENUE_NAME FROM VENUE WHERE ROWNUM <= 2 ORDER BY CAPACITY DESC', reject: /ROWNUM/i, note: 'ROWNUM before ORDER BY would number unsorted rows' },
  { dialect: 'oracle', sql: 'SELECT VENUE_NAME FROM VENUE ORDER BY CAPACITY DESC FETCH FIRST 2 ROWS ONLY', rows: [['Beacon Theater'], ['Riverside Screen']], ordered: true },
  { dialect: 'oracle', sql: "SELECT CITY, LISTAGG(GIVEN_NAME, ', ') WITHIN GROUP (ORDER BY GIVEN_NAME) AS names FROM ATTENDEE GROUP BY CITY ORDER BY CITY", rows: NAMES_BY_CITY(', '), ordered: true, reference: NAMES_BY_CITY_REF },
  { dialect: 'oracle', sql: "SELECT INITCAP('paper moons') AS t, INSTR('Paper Moons', 'Moon') AS p, LENGTH('Kite City') AS n FROM DUAL", rows: [['Paper Moons', 7, 9]] },
  { dialect: 'oracle', sql: 'SELECT CITY FROM ATTENDEE MINUS SELECT CITY FROM VENUE', rows: [['Marrow Glen']], reference: 'SELECT CITY FROM ATTENDEE EXCEPT SELECT CITY FROM VENUE' },
  { dialect: 'oracle', sql: 'SELECT TRUNC(12.75) AS t, MOD(17, 5) AS m FROM DUAL', rows: [[12, 2]] },
  { dialect: 'oracle', sql: 'SELECT CASE WHEN SYSDATE IS NOT NULL THEN 1 ELSE 0 END AS ok FROM DUAL', rows: [[1]] },
  { dialect: 'oracle', sql: "SELECT FILM_TITLE, DENSE_RANK() OVER (ORDER BY GENRE) AS g FROM SCREENING WHERE SCREENING_DAY = 'Saturday' ORDER BY g, FILM_TITLE", rows: [['Kite City', 1], ['Tide Atlas', 2], ['Signal from the Attic', 3]], ordered: true, features: ['window'] },
  { dialect: 'oracle', sql: "SELECT 'It''s' AS s, LENGTH('a\\b') AS n FROM DUAL", rows: [["It's", 3]] },
  { dialect: 'oracle', sql: 'SELECT CAST(AVG(CAPACITY) AS NUMBER(10,2)) AS a FROM VENUE', rows: [[121]], note: 'NUMBER(p, s) rounds' },
  { dialect: 'oracle', sql: 'SELECT VENUE_NAME FROM VENUE WHERE ROWNUM <= 1 -- first', count: 1, note: 'ROWNUM LIMIT lands before the trailing comment' },
  { dialect: 'oracle', sql: 'SELECT [FILM_TITLE] FROM SCREENING', reject: /bracket|SQL Server/i },
  { dialect: 'oracle', sql: 'SELECT COUNT(*) AS n FROM ATTENDEE # not a comment here', reject: /MySQL/i },
  // Release fixes: LIKE compares letter case, ROWNUM on a change is refused in plain words.
  { dialect: 'oracle', sql: "SELECT FILM_TITLE FROM SCREENING WHERE FILM_TITLE LIKE '%the%' ORDER BY SCREENING_ID", rows: [['Signal from the Attic']], ordered: true, note: 'LIKE is case-sensitive' },
  { dialect: 'oracle', sql: "SELECT FILM_TITLE FROM SCREENING WHERE UPPER(FILM_TITLE) LIKE '%THE%' ORDER BY SCREENING_ID", rows: [['The Last Pollinator'], ['Signal from the Attic']], ordered: true, note: 'The Oracle way to ignore case' },
  { dialect: 'oracle', sql: 'SELECT GREATEST(1, NULL, 3) AS g FROM VENUE WHERE VENUE_ID = 41', rows: [[null]], note: 'Oracle GREATEST is NULL when any argument is NULL' },
  { dialect: 'oracle', sql: 'DELETE FROM RESERVATION WHERE ROWNUM <= 2', reject: /ROWNUM in a DELETE or UPDATE is not supported/ },
  { dialect: 'oracle', sql: "UPDATE VENUE SET CAPACITY = 0 WHERE CITY = 'Juniper Bay' AND ROWNUM <= 1", reject: /ROWNUM in a DELETE or UPDATE is not supported/ },
];

export const oracleObservatory: Case[] = [
  { dialect: 'oracle', sql: "SELECT TO_CHAR(TO_DATE(OBSERVED_ON, 'YYYY-MM-DD'), 'MM/YYYY') AS my FROM OBSERVATION WHERE OBSERVATION_ID = 5003", rows: [['03/2026']] },
  { dialect: 'oracle', sql: "SELECT ADD_MONTHS(DATE '2026-03-12', 1) AS m, MONTHS_BETWEEN(DATE '2026-05-12', DATE '2026-03-12') AS b FROM DUAL", rows: [['2026-04-12', 2]] },
  { dialect: 'oracle', sql: "SELECT TRUNC(TO_DATE('2026-03-12 14:30', 'YYYY-MM-DD HH24:MI')) AS d, TRUNC(OBSERVED_ON, 'MM') AS m, TRUNC(OBSERVED_ON, 'YYYY') AS y FROM OBSERVATION WHERE OBSERVATION_ID = 5003", rows: [['2026-03-12', '2026-03-01', '2026-01-01']], note: 'Oracle TRUNC on dates (audit fix)' },
  { dialect: 'oracle', sql: 'SELECT COUNT(*) AS n FROM OBSERVATION WHERE OBSERVED_ON >= TRUNC(SYSDATE) - 36500', rows: [[10]], note: 'TRUNC(SYSDATE) is a date, so the filter keeps rows' },
  { dialect: 'oracle', sql: 'SELECT TRUNC(12.75) AS t, TRUNC(12.75, 1) AS t1 FROM DUAL', rows: [[12, 12.7]], note: 'Numeric TRUNC is unchanged' },
  { dialect: 'oracle', sql: "SELECT OBSERVATION_ID FROM OBSERVATION WHERE OBSERVED_ON >= DATE '2026-05-01' ORDER BY OBSERVATION_ID", rows: [[5009], [5010]], ordered: true },
];

export const oracleMarine: Case[] = [
  { dialect: 'oracle', sql: 'SELECT COMMON_NAME FROM SPECIES ORDER BY TAG_COLOR NULLS LAST, COMMON_NAME FETCH FIRST 3 ROWS ONLY', rows: [['Cleaner Wrasse'], ['Manta Ray'], ['Giant Kelp']], ordered: true, note: 'Blue, Blue, Green; NULLs sink' },
];

/* ---- SQLite ------------------------------------------------------------ */
export const sqliteFestival: Case[] = [
  { dialect: 'sqlite', sql: 'SELECT [FILM_TITLE] FROM [SCREENING] WHERE SCREENING_ID = 705', rows: [['Second Breakfast']], note: 'SQLite accepts bracket names' },
  { dialect: 'sqlite', sql: "SELECT printf('%03d', VENUE_ID) AS code FROM VENUE WHERE VENUE_ID = 41", rows: [['041']] },
  { dialect: 'sqlite', sql: "SELECT LENGTH('a\\b') AS n", rows: [[3]] },
  { dialect: 'sqlite', sql: "SELECT 'x' + 'y' AS v", rows: [[0]], note: 'Numeric +: text that is not a number adds as 0' },
  { dialect: 'sqlite', sql: 'SELECT FILM_TITLE, LAG(FILM_TITLE) OVER (ORDER BY SCREENING_ID) AS prev FROM SCREENING WHERE VENUE_ID = 41', rows: [['Paper Moons', null], ['Tide Atlas', 'Paper Moons']], features: ['window'] },
  { dialect: 'sqlite', sql: 'SELECT CITY FROM ATTENDEE EXCEPT SELECT CITY FROM VENUE', rows: [['Marrow Glen']] },
  { dialect: 'sqlite', sql: 'SELECT CITY FROM ATTENDEE INTERSECT SELECT CITY FROM VENUE ORDER BY CITY', rows: [['Juniper Bay'], ['Lake Arden'], ['Maple Cross'], ['Pine Harbor'], ['Stonebridge']], ordered: true },
  { dialect: 'sqlite', sql: "SELECT IIF(SEATS > 1, 'group', 'single') AS kind, COUNT(*) AS n FROM RESERVATION GROUP BY 1 ORDER BY 1", rows: [['group', 9], ['single', 14]], ordered: true, note: 'Seats > 1 in 9 of 23 reservations' },
  { dialect: 'sqlite', sql: "SELECT COUNT(*) AS n FROM RESERVATION WHERE STATUS IS NOT 'Confirmed'", rows: [[2]] },
  { dialect: 'sqlite', sql: 'SELECT GENRE, SUM(CAPACITY) AS cap FROM SCREENING s JOIN VENUE v USING (VENUE_ID) GROUP BY GENRE ORDER BY cap DESC LIMIT 1', rows: [['Documentary', 300]], note: 'USING: Foundry 120 + Beacon 180' },
  { dialect: 'sqlite', sql: 'SELECT CITY FROM ATTENDEE UNION ALL SELECT CITY FROM ATTENDEE UNION ALL SELECT CITY FROM ATTENDEE UNION ALL SELECT CITY FROM ATTENDEE', count: 48, note: 'UNION branches are limited one at a time (audit fix)' },
  { dialect: 'sqlite', sql: "SELECT VENUE_NAME, INSTR('a\\b', '\\') AS p FROM VENUE WHERE VENUE_ID = 41", rows: [['Beacon Theater', 2]], note: 'A backslash inside a literal survives the parser' },
  { dialect: 'sqlite', sql: 'SELECT COUNT(*) AS n FROM ATTENDEE # not a comment here', reject: /MySQL/i },
  { dialect: 'sqlite', sql: 'SELECT * FROM (SELECT VENUE_NAME FROM VENUE WHERE CAPACITY > 100) ORDER BY VENUE_NAME', rows: [['Beacon Theater'], ['Foundry Hall'], ['Riverside Screen']], ordered: true, coverage: 'components', note: 'SQLite accepts an unaliased derived table' },
  { dialect: 'sqlite', sql: "SELECT GROUP_CONCAT(VENUE_ID, '-') AS v FROM VENUE WHERE VENUE_ID IN (41, 42)", rows: [['41-42']], note: 'In SQLite the second argument is the separator' },
  { dialect: 'sqlite', sql: "SELECT FILM_TITLE FROM SCREENING WHERE FILM_TITLE LIKE '%the%' ORDER BY SCREENING_ID", rows: [['The Last Pollinator'], ['Signal from the Attic']], ordered: true, note: 'SQLite LIKE ignores ASCII letter case' },
];

export const sqliteObservatory: Case[] = [
  { dialect: 'sqlite', sql: "SELECT strftime('%m', OBSERVED_ON) AS m FROM OBSERVATION WHERE OBSERVATION_ID = 5001", rows: [['03']] },
  { dialect: 'sqlite', sql: "SELECT date(OBSERVED_ON, '+7 days') AS later FROM OBSERVATION WHERE OBSERVATION_ID = 5001", rows: [['2026-03-19']] },
];
