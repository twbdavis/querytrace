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
aggregates). `ORDER BY` may name a select-list alias (standard SQL); an alias in
`GROUP BY` or `HAVING` is replaced by its expression, as MySQL and PostgreSQL read it;
an alias in `WHERE` is refused with the reason. When every primary-key column of a table
is grouped, its other columns may be selected bare (PostgreSQL's functional-dependency
rule). `JOIN ... USING (a, b)` is rewritten to the `ON` condition it stands for when the
select list is explicit. A `WITH name(a, b) AS (...)` column list renames the CTE's
output. Column and table references, including those read from a CTE or derived
table, are checked against the loaded schema before execution, so a misspelled name is
reported instead of silently becoming a text literal, and a name that exists in two
joined tables is reported with the qualifiers to use. A join whose tables could form
more than 50,000 row combinations is refused before it runs, because every intermediate
stage is kept for scrubbing.

**Query dialects:** `lib/dialect.ts` rewrites the query spellings of MySQL / MariaDB
(first), PostgreSQL, SQL Server and Oracle into SQLite before parsing and records each
rewrite as a note shown under the editor ("Rewritten for SQLite: TOP 5 → LIMIT 5"):
`TOP n`, `FETCH FIRST n ROWS ONLY`, `ROWNUM <= n`, `ILIKE`, `RLIKE`, `x::type` and
`CAST(x AS UNSIGNED | CHAR | DATETIME ...)`, `CONVERT`, `EXTRACT(unit FROM d)`,
`SUBSTRING(s FROM a FOR n)`, `TRIM(BOTH ... FROM s)`, `POSITION(a IN b)`,
`GROUP_CONCAT(x SEPARATOR s)`, `LISTAGG`, `a DIV b`, `<=>`, `IS DISTINCT FROM`,
`NULLS FIRST/LAST`, `INTERVAL` arithmetic, `MINUS`, `FROM DUAL`, `[bracketed]` names,
`N'...'` and `DATE '...'` literals, `a MOD b`, `INSERT table` without `INTO` (SQL
Server), a `schema.` prefix on a changed table, MySQL `\'` escapes and `#` comments.
`lib/compatFunctions.ts` registers the functions SQLite lacks as JavaScript functions on
every connection (`YEAR`, `MONTH`, `DATE_FORMAT`, `DATEDIFF`, `DATE_ADD`, `NOW`, `LEFT`,
`RIGHT`, `LEN`, `LOCATE`, `LPAD`, `MOD`, `NVL`, `REGEXP`, `TO_CHAR`, `TO_DATE`, ...),
and the note names the SQLite equivalent. Constructs SQLite cannot express
(`DISTINCT ON`, `NATURAL JOIN`, `ROLLUP`, `ALL/ANY` quantifiers, `RANGE` / `GROUPS`
frames, session variables, `SELECT ... INTO`) are refused with the alternative
spelled out.

