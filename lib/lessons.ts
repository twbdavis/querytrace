/* Lessons follow the ISTM 315 sequence: DML SELECT basics (slideset 5), then
   joins and outer joins (slideset 6), practicing on the workbook databases.
   Every query uses only syntax taught in the course: SELECT / FROM / WHERE /
   GROUP BY / HAVING / ORDER BY, comparison + AND/OR/NOT, LIKE, IN,
   BETWEEN...AND, IS NULL, the five aggregates (COUNT/SUM/AVG/MIN/MAX),
   field aliases with AS '...', table aliases without AS, JOIN ... ON and
   LEFT OUTER JOIN. */

export interface Lesson {
  id: string;
  section: 'Basic queries' | 'Advanced queries';
  schemaId: string;
  title: string;
  concept: string;
  query: string;
  tryIt: string;
}

export const LESSONS: Lesson[] = [
  {
    id: 'projection',
    section: 'Basic queries',
    schemaId: 'shares',
    title: '1. SELECT ... FROM (projection)',
    concept:
      'A query never changes the table; it projects columns out of it. Workbook: "List all share names and their codes." Watch the chosen columns light up while every row stays alive.',
    query: 'SELECT SHRFIRM, SHRCODE FROM SHARES',
    tryIt: 'List full details for all shares with SELECT * FROM SHARES.',
  },
  {
    id: 'where',
    section: 'Basic queries',
    schemaId: 'shares',
    title: '2. WHERE (filtering rows)',
    concept:
      'WHERE tests every row against a condition; rows that fail visibly fade out. Workbook: "List full details for all shares with a price < $15."',
    query: 'SELECT * FROM SHARES WHERE SHRPRICE < 15',
    tryIt:
      'Change it to the next exercise: name and price of all shares with a price of at least $10 (SHRPRICE >= 10).',
  },
  {
    id: 'boolean-logic',
    section: 'Basic queries',
    schemaId: 'shares',
    title: '3. AND, OR, NOT + parentheses',
    concept:
      'Boolean conditions combine with AND, OR and NOT. AND is evaluated before OR, just as multiplication precedes addition; parentheses explicitly change that order.',
    query:
      "SELECT SHRCODE, SHRFIRM, SHRPRICE\nFROM SHARES\nWHERE (SHRPRICE < 15 OR SHRPE = 16) AND NOT SHRCODE = 'SLG'",
    tryIt:
      'Remove the parentheses and compare the surviving rows. The AND condition will then apply only to SHRPE = 16.',
  },
  {
    id: 'computed',
    section: 'Basic queries',
    schemaId: 'shares',
    title: '4. Computed columns + ORDER BY',
    concept:
      "Workbook: \"List the name, share price, share quantity, and total value of shares held (number of shares times share price), sorting in descending order of total value.\" Note the course rule: a field alias cannot be referred to elsewhere in the query, so ORDER BY repeats the expression.",
    query:
      "SELECT SHRFIRM, SHRPRICE, SHRQTY, SHRPRICE * SHRQTY AS 'Total Value'\nFROM SHARES\nORDER BY SHRPRICE * SHRQTY DESC",
    tryIt:
      'Find shares with a yield exceeding 5 percent: WHERE SHRDIV / SHRPRICE > 0.05.',
  },
  {
    id: 'like-in-between',
    section: 'Basic queries',
    schemaId: 'shares',
    title: '5. LIKE, IN and BETWEEN',
    concept:
      "LIKE matches patterns with % as the wildcard. Workbook: \"Find shares with a code starting with 'B'.\" IN tests membership in a list; BETWEEN ... AND is inclusive of the endpoints.",
    query: "SELECT * FROM SHARES WHERE SHRCODE LIKE 'B%'",
    tryIt:
      "Try SHRFIRM LIKE '%Gold%', then WHERE SHRPE BETWEEN 10 AND 13, then WHERE SHRCODE IN ('AR', 'SLG').",
  },
  {
    id: 'distinct',
    section: 'Basic queries',
    schemaId: 'donor',
    title: '6. DISTINCT (remove duplicate rows)',
    concept:
      'DISTINCT removes duplicate result rows after projection. A distinct state can still trace back to every donor row that contributed that state.',
    query: 'SELECT DISTINCT DSTATE FROM DONOR ORDER BY DSTATE',
    tryIt:
      'Compare with SELECT DSTATE FROM DONOR ORDER BY DSTATE, then count unique gift donors with COUNT(DISTINCT DONORNO).',
  },
  {
    id: 'aliases-concat',
    section: 'Basic queries',
    schemaId: 'donor',
    title: '7. Field aliases + CONCAT',
    concept:
      "CONCAT joins text values and separators. AS gives the result column a readable field alias. Per the course rule, that alias cannot be reused elsewhere in the same query.",
    query: "SELECT CONCAT(DLNAME, ', ', DFNAME) AS 'Donor Name' FROM DONOR",
    tryIt:
      "Add the city: CONCAT(DLNAME, ', ', DFNAME, ' — ', DCITY). Keep the separator text inside quotes.",
  },
  {
    id: 'aggregates',
    section: 'Basic queries',
    schemaId: 'donor',
    title: '8. Aggregates (scalar)',
    concept:
      'A scalar aggregate collapses ALL surviving rows into one value: COUNT, SUM, AVG, MIN, MAX. Workbook: "How many donors are there in the donor table?"',
    query: "SELECT COUNT(*) AS 'Number of Donors' FROM DONOR",
    tryIt:
      "Total amount donated in 2013: SELECT SUM(AMOUNT) FROM GIFT WHERE YEAR = 2013. Then the average donation BETWEEN 2012 AND 2014.",
  },
  {
    id: 'is-null',
    section: 'Basic queries',
    schemaId: 'sales',
    title: '9. IS NULL (missing data)',
    concept:
      'NULL is not zero and not an empty string—it is the absence of a value, and it needs IS NULL to test. Workbook: "List the items that have no color."',
    query: 'SELECT INAME, ITYPE, ICOLOR FROM ITEM WHERE ICOLOR IS NULL',
    tryIt:
      'Try ICOLOR = NULL and compare: ordinary equality never evaluates an unknown NULL as true.',
  },
  {
    id: 'group-by',
    section: 'Basic queries',
    schemaId: 'donor',
    title: '10. GROUP BY (vector aggregate)',
    concept:
      'GROUP BY buckets the surviving rows; each color is one bucket, and the aggregate is computed per group instead of once. Any SELECT column that is not aggregated must appear in the GROUP BY.',
    query: 'SELECT DSTATE, COUNT(*) FROM DONOR GROUP BY DSTATE',
    tryIt: 'Group gifts by year instead: SELECT YEAR, SUM(AMOUNT) FROM GIFT GROUP BY YEAR.',
  },
  {
    id: 'having',
    section: 'Basic queries',
    schemaId: 'emp',
    title: '11. HAVING (filtering groups)',
    concept:
      'HAVING is like a WHERE clause, but it operates on whole groups. WHERE cannot contain aggregates; HAVING can. Workbook (EMP): "List the departments with an average salary greater than $35,000."',
    query:
      "SELECT DEPTNAME, AVG(EMPSALARY) AS 'Average Salary'\nFROM EMP\nGROUP BY DEPTNAME\nHAVING AVG(EMPSALARY) > 35000",
    tryIt:
      'On the DONOR schema (load it from the Schema menu): states with more than one donor - GROUP BY DSTATE HAVING COUNT(*) > 1.',
  },
  {
    id: 'inner-join',
    section: 'Advanced queries',
    schemaId: 'donor',
    title: '12. Inner join (equijoin)',
    concept:
      'JOIN ... ON matches rows where the foreign key of the dependent table equals the primary key of the parent table. Watch pulses travel the FK wire as each DONORNO finds its gifts. Donor 104 fades out: no gifts, no match.',
    query:
      'SELECT DLNAME, DFNAME, AMOUNT\nFROM DONOR JOIN GIFT ON DONOR.DONORNO = GIFT.DONORNO',
    tryIt:
      'Use table aliases (no AS, and once assigned you must use them): FROM DONOR D JOIN GIFT G ON D.DONORNO = G.DONORNO.',
  },
  {
    id: 'comma-join',
    section: 'Advanced queries',
    schemaId: 'donor',
    title: '13. Inner join using WHERE',
    concept:
      'The course also writes an inner join as comma-separated tables plus a WHERE match. Watch the Cartesian product form first; forgetting the matching WHERE condition leaves every possible pair.',
    query:
      'SELECT D.DLNAME, G.AMOUNT\nFROM DONOR D, GIFT G\nWHERE D.DONORNO = G.DONORNO',
    tryIt:
      'Temporarily remove WHERE to see why the slides warn about accidental Cartesian products, then restore it.',
  },
  {
    id: 'left-outer-join',
    section: 'Advanced queries',
    schemaId: 'donor',
    title: '14. LEFT OUTER JOIN',
    concept:
      'A LEFT OUTER JOIN keeps every row of the left table even without a match, padding the right side with NULLs (dashed border). Donor 104 (Berdahl) survives this time - with a NULL amount.',
    query:
      'SELECT DLNAME, AMOUNT\nFROM DONOR LEFT OUTER JOIN GIFT ON DONOR.DONORNO = GIFT.DONORNO',
    tryIt: 'Swap LEFT OUTER JOIN back to JOIN and compare: which donor disappears from the result?',
  },
  {
    id: 'join-group',
    section: 'Advanced queries',
    schemaId: 'donor',
    title: '15. Join + GROUP BY (full pipeline)',
    concept:
      'Workbook: "Report the total donations in 2014 by state." The full pipeline runs in order: FROM/JOIN builds rows, WHERE filters them, GROUP BY buckets them, and ORDER BY sorts the result last.',
    query:
      "SELECT DSTATE, SUM(AMOUNT) AS 'Total 2014'\nFROM DONOR D JOIN GIFT G ON D.DONORNO = G.DONORNO\nWHERE G.YEAR = 2014\nGROUP BY DSTATE\nORDER BY SUM(AMOUNT) DESC",
    tryIt:
      '"List the total amount given by each person across all years, sorted by donor last name": group by the donor instead of the state.',
  },
  {
    id: 'multi-join',
    section: 'Advanced queries',
    schemaId: 'sales',
    title: '16. Multi-table join',
    concept:
      'Joins chain: each JOIN ... ON adds one more table to the pipeline. Workbook (SALES): "Find the name of brown items that have been sold by the recreation department."',
    query:
      "SELECT I.INAME, S.SALEQTY\nFROM ITEM I JOIN SALE S ON I.INAME = S.INAME\nWHERE I.ICOLOR = 'Brown' AND S.DNAME = 'Recreation'",
    tryIt:
      '"Find the departments that have made at least four sales": GROUP BY S.DNAME HAVING COUNT(*) >= 4.',
  },
  {
    id: 'self-join',
    section: 'Advanced queries',
    schemaId: 'emp',
    title: '17. Self-join (unary relationship)',
    concept:
      'A self-join uses the same table in two roles. Table aliases distinguish the employee row (E) from its manager row (M); once assigned, those aliases must be used.',
    query:
      "SELECT E.EMPFNAME, M.EMPFNAME AS 'Manager'\nFROM EMP E JOIN EMP M ON E.BOSS = M.EMPNO",
    tryIt:
      "Limit the employees to Marketing with WHERE E.DEPTNAME = 'Marketing'.",
  },
  {
    id: 'union',
    section: 'Advanced queries',
    schemaId: 'donor',
    title: '18. UNION and UNION ALL',
    concept:
      'UNION stacks compatible SELECT results and removes duplicates. UNION ALL keeps duplicates. Each branch must return the same number of compatible columns.',
    query: "SELECT DLNAME AS 'Name' FROM DONOR\nUNION\nSELECT DFNAME FROM DONOR",
    tryIt:
      'Change UNION to UNION ALL and compare the row count. Any final ORDER BY must use a column name from the first SELECT.',
  },
  {
    id: 'subquery',
    section: 'Advanced queries',
    schemaId: 'donor',
    title: '19. Subqueries',
    concept:
      'An uncorrelated subquery runs once and supplies its result to the outer query. Here the inner SELECT finds the largest 2012 gift before the outer query finds that donor.',
    query:
      'SELECT DLNAME, DFNAME\nFROM DONOR\nWHERE DONORNO = (SELECT DONORNO FROM GIFT WHERE YEAR = 2012 ORDER BY AMOUNT DESC LIMIT 1)',
    tryIt:
      'Find every donor who has given: WHERE DONORNO IN (SELECT DISTINCT DONORNO FROM GIFT).',
  },
];
