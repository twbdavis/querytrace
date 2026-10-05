import type { SchemaDef } from '../../lib/schemas';
import type { Case } from '../testDialects';

const custom = (name: string, ddl: string): SchemaDef => ({ id: 'custom', name, description: '', ddl, starterQuery: 'SELECT 1;' });
const today = new Date().toISOString().slice(0, 10);

/* ---------------------------------------------------------------- PostgreSQL (pgAdmin style) */
const SHOP_PG = `
CREATE TABLE category (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE
);
CREATE TABLE product (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES category(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  in_stock BOOLEAN NOT NULL DEFAULT TRUE,
  tags TEXT[],
  added_on DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
);
INSERT INTO category (name) VALUES ('Tools'), ('Garden'), ('Empty');
INSERT INTO product (category_id, name, price, in_stock, tags, added_on, updated_at) VALUES
 (1, 'Hammer', 12.50, TRUE, '{steel,hand}', '2025-01-15', '2025-01-15 09:30:00'),
 (1, 'Saw', 24.00, FALSE, '{steel}', '2025-02-28', '2025-02-28 14:00:00'),
 (2, 'Trowel', 7.25, TRUE, NULL, '2025-03-01', '2025-03-01 08:15:00'),
 (2, 'Hose', 30.00, TRUE, '{rubber}', '2025-12-31', '2025-12-31 23:59:59');
`;