**Source dialect profiles:** `lib/queryCompatibility.ts` defines the profile the editor
reads the text as (`legacy`, shown as "Any SQL", plus `sqlite`, `mysql`, `mariadb`,
`postgresql`, `sqlserver`, `oracle`). A profile changes only the lexical rules whose
meaning differs between vendors: backslash escapes (MySQL / MariaDB), `#` comments
(MySQL / MariaDB), `[bracketed]` names (SQL Server) and `+` on strings (SQL Server).
The legacy profile keeps the mixed heuristics earlier sessions were written against.
Under MySQL and MariaDB `"text"` is a string literal, as on a default server (the
`ANSI_QUOTES` mode is not modelled; standard-SQL writers pick another profile): the
translator rewrites it to `'text'` except directly after `AS`, where MySQL accepts a quoted
alias, and the parser adds a note when the text matches a table or column of the loaded
schema, since the learner almost certainly meant the name.
Under Oracle, SQLite and the legacy profile an unaliased `FROM (SELECT ...)` is named
`DERIVED` by the parser (the vendors accept it); MySQL, PostgreSQL and SQL Server refuse it
as their engines do. `TOP n` next to LIMIT, OFFSET or FETCH is refused rather than letting one win.
A profile also carries four meanings that differ between vendors, each with a note beside
the result. `LIKE` compares letter case under PostgreSQL and Oracle
(`PRAGMA case_sensitive_like`, with `ILIKE` rewritten to `LCASE(a) LIKE LCASE(b)`) and
ignores it in every alphabet under MySQL, MariaDB and SQL Server (`lib/unicodeLike.ts`
replaces the connection's `like` function; SQLite's own folds A to Z only).
`SqlRuntime.applyLikeRules` sets this at the start of every request from the request's
profile, so each stage query agrees with the final result and nothing carries over. SQLite
will not build an index or generated column on a changed `LIKE`, so a CREATE that mentions
`LIKE` first gets a reopened connection with SQLite's own function, and a schema that
already has such an object keeps SQLite's `LIKE` in every mode, with a note. In the five
database modes `LOWER` / `UPPER` become the emulated `LCASE` / `UCASE`, which change
letters in every alphabet. Under MySQL and MariaDB `||` is logical
OR (rewritten to `OR` before any other step can introduce a `||`) and
`GROUP_CONCAT(a, b)` joins both values of each row. `GREATEST` / `LEAST` skip NULL
arguments under PostgreSQL and SQL Server (`MAX(COALESCE(a, b), COALESCE(b, a))`) and
return NULL under the others. The legacy profile keeps SQLite's reading of all four, by
design: the text alone does not say which vendor was meant. A CREATE typed in the editor
is read under the active profile too (`readDdlAsProfile` in `lib/db.ts`) before the
schema-import rules, which accept every vendor's spelling at once.
The profile is chosen from the dialect button in the top bar (`components/DialectMenu.tsx`),
which always shows the active profile; the lessons dialog's "Show in" toggle sets the same field.
The choice is snapshotted when Run is pressed and travels with the worker request
(`QueryOptions`), so a later change cannot reach a queued query; it is saved as an
optional field of the persisted state without changing `STATE_VERSION`, and
CodeMirror highlighting follows it. Oracle `ROWNUM` next to a same-scope `ORDER BY` is
refused (Oracle numbers rows before sorting); the nested form stays exact.

**Parser encodings:** the bundled `node-sql-parser` SQLite grammar cannot read
aggregate `FILTER (WHERE ...)`, explicit window frames or `OVER name` / `WINDOW`
clauses, all of which SQLite executes. `lib/parserEncodings.ts` follows the pattern of
`orderedAggregates.ts`: `agg(x) FILTER (WHERE c)` becomes `QT_FILTER(agg(x), c)` and a
frame becomes a constant `QT_FRAME('ROWS BETWEEN ...')` entry in the window's partition
list while the AST is analysed and serialized, and every generated SQL fragment restores
the native syntax before SQLite sees it. Backslashes inside string literals are masked the
same way, because the grammar would otherwise turn `'a\n'` into a newline. Named windows
are inlined per SELECT scope by the translator (`OVER w` → `OVER (...)`); inheritance
(`w2 AS (w ...)`) is refused. Only `ROWS` frames with an `ORDER BY` are accepted;
`RANGE`, `GROUPS`, `EXCLUDE` and frames on ranking functions (which would ignore them)
are refused. SQL Server `TOP n WITH TIES` is rewritten in the parser to a derived table
with `RANK() OVER (ORDER BY ...)` filtered to `<= n`, so boundary ties are kept. The
marker names are reserved and a query that spells one is refused.

**Coverage:** every `QueryRun` carries `coverage` (`lib/queryCompatibility.ts`): the
dialect, the explanation level and what a highlighted row means. `detailed` is the
row-provenance trace of a single SELECT over physical tables; CTE, derived-table and
compound queries are `components` (component previews, then the final result, no row
lineage); a FROM-less SELECT or CREATE is `result-only`. Recognised features (`filter`,
`window`, `window-frame`, `named-window`, `top-with-ties`, `cte`, ...) add plain-language
limits, such as a window value being computed from rows the highlight does not show. The
result panel labels the trace with the level and never offers row interactions a stage
does not have sources for.

