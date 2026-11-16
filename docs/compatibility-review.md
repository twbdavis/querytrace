# Review of the browser SQL compatibility plan

Reviewed against the checkout on October 29, 2026. Companion to
[browser-sql-compatibility-plan.md](browser-sql-compatibility-plan.md).

## Verdict

The plan is sound where it matters: keep SQLite execution, separate result
semantics from explanation coverage, carry the dialect choice immutably through
the worker, and never silently simplify a query. Its weak point is M3, which
proposes a parser adapter plus a normalized query representation. That is a
rewrite of `lib/traceEngine.ts` (1,700 lines of AST visitors) to unlock three
constructs the bundled grammar lacks. The repository already solves exactly this
problem with a parser-only encoding (`lib/orderedAggregates.ts`): native SQLite
syntax is rewritten into a parseable function call for analysis and restored
before execution. The first release should extend that pattern behind one
module rather than introduce an IR.

## Findings confirmed in this checkout

| Claim in the plan | Verified | Note |
| --- | --- | --- |
| Parser cannot read aggregate `FILTER` | Yes | `node-sql-parser` sqlite build fails at the `(` after `FILTER`. |
| Parser cannot read explicit window frames | Yes | Fails at `ROWS`. SQLite 3.49.1 executes them. |
| Parser cannot read `OVER name` / `WINDOW` | Yes | Fails at the window name. |
| `NATURAL JOIN` misparses as alias `NATURAL` | Yes | Translator rejects it before the parser sees it; keep that. |
| `TOP n WITH TIES` becomes plain `LIMIT n` | Yes | `lib/dialect.ts` drops `WITH TIES`; the only test has no boundary tie. |
| Oracle `ROWNUM` with same-scope `ORDER BY` becomes final `LIMIT` | Yes | Oracle numbers rows before sorting, so the rewrite is not equivalent. |
| `STATE_VERSION` bump would wipe lesson progress | Yes | `normalizeState` treats any other version as an older curriculum. |
| SQLite resolves output aliases inside a window `ORDER BY` | No | `RANK() OVER (ORDER BY avg_s)` fails; a ranked rewrite must substitute the expression. |

## Critique

1. **M3 is over-scoped.** A normalized IR is the right long-term shape for
   `JOIN ... USING` relational binding (M7) and recursive CTEs (M8), but it is
   not required for FILTER, named windows or ROWS frames. Use the encoding
   pattern; keep the IR as an M7 decision.
2. **WITH TIES does not need an interim rejection.** The ranked rewrite is a
   small AST transformation because the derived-table path already exists in
   `buildAdvancedTrace`. Ship the rewrite with the regression, restricted to a
   single ordered SELECT without DISTINCT, compound branches or OFFSET/FETCH.
3. **The profile must change interpretation, not just labels.** The plan says
   this but does not name the ambiguous rules. In this translator they are:
   backslash escapes (MySQL only), `#` comments (MySQL only), `[bracket]`
   identifiers (SQL Server only), and `+` as string concatenation (SQL Server
   only). The legacy profile keeps the current mixed heuristics.
4. **Two common divergences are missing from the plan.** MySQL reads
   `"text"` as a string literal and `||` as logical OR by default. The string
   reading was built afterwards (MySQL / MariaDB profiles, with a note when the text
   matches a column name), and `||` as OR followed in the pre-release pass
   (MySQL / MariaDB profiles, with a note that points to `CONCAT()`).
5. **Native differential checks are not available in this environment.** Every
   expected result in the new fixtures is hand-computed from the vendor
   documentation the plan cites. The plan already allows this; it should say
   that the first release is verified that way. PostgreSQL has since gained a
   real-engine check (G15): every PostgreSQL-mode query in the tour, the
   lessons and the FILTER / frame / named-window fixtures is also run on
   PostgreSQL itself (PGlite) and must return the same rows.
6. **Coverage can stay small.** `explanation`, `lineage`, `features`,
   `limits`, `revision` and `dialect` are enough. `semantics` as a separate
   enum duplicates what `limits` already says in words.
7. **Clause highlighting needs depth awareness.** `computeClauseRanges` takes
   the first `WHERE` token anywhere, so `FILTER (WHERE ...)` would be
   highlighted as the outer WHERE. The plan lists this under M3; it belongs with
   M4 because FILTER is what triggers it.

## Goal-seeking criteria

Each criterion is machine-checkable. The build loop is: implement, run
`npm run goals`, fix the first failing criterion, repeat until every criterion
passes, then run the full release gate.