const pgCases: Case[] = [
  { sql: "SELECT name, price::text AS p FROM product WHERE price::integer > 10 ORDER BY id", rows: [['Hammer', '12.5'], ['Saw', '24.0'], ['Hose', '30.0']], ordered: true },
  { sql: 'SELECT c.name, COUNT(p.id) AS n FROM category c LEFT JOIN product p ON p.category_id = c.id GROUP BY c.id, c.name ORDER BY n DESC, c.name', rows: [['Garden', 2], ['Tools', 2], ['Empty', 0]], ordered: true },
  { sql: 'SELECT name FROM product WHERE in_stock ORDER BY name', rows: [['Hammer'], ['Hose'], ['Trowel']], ordered: true },
  { sql: 'SELECT name FROM product WHERE NOT in_stock', rows: [['Saw']] },
  { sql: 'SELECT name FROM product WHERE in_stock = FALSE', rows: [['Saw']] },
  { sql: 'SELECT name FROM product WHERE in_stock IS TRUE', count: 3 },
  { sql: 'SELECT name, EXTRACT(MONTH FROM added_on) AS m, EXTRACT(DOW FROM added_on) AS dow FROM product ORDER BY id', rows: [['Hammer', 1, 3], ['Saw', 2, 5], ['Trowel', 3, 6], ['Hose', 12, 3]], ordered: true },
  { sql: "SELECT name, added_on + INTERVAL '1 month' AS later FROM product ORDER BY id", rows: [['Hammer', '2025-02-15'], ['Saw', '2025-03-28'], ['Trowel', '2025-04-01'], ['Hose', '2026-01-31']], ordered: true },
  { sql: "SELECT name, DATE_TRUNC('month', updated_at) AS m FROM product WHERE id = 1", rows: [['Hammer', '2025-01-01 00:00:00']] },
  { sql: "SELECT name, TO_CHAR(added_on, 'YYYY-MM') AS ym FROM product WHERE id = 4", rows: [['Hose', '2025-12']] },
  { sql: "SELECT name FROM product WHERE name ILIKE '%h%' ORDER BY name", rows: [['Hammer'], ['Hose']], ordered: true },
  { sql: "SELECT name, COALESCE(tags, 'none') AS t FROM product ORDER BY id", rows: [['Hammer', '{steel,hand}'], ['Saw', '{steel}'], ['Trowel', 'none'], ['Hose', '{rubber}']], ordered: true },
  { sql: 'SELECT name FROM product ORDER BY price DESC NULLS LAST LIMIT 2', rows: [['Hose'], ['Saw']], ordered: true },
  { sql: 'SELECT name FROM product ORDER BY id OFFSET 2', rows: [['Trowel'], ['Hose']], ordered: true, note: 'PostgreSQL OFFSET without LIMIT' },
  { sql: 'SELECT name FROM product ORDER BY id LIMIT 2 OFFSET 1', rows: [['Saw'], ['Trowel']], ordered: true },
  { sql: 'SELECT name FROM product ORDER BY id FETCH FIRST 2 ROWS ONLY', rows: [['Hammer'], ['Saw']], ordered: true },
  { sql: 'SELECT name, price FROM product WHERE price = ANY (ARRAY[12.50, 7.25])', reject: true, show: true },
  { sql: "SELECT string_agg(name, ', ' ORDER BY name) AS names FROM product WHERE category_id = 1", rows: [['Hammer, Saw']] },
  { sql: 'SELECT category_id, array_agg(name) FROM product GROUP BY category_id', reject: true, show: true },
  { sql: 'SELECT c.name, p.name FROM category c JOIN product p USING (id)', rows: [['Tools', 'Hammer'], ['Garden', 'Saw'], ['Empty', 'Trowel']] },
  { sql: 'SELECT * FROM product WHERE tags IS NULL', count: 1 },
  { sql: "SELECT name FROM product WHERE added_on BETWEEN '2025-02-01' AND '2025-03-31' ORDER BY id", rows: [['Saw'], ['Trowel']], ordered: true },
  { sql: "SELECT name FROM product WHERE added_on >= DATE '2025-03-01'", rows: [['Trowel'], ['Hose']] },
  { sql: "SELECT name FROM product WHERE added_on > CURRENT_DATE - INTERVAL '1 day'", count: 0 },
  { sql: 'SELECT name, age(updated_at) FROM product', reject: true, show: true },
  { sql: "SELECT name FROM product WHERE name ~ '^H' ORDER BY name", rows: [['Hammer'], ['Hose']], ordered: true },
  { sql: "SELECT name FROM product WHERE name !~ '^H' ORDER BY name", rows: [['Saw'], ['Trowel']], ordered: true },
  { sql: 'SELECT DISTINCT ON (category_id) category_id, name FROM product ORDER BY category_id, price DESC', reject: /DISTINCT ON/ },
  { sql: 'SELECT name, price, RANK() OVER (PARTITION BY category_id ORDER BY price DESC) AS rk FROM product ORDER BY id', rows: [['Hammer', 12.5, 2], ['Saw', 24, 1], ['Trowel', 7.25, 2], ['Hose', 30, 1]], ordered: true },
  { sql: 'SELECT name, SUM(price) OVER () AS total FROM product ORDER BY id', rows: [['Hammer', 73.75], ['Saw', 73.75], ['Trowel', 73.75], ['Hose', 73.75]], ordered: true },
  { sql: 'WITH expensive AS (SELECT * FROM product WHERE price > 20) SELECT c.name, e.name FROM expensive e JOIN category c ON c.id = e.category_id ORDER BY e.name', rows: [['Garden', 'Hose'], ['Tools', 'Saw']], ordered: true },
  { sql: "SELECT 'a' || 'b' AS s, 7 / 2 AS q, 7 % 2 AS r", rows: [['ab', 3, 1]] },
  { sql: 'SELECT name FROM product WHERE price > 10 AND (in_stock OR price > 25) ORDER BY id', rows: [['Hammer'], ['Hose']], ordered: true },
  { sql: "SELECT LEFT(name, 2) AS l, LENGTH(name) AS n, UPPER(name) AS u, SUBSTRING(name FROM 2 FOR 2) AS s, POSITION('a' IN name) AS p FROM product WHERE id = 1", rows: [['Ha', 6, 'HAMMER', 'am', 2]] },
  { sql: 'SELECT name, price::numeric(10,2) * 2 AS dbl FROM product WHERE id = 3', rows: [['Trowel', 14.5]] },
  { sql: 'SELECT count(*)::float / 2 AS half FROM product', rows: [[2]] },
  { sql: 'SELECT name FROM product WHERE id IN (SELECT category_id FROM product)', rows: [['Hammer'], ['Saw']] },
  { sql: 'SELECT c.name FROM category c WHERE NOT EXISTS (SELECT 1 FROM product p WHERE p.category_id = c.id)', rows: [['Empty']] },
  { sql: 'SELECT name FROM product WHERE price > ALL (SELECT price FROM product WHERE category_id = 2)', reject: /ALL/ },
  { sql: 'SELECT c.name, (SELECT MAX(price) FROM product p WHERE p.category_id = c.id) AS top FROM category c ORDER BY c.id', rows: [['Tools', 24], ['Garden', 30], ['Empty', null]], ordered: true },
  { sql: 'SELECT name FROM product LIMIT ALL', count: 4 },
  { sql: "SELECT name FROM product WHERE updated_at::date = '2025-03-01'", rows: [['Trowel']] },
  { sql: 'SELECT name FROM product WHERE EXTRACT(YEAR FROM updated_at) = 2025 AND EXTRACT(HOUR FROM updated_at) >= 14 ORDER BY id', rows: [['Saw'], ['Hose']], ordered: true },
  { sql: "SELECT name, updated_at - INTERVAL '2 hours' AS earlier FROM product WHERE id = 2", rows: [['Saw', '2025-02-28 12:00:00']] },
  { sql: "SELECT name, added_on - INTERVAL '1 day' AS prev FROM product WHERE id = 3", rows: [['Trowel', '2025-02-28']] },
  { sql: "SELECT added_on - DATE '2025-01-01' AS days FROM product WHERE id = 1", rows: [[14]], note: 'PostgreSQL date subtraction yields days' },
  // mutations
  { sql: "INSERT INTO product (category_id, name, price) VALUES (3, 'Rake', 15.00) RETURNING id", ok: true, show: true },
  { sql: 'SELECT id, name, in_stock, added_on FROM product WHERE id = 5', rows: [[5, 'Rake', 1, today]] },
  { sql: "INSERT INTO product (category_id, name, price) VALUES (99, 'Orphan', 1)", reject: /FOREIGN KEY|refer/i },
  { sql: "INSERT INTO product (category_id, name, price) VALUES (1, 'Neg', -1)", reject: /CHECK/ },
  { sql: 'INSERT INTO product (category_id, price) VALUES (1, 1)', reject: /NOT NULL|name/i, show: true },
  { sql: 'UPDATE product SET price = price * 1.1 WHERE category_id = 2', ok: true },
  { sql: 'SELECT name, ROUND(price, 2) AS p FROM product WHERE category_id = 2 ORDER BY id', rows: [['Trowel', 7.98], ['Hose', 33]], ordered: true },
  { sql: 'UPDATE product SET in_stock = NOT in_stock WHERE id = 2', ok: true },
  { sql: 'SELECT in_stock FROM product WHERE id = 2', rows: [[1]] },
  { sql: 'UPDATE product p SET price = 0 WHERE p.id = 1', ok: true, show: true },
  { sql: 'DELETE FROM product p WHERE p.id = 1', ok: true, show: true },
  { sql: 'DELETE FROM category WHERE id = 1', ok: true, show: true },
  { sql: 'SELECT COUNT(*) FROM product', rows: [[3]] },
  { sql: "INSERT INTO category (id, name) VALUES (2, 'Garden') ON CONFLICT (id) DO NOTHING", ok: true, show: true },
  { sql: "INSERT INTO category (id, name) VALUES (2, 'Garden2') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name", ok: true },
  { sql: 'SELECT name FROM category WHERE id = 2', rows: [['Garden2']] },
  { sql: "INSERT INTO category (name) VALUES ('Garden2')", reject: /unique/i },
  { sql: "INSERT INTO product (category_id, name, price) SELECT 2, name || ' copy', price FROM product WHERE category_id = 2", ok: true },
  { sql: 'SELECT COUNT(*) FROM product WHERE category_id = 2', rows: [[4]] },
  { sql: 'DELETE FROM product WHERE id IN (SELECT id FROM product ORDER BY id DESC LIMIT 1)', ok: true },
  { sql: "DELETE FROM product USING category WHERE product.category_id = category.id AND category.name = 'Garden2'", reject: true, show: true },
  { sql: 'UPDATE product SET price = 1 FROM category WHERE category.id = product.category_id AND category.name = \'Empty\'', ok: true, show: true },
  { sql: 'UPDATE product SET price = DEFAULT WHERE id = 3', reject: true, show: true },
  { sql: 'TRUNCATE TABLE product RESTART IDENTITY CASCADE', ok: true, show: true },
  { sql: 'SELECT COUNT(*) FROM product', rows: [[0]] },
];

/* ---------------------------------------------------------------- PostgreSQL identity columns */
const IDENTITY_PG = `
CREATE TABLE account (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE login (
  id bigint GENERATED ALWAYS AS IDENTITY,
  account_id integer NOT NULL REFERENCES account(id),
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
INSERT INTO account (email) VALUES ('a@x.test'), ('b@x.test');
INSERT INTO login (account_id) VALUES (1), (1), (2);
`;
const identityCases: Case[] = [
  { sql: 'SELECT id, email FROM account ORDER BY id', rows: [[1, 'a@x.test'], [2, 'b@x.test']], ordered: true },
  { sql: 'SELECT account_id, COUNT(*) AS n FROM login GROUP BY account_id ORDER BY account_id', rows: [[1, 2], [2, 1]], ordered: true },
  { sql: "INSERT INTO account (email) VALUES ('c@x.test')", ok: true },
  { sql: "SELECT id FROM account WHERE email = 'c@x.test'", rows: [[3]] },
];

