import type { SchemaDef } from '../../lib/schemas';
import type { Case } from '../testDialects';

const custom = (name: string, ddl: string): SchemaDef => ({ id: 'custom', name, description: '', ddl, starterQuery: 'SELECT 1;' });

/* ---------------------------------------------------------------- MySQL Workbench forward-engineer */
const GYM_WB = `-- MySQL Workbench Forward Engineering

SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;
SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;
SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- -----------------------------------------------------
-- Schema gym
-- -----------------------------------------------------
CREATE SCHEMA IF NOT EXISTS \`gym\` DEFAULT CHARACTER SET utf8mb4 ;
USE \`gym\` ;

-- -----------------------------------------------------
-- Table \`gym\`.\`member\`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS \`gym\`.\`member\` (
  \`member_id\` INT NOT NULL AUTO_INCREMENT,
  \`full_name\` VARCHAR(80) NOT NULL,
  \`plan\` ENUM('basic', 'plus') NOT NULL DEFAULT 'basic',
  \`joined\` DATE NOT NULL,
  \`height_cm\` DECIMAL(5,1) NULL,
  PRIMARY KEY (\`member_id\`),
  UNIQUE INDEX \`full_name_UNIQUE\` (\`full_name\` ASC) VISIBLE)
ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS \`gym\`.\`class\` (
  \`class_id\` INT NOT NULL AUTO_INCREMENT,
  \`title\` VARCHAR(45) NOT NULL,
  \`weekday\` TINYINT NOT NULL,
  \`starts\` TIME NOT NULL,
  PRIMARY KEY (\`class_id\`))
ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS \`gym\`.\`booking\` (
  \`member_id\` INT NOT NULL,
  \`class_id\` INT NOT NULL,
  \`booked_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`attended\` TINYINT(1) NULL DEFAULT 0,
  PRIMARY KEY (\`member_id\`, \`class_id\`),
  INDEX \`fk_booking_class_idx\` (\`class_id\` ASC) VISIBLE,
  CONSTRAINT \`fk_booking_member\`
    FOREIGN KEY (\`member_id\`)
    REFERENCES \`gym\`.\`member\` (\`member_id\`)
    ON DELETE CASCADE
    ON UPDATE NO ACTION,
  CONSTRAINT \`fk_booking_class\`
    FOREIGN KEY (\`class_id\`)
    REFERENCES \`gym\`.\`class\` (\`class_id\`)
    ON DELETE NO ACTION
    ON UPDATE NO ACTION)
ENGINE = InnoDB;

SET SQL_MODE=@OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;

INSERT INTO \`gym\`.\`member\` (\`full_name\`, \`plan\`, \`joined\`, \`height_cm\`) VALUES ('Lena Berg', 'plus', '2025-02-01', 172.5), ('Omar Haddad', 'basic', '2025-03-15', NULL), ('Pia Novak', 'basic', '2025-04-01', 165.0);
INSERT INTO \`gym\`.\`class\` (\`title\`, \`weekday\`, \`starts\`) VALUES ('Yoga', 1, '07:30:00'), ('Spin', 3, '18:00:00'), ('Boxing', 5, '19:15:00');
INSERT INTO \`gym\`.\`booking\` (\`member_id\`, \`class_id\`, \`booked_at\`, \`attended\`) VALUES (1, 1, '2025-05-01 10:00:00', 1), (1, 2, '2025-05-02 11:00:00', 0), (2, 2, '2025-05-02 12:30:00', 1), (3, 3, '2025-05-03 09:00:00', NULL);
`;

