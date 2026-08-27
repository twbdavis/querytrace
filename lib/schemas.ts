/* Original teaching datasets designed for QueryTrace. They cover the same
   relational patterns and SQL operations as the lesson sequence without
   reproducing any external course examples or answer data. */

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

const UNIVERSITY_DDL = `
CREATE TABLE student (
  student_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  major TEXT NOT NULL,
  gpa REAL NOT NULL,
  year INTEGER NOT NULL
);
CREATE TABLE instructor (
  instructor_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT NOT NULL
);
CREATE TABLE course (
  course_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  department TEXT NOT NULL,
  credits INTEGER NOT NULL,
  instructor_id INTEGER NOT NULL,
  CONSTRAINT course_fk FOREIGN KEY (instructor_id) REFERENCES instructor (instructor_id)
);
CREATE TABLE enrollment (
  enrollment_id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  grade TEXT NOT NULL,
  semester TEXT NOT NULL,
  CONSTRAINT enroll_student_fk FOREIGN KEY (student_id) REFERENCES student (student_id),
  CONSTRAINT enroll_course_fk FOREIGN KEY (course_id) REFERENCES course (course_id)
);
INSERT INTO student VALUES
  (1, 'Ava Chen', 'CS', 3.9, 3), (2, 'Marcus Webb', 'CS', 3.2, 2),
  (3, 'Priya Patel', 'CS', 3.7, 4), (4, 'Jordan Lee', 'CS', 2.8, 1),
  (5, 'Sofia Reyes', 'Math', 3.6, 3), (6, 'Ethan Brooks', 'Math', 3.1, 2),
  (7, 'Lily Zhang', 'Math', 3.8, 4), (8, 'Noah Kim', 'Physics', 2.9, 1),
  (9, 'Emma Davis', 'Physics', 3.5, 3), (10, 'Omar Hassan', 'Biology', 3.4, 2),
  (11, 'Grace Miller', 'Biology', 3.95, 4), (12, 'Leo Martin', 'Art', 2.5, 1);
INSERT INTO instructor VALUES
  (1, 'Dr. Susan Hale', 'Computer Science'), (2, 'Dr. Raj Mehta', 'Mathematics'),
  (3, 'Dr. Elena Petrov', 'Physics'), (4, 'Dr. James Okafor', 'Biology'),
  (5, 'Dr. Marie Dubois', 'Fine Arts');
INSERT INTO course VALUES
  (1, 'Intro to Programming', 'Computer Science', 4, 1),
  (2, 'Data Structures', 'Computer Science', 4, 1),
  (3, 'Calculus I', 'Mathematics', 4, 2), (4, 'Linear Algebra', 'Mathematics', 3, 2),
  (5, 'Mechanics', 'Physics', 4, 3), (6, 'Genetics', 'Biology', 3, 4),
  (7, 'Quantum Physics', 'Physics', 3, 3), (8, 'Watercolor Studio', 'Fine Arts', 2, 5);
INSERT INTO enrollment VALUES
  (1, 1, 1, 'A', 'Fall 2025'), (2, 1, 2, 'A-', 'Fall 2025'),
  (3, 1, 3, 'B+', 'Spring 2026'), (4, 2, 1, 'B', 'Fall 2025'),
  (5, 2, 2, 'C+', 'Spring 2026'), (6, 3, 2, 'A', 'Fall 2025'),
  (7, 3, 4, 'B+', 'Spring 2026'), (8, 4, 1, 'C', 'Fall 2025'),
  (9, 5, 3, 'A', 'Fall 2025'), (10, 5, 4, 'A-', 'Spring 2026'),
  (11, 6, 3, 'B', 'Fall 2025'), (12, 6, 1, 'B-', 'Spring 2026'),
  (13, 7, 4, 'A', 'Fall 2025'), (14, 7, 3, 'A-', 'Spring 2026'),
  (15, 8, 5, 'B', 'Fall 2025'), (16, 9, 5, 'A', 'Fall 2025'),
  (17, 9, 6, 'B+', 'Spring 2026'), (18, 10, 6, 'A', 'Fall 2025'),
  (19, 10, 5, 'C+', 'Spring 2026'), (20, 4, 6, 'D', 'Spring 2026');
`;

