import type { Case } from '../dialectHarness';

/** Fifteen independent read-only release queries over the bundled festival data.
 * Expected rows are calculated from the seed records and also checked against
 * PostgreSQL itself by testPostgresDifferential.ts. */
export const POSTGRES_CASES: Case[] = [
  {
    dialect: 'postgresql',
    note: 'Quoted identifiers and ILIKE over a concatenated expression',
    sql: `SELECT "attendee_id" AS "attendee_id", GIVEN_NAME || ' ' || FAMILY_NAME AS "Guest"
FROM "attendee" WHERE GIVEN_NAME || ' ' || FAMILY_NAME ILIKE '%a a%' ORDER BY "attendee_id"`,
    rows: [[301, 'Nia Adebayo']], columns: ['attendee_id', 'Guest'], ordered: true,
  },
  {
    dialect: 'postgresql',
    note: 'Numeric casts prevent integer division before rounding',
    sql: `SELECT VENUE_ID, ROUND(CAPACITY::numeric / 7, 2) AS per_seven
FROM VENUE WHERE VENUE_ID IN (41, 43, 45) ORDER BY VENUE_ID`,
    rows: [[41, 25.71], [43, 13.57], [45, 8.57]], ordered: true,
  },
  {
    dialect: 'postgresql',
    note: 'FILTER on an outer join preserves a guest with no reservations',
    sql: `SELECT a.ATTENDEE_ID, COUNT(r.SCREENING_ID) FILTER (WHERE r.STATUS = 'Confirmed') AS bookings,
SUM(r.SEATS) FILTER (WHERE r.STATUS = 'Confirmed') AS seats
FROM ATTENDEE a LEFT JOIN RESERVATION r ON r.ATTENDEE_ID = a.ATTENDEE_ID
WHERE a.ATTENDEE_ID >= 310 GROUP BY a.ATTENDEE_ID ORDER BY a.ATTENDEE_ID`,
    rows: [[310, 2, 2], [311, 2, 3], [312, 0, null]], ordered: true,
    features: ['filter'],
  },
  {
    dialect: 'postgresql',
    note: 'Two aggregates share a named sliding ROWS window',
    sql: `SELECT VENUE_ID, SUM(CAPACITY) OVER w AS pair_capacity, COUNT(*) OVER w AS members
FROM VENUE WINDOW w AS (ORDER BY VENUE_ID ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
ORDER BY VENUE_ID`,
    rows: [[41, 180, 1], [42, 300, 2], [43, 215, 2], [44, 245, 2], [45, 210, 2]],
    ordered: true, features: ['named-window', 'window-frame'],
  },
  {
    dialect: 'postgresql',
    note: 'A CTE supplies aggregate totals to a ranking window with a tie',
    sql: `WITH totals AS (SELECT ATTENDEE_ID, SUM(SEATS) AS seats FROM RESERVATION
WHERE STATUS = 'Confirmed' GROUP BY ATTENDEE_ID)
SELECT ATTENDEE_ID, seats, DENSE_RANK() OVER (ORDER BY seats DESC) AS place
FROM totals WHERE seats >= 4 ORDER BY seats DESC, ATTENDEE_ID`,
    rows: [[307, 5, 1], [303, 4, 2], [305, 4, 2]], ordered: true,
    features: ['cte', 'window'], coverage: 'components',
  },
  {
    dialect: 'postgresql',
    note: 'Two correlated EXISTS predicates intersect confirmed and waiting guests',
    sql: `SELECT a.ATTENDEE_ID, a.GIVEN_NAME FROM ATTENDEE a
WHERE EXISTS (SELECT 1 FROM RESERVATION r WHERE r.ATTENDEE_ID = a.ATTENDEE_ID AND r.STATUS = 'Waitlist')
AND EXISTS (SELECT 1 FROM RESERVATION c WHERE c.ATTENDEE_ID = a.ATTENDEE_ID AND c.STATUS = 'Confirmed')
ORDER BY a.ATTENDEE_ID`,
    rows: [[302, 'Oskar']], ordered: true,
  },
  {
    dialect: 'postgresql',
    note: 'A grouped derived table joins film names and filters its aggregate alias',
    sql: `SELECT s.FILM_TITLE, totals.seats FROM SCREENING s
JOIN (SELECT SCREENING_ID, SUM(SEATS) AS seats FROM RESERVATION WHERE STATUS = 'Confirmed'
GROUP BY SCREENING_ID) totals ON totals.SCREENING_ID = s.SCREENING_ID
WHERE totals.seats > 5 ORDER BY totals.seats DESC, s.SCREENING_ID`,
    rows: [['Tide Atlas', 7]], ordered: true, coverage: 'components',
  },
  {
    dialect: 'postgresql',
    note: 'Ordered STRING_AGG has a custom separator and a per-aggregate FILTER',
    sql: `SELECT SCREENING_DAY, STRING_AGG(FILM_TITLE, ' | ' ORDER BY SCREENING_ID DESC)
FILTER (WHERE GENRE <> 'Documentary') AS titles
FROM SCREENING GROUP BY SCREENING_DAY ORDER BY SCREENING_DAY`,
    rows: [['Friday', 'Paper Moons'], ['Saturday', 'Kite City | Signal from the Attic'], ['Sunday', 'Second Breakfast']],
    ordered: true, features: ['filter'],
  },
  {
    dialect: 'postgresql',
    note: 'IS NOT DISTINCT FROM handles the null introduced by an outer join',
    sql: `SELECT a.ATTENDEE_ID, a.GIVEN_NAME FROM ATTENDEE a
LEFT JOIN RESERVATION r ON r.ATTENDEE_ID = a.ATTENDEE_ID
WHERE r.SCREENING_ID IS NOT DISTINCT FROM NULL ORDER BY a.ATTENDEE_ID`,
    rows: [[312, 'Tomas']], ordered: true,
  },
  {
    dialect: 'postgresql',
    note: 'NULLS LAST resolves a computed output alias before FETCH FIRST',
    sql: `SELECT VENUE_ID, NULLIF(CAPACITY, 120) AS available
FROM VENUE ORDER BY available NULLS LAST, VENUE_ID FETCH FIRST 5 ROWS ONLY`,
    rows: [[45, 60], [43, 95], [44, 150], [41, 180], [42, null]], ordered: true,
  },
  {
    dialect: 'postgresql',
    note: 'Positive and negative PostgreSQL regex operators combine in one predicate',
    sql: `SELECT ATTENDEE_ID, GIVEN_NAME FROM ATTENDEE
WHERE GIVEN_NAME ~ '^[A-M]' AND GIVEN_NAME !~ 'a$' ORDER BY ATTENDEE_ID`,
    rows: [[303, 'Ines'], [311, 'Jae']], ordered: true,
  },
  {
    dialect: 'postgresql',
    note: 'EXCEPT excludes day-pass attendees who have a waiting reservation',
    sql: `SELECT ATTENDEE_ID FROM ATTENDEE WHERE PASS_TYPE = 'Day'
EXCEPT SELECT ATTENDEE_ID FROM RESERVATION WHERE STATUS = 'Waitlist' ORDER BY ATTENDEE_ID`,
    rows: [[306], [310]], ordered: true, features: ['compound'], coverage: 'components',
  },
  {
    dialect: 'postgresql',
    note: 'SUBSTRING FROM FOR and POSITION IN operate on a table column',
    sql: `SELECT SCREENING_ID, SUBSTRING(FILM_TITLE FROM 1 FOR 4) AS prefix,
POSITION(' ' IN FILM_TITLE) AS first_space FROM SCREENING WHERE SCREENING_ID >= 704 ORDER BY SCREENING_ID`,
    rows: [[704, 'Kite', 5], [705, 'Seco', 7], [706, 'Tide', 5]], ordered: true,
  },
  {
    dialect: 'postgresql',
    note: 'Date arithmetic and EXTRACT share explicit date casts',
    sql: `SELECT VENUE_ID, DATE '2026-11-01' + (VENUE_ID - 41) AS day,
EXTRACT(MONTH FROM '2026-11-01'::date) AS month FROM VENUE WHERE VENUE_ID <= 43 ORDER BY VENUE_ID`,
    rows: [[41, '2026-11-01', 11], [42, '2026-11-02', 11], [43, '2026-11-03', 11]], ordered: true,
  },
  {
    dialect: 'postgresql',
    note: 'Grouped HAVING and deterministic OFFSET FETCH paginate after aggregation',
    sql: `SELECT s.SCREENING_ID, s.FILM_TITLE, SUM(r.SEATS) AS seats
FROM SCREENING s JOIN RESERVATION r ON r.SCREENING_ID = s.SCREENING_ID
WHERE r.STATUS = 'Confirmed' GROUP BY s.SCREENING_ID, s.FILM_TITLE HAVING SUM(r.SEATS) >= 4
ORDER BY seats DESC, s.SCREENING_ID OFFSET 1 ROWS FETCH NEXT 3 ROWS ONLY`,
    rows: [[701, 'Paper Moons', 5], [703, 'Signal from the Attic', 5], [704, 'Kite City', 5]], ordered: true,
  },
];

