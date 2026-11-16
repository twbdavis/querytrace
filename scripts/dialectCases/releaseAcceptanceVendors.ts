import type { Case } from '../dialectHarness';

// Release acceptance: every case returns independently calculated rows from
// the bundled festival schema. Rejections are deliberately not counted here.
export const SQLSERVER_CASES: Case[] = [
  {
    dialect: 'sqlserver', note: 'TOP WITH TIES retains the complete aggregate boundary',
    sql: 'SELECT TOP (2) WITH TIES ATTENDEE_ID, SUM(SEATS) AS booked FROM RESERVATION GROUP BY ATTENDEE_ID ORDER BY booked DESC',
    rows: [[307, 5], [303, 4], [305, 4]], features: ['top-with-ties'],
  },
  {
    dialect: 'sqlserver', note: 'Bracketed identifiers and a quoted output alias',
    sql: "SELECT [SCREENING_ID], [FILM_TITLE] AS [Film title] FROM [SCREENING] WHERE [GENRE] IN ('Comedy', 'Animation') ORDER BY [SCREENING_ID]",
    rows: [[704, 'Kite City'], [705, 'Second Breakfast']], ordered: true, columns: ['SCREENING_ID', 'Film title'],
  },
  {
    dialect: 'sqlserver', note: 'Text plus composes columns and literals across a join',
    sql: "SELECT a.GIVEN_NAME + ' / ' + v.VENUE_NAME AS label FROM ATTENDEE a JOIN VENUE v ON a.CITY = v.CITY WHERE a.ATTENDEE_ID IN (301, 307) ORDER BY a.ATTENDEE_ID",
    rows: [['Nia / Beacon Theater'], ['Mira / Riverside Screen']], ordered: true,
  },
  {
    dialect: 'sqlserver', note: 'LEN excludes trailing spaces but preserves a trailing tab',
    sql: "SELECT LEN(GIVEN_NAME + '   ') AS spaces, LEN(GIVEN_NAME + CHAR(9)) AS tab FROM ATTENDEE WHERE ATTENDEE_ID = 301",
    rows: [[3, 4]],
  },
  {
    dialect: 'sqlserver', note: 'CHARINDEX honors its optional starting position and NULL',
    sql: "SELECT CHARINDEX('o', FILM_TITLE, 9) AS later, CHARINDEX('o', FILM_TITLE, 12) AS absent, CHARINDEX('o', FILM_TITLE, -1) AS first_match, CHARINDEX('o', FILM_TITLE, NULL) AS unknown FROM SCREENING WHERE SCREENING_ID = 701",
    rows: [[9, 0, 8, null]],
  },
  {
    dialect: 'sqlserver', note: 'ISNULL preserves an unmatched left-join row',
    sql: 'SELECT a.ATTENDEE_ID, ISNULL(r.SEATS, 0) AS seats FROM ATTENDEE a LEFT JOIN RESERVATION r ON r.ATTENDEE_ID = a.ATTENDEE_ID WHERE a.ATTENDEE_ID = 312',
    rows: [[312, 0]],
  },
  {
    dialect: 'sqlserver', note: 'Conditional aggregation distinguishes waitlist and confirmed seats',
    sql: "SELECT SUM(IIF(STATUS = 'Waitlist', SEATS, 0)) AS waiting, SUM(IIF(STATUS = 'Confirmed', SEATS, 0)) AS confirmed FROM RESERVATION",
    rows: [[3, 29]],
  },
  {
    dialect: 'sqlserver', note: 'OFFSET FETCH preserves deterministic ordering',
    sql: 'SELECT VENUE_ID, CAPACITY FROM VENUE ORDER BY CAPACITY DESC, VENUE_ID OFFSET 2 ROWS FETCH NEXT 2 ROWS ONLY',
    rows: [[42, 120], [43, 95]], ordered: true,
  },
  {
    dialect: 'sqlserver', note: 'Ordered STRING_AGG combines a join and grouping',
    sql: "SELECT v.VENUE_ID, STRING_AGG(s.FILM_TITLE, ' | ') WITHIN GROUP (ORDER BY s.SCREENING_ID DESC) AS films FROM VENUE v JOIN SCREENING s ON s.VENUE_ID = v.VENUE_ID WHERE v.VENUE_ID = 41 GROUP BY v.VENUE_ID",
    rows: [[41, 'Tide Atlas | Paper Moons']],
  },
  {
    dialect: 'sqlserver', note: 'CTE window ranking selects one deterministic result per day',
    sql: 'WITH ranked AS (SELECT SCREENING_DAY, FILM_TITLE, ROW_NUMBER() OVER (PARTITION BY SCREENING_DAY ORDER BY SCREENING_ID DESC) AS rn FROM SCREENING) SELECT SCREENING_DAY, FILM_TITLE FROM ranked WHERE rn = 1 ORDER BY SCREENING_DAY',
    rows: [['Friday', 'The Last Pollinator'], ['Saturday', 'Tide Atlas'], ['Sunday', 'Second Breakfast']], ordered: true,
  },
  {
    dialect: 'sqlserver', note: 'Nested TOP is scoped to its subquery',
    sql: 'SELECT SCREENING_ID, FILM_TITLE FROM SCREENING WHERE VENUE_ID IN (SELECT TOP (2) VENUE_ID FROM VENUE ORDER BY CAPACITY DESC) ORDER BY SCREENING_ID',
    rows: [[701, 'Paper Moons'], [704, 'Kite City'], [706, 'Tide Atlas']], ordered: true,
  },
  {
    dialect: 'sqlserver', note: 'Explicit ROWS frame clips at partition boundaries',
    sql: 'SELECT ATTENDEE_ID, SCREENING_ID, SUM(SEATS) OVER (PARTITION BY ATTENDEE_ID ORDER BY SCREENING_ID ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS rolling FROM RESERVATION WHERE ATTENDEE_ID IN (301, 303) ORDER BY ATTENDEE_ID, SCREENING_ID',
    rows: [[301, 701, 2], [301, 706, 3], [303, 701, 1], [303, 703, 3], [303, 706, 3]], ordered: true, features: ['window-frame'],
  },
  {
    dialect: 'sqlserver', note: 'DECIMAL cast rounds an expression to its declared scale',
    sql: 'SELECT VENUE_ID, CAST(CAPACITY / 8.0 AS DECIMAL(6,1)) AS eighth FROM VENUE WHERE VENUE_ID IN (42, 43) ORDER BY VENUE_ID',
    rows: [[42, 15], [43, 11.9]], ordered: true,
  },
  {
    dialect: 'sqlserver', note: 'EXCEPT removes all duplicates from the left branch',
    sql: 'SELECT FAVORITE_GENRE AS genre FROM ATTENDEE EXCEPT SELECT GENRE FROM SCREENING WHERE SCREENING_DAY = \'Saturday\' ORDER BY genre',
    rows: [['Comedy'], ['Drama']], ordered: true,
  },
  {
    dialect: 'sqlserver', note: 'TOP zero returns the correct empty shape after a join',
    sql: 'SELECT TOP (0) s.SCREENING_ID, v.VENUE_NAME FROM SCREENING s JOIN VENUE v ON v.VENUE_ID = s.VENUE_ID ORDER BY s.SCREENING_ID',
    rows: [], columns: ['SCREENING_ID', 'VENUE_NAME'], ordered: true,
  },
];