/* ---------------------------------------------------------------- pg_dump with a plpgsql function */
const FUNCTION_PG = `
CREATE TABLE note (id serial PRIMARY KEY, body text, updated_at timestamp DEFAULT now());
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER note_updated BEFORE UPDATE ON note FOR EACH ROW EXECUTE FUNCTION set_updated_at();
INSERT INTO note (body) VALUES ('hello');
`;

/* ---------------------------------------------------------------- MySQL (phpMyAdmin export) */
const SCHOOL_PMA = `-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Sep 30, 2026 at 10:12 AM
-- Server version: 10.4.32-MariaDB

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: \`school\`
--

-- --------------------------------------------------------

--
-- Table structure for table \`students\`
--

CREATE TABLE \`students\` (
  \`id\` int(11) NOT NULL,
  \`name\` varchar(100) NOT NULL,
  \`email\` varchar(100) DEFAULT NULL,
  \`gpa\` decimal(3,2) DEFAULT NULL,
  \`enrolled\` date NOT NULL,
  \`active\` tinyint(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table \`students\`
--

INSERT INTO \`students\` (\`id\`, \`name\`, \`email\`, \`gpa\`, \`enrolled\`, \`active\`) VALUES
(1, 'Ana Díaz', 'ana@x.test', 3.80, '2024-09-01', 1),
(2, 'Ben O\\'Hara', NULL, 2.95, '2024-09-01', 1),
(3, 'Cy "The Cat" Lee', 'cy@x.test', NULL, '2025-01-15', 0),
(4, 'Dee Wu', 'dee@x.test', 3.20, '2025-01-15', 1);

-- --------------------------------------------------------

CREATE TABLE \`courses\` (
  \`code\` varchar(8) NOT NULL,
  \`title\` varchar(100) NOT NULL,
  \`credits\` int(11) NOT NULL DEFAULT 3
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO \`courses\` (\`code\`, \`title\`, \`credits\`) VALUES
('CS101', 'Intro to CS', 4),
('MA201', 'Linear Algebra', 3),
('HI110', 'World History', 3);

-- --------------------------------------------------------

CREATE TABLE \`enrollments\` (
  \`id\` int(11) NOT NULL,
  \`student_id\` int(11) NOT NULL,
  \`course_code\` varchar(8) NOT NULL,
  \`grade\` char(2) DEFAULT NULL,
  \`term\` enum('fall','spring') NOT NULL DEFAULT 'fall'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO \`enrollments\` (\`id\`, \`student_id\`, \`course_code\`, \`grade\`, \`term\`) VALUES
(1, 1, 'CS101', 'A', 'fall'),
(2, 1, 'MA201', 'B+', 'fall'),
(3, 2, 'CS101', 'C', 'fall'),
(4, 4, 'HI110', NULL, 'spring'),
(5, 4, 'CS101', 'A-', 'spring');

--
-- Indexes for dumped tables
--

--
-- Indexes for table \`students\`
--
ALTER TABLE \`students\`
  ADD PRIMARY KEY (\`id\`),
  ADD UNIQUE KEY \`email\` (\`email\`);

ALTER TABLE \`courses\`
  ADD PRIMARY KEY (\`code\`);

ALTER TABLE \`enrollments\`
  ADD PRIMARY KEY (\`id\`),
  ADD KEY \`student_id\` (\`student_id\`),
  ADD KEY \`course_code\` (\`course_code\`);

--
-- AUTO_INCREMENT for dumped tables
--

ALTER TABLE \`students\`
  MODIFY \`id\` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

ALTER TABLE \`enrollments\`
  MODIFY \`id\` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- Constraints for dumped tables
--

ALTER TABLE \`enrollments\`
  ADD CONSTRAINT \`enrollments_ibfk_1\` FOREIGN KEY (\`student_id\`) REFERENCES \`students\` (\`id\`) ON DELETE CASCADE,
  ADD CONSTRAINT \`enrollments_ibfk_2\` FOREIGN KEY (\`course_code\`) REFERENCES \`courses\` (\`code\`);
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
`;

