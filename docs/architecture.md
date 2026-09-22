## How the trace works

`lib/traceEngine.ts` never instruments SQLite internals. Inside the SQL worker it
decomposes the parsed AST (node-sql-parser) into stages and runs intermediate
PK-projection queries against sql.js to compute exact row provenance:

- provenance uses each ordinary SQLite table's stable rowid, independent of
  whether its learner-facing key is text, integer, or composite
- each join step selects rowids from all tables joined so far (NULLs mark outer-join extension)
- WHERE / HAVING are computed as diffs against the previous stage's rowid sets
- GROUP BY and scalar aggregates use `GROUP_CONCAT(rowid)` so each result maps
  back to every contributing source row
- the final stage appends provenance columns to the user's own projection

Each stage emits a `TraceStep`; the UI is derived purely from `trace[currentStep]`,
so scrubbing backwards restores earlier states exactly.

**Curriculum coverage:** SELECT/DISTINCT with comparisons, AND/OR/NOT,
parentheses, LIKE, IN, BETWEEN, IS NULL, computed columns, CASE, CONCAT, field/table
aliases, COUNT/SUM/AVG/MIN/MAX, GROUP BY (by name or position), HAVING,
mixed-direction ORDER BY, LIMIT, explicit inner/left/right/full outer joins, CROSS JOIN,
comma-style joins, multi-table joins, self-joins, UNION/UNION ALL/INTERSECT/EXCEPT,
uncorrelated/correlated/derived-table subqueries, non-recursive CTEs (`WITH`), and
window functions (`ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)`, windowed
aggregates). Column and table references, including those read from a CTE or derived
table, are checked against the loaded schema before execution, so a misspelled name is
reported instead of silently becoming a text literal, and a name that exists in two
joined tables is reported with the qualifiers to use.

**Query dialects:** `lib/dialect.ts` rewrites the query spellings of MySQL / MariaDB
(first), PostgreSQL, SQL Server and Oracle into SQLite before parsing and records each
rewrite as a note shown beside the result ("Rewritten for SQLite: TOP 5 → LIMIT 5"):
`TOP n`, `FETCH FIRST n ROWS ONLY`, `ROWNUM <= n`, `ILIKE`, `RLIKE`, `x::type` and
`CAST(x AS UNSIGNED | CHAR | DATETIME ...)`, `CONVERT`, `EXTRACT(unit FROM d)`,
`SUBSTRING(s FROM a FOR n)`, `TRIM(BOTH ... FROM s)`, `POSITION(a IN b)`,
`GROUP_CONCAT(x SEPARATOR s)`, `LISTAGG`, `a DIV b`, `<=>`, `IS DISTINCT FROM`,
`NULLS FIRST/LAST`, `INTERVAL` arithmetic, `MINUS`, `FROM DUAL`, `[bracketed]` names,
`N'...'` and `DATE '...'` literals, MySQL `\'` escapes and `#` comments.
`lib/compatFunctions.ts` registers the functions SQLite lacks as JavaScript functions on
every connection (`YEAR`, `MONTH`, `DATE_FORMAT`, `DATEDIFF`, `DATE_ADD`, `NOW`, `LEFT`,
`RIGHT`, `LEN`, `LOCATE`, `LPAD`, `MOD`, `NVL`, `REGEXP`, `TO_CHAR`, `TO_DATE`, ...),
and the note names the SQLite equivalent. Constructs SQLite cannot express
(`DISTINCT ON`, `NATURAL JOIN`, `ROLLUP`, `FILTER (WHERE ...)`, `ALL/ANY` quantifiers,
window frames, session variables, `SELECT ... INTO`) are refused with the alternative
spelled out.

**Data changes in the editor:** `INSERT`, `UPDATE`, `DELETE` (and MySQL's `INSERT
IGNORE`, `REPLACE INTO`, `INSERT ... SET`, `ON DUPLICATE KEY UPDATE`, `TRUNCATE`) run
against the loaded schema with their own stage sequence: the table before the change,
the rows the `WHERE` clause selects, then the applied change with every table touched,
including rows removed or nulled by `ON DELETE CASCADE` / `SET NULL`. Earlier stages
display the tables as they were (`TraceStep.tableSnapshots`); the final stage shows the
live data. The statement runs inside a savepoint and is rolled back with an explanation
when a key, `NOT NULL`, `CHECK` or foreign-key constraint (or a custom-schema size limit)
rejects it. Changes to a custom schema are saved with it; changes to a bundled schema
last for the session and lessons reload the original rows first.

**Custom schemas:** the schema builder accepts `CREATE TABLE`, `INSERT`, `UPDATE`,
`DELETE`/`TRUNCATE`, `CREATE INDEX` and `ALTER TABLE` scripts as exported by MySQL
Workbench / phpMyAdmin, pgAdmin / pg_dump, SQL Server Management Studio or Oracle tools.
Dialect syntax is translated to SQLite automatically: table options (`ENGINE=InnoDB`,
`DEFAULT CHARSET`, `AUTO_INCREMENT=n`, `COMMENT`), column attributes (`UNSIGNED`,
`ENUM(...)`, `SERIAL`, `IDENTITY(1,1)`, `DEFAULT nextval(...)`, `ON UPDATE
CURRENT_TIMESTAMP`), inline `KEY`/`INDEX` lines, `ALTER TABLE ... ADD CONSTRAINT`
(folded into the table's CREATE), `INSERT IGNORE`, `REPLACE INTO`, `INSERT ... SET`,
`ON DUPLICATE KEY UPDATE`, MySQL `\'` string escapes and `#` comments, `N'...'` and
`E'...'` literals, `::type` casts, `NOW()`/`GETDATE()`/`SYSDATE`, `TO_DATE` of ISO
literals, typed literals (`DATE '...'`), `NVARCHAR(MAX)`, `VARCHAR2(n CHAR)`, `text[]`,
`CLUSTERED`/`ON [PRIMARY]`, any `schema.` prefix in a table position, `GO` separators and
psql meta-commands. Text pasted from Word or e-mail is repaired too (byte order mark,
curly quotes, non-breaking spaces). A user column named `rowid` is fine: tracing uses
SQLite's `_rowid_` alias. Session
statements (`USE`, `SET`, `CREATE DATABASE`, `DROP ... IF EXISTS`, transactions,
sequences, grants) are ignored. Statements run one at a time, so an error names the
statement that failed (`CREATE TABLE equipment: duplicate column name: status`) and the
schema dialog selects that statement in the editor, keeping the text as typed. Rows may
be inserted before their parents, as dumps do: the script is accepted when the final
state satisfies every foreign key, and the first orphan is reported with its values
otherwise. Tables without a declared PRIMARY KEY (import/staging tables) load and are
traced by SQLite rowid; the canvas marks them `NO PK`.
The detailed row-provenance pipeline is used wherever the query can be safely
decomposed; compound and derived-table queries expose their inner/branch results
and exact SQLite final result.

Schema import builds a separate in-browser database using the supported construction
and editing statements listed above. Visual query mode traces `SELECT` statements and
the row-changing statements described above; structural changes (`CREATE`, `ALTER`,
`DROP`) belong in the schema script and are redirected there.

## Stack

Next.js 16 (App Router, TS strict) · React 18 · sql.js · @xyflow/react ·
node-sql-parser · Zustand · CodeMirror 6 · Tailwind CSS · Playwright

## Repository checks

Every push and pull request runs type checking, all trace-engine tests, a
production build, and the browser suite in Chromium, Firefox, and WebKit through
GitHub Actions.