| Id | Criterion | Check |
| --- | --- | --- |
| G1 | Types compile. | `npm run typecheck` |
| G2 | No existing behaviour regresses. | `test:dialects` (711 cases), `test:trace`, `test:sequence`, `test:schema`, `test:security`, `test:fuzz` all pass. |
| G3 | Tied results are never shortened. | `TOP 2 WITH TIES` and `TOP 3 WITH TIES` over scores `100, 90, 90, 80` both return three rows; `n = 0`, fewer than `n` rows, multiple keys, hidden sort key, alias sort key all have expected rows. |
| G4 | FILTER is exact. | For `(x, p)` = `(1,1),(1,1),(NULL,1),(2,0)` filtering on `p = 1`: `COUNT(*) = 3`, `COUNT(x) = 2`, `SUM(x) = 2`, `AVG(x) = 1`, `COUNT(DISTINCT x) = 1`; a group with no qualifying rows stays in the output with `COUNT = 0` and `SUM = NULL`; two differently filtered aggregates in one row differ. |
| G5 | ROWS frames are exact. | Amounts `10, 20, 30` ordered by id: 1-preceding/current gives `10, 30, 50`; unbounded/current gives `10, 30, 60`; partition edges clip; `RANGE`, `GROUPS`, `EXCLUDE`, frames without `ORDER BY` and frames on ranking functions are rejected with a specific message. |
| G6 | Named windows resolve per scope. | Repeated use, definition with frame, unknown name, duplicate name, inheritance (`w2 AS (w ...)`) and `OVER (w ORDER BY ...)` are all exact or rejected as documented. |
| G7 | Coverage is honest. | Every `QueryRun` carries `coverage`; `detailed` only on the row-provenance path; derived/CTE/compound paths are `components`; a `components` result never carries `resultRowSources`; window and FILTER queries carry a limit note. |
| G8 | The profile changes interpretation. | `SELECT 'x' + 'y'` is `'xy'` under `sqlserver` and `0` under `mysql`; `[Name]` is an identifier under `sqlserver` and an error under `postgresql`; `# comment` is a comment under `mysql` only. |
| G9 | Old sessions survive. | A saved version-3 state without a dialect loads with `ranLessons` intact and `queryDialect = legacy`; an invalid dialect value falls back to `legacy`; `STATE_VERSION` is unchanged. |
| G10 | Lessons are portable. | Every bundled lesson query returns identical rows under every profile, except where the vendor itself reads the portable spelling differently (`LIKE '%the%'` under PostgreSQL and Oracle); there the hand-computed vendor rows are expected and the profile must show a variant that returns the portable rows. |
| G11 | No silent simplification. | `WITH TIES` never translates to a bare `LIMIT`; `ROWNUM` with a same-scope `ORDER BY` is rejected; reserved encoding names (`QT_FILTER`, `QT_FRAME`, `QT_ORDERED_GROUP_CONCAT`) in user SQL are rejected. |
| G12 | Highlighting is scope-aware. | `FILTER (WHERE ...)` and window `ORDER BY` are not reported as the outer `WHERE` / `ORDER BY` ranges. |
| G13 | Release gate. | `npm run check` (includes `next build`) passes. |
| G14 | Every profile reads its own idiom. | `npm run test:tour`: ten to thirty idiomatic queries per profile return hand-computed rows (and match a plain SQLite spelling where one exists); each profile refuses the other vendors' lexical rules (`#` comments, `[brackets]`, unaliased derived tables where the vendor forbids them, `TOP` mixed with `LIMIT`). |
| G15 | PostgreSQL mode matches PostgreSQL. | `npm run test:postgres`: every PostgreSQL-mode query of the tour, every lesson in its PostgreSQL spelling, the FILTER / ROWS frame / named-window fixtures and the text-comparison fixtures return the same rows from the real SqlRuntime and from PostgreSQL 18 (PGlite) loaded with the same script. Anything PostgreSQL refuses fails the run unless it is listed with its reason. |
| G16 | Long pastes are quick and complete. | `npm run test:speed`: each construct the translator rewrites, repeated up to the 20,000 character limit, translates within 1.5 s under every profile that reads it (measured: under 0.25 s), and no rewrite stops part-way through.|

## Scope of this build

Change sets 1 to 6 of the plan, adapted as above: baseline and tie regression,
coverage metadata, dialect preference through the worker, parser encodings in
place of the IR, aggregate FILTER and named windows, ROWS frames, and the
verified `TOP ... WITH TIES` rewrite from change set 7. `DISTINCT ON`,
`JOIN ... USING` expansion, recursive CTEs and the M9 extensions remain
follow-on milestones.

## Known gaps after the release audit (Nov 2026)

Closed in the pre-release pass, each pinned by cases in `scripts/dialectCases/tour.ts`
or `compatibility.ts`:

- PostgreSQL and Oracle `LIKE` now compares letter case; `ILIKE` lower-cases both sides. The rule is applied per request (see "LIKE and SQLite's own function" below).
- MySQL / MariaDB `||` is logical OR, and `GROUP_CONCAT(a, b)` joins both values of each row.
- PostgreSQL and SQL Server `GREATEST` / `LEAST` skip NULL arguments; a single argument is no longer read as the aggregate.
- A column named `rows`, `range` or `groups` inside `OVER (...)` is read as a column; a real frame after it still works.
- `TOP n WITH TIES` ordered by a window function is refused with the derived-table spelling to use instead.
- Oracle `ROWNUM` in a `DELETE` or `UPDATE` is refused in plain words with a key-based alternative.
- The dialect plumbing (button, worker, saved mode, lessons toggle, menu keyboard and phone layout) is covered in a real browser by `tests/dialect-mode.spec.ts`.

