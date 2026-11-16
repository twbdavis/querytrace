import type { Case } from '../dialectHarness';

// Release acceptance uses the unchanged bundled festival data. All expectations
// below are computed from its records, and every case must execute successfully.
export const MYSQL_CASES: Case[] = [
  {
    dialect: 'mysql',
    sql: 'SELECT `FILM_TITLE` AS film FROM `SCREENING` WHERE `GENRE` = "Documentary" ORDER BY `SCREENING_ID` # MySQL comment',
    rows: [['The Last Pollinator'], ['Tide Atlas']], ordered: true,
    note: 'Backtick identifiers, double-quoted strings and a trailing hash comment',
  },
  {
    dialect: 'mysql',
    sql: 'SELECT VENUE_NAME, CAPACITY FROM VENUE ORDER BY CAPACITY DESC LIMIT 2, 2',
    rows: [['Foundry Hall', 120], ['Orchard Cinema', 95]], ordered: true,
    note: 'Offset/count LIMIT after descending order',
  },
  {
    dialect: 'mysql',
    sql: "SELECT CONCAT_WS(', ', FAMILY_NAME, NULL, GIVEN_NAME) AS display_name FROM ATTENDEE ORDER BY ATTENDEE_ID LIMIT 2",
    rows: [['Adebayo, Nia'], ['Berg, Oskar']], ordered: true,
    note: 'CONCAT_WS skips NULL arguments without adding an extra separator',
  },
  {
    dialect: 'mysql',
    sql: "SELECT SCREENING_ID, SUM(IF(STATUS = 'Confirmed', SEATS, 0)) AS confirmed, SUM(IF(STATUS = 'Waitlist', SEATS, 0)) AS waiting FROM RESERVATION WHERE SCREENING_ID IN (703, 705) GROUP BY SCREENING_ID ORDER BY SCREENING_ID",
    rows: [[703, 5, 1], [705, 3, 2]], ordered: true,
    note: 'Independent conditional aggregates retain waitlisted and confirmed seats',
  },
  {
    dialect: 'mysql',
    sql: "SELECT a.ATTENDEE_ID, GROUP_CONCAT(DISTINCT r.STATUS ORDER BY r.STATUS) AS statuses FROM ATTENDEE a LEFT JOIN RESERVATION r ON r.ATTENDEE_ID = a.ATTENDEE_ID WHERE a.ATTENDEE_ID IN (302, 308, 312) GROUP BY a.ATTENDEE_ID ORDER BY a.ATTENDEE_ID",
    rows: [[302, 'Confirmed,Waitlist'], [308, 'Waitlist'], [312, null]], ordered: true,
    note: 'Ordered DISTINCT GROUP_CONCAT preserves a NULL-only outer-join group',
  },
  {
    dialect: 'mysql',
    sql: 'SELECT VENUE_ID, CAPACITY DIV 60 AS full_groups, CAPACITY MOD 60 AS remaining FROM VENUE ORDER BY VENUE_ID',
    rows: [[41, 3, 0], [42, 2, 0], [43, 1, 35], [44, 2, 30], [45, 1, 0]], ordered: true,
    note: 'DIV and MOD cover both exact division and nonzero remainders',
  },
  {
    dialect: 'mysql',
    sql: 'SELECT a.ATTENDEE_ID, a.GIVEN_NAME FROM ATTENDEE a LEFT JOIN RESERVATION r ON r.ATTENDEE_ID = a.ATTENDEE_ID WHERE r.SCREENING_ID <=> NULL ORDER BY a.ATTENDEE_ID',
    rows: [[312, 'Tomas']], ordered: true,
    note: 'Null-safe equality identifies the missing side of a left join',
  },
  {
    dialect: 'mysql',
    sql: "SELECT a.ATTENDEE_ID, IFNULL(SUM(r.SEATS), 0) AS total FROM ATTENDEE a LEFT JOIN RESERVATION r ON r.ATTENDEE_ID = a.ATTENDEE_ID AND r.STATUS = 'Confirmed' GROUP BY a.ATTENDEE_ID HAVING total = 0 ORDER BY a.ATTENDEE_ID",
    rows: [[308, 0], [312, 0]], ordered: true,
    note: 'IFNULL and an aggregate alias in HAVING include both kinds of empty group',
  },
  {
    dialect: 'mysql',
    sql: "SELECT a.ATTENDEE_ID, a.GIVEN_NAME FROM ATTENDEE a WHERE EXISTS (SELECT 1 FROM RESERVATION r JOIN SCREENING s ON s.SCREENING_ID = r.SCREENING_ID WHERE r.ATTENDEE_ID = a.ATTENDEE_ID AND s.GENRE = 'Documentary' AND r.SEATS = 2) ORDER BY a.ATTENDEE_ID",
    rows: [[305, 'Sara'], [307, 'Mira']], ordered: true,
    note: 'Correlated EXISTS with an inner join does not duplicate matching attendees',
  },
  {
    dialect: 'mysql',
    sql: "WITH totals AS (SELECT ATTENDEE_ID, SUM(SEATS) AS total FROM RESERVATION WHERE STATUS = 'Confirmed' GROUP BY ATTENDEE_ID) SELECT ATTENDEE_ID, total FROM totals WHERE total >= 4 ORDER BY total DESC, ATTENDEE_ID",
    rows: [[307, 5], [303, 4], [305, 4]], ordered: true,
    note: 'A grouped CTE exposes aliases to its outer filter and deterministic tie order',
  },
  {
    dialect: 'mysql',
    sql: "SELECT ATTENDEE_ID, ROW_NUMBER() OVER (PARTITION BY CITY ORDER BY ATTENDEE_ID) AS city_position FROM ATTENDEE WHERE CITY = 'Pine Harbor' ORDER BY ATTENDEE_ID",
    rows: [[304, 1], [308, 2]], ordered: true,
    note: 'ROW_NUMBER applies its partition after filtering',
  },
  {
    dialect: 'mysql',
    sql: 'SELECT ATTENDEE_ID, SCREENING_ID, SUM(SEATS) OVER (PARTITION BY ATTENDEE_ID ORDER BY SCREENING_ID ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_seats FROM RESERVATION WHERE ATTENDEE_ID IN (301, 303) ORDER BY ATTENDEE_ID, SCREENING_ID',
    rows: [[301, 701, 2], [301, 706, 3], [303, 701, 1], [303, 703, 3], [303, 706, 4]], ordered: true,
    note: 'An explicit cumulative ROWS frame resets at a partition boundary',
  },
  {
    dialect: 'mysql',
    sql: "SELECT GIVEN_NAME AS name FROM ATTENDEE WHERE PASS_TYPE = 'Student' UNION ALL SELECT GIVEN_NAME AS name FROM ATTENDEE WHERE ATTENDEE_ID = 312 ORDER BY name",
    rows: [['Rami'], ['Thabo'], ['Tomas'], ['Tomas']], ordered: true,
    note: 'UNION ALL preserves duplicates and applies its outer ordering',
  },
  {
    dialect: 'mysql',
    sql: "SELECT SUBSTRING_INDEX(FILM_TITLE, ' ', 1) AS first_word, SUBSTRING_INDEX(FILM_TITLE, ' ', -1) AS last_word, CHAR_LENGTH(FILM_TITLE) AS letters, LOCATE('the', FILM_TITLE) AS position FROM SCREENING WHERE SCREENING_ID = 703",
    rows: [['Signal', 'Attic', 21, 13]],
    note: 'String functions handle negative word counts and one-based positions',
  },
  {
    dialect: 'mysql',
    sql: 'SELECT ATTENDEE_ID, CITY = "Lake Arden" || CITY = "Juniper Bay" AS nearby FROM ATTENDEE WHERE ATTENDEE_ID IN (301, 311, 312) ORDER BY ATTENDEE_ID',
    rows: [[301, 1], [311, 1], [312, 0]], ordered: true,
    note: 'Default MySQL double quotes and pipes mean string literals and logical OR',
  },
];

