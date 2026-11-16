# Development and deployment

Use Node.js 24 (see .nvmrc) and npm. From the repository root:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. To verify a change:

```sh
npm run check
npm run audit:release
npx playwright install
npm run test:browsers
```

For the final dialect acceptance gate, run `npm run test:release` (also included
in `npm run check`). It requires exactly 15 distinct successful queries with
explicit expected rows for every selectable mode: Any SQL, SQLite, MySQL,
MariaDB, PostgreSQL, SQL Server and Oracle. Malformed SQL, unsupported syntax,
and additional bug regressions are checked separately and cannot fill that quota.
`tests/release-acceptance.spec.ts` runs the same 105 queries through the mode
selector, editor and worker in each browser profile, after checking recovery
from a syntax error. See [the November 10 release validation](release-validation-2026-11-10.md)
for fixes, results and the remaining compatibility boundaries.
CI keeps one browser worker and allows 60 minutes for the expanded release job,
including dependency installation, the runtime checks, build and all four profiles.

The check command rejects unused TypeScript locals and parameters, and generates Next.js declarations before TypeScript checks, so it also works
on a clean checkout without `next-env.d.ts` or `.next`. It then runs tracing tests, key-route and schema-layout tests, the
trace-engine fuzz battery, dialect regressions, the consecutive-query acceptance
test, schema/transaction and resource-containment regressions, and a production build. Run `npm run test:sequence` for eight rejection and
rollback checks followed by twenty-five consecutive MySQL, MariaDB, and PostgreSQL
queries on one connection. It checks hand-computed results and row provenance,
read-after-write behavior, and the stability of earlier traces. The sequence also
creates a PostgreSQL identity table and a MySQL unique index, populates the new
table with an aggregate INSERT SELECT, and verifies a multirow PostgreSQL upsert
with RETURNING. A separate restoration check proves the saved schema, foreign
key, unique index, and data survive persistence. The same sequence runs through
the browser worker in `tests/query-sequence.spec.ts`, followed by a browser reload
and readback of the created table. `tests/dialect-mode.spec.ts` covers the query mode
end to end: the top-bar button changes how the worker reads the same text, the choice
survives a reload, the lessons toggle sets the same field, and the menu fits a phone
screen and works from the keyboard.
Run `npm run test:compat` for the compatibility fixtures of
[compatibility-review.md](compatibility-review.md): aggregate `FILTER`, named windows,
`ROWS` frames, `TOP n WITH TIES` boundary ties, Oracle `ROWNUM` narrowing, dialect
profiles that change interpretation, coverage labels, parser-encoding round trips,
scope-aware clause highlighting, saved-state migration and every lesson under every
profile. `npm run test:tour` is the dialect tour (`scripts/dialectCases/tour.ts`): ten to
thirty idiomatic queries per profile (MySQL, MariaDB, PostgreSQL, SQL Server, Oracle,
SQLite) over the preloaded datasets, each checked against hand-computed rows and, where
one exists, a plain SQLite spelling that must return the same rows, ending with the
refusals that profile must give. `npm run test:postgres` runs every PostgreSQL-mode query
of the tour, every lesson in its PostgreSQL spelling and the FILTER / frame / named-window
/ text fixtures on a real PostgreSQL as well (PGlite, PostgreSQL compiled to WebAssembly, a
dev dependency) and requires the same rows from both; a query PostgreSQL refuses fails the
run unless `NOT_COMPARABLE` lists it with a reason. `npm run test:speed` repeats each
construct the translator rewrites up to the 20,000 character limit and requires a quick,
complete translation. `npm run goals` runs each goal criterion of that review
and prints a scoreboard (`--release` adds the full check with the production build).
Run `npm run test:schema` for CREATE rollback and capacity checks, generated columns,
composite foreign-key metadata, deferred-constraint failures, accurate UPDATE traces,
and persistence of new structures and constraints.
Run `npm run test:layout` for varied table sizes, collision-free placement, stable
positions, and growth/CREATE cases. `tests/schema-layout.spec.ts` checks actual
browser rectangles and foreign-key paths after imports, same-name schema rebuilds,
data changes, and CREATE statements.
Run `npm run test:security` for bounded SQL results and allocations, mutation
rollback after resource failures, regular-expression limits, worker deadlines and
checkpoint recovery, and the dependency audit policy. Browser recovery tests
exercise the actual worker lifecycle and deadline.
`npm run audit:release` requires zero reported vulnerabilities across all dependencies,
including development, optional, and peer dependencies. There are no exceptions;
all severities and invalid registry responses fail the check. See [Security](../SECURITY.md).
The fuzz battery
(`npm run test:fuzz`) runs about 2,500 generated and hand-written queries against
the bundled schemas and four vendor-style custom schemas (MySQL Workbench, pg_dump,
SQL Server Management Studio, and an edge-case SQLite script), compares every
result with SQLite's own answer, and checks the provenance invariants the UI relies
on. Pass `--verbose` to list every query or `--json <path>` to save a report; add
queries in `scripts/fuzzQueries.ts` and schemas in `scripts/fuzzSchemas.ts`. Playwright starts the production server on port 3100; stop any
unrelated server on that port first. CI also audits dependencies and tests browser
behavior in Chromium, Firefox, WebKit, and mobile WebKit. Set `QUERYTRACE_TEST_PORT`
to another port to start a fresh test server alongside an existing preview; an
explicit port disables server reuse.

## Hosting

The supported browser minimums are Chrome/Edge 111, Firefox 128, and Safari 16.4.
The Tailwind 4 build uses modern CSS features and does not target older Firefox versions.

