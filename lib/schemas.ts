/* Preloadable schemas. SHARES, DONOR and EMP carry the exact data printed in
   the ISTM 315 SQL Workbook (Fall 2025). SALES is reconstructed from the
   workbook's ER diagram (Sale, DeliveryItem, Dept, Employee, Supplier with
   Manages / Works in / Boss of) with illustrative rows sized so the workbook
   practice queries all produce meaningful, fully visible results. */

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
  /** Parent table (arrow tail sits at its PK column). */
  source: string;
  sourceHandle: string;
  /** Dependent table (arrowhead lands on its FK column). */
  target: string;
  targetHandle: string;
}

export interface SchemaDef {
  id: string;
  name: string;
  description: string;
  ddl: string;
  starterQuery: string;
  /** Optional hand layout; schemas without one are auto-arranged. */
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

INSERT INTO student (student_id, name, major, gpa, year) VALUES
  (1,  'Ava Chen',     'CS',      3.9,  3),
  (2,  'Marcus Webb',  'CS',      3.2,  2),
  (3,  'Priya Patel',  'CS',      3.7,  4),
  (4,  'Jordan Lee',   'CS',      2.8,  1),
  (5,  'Sofia Reyes',  'Math',    3.6,  3),
  (6,  'Ethan Brooks', 'Math',    3.1,  2),
  (7,  'Lily Zhang',   'Math',    3.8,  4),
  (8,  'Noah Kim',     'Physics', 2.9,  1),
  (9,  'Emma Davis',   'Physics', 3.5,  3),
  (10, 'Omar Hassan',  'Biology', 3.4,  2),
  (11, 'Grace Miller', 'Biology', 3.95, 4),
  (12, 'Leo Martin',   'Art',     2.5,  1);

INSERT INTO instructor (instructor_id, name, department) VALUES
  (1, 'Dr. Susan Hale',   'Computer Science'),
  (2, 'Dr. Raj Mehta',    'Mathematics'),
  (3, 'Dr. Elena Petrov', 'Physics'),
  (4, 'Dr. James Okafor', 'Biology'),
  (5, 'Dr. Marie Dubois', 'Fine Arts');

INSERT INTO course (course_id, title, department, credits, instructor_id) VALUES
  (1, 'Intro to Programming', 'Computer Science', 4, 1),
  (2, 'Data Structures',      'Computer Science', 4, 1),
  (3, 'Calculus I',           'Mathematics',      4, 2),
  (4, 'Linear Algebra',       'Mathematics',      3, 2),
  (5, 'Mechanics',            'Physics',          4, 3),
  (6, 'Genetics',             'Biology',          3, 4),
  (7, 'Quantum Physics',      'Physics',          3, 3),
  (8, 'Watercolor Studio',    'Fine Arts',        2, 5);

INSERT INTO enrollment (enrollment_id, student_id, course_id, grade, semester) VALUES
  (1,  1,  1, 'A',  'Fall 2025'),
  (2,  1,  2, 'A-', 'Fall 2025'),
  (3,  1,  3, 'B+', 'Spring 2026'),
  (4,  2,  1, 'B',  'Fall 2025'),
  (5,  2,  2, 'C+', 'Spring 2026'),
  (6,  3,  2, 'A',  'Fall 2025'),
  (7,  3,  4, 'B+', 'Spring 2026'),
  (8,  4,  1, 'C',  'Fall 2025'),
  (9,  5,  3, 'A',  'Fall 2025'),
  (10, 5,  4, 'A-', 'Spring 2026'),
  (11, 6,  3, 'B',  'Fall 2025'),
  (12, 6,  1, 'B-', 'Spring 2026'),
  (13, 7,  4, 'A',  'Fall 2025'),
  (14, 7,  3, 'A-', 'Spring 2026'),
  (15, 8,  5, 'B',  'Fall 2025'),
  (16, 9,  5, 'A',  'Fall 2025'),
  (17, 9,  6, 'B+', 'Spring 2026'),
  (18, 10, 6, 'A',  'Fall 2025'),
  (19, 10, 5, 'C+', 'Spring 2026'),
  (20, 4,  6, 'D',  'Spring 2026');
`;

const SHARES_DDL = `
CREATE TABLE SHARES (
  SHRCODE  CHAR(3) PRIMARY KEY,
  SHRFIRM  VARCHAR(30) NOT NULL,
  SHRPRICE DECIMAL(8,2),
  SHRQTY   INTEGER,
  SHRDIV   DECIMAL(6,2),
  SHRPE    INTEGER
);

INSERT INTO SHARES VALUES
  ('AR',  'Abyssinian Ruby',     31.82, 22010,   1.32, 13),
  ('BE',  'Burmese Elephant',     0.07, 154713,  0.01, 3),
  ('BS',  'Bolivian Sheep',      12.75, 231678,  1.78, 11),
  ('CS',  'Canadian Sugar',      52.78, 4716,    2.50, 15),
  ('FC',  'Freedonia Copper',    27.50, 10529,   1.84, 16),
  ('ILZ', 'Indian Lead & Zinc',  37.75, 6390,    3.00, 12),
  ('NG',  'Nigerian Geese',      35.00, 12323,   1.68, 10),
  ('PT',  'Patagonian Tea',      55.25, 12635,   2.50, 10),
  ('ROF', 'Royal Ostrich Farms', 33.75, 1234923, 3.00, 6),
  ('SLG', 'Sri Lankan Gold',     50.37, 32868,   2.68, 16);
`;

const DONOR_DDL = `
CREATE TABLE DONOR (
  DONORNO INTEGER PRIMARY KEY,
  DLNAME  VARCHAR(20),
  DFNAME  VARCHAR(20),
  DPHONE  CHAR(7),
  DSTATE  CHAR(2),
  DCITY   VARCHAR(20)
);

CREATE TABLE YEAR (
  YEAR     INTEGER PRIMARY KEY,
  YEARGOAL INTEGER
);

CREATE TABLE GIFT (
  AMOUNT  DECIMAL(8,2),
  YEAR    INTEGER NOT NULL,
  DONORNO INTEGER NOT NULL,
  PRIMARY KEY (YEAR, DONORNO),
  CONSTRAINT gift_year_fk FOREIGN KEY (YEAR) REFERENCES YEAR (YEAR) ON DELETE CASCADE,
  CONSTRAINT gift_donor_fk FOREIGN KEY (DONORNO) REFERENCES DONOR (DONORNO) ON DELETE CASCADE
);

INSERT INTO DONOR VALUES
  (101, 'Abrams',     'Louis',    '5559018', 'GA', 'London'),
  (102, 'Aldinger',   'Dmitry',   '5551521', 'GA', 'Paris'),
  (103, 'Beckman',    'Gulsen',   '5558247', 'WA', 'Sao Paulo'),
  (104, 'Berdahl',    'Samuel',   '5558149', 'WI', 'Sydney'),
  (105, 'Borneman',   'Joanna',   '5551888', 'MD', 'Bombay'),
  (106, 'Brock',      'Scott',    '5552142', 'AL', 'London'),
  (107, 'Buyert',     'Aylin',    '5559355', 'AK', 'New York'),
  (108, 'Cetinsoy',   'Girwan',   '5556346', 'AZ', 'Rome'),
  (109, 'Chisholm',   'John',     '5554482', 'MA', 'Oslo'),
  (110, 'Crowder',    'Anthony',  '5556513', 'NC', 'Stockholm'),
  (111, 'Dishman',    'Michelle', '5553903', 'NC', 'Helsinki'),
  (112, 'Duke',       'Peter',    '5554939', 'FL', 'Tokyo'),
  (113, 'Evans',      'Ann',      '5554336', 'GA', 'Singapore'),
  (114, 'Frawley',    'Todd',     '5554785', 'MN', 'Perth'),
  (115, 'Guo',        'John',     '5556247', 'MN', 'Moscow'),
  (116, 'Hammann',    'John',     '5555369', 'ND', 'Kabul'),
  (117, 'Hays',       'Cami',     '5551352', 'SD', 'Lima'),
  (118, 'Hefts',      'Thomas',   '5556872', 'MT', 'London'),
  (119, 'Herskowitz', 'Robert',   '5558103', 'ME', 'Oslo');

INSERT INTO YEAR VALUES (2012, 5000), (2013, 5000), (2014, 5500), (2015, 5000);

INSERT INTO GIFT VALUES
  (82,   2012, 117), (186,  2012, 119), (223,  2012, 114), (373,  2012, 101),
  (543,  2012, 102), (582,  2012, 110), (666,  2012, 112), (838,  2012, 109),
  (887,  2012, 111), (1185, 2012, 103),
  (268,  2013, 116), (297,  2013, 110), (332,  2013, 111), (558,  2013, 115),
  (667,  2013, 105), (674,  2013, 108), (772,  2013, 119), (899,  2013, 102),
  (939,  2013, 101), (1362, 2013, 103),
  (84,   2014, 110), (111,  2014, 102), (155,  2014, 108), (332,  2014, 107),
  (345,  2014, 116), (499,  2014, 109), (560,  2014, 113), (835,  2014, 114),
  (882,  2014, 111), (5208, 2014, 103),
  (17,   2015, 118), (60,   2015, 106), (265,  2015, 116), (657,  2015, 117),
  (812,  2015, 112), (823,  2015, 110), (1865, 2015, 103);
`;

const EMP_DDL = `
CREATE TABLE EMP (
  EMPNO     INTEGER PRIMARY KEY,
  EMPFNAME  VARCHAR(20),
  EMPSALARY INTEGER,
  DEPTNAME  VARCHAR(20),
  BOSS      INTEGER,
  CONSTRAINT emp_boss_fk FOREIGN KEY (BOSS) REFERENCES EMP (EMPNO)
);

INSERT INTO EMP VALUES
  (1,  'Alice',  75000, 'Management', 1),
  (2,  'Ned',    45000, 'Marketing',  1),
  (3,  'Andrew', 25000, 'Marketing',  2),
  (4,  'Clare',  22000, 'Marketing',  2),
  (5,  'Todd',   38000, 'Accounting', 1),
  (6,  'Nancy',  22000, 'Accounting', 5),
  (7,  'Brier',  43000, 'Purchasing', 1),
  (8,  'Sarah',  56000, 'Purchasing', 7),
  (9,  'Sophie', 35000, 'Personnel',  1),
  (10, 'Bryan',  42000, 'Personnel',  9),
  (11, 'Chad',   32000, 'Personnel',  9);
`;

const SALES_DDL = `
CREATE TABLE DEPT (
  DNAME  VARCHAR(20) PRIMARY KEY,
  DFLOOR INTEGER,
  DPHONE CHAR(8)
);

CREATE TABLE EMPLOYEE (
  ENUM    INTEGER PRIMARY KEY,
  ENAME   VARCHAR(20),
  ESALARY INTEGER,
  DNAME   VARCHAR(20),
  BOSS    INTEGER,
  CONSTRAINT emp_dept_fk FOREIGN KEY (DNAME) REFERENCES DEPT (DNAME),
  CONSTRAINT emp_boss_fk FOREIGN KEY (BOSS) REFERENCES EMPLOYEE (ENUM)
);

CREATE TABLE ITEM (
  INAME  VARCHAR(30) PRIMARY KEY,
  ITYPE  CHAR(1),
  ICOLOR VARCHAR(10)
);

CREATE TABLE SALE (
  SALENO  INTEGER PRIMARY KEY,
  SALEQTY INTEGER,
  INAME   VARCHAR(30),
  DNAME   VARCHAR(20),
  CONSTRAINT sale_item_fk FOREIGN KEY (INAME) REFERENCES ITEM (INAME),
  CONSTRAINT sale_dept_fk FOREIGN KEY (DNAME) REFERENCES DEPT (DNAME)
);

CREATE TABLE SUPPLIER (
  SUPNO INTEGER PRIMARY KEY,
  SNAME VARCHAR(20)
);

CREATE TABLE DELIVERY (
  DELNO  INTEGER PRIMARY KEY,
  DELQTY INTEGER,
  INAME  VARCHAR(30),
  DNAME  VARCHAR(20),
  SUPNO  INTEGER,
  CONSTRAINT del_item_fk FOREIGN KEY (INAME) REFERENCES ITEM (INAME),
  CONSTRAINT del_dept_fk FOREIGN KEY (DNAME) REFERENCES DEPT (DNAME),
  CONSTRAINT del_sup_fk FOREIGN KEY (SUPNO) REFERENCES SUPPLIER (SUPNO)
);

INSERT INTO DEPT VALUES
  ('Management', 5, '555-0100'),
  ('Recreation', 2, '555-0110'),
  ('Books',      1, '555-0120'),
  ('Clothes',    2, '555-0130'),
  ('Equipment',  3, '555-0140'),
  ('Navigation', 1, '555-0150');

INSERT INTO EMPLOYEE VALUES
  (1, 'Alice', 75000, 'Management', 1),
  (2, 'Ned',   45000, 'Recreation', 1),
  (3, 'Andrew',25000, 'Books',      1),
  (4, 'Clare', 22000, 'Clothes',    2),
  (5, 'Todd',  38000, 'Navigation', 1),
  (6, 'Nancy', 22000, 'Equipment',  5);

INSERT INTO ITEM VALUES
  ('Elephant polo stick',   'R', 'Brown'),
  ('Slingshot',             'R', 'Brown'),
  ('Safari chair',          'R', 'Khaki'),
  ('Pocket knife',          'E', 'Brown'),
  ('Tent',                  'E', 'Green'),
  ('Boots',                 'C', 'Brown'),
  ('Map case',              'N', 'Brown'),
  ('Geo positioning system','N', 'Silver'),
  ('Compass',               'N', 'Brown'),
  ('Star chart',            'B', NULL);

INSERT INTO SALE VALUES
  (1001, 2, 'Elephant polo stick',    'Recreation'),
  (1002, 1, 'Slingshot',              'Recreation'),
  (1003, 4, 'Boots',                  'Clothes'),
  (1004, 1, 'Map case',               'Navigation'),
  (1005, 2, 'Pocket knife',           'Equipment'),
  (1006, 1, 'Pocket knife',           'Recreation'),
  (1007, 3, 'Tent',                   'Equipment'),
  (1008, 1, 'Compass',                'Navigation'),
  (1009, 2, 'Boots',                  'Recreation'),
  (1010, 1, 'Geo positioning system', 'Navigation'),
  (1011, 5, 'Slingshot',              'Recreation'),
  (1012, 1, 'Safari chair',           'Recreation');

INSERT INTO SUPPLIER VALUES
  (101, 'Global Gear'),
  (102, 'Outdoor Traders'),
  (103, 'Nomad Supplies');

INSERT INTO DELIVERY VALUES
  (51, 10, 'Elephant polo stick',    'Recreation', 101),
  (52, 5,  'Slingshot',              'Recreation', 102),
  (53, 8,  'Boots',                  'Clothes',    103),
  (54, 3,  'Map case',               'Navigation', 101),
  (55, 6,  'Pocket knife',           'Equipment',  102),
  (56, 4,  'Tent',                   'Equipment',  101),
  (57, 2,  'Star chart',             'Books',      103),
  (58, 3,  'Compass',                'Navigation', 102),
  (59, 2,  'Geo positioning system', 'Navigation', 101),
  (60, 5,  'Safari chair',           'Recreation', 103);
`;

export const PRELOADED_SCHEMAS: SchemaDef[] = [
  {
    id: 'university',
    name: 'University (sandbox)',
    description:
      'Student, course, instructor and enrollment tables. A general sandbox with primary key–foreign key mates across four tables.',
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
    id: 'shares',
    name: 'SHARES (workbook 1)',
    description:
      'One table of ten stock holdings. The workbook uses it for basic queries: projection, WHERE, computed columns, LIKE and aggregates.',
    ddl: SHARES_DDL,
    starterQuery: 'SELECT SHRFIRM, SHRCODE FROM SHARES',
  },
  {
    id: 'donor',
    name: 'DONOR (workbook 2)',
    description:
      'Donors, yearly goals and gifts. DONOR is the parent table; GIFT is the dependent table with two foreign keys. Donor 104 has never given (useful for outer joins).',
    ddl: DONOR_DDL,
    starterQuery: 'SELECT DLNAME, DFNAME, DSTATE FROM DONOR',
  },
  {
    id: 'sales',
    name: 'SALES (workbook 3)',
    description:
      'Departments, employees, items, sales, deliveries and suppliers, built from the workbook ER diagram. Sample data sized so every workbook query has visible results.',
    ddl: SALES_DDL,
    starterQuery:
      "SELECT INAME, ICOLOR FROM ITEM WHERE ICOLOR = 'Brown' AND ITYPE = 'R'",
  },
  {
    id: 'emp',
    name: 'EMP (workbook 4)',
    description:
      'A single employee table where BOSS is a foreign key back to EMPNO in the same table. Used for GROUP BY and HAVING practice.',
    ddl: EMP_DDL,
    starterQuery: 'SELECT DEPTNAME, AVG(EMPSALARY) FROM EMP GROUP BY DEPTNAME',
  },
];

export function schemaById(id: string): SchemaDef | undefined {
  return PRELOADED_SCHEMAS.find((s) => s.id === id);
}
