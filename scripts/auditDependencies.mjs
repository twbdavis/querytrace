import { spawnSync } from 'node:child_process';
import { auditErrors } from './dependencyAuditPolicy.mjs';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this check using npm run audit:release.');
// Explicit includes prevent NODE_ENV or inherited npm omit settings from
// silently excluding development, optional, or peer dependencies.
const result = spawnSync(process.execPath, [
  npm, 'audit', '--json', '--include=dev', '--include=optional', '--include=peer', '--audit-level=info',
], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
if (result.error || (result.status !== 0 && result.status !== 1)) {
  throw new Error('npm audit failed: ' + (result.error ?? result.stderr));
}
const errors = auditErrors(JSON.parse(result.stdout));
if (errors.length) throw new Error(errors.join('\n'));
if (result.status !== 0) throw new Error('npm audit returned a failure status despite reporting no vulnerabilities.');
console.log('PASS all dependencies, including development tooling: zero reported vulnerabilities; no exceptions.');