const gymCases: Case[] = [
  { sql: 'SELECT m.full_name, c.title, b.attended FROM booking b JOIN member m ON m.member_id = b.member_id JOIN class c ON c.class_id = b.class_id ORDER BY m.full_name, c.title', rows: [['Lena Berg', 'Spin', 0], ['Lena Berg', 'Yoga', 1], ['Omar Haddad', 'Spin', 1], ['Pia Novak', 'Boxing', null]], ordered: true },
  { sql: 'SELECT c.title, COUNT(b.member_id) AS n, SUM(IFNULL(b.attended, 0)) AS att FROM class c LEFT JOIN booking b ON b.class_id = c.class_id GROUP BY c.class_id ORDER BY n DESC, c.title', rows: [['Spin', 2, 1], ['Boxing', 1, 0], ['Yoga', 1, 1]], ordered: true },
  { sql: "SELECT full_name FROM member WHERE plan = 'plus' OR height_cm IS NULL ORDER BY member_id", rows: [['Lena Berg'], ['Omar Haddad']], ordered: true },
  { sql: 'SELECT title, HOUR(starts) AS h, MINUTE(starts) AS m FROM class WHERE weekday BETWEEN 1 AND 3 ORDER BY h', rows: [['Yoga', 7, 30], ['Spin', 18, 0]], ordered: true },
  { sql: "SELECT title, TIME_FORMAT(starts, '%H:%i') AS t FROM class WHERE class_id = 1", rows: [['Yoga', '07:30']] },
  { sql: "SELECT full_name, DATE_FORMAT(joined, '%M %Y') AS j FROM member WHERE member_id = 1", rows: [['Lena Berg', 'February 2025']] },
  { sql: 'SELECT m.full_name FROM member m WHERE NOT EXISTS (SELECT 1 FROM booking b WHERE b.member_id = m.member_id AND b.attended = 1)', rows: [['Pia Novak']] },
  { sql: 'SELECT member_id, COUNT(*) AS n FROM booking GROUP BY member_id HAVING COUNT(*) > 1', rows: [[1, 2]] },
  { sql: 'SELECT full_name, height_cm FROM member ORDER BY height_cm DESC', rows: [['Lena Berg', 172.5], ['Pia Novak', 165], ['Omar Haddad', null]], ordered: true },
  { sql: 'SELECT AVG(height_cm) AS avg_h FROM member', rows: [[168.75]] },
  { sql: "SELECT title FROM class WHERE starts > '12:00:00' ORDER BY starts", rows: [['Spin'], ['Boxing']], ordered: true },
  { sql: "SELECT b.member_id, b.class_id FROM booking b WHERE b.booked_at BETWEEN '2025-05-02 00:00:00' AND '2025-05-02 23:59:59' ORDER BY b.booked_at", rows: [[1, 2], [2, 2]], ordered: true },
  { sql: 'SELECT CAST(booked_at AS DATE) AS d, COUNT(*) AS n FROM booking GROUP BY CAST(booked_at AS DATE) ORDER BY d', rows: [['2025-05-01', 1], ['2025-05-02', 2], ['2025-05-03', 1]], ordered: true },
  { sql: 'SELECT DATE(booked_at) AS d, COUNT(*) AS n FROM booking GROUP BY d', rows: [['2025-05-01', 1], ['2025-05-02', 2], ['2025-05-03', 1]] },
  { sql: "SELECT full_name, CONCAT(YEAR(joined), '-', LPAD(MONTH(joined), 2, '0')) AS ym FROM member ORDER BY member_id", rows: [['Lena Berg', '2025-02'], ['Omar Haddad', '2025-03'], ['Pia Novak', '2025-04']], ordered: true },
  { sql: 'INSERT INTO booking (member_id, class_id) VALUES (2, 1)', ok: true },
  { sql: 'SELECT attended, booked_at IS NOT NULL AS stamped FROM booking WHERE member_id = 2 AND class_id = 1', rows: [[0, 1]] },
  { sql: 'INSERT INTO booking (member_id, class_id) VALUES (2, 1)', reject: /unique|already/i },
  { sql: 'UPDATE booking SET attended = 1 WHERE member_id = 2 AND class_id = 1', ok: true },
  { sql: 'DELETE FROM class WHERE class_id = 1', reject: /FOREIGN KEY|refer/i },
  { sql: 'DELETE FROM member WHERE member_id = 2', ok: true },
  { sql: 'SELECT COUNT(*) FROM booking', rows: [[3]] },
  { sql: "INSERT INTO member (full_name, plan, joined) VALUES ('Lena Berg', 'basic', '2025-06-01')", reject: /unique|already/i },
  { sql: 'ALTER TABLE member ADD COLUMN email VARCHAR(50)', reject: /SCHEMA/ },
  { sql: "SELECT full_name FROM member WHERE joined >= CURDATE() - INTERVAL 5 YEAR ORDER BY 1", rows: [['Lena Berg'], ['Pia Novak']], ordered: true },
];