const mysqlCases: Case[] = [
  { sql: 'SELECT name FROM students WHERE name = "Dee Wu"', rows: [['Dee Wu']], show: true },
  { sql: "SELECT name FROM students WHERE name LIKE 'Ben O\\'Hara'", rows: [["Ben O'Hara"]] },
  { sql: `SELECT name FROM students WHERE name LIKE '%"The Cat"%'`, rows: [['Cy "The Cat" Lee']] },
  { sql: 'SELECT s.name, COUNT(e.id) AS n FROM students s LEFT JOIN enrollments e ON e.student_id = s.id GROUP BY s.id ORDER BY n DESC, s.name', rows: [['Ana Díaz', 2], ['Dee Wu', 2], ["Ben O'Hara", 1], ['Cy "The Cat" Lee', 0]], ordered: true },
  { sql: "SELECT c.title, GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR '; ') AS who FROM courses c JOIN enrollments e ON e.course_code = c.code JOIN students s ON s.id = e.student_id WHERE c.code <> 'CS101' GROUP BY c.code ORDER BY c.code", rows: [['World History', 'Dee Wu'], ['Linear Algebra', 'Ana Díaz']], ordered: true },
  { sql: "SELECT name, YEAR(enrolled) AS y, MONTH(enrolled) AS m, DAYNAME(enrolled) AS d, DATE_FORMAT(enrolled, '%d/%m/%Y') AS f FROM students WHERE id = 1", rows: [['Ana Díaz', 2024, 9, 'Sunday', '01/09/2024']] },
  { sql: "SELECT name, DATEDIFF('2025-01-01', enrolled) AS days FROM students WHERE id = 1", rows: [['Ana Díaz', 122]] },
  { sql: 'SELECT name, DATE_ADD(enrolled, INTERVAL 1 YEAR) AS later FROM students WHERE id = 3', rows: [['Cy "The Cat" Lee', '2026-01-15']] },
  { sql: "SELECT name, TIMESTAMPDIFF(MONTH, enrolled, '2025-03-10') AS months FROM students WHERE id IN (1, 3) ORDER BY id", rows: [['Ana Díaz', 6], ['Cy "The Cat" Lee', 1]], ordered: true, note: 'MySQL counts complete months' },
  { sql: 'SELECT name, WEEK(enrolled) AS w FROM students WHERE id = 3', rows: [['Cy "The Cat" Lee', 2]], note: 'MySQL WEEK() default mode 0' },
  { sql: "SELECT name, IF(active = 1, 'yes', 'no') AS a, IFNULL(email, '-') AS e FROM students WHERE id = 3", rows: [['Cy "The Cat" Lee', 'no', 'cy@x.test']] },
  { sql: "SELECT name, CONCAT(name, ' <', IFNULL(email, 'none'), '>') AS label FROM students WHERE id = 2", rows: [["Ben O'Hara", "Ben O'Hara <none>"]] },
  { sql: "SELECT name, CONCAT_WS(', ', name, email) AS c FROM students WHERE id = 2", rows: [["Ben O'Hara", "Ben O'Hara"]] },
  { sql: "SELECT name, LCASE(name) AS l, SUBSTRING(name, 1, 3) AS s, LOCATE('e', name) AS p, REPLACE(name, ' ', '_') AS r FROM students WHERE id = 4", rows: [['Dee Wu', 'dee wu', 'Dee', 2, 'Dee_Wu']] },
  { sql: "SELECT name, SUBSTRING_INDEX(email, '@', 1) AS user FROM students WHERE id = 4", rows: [['Dee Wu', 'dee']] },
  { sql: 'SELECT name, gpa DIV 1 AS whole, gpa MOD 1 AS frac FROM students WHERE id = 4', rows: [['Dee Wu', 3, 0.2]], note: 'MySQL MOD on decimals keeps the fraction' },
  { sql: 'SELECT ROUND(AVG(gpa), 2) AS avg_gpa, MAX(gpa) AS mx, MIN(gpa) AS mn, COUNT(gpa) AS c, COUNT(*) AS n FROM students', rows: [[3.32, 3.8, 2.95, 3, 4]] },
  { sql: 'SELECT term, COUNT(*) AS n FROM enrollments GROUP BY term HAVING n > 2', rows: [['fall', 3]] },
  { sql: 'SELECT s.name FROM students s WHERE s.id NOT IN (SELECT student_id FROM enrollments)', rows: [['Cy "The Cat" Lee']] },
  { sql: "SELECT s.name FROM students s WHERE EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id AND e.grade LIKE 'A%') ORDER BY s.name", rows: [['Ana Díaz'], ['Dee Wu']], ordered: true },
  { sql: 'SELECT name FROM students ORDER BY gpa DESC LIMIT 1, 2', rows: [['Dee Wu'], ["Ben O'Hara"]], ordered: true },
  { sql: 'SELECT name FROM students WHERE gpa BETWEEN 3 AND 3.5', rows: [['Dee Wu']] },
  { sql: "SELECT e.course_code, e.grade FROM enrollments e WHERE e.grade IS NOT NULL AND e.grade REGEXP '^[AB]' ORDER BY e.id", rows: [['CS101', 'A'], ['MA201', 'B+'], ['CS101', 'A-']], ordered: true },
  { sql: "SELECT * FROM students WHERE enrolled = '2025-01-15' AND active", count: 1 },
  { sql: 'SELECT COUNT(DISTINCT student_id) AS n FROM enrollments', rows: [[3]] },
  { sql: 'SELECT s.name, e.course_code FROM students s INNER JOIN enrollments e USING (id)', rows: [['Ana Díaz', 'CS101'], ["Ben O'Hara", 'MA201'], ['Cy "The Cat" Lee', 'CS101'], ['Dee Wu', 'HI110']] },
  { sql: "SELECT s.name, c.title FROM students s JOIN enrollments e ON s.id = e.student_id JOIN courses c ON c.code = e.course_code WHERE c.credits = 4 AND e.term = 'spring'", rows: [['Dee Wu', 'Intro to CS']] },
  { sql: "SELECT name FROM students WHERE id = 1 UNION SELECT title FROM courses WHERE code = 'MA201' ORDER BY 1", rows: [['Ana Díaz'], ['Linear Algebra']], ordered: true },
  { sql: "SELECT NOW() IS NOT NULL AS n, CURDATE() = DATE('now') AS d", rows: [[1, 1]] },
  { sql: "SELECT LAST_DAY('2024-02-10') AS ld, DAYOFWEEK('2024-09-01') AS dw, QUARTER('2024-09-01') AS q", rows: [['2024-02-29', 1, 3]] },
  { sql: "SELECT STR_TO_DATE('15/01/2025', '%d/%m/%Y') AS d", rows: [['2025-01-15']] },
  { sql: 'SELECT FORMAT(1234.5678, 2) AS f', rows: [['1234.57']] },
  { sql: 'SELECT TRUNCATE(3.789, 1) AS t, CEILING(3.1) AS c, FLOOR(3.9) AS f, POW(2, 10) AS p, RAND() < 1 AS r', rows: [[3.7, 4, 3, 1024, 1]] },
  // mutations
  { sql: "INSERT INTO students (name, enrolled) VALUES ('Eve Park', '2025-09-01')", ok: true, show: true, note: 'phpMyAdmin AUTO_INCREMENT via ALTER TABLE MODIFY' },
  { sql: "SELECT id, name, active FROM students WHERE name = 'Eve Park'", rows: [[5, 'Eve Park', 1]] },
  { sql: "INSERT INTO students (id, name, email, enrolled) VALUES (6, 'Dup', 'ana@x.test', '2025-09-01')", reject: /unique/i },
  { sql: "INSERT INTO enrollments (id, student_id, course_code) VALUES (6, 5, 'XX999')", reject: /FOREIGN KEY|refer/i },
  { sql: 'UPDATE students SET gpa = 4.0 WHERE id = 5', ok: true },
  { sql: "UPDATE students s JOIN enrollments e ON e.student_id = s.id SET s.active = 0 WHERE e.grade = 'C'", reject: true, show: true },
  { sql: "UPDATE students SET active = 0 WHERE id IN (SELECT student_id FROM enrollments WHERE grade = 'C')", ok: true },
  { sql: 'SELECT name FROM students WHERE active = 0 ORDER BY id', rows: [["Ben O'Hara"], ['Cy "The Cat" Lee']], ordered: true },
  { sql: "UPDATE students SET name = 'X' ORDER BY id LIMIT 1", reject: true, show: true },
  { sql: 'DELETE FROM students WHERE id = 1', ok: true },
  { sql: 'SELECT COUNT(*) FROM enrollments', rows: [[3]] },
  { sql: "DELETE FROM courses WHERE code = 'CS101'", reject: /FOREIGN KEY|refer/i },
  { sql: 'DELETE e FROM enrollments e JOIN students s ON s.id = e.student_id WHERE s.active = 0', reject: true, show: true },
  { sql: "REPLACE INTO courses VALUES ('HI110', 'World History II', 3)", ok: true },
  { sql: "INSERT INTO courses VALUES ('HI110', 'x', 1) ON DUPLICATE KEY UPDATE credits = credits + 1", ok: true },
  { sql: "INSERT IGNORE INTO courses VALUES ('HI110', 'ignored', 9)", ok: true },
  { sql: "SELECT title, credits FROM courses WHERE code = 'HI110'", rows: [['World History II', 4]] },
  { sql: 'TRUNCATE TABLE enrollments', ok: true },
  { sql: "INSERT INTO enrollments VALUES (10, 4, 'MA201', NULL, DEFAULT)", reject: true, show: true },
  { sql: "INSERT INTO enrollments (id, student_id, course_code) VALUE (11, 4, 'MA201')", ok: true },
  { sql: "INSERT INTO enrollments SET id = 12, student_id = 4, course_code = 'HI110', term = 'spring'", ok: true },
  { sql: 'SELECT id, term FROM enrollments ORDER BY id', rows: [[11, 'fall'], [12, 'spring']], ordered: true },
  { sql: 'DELETE FROM enrollments WHERE id = 11 LIMIT 1', reject: true, show: true },
];

