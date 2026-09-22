# Changelog

## Unreleased

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
