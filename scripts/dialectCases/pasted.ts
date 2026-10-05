import type { Case } from '../testDialects';
import { PROBES as ROUND1 } from './exports';
import { PRELOADED_SCHEMAS } from '../../lib/schemas';

const defOf = (label: string) => ROUND1.find((p) => p.label === label)!.def;

const pg: Case[] = [
  { sql: 'SELECT name FROM product WHERE name = ‘Hammer’', rows: [['Hammer']], note: 'curly quotes pasted from a document' },
  { sql: 'select name\tfrom product\r\nwhere price < 10; -- cheap', rows: [['Trowel']] },
  { sql: 'SELECT name FROM product LIMIT 2, 2', rows: [['Trowel'], ['Hose']], ordered: true },
  { sql: 'SELECT name FROM product WHERE price IN (SELECT MAX(price) FROM product GROUP BY category_id) ORDER BY 1', rows: [['Hose'], ['Saw']], ordered: true },
  { sql: 'SELECT c.name, COUNT(*) AS n FROM category c, product p WHERE c.id = p.category_id GROUP BY c.name HAVING COUNT(*) = 2 ORDER BY 1', rows: [['Garden', 2], ['Tools', 2]], ordered: true },
  { sql: 'SELECT name, price, NTILE(2) OVER (ORDER BY price) AS half FROM product ORDER BY price', rows: [['Trowel', 7.25, 1], ['Hammer', 12.5, 1], ['Saw', 24, 2], ['Hose', 30, 2]], ordered: true },
  { sql: "SELECT name FROM product WHERE added_on >= '2025-02-01' AND added_on < '2025-04-01' ORDER BY added_on DESC", rows: [['Trowel'], ['Saw']], ordered: true },
  { sql: 'SELECT COUNT(*) FILTER (WHERE in_stock) AS n FROM product', reject: /FILTER/ },
  { sql: 'SELECT name FROM product WHERE category_id = ALL (SELECT id FROM category WHERE id = 1)', reject: /ALL/ },
  { sql: "SELECT 'x' AS a, 1 AS b UNION ALL SELECT 'y', 2", rows: [['x', 1], ['y', 2]] },
  { sql: 'SELECT name FROM product WHERE price > (SELECT AVG(price) FROM product WHERE category_id = product.category_id) ORDER BY 1', rows: [['Hose'], ['Saw']], ordered: true },
  { sql: 'SELECT MIN(added_on) AS first, MAX(added_on) AS last, MAX(added_on) - MIN(added_on) AS span FROM product', rows: [['2025-01-15', '2025-12-31', 350]] },
];

const mysql: Case[] = [
  { sql: "SELECT name FROM students WHERE enrolled = STR_TO_DATE('01/09/2024', '%d/%m/%Y') ORDER BY id", rows: [['Ana Díaz'], ["Ben O'Hara"]], ordered: true },
  { sql: 'SELECT name FROM students WHERE active ORDER BY gpa IS NULL, gpa DESC', rows: [['Ana Díaz'], ['Dee Wu'], ["Ben O'Hara"]], ordered: true },
  { sql: 'SELECT UCASE(SUBSTRING(name, 1, 1)) AS initial, COUNT(*) AS n FROM students GROUP BY initial ORDER BY initial', rows: [['A', 1], ['B', 1], ['C', 1], ['D', 1]], ordered: true },
  { sql: "SELECT COUNT(*) FROM enrollments WHERE grade LIKE 'A%' OR grade IS NULL", rows: [[3]] },
  { sql: 'UPDATE students SET active = NOT active WHERE id = 3', ok: true },
  { sql: 'SELECT active FROM students WHERE id = 3', rows: [[1]] },
];

const mssql: Case[] = [
  { sql: 'SELECT TOP 2 FullName FROM Patient WHERE Balance > 0 ORDER BY Balance', rows: [['Per Olsen'], ['Ola Nordmann']], ordered: true },
  { sql: 'SELECT FullName, DATEPART(dw, BirthDate) AS dw FROM Patient WHERE BirthDate IS NOT NULL ORDER BY PatientId', rows: [['Ola Nordmann', 3], ['Kari Hansen', 2]], ordered: true },
  { sql: "SELECT CONCAT_WS('-', FullName, NULL, 'x') AS s FROM Patient WHERE PatientId = 3", rows: [['Per Olsen-x']] },
];

const oracle: Case[] = [
  { sql: "SELECT ENAME, TO_CHAR(SAL, '9999') AS S FROM EMP WHERE EMPNO = 7369", rows: [['SMITH', '800']] },
  { sql: "SELECT ENAME FROM EMP WHERE HIREDATE >= TO_DATE('01-JAN-1982', 'DD-MON-YYYY')", rows: [['MILLER']] },
  { sql: 'SELECT DEPTNO, COUNT(*) AS N FROM EMP GROUP BY DEPTNO HAVING COUNT(*) >= 3 ORDER BY DEPTNO', rows: [[10, 3], [20, 3], [30, 3]], ordered: true },
  { sql: "SELECT ENAME, SAL, SAL * 1.1 AS RAISED FROM EMP WHERE JOB = 'CLERK' ORDER BY SAL", rows: [['SMITH', 800, 880], ['MILLER', 1300, 1430]], ordered: true },
  { sql: "SELECT ENAME FROM EMP WHERE MGR IS NULL OR MGR IN (SELECT EMPNO FROM EMP WHERE JOB = 'PRESIDENT') ORDER BY ENAME", rows: [['BLAKE'], ['CLARK'], ['JONES'], ['KING']], ordered: true },
  { sql: "INSERT INTO DEPT (DEPTNO, DNAME) VALUES (50, 'IT')", ok: true },
  { sql: 'SELECT LOC FROM DEPT WHERE DEPTNO = 50', rows: [[null]] },
];

const bundled: Case[] = [
  { sql: "SELECT * FROM OBSERVATION WHERE OBSERVED_ON >= DATE '2026-01-01' ORDER BY OBSERVED_ON", ok: true },
  { sql: 'SELECT A.FAMILY_NAME, COUNT(O.OBSERVATION_ID) AS n, MAX(O.OBSERVED_ON) - MIN(O.OBSERVED_ON) AS span_days FROM ASTRONOMER A JOIN OBSERVATION O ON O.ASTRONOMER_ID = A.ASTRONOMER_ID GROUP BY A.ASTRONOMER_ID ORDER BY n DESC, 1', ok: true, show: true },
  { sql: 'SELECT TELESCOPE_NAME, APERTURE_CM / 3 AS third FROM TELESCOPE ORDER BY 1', ok: true, show: true },
];

export const PROBES = [
  { label: 'pasted shop_pg', def: defOf('shop_pg'), cases: pg },
  { label: 'pasted school_pma', def: defOf('school_pma'), cases: mysql },
  { label: 'pasted clinic_mssql', def: defOf('clinic_mssql'), cases: mssql },
  { label: 'pasted scott_ora', def: defOf('scott_ora'), cases: oracle },
  { label: 'pasted observatory', def: PRELOADED_SCHEMAS.find((s) => s.id === 'observatory')!, cases: bundled },
];