/* ---------------------------------------------------------------- SQL Server (SSMS Generate Scripts) */
const CLINIC_MSSQL = `USE [Clinic]
GO
/****** Object:  Table [dbo].[Patient]    Script Date: 30/09/2026 10:15:00 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
CREATE TABLE [dbo].[Patient](
	[PatientId] [int] IDENTITY(1,1) NOT NULL,
	[FullName] [nvarchar](80) NOT NULL,
	[BirthDate] [date] NULL,
	[IsActive] [bit] NOT NULL,
	[Balance] [money] NOT NULL,
 CONSTRAINT [PK_Patient] PRIMARY KEY CLUSTERED
(
	[PatientId] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY]
GO
CREATE TABLE [dbo].[Visit](
	[VisitId] [int] IDENTITY(1,1) NOT NULL,
	[PatientId] [int] NOT NULL,
	[VisitedAt] [datetime2](7) NOT NULL,
	[Reason] [nvarchar](max) NULL,
	[Cost] [decimal](8, 2) NOT NULL,
 CONSTRAINT [PK_Visit] PRIMARY KEY CLUSTERED
(
	[VisitId] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO
ALTER TABLE [dbo].[Patient] ADD  CONSTRAINT [DF_Patient_IsActive]  DEFAULT ((1)) FOR [IsActive]
GO
ALTER TABLE [dbo].[Patient] ADD  CONSTRAINT [DF_Patient_Balance]  DEFAULT ((0)) FOR [Balance]
GO
ALTER TABLE [dbo].[Visit]  WITH CHECK ADD  CONSTRAINT [FK_Visit_Patient] FOREIGN KEY([PatientId])
REFERENCES [dbo].[Patient] ([PatientId])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[Visit] CHECK CONSTRAINT [FK_Visit_Patient]
GO
/****** Object:  Index [IX_Visit_PatientId]    Script Date: 30/09/2026 10:15:00 ******/
CREATE NONCLUSTERED INDEX [IX_Visit_PatientId] ON [dbo].[Visit]
(
	[PatientId] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, SORT_IN_TEMPDB = OFF, DROP_EXISTING = OFF, ONLINE = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
GO
SET IDENTITY_INSERT [dbo].[Patient] ON
GO
INSERT [dbo].[Patient] ([PatientId], [FullName], [BirthDate], [IsActive], [Balance]) VALUES (1, N'Ola Nordmann', CAST(N'1980-05-20' AS Date), 1, 120.5000)
INSERT [dbo].[Patient] ([PatientId], [FullName], [BirthDate], [IsActive], [Balance]) VALUES (2, N'Kari Hansen', CAST(N'1992-11-02' AS Date), 0, 0.0000)
INSERT [dbo].[Patient] ([PatientId], [FullName], [BirthDate], [IsActive], [Balance]) VALUES (3, N'Per Olsen', NULL, 1, 45.0000)
GO
SET IDENTITY_INSERT [dbo].[Patient] OFF
GO
SET IDENTITY_INSERT [dbo].[Visit] ON
GO
INSERT [dbo].[Visit] ([VisitId], [PatientId], [VisitedAt], [Reason], [Cost]) VALUES (1, 1, CAST(N'2025-03-10T09:00:00.0000000' AS DateTime2), N'Checkup', CAST(80.00 AS Decimal(8, 2)))
INSERT [dbo].[Visit] ([VisitId], [PatientId], [VisitedAt], [Reason], [Cost]) VALUES (2, 1, CAST(N'2025-06-15T14:30:00.0000000' AS DateTime2), N'Follow-up', CAST(40.50 AS Decimal(8, 2)))
INSERT [dbo].[Visit] ([VisitId], [PatientId], [VisitedAt], [Reason], [Cost]) VALUES (3, 3, CAST(N'2025-07-01T11:15:00.0000000' AS DateTime2), NULL, CAST(45.00 AS Decimal(8, 2)))
GO
SET IDENTITY_INSERT [dbo].[Visit] OFF
GO
`;