**Lesson spellings:** a lesson keeps one portable query and may carry `variants`
(`lib/lessons.ts`) with the idiomatic spelling of SQLite, MySQL / MariaDB, PostgreSQL,
SQL Server or Oracle where it differs (string concatenation, quoted aliases,
case-sensitive LIKE). The lessons dialog's "Show in" toggle drives the editor's dialect,
shows the matching spelling on each card and marks lessons that read the same everywhere;
Run and Load use the shown text. The compatibility suite runs every variant under its own
profile and requires the portable lesson's rows.

Ordered `GROUP_CONCAT`, `STRING_AGG`, and `LISTAGG` preserve their requested sort
order using SQLite's aggregate-local `ORDER BY`. `lib/orderedAggregates.ts` encodes
that syntax only while the parser reads the query and restores it before execution.
PostgreSQL Boolean casts, nested precision casts, `SPLIT_PART`, `BTRIM`, and
`EXTRACT(ISOYEAR ...)` are also supported. Character length, slicing, positioning,
and padding functions count Unicode code points so supplementary characters such
as emoji remain intact. Ambiguous vendor behavior still uses the defined translation
subset; this is not a full implementation of each server's SQL dialect.

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
When a statement includes `RETURNING`, its final result contains the requested
columns and expressions, including matched rows whose UPDATE values did not change.
Deferred foreign-key failures at savepoint release also roll back the whole statement.
`INSERT ... SELECT ... RETURNING` previews only the source SELECT; `UPDATE ... FROM`
traces its actual matching target rows. Moving an integer primary key is counted as
an update even when its internal SQLite row identity changes.

