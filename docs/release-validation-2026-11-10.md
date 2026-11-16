# Final SQL-mode release validation — November 10, 2026

## Scope

The requested four vendor families are MySQL/MariaDB, PostgreSQL, SQL Server,
and Oracle. The current UI has seven choices, so this gate also checks MariaDB
separately, SQLite, and Any SQL. Each choice must execute **15 distinct queries
successfully**, with exact expected results. Expected refusals and additional
bug regressions are counted separately. All data is the fictional, bundled
Independent film festival dataset.

The acceptance corpus is shared by the runtime and production-browser tests.
It covers joins, unmatched rows, aggregation, filtering, ordering, pagination,
subqueries, CTEs, compound queries, windows, NULLs, and vendor-specific syntax.
Uniqueness, explicit profiles, expected rows and the per-mode quota are enforced
by `scripts/releaseAcceptanceCases.ts`. Unordered results are compared as
multisets; ordered queries retain their expected sequence.

| Mode | Successful unique queries | Fixtures |
| --- | ---: | --- |
| MySQL | 15/15 | [MySQL/MariaDB](../scripts/dialectCases/releaseAcceptanceMysql.ts) |
| MariaDB | 15/15 | [MySQL/MariaDB](../scripts/dialectCases/releaseAcceptanceMysql.ts) |
| PostgreSQL | 15/15 | [PostgreSQL](../scripts/dialectCases/releaseAcceptancePostgres.ts) |
| SQL Server | 15/15 | [SQL Server/Oracle](../scripts/dialectCases/releaseAcceptanceVendors.ts) |
| Oracle | 15/15 | [SQL Server/Oracle](../scripts/dialectCases/releaseAcceptanceVendors.ts) |
| SQLite | 15/15 | [SQLite/Any SQL](../scripts/dialectCases/releaseAcceptanceSqlite.ts) |
| Any SQL | 15/15 | [SQLite/Any SQL](../scripts/dialectCases/releaseAcceptanceSqlite.ts) |

## Defects corrected

| Defect | Before | Correct behavior |
| --- | --- | --- |
| PostgreSQL computed day offsets | A date plus a column expression could return a number such as `2027`. | Preserve date arithmetic and expression precedence. |
| SQL Server `LEN` | Removed trailing tabs, newlines and nonbreaking spaces. | Remove trailing U+0020 spaces only. |
| SQL Server `CHARINDEX` | Lost NULL start semantics and returned incorrect empty-search results. | Honor optional, zero, negative, NULL and out-of-range start positions. |
| SQL Server Unicode positions | Case-fold expansion in `İx` moved the reported `x` position from 2 to 3. | Map folded matches back to original character positions. |
| Oracle `DECODE` | Two expressions that both evaluated to NULL did not match. | NULL matches NULL, preserving branch order and short-circuit behavior. |
| Next.js dependency audit | Version 16.3.8 failed the repository's zero-vulnerability policy. | Pin Next.js 16.4.6 in the manifest and lockfile; audit all dependency classes. |
| Homepage fault-injection test cleanup | A pending network handler could read a response after its test context closed. | Drain active route handlers before navigating from the homepage to the tracer. |
| Mode-switching browser test budget | One long scenario exhausted its total 30-second budget despite completing normal interactions. | Split persistence, ASCII case rules and Unicode restoration into independent scenarios, retaining all assertions and the 30-second limit. |

The date regressions include computed offsets, grouping, products, operand order,
and nested expressions. The original failing release queries remain in the
15-query sets; additional boundary cases cannot fill the success quota.

## Verification

| Check | Result |
| --- | --- |
| `npm run test:release` | 145 passed, zero failed: 105 required successes plus 40 syntax/boundary checks |
| `npm run check` | Passed, including TypeScript and the Next.js 16.4.6 production build |
| Existing dialect regressions | 711 passed |
| Compatibility fixtures | 548 passed |
| Dialect tour | 165 passed |
| PostgreSQL differential checks | 125 passed; two documented exclusions |
| Generated tracing corpus | 2,503 queries, no unexpected failures |
| Translator size/performance checks | 49 passed |
| Consecutive mutation/query sequence | 25/25 passed |
| Schema/transaction/persistence checks | 29 passed |
| Resource containment | 18 passed, plus worker recovery, prototype names and store-race checks |
| `npm run audit:release` | Zero reported vulnerabilities across all dependency classes |