export const ORACLE_CASES: Case[] = [
  {
    dialect: 'oracle', note: 'NVL on the missing side of a left join',
    sql: 'SELECT a.ATTENDEE_ID, NVL(r.SEATS, 0) AS seats FROM ATTENDEE a LEFT JOIN RESERVATION r ON r.ATTENDEE_ID = a.ATTENDEE_ID WHERE a.ATTENDEE_ID = 312',
    rows: [[312, 0]],
  },
  {
    dialect: 'oracle', note: 'NVL2 distinguishes matched and unmatched outer-join rows',
    sql: "SELECT a.ATTENDEE_ID, NVL2(r.SEATS, 'booked', 'none') AS state FROM ATTENDEE a LEFT JOIN RESERVATION r ON r.ATTENDEE_ID = a.ATTENDEE_ID AND r.SCREENING_ID = 701 WHERE a.ATTENDEE_ID IN (301, 312) ORDER BY a.ATTENDEE_ID",
    rows: [[301, 'booked'], [312, 'none']], ordered: true,
  },
  {
    dialect: 'oracle', note: 'DECODE matches NULL returned by expressions, not only NULL literals',
    sql: "SELECT ATTENDEE_ID, DECODE(NULLIF(GIVEN_NAME, 'Nia'), NULLIF(FAMILY_NAME, 'Adebayo'), 'same', 'different') AS comparison FROM ATTENDEE WHERE ATTENDEE_ID IN (301, 302) ORDER BY ATTENDEE_ID",
    rows: [[301, 'same'], [302, 'different']], ordered: true,
  },
  {
    dialect: 'oracle', note: 'Concatenation and a quoted output alias preserve spaces',
    sql: 'SELECT GIVEN_NAME || \' \' || FAMILY_NAME AS "Full name" FROM ATTENDEE WHERE ATTENDEE_ID IN (305, 312) ORDER BY ATTENDEE_ID',
    rows: [['Sara El-Amin'], ['Tomas Lopes']], ordered: true, columns: ['Full name'],
  },
  {
    dialect: 'oracle', note: 'Nested ROWNUM limits rows only after the inner ordering',
    sql: 'SELECT VENUE_ID, CAPACITY FROM (SELECT VENUE_ID, CAPACITY FROM VENUE ORDER BY CAPACITY, VENUE_ID) WHERE ROWNUM <= 3',
    rows: [[45, 60], [43, 95], [42, 120]], ordered: true,
  },
  {
    dialect: 'oracle', note: 'OFFSET FETCH combines a filter with deterministic pagination',
    sql: 'SELECT SCREENING_ID, FILM_TITLE FROM SCREENING WHERE VENUE_ID <> 45 ORDER BY SCREENING_ID OFFSET 1 ROWS FETCH NEXT 2 ROWS ONLY',
    rows: [[702, 'The Last Pollinator'], [703, 'Signal from the Attic']], ordered: true,
  },
  {
    dialect: 'oracle', note: 'Ordered LISTAGG groups joined rows in descending order',
    sql: "SELECT v.VENUE_ID, LISTAGG(s.FILM_TITLE, ' / ') WITHIN GROUP (ORDER BY s.SCREENING_ID DESC) AS films FROM VENUE v JOIN SCREENING s ON s.VENUE_ID = v.VENUE_ID WHERE v.VENUE_ID = 41 GROUP BY v.VENUE_ID",
    rows: [[41, 'Tide Atlas / Paper Moons']],
  },
  {
    dialect: 'oracle', note: 'MINUS deduplicates rows while subtracting a filtered branch',
    sql: 'SELECT FAVORITE_GENRE AS genre FROM ATTENDEE MINUS SELECT GENRE FROM SCREENING WHERE SCREENING_DAY = \'Friday\' ORDER BY genre',
    rows: [['Animation'], ['Comedy'], ['Thriller']], ordered: true,
  },
  {
    dialect: 'oracle', note: 'DENSE_RANK preserves equal-key peers without gaps',
    sql: 'SELECT SCREENING_ID, DENSE_RANK() OVER (ORDER BY SCREENING_DAY) AS day_rank FROM SCREENING ORDER BY SCREENING_ID',
    rows: [[701, 1], [702, 1], [703, 2], [704, 2], [705, 3], [706, 2]], ordered: true, features: ['window'],
  },
  {
    dialect: 'oracle', note: 'NUMBER precision and scale apply to arithmetic expressions',
    sql: 'SELECT VENUE_ID, CAST(CAPACITY / 8.0 AS NUMBER(6,1)) AS eighth FROM VENUE WHERE VENUE_ID IN (42, 43) ORDER BY VENUE_ID',
    rows: [[42, 15], [43, 11.9]], ordered: true,
  },
  {
    dialect: 'oracle', note: 'TRIM and SUBSTR compose over column values',
    sql: "SELECT ATTENDEE_ID, TRIM(TRAILING 'a' FROM GIVEN_NAME) AS trimmed, SUBSTR(FAMILY_NAME, -3) AS ending FROM ATTENDEE WHERE ATTENDEE_ID IN (301, 305, 307) ORDER BY ATTENDEE_ID",
    rows: [[301, 'Ni', 'ayo'], [305, 'Sar', 'min'], [307, 'Mir', 'pta']], ordered: true,
  },
  {
    dialect: 'oracle', note: 'REGEXP_LIKE reads anchors and alternation on table data',
    sql: "SELECT ATTENDEE_ID, GIVEN_NAME FROM ATTENDEE WHERE REGEXP_LIKE(GIVEN_NAME, '^(Nia|Mira)$') ORDER BY ATTENDEE_ID",
    rows: [[301, 'Nia'], [307, 'Mira']], ordered: true,
  },
  {
    dialect: 'oracle', note: 'Case-sensitive LIKE and explicit UPPER give different counts',
    sql: "SELECT SUM(CASE WHEN FILM_TITLE LIKE '%the%' THEN 1 ELSE 0 END) AS exact_case, SUM(CASE WHEN UPPER(FILM_TITLE) LIKE '%THE%' THEN 1 ELSE 0 END) AS folded_case FROM SCREENING",
    rows: [[1, 2]],
  },
  {
    dialect: 'oracle', note: 'GREATEST preserves NULL propagated from an outer join',
    sql: 'SELECT a.ATTENDEE_ID, GREATEST(r.SEATS, 2) AS largest FROM ATTENDEE a LEFT JOIN RESERVATION r ON r.ATTENDEE_ID = a.ATTENDEE_ID AND r.SCREENING_ID = 701 WHERE a.ATTENDEE_ID IN (301, 312) ORDER BY a.ATTENDEE_ID',
    rows: [[301, 2], [312, null]], ordered: true,
  },
  {
    dialect: 'oracle', note: 'CTE aggregation and HAVING feed a bounded window frame',
    sql: 'WITH totals AS (SELECT ATTENDEE_ID, SUM(SEATS) AS booked FROM RESERVATION GROUP BY ATTENDEE_ID HAVING SUM(SEATS) >= 4) SELECT ATTENDEE_ID, booked, SUM(booked) OVER (ORDER BY ATTENDEE_ID ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running FROM totals ORDER BY ATTENDEE_ID',
    rows: [[303, 4, 4], [305, 4, 8], [307, 5, 13]], ordered: true, features: ['cte', 'window-frame'],
  },
];