/* ---------------------------------------------------------------- SQL Server, hand-written student style */
const SCHOOL_TSQL = `
CREATE TABLE Students (
  StudentID INT PRIMARY KEY IDENTITY(1,1),
  FirstName NVARCHAR(50) NOT NULL,
  LastName NVARCHAR(50) NOT NULL,
  DOB DATE,
  GPA DECIMAL(3,2) CHECK (GPA BETWEEN 0 AND 4),
  Active BIT DEFAULT 1
);
GO
CREATE TABLE Grades (
  GradeID INT IDENTITY PRIMARY KEY,
  StudentID INT FOREIGN KEY REFERENCES Students(StudentID),
  Course VARCHAR(20),
  Score INT
);
GO
INSERT INTO Students (FirstName, LastName, DOB, GPA) VALUES ('Ann', 'Lee', '2001-04-05', 3.5), ('Bo', 'Kim', '2000-12-25', 2.8);
INSERT INTO Grades (StudentID, Course, Score) VALUES (1, 'Math', 90), (1, 'Art', 85), (2, 'Math', 70);
GO
`;

const tsqlCases: Case[] = [
  { sql: "SELECT s.FirstName + ' ' + s.LastName AS Name, AVG(g.Score) AS Avg FROM Students s JOIN Grades g ON g.StudentID = s.StudentID GROUP BY s.StudentID, s.FirstName, s.LastName ORDER BY Avg DESC", rows: [['Ann Lee', 87.5], ['Bo Kim', 70]], ordered: true },
  { sql: 'SELECT TOP 1 WITH TIES Course FROM Grades ORDER BY Score DESC', rows: [['Math']] },
  { sql: "SELECT FirstName, DATEDIFF(year, DOB, '2026-01-01') AS Age, DATENAME(weekday, DOB) AS Wd FROM Students ORDER BY StudentID", rows: [['Ann', 25, 'Thursday'], ['Bo', 26, 'Monday']], ordered: true },
  { sql: "SELECT FirstName, IIF(GPA >= 3, 'honors', 'regular') AS Band, CAST(GPA AS VARCHAR(10)) AS G FROM Students ORDER BY 1", rows: [['Ann', 'honors', '3.5'], ['Bo', 'regular', '2.8']], ordered: true },
  { sql: 'SELECT Course, MAX(Score) AS Best FROM Grades GROUP BY Course HAVING MAX(Score) >= 85 ORDER BY Course', rows: [['Art', 85], ['Math', 90]], ordered: true },
  { sql: 'SELECT FirstName FROM Students WHERE StudentID IN (SELECT StudentID FROM Grades WHERE Score > 80) ORDER BY 1', rows: [['Ann']] },
  { sql: 'SELECT COUNT(*) AS n, COUNT(DISTINCT StudentID) AS d, SUM(Score) AS s FROM Grades', rows: [[3, 2, 245]] },
  { sql: 'SELECT FirstName, (SELECT COUNT(*) FROM Grades g WHERE g.StudentID = s.StudentID) AS Cnt FROM Students s ORDER BY Cnt DESC', rows: [['Ann', 2], ['Bo', 1]], ordered: true },
  { sql: 'SELECT UPPER(LEFT(FirstName, 1)) + LOWER(SUBSTRING(FirstName, 2, LEN(FirstName))) AS Proper FROM Students WHERE StudentID = 1', rows: [['Ann']] },
  { sql: "SELECT FirstName + ', ' + LastName + ' (' + CAST(StudentID AS NVARCHAR(5)) + ')' AS Label FROM Students WHERE StudentID = 2", rows: [['Bo, Kim (2)']] },
  { sql: 'UPDATE Students SET GPA = 4.5 WHERE StudentID = 1', reject: /CHECK/ },
  { sql: "INSERT INTO Grades (StudentID, Course, Score) VALUES (9, 'X', 1)", reject: /FOREIGN KEY|refer/i },
  { sql: "INSERT INTO Students (FirstName, LastName) VALUES ('Cy', 'Oh')", ok: true },
  { sql: "SELECT StudentID, Active, GPA FROM Students WHERE FirstName = 'Cy'", rows: [[3, 1, null]] },
  { sql: 'DELETE FROM Students WHERE StudentID = 2', reject: /FOREIGN KEY|refer/i },
  { sql: 'DELETE FROM Grades WHERE StudentID = 2; DELETE FROM Students WHERE StudentID = 2', reject: /one statement/i },
  { sql: 'SELECT * INTO #tmp FROM Students', reject: /SELECT \.\.\. INTO/ },
  { sql: 'SELECT FirstName FROM Students ORDER BY FirstName OFFSET 1 ROWS FETCH NEXT 1 ROWS ONLY', rows: [['Bo']] },
  { sql: "SELECT FirstName FROM Students WHERE DOB < DATEADD(year, -25, '2026-01-01') ORDER BY 1", rows: [['Bo']] },
  { sql: 'SELECT FirstName, ROW_NUMBER() OVER (PARTITION BY Active ORDER BY GPA DESC) AS rn FROM Students WHERE GPA IS NOT NULL ORDER BY rn', rows: [['Ann', 1], ['Bo', 2]], ordered: true },
  { sql: "SELECT ISNULL(CONVERT(VARCHAR(10), DOB, 23), 'n/a') AS d FROM Students ORDER BY StudentID", rows: [['2001-04-05'], ['2000-12-25'], ['n/a']], ordered: true },
];

