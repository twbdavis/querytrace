# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately to **twbdavis@gmail.com** with the
affected URL or version and reproduction steps. Please do not open a public issue
for an unpatched vulnerability or send private datasets with your report.
Fixes target the latest main branch and the querytrace.net deployment.

## Data and execution

QueryTrace executes SQLite in a browser Web Worker. It has no application accounts
or server-side student database. Custom schemas and lesson progress are stored in
the browser's IndexedDB when storage is available; clearing site data removes them.
Anything imported into a browser remains subject to that browser's security and
local device access. Prefer fictional data for teaching and shared demonstrations.

Schema import supports the validated construction and editing subset described in
[Architecture](docs/architecture.md). The visual query editor supports SELECT,
INSERT, UPDATE, DELETE, CREATE TABLE and CREATE INDEX. Data changes run inside
the browser worker, and custom database changes are saved locally. Rejected
changes are rolled back. Dialect translation does not make arbitrary SQL scripts
universally supported.

## Delivery controls

Production configuration includes a same-origin content security policy, browser
isolation headers, HTTPS-related headers, and self-hosted application assets.
The exact configuration is in next.config.mjs. Deployment platforms must apply
these headers; a plain file-host export needs equivalent configuration.

The policy allows inline framework scripts/styles and WebAssembly compilation.
These are compatibility tradeoffs, not a guarantee against browser or supply-chain
vulnerabilities. CI audits npm dependencies and runs tracing and browser checks.
Dependency-update workflows and pinned Actions help keep the delivery chain current.

## Build tooling advisories

The build uses Tailwind CSS 4 and its PostCSS plugin. This removes the Tailwind 3
dependency chain containing the unpatched `braces` advisory
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), along with
the temporary exception and the old selector-parser override.

`npm run audit:release` requires zero reported vulnerabilities across production,
development, optional, and peer dependencies. It explicitly includes those groups
even when the environment sets npm omission options. Every severity fails CI;
there are no advisory exceptions. Invalid or inconsistent registry responses and
audit-command failures also fail the check.

## Out of scope

- Vulnerabilities requiring control of the visitor's machine or browser.
- Changes made only through a visitor's own developer tools or local storage.
- Availability incidents affecting the hosting provider.
