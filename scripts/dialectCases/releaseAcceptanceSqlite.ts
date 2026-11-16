import type { Case } from '../dialectHarness';

// Fifteen read-only checks on the fictional festival dataset. Any SQL also
// runs these statements because its documented baseline is SQLite semantics.
export const SQLITE_CASES: Case[] = [
  { sql: 'SELECT VENUE_ID, CAPACITY FROM VENUE ORDER BY CAPACITY DESC LIMIT 2 OFFSET 1', rows: [[44, 150], [42, 120]], ordered: true, note: 'Ordered pagination' },
  { sql: 'SELECT SCREENING_ID FROM SCREENING WHERE SCREENING_ID BETWEEN 702 AND 705 AND GENRE IN (\'Comedy\', \'Animation\') ORDER BY SCREENING_ID', rows: [[704], [705]], ordered: true, note: 'Ranges and membership' },
  { sql: 'SELECT a.GIVEN_NAME, r.SEATS FROM ATTENDEE a LEFT JOIN RESERVATION r ON r.ATTENDEE_ID = a.ATTENDEE_ID WHERE r.SCREENING_ID IS NULL', rows: [['Tomas', null]], note: 'Unmatched outer join and NULL' },
  { sql: "SELECT STATUS, SUM(SEATS) AS seats FROM RESERVATION GROUP BY STATUS ORDER BY STATUS", rows: [['Confirmed', 29], ['Waitlist', 3]], ordered: true, note: 'Grouped sums' },
  { sql: 'SELECT GENRE, COUNT(*) AS n FROM SCREENING GROUP BY GENRE HAVING COUNT(*) > 1', rows: [['Documentary', 2]], note: 'Aggregate HAVING' },
  { sql: 'SELECT DISTINCT CITY FROM VENUE ORDER BY CITY', rows: [['Juniper Bay'], ['Lake Arden'], ['Maple Cross'], ['Pine Harbor'], ['Stonebridge']], ordered: true, note: 'Distinct values and sorting' },
  { sql: 'SELECT a.ATTENDEE_ID FROM ATTENDEE a WHERE NOT EXISTS (SELECT 1 FROM RESERVATION r WHERE r.ATTENDEE_ID = a.ATTENDEE_ID)', rows: [[312]], note: 'Correlated anti-subquery' },
  { sql: "SELECT FILM_TITLE FROM SCREENING WHERE SCREENING_ID IN (SELECT SCREENING_ID FROM RESERVATION WHERE STATUS = 'Waitlist') ORDER BY SCREENING_ID", rows: [['Signal from the Attic'], ['Second Breakfast']], ordered: true, note: 'Membership subquery' },
  { sql: 'WITH totals AS (SELECT SCREENING_ID, SUM(SEATS) AS seats FROM RESERVATION GROUP BY SCREENING_ID) SELECT SCREENING_ID, seats FROM totals WHERE seats >= 6 ORDER BY SCREENING_ID', rows: [[703, 6], [706, 7]], ordered: true, note: 'CTE aggregation' },
  { sql: "SELECT CITY FROM VENUE WHERE VENUE_ID = 41 UNION ALL SELECT CITY FROM VENUE WHERE VENUE_ID = 41", rows: [['Juniper Bay'], ['Juniper Bay']], note: 'UNION ALL preserves duplicates' },
  { sql: 'SELECT v.VENUE_ID, v.CAPACITY FROM (SELECT VENUE_ID, CAPACITY FROM VENUE WHERE CAPACITY < 100) v ORDER BY v.VENUE_ID', rows: [[43, 95], [45, 60]], ordered: true, note: 'Derived table' },
  { sql: 'SELECT VENUE_ID, SUM(CAPACITY) OVER (ORDER BY VENUE_ID ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS seats FROM VENUE ORDER BY VENUE_ID', rows: [[41, 180], [42, 300], [43, 215], [44, 245], [45, 210]], ordered: true, note: 'Sliding ROWS frame' },
  { sql: "SELECT COUNT(*) FILTER (WHERE STATUS = 'Waitlist') AS waiting, SUM(SEATS) FILTER (WHERE STATUS = 'Confirmed') AS confirmed FROM RESERVATION", rows: [[2, 29]], note: 'Two independent aggregate filters' },
  { sql: 'SELECT VENUE_ID, ROW_NUMBER() OVER w AS n, SUM(CAPACITY) OVER w AS running FROM VENUE WINDOW w AS (ORDER BY VENUE_ID) ORDER BY VENUE_ID', rows: [[41, 1, 180], [42, 2, 300], [43, 3, 395], [44, 4, 545], [45, 5, 605]], ordered: true, note: 'Shared named window' },
  { sql: "SELECT substr(FILM_TITLE, 1, 6) || ':' || CAST(VENUE_ID AS TEXT) AS ticket FROM SCREENING WHERE SCREENING_ID = 701", rows: [['Paper :41']], note: 'SQLite text functions, cast and concatenation' },
].map((query) => ({ ...query, dialect: 'sqlite' }));

export const LEGACY_CASES: Case[] = SQLITE_CASES.map((query) => ({ ...query, dialect: 'legacy' }));