const CATALOG_DDL = `
CREATE TABLE PRODUCT (
  ITEMCODE CHAR(3) PRIMARY KEY,
  ITEMNAME VARCHAR(30) NOT NULL,
  UNITPRICE DECIMAL(8,2),
  STOCKQTY INTEGER,
  DISCOUNTRATE DECIMAL(5,2),
  RATING INTEGER
);
INSERT INTO PRODUCT VALUES
  ('BAG', 'Canvas Tote', 18.50, 48, 0.10, 4),
  ('BOT', 'Glass Bottle', 12.00, 120, 0.05, 3),
  ('BRU', 'Bamboo Brush', 9.75, 75, 0.00, 4),
  ('CND', 'Cedar Candle', 24.00, 36, 0.15, 5),
  ('DSK', 'Desk Organizer', 32.50, 28, 0.10, 4),
  ('JRN', 'Linen Journal', 16.25, 64, 0.05, 5),
  ('KIT', 'Repair Kit', 45.00, 18, 0.20, 5),
  ('LMP', 'Reading Lamp', 54.00, 22, 0.10, 5),
  ('MUG', 'Stoneware Mug', 14.50, 90, 0.05, 4),
  ('PLN', 'Weekly Planner', 21.00, 55, 0.00, 3);
`;

const COMMUNITY_DDL = `
CREATE TABLE MEMBER (
  MEMBER_ID INTEGER PRIMARY KEY,
  LAST_NAME VARCHAR(20),
  FIRST_NAME VARCHAR(20),
  PHONE CHAR(7),
  REGION CHAR(2),
  CITY VARCHAR(20)
);
CREATE TABLE CAMPAIGN (
  CAMPAIGN_YEAR INTEGER PRIMARY KEY,
  TARGET INTEGER
);
CREATE TABLE PLEDGE (
  AMOUNT DECIMAL(8,2),
  CAMPAIGN_YEAR INTEGER NOT NULL,
  MEMBER_ID INTEGER NOT NULL,
  PRIMARY KEY (CAMPAIGN_YEAR, MEMBER_ID),
  CONSTRAINT pledge_campaign_fk FOREIGN KEY (CAMPAIGN_YEAR)
    REFERENCES CAMPAIGN (CAMPAIGN_YEAR) ON DELETE CASCADE,
  CONSTRAINT pledge_member_fk FOREIGN KEY (MEMBER_ID)
    REFERENCES MEMBER (MEMBER_ID) ON DELETE CASCADE
);
INSERT INTO MEMBER VALUES
  (201, 'Navarro', 'Lena', '5552101', 'NW', 'Cedar Bay'),
  (202, 'Kim', 'Owen', '5552102', 'NW', 'Harborview'),
  (203, 'Okafor', 'Amara', '5552103', 'SE', 'Pine Ridge'),
  (204, 'Bennett', 'Theo', '5552104', 'SW', 'Mesa Vista'),
  (205, 'Rossi', 'Maya', '5552105', 'NE', 'Brookfield'),
  (206, 'Singh', 'Ravi', '5552106', 'MW', 'Lakehurst'),
  (207, 'Alvarez', 'Lena', '5552107', 'SW', 'Redstone'),
  (208, 'Chen', 'Eli', '5552108', 'NE', 'Fairview'),
  (209, 'Morgan', 'Maya', '5552109', 'SE', 'Ashford'),
  (210, 'Dubois', 'Noa', '5552110', 'MW', 'Glenhaven'),
  (211, 'Patel', 'Imani', '5552111', 'NW', 'Cedar Bay'),
  (212, 'Brooks', 'Eli', '5552112', 'NE', 'Westport');
INSERT INTO CAMPAIGN VALUES
  (2022, 1800), (2023, 2000), (2024, 2400), (2025, 2600);
INSERT INTO PLEDGE VALUES
  (120, 2022, 201), (275, 2022, 203), (450, 2022, 205),
  (180, 2022, 206), (325, 2022, 208), (600, 2022, 210),
  (200, 2023, 201), (150, 2023, 202), (500, 2023, 203),
  (225, 2023, 207), (375, 2023, 209), (425, 2023, 211),
  (240, 2024, 202), (700, 2024, 203), (310, 2024, 205),
  (260, 2024, 206), (480, 2024, 208), (520, 2024, 210), (190, 2024, 212),
  (300, 2025, 201), (650, 2025, 203), (420, 2025, 205), (390, 2025, 209);
`;