const mssqlCases: Case[] = [
  { sql: 'SELECT TOP 2 FullName, Balance FROM dbo.Patient ORDER BY Balance DESC', rows: [['Ola Nordmann', 120.5], ['Per Olsen', 45]], ordered: true },
  { sql: 'SELECT [FullName] AS [Patient Name], LEN([FullName]) AS [Len] FROM [dbo].[Patient] WHERE [IsActive] = 1 ORDER BY [PatientId]', rows: [['Ola Nordmann', 12], ['Per Olsen', 9]], ordered: true, columns: ['Patient Name', 'Len'] },
  { sql: "SELECT FullName, ISNULL(BirthDate, 'unknown') AS bd, IIF(IsActive = 1, 'Y', 'N') AS act FROM Patient WHERE PatientId = 3", rows: [['Per Olsen', 'unknown', 'Y']] },
  { sql: "SELECT FullName, DATEDIFF(year, BirthDate, '2025-01-01') AS age, DATEPART(month, BirthDate) AS m, DATENAME(month, BirthDate) AS mn, YEAR(BirthDate) AS y FROM Patient WHERE PatientId = 1", rows: [['Ola Nordmann', 45, 5, 'May', 1980]] },
  { sql: 'SELECT FullName, DATEADD(day, 7, BirthDate) AS wk, DATEADD(month, -1, BirthDate) AS prev, DATEADD(yy, 1, BirthDate) AS ny FROM Patient WHERE PatientId = 2', rows: [['Kari Hansen', '1992-11-09', '1992-10-02', '1993-11-02']] },
  { sql: "SELECT FullName, CONVERT(VARCHAR(4), YEAR(BirthDate)) + '-x' AS tag FROM Patient WHERE PatientId = 1", rows: [['Ola Nordmann', '1980-x']], note: 'T-SQL string concatenation with +' },
  { sql: "SELECT FullName + ' (' + CAST(PatientId AS VARCHAR(5)) + ')' AS label FROM Patient WHERE PatientId = 2", rows: [['Kari Hansen (2)']], note: 'T-SQL string concatenation with +' },
  { sql: "SELECT CONCAT(FullName, ' #', PatientId) AS label FROM Patient WHERE PatientId = 2", rows: [['Kari Hansen #2']] },
  { sql: 'SELECT p.FullName, COUNT(v.VisitId) AS visits, ISNULL(SUM(v.Cost), 0) AS spent FROM Patient p LEFT JOIN Visit v ON v.PatientId = p.PatientId GROUP BY p.PatientId, p.FullName ORDER BY spent DESC', rows: [['Ola Nordmann', 2, 120.5], ['Per Olsen', 1, 45], ['Kari Hansen', 0, 0]], ordered: true },
  { sql: 'SELECT p.FullName FROM Patient p WHERE NOT EXISTS (SELECT 1 FROM Visit v WHERE v.PatientId = p.PatientId)', rows: [['Kari Hansen']] },
  { sql: 'SELECT VisitId, CAST(VisitedAt AS DATE) AS d, DATEPART(hour, VisitedAt) AS h FROM Visit WHERE VisitId = 2', rows: [[2, '2025-06-15', 14]] },
  { sql: "SELECT VisitId, FORMAT(VisitedAt, 'yyyy-MM') AS ym FROM Visit WHERE VisitId = 2", rows: [[2, '2025-06']], note: 'T-SQL FORMAT with a .NET pattern' },
  { sql: "SELECT VisitId FROM Visit WHERE VisitedAt >= '2025-06-01' AND VisitedAt < '2025-07-01'", rows: [[2]] },
  { sql: 'SELECT Reason FROM Visit WHERE Reason IS NULL', count: 1 },
  { sql: "SELECT FullName FROM Patient WHERE FullName LIKE N'%Hansen%'", rows: [['Kari Hansen']] },
  { sql: 'SELECT FullName FROM Patient ORDER BY PatientId OFFSET 1 ROWS', rows: [['Kari Hansen'], ['Per Olsen']], ordered: true },
  { sql: 'SELECT FullName FROM Patient ORDER BY PatientId OFFSET 1 ROWS FETCH NEXT 1 ROWS ONLY', rows: [['Kari Hansen']] },
  { sql: 'SELECT FullName, Balance, ROW_NUMBER() OVER (ORDER BY Balance DESC) AS rn FROM Patient ORDER BY rn', rows: [['Ola Nordmann', 120.5, 1], ['Per Olsen', 45, 2], ['Kari Hansen', 0, 3]], ordered: true },
  { sql: "SELECT CASE WHEN Balance > 100 THEN 'high' WHEN Balance > 0 THEN 'some' ELSE 'none' END AS b, COUNT(*) AS n FROM Patient GROUP BY CASE WHEN Balance > 100 THEN 'high' WHEN Balance > 0 THEN 'some' ELSE 'none' END ORDER BY b", rows: [['high', 1], ['none', 1], ['some', 1]], ordered: true },
  { sql: 'SELECT FullName FROM Patient WITH (NOLOCK) WHERE IsActive = 1 ORDER BY 1', rows: [['Ola Nordmann'], ['Per Olsen']], ordered: true },
  { sql: 'SELECT * FROM Patient p CROSS APPLY (SELECT TOP 1 * FROM Visit v WHERE v.PatientId = p.PatientId) x', reject: /APPLY/ },
  { sql: 'DECLARE @id INT = 1; SELECT * FROM Patient WHERE PatientId = @id', reject: true, show: true },
  { sql: 'SELECT FullName FROM Patient WHERE PatientId = @id', reject: /variable/i },
  { sql: 'SELECT GETDATE() AS now, SYSDATETIME() AS s, CAST(GETDATE() AS DATE) AS d', count: 1 },
  { sql: "SELECT CHARINDEX('Nord', FullName) AS p, SUBSTRING(FullName, 1, 3) AS s, UPPER(LEFT(FullName, 1)) AS i, RIGHT(FullName, 4) AS r FROM Patient WHERE PatientId = 1", rows: [[5, 'Ola', 'O', 'mann']] },
  { sql: "SELECT REPLICATE('a', 3) AS rep", rows: [['aaa']] },
  { sql: "SELECT STRING_AGG(FullName, ', ') WITHIN GROUP (ORDER BY FullName) AS names FROM Patient WHERE IsActive = 1", rows: [['Ola Nordmann, Per Olsen']] },
  { sql: 'SELECT CAST(Balance AS INT) AS b, CAST(Balance AS NVARCHAR(20)) AS s, CONVERT(DECIMAL(10,2), Balance) AS d FROM Patient WHERE PatientId = 1', rows: [[120, '120.5', 120.5]] },
  { sql: "SELECT FullName FROM Patient WHERE BirthDate BETWEEN '1980-01-01' AND '1989-12-31'", rows: [['Ola Nordmann']] },
  { sql: 'SELECT v.VisitId, v.Cost, SUM(v.Cost) OVER (PARTITION BY v.PatientId ORDER BY v.VisitedAt) AS running FROM Visit v ORDER BY v.VisitId', rows: [[1, 80, 80], [2, 40.5, 120.5], [3, 45, 45]], ordered: true },
  { sql: 'SELECT FullName\r\nFROM Patient\r\nWHERE PatientId = 1\r\nGO', rows: [['Ola Nordmann']], note: 'pasted from SSMS with a trailing GO' },
  { sql: '/* header */\r\nSELECT FullName -- name\r\nFROM Patient\r\nWHERE PatientId = 1; -- done', rows: [['Ola Nordmann']] },
  // mutations
  { sql: "INSERT INTO dbo.Patient (FullName, IsActive, Balance) VALUES (N'Nina Berg', 1, 10)", ok: true },
  { sql: "INSERT INTO Patient (FullName, IsActive) VALUES (N'Zed', 1)", ok: true },
  { sql: 'SELECT PatientId, FullName, Balance FROM Patient WHERE PatientId >= 4 ORDER BY PatientId', rows: [[4, 'Nina Berg', 10], [5, 'Zed', 0]], ordered: true },
  { sql: 'INSERT INTO Visit (PatientId, VisitedAt, Cost) VALUES (99, GETDATE(), 1)', reject: /FOREIGN KEY|refer/i },
  { sql: 'UPDATE Patient SET Balance = Balance + 5 WHERE PatientId IN (SELECT PatientId FROM Visit WHERE Cost > 50)', ok: true },
  { sql: 'SELECT Balance FROM Patient WHERE PatientId = 1', rows: [[125.5]] },
  { sql: 'UPDATE p SET p.IsActive = 0 FROM Patient p JOIN Visit v ON v.PatientId = p.PatientId WHERE v.Cost < 50', reject: true, show: true },
  { sql: 'UPDATE Patient SET IsActive = 0 FROM Visit WHERE Visit.PatientId = Patient.PatientId AND Visit.Cost < 50', ok: true, show: true },
  { sql: 'DELETE FROM Patient WHERE PatientId = 1', ok: true },
  { sql: 'SELECT COUNT(*) FROM Visit', rows: [[1]] },
  { sql: 'DELETE TOP (1) FROM Visit', reject: true, show: true },
  { sql: 'DELETE Visit WHERE VisitId = 3', ok: true, show: true, note: 'T-SQL DELETE without FROM' },
  { sql: 'TRUNCATE TABLE Visit', ok: true },
  { sql: 'MERGE Patient AS t USING (SELECT 1 AS x) AS s ON t.PatientId = s.x WHEN MATCHED THEN DELETE;', reject: true, show: true },
];

