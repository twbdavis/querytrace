/* QueryTrace lessons use original scenarios while retaining a standard path
   from SELECT fundamentals through joins, set operations and subqueries. */

export interface Lesson {
  id: string;
  section: 'Foundations' | 'Combining data';
  schemaId: string;
  title: string;
  concept: string;
  query: string;
  tryIt: string;
}

export const LESSONS: Lesson[] = [
  {
    id: 'projection',
    section: 'Foundations',
    schemaId: 'transit',
    title: '1. Choose result columns',
    concept:
      'SELECT shapes a result without altering the source. Here every ferry route remains, but only its public name and short code appear.',
    query: 'SELECT ROUTE_NAME, ROUTE_CODE FROM FERRY_ROUTE;',
    tryIt: 'Use SELECT * to inspect every attribute recorded for each route.',
  },
  {
    id: 'where',
    section: 'Foundations',
    schemaId: 'marine',
    title: '2. Filter individual rows with WHERE',
    concept:
      'WHERE evaluates a condition once per source row. Watch deeper reefs fade while the qualifying shallow-water records continue.',
    query: 'SELECT REEF_NAME, DEPTH_M FROM REEF WHERE DEPTH_M <= 20;',
    tryIt: "Return only eastern reefs by testing SECTOR = 'East'.",
  },
  {
    id: 'boolean-logic',
    section: 'Foundations',
    schemaId: 'transit',
    title: '3. Combine conditions',
    concept:
      'AND, OR and NOT build richer tests. AND binds before OR, while parentheses let you state a different order explicitly.',
    query:
      "SELECT ROUTE_CODE, ROUTE_NAME, FARE\nFROM FERRY_ROUTE\nWHERE (FARE < 9 OR NIGHT_SERVICE = 1) AND NOT TERMINAL_ZONE = 'West';",
    tryIt: 'Remove the parentheses and compare the routes that remain.',
  },
  {
    id: 'computed',
    section: 'Foundations',
    schemaId: 'transit',
    title: '4. Calculate and sort',
    concept:
      'A SELECT expression can derive a value instead of copying a stored field. This estimate multiplies fare by scheduled trips, then ranks routes from highest to lowest.',
    query:
      "SELECT ROUTE_NAME, FARE, SCHEDULED_TRIPS, FARE * SCHEDULED_TRIPS AS 'Daily Ticket Potential'\nFROM FERRY_ROUTE\nORDER BY FARE * SCHEDULED_TRIPS DESC;",
    tryIt: 'Estimate trip-minutes with SCHEDULED_TRIPS * CROSSING_MIN and sort from low to high.',
  },
  {
    id: 'like-in-between',
    section: 'Foundations',
    schemaId: 'festival',
    title: '5. Match patterns and ranges',
    concept:
      'LIKE searches text patterns, IN compares against a list, and BETWEEN includes both boundary values.',
    query: "SELECT FILM_TITLE, GENRE FROM SCREENING WHERE FILM_TITLE LIKE '%the%';",
    tryIt:
      "Try GENRE IN ('Comedy', 'Animation'), then find venues with CAPACITY BETWEEN 90 AND 150.",
  },
  {
    id: 'distinct',
    section: 'Foundations',
    schemaId: 'festival',
    title: '6. Keep unique results with DISTINCT',
    concept:
      'DISTINCT removes repeated projected rows. A pass type appears once in the result even when several attendees share it.',
    query: 'SELECT DISTINCT PASS_TYPE FROM ATTENDEE ORDER BY PASS_TYPE;',
    tryIt: 'Remove DISTINCT to see every contributing attendee row, then try SELECT DISTINCT CITY.',
  },
  {
    id: 'aliases-concat',
    section: 'Foundations',
    schemaId: 'observatory',
    title: '7. Label a combined text field',
    concept:
      'CONCAT assembles text values and literal separators. AS gives the derived result column a useful heading.',
    query: "SELECT CONCAT(GIVEN_NAME, ' ', FAMILY_NAME) AS 'Observer' FROM ASTRONOMER;",
    tryIt: "Append the home city in parentheses by adding ' (', HOME_CITY, ')' to CONCAT.",
  },
  {
    id: 'aggregates',
    section: 'Foundations',
    schemaId: 'marine',
    title: '8. Summarize a set of rows',
    concept:
      'An aggregate turns many input rows into one summary value. Common choices include COUNT, SUM, AVG, MIN and MAX.',
    query: "SELECT SUM(COUNT_SEEN) AS 'Animals Recorded' FROM SIGHTING;",
    tryIt: 'Compare the shallowest and deepest reefs with MIN(DEPTH_M) and MAX(DEPTH_M).',
  },
  {
    id: 'is-null',
    section: 'Foundations',
    schemaId: 'marine',
    title: '9. Find missing values',
    concept:
      'NULL represents information that is absent, not zero or blank text. Use IS NULL because ordinary equality cannot make an unknown value true.',
    query: 'SELECT SPECIES_CODE, COMMON_NAME FROM SPECIES WHERE TAG_COLOR IS NULL;',
    tryIt: 'Switch to IS NOT NULL to list species with a recorded field-tag color.',
  },
  {
    id: 'group-by',
    section: 'Foundations',
    schemaId: 'festival',
    title: '10. Aggregate within groups',
    concept:
      'GROUP BY divides rows into buckets before calculating. Every selected field that is not aggregated must name the bucket it describes.',
    query: 'SELECT GENRE, COUNT(*) FROM SCREENING GROUP BY GENRE;',
    tryIt: 'Group attendees by PASS_TYPE and count how many hold each kind of pass.',
  },
  {
    id: 'having',
    section: 'Foundations',
    schemaId: 'orchard',
    title: '11. Filter completed groups with HAVING',
    concept:
      'WHERE filters source rows; HAVING filters group summaries. That is why aggregate conditions belong after GROUP BY.',
    query:
      "SELECT ZONE, AVG(TREE_COUNT) AS 'Average Trees'\nFROM ORCHARD_PLOT\nGROUP BY ZONE\nHAVING AVG(TREE_COUNT) > 110;",
    tryIt: 'Find zones represented by at least three plots using HAVING COUNT(*) >= 3.',
  },
  {
    id: 'inner-join',
    section: 'Combining data',
    schemaId: 'festival',
    title: '12. Match related rows with JOIN',
    concept:
      'JOIN ... ON pairs rows whose key values match. Attendees without a reservation are absent because an inner join retains matched pairs only.',
    query:
      'SELECT A.FAMILY_NAME, R.SCREENING_ID, R.SEATS\nFROM ATTENDEE A JOIN RESERVATION R ON A.ATTENDEE_ID = R.ATTENDEE_ID;',
    tryIt: 'Join SCREENING to RESERVATION instead and return each film title with its reserved seats.',
  },
  {
    id: 'comma-join',
    section: 'Combining data',
    schemaId: 'observatory',
    title: '13. Match tables through WHERE',
    concept:
      'Comma-separated tables begin as every possible row pairing. A WHERE condition narrows that Cartesian product to the genuinely related records.',
    query:
      'SELECT T.TELESCOPE_NAME, O.OBSERVED_ON\nFROM TELESCOPE T, OBSERVATION O\nWHERE T.TELESCOPE_ID = O.TELESCOPE_ID;',
    tryIt: 'Remove WHERE briefly to compare the number of possible pairs with the actual observations.',
  },
  {
    id: 'left-outer-join',
    section: 'Combining data',
    schemaId: 'festival',
    title: '14. Preserve unmatched rows',
    concept:
      'LEFT OUTER JOIN keeps every row from its left side. An attendee with no booking remains visible and receives NULL values from RESERVATION.',
    query:
      'SELECT A.GIVEN_NAME, A.FAMILY_NAME, R.SCREENING_ID\nFROM ATTENDEE A LEFT OUTER JOIN RESERVATION R ON A.ATTENDEE_ID = R.ATTENDEE_ID;',
    tryIt: 'Change LEFT OUTER JOIN to JOIN and identify the attendee who disappears.',
  },
  {
    id: 'join-group',
    section: 'Combining data',
    schemaId: 'festival',
    title: '15. Trace a complete query pipeline',
    concept:
      'This query links three tables, keeps Saturday screenings, totals reserved seats by venue, and orders the finished summaries.',
    query:
      "SELECT V.VENUE_NAME, SUM(R.SEATS) AS 'Saturday Seats'\nFROM VENUE V JOIN SCREENING S ON V.VENUE_ID = S.VENUE_ID\nJOIN RESERVATION R ON S.SCREENING_ID = R.SCREENING_ID\nWHERE S.SCREENING_DAY = 'Saturday'\nGROUP BY V.VENUE_NAME\nORDER BY SUM(R.SEATS) DESC;",
    tryIt: 'Group by S.GENRE instead to compare Saturday demand by film genre.',
  },
  {
    id: 'multi-join',
    section: 'Combining data',
    schemaId: 'marine',
    title: '16. Chain multiple relationships',
    concept:
      'Each JOIN adds another relationship. The chain connects a recorded sighting to both the observed species and the reef where it occurred.',
    query:
      "SELECT S.COMMON_NAME, G.COUNT_SEEN, R.REEF_NAME\nFROM SPECIES S JOIN SIGHTING G ON S.SPECIES_CODE = G.SPECIES_CODE\nJOIN REEF R ON G.REEF_ID = R.REEF_ID\nWHERE S.SPECIES_GROUP = 'Fish' AND R.SECTOR = 'North';",
    tryIt: 'Add DIVER and include D.DIVER_NAME by joining G.DIVER_ID to D.DIVER_ID.',
  },
  {
    id: 'self-join',
    section: 'Combining data',
    schemaId: 'orchard',
    title: '17. Give one table two roles',
    concept:
      'A self-join treats one physical table as two logical roles. Aliases separate an individual growing plot from its parent orchard block.',
    query:
      "SELECT P.PLOT_NAME, B.PLOT_NAME AS 'Parent Block'\nFROM ORCHARD_PLOT P JOIN ORCHARD_PLOT B ON P.PARENT_PLOT_ID = B.PLOT_ID;",
    tryIt: "Add WHERE P.ZONE = 'South' to focus on one part of the orchard.",
  },
  {
    id: 'union',
    section: 'Combining data',
    schemaId: 'festival',
    title: '18. Stack compatible results',
    concept:
      'UNION combines same-shaped SELECT results and removes duplicates. UNION ALL keeps repeats, which is useful when their frequency matters.',
    query: "SELECT CITY AS 'Festival City' FROM ATTENDEE\nUNION\nSELECT CITY FROM VENUE;",
    tryIt: 'Change UNION to UNION ALL and compare the result count. Both branches must return the same number of fields.',
  },
  {
    id: 'subquery',
    section: 'Combining data',
    schemaId: 'transit',
    title: '19. Feed one query into another',
    concept:
      'An uncorrelated subquery runs once and passes its result outward. The inner query calculates the average fare; the outer query finds routes below it.',
    query:
      'SELECT ROUTE_CODE, ROUTE_NAME, FARE\nFROM FERRY_ROUTE\nWHERE FARE < (SELECT AVG(FARE) FROM FERRY_ROUTE)\nORDER BY FARE;',
    tryIt: 'Replace AVG with MAX, then explain why almost every route qualifies.',
  },
];