const STAFF_DDL = `
CREATE TABLE STAFF (
  STAFF_ID INTEGER PRIMARY KEY,
  FIRST_NAME VARCHAR(20),
  SALARY INTEGER,
  TEAM VARCHAR(20),
  MANAGER_ID INTEGER,
  CONSTRAINT staff_manager_fk FOREIGN KEY (MANAGER_ID) REFERENCES STAFF (STAFF_ID)
);
INSERT INTO STAFF VALUES
  (1, 'Rowan', 82000, 'Leadership', 1), (2, 'Keira', 52000, 'Design', 1),
  (3, 'Milo', 34000, 'Design', 2), (4, 'Talia', 38000, 'Design', 2),
  (5, 'Jonah', 61000, 'Engineering', 1), (6, 'Priya', 47000, 'Engineering', 5),
  (7, 'Felix', 73000, 'Engineering', 5), (8, 'Zuri', 49000, 'Operations', 1),
  (9, 'Mateo', 36000, 'Operations', 8), (10, 'Hana', 44000, 'Support', 8),
  (11, 'Iris', 32000, 'Support', 10);
`;

const MAKERSPACE_DDL = `
CREATE TABLE AREA (
  AREA_NAME VARCHAR(20) PRIMARY KEY,
  FLOOR_NO INTEGER,
  EXTENSION CHAR(8)
);
CREATE TABLE WORKER (
  WORKER_ID INTEGER PRIMARY KEY,
  WORKER_NAME VARCHAR(20),
  WAGE INTEGER,
  AREA_NAME VARCHAR(20),
  SUPERVISOR_ID INTEGER,
  CONSTRAINT worker_area_fk FOREIGN KEY (AREA_NAME) REFERENCES AREA (AREA_NAME),
  CONSTRAINT worker_supervisor_fk FOREIGN KEY (SUPERVISOR_ID) REFERENCES WORKER (WORKER_ID)
);
CREATE TABLE MATERIAL (
  MATERIAL_NAME VARCHAR(30) PRIMARY KEY,
  MATERIAL_TYPE CHAR(1),
  COLOR VARCHAR(10)
);
CREATE TABLE CHECKOUT (
  CHECKOUT_ID INTEGER PRIMARY KEY,
  QUANTITY INTEGER,
  MATERIAL_NAME VARCHAR(30),
  AREA_NAME VARCHAR(20),
  CONSTRAINT checkout_material_fk FOREIGN KEY (MATERIAL_NAME) REFERENCES MATERIAL (MATERIAL_NAME),
  CONSTRAINT checkout_area_fk FOREIGN KEY (AREA_NAME) REFERENCES AREA (AREA_NAME)
);
CREATE TABLE VENDOR (
  VENDOR_ID INTEGER PRIMARY KEY,
  VENDOR_NAME VARCHAR(20)
);
CREATE TABLE RESTOCK (
  RESTOCK_ID INTEGER PRIMARY KEY,
  QUANTITY INTEGER,
  MATERIAL_NAME VARCHAR(30),
  AREA_NAME VARCHAR(20),
  VENDOR_ID INTEGER,
  CONSTRAINT restock_material_fk FOREIGN KEY (MATERIAL_NAME) REFERENCES MATERIAL (MATERIAL_NAME),
  CONSTRAINT restock_area_fk FOREIGN KEY (AREA_NAME) REFERENCES AREA (AREA_NAME),
  CONSTRAINT restock_vendor_fk FOREIGN KEY (VENDOR_ID) REFERENCES VENDOR (VENDOR_ID)
);
INSERT INTO AREA VALUES
  ('Administration', 4, '555-3100'), ('Textiles', 2, '555-3110'),
  ('Woodshop', 1, '555-3120'), ('Ceramics', 1, '555-3130'),
  ('Electronics', 3, '555-3140'), ('Print Lab', 2, '555-3150');
INSERT INTO WORKER VALUES
  (1, 'Sage', 78000, 'Administration', 1), (2, 'Niko', 51000, 'Textiles', 1),
  (3, 'Ari', 46000, 'Woodshop', 1), (4, 'Leila', 44000, 'Ceramics', 2),
  (5, 'Quinn', 56000, 'Electronics', 1), (6, 'Dara', 43000, 'Print Lab', 5);
INSERT INTO MATERIAL VALUES
  ('Cotton Thread', 'T', 'Blue'), ('Denim Roll', 'T', 'Blue'),
  ('Canvas Sheet', 'T', 'Natural'), ('Maple Board', 'W', 'Tan'),
  ('Clay Block', 'C', 'Gray'), ('Sensor Pack', 'E', 'Blue'),
  ('Solder Wire', 'E', 'Silver'), ('Ink Set', 'P', NULL),
  ('Screen Mesh', 'P', 'White'), ('Glaze Jar', 'C', 'Blue');
INSERT INTO CHECKOUT VALUES
  (3001, 3, 'Cotton Thread', 'Textiles'), (3002, 2, 'Denim Roll', 'Textiles'),
  (3003, 5, 'Canvas Sheet', 'Textiles'), (3004, 4, 'Maple Board', 'Woodshop'),
  (3005, 6, 'Clay Block', 'Ceramics'), (3006, 2, 'Sensor Pack', 'Electronics'),
  (3007, 1, 'Solder Wire', 'Electronics'), (3008, 3, 'Ink Set', 'Print Lab'),
  (3009, 2, 'Screen Mesh', 'Print Lab'), (3010, 4, 'Glaze Jar', 'Ceramics'),
  (3011, 1, 'Denim Roll', 'Textiles'), (3012, 2, 'Cotton Thread', 'Textiles');
INSERT INTO VENDOR VALUES
  (401, 'Northline Supply'), (402, 'Craft Harbor'), (403, 'Circuit Foundry');
INSERT INTO RESTOCK VALUES
  (51, 20, 'Cotton Thread', 'Textiles', 401), (52, 12, 'Denim Roll', 'Textiles', 402),
  (53, 16, 'Canvas Sheet', 'Textiles', 401), (54, 10, 'Maple Board', 'Woodshop', 402),
  (55, 24, 'Clay Block', 'Ceramics', 401), (56, 15, 'Sensor Pack', 'Electronics', 403),
  (57, 18, 'Solder Wire', 'Electronics', 403), (58, 10, 'Ink Set', 'Print Lab', 402),
  (59, 14, 'Screen Mesh', 'Print Lab', 401), (60, 12, 'Glaze Jar', 'Ceramics', 402);
`;

