# Changelog

## Unreleased

- Accept `ORDER BY alias` (standard SQL), replace an alias in `GROUP BY` / `HAVING` by its expression, and explain why an alias cannot be used in `WHERE`. Double-quoted and bracketed names in `ORDER BY` are identifiers; only `ORDER BY 'text'` is refused.
- Allow bare columns of a table whose whole primary key is grouped (`GROUP BY v.venue_id` with `v.venue_name` selected), as PostgreSQL does.
- Rewrite `JOIN ... USING (a, b)` to its `ON` condition when the select list is explicit; honour `WITH name(a, b) AS (...)` column lists; accept `ORDER BY 3` with `SELECT *`; resolve quoted names such as `d."Sku Code"` from derived tables; accept `rowid` / `_rowid_` / `oid` as implicit columns.
- Translate `a MOD b`, `INSERT table` without `INTO` (SQL Server), a `schema.` prefix on a changed table, and `NULLS FIRST / LAST` inside a window's `ORDER BY`.
- Load more real export scripts: pg_dump `COPY ... FROM stdin` data blocks, `ALTER COLUMN ... SET DEFAULT` (serial `nextval()` defaults dropped), `SELECT pg_catalog.set_config(...)` lines, pg_dump scripts whose `E'...'` literals contain an escaped quote, SQL Server batches without semicolons, `INSERT` without `INTO`, `WITH CHECK ADD CONSTRAINT`, `CHECK CONSTRAINT`, and default constraints (`ADD CONSTRAINT df DEFAULT (1) FOR col`).
- Name every column of a violated composite key, and keep names with spaces, in the UNIQUE and NOT NULL rejection messages.
- Show a blob result as `BLOB(n bytes)` instead of copying its bytes to the page.
- Refuse a join that could form more than 50,000 row combinations (was 250,000) with the estimated count in the message, since every intermediate stage is kept for scrubbing.
- Add `npm run test:fuzz`: a differential battery of about 2,500 queries over the bundled schemas and four vendor-style custom schemas, checked against SQLite's own results and the provenance invariants; it runs in `npm run check` and CI.
- Make `lib/db.ts` load sql.js under Node so scripts and tests can use the real runtime.
- Replace the shortcuts popover with a full help dialog that explains what QueryTrace is, walks through the screen, the query stages, row tracing, playback, lessons, dialect translation, data changes, custom schemas, storage, and limits, with shortcuts to the lessons and schema dialogs.
- Translate MySQL / MariaDB, PostgreSQL, SQL Server and Oracle query spellings (`TOP`, `FETCH FIRST`, `ROWNUM`, `ILIKE`, `::type` casts, `EXTRACT`, `GROUP_CONCAT ... SEPARATOR`, `INTERVAL` arithmetic, `DIV`, `<=>`, `NULLS LAST`, `MINUS`, bracketed names, and more) to SQLite and show each rewrite beside the result.
- Emulate the date, string, numeric and NULL-handling functions SQLite lacks (`YEAR`, `DATE_FORMAT`, `DATEDIFF`, `DATE_ADD`, `NOW`, `LEFT`, `RIGHT`, `LEN`, `LOCATE`, `LPAD`, `MOD`, `NVL`, `REGEXP`, `TO_CHAR`, ...) with notes naming the SQLite equivalent.
- Trace CTEs (`WITH`), `INTERSECT` / `EXCEPT`, window functions, `CASE`, `GROUP BY` positions, and `SELECT` without `FROM`.
- Run `INSERT`, `UPDATE` and `DELETE` (including MySQL's `INSERT IGNORE`, `REPLACE INTO`, `ON DUPLICATE KEY UPDATE`, `TRUNCATE`) in the query editor with before / matched / after stages, cascade reporting, and rollback with an explanation when a constraint rejects the change.
- Explain ambiguous column names with the qualifiers to use, check columns read from CTEs and derived tables, and point to the table that does hold an unknown column.
- Select the failing statement in the schema dialog after a build error and keep the pasted text in place.
- Reload a bundled schema's original rows before a lesson runs when a data change altered them.
- Refresh the README and add a guided entry point, screenshot, and focused developer documentation.
- Align key-route checks in CI and update dependencies with security fixes.
- Clarify schema-import and visual-query capabilities.
- Add an MIT license, contribution guidance, security reporting, and issue forms.
