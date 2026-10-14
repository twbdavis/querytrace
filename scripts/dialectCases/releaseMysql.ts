import type { SchemaDef } from '../../lib/schemas';
import type { Case } from '../testDialects';

const def: SchemaDef = {
  id: 'custom', name: 'MySQL and MariaDB release DDL', description: '', starterQuery: 'SELECT * FROM import_stamp',
  ddl: `CREATE TABLE import_stamp(id INT PRIMARY KEY, tag VARCHAR(20));
ALTER TABLE import_stamp MODIFY id INT NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=15;
ALTER TABLE import_stamp ALTER COLUMN tag SET DEFAULT 'imported';
INSERT INTO import_stamp(tag) VALUES('ready');`,
};

const cases: Case[] = [
  { sql: 'SELECT id, tag FROM import_stamp', rows: [[15, 'ready']] },
  { sql: 'CREATE TABLE account (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(30) NOT NULL UNIQUE, balance DECIMAL(8,2) NOT NULL DEFAULT 10.00 CHECK(balance >= 0)) ENGINE=InnoDB AUTO_INCREMENT=100', ok: true },
  { sql: 'CREATE TABLE IF NOT EXISTS account (wrong INT)', ok: true },
  { sql: "INSERT INTO account(name) VALUES ('Ana')", rows: [[100, 'Ana', 10]] },
  { sql: "INSERT INTO account(name, balance) VALUES ('Ben', 20)", rows: [[101, 'Ben', 20]] },
  { sql: "INSERT INTO account(name) SELECT 'Cy' WHERE 1 = 1", rows: [[102, 'Cy', 10]] },
  { sql: 'DELETE FROM account WHERE id = 102', ok: true },
  { sql: "INSERT INTO account(name) VALUES ('Dee')", rows: [[103, 'Dee', 10]] },
  { sql: 'UPDATE account SET balance = balance + 2 WHERE id = 100', rows: [[100, 'Ana', 12]] },
  { sql: "INSERT INTO account(id, name, balance) VALUES(100, 'Ana', 42) ON DUPLICATE KEY UPDATE balance = VALUES(balance)", rows: [[100, 'Ana', 42]] },
  { sql: "INSERT IGNORE INTO account(id, name, balance) VALUES(100, 'ignored', 9)", ok: true },
  { sql: 'SELECT id, name, balance FROM account ORDER BY id', rows: [[100, 'Ana', 42], [101, 'Ben', 20], [103, 'Dee', 10]], ordered: true },
  { sql: 'CREATE TABLE detail (id INT AUTO_INCREMENT PRIMARY KEY, account_id INT NOT NULL, label VARCHAR(30) DEFAULT \'detail\', FOREIGN KEY(account_id) REFERENCES account(id) ON DELETE CASCADE)', ok: true },
  { sql: 'INSERT INTO detail(account_id) VALUES(100), (101)', ok: true },
  { sql: 'SELECT account_id, label FROM detail ORDER BY id', rows: [[100, 'detail'], [101, 'detail']], ordered: true },
  { sql: 'CREATE INDEX ix_detail_account ON detail(account_id)', ok: true },
  { sql: 'CREATE INDEX IF NOT EXISTS ix_detail_account ON detail(account_id)', ok: true },
  { sql: 'CREATE TABLE invoice (id INT PRIMARY KEY, units INT, price DECIMAL(8,2), total DECIMAL(8,2) GENERATED ALWAYS AS (units * price) STORED)', ok: true },
  { sql: 'INSERT INTO invoice(id, units, price) VALUES(1, 3, 2.5)', ok: true },
  { sql: 'SELECT id, total FROM invoice', rows: [[1, 7.5]] },
  { sql: 'UPDATE invoice SET units = 4 WHERE id = 1', rows: [[1, 4, 2.5, 10]] },
  { sql: 'UPDATE account SET balance = 0 WHERE id = 999', columns: ['id', 'name', 'balance'], rows: [] },
  { sql: 'DELETE FROM detail WHERE id = 999', columns: ['id', 'account_id', 'label'], rows: [] },
  { sql: 'DELETE FROM account WHERE id = 101', ok: true },
  { sql: 'SELECT id, account_id FROM detail', rows: [[1, 100]] },
  { sql: 'UPDATE account SET balance = -1 WHERE id = 100', reject: /CHECK/i },
  { sql: 'SELECT balance FROM account WHERE id = 100', rows: [[42]] },
  { sql: "INSERT INTO account(name) VALUES('batch'), ('Ana')", reject: /UNIQUE|already/i },
  { sql: 'SELECT COUNT(*) FROM account', rows: [[2]] },
  { sql: 'INSERT INTO detail(account_id) VALUES(999)', reject: /FOREIGN KEY/i },
  { sql: 'SELECT COUNT(*) FROM detail', rows: [[1]] },
];

export const PROBES = [
  { label: 'release MySQL CREATE and DML', def, cases },
  { label: 'release MariaDB CREATE and DML', def: { ...def, name: 'MariaDB release DDL' }, cases },
];