// Focused boundary regressions are additional to the 15-query acceptance sets.
// Contracts: learn.microsoft.com/en-us/sql/t-sql/functions/len-transact-sql,
// learn.microsoft.com/en-us/sql/t-sql/functions/charindex-transact-sql and
// docs.oracle.com/en/database/oracle/oracle-database/26/sqlrf/DECODE.html.
export const VENDOR_REGRESSION_CASES: Case[] = [
  {
    dialect: 'sqlserver', note: 'LEN retains tabs, line feeds and nonbreaking spaces',
    sql: "SELECT LEN('Nia' + CHAR(9)) AS tab, LEN('Nia' + CHAR(10)) AS newline, LEN('Nia' + CHAR(160)) AS nonbreaking, LEN('Nia' + CHAR(9) + '  ') AS tab_spaces",
    rows: [[4, 4, 4, 4]],
  },
  {
    dialect: 'sqlserver', note: 'CHARINDEX handles omitted, zero, negative, NULL and out-of-range positions',
    sql: "SELECT CHARINDEX('o', 'Paper Moons') AS omitted, CHARINDEX('o', 'Paper Moons', 0) AS zero, CHARINDEX('o', 'Paper Moons', -2) AS negative, CHARINDEX('o', 'Paper Moons', NULL) AS null_start, CHARINDEX('o', 'Paper Moons', 99) AS beyond",
    rows: [[8, 8, 8, null, 0]],
  },
  {
    dialect: 'sqlserver', note: 'CHARINDEX returns zero for an empty needle and NULL for NULL input',
    sql: "SELECT CHARINDEX('', 'abc') AS empty_needle, CHARINDEX('', 'abc', 2) AS empty_later, CHARINDEX('', '') AS empty_both, CHARINDEX(NULL, 'abc', 1) AS null_needle, CHARINDEX('a', NULL, 1) AS null_text",
    rows: [[0, 0, 0, null, null]],
  },
  {
    dialect: 'sqlserver', note: 'CHARINDEX counts Unicode characters before the requested start',
    sql: "SELECT CHARINDEX('x', '😀Xx', 2) AS second, CHARINDEX('x', '😀Xx', 3) AS third, CHARINDEX('x', '😀Xx', 4) AS beyond",
    rows: [[2, 3, 0]],
  },
  {
    dialect: 'sqlserver', note: 'CHARINDEX positions refer to original characters when lowercasing expands a letter',
    sql: "SELECT CHARINDEX('x', 'İx') AS omitted, CHARINDEX('x', 'İx', 1) AS first, CHARINDEX('x', 'İx', 2) AS second, CHARINDEX('x', '😀İx', 1) AS supplementary",
    rows: [[2, 2, 2, 3]],
  },
  {
    dialect: 'oracle', note: 'DECODE NULL expression matches preserve first-match and fallback behavior',
    sql: "SELECT DECODE(NULL, NULLIF(1, 1), 'matched', 'fallback') AS null_expr, DECODE(1, NULLIF(1, 1), 'wrong', 1, 'one', 'fallback') AS later, DECODE(NULL, 1, 'wrong', NULL, 'first', NULL, 'second') AS first_null FROM DUAL",
    rows: [['matched', 'one', 'first']],
  },
];