/* ---------------------------------------------------------------- Oracle (scott/tiger) */
const SCOTT_ORA = `
CREATE TABLE DEPT (
  DEPTNO NUMBER(2) CONSTRAINT PK_DEPT PRIMARY KEY,
  DNAME VARCHAR2(14),
  LOC VARCHAR2(13)
);
CREATE TABLE EMP (
  EMPNO NUMBER(4) CONSTRAINT PK_EMP PRIMARY KEY,
  ENAME VARCHAR2(10),
  JOB VARCHAR2(9),
  MGR NUMBER(4),
  HIREDATE DATE,
  SAL NUMBER(7,2),
  COMM NUMBER(7,2),
  DEPTNO NUMBER(2) CONSTRAINT FK_DEPTNO REFERENCES DEPT
);
INSERT INTO DEPT VALUES (10,'ACCOUNTING','NEW YORK');
INSERT INTO DEPT VALUES (20,'RESEARCH','DALLAS');
INSERT INTO DEPT VALUES (30,'SALES','CHICAGO');
INSERT INTO DEPT VALUES (40,'OPERATIONS','BOSTON');
INSERT INTO EMP VALUES (7369,'SMITH','CLERK',7902,to_date('17-12-1980','dd-mm-yyyy'),800,NULL,20);
INSERT INTO EMP VALUES (7499,'ALLEN','SALESMAN',7698,to_date('20-2-1981','dd-mm-yyyy'),1600,300,30);
INSERT INTO EMP VALUES (7521,'WARD','SALESMAN',7698,to_date('22-2-1981','dd-mm-yyyy'),1250,500,30);
INSERT INTO EMP VALUES (7566,'JONES','MANAGER',7839,to_date('2-4-1981','dd-mm-yyyy'),2975,NULL,20);
INSERT INTO EMP VALUES (7698,'BLAKE','MANAGER',7839,to_date('1-5-1981','dd-mm-yyyy'),2850,NULL,30);
INSERT INTO EMP VALUES (7782,'CLARK','MANAGER',7839,to_date('9-6-1981','dd-mm-yyyy'),2450,NULL,10);
INSERT INTO EMP VALUES (7839,'KING','PRESIDENT',NULL,to_date('17-11-1981','dd-mm-yyyy'),5000,NULL,10);
INSERT INTO EMP VALUES (7902,'FORD','ANALYST',7566,to_date('3-12-1981','dd-mm-yyyy'),3000,NULL,20);
INSERT INTO EMP VALUES (7934,'MILLER','CLERK',7782,to_date('23-1-1982','dd-mm-yyyy'),1300,NULL,10);
COMMIT;
`;