Closed in the final pass (Nov 10, 2026), each pinned by cases in
`scripts/dialectCases/text.ts`, `scripts/testTranslatorSpeed.ts` or
`scripts/testPostgresDifferential.ts`:

- **Letters outside A to Z.** Under MySQL, MariaDB and SQL Server `LIKE` ignores letter case in every alphabet (`'École' LIKE 'é%'`). In all five database modes `LOWER` / `UPPER` change accented letters (rewritten to the emulated `LCASE` / `UCASE`), and so does `ILIKE`.
- **Reserved names.** The check for `QT_FILTER`, `QT_FRAME` and `QT_ORDERED_GROUP_CONCAT` now reads the translated text, so a marker name inside a MySQL string with `\'` is text, not a refusal.
- **Private-use characters.** U+E000 in the learner's text (and the escape prefix U+E001) is written as a two-character escape while the AST exists and restored exactly; the restore runs once per text (`restoreParsedSql`).
- **CREATE follows the mode.** A CREATE typed in the editor is read under the active profile before the schema-import rules: PostgreSQL and Oracle refuse `[brackets]` and `#` comments, MySQL reads `"text"` as a string and `\'` as an escaped quote.
- **Long pastes.** The shared call rewriter, the `::` cast loop, date arithmetic, `+` on strings, `ILIKE` and LIKE escapes keep a masked copy in step with each rewrite instead of re-reading the query. The slowest construct at the size limit went from about 0.65 s to under 0.25 s. Three of those loops used to stop silently after 100 or 200 rewrites; they now finish.
- **A real engine for PostgreSQL.** G15 compares 92 PostgreSQL-mode queries with PostgreSQL 18 itself. It found no wrong rows. It did find four tour cases that were not valid PostgreSQL (quoted upper-case names, date functions on a `CHAR(10)` column without a cast); they were rewritten the way a PostgreSQL user must write them.

### LIKE and SQLite's own function

SQLite refuses to build an index or a generated column on a `LIKE` that was
switched (`PRAGMA case_sensitive_like`) or replaced, and an index built on
its own `LIKE` would disagree with a changed one. `SqlRuntime.applyLikeRules`
therefore decides per request, without assuming the connection's state:

- SQLite and "Any SQL" requests never touch `LIKE` on an untouched connection.
- PostgreSQL / Oracle requests set the pragma; MySQL / MariaDB / SQL Server requests install `lib/unicodeLike.ts`.
- A CREATE that mentions `LIKE` first exports the database, which makes sql.js reopen it with SQLite's own function.
- A schema that already has an index or generated column mentioning `LIKE` keeps SQLite's `LIKE` in every mode, and the note beside the result says so.

## By design

The subsequent [final release validation](release-validation-2026-11-10.md) adds
15 successful unique queries per selectable mode and fixes computed date
arithmetic, LEN/CHARINDEX boundaries and expression-valued NULLs in DECODE.
The PostgreSQL native comparison now covers 125 queries, including the new
acceptance corpus and 18 date-expression regressions, with the same two
documented exclusions.

- **"Any SQL" uses SQLite's meaning where databases disagree.** The text alone does not say which database was meant, so `LIKE` ignores the case of A to Z only, `||` joins text, `GREATEST` / `LEAST` return NULL on any NULL argument and `GROUP_CONCAT(a, b)` treats `b` as the separator. The help text and the mode menu say so; picking a database gives its exact rules.
- **A mode is not a validator.** A mode applies its vendor's rules where meanings differ. It does not refuse what only another vendor accepts (`GROUP_CONCAT` under PostgreSQL, `WHERE 0`, date functions on a text column without a cast). G15 lists the two fixtures it skips for this reason.

## Still open

Each with its current behaviour. The first two can change which rows come back
compared with the named database, and no note marks them; the help text states
the first. The others are places where a real database is stricter or prints a
value differently.

- **Text compared with `=` is case-sensitive in every mode.** MySQL, MariaDB and SQL Server ignore letter case under their default collations, so `name = 'nia'` finds Nia there and nothing here. The same holds for `<>`, `IN`, `GROUP BY`, `DISTINCT`, `ORDER BY` and joins on text. Modelling collations touches every comparison the trace engine generates; it was set aside for a release of its own. The help text states the difference.
- **Accents.** MySQL's default collation also ignores accents (`'ecole' LIKE 'é%'`); here accents compare exactly in every mode.
- **Quoted names and letter case.** PostgreSQL folds unquoted names to lower case and Oracle to upper case, and both compare quoted names exactly. Names match without regard to case in every mode here, so `"SCREENING"` works where PostgreSQL would refuse it.
- **Date versus timestamp.** Dates are text here. PostgreSQL's `date + interval` is a timestamp at midnight and prints with `00:00:00`; here it prints as the date.
- **Real-engine checks for the other four vendors.** MySQL, MariaDB, SQL Server and Oracle have no in-process build, and no Docker or client was available. Their expected rows remain hand-computed from vendor documentation. SQL Server LocalDB is installed on the development machine and could back a local-only check.
