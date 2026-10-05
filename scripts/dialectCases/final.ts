import type { Case } from '../testDialects';
import { PROBES as ROUND1 } from './exports';

const defOf = (label: string) => ROUND1.find((p) => p.label === label)!.def;

const weekBoundaries = [
  { date: '2026-01-01', weeks: [0, 1, 52, 1, 0, 0, 53, 52] },
  { date: '2025-12-31', weeks: [52, 53, 52, 1, 53, 52, 53, 52] },
  { date: '2023-01-01', weeks: [1, 0, 1, 52, 1, 0, 1, 52] },
];

export const PROBES = [
  {
    label: 'final shop_pg',
    def: defOf('shop_pg'),
    cases: [
      { sql: 'SELECT name, price FROM product WHERE price BETWEEN 10 AND 25 ORDER BY price DESC', rows: [['Saw', 24], ['Hammer', 12.5]], ordered: true },
      { sql: 'SELECT c.name, COALESCE(SUM(p.price), 0) AS total FROM category c LEFT JOIN product p ON p.category_id = c.id GROUP BY c.id, c.name ORDER BY total', rows: [['Empty', 0], ['Tools', 36.5], ['Garden', 37.25]], ordered: true },
      { sql: 'SELECT name, ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY name) AS rn FROM product ORDER BY category_id, rn', rows: [['Hammer', 1], ['Saw', 2], ['Hose', 1], ['Trowel', 2]], ordered: true },
      { sql: "SELECT to_char(updated_at, 'HH24:MI') AS t FROM product WHERE id = 2", rows: [['14:00']] },
      { sql: "SELECT name FROM product WHERE tags IS NOT NULL AND tags <> '{}' ORDER BY id", rows: [['Hammer'], ['Saw'], ['Hose']], ordered: true },
      { sql: 'SELECT added_on + 1 AS later FROM product INTERSECT SELECT added_on + 1 AS later FROM product', rows: [['2025-01-16'], ['2025-03-01'], ['2025-03-02'], ['2026-01-01']], note: 'Both compound branches retain rewrites even when their display note is shared' },
      { sql: 'SELECT added_on + 1 AS later FROM product EXCEPT SELECT added_on + 1 AS later FROM product', rows: [], note: 'Identical rewritten branches cancel out' },
      { sql: "SELECT EXTRACT(WEEK FROM DATE '2025-12-31') AS next_year, EXTRACT(WEEK FROM DATE '2023-01-01') AS prior_year, TO_CHAR(DATE '2023-01-01', 'IW') AS iso_week", rows: [[1, 52, '52']], note: 'PostgreSQL extraction and TO_CHAR retain ISO week numbering' },
    ] as Case[],
  },
  {
    label: 'final school_pma',
    def: defOf('school_pma'),
    cases: [
      { sql: "SELECT WEEK('2008-02-20', 1) AS monday, WEEK('2000-01-01', 2) AS prior_year, WEEK('2008-12-31', 1) AS last_week", rows: [[8, 52, 53]], note: 'Documented MySQL examples distinguish first-week and year-rollover rules' },
      ...weekBoundaries.map(({ date, weeks }) => ({
        sql: `SELECT ${weeks.map((_, mode) => `WEEK('${date}', ${mode}) AS m${mode}`).join(', ')}`,
        rows: [weeks],
        note: 'All eight MySQL WEEK modes at a year boundary',
      })),
      { sql: "SELECT DATE_FORMAT('2023-01-01', '%U/%u/%V/%v') AS sunday_start, DATE_FORMAT('2026-01-01', '%U/%u/%V/%v') AS thursday_start, WEEK(NULL, 3) AS missing_date", rows: [['01/00/01/52', '00/01/52/01', null]] },
      { sql: "SELECT name, TIMESTAMPDIFF(YEAR, enrolled, '2026-10-05') AS yrs FROM students WHERE id = 1", rows: [['Ana Díaz', 2]] },
      { sql: 'SELECT course_code, COUNT(DISTINCT student_id) AS n FROM enrollments GROUP BY course_code HAVING n >= 2', rows: [['CS101', 3]] },
      { sql: "SELECT name FROM students WHERE name LIKE '%a%' AND name NOT LIKE 'A%' ORDER BY 1", rows: [["Ben O'Hara"], ['Cy "The Cat" Lee']], ordered: true },
      { sql: "INSERT INTO courses (code, title) VALUES ('PH100', 'Physics')", ok: true },
      { sql: "SELECT credits FROM courses WHERE code = 'PH100'", rows: [[3]] },
    ] as Case[],
  },
  {
    label: 'final clinic_mssql',
    def: defOf('clinic_mssql'),
    cases: [
      { sql: "SELECT DATEPART(week, '2023-01-01') AS first, DATEPART(week, '2023-01-07') AS saturday, DATEPART(week, '2023-01-08') AS sunday, DATEPART(week, '2026-01-01') AS thursday, DATEPART(week, '2026-01-04') AS next_sunday", rows: [[1, 1, 2, 1, 2]], note: 'T-SQL week 1 starts on January 1 with Sunday as the default first weekday' },
      { sql: "SELECT FullName, LEFT(FullName, CHARINDEX(' ', FullName) - 1) AS First FROM Patient ORDER BY PatientId", rows: [['Ola Nordmann', 'Ola'], ['Kari Hansen', 'Kari'], ['Per Olsen', 'Per']], ordered: true },
      { sql: 'SELECT COUNT(*) AS n FROM Visit WHERE DATEPART(month, VisitedAt) IN (6, 7)', rows: [[2]] },
      { sql: 'SELECT FullName FROM Patient WHERE IsActive = 1 AND Balance >= 45 ORDER BY Balance DESC', rows: [['Ola Nordmann'], ['Per Olsen']], ordered: true },
    ] as Case[],
  },
  {
    label: 'final scott_ora',
    def: defOf('scott_ora'),
    cases: [
      { sql: "SELECT ADD_MONTHS('2025-02-28', 1) AS next, DATE_ADD('2025-02-28', INTERVAL 1 MONTH) AS mysql_next", rows: [['2025-03-31', '2025-03-28']], note: 'Oracle preserves month-end; MySQL preserves the day when it fits' },
      { sql: "SELECT ADD_MONTHS('2024-02-29', 1) AS leap_next, ADD_MONTHS('2025-04-30', -1) AS prev, ADD_MONTHS('2025-01-30', 1) AS clamped", rows: [['2024-03-31', '2025-03-31', '2025-02-28']] },
      { sql: "SELECT ADD_MONTHS('2025-02-28 09:30:00', 1) AS timed, ADD_MONTHS(NULL, 1) AS missing_date, ADD_MONTHS('2025-02-28', NULL) AS missing_count", rows: [['2025-03-31 09:30:00', null, null]] },
      { sql: "SELECT ENAME, TO_CHAR(SAL, '9,999.00') AS S FROM EMP WHERE EMPNO = 7839", rows: [['KING', '5,000.00']] },
      { sql: 'SELECT ENAME FROM EMP WHERE SAL = (SELECT MAX(SAL) FROM EMP WHERE DEPTNO = 20)', rows: [['FORD']] },
      { sql: 'SELECT COUNT(DISTINCT JOB) AS JOBS FROM EMP', rows: [[5]] },
      { sql: "UPDATE EMP SET SAL = SAL + 100 WHERE JOB = 'CLERK' AND DEPTNO = 10", ok: true },
      { sql: 'SELECT SAL FROM EMP WHERE EMPNO = 7934', rows: [[1400]] },
      { sql: 'SELECT ENAME, HIREDATE FROM EMP WHERE EXTRACT(MONTH FROM HIREDATE) = 12 ORDER BY HIREDATE', rows: [['SMITH', '1980-12-17'], ['FORD', '1981-12-03']], ordered: true },
    ] as Case[],
  },
];