export const MARIADB_CASES: Case[] = [
  {
    dialect: 'mariadb',
    sql: 'SELECT `ATTENDEE_ID`, `GIVEN_NAME` FROM `ATTENDEE` WHERE `PASS_TYPE` = "All Access" ORDER BY `ATTENDEE_ID` # MariaDB comment',
    rows: [[303, 'Ines'], [307, 'Mira'], [311, 'Jae']], ordered: true,
    note: 'MariaDB identifier, literal and comment rules are applied together',
  },
  {
    dialect: 'mariadb',
    sql: 'SELECT SCREENING_ID, FILM_TITLE FROM SCREENING ORDER BY SCREENING_ID DESC LIMIT 1, 3',
    rows: [[705, 'Second Breakfast'], [704, 'Kite City'], [703, 'Signal from the Attic']], ordered: true,
    note: 'MariaDB LIMIT offset/count returns exactly the requested middle rows',
  },
  {
    dialect: 'mariadb',
    sql: "SELECT ATTENDEE_ID, CONCAT_WS(' / ', GIVEN_NAME, NULLIF(PASS_TYPE, 'Student'), CITY) AS badge FROM ATTENDEE WHERE ATTENDEE_ID IN (303, 304) ORDER BY ATTENDEE_ID",
    rows: [[303, 'Ines / All Access / Juniper Bay'], [304, 'Thabo / Pine Harbor']], ordered: true,
    note: 'Nested NULLIF in CONCAT_WS omits a missing badge field',
  },
  {
    dialect: 'mariadb',
    sql: "SELECT ATTENDEE_ID, SUM(IF(STATUS = 'Waitlist', SEATS, 0)) AS waiting, COUNT(*) AS bookings FROM RESERVATION WHERE ATTENDEE_ID IN (302, 308) GROUP BY ATTENDEE_ID ORDER BY ATTENDEE_ID",
    rows: [[302, 2, 2], [308, 1, 1]], ordered: true,
    note: 'Conditional SUM differs from the count of reservations',
  },
  {
    dialect: 'mariadb',
    sql: "SELECT SCREENING_DAY, GROUP_CONCAT(FILM_TITLE ORDER BY SCREENING_ID DESC SEPARATOR '; ') AS programme FROM SCREENING WHERE SCREENING_DAY <> 'Sunday' GROUP BY SCREENING_DAY ORDER BY SCREENING_DAY",
    rows: [['Friday', 'The Last Pollinator; Paper Moons'], ['Saturday', 'Tide Atlas; Kite City; Signal from the Attic']], ordered: true,
    note: 'GROUP_CONCAT orders each group independently of the final output',
  },
  {
    dialect: 'mariadb',
    sql: 'SELECT VENUE_ID, (CAPACITY + 5) DIV 50 AS blocks, (CAPACITY + 5) MOD 50 AS spare FROM VENUE WHERE VENUE_ID IN (43, 44, 45) ORDER BY VENUE_ID',
    rows: [[43, 2, 0], [44, 3, 5], [45, 1, 15]], ordered: true,
    note: 'DIV and MOD preserve parenthesized arithmetic operands',
  },
  {
    dialect: 'mariadb',
    sql: "SELECT a.ATTENDEE_ID, r.SCREENING_ID <=> NULL AS no_waitlist FROM ATTENDEE a LEFT JOIN RESERVATION r ON r.ATTENDEE_ID = a.ATTENDEE_ID AND r.STATUS = 'Waitlist' WHERE a.ATTENDEE_ID IN (301, 302, 308, 312) ORDER BY a.ATTENDEE_ID",
    rows: [[301, 1], [302, 0], [308, 0], [312, 1]], ordered: true,
    note: 'Null-safe comparison in a projection returns a non-NULL boolean',
  },
  {
    dialect: 'mariadb',
    sql: "SELECT a.ATTENDEE_ID, IFNULL(SUM(r.SEATS), 0) AS booked FROM ATTENDEE a LEFT JOIN RESERVATION r ON r.ATTENDEE_ID = a.ATTENDEE_ID GROUP BY a.ATTENDEE_ID HAVING booked <= 1 ORDER BY a.ATTENDEE_ID",
    rows: [[308, 1], [312, 0]], ordered: true,
    note: 'Aggregate alias filtering retains the empty group and the one-seat group',
  },
  {
    dialect: 'mariadb',
    sql: "SELECT s.SCREENING_ID, s.FILM_TITLE FROM SCREENING s WHERE NOT EXISTS (SELECT 1 FROM RESERVATION r WHERE r.SCREENING_ID = s.SCREENING_ID AND r.STATUS = 'Waitlist') ORDER BY s.SCREENING_ID",
    rows: [[701, 'Paper Moons'], [702, 'The Last Pollinator'], [704, 'Kite City'], [706, 'Tide Atlas']], ordered: true,
    note: 'Correlated NOT EXISTS excludes only screenings that have a waitlist',
  },
  {
    dialect: 'mariadb',
    sql: "WITH confirmed AS (SELECT SCREENING_ID, SUM(SEATS) AS seats FROM RESERVATION WHERE STATUS = 'Confirmed' GROUP BY SCREENING_ID) SELECT s.FILM_TITLE, c.seats FROM confirmed c JOIN SCREENING s ON s.SCREENING_ID = c.SCREENING_ID WHERE c.seats >= 5 ORDER BY c.seats DESC, s.SCREENING_ID",
    rows: [['Tide Atlas', 7], ['Paper Moons', 5], ['Signal from the Attic', 5], ['Kite City', 5]], ordered: true,
    note: 'A grouped CTE can be joined to its base-table metadata',
  },
  {
    dialect: 'mariadb',
    sql: "SELECT SCREENING_ID, DENSE_RANK() OVER (ORDER BY SCREENING_DAY) AS day_rank FROM SCREENING ORDER BY SCREENING_ID",
    rows: [[701, 1], [702, 1], [703, 2], [704, 2], [705, 3], [706, 2]], ordered: true,
    note: 'DENSE_RANK keeps equal days tied without leaving gaps',
  },
  {
    dialect: 'mariadb',
    sql: 'SELECT VENUE_ID, SUM(CAPACITY) OVER (ORDER BY VENUE_ID ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS adjacent_capacity FROM VENUE ORDER BY VENUE_ID',
    rows: [[41, 180], [42, 300], [43, 215], [44, 245], [45, 210]], ordered: true,
    note: 'A sliding ROWS frame clips correctly at the first venue',
  },
  {
    dialect: 'mariadb',
    sql: "SELECT CITY FROM ATTENDEE WHERE PASS_TYPE = 'Student' UNION SELECT CITY FROM VENUE WHERE CAPACITY < 100 ORDER BY CITY",
    rows: [['Maple Cross'], ['Pine Harbor']], ordered: true,
    note: 'UNION removes duplicates both within and between its branches',
  },
  {
    dialect: 'mariadb',
    sql: "SELECT FILM_TITLE, UCASE(LEFT(FILM_TITLE, 4)) AS prefix, RIGHT(FILM_TITLE, 4) AS suffix FROM SCREENING WHERE FILM_TITLE RLIKE '^(Kite|Tide)' ORDER BY SCREENING_ID",
    rows: [['Kite City', 'KITE', 'City'], ['Tide Atlas', 'TIDE', 'tlas']], ordered: true,
    note: 'RLIKE combines with nested case and substring functions',
  },
  {
    dialect: 'mariadb',
    sql: 'SELECT SCREENING_ID, SCREENING_DAY = "Sunday" || GENRE = "Documentary" AS selected FROM SCREENING ORDER BY SCREENING_ID',
    rows: [[701, 0], [702, 1], [703, 0], [704, 0], [705, 1], [706, 1]], ordered: true,
    note: 'Logical pipes use MariaDB default semantics for every matching branch',
  },
];

// These deliberate refusals are checked separately and never count toward the
// fifteen successful executions in either mode.
export const MYSQL_REJECTIONS: Case[] = ['mysql', 'mariadb'].map((dialect) => ({
  dialect: dialect as 'mysql' | 'mariadb',
  sql: "SELECT GROUP_CONCAT(DISTINCT STATUS ORDER BY STATUS SEPARATOR '|') AS statuses FROM RESERVATION",
  reject: /cannot combine DISTINCT with a custom separator/i,
  note: 'An unsupported aggregate combination gives its actionable explanation',
}));
