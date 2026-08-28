/* Fictional datasets created for QueryTrace. Each domain demonstrates reusable
   relational patterns without mirroring the entities or records of a workbook. */

export interface ColumnMeta {
  name: string;
  type?: string;
  notNull?: boolean;
  defaultValue?: string | null;
  pk?: boolean;
  fk?: { table: string; column: string; onUpdate?: string; onDelete?: string };
}

export interface TableMeta {
  name: string;
  columns: ColumnMeta[];
}

export interface FkEdgeDef {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface SchemaDef {
  id: string;
  name: string;
  description: string;
  ddl: string;
  starterQuery: string;
  positions?: Record<string, { x: number; y: number }>;
}

const OBSERVATORY_DDL = `
CREATE TABLE ASTRONOMER (
  ASTRONOMER_ID INTEGER PRIMARY KEY,
  GIVEN_NAME VARCHAR(20) NOT NULL,
  FAMILY_NAME VARCHAR(20) NOT NULL,
  HOME_CITY VARCHAR(30) NOT NULL
);
CREATE TABLE TELESCOPE (
  TELESCOPE_ID CHAR(3) PRIMARY KEY,
  TELESCOPE_NAME VARCHAR(30) NOT NULL,
  LOCATION VARCHAR(30) NOT NULL,
  APERTURE_CM INTEGER NOT NULL
);
CREATE TABLE TARGET (
  TARGET_ID INTEGER PRIMARY KEY,
  TARGET_NAME VARCHAR(30) NOT NULL,
  CONSTELLATION VARCHAR(20) NOT NULL,
  TARGET_TYPE VARCHAR(20) NOT NULL
);
CREATE TABLE OBSERVATION (
  OBSERVATION_ID INTEGER PRIMARY KEY,
  ASTRONOMER_ID INTEGER NOT NULL,
  TELESCOPE_ID CHAR(3) NOT NULL,
  TARGET_ID INTEGER NOT NULL,
  OBSERVED_ON CHAR(10) NOT NULL,
  EXPOSURE_MIN INTEGER NOT NULL,
  CONSTRAINT observation_astronomer_fk FOREIGN KEY (ASTRONOMER_ID)
    REFERENCES ASTRONOMER (ASTRONOMER_ID),
  CONSTRAINT observation_telescope_fk FOREIGN KEY (TELESCOPE_ID)
    REFERENCES TELESCOPE (TELESCOPE_ID),
  CONSTRAINT observation_target_fk FOREIGN KEY (TARGET_ID)
    REFERENCES TARGET (TARGET_ID)
);
INSERT INTO ASTRONOMER VALUES
  (1, 'Mina', 'Solberg', 'Flagstaff'), (2, 'Caleb', 'Nwosu', 'Tucson'),
  (3, 'Yara', 'Ito', 'Albuquerque'), (4, 'Jonas', 'Vale', 'Flagstaff'),
  (5, 'Esme', 'Rios', 'Santa Fe'), (6, 'Dev', 'Banerjee', 'Tucson');
INSERT INTO TELESCOPE VALUES
  ('ARC', 'Archer Reflector', 'Juniper Mesa', 180),
  ('DUN', 'Dunewatch Array', 'Red Basin', 95),
  ('LUX', 'Lux Survey Scope', 'North Ridge', 240),
  ('OWL', 'Owl Creek Radio Dish', 'Owl Creek', 320);
INSERT INTO TARGET VALUES
  (101, 'Blue Lantern Nebula', 'Cygnus', 'Nebula'),
  (102, 'Kepler-186', 'Cygnus', 'Star'),
  (103, 'Whirlpool Galaxy', 'Canes Venatici', 'Galaxy'),
  (104, 'Vesta', 'Virgo', 'Asteroid'),
  (105, 'Pleiades', 'Taurus', 'Star Cluster'),
  (106, 'Ring Nebula', 'Lyra', 'Nebula'),
  (107, 'Andromeda Galaxy', 'Andromeda', 'Galaxy');
INSERT INTO OBSERVATION VALUES
  (5001, 1, 'ARC', 101, '2026-03-12', 42),
  (5002, 2, 'DUN', 104, '2026-03-14', 18),
  (5003, 3, 'LUX', 103, '2026-03-18', 65),
  (5004, 4, 'OWL', 102, '2026-03-21', 30),
  (5005, 5, 'ARC', 106, '2026-04-02', 50),
  (5006, 6, 'LUX', 107, '2026-04-05', 80),
  (5007, 1, 'DUN', 105, '2026-04-11', 24),
  (5008, 3, 'OWL', 101, '2026-04-18', 36),
  (5009, 5, 'LUX', 105, '2026-05-03', 28),
  (5010, 2, 'ARC', 103, '2026-05-09', 55);
`;

const TRANSIT_DDL = `
CREATE TABLE FERRY_ROUTE (
  ROUTE_CODE CHAR(3) PRIMARY KEY,
  ROUTE_NAME VARCHAR(30) NOT NULL,
  TERMINAL_ZONE VARCHAR(20) NOT NULL,
  FARE DECIMAL(6,2) NOT NULL,
  SCHEDULED_TRIPS INTEGER NOT NULL,
  CROSSING_MIN INTEGER NOT NULL,
  NIGHT_SERVICE INTEGER NOT NULL
);
INSERT INTO FERRY_ROUTE VALUES
  ('B01', 'Bay Loop', 'Central', 8.50, 14, 32, 0),
  ('C07', 'Crescent Point', 'East', 12.00, 9, 48, 0),
  ('H22', 'Harbor Link', 'Central', 6.75, 18, 24, 1),
  ('I04', 'Island Express', 'Offshore', 15.50, 8, 58, 0),
  ('L11', 'Lighthouse Run', 'North', 11.25, 10, 44, 1),
  ('M01', 'Marsh Shuttle', 'South', 5.50, 12, 19, 0),
  ('N08', 'North Sound', 'North', 9.75, 16, 37, 1),
  ('P15', 'Peninsula Ferry', 'West', 13.25, 7, 52, 0),
  ('R03', 'River Market', 'Central', 4.25, 20, 16, 1),
  ('S19', 'Sunset Harbor', 'West', 10.50, 11, 41, 1);
`;

const FESTIVAL_DDL = `
CREATE TABLE ATTENDEE (
  ATTENDEE_ID INTEGER PRIMARY KEY,
  FAMILY_NAME VARCHAR(20) NOT NULL,
  GIVEN_NAME VARCHAR(20) NOT NULL,
  PASS_TYPE VARCHAR(15) NOT NULL,
  CITY VARCHAR(25) NOT NULL,
  FAVORITE_GENRE VARCHAR(20) NOT NULL
);
CREATE TABLE VENUE (
  VENUE_ID INTEGER PRIMARY KEY,
  VENUE_NAME VARCHAR(30) NOT NULL,
  CITY VARCHAR(25) NOT NULL,
  CAPACITY INTEGER NOT NULL
);
CREATE TABLE SCREENING (
  SCREENING_ID INTEGER PRIMARY KEY,
  FILM_TITLE VARCHAR(40) NOT NULL,
  VENUE_ID INTEGER NOT NULL,
  SCREENING_DAY VARCHAR(10) NOT NULL,
  GENRE VARCHAR(20) NOT NULL,
  CONSTRAINT screening_venue_fk FOREIGN KEY (VENUE_ID) REFERENCES VENUE (VENUE_ID)
);
CREATE TABLE RESERVATION (
  ATTENDEE_ID INTEGER NOT NULL,
  SCREENING_ID INTEGER NOT NULL,
  SEATS INTEGER NOT NULL,
  STATUS VARCHAR(12) NOT NULL,
  PRIMARY KEY (ATTENDEE_ID, SCREENING_ID),
  CONSTRAINT reservation_attendee_fk FOREIGN KEY (ATTENDEE_ID)
    REFERENCES ATTENDEE (ATTENDEE_ID) ON DELETE CASCADE,
  CONSTRAINT reservation_screening_fk FOREIGN KEY (SCREENING_ID)
    REFERENCES SCREENING (SCREENING_ID) ON DELETE CASCADE
);
INSERT INTO ATTENDEE VALUES
  (301, 'Adebayo', 'Nia', 'Weekend', 'Juniper Bay', 'Documentary'),
  (302, 'Berg', 'Oskar', 'Day', 'Marrow Glen', 'Comedy'),
  (303, 'Costa', 'Ines', 'All Access', 'Juniper Bay', 'Drama'),
  (304, 'Dlamini', 'Thabo', 'Student', 'Pine Harbor', 'Animation'),
  (305, 'El-Amin', 'Sara', 'Weekend', 'Stonebridge', 'Documentary'),
  (306, 'Fischer', 'Luca', 'Day', 'Marrow Glen', 'Thriller'),
  (307, 'Gupta', 'Mira', 'All Access', 'Lake Arden', 'Drama'),
  (308, 'Haddad', 'Rami', 'Student', 'Pine Harbor', 'Comedy'),
  (309, 'Ibarra', 'Sol', 'Weekend', 'Juniper Bay', 'Animation'),
  (310, 'Jensen', 'Freya', 'Day', 'Stonebridge', 'Documentary'),
  (311, 'Kwon', 'Jae', 'All Access', 'Lake Arden', 'Thriller'),
  (312, 'Lopes', 'Tomas', 'Student', 'Maple Cross', 'Drama');
INSERT INTO VENUE VALUES
  (41, 'Beacon Theater', 'Juniper Bay', 180),
  (42, 'Foundry Hall', 'Stonebridge', 120),
  (43, 'Orchard Cinema', 'Pine Harbor', 95),
  (44, 'Riverside Screen', 'Lake Arden', 150),
  (45, 'Maple Microcinema', 'Maple Cross', 60);
INSERT INTO SCREENING VALUES
  (701, 'Paper Moons', 41, 'Friday', 'Drama'),
  (702, 'The Last Pollinator', 42, 'Friday', 'Documentary'),
  (703, 'Signal from the Attic', 43, 'Saturday', 'Thriller'),
  (704, 'Kite City', 44, 'Saturday', 'Animation'),
  (705, 'Second Breakfast', 45, 'Sunday', 'Comedy'),
  (706, 'Tide Atlas', 41, 'Saturday', 'Documentary');
INSERT INTO RESERVATION VALUES
  (301, 701, 2, 'Confirmed'), (301, 706, 1, 'Confirmed'),
  (302, 702, 1, 'Confirmed'), (302, 705, 2, 'Waitlist'),
  (303, 701, 1, 'Confirmed'), (303, 703, 2, 'Confirmed'), (303, 706, 1, 'Confirmed'),
  (304, 704, 1, 'Confirmed'), (304, 705, 1, 'Confirmed'),
  (305, 702, 2, 'Confirmed'), (305, 706, 2, 'Confirmed'),
  (306, 703, 1, 'Confirmed'), (306, 705, 1, 'Confirmed'),
  (307, 701, 2, 'Confirmed'), (307, 704, 1, 'Confirmed'), (307, 706, 2, 'Confirmed'),
  (308, 703, 1, 'Waitlist'), (309, 704, 2, 'Confirmed'),
  (309, 705, 1, 'Confirmed'), (310, 702, 1, 'Confirmed'),
  (310, 706, 1, 'Confirmed'), (311, 703, 2, 'Confirmed'), (311, 704, 1, 'Confirmed');
`;

const ORCHARD_DDL = `
CREATE TABLE ORCHARD_PLOT (
  PLOT_ID CHAR(2) PRIMARY KEY,
  PLOT_NAME VARCHAR(30) NOT NULL,
  ZONE VARCHAR(12) NOT NULL,
  TREE_COUNT INTEGER NOT NULL,
  PARENT_PLOT_ID CHAR(2) NOT NULL,
  CONSTRAINT plot_parent_fk FOREIGN KEY (PARENT_PLOT_ID) REFERENCES ORCHARD_PLOT (PLOT_ID)
);
INSERT INTO ORCHARD_PLOT VALUES
  ('A0', 'North Orchard', 'North', 240, 'A0'),
  ('A1', 'Apricot Lane', 'North', 62, 'A0'),
  ('A2', 'Pear Terrace', 'North', 78, 'A0'),
  ('B0', 'River Orchard', 'South', 210, 'B0'),
  ('B1', 'Plum Bend', 'South', 55, 'B0'),
  ('B2', 'Cherry Bank', 'South', 88, 'B0'),
  ('C0', 'Hill Orchard', 'East', 170, 'C0'),
  ('C1', 'Fig Rise', 'East', 41, 'C0'),
  ('C2', 'Apple Crest', 'East', 96, 'C0'),
  ('D0', 'Propagation Yard', 'West', 45, 'D0');
`;

const MARINE_DDL = `
CREATE TABLE REEF (
  REEF_ID CHAR(3) PRIMARY KEY,
  REEF_NAME VARCHAR(30) NOT NULL,
  DEPTH_M INTEGER NOT NULL,
  SECTOR VARCHAR(12) NOT NULL
);
CREATE TABLE DIVER (
  DIVER_ID INTEGER PRIMARY KEY,
  DIVER_NAME VARCHAR(25) NOT NULL,
  CERT_LEVEL VARCHAR(15) NOT NULL
);
CREATE TABLE SPECIES (
  SPECIES_CODE CHAR(4) PRIMARY KEY,
  COMMON_NAME VARCHAR(30) NOT NULL,
  SPECIES_GROUP VARCHAR(15) NOT NULL,
  TAG_COLOR VARCHAR(12)
);
CREATE TABLE SIGHTING (
  SIGHTING_ID INTEGER PRIMARY KEY,
  COUNT_SEEN INTEGER NOT NULL,
  SPECIES_CODE CHAR(4) NOT NULL,
  REEF_ID CHAR(3) NOT NULL,
  DIVER_ID INTEGER NOT NULL,
  CONSTRAINT sighting_species_fk FOREIGN KEY (SPECIES_CODE) REFERENCES SPECIES (SPECIES_CODE),
  CONSTRAINT sighting_reef_fk FOREIGN KEY (REEF_ID) REFERENCES REEF (REEF_ID),
  CONSTRAINT sighting_diver_fk FOREIGN KEY (DIVER_ID) REFERENCES DIVER (DIVER_ID)
);
INSERT INTO REEF VALUES
  ('BLU', 'Bluebell Shelf', 18, 'North'), ('COR', 'Cormorant Ledge', 27, 'West'),
  ('GLS', 'Glass Kelp Garden', 12, 'North'), ('MNR', 'Moonrise Reef', 34, 'East'),
  ('SAN', 'Sandbar Nursery', 9, 'South'), ('TWN', 'Twin Arch', 22, 'East');
INSERT INTO DIVER VALUES
  (21, 'Ayla Moss', 'Research'), (22, 'Ben Okoro', 'Advanced'),
  (23, 'Chiyo Lane', 'Research'), (24, 'Diego Park', 'Rescue'),
  (25, 'Eleni Shah', 'Advanced'), (26, 'Finn Zhao', 'Research');
INSERT INTO SPECIES VALUES
  ('ANEM', 'Sunburst Anemone', 'Invertebrate', 'Orange'),
  ('BTRF', 'Reef Butterflyfish', 'Fish', 'Yellow'),
  ('EEL1', 'Ribbon Eel', 'Fish', NULL),
  ('KELP', 'Giant Kelp', 'Plant', 'Green'),
  ('MANT', 'Manta Ray', 'Fish', 'Blue'),
  ('OCTO', 'Day Octopus', 'Invertebrate', NULL),
  ('PAR1', 'Bumphead Parrotfish', 'Fish', 'Teal'),
  ('STAR', 'Crown Star', 'Invertebrate', 'Purple'),
  ('TURT', 'Green Sea Turtle', 'Reptile', 'Silver'),
  ('WRAS', 'Cleaner Wrasse', 'Fish', 'Blue');
INSERT INTO SIGHTING VALUES
  (9001, 6, 'BTRF', 'BLU', 21), (9002, 1, 'EEL1', 'COR', 22),
  (9003, 14, 'KELP', 'GLS', 23), (9004, 2, 'MANT', 'MNR', 24),
  (9005, 3, 'OCTO', 'TWN', 25), (9006, 8, 'PAR1', 'BLU', 26),
  (9007, 5, 'STAR', 'SAN', 21), (9008, 2, 'TURT', 'TWN', 22),
  (9009, 11, 'WRAS', 'GLS', 23), (9010, 4, 'ANEM', 'COR', 24),
  (9011, 7, 'BTRF', 'GLS', 25), (9012, 1, 'MANT', 'BLU', 26),
  (9013, 9, 'PAR1', 'MNR', 21), (9014, 3, 'TURT', 'SAN', 22);
`;

export const PRELOADED_SCHEMAS: SchemaDef[] = [
  {
    id: 'observatory',
    name: 'Night observatory',
    description: 'Astronomers, telescopes, sky targets and observation logs for open-ended relational practice.',
    ddl: OBSERVATORY_DDL,
    starterQuery:
      'SELECT A.GIVEN_NAME, T.TARGET_NAME, O.EXPOSURE_MIN\nFROM ASTRONOMER A\nJOIN OBSERVATION O ON A.ASTRONOMER_ID = O.ASTRONOMER_ID\nJOIN TARGET T ON O.TARGET_ID = T.TARGET_ID;',
    positions: {
      ASTRONOMER: { x: 0, y: 40 },
      OBSERVATION: { x: 620, y: 300 },
      TARGET: { x: 1240, y: 20 },
      TELESCOPE: { x: 1240, y: 620 },
    },
  },
  {
    id: 'transit',
    name: 'Harbor ferry routes',
    description: 'Ten fictional ferry routes for selecting, filtering, calculating, matching patterns and sorting.',
    ddl: TRANSIT_DDL,
    starterQuery: 'SELECT ROUTE_NAME, ROUTE_CODE FROM FERRY_ROUTE;',
  },
  {
    id: 'festival',
    name: 'Independent film festival',
    description: 'Attendees reserve screenings at several venues; one attendee has not booked anything yet.',
    ddl: FESTIVAL_DDL,
    starterQuery: 'SELECT FILM_TITLE, SCREENING_DAY, GENRE FROM SCREENING;',
  },
  {
    id: 'marine',
    name: 'Coastal research survey',
    description: 'Divers record species sightings across reefs, including species whose field-tag color is unknown.',
    ddl: MARINE_DDL,
    starterQuery: "SELECT COMMON_NAME, TAG_COLOR FROM SPECIES WHERE SPECIES_GROUP = 'Fish';",
  },
  {
    id: 'orchard',
    name: 'Orchard plot map',
    description: 'Growing plots belong to larger parent blocks, creating a self-referencing hierarchy.',
    ddl: ORCHARD_DDL,
    starterQuery: 'SELECT ZONE, AVG(TREE_COUNT) FROM ORCHARD_PLOT GROUP BY ZONE;',
  },
];

export function schemaById(id: string): SchemaDef | undefined {
  return PRELOADED_SCHEMAS.find((schema) => schema.id === id);
}