const oracleCases: Case[] = [
  { sql: 'SELECT ENAME, HIREDATE FROM EMP WHERE EMPNO = 7369', rows: [['SMITH', '1980-12-17']], note: 'to_date with a lower-case format in the schema script' },
  { sql: "SELECT ENAME, TO_CHAR(HIREDATE, 'DD-MON-YYYY') AS H FROM EMP WHERE EMPNO = 7499", rows: [['ALLEN', '20-FEB-1981']] },
  { sql: "SELECT ENAME, TO_CHAR(HIREDATE, 'Month DD, YYYY') AS H FROM EMP WHERE EMPNO = 7934", rows: [['MILLER', 'January 23, 1982']] },
  { sql: 'SELECT ENAME, SAL, NVL(COMM, 0) AS COMM, SAL + NVL(COMM, 0) AS TOTAL FROM EMP WHERE DEPTNO = 30 ORDER BY ENAME', rows: [['ALLEN', 1600, 300, 1900], ['BLAKE', 2850, 0, 2850], ['WARD', 1250, 500, 1750]], ordered: true },
  { sql: "SELECT ENAME, NVL2(COMM, 'yes', 'no') AS HASC FROM EMP WHERE EMPNO IN (7499, 7566) ORDER BY EMPNO", rows: [['ALLEN', 'yes'], ['JONES', 'no']], ordered: true },
  { sql: "SELECT ENAME, DECODE(DEPTNO, 10, 'ACC', 20, 'RES', 'OTHER') AS D FROM EMP WHERE EMPNO = 7369", rows: [['SMITH', 'RES']], note: 'Oracle DECODE' },
  { sql: "SELECT E.ENAME, D.DNAME FROM EMP E, DEPT D WHERE E.DEPTNO = D.DEPTNO AND D.LOC = 'DALLAS' ORDER BY E.ENAME", rows: [['FORD', 'RESEARCH'], ['JONES', 'RESEARCH'], ['SMITH', 'RESEARCH']], ordered: true },
  { sql: 'SELECT E.ENAME, D.DNAME FROM EMP E, DEPT D WHERE E.DEPTNO = D.DEPTNO(+)', reject: true, show: true },
  { sql: 'SELECT D.DNAME, COUNT(E.EMPNO) AS N FROM DEPT D LEFT OUTER JOIN EMP E ON E.DEPTNO = D.DEPTNO GROUP BY D.DEPTNO, D.DNAME ORDER BY N DESC, D.DNAME', rows: [['ACCOUNTING', 3], ['RESEARCH', 3], ['SALES', 3], ['OPERATIONS', 0]], ordered: true },
  { sql: 'SELECT ENAME FROM EMP WHERE ROWNUM <= 2', rows: [['SMITH'], ['ALLEN']] },
  { sql: 'SELECT * FROM (SELECT ENAME FROM EMP ORDER BY SAL DESC) WHERE ROWNUM <= 3', reject: true, show: true },
  { sql: 'SELECT * FROM (SELECT ENAME FROM EMP ORDER BY SAL DESC) T WHERE ROWNUM <= 3', rows: [['KING'], ['FORD'], ['JONES']] },
  { sql: 'SELECT ENAME FROM EMP ORDER BY SAL DESC FETCH FIRST 2 ROWS ONLY', rows: [['KING'], ['FORD']], ordered: true },
  { sql: 'SELECT ENAME, SAL FROM EMP WHERE SAL > (SELECT AVG(SAL) FROM EMP) ORDER BY SAL DESC', rows: [['KING', 5000], ['FORD', 3000], ['JONES', 2975], ['BLAKE', 2850], ['CLARK', 2450]], ordered: true },
  { sql: 'SELECT JOB, ROUND(AVG(SAL)) AS A FROM EMP GROUP BY JOB HAVING AVG(SAL) > 2000 ORDER BY JOB', rows: [['ANALYST', 3000], ['MANAGER', 2758], ['PRESIDENT', 5000]], ordered: true },
  { sql: "SELECT E.ENAME, M.ENAME AS MANAGER FROM EMP E LEFT JOIN EMP M ON M.EMPNO = E.MGR WHERE E.MGR IS NULL OR M.JOB = 'PRESIDENT' ORDER BY E.ENAME", rows: [['BLAKE', 'KING'], ['CLARK', 'KING'], ['JONES', 'KING'], ['KING', null]], ordered: true },
  { sql: "SELECT ENAME, SUBSTR(ENAME, 1, 2) AS S, INSTR(ENAME, 'A') AS I, LENGTH(ENAME) AS L, LOWER(ENAME) AS LO, INITCAP(ENAME) AS IC, LPAD(SAL, 6, '0') AS P, RPAD(ENAME, 8, '.') AS R FROM EMP WHERE EMPNO = 7499", rows: [['ALLEN', 'AL', 1, 5, 'allen', 'Allen', '001600', 'ALLEN...']] },
  { sql: 'SELECT ENAME, SAL, SAL * 12 AS ANNUAL, TRUNC(SAL / 7) AS T, MOD(SAL, 7) AS M FROM EMP WHERE EMPNO = 7369', rows: [['SMITH', 800, 9600, 114, 2]] },
  { sql: "SELECT ENAME FROM EMP WHERE HIREDATE BETWEEN TO_DATE('1981-01-01','YYYY-MM-DD') AND TO_DATE('1981-06-30','YYYY-MM-DD') ORDER BY HIREDATE", rows: [['ALLEN'], ['WARD'], ['JONES'], ['BLAKE'], ['CLARK']], ordered: true },
  { sql: 'SELECT ENAME, ADD_MONTHS(HIREDATE, 6) AS M FROM EMP WHERE EMPNO = 7369', rows: [['SMITH', '1981-06-17']], note: 'Oracle ADD_MONTHS' },
  { sql: 'SELECT ENAME, EXTRACT(YEAR FROM HIREDATE) AS Y FROM EMP WHERE EMPNO = 7934', rows: [['MILLER', 1982]] },
  { sql: 'SELECT SYSDATE FROM DUAL', count: 1 },
  { sql: "SELECT ENAME || ' works in ' || DNAME AS S FROM EMP JOIN DEPT ON EMP.DEPTNO = DEPT.DEPTNO WHERE EMPNO = 7782", rows: [['CLARK works in ACCOUNTING']] },
  { sql: 'SELECT DEPTNO FROM DEPT MINUS SELECT DEPTNO FROM EMP', rows: [[40]] },
  { sql: 'SELECT ENAME, SAL, RANK() OVER (PARTITION BY DEPTNO ORDER BY SAL DESC) AS RK FROM EMP WHERE DEPTNO = 10 ORDER BY RK', rows: [['KING', 5000, 1], ['CLARK', 2450, 2], ['MILLER', 1300, 3]], ordered: true },
  { sql: "SELECT ENAME, SAL, CASE WHEN SAL >= 3000 THEN 'A' WHEN SAL >= 1500 THEN 'B' ELSE 'C' END AS GRADE FROM EMP WHERE DEPTNO = 20 ORDER BY ENAME", rows: [['FORD', 3000, 'A'], ['JONES', 2975, 'B'], ['SMITH', 800, 'C']], ordered: true },
  { sql: "SELECT DEPTNO, LISTAGG(ENAME, ',') WITHIN GROUP (ORDER BY ENAME) AS NAMES FROM EMP WHERE DEPTNO = 10 GROUP BY DEPTNO", rows: [[10, 'CLARK,KING,MILLER']] },
  { sql: 'SELECT ENAME "Employee Name" FROM EMP WHERE EMPNO = 7369', columns: ['Employee Name'], rows: [['SMITH']] },
  { sql: 'SELECT ENAME, HIREDATE + 30 AS DUE FROM EMP WHERE EMPNO = 7369', rows: [['SMITH', '1981-01-16']], note: 'Oracle date + days' },
  { sql: 'SELECT COUNT(*) FROM EMP WHERE COMM IS NULL', rows: [[7]] },
  // mutations
  { sql: "INSERT INTO DEPT VALUES (50, 'IT', 'OSLO')", ok: true },
  { sql: "INSERT INTO EMP (EMPNO, ENAME, HIREDATE, DEPTNO) VALUES (8000, 'NEW', TO_DATE('2020-01-05', 'YYYY-MM-DD'), 50)", ok: true },
  { sql: "INSERT INTO EMP (EMPNO, ENAME, HIREDATE, DEPTNO) VALUES (8001, 'LOW', to_date('05-jan-2020', 'dd-mon-yyyy'), 50)", ok: true },
  { sql: 'SELECT EMPNO, HIREDATE FROM EMP WHERE DEPTNO = 50 ORDER BY EMPNO', rows: [[8000, '2020-01-05'], [8001, '2020-01-05']], ordered: true },
  { sql: "INSERT INTO EMP (EMPNO, ENAME, DEPTNO) VALUES (8002, 'BAD', 99)", reject: /FOREIGN KEY|refer/i },
  { sql: 'UPDATE EMP SET SAL = 1000 WHERE DEPTNO = 50', ok: true },
  { sql: 'DELETE FROM DEPT WHERE DEPTNO = 50', reject: /FOREIGN KEY|refer/i },
  { sql: 'DELETE FROM EMP WHERE DEPTNO = 50', ok: true },
  { sql: 'DELETE FROM DEPT WHERE DEPTNO = 50', ok: true },
  { sql: 'INSERT INTO EMP SELECT EMPNO + 1000, ENAME, JOB, MGR, HIREDATE, SAL, COMM, DEPTNO FROM EMP WHERE DEPTNO = 10', ok: true },
  { sql: 'SELECT COUNT(*) FROM EMP', rows: [[12]] },
];

void FUNCTION_PG;
export const PROBES: Array<{ label: string; def: SchemaDef; cases: Case[] }> = [
  { label: 'shop_pg', def: custom('Shop (PostgreSQL)', SHOP_PG), cases: pgCases },
  { label: 'identity_pg', def: custom('Identity (PostgreSQL)', IDENTITY_PG), cases: identityCases },
  { label: 'school_pma', def: custom('School (phpMyAdmin)', SCHOOL_PMA), cases: mysqlCases },
  { label: 'clinic_mssql', def: custom('Clinic (SSMS)', CLINIC_MSSQL), cases: mssqlCases },
  { label: 'scott_ora', def: custom('Scott (Oracle)', SCOTT_ORA), cases: oracleCases },
];