export const PRELOADED_SCHEMAS: SchemaDef[] = [
  {
    id: 'university',
    name: 'University sandbox',
    description: 'Student, course, instructor and enrollment tables for open-ended relational query practice.',
    ddl: UNIVERSITY_DDL,
    starterQuery:
      'SELECT s.name, c.title\nFROM student s\nJOIN enrollment e ON s.student_id = e.student_id\nJOIN course c ON e.course_id = c.course_id',
    positions: {
      student: { x: 0, y: 60 },
      enrollment: { x: 560, y: 320 },
      course: { x: 1200, y: 60 },
      instructor: { x: 1860, y: 340 },
    },
  },
  {
    id: 'catalog',
    name: 'Product catalog',
    description: 'Ten fictional shop products for projection, filtering, computed columns, pattern matching and sorting.',
    ddl: CATALOG_DDL,
    starterQuery: 'SELECT ITEMNAME, ITEMCODE FROM PRODUCT',
  },
  {
    id: 'community',
    name: 'Community campaigns',
    description: 'Members, campaign targets and pledges. PLEDGE has a composite key and two foreign keys; one member has no pledge for outer-join practice.',
    ddl: COMMUNITY_DDL,
    starterQuery: 'SELECT LAST_NAME, FIRST_NAME, REGION FROM MEMBER',
  },
  {
    id: 'makerspace',
    name: 'Makerspace inventory',
    description: 'Areas, workers, materials, checkouts, restocks and vendors for NULL checks and chained multi-table joins.',
    ddl: MAKERSPACE_DDL,
    starterQuery: "SELECT MATERIAL_NAME, COLOR FROM MATERIAL WHERE COLOR = 'Blue' AND MATERIAL_TYPE = 'T'",
  },
  {
    id: 'staff',
    name: 'Staff hierarchy',
    description: 'A fictional staff table where MANAGER_ID references STAFF_ID in the same relation. Used for GROUP BY, HAVING and self-joins.',
    ddl: STAFF_DDL,
    starterQuery: 'SELECT TEAM, AVG(SALARY) FROM STAFF GROUP BY TEAM',
  },
];

export function schemaById(id: string): SchemaDef | undefined {
  return PRELOADED_SCHEMAS.find((schema) => schema.id === id);
}
