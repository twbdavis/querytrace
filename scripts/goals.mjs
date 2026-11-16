#!/usr/bin/env node
/* Goal scoreboard for the browser SQL compatibility work: runs each criterion
   of docs/compatibility-review.md and prints one line per goal. Exit code is
   non-zero when any goal fails. `--release` adds the full release gate (G13),
   which includes the production build. */
import { spawnSync } from 'node:child_process';

const release = process.argv.includes('--release');

const GOALS = [
  { id: 'G1', title: 'Types compile', command: 'npm run typecheck' },
  { id: 'G2', title: 'Existing dialect suite', command: 'npm run test:dialects' },
  { id: 'G2', title: 'Existing trace suite', command: 'npm run test:trace' },
  { id: 'G2', title: 'Existing sequence suite', command: 'npm run test:sequence' },
  { id: 'G2', title: 'Existing schema suite', command: 'npm run test:schema' },
  { id: 'G2', title: 'Existing security suite', command: 'npm run test:security' },
  { id: 'G2', title: 'Existing fuzz suite', command: 'npm run test:fuzz' },
  { id: 'G3-G12', title: 'Compatibility fixtures, coverage, profiles, persistence, lessons, highlighting', command: 'npm run test:compat' },
  { id: 'G14', title: 'Dialect tour: idiomatic queries under every profile', command: 'npm run test:tour' },
  { id: 'G15', title: 'PostgreSQL mode returns what a real PostgreSQL returns', command: 'npm run test:postgres' },
  { id: 'G16', title: 'Long pastes translate quickly and completely', command: 'npm run test:speed' },
  ...(release ? [{ id: 'G13', title: 'Release gate (check incl. build)', command: 'npm run check' }] : []),
];

let failed = 0;
const rows = [];
for (const goal of GOALS) {
  const started = Date.now();
  const result = spawnSync(goal.command, { shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = result.status === 0;
  if (!ok) failed++;
  const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n      ');
  rows.push({ goal, ok, seconds, tail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${goal.id.padEnd(7)} ${goal.title} (${seconds}s)`);
  if (!ok) console.log(`      ${tail}`);
}

console.log(`\n${rows.length - failed} of ${rows.length} goal checks passed${release ? '' : ' (run with --release for G13)'}.`);
process.exit(failed ? 1 : 0);
