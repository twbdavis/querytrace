/* The examples are original to QueryTrace. The sequence preserves the taught
   progression from SELECT fundamentals through joins, sets and subqueries. */

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
    schemaId: 'catalog',
    title: '1. SELECT ... FROM (projection)',
    concept:
      'A query does not change its source table; it projects selected columns into a result. Watch the chosen product columns light up while every row stays active.',
    query: 'SELECT ITEMNAME, ITEMCODE FROM PRODUCT',
    tryIt: 'Return every column and row with SELECT * FROM PRODUCT.',
  },
  {
    id: 'where',
    section: 'Basic queries',
    schemaId: 'catalog',
    title: '2. WHERE (filtering rows)',
    concept:
      'WHERE tests each row against a condition. Rows that fail the test visibly fade out before projection occurs.',
    query: 'SELECT * FROM PRODUCT WHERE UNITPRICE < 20',
    tryIt: 'Return the name and price of products costing at least 25 with UNITPRICE >= 25.',
  },
  {
    id: 'boolean-logic',
    section: 'Basic queries',
    schemaId: 'catalog',
    title: '3. AND, OR, NOT + parentheses',
    concept:
      'Boolean conditions combine with AND, OR and NOT. AND is evaluated before OR; parentheses make a different evaluation order explicit.',
    query:
      "SELECT ITEMCODE, ITEMNAME, UNITPRICE\nFROM PRODUCT\nWHERE (UNITPRICE < 20 OR RATING = 5) AND NOT ITEMCODE = 'LMP'",
    tryIt: 'Remove the parentheses and compare which products survive the filter.',
  },
  {
    id: 'computed',
    section: 'Basic queries',
    schemaId: 'catalog',
    title: '4. Computed columns + ORDER BY',
    concept:
      'Expressions can compute result columns. This lesson calculates inventory value and sorts it high to low. A field alias cannot be reused elsewhere in the same query, so ORDER BY repeats the expression.',
    query:
      "SELECT ITEMNAME, UNITPRICE, STOCKQTY, UNITPRICE * STOCKQTY AS 'Inventory Value'\nFROM PRODUCT\nORDER BY UNITPRICE * STOCKQTY DESC",
    tryIt: 'Compute a discounted price with UNITPRICE * (1 - DISCOUNTRATE).',
  },
  {
    id: 'like-in-between',
    section: 'Basic queries',
    schemaId: 'catalog',
    title: '5. LIKE, IN and BETWEEN',
    concept:
      "LIKE matches text patterns and % matches any sequence of characters. IN tests membership in a list; BETWEEN ... AND includes both endpoints.",
    query: "SELECT * FROM PRODUCT WHERE ITEMCODE LIKE 'B%'",
    tryIt:
      "Try ITEMNAME LIKE '%Kit%', then RATING BETWEEN 3 AND 4, then ITEMCODE IN ('BAG', 'MUG').",
  },
  {
    id: 'distinct',
    section: 'Basic queries',
    schemaId: 'community',
    title: '6. DISTINCT (remove duplicate rows)',
    concept:
      'DISTINCT removes duplicate result rows after projection. Each unique region can still trace back to every member row that contributed it.',
    query: 'SELECT DISTINCT REGION FROM MEMBER ORDER BY REGION',
    tryIt:
      'Compare with SELECT REGION FROM MEMBER ORDER BY REGION, then count participating members with COUNT(DISTINCT MEMBER_ID).',
  },
  {
    id: 'aliases-concat',
    section: 'Basic queries',
    schemaId: 'community',
    title: '7. Field aliases + CONCAT',
    concept:
      'CONCAT joins text values and separators. AS gives the result column a readable field alias, which cannot be reused elsewhere in the same query.',
    query: "SELECT CONCAT(LAST_NAME, ', ', FIRST_NAME) AS 'Member Name' FROM MEMBER",
    tryIt:
      "Add the city with CONCAT(LAST_NAME, ', ', FIRST_NAME, ' — ', CITY). Keep separator text inside quotes.",
  },
  {
    id: 'aggregates',
    section: 'Basic queries',
    schemaId: 'community',
    title: '8. Aggregates (scalar)',
    concept:
      'A scalar aggregate collapses all surviving rows into one value. The five core aggregate functions are COUNT, SUM, AVG, MIN and MAX.',
    query: "SELECT COUNT(*) AS 'Number of Members' FROM MEMBER",
    tryIt:
      'Find total pledges in 2024 with SELECT SUM(AMOUNT) FROM PLEDGE WHERE CAMPAIGN_YEAR = 2024.',
  },
  {
    id: 'is-null',
    section: 'Basic queries',
    schemaId: 'makerspace',
    title: '9. IS NULL (missing data)',
    concept:
      'NULL is neither zero nor an empty string. It represents an absent value and must be tested with IS NULL.',
    query: 'SELECT MATERIAL_NAME, MATERIAL_TYPE, COLOR FROM MATERIAL WHERE COLOR IS NULL',
    tryIt: 'Try COLOR = NULL and compare: ordinary equality cannot make an unknown NULL value true.',
  },
  {
    id: 'group-by',
    section: 'Basic queries',
    schemaId: 'community',
    title: '10. GROUP BY (vector aggregate)',
    concept:
      'GROUP BY divides surviving rows into buckets and computes an aggregate for each bucket. Every selected nonaggregate column must appear in GROUP BY.',
    query: 'SELECT REGION, COUNT(*) FROM MEMBER GROUP BY REGION',
    tryIt:
      'Group pledges by campaign instead: SELECT CAMPAIGN_YEAR, SUM(AMOUNT) FROM PLEDGE GROUP BY CAMPAIGN_YEAR.',
  },
  {
    id: 'having',
    section: 'Basic queries',
    schemaId: 'staff',
    title: '11. HAVING (filtering groups)',
    concept:
      'HAVING filters whole groups after aggregation. WHERE cannot contain aggregate functions; HAVING can.',
    query:
      "SELECT TEAM, AVG(SALARY) AS 'Average Salary'\nFROM STAFF\nGROUP BY TEAM\nHAVING AVG(SALARY) > 45000",
    tryIt:
      'On Community campaigns, find regions with more than two members using GROUP BY REGION HAVING COUNT(*) > 2.',
  },
  {
    id: 'inner-join',
    section: 'Advanced queries',
    schemaId: 'community',
    title: '12. Inner join (equijoin)',
    concept:
      'JOIN ... ON matches the dependent table foreign key to its parent primary key. One member has no pledge and disappears because an inner join keeps only matches.',
    query:
      'SELECT LAST_NAME, FIRST_NAME, AMOUNT\nFROM MEMBER JOIN PLEDGE ON MEMBER.MEMBER_ID = PLEDGE.MEMBER_ID',
    tryIt:
      'Use table aliases without AS: FROM MEMBER M JOIN PLEDGE P ON M.MEMBER_ID = P.MEMBER_ID.',
  },
  {
    id: 'comma-join',
    section: 'Advanced queries',
    schemaId: 'community',
    title: '13. Inner join using WHERE',
    concept:
      'An inner join can also use comma-separated tables plus a WHERE match. The Cartesian product forms first; omitting the matching condition leaves every possible pair.',
    query:
      'SELECT M.LAST_NAME, P.AMOUNT\nFROM MEMBER M, PLEDGE P\nWHERE M.MEMBER_ID = P.MEMBER_ID',
    tryIt: 'Temporarily remove WHERE to observe the accidental Cartesian product, then restore it.',
  },
  {
    id: 'left-outer-join',
    section: 'Advanced queries',
    schemaId: 'community',
    title: '14. LEFT OUTER JOIN',
    concept:
      'A LEFT OUTER JOIN retains every left-table row. An unmatched member survives with NULL values from PLEDGE, shown with a dashed border.',
    query:
      'SELECT LAST_NAME, AMOUNT\nFROM MEMBER LEFT OUTER JOIN PLEDGE ON MEMBER.MEMBER_ID = PLEDGE.MEMBER_ID',
    tryIt: 'Change LEFT OUTER JOIN to JOIN and identify which member disappears.',
  },
  {
    id: 'join-group',
    section: 'Advanced queries',
    schemaId: 'community',
    title: '15. Join + GROUP BY (full pipeline)',
    concept:
      'The complete logical pipeline builds joined rows, filters one campaign, groups them by region, projects totals, and sorts the final result.',
    query:
      "SELECT REGION, SUM(AMOUNT) AS 'Total 2024'\nFROM MEMBER M JOIN PLEDGE P ON M.MEMBER_ID = P.MEMBER_ID\nWHERE P.CAMPAIGN_YEAR = 2024\nGROUP BY REGION\nORDER BY SUM(AMOUNT) DESC",
    tryIt: 'Group by each member instead of region to total their pledges across every campaign.',
  },
  {
    id: 'multi-join',
    section: 'Advanced queries',
    schemaId: 'makerspace',
    title: '16. Multi-table join',
    concept:
      'Joins chain as each JOIN ... ON adds another relation. This query connects materials to checkouts and then to the area that used them.',
    query:
      "SELECT M.MATERIAL_NAME, C.QUANTITY, A.FLOOR_NO\nFROM MATERIAL M JOIN CHECKOUT C ON M.MATERIAL_NAME = C.MATERIAL_NAME\nJOIN AREA A ON C.AREA_NAME = A.AREA_NAME\nWHERE M.COLOR = 'Blue' AND A.AREA_NAME = 'Textiles'",
    tryIt:
      'Find areas with at least four checkouts by grouping C.AREA_NAME and applying HAVING COUNT(*) >= 4.',
  },
  {
    id: 'self-join',
    section: 'Advanced queries',
    schemaId: 'staff',
    title: '17. Self-join (unary relationship)',
    concept:
      'A self-join gives one physical table two roles. Aliases distinguish each staff row from its manager row and must be used after assignment.',
    query:
      "SELECT S.FIRST_NAME, M.FIRST_NAME AS 'Manager'\nFROM STAFF S JOIN STAFF M ON S.MANAGER_ID = M.STAFF_ID",
    tryIt: "Limit the staff rows to Design with WHERE S.TEAM = 'Design'.",
  },
  {
    id: 'union',
    section: 'Advanced queries',
    schemaId: 'community',
    title: '18. UNION and UNION ALL',
    concept:
      'UNION stacks compatible SELECT results and removes duplicates. UNION ALL retains duplicates. Every branch must return the same number of compatible columns.',
    query: "SELECT LAST_NAME AS 'Name' FROM MEMBER\nUNION\nSELECT FIRST_NAME FROM MEMBER",
    tryIt:
      'Change UNION to UNION ALL and compare the row count. A final ORDER BY must use a column name from the first SELECT.',
  },
  {
    id: 'subquery',
    section: 'Advanced queries',
    schemaId: 'community',
    title: '19. Subqueries',
    concept:
      'An uncorrelated subquery runs once and supplies its result to the outer query. The inner SELECT finds the largest 2022 pledge before the outer query identifies that member.',
    query:
      'SELECT LAST_NAME, FIRST_NAME\nFROM MEMBER\nWHERE MEMBER_ID = (SELECT MEMBER_ID FROM PLEDGE WHERE CAMPAIGN_YEAR = 2022 ORDER BY AMOUNT DESC LIMIT 1)',
    tryIt:
      'Find every participating member with WHERE MEMBER_ID IN (SELECT DISTINCT MEMBER_ID FROM PLEDGE).',
  },
];