**Structure changes in the editor:** `CREATE TABLE` with explicit columns and
`CREATE [UNIQUE] INDEX` run on the same connection as subsequent queries. Each CREATE
uses a savepoint and validates the resulting schema before refreshing the canvas,
column metadata, foreign-key edges, and saved custom database. The CREATE stage
reports the object name and type. `IF NOT EXISTS` preserves existing objects and
rows. Generated columns appear in both metadata and results; composite foreign-key
edges follow the declared parent key order. Failed CREATE statements leave no partial
objects. Temporary tables, views, triggers, and CREATE TABLE AS SELECT remain outside
this supported subset; use explicit columns followed by INSERT ... SELECT.

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
`CLUSTERED`/`ON [PRIMARY]`, any `schema.` prefix in a table position, `GO` separators,
T-SQL batches that run several statements without semicolons, `INSERT` without `INTO`,
`WITH CHECK ADD CONSTRAINT`, `CHECK CONSTRAINT` (ignored), `ADD CONSTRAINT ... DEFAULT
(x) FOR col` (folded into the column), pg_dump `COPY ... FROM stdin` data blocks (turned
into `INSERT` rows), `ALTER COLUMN ... SET DEFAULT` (folded; a `nextval()` default is
dropped because `INTEGER PRIMARY KEY` already numbers rows), `SELECT pg_catalog.set_config`
lines, and psql meta-commands. Text pasted from Word or e-mail is repaired too (byte order mark,
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
Explicit automatic keys must be a table's single integer primary key. They retain
their high-water mark after deletion; MySQL `AUTO_INCREMENT=n` seeds are preserved.
Custom identity increments and nondefault identity starts are rejected with guidance
to supply explicit values. Sequence handling is an SQLite-backed approximation;
it does not reproduce each vendor's allocation behavior after failed transactions.
The detailed row-provenance pipeline is used wherever the query can be safely
decomposed; compound and derived-table queries expose their inner/branch results
and exact SQLite final result.

Schema import builds a separate in-browser database using the supported construction
and editing statements listed above. Visual query mode traces `SELECT` statements and
the row-changing and CREATE statements described above. ALTER and DROP remain outside
live query mode; rebuild the schema through the schema editor for other structure changes.

The schema canvas measures table cards before showing a new schema. Imported
tables use shelves sized from those measurements; bundled hand layouts retain
their positions wherever there is sufficient space. Row/value growth and new
tables move only cards that no longer fit, reserving the largest displayed size
so mutation playback does not shuffle the layout. Ordinary queries and dragging
preserve positions. Each successful schema load replaces the canvas state, even
when its table names match the previous schema, so foreign-key wires also refresh.
Relationship routes use measured key-column anchors and shared lane reservations,
with an orthogonal gutter search when simple routes are blocked by other cards.
Routing waits for measured placement and stable dimensions; subsequent changes
are coalesced into one shared pass per animation frame. Cards
with more than 60 rows render a viewport window of at most 80 rows plus a pinned
row. Dense scenes share an 8,000-cell row budget, including initial measurements;
spacers and font-measured width probes retain the complete table's geometry and
key anchors, including Unicode values outside the visible row window.
Selecting an off-screen row brings it into view. Text and binary cell previews
are bounded independently of the underlying values retained for tracing.

## Browser resource boundaries

SQL requests are serialized in a worker. A query has a 10-second deadline and a
schema load has a 15-second deadline, measured from dispatch. An unresponsive
worker is terminated; the next query restores the most recently acknowledged
database checkpoint, including changes to bundled schemas. A timed-out operation
is not acknowledged or kept. Snapshot or response-delivery failures after a
change also discard the worker and restore the last acknowledged checkpoint.
Editing the next query cancels the obsolete trace without discarding a successful
write's canvas data or saved custom database.

The application queues database operations through their persistence acknowledgment.
Queries cannot start while a schema replacement is pending. Preparing a lesson always
queues its original schema, including when a previous write has not acknowledged yet.
Successful builds clear only the draft that was submitted, preserving any later edits.
Schema settings can resume the saved custom checkpoint after a lesson without rebuilding
its original DDL. Resume reserves its request order before waiting for writes or storage;
a later lesson or schema choice cancels that resume before it can dispatch an old choice.
Custom database saves compare a revision inside one IndexedDB transaction. A stale
tab's write is rejected and its worker restores the latest durable checkpoint with
an explicit conflict message. Lesson and draft saves patch only their own fields.

Database files are bounded to 16 MiB and SQLite allocations to 64 MiB. Each trace
has a cumulative budget of 500,000 cells or 8 MiB of raw values, with no more than
50,000 rows in any intermediate result. These are value budgets, not total
JavaScript heap guarantees: object/provenance overhead is additional. A text value
is limited to 100,000 characters and a binary value to 100,000 bytes. Result rows
are read incrementally so an oversized result fails before it is fully retained.
Mutation and CREATE validation includes these limits before committing. Bundled
and custom sessions both enforce table/row/column capacity limits on edits.

SQLite INTEGER values, including hidden rowids, must fit the exact JavaScript integer
range (-9,007,199,254,740,991 through 9,007,199,254,740,991). They are read as BigInt before
validation, then converted to numbers. Out-of-range imports, results, and writes are
rejected; writes roll back. Store larger identifiers as TEXT, or explicitly CAST a
query result AS TEXT to retain every digit. REAL values keep SQLite's floating-point
semantics.

Compatibility functions check allocation sizes before padding/repetition and
before decoding binary arguments. REGEXP accepts a conservative subset: at most
200 pattern characters, 10,000 input characters, one repetition, no repeated
groups or backreferences, and a repetition count no larger than 1,000. The worker
deadline remains a backstop for expensive parsing, SQL, or regular expressions.

## Stack

Next.js 16 (App Router, TS strict) · React 18 · sql.js · @xyflow/react ·
node-sql-parser · Zustand · CodeMirror 6 · Tailwind CSS · Playwright

## Repository checks

Every push and pull request runs type checking, all trace-engine tests, the
differential fuzz battery (`scripts/fuzzTrace.ts`: every query traced through the
worker's runtime and checked against SQLite's own result, the provenance invariants,
database state after read-only statements, and a repeat run), a production build,
and the browser suite in Chromium, Firefox, and WebKit through GitHub Actions.
