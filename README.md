# QueryTrace - Visual SQL Learning DBMS

Teaches SQL by animating how a query's answer is derived across live, interactable tables.
The teaching DBMS runs client-side: SQLite compiled to WASM (sql.js), isolated in a Web Worker.

Type a query (or pick a lesson) and QueryTrace decomposes execution into logical stages,
replaying them like a debugger:

All bundled scenarios, records, names, prompts, and expected results are fictional
examples created for QueryTrace. They teach general SQL concepts without reproducing
third-party classroom exercises or answer sets.

- **FROM / JOIN** - matched key pairs light up in both tables and pulses travel along the FK edge; outer-join rows kept without a match get a dashed border
- **WHERE** - eliminated rows fade with a strikethrough
- **GROUP BY / HAVING** - rows are color-coded by group; eliminated groups fade as units
- **SELECT / ORDER / LIMIT** - projected columns highlight and the result panel fills row by row

Click any lit row to highlight everywhere it contributes (join partners + result rows).
Playback: play / pause / step / reset, labeled stage scrubber, 0.5×/1×/2× speed, and a
plain-language narration of what each stage is doing.

The UI is canvas-first and responsive: the schema owns the full viewport at every size.
On laptops and desktops (≥1024px) the SQL editor and results float as collapsible
panels that shrink to slim edge tabs; playback lives in a floating dock. On smaller
screens the editor and intermediate results stay visible together in a split bottom
sheet so students can watch the active SQL clause and its rows at the same time.

## Run it

Requires Node.js 24 or newer.

```bash
npm ci
npm run dev        # http://localhost:3000
npm run test:trace # trace-engine tests against the seeded DB (node, no browser)
npm run check      # type-check, trace tests, and production build
```

## Deploy

The whole app remains statically deployable; no server database is required for
student SQL. SQLite and the trace compiler run off the UI thread in a dedicated
Web Worker. Built-in course schemas are tiny and rebuild locally; custom schemas
are exported as SQLite images and restored from IndexedDB. Lesson progress is
stored there as well. Browsers that deny storage still get a complete in-memory
session. Deploying is just hosting the build:

1. Push the repo to GitHub (`node_modules`, `.next`, and generated WASM files are
   gitignored; the `postinstall` script generates a content-hashed WASM asset).
2. Import the repo on Vercel. Zero config - it detects Next.js, runs
   `npm install` (which copies the sql.js WASM into `/public`) and `next build`.

All application code, the CodeMirror editor, and SQLite WASM are self-hosted.
The hashed WASM response is cached immutably for one year, so repeat visits do
not download the runtime again.

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
parentheses, LIKE, IN, BETWEEN, IS NULL, computed columns, CONCAT, field/table
aliases, COUNT/SUM/AVG/MIN/MAX, GROUP BY, HAVING, mixed-direction ORDER BY,
LIMIT, explicit inner/left/right/full outer joins, CROSS JOIN, comma-style joins,
multi-table joins, self-joins, UNION/UNION ALL, and uncorrelated/correlated/derived-table
subqueries. Column and table references are checked against the loaded schema before
execution, so a misspelled name is reported instead of silently becoming a text literal.

**Custom schemas:** the schema builder accepts `CREATE TABLE` and `INSERT INTO ... VALUES`
scripts as exported by MySQL Workbench / phpMyAdmin, pgAdmin, or SQL Server Management
Studio. Table options such as `ENGINE=InnoDB`, `DEFAULT CHARSET`, `AUTO_INCREMENT=n` and
`COMMENT`, column attributes such as `UNSIGNED`, `ENUM(...)`, `SERIAL`, `IDENTITY(1,1)`
and `ON UPDATE CURRENT_TIMESTAMP`, inline `KEY`/`INDEX` lines, `dbo.` prefixes and
`GO` separators are translated to SQLite automatically; `USE`, `SET`, `CREATE DATABASE`
and `DROP TABLE IF EXISTS` are ignored. Statements run one at a time, so an error names
the statement that failed (`CREATE TABLE equipment: duplicate column name: status`).
Tables without a declared PRIMARY KEY (import/staging tables) load and are traced by
SQLite rowid; the canvas marks them `NO PK`.
The detailed row-provenance pipeline is used wherever the query can be safely
decomposed; compound and derived-table queries expose their inner/branch results
and exact SQLite final result.

The schema builder intentionally accepts a safe construction subset:
CREATE TABLE plus INSERT INTO ... VALUES. Data-changing DML and destructive DDL
are not executed in visual query mode.

## Stack

Next.js 16 (App Router, TS strict) · React 18 · sql.js · @xyflow/react ·
node-sql-parser · Zustand · CodeMirror 6 · Tailwind CSS · Playwright

## Repository checks

Every push and pull request runs type checking, all trace-engine tests, a
production build, and the browser suite in Chromium, Firefox, and WebKit through
GitHub Actions.

## AI disclosure

This README was generated with AI assistance from OpenAI Codex (GPT-5).