/* ---------------------------------------------------------------- PostgreSQL app-generated (uuid, jsonb) */
const APP_PG = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TYPE status AS ENUM ('draft', 'live');
CREATE TABLE "Post" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL,
  "status" status NOT NULL DEFAULT 'draft',
  "meta" jsonb,
  "tags" text[] DEFAULT '{}',
  "views" bigint NOT NULL DEFAULT 0,
  "createdAt" timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Post_status_idx" ON "Post" USING btree ("status");
INSERT INTO "Post" ("id", "title", "status", "meta", "tags", "views", "createdAt") VALUES
  ('0c0a5a2e-1111-4d2a-9b1a-000000000001', 'Hello', 'live', '{"likes": 3}', '{intro,news}', 120, '2025-07-01 10:00:00+00'),
  ('0c0a5a2e-1111-4d2a-9b1a-000000000002', 'Draft one', 'draft', NULL, '{}', 0, '2025-07-02 11:30:00+00');
`;

const appPgCases: Case[] = [
  { sql: 'SELECT "title", "views" FROM "Post" WHERE "status" = \'live\'', rows: [['Hello', 120]] },
  { sql: "SELECT title FROM \"Post\" WHERE id = '0c0a5a2e-1111-4d2a-9b1a-000000000002'", rows: [['Draft one']] },
  { sql: 'SELECT title, meta IS NULL AS no_meta FROM "Post" ORDER BY "createdAt"', rows: [['Hello', 0], ['Draft one', 1]], ordered: true },
  { sql: "SELECT title FROM \"Post\" WHERE tags LIKE '%news%'", rows: [['Hello']] },
  { sql: 'SELECT status, COUNT(*) AS n FROM "Post" GROUP BY status ORDER BY status', rows: [['draft', 1], ['live', 1]], ordered: true },
  { sql: 'SELECT title, EXTRACT(HOUR FROM "createdAt") AS h FROM "Post" ORDER BY h', rows: [['Hello', 10], ['Draft one', 11]], ordered: true },
  { sql: "SELECT title FROM \"Post\" WHERE \"createdAt\"::date = '2025-07-02'", rows: [['Draft one']] },
  { sql: "INSERT INTO \"Post\" (\"title\") VALUES ('No id')", ok: true },
  { sql: "SELECT LENGTH(id) AS n, status FROM \"Post\" WHERE title = 'No id'", rows: [[36, 'draft']] },
  { sql: "INSERT INTO \"Post\" (\"id\", \"title\") VALUES ('0c0a5a2e-1111-4d2a-9b1a-000000000003', 'Third')", ok: true },
  { sql: "SELECT status, views, tags FROM \"Post\" WHERE title = 'Third'", rows: [['draft', 0, '{}']] },
  { sql: 'UPDATE "Post" SET views = views + 1, status = \'live\' WHERE title = \'Third\' RETURNING views', ok: true },
  { sql: 'SELECT COUNT(*) FROM "Post" WHERE status = \'live\'', rows: [[2]] },
  { sql: "SELECT title FROM \"Post\" WHERE meta->>'likes' = 3", rows: [['Hello']] },
];

export const PROBES: Array<{ label: string; def: SchemaDef; cases: Case[] }> = [
  { label: 'gym_workbench', def: custom('Gym (Workbench)', GYM_WB), cases: gymCases },
  { label: 'school_tsql', def: custom('School (T-SQL)', SCHOOL_TSQL), cases: tsqlCases },
  { label: 'app_pg', def: custom('App (PostgreSQL)', APP_PG), cases: appPgCases },
];