/** Companion regressions for the date expression bug found by release query 14. */
export const POSTGRES_DATE_REGRESSIONS: Case[] = [
  { dialect: 'postgresql', sql: "SELECT DATE '2026-11-01' + (2 * 3) AS day", rows: [['2026-11-07']] },
  { dialect: 'postgresql', sql: "SELECT DATE '2026-11-10' - (2 * 3) AS day", rows: [['2026-11-04']] },
  { dialect: 'postgresql', sql: "SELECT (2 * 3) + DATE '2026-11-01' AS day", rows: [['2026-11-07']] },
  { dialect: 'postgresql', sql: "SELECT DATE '2026-11-01' + 2 * 3 AS day", rows: [['2026-11-07']] },
  { dialect: 'postgresql', sql: "SELECT 2 * 3 + DATE '2026-11-01' AS day", rows: [['2026-11-07']] },
  { dialect: 'postgresql', sql: "SELECT (DATE '2026-11-01') + 1 + 2 AS day", rows: [['2026-11-04']] },
  { dialect: 'postgresql', sql: "SELECT DATE '2026-11-10' - (VENUE_ID - 41) AS day FROM VENUE WHERE VENUE_ID = 43", rows: [['2026-11-08']] },
  { dialect: 'postgresql', sql: "SELECT DATE '2026-11-01' + VENUE_ID AS day FROM VENUE WHERE VENUE_ID = 41", rows: [['2026-12-12']] },
  { dialect: 'postgresql', sql: "SELECT (DATE '2026-11-10') - (DATE '2026-11-01') AS days", rows: [[9]] },
  { dialect: 'postgresql', sql: "SELECT DATE '2026-11-01' + -(2 * 3) AS day", rows: [['2026-10-26']] },
  { dialect: 'postgresql', sql: "SELECT DATE '2026-11-10' + (DATE '2026-11-03' - DATE '2026-11-01') AS day", rows: [['2026-11-12']] },
  { dialect: 'postgresql', sql: "SELECT DATE '2026-11-01' + (VENUE_ID::integer - 41) AS day FROM VENUE WHERE VENUE_ID = 43", rows: [['2026-11-03']] },
  { dialect: 'postgresql', sql: "SELECT DATE '2026-11-01' + (SELECT 2) AS day", rows: [['2026-11-03']] },
  { dialect: 'postgresql', sql: "SELECT DATE '2026-11-01' + CASE WHEN VENUE_ID = 41 THEN 2 ELSE 3 END AS day FROM VENUE WHERE VENUE_ID = 41", rows: [['2026-11-03']] },
  { dialect: 'postgresql', sql: "SELECT (CASE WHEN VENUE_ID = 41 THEN 2 ELSE 3 END) + DATE '2026-11-01' AS day FROM VENUE WHERE VENUE_ID = 41", rows: [['2026-11-03']] },
  { dialect: 'postgresql', sql: "SELECT CASE WHEN VENUE_ID = 41 THEN CASE WHEN CAPACITY = 180 THEN 2 ELSE 3 END ELSE 4 END + DATE '2026-11-01' AS day FROM VENUE WHERE VENUE_ID = 41", rows: [['2026-11-03']] },
  { dialect: 'postgresql', sql: "SELECT 2 * CASE WHEN VENUE_ID = 41 THEN 2 ELSE 3 END + DATE '2026-11-01' AS day FROM VENUE WHERE VENUE_ID = 41", rows: [['2026-11-05']] },
  { dialect: 'postgresql', sql: "SELECT DATE '2026-11-01' + CASE WHEN VENUE_ID = 41 THEN 2 ELSE 3 END * 2 AS day FROM VENUE WHERE VENUE_ID = 41", rows: [['2026-11-05']] },
];
