# Development and deployment

Use Node.js 24 (see .nvmrc) and npm. From the repository root:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. To verify a change:

```sh
npm run check
npx playwright install
npm run test:browsers
```

The check command runs TypeScript checks, tracing tests, key-route tests, and a
production build. Playwright starts the production server on port 3100; stop any
unrelated server on that port first. CI also audits dependencies and tests browser
behavior in Chromium, Firefox, WebKit, and mobile WebKit.

## Hosting

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