The documented deployment is Next.js on Vercel. Import this repository and use
the standard Next.js build settings. For a local production server, run
`npm run build` followed by `npm start`.

Student SQL executes entirely in a browser worker. No server database is required.
This repository does not configure a generic static export: deploying to a plain
file host would require an export configuration and equivalent security headers.
The postinstall script copies the SQLite WASM asset into public with a content hash.

## Troubleshooting

- Missing WASM: rerun `npm ci`; do not copy an arbitrary runtime from a CDN.
- Local persistence unavailable: the app continues in memory; browser storage
  restrictions or clearing site data can remove saved progress and schemas.
- SQL import errors: read the named statement and the supported syntax in
  [Architecture](architecture.md). Dialect conversion is a supported subset.

## Performance

After starting the production server on port 3100, run
`node scripts/profileBrowser.mjs`. Measurements depend on the machine; browser
tests verify bounded rendering, row provenance, and motion behavior.

## Release audit: October 14, 2026

This section records the October 14 results. The subsequent October 21 remediation
migrated to Tailwind 4, removed the vulnerable development dependency chain and its
exception, and made CI require a clean audit of all dependencies.

The local release audit covered dependency advisories, SQL execution and import
boundaries, worker failure recovery, mutation atomicity, persistence races,
identifier handling, HTML rendering, public assets and secrets, production
headers, canvas rendering and relationship-routing performance.

Confirmed issues corrected during the audit:

- Vulnerable production/build dependencies were updated: Next.js 16.3.8,
  sharp 0.35.5, source-map-js 1.2.2 and postcss-selector-parser 7.1.6.
  The Tailwind selector-parser override preserved the representative generated
  CSS byte for byte. A development-only advisory was temporarily excepted at that
  time; the October 21 Tailwind 4 migration removed the affected dependency chain.
- Worker requests now have deadlines and retain the last acknowledged database.
  Crashes, snapshot failures and response-delivery failures discard unconfirmed
  changes and recover on the next request, including bundled-schema edits.
- Incremental result reading, shared value budgets, bounded compatibility
  functions and SQLite allocation limits prevent oversized intermediate results
  from being retained. Resource failures during DML/CREATE roll back the change.
- JavaScript prototype property names remain valid SQL names. Quoted table names
  no longer enter CSS selectors during key-handle measurement.
- Editing SQL while a mutation runs cancels its obsolete trace while retaining
  acknowledged data changes in both the canvas and saved custom database.
- Canvas row rendering uses a shared cell budget, keeps off-screen row data
  available for inspection, and preserves card geometry. Cell previews are bounded.
  Virtualized table and result widths use font measurements so Unicode text
  cannot resize hidden columns or spill across neighboring result cells.
  Relationship routing waits for measured layout, coalesces updates, and indexes
  reserved segments by coordinate so dense graphs avoid repeated scans of
  unrelated wires and expensive routing against provisional positions.

The audit found no credential/private-key exposure in reviewed source or public
assets, no executable dynamic HTML sink, and no application SQL/data backend.
SQL parsing and execution remain in the worker; the WASM asset's content hash and
immutable cache rule were verified alongside production asset delivery.
These findings apply to this checkout and the local production server. The
deployed site, hosting account, DNS and TLS configuration were not changed or
independently audited. CSP inline-script compatibility and unencrypted local
browser storage remain the documented product/deployment boundaries.

The initial dependency audit reported ten affected package entries (eight high,
two moderate). At the end of that audit, five high entries belonged to the unpatched
development-only `braces` advisory chain. The later Tailwind 4 migration removed them.

The final `npm run check` passed TypeScript, tracing, routing (including 437
React Flow hook wrappers sharing one routing snapshot), 250 varied layout cases,
2,503 fuzz cases with no unexpected failures, 711 dialect cases, the 25-query
sequence, 29 schema/transaction checks, resource and worker-recovery regressions,
and the production build. `npm run audit:release` passed with zero reported
production vulnerabilities and the documented build-only exception.

The final production-browser run completed with **139 passed, 13 intentional
skips, and zero failures** across Chromium, Firefox, WebKit and mobile WebKit.
The skips are twelve duplicate deterministic-input checks already covered in
Chromium and one desktop-only control check on mobile. The 25-query sequence,
Unicode width and overflow checks, 437-key routing, persistence, security headers
and worker recovery passed in every profile. The final run used two workers and
took 6.3 minutes; CI retains one worker and a 25-minute overall job allowance.

Local Chromium measurements used the same production-server fixtures and a
1.5-second settling interval before and after the changes. The table reports
main-thread task time, not elapsed load time or a guarantee for other devices.
Final samples required settled layout and the expected relationship wires.

| Import fixture | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| 500 rows, 40 columns | 3,380 ms | 526 ms | 84% |
| 24 tables, 125 rows and 20 columns each | 11,364 ms | 1,720 ms | 85% |
| 24 tables, 437 foreign keys | 9,976 ms | 984 ms | 90% |

The respective DOM element counts changed from 20,800 / 64,827 / 6,701 to
3,624 / 10,444 / 6,702. The dense-key fixture's longest main-thread task dropped
from 9,089 ms to 231 ms; browser geometry checks found no table-interior crossings
or misaligned endpoints. A separate 10,000-row result mounted 25 rows, switched
to its final view in 87 ms, and used 139 ms of rendering task time. These are
single-machine observations, with correctness and bounded rendering enforced
separately by regression tests.
