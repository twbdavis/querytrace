# Security Policy

QueryTrace is a fully client-side teaching tool: SQLite (sql.js/WASM) runs in a
Web Worker in the visitor's browser, there is no server-side database, no user
accounts, and no collection of personal data. Lesson progress and custom
schemas live only in the visitor's own IndexedDB. This architecture removes
whole vulnerability classes (server-side injection, credential theft, session
hijacking) by design; the controls below defend what remains: the delivery
chain, the browser execution context, and the build pipeline.

## Reporting a vulnerability

Report suspected vulnerabilities to **twbdavis@gmail.com** (also published
at [`/.well-known/security.txt`](https://www.querytrace.net/.well-known/security.txt),
per RFC 9116). Please include reproduction steps and the affected URL. You can
expect an acknowledgement within 5 business days. Please do not open a public
GitHub issue for an unpatched vulnerability.

Only the deployment at `querytrace.net` built from `main` is supported.

## Security architecture

| Layer | Control |
|---|---|
| Transport | TLS via Vercel (HTTP is 308-redirected); HSTS (2 years, `includeSubDomains; preload`). CSP `upgrade-insecure-requests` was evaluated and dropped: WebKit upgrades same-origin subresources even on `127.0.0.1`, breaking local production testing, and HSTS + all-HTTPS hosting already covers it |
| Content injection | Strict CSP: same-origin `default-src`, no `object-src`/`frame-src`, `wasm-unsafe-eval` instead of `unsafe-eval`; no `dangerouslySetInnerHTML`/`innerHTML` sinks in the codebase |
| Isolation | COOP + COEP + CORP (`crossOriginIsolated` execution); `frame-ancestors 'none'` + `X-Frame-Options: DENY` (no clickjacking); SQL executes in a dedicated Web Worker off the UI thread |
| Browser features | Permissions-Policy denies sensors, media capture, geolocation, payment, USB/serial/HID/Bluetooth, and WebAuthn use by embedded content |
| Metadata leakage | `Referrer-Policy: strict-origin-when-cross-origin`; `X-Content-Type-Options: nosniff`; `poweredByHeader` disabled |
| Supply chain | All assets self-hosted (fonts, CodeMirror, SQLite WASM) — zero third-party runtime requests; `npm ci` from a committed lockfile; GitHub Actions pinned to commit SHAs; Dependabot for npm and Actions; `npm audit` gate in CI |
| SQL surface | User SQL runs only against the in-browser throwaway SQLite instance; schema builder accepts only `CREATE TABLE` / `INSERT ... VALUES`; nothing a visitor types ever reaches a server |

## Framework alignment

Control mapping for this project (scoped to a public, unauthenticated,
client-side static site):

| Control | NIST CSF 2.0 | ISO/IEC 27001:2022 Annex A |
|---|---|---|
| TLS + HSTS + upgrade-insecure-requests | PR.DS-02 (data in transit) | A.8.24 (cryptography), A.8.26 (application security requirements) |
| CSP, COOP/COEP/CORP, Permissions-Policy | PR.PS-05 (protective technology), PR.IR-01 | A.8.26, A.8.9 (configuration management) |
| Dependency audit + Dependabot + lockfile | ID.RA-01 (vulnerability identification), GV.SC (supply chain) | A.8.8 (technical vulnerability management), A.8.28 (secure coding), A.5.21 (ICT supply chain) |
| Pinned CI actions, least-privilege workflow token | PR.PS-06 (secure SDLC), GV.SC-07 | A.8.28, A.8.30 (outsourced development), A.8.32 (change management) |
| CI: typecheck, trace tests, 3-engine browser suite on every push/PR | PR.PS-06, DE.CM | A.8.29 (security testing in development), A.8.31 (environment separation) |
| security.txt + this policy | GV.PO, RS.CO-02 (coordinated disclosure) | A.5.25/A.5.26 (incident assessment & response), A.8.8 |
| No PII collected or stored server-side | GV.PO, PR.DS | A.5.34 (privacy/PII), A.8.10 (information deletion — n/a by design) |

## Accepted residual risks

These are known, documented, and accepted with rationale (ISO 27001 risk
treatment: *accept*):

1. **CSP `script-src 'unsafe-inline'`** — Next.js emits inline bootstrap
   scripts for prerendered pages; nonce-based CSP would force dynamic
   rendering and defeat static/CDN delivery. Compensating controls: no
   HTML-injection sinks exist in the code, `connect-src 'self'` prevents
   exfiltration, and there is no sensitive data in the origin to steal.
   Revisit if Next.js ships stable hash-based CSP for static output.
2. **CSP `style-src 'unsafe-inline'`** — required by React inline styles and
   the visualization libraries. Style injection without script execution has
   negligible impact on a site with no secrets or sessions.
3. **`Access-Control-Allow-Origin: *` added by Vercel to static responses** —
   all content is public and requests are never credentialed, so cross-origin
   readability discloses nothing. CORP `same-origin` still blocks embedding.

## Out of scope

- Denial of service against Vercel's CDN
- Vulnerabilities requiring a compromised browser or machine
- Content spoofed via a visitor's own devtools/local storage (affects only
  that visitor's sandboxed session)

## AI disclosure

This security policy was generated with AI assistance from OpenAI Codex (GPT-5).
