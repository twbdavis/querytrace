/**
 * The two tables the landing hero joins: SCREENING and VENUE from the film
 * festival schema (lib/schemas.ts, FESTIVAL_DDL), copied here so the landing
 * never loads sql.js. Values match the data lesson 15 runs over.
 */

export interface ColumnSpec {
  name: string;
  type: string;
  pk?: boolean;
  fk?: boolean;
}

export interface TableSpec {
  name: string;
  columns: ColumnSpec[];
  rows: (string | number)[][];
  /** Index of the column the join wire attaches to. */
  keyColumn: number;
}

export const SCREENING: TableSpec = {
  name: 'SCREENING',
  columns: [
    { name: 'SCREENING_ID', type: 'INTEGER', pk: true },
    { name: 'FILM_TITLE', type: 'VARCHAR(40)' },
    { name: 'VENUE_ID', type: 'INTEGER', fk: true },
    { name: 'SCREENING_DAY', type: 'VARCHAR(10)' },
    { name: 'GENRE', type: 'VARCHAR(20)' },
  ],
  rows: [
    [701, 'Paper Moons', 41, 'Friday', 'Drama'],
    [702, 'The Last Pollinator', 42, 'Friday', 'Documentary'],
    [703, 'Signal from the Attic', 43, 'Saturday', 'Thriller'],
    [704, 'Kite City', 44, 'Saturday', 'Animation'],
    [705, 'Second Breakfast', 45, 'Sunday', 'Comedy'],
    [706, 'Tide Atlas', 41, 'Saturday', 'Documentary'],
  ],
  keyColumn: 2,
};

export const VENUE: TableSpec = {
  name: 'VENUE',
  columns: [
    { name: 'VENUE_ID', type: 'INTEGER', pk: true },
    { name: 'VENUE_NAME', type: 'VARCHAR(30)' },
    { name: 'CITY', type: 'VARCHAR(25)' },
    { name: 'CAPACITY', type: 'INTEGER' },
  ],
  rows: [
    [41, 'Beacon Theater', 'Juniper Bay', 180],
    [42, 'Foundry Hall', 'Stonebridge', 120],
    [43, 'Orchard Cinema', 'Pine Harbor', 95],
    [44, 'Riverside Screen', 'Lake Arden', 150],
    [45, 'Maple Microcinema', 'Maple Cross', 60],
  ],
  keyColumn: 0,
};

/** SCREENING row index -> VENUE row index, in the order the join lights them. */
export const MATCHES: ReadonlyArray<readonly [number, number]> = SCREENING.rows.map((row, i) => {
  const venueRow = VENUE.rows.findIndex((v) => v[0] === row[2]);
  return [i, venueRow] as const;
});