The full production-browser run exposed two test-lifecycle problems, both
corrected without removing assertions or adding retries. The complete affected
specs were rerun against the production build in every browser profile:

- Homepage spec: **20 passed**, zero failed/skipped.
- Mode spec after splitting its long scenario: **32 passed**, zero failed/skipped.
- TypeScript was rerun after the test changes and passed.

The main run completed in **22.4 minutes with two workers**: 289 passed,
25 intentional skips and the two test issues above. All **28 mode/profile
acceptance tests passed**, proving **420/420 query executions** (105 queries
in each of Chromium, Firefox, desktop WebKit and mobile WebKit).

The final source contains 324 browser tests because the mode-test split adds
two scenarios per profile. Combining the unaffected main-run results with the
complete corrected-spec reruns covers **299 executed tests and 25 intentional
skips**, with no unresolved failures. This is combined verification, not a claim
that the original full command exited successfully or that a second full run
was performed. Existing skips are desktop-only controls or duplicate deterministic
checks covered in another profile.

Local logs are retained under `artifacts/release-2026-11-10/` (ignored by Git),
including `release-final-check.log`, `release-browsers.log`, `release-audit.log`,
`release-landing.log` and `mode.log`.

The supported project runtime is Node.js 24; final checks use Node 24.22.2.
The host's global Node.js is newer, so an isolated `node@24` executable is used
without changing the system installation.

PostgreSQL acceptance queries and date regressions are permanently included in
`npm run test:postgres`, which compares QueryTrace with native PostgreSQL through
PGlite. SQL Server acceptance queries and boundary probes were also checked
against installed SQL Server LocalDB in temporary session tables. That LocalDB
comparison is an independent local check, not a CI dependency. MySQL/MariaDB and
Oracle expectations are hand-calculated and checked against documented semantics;
no native MySQL, MariaDB or Oracle engine is claimed.

`tests/release-acceptance.spec.ts` selects each mode in the actual UI, verifies
syntax-error recovery, then enters all 15 queries through the editor and checks
the rendered results. The full browser suite also covers persistence, schema
changes, row tracing, worker recovery, security, layout and accessibility.

## Reproduce

```sh
npm run test:release
npm run check
npm run audit:release
npx playwright install
npm run test:browsers
```

Use `QUERYTRACE_TEST_PORT` to force a fresh production server when an existing
preview is running. The release validation leaves an existing preview alone.
CI retains one browser worker; its job allowance is increased to 60 minutes
for the expanded 324-test matrix, including 420 acceptance-query executions.
This gives the single-worker job room for the measured browser workload plus
dependency installation, runtime checks and build without removing tests.

## Remaining boundaries

This validates QueryTrace's supported SQLite-backed translation subset, not
complete compatibility with all vendor SQL. The existing [compatibility review](compatibility-review.md)
documents collation, accent, identifier-case, type and unsupported-feature limits.
MySQL `GROUP_CONCAT(DISTINCT ... SEPARATOR ...)` remains an explicit refusal.
PostgreSQL differential tests retain the two documented exclusions for
SQLite-only `GROUP_CONCAT` and `WHERE 0`; no acceptance query uses those exclusions.

The production build reports React 18 deprecation for a future Next.js 17 upgrade
and the existing Tailwind config module-type warning. Neither disables checking
or prevents the build. React migration is outside this SQL release pass.

This pass changes the local checkout only; it does not deploy or certify the
currently hosted site. Existing uncommitted work is preserved.

Next.js advisory and release references:
[image optimization](https://github.com/advisories/GHSA-2464-fhr4-w9xw),
[Server Actions](https://github.com/advisories/GHSA-p3m5-59mp-jv5r),
[cache serialization](https://github.com/advisories/GHSA-673q-mjm6-r5xr), and
[16.4.6 release](https://github.com/vercel/next.js/releases/tag/v16.4.6).
