import assert from 'node:assert/strict';
import { auditErrors, BUILD_ADVISORY, EXCEPTION_EXPIRES } from './dependencyAuditPolicy.mjs';
const report = { auditReportVersion: 2, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } }, vulnerabilities: {
  braces: { severity: 'high', nodes: ['node_modules/braces'], via: [{ name: 'braces', url: BUILD_ADVISORY, severity: 'high', range: '<=3.0.3' }] },
} };
const lock = { packages: { 'node_modules/braces': { version: '3.0.3', dev: true } } };
const options = { now: new Date('2026-10-14T00:00:00Z') };
assert.deepEqual(auditErrors(report, lock, options), []);
assert.equal(auditErrors(report, lock, { ...options, productionOnly: true }).length, 1);
assert.equal(auditErrors(report, lock, { now: new Date(EXCEPTION_EXPIRES) }).length, 1);
for (const alter of [
  (r, l) => { l.packages['node_modules/braces'].dev = false; },
  (r, l) => { l.packages['node_modules/braces'].version = '3.0.4'; },
  (r) => { r.vulnerabilities.braces.nodes.push('node_modules/other/node_modules/braces'); },
  (r) => { r.vulnerabilities.braces.via.push({ name: 'braces', url: 'https://github.com/advisories/UNKNOWN' }); },
  (r) => { r.vulnerabilities.braces.via = ['braces']; },
  (r) => { r.vulnerabilities.braces.severity = 'critical'; },
]) {
  const changedReport = structuredClone(report), changedLock = structuredClone(lock);
  alter(changedReport, changedLock);
  assert.equal(auditErrors(changedReport, changedLock, options).length, 1);
}
assert.ok(auditErrors({}, lock, options).length);
assert.ok(auditErrors({ ...report, vulnerabilities: {} }, lock, options).length, 'inconsistent registry responses fail closed');
assert.deepEqual(auditErrors({ ...report, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } }, vulnerabilities: {} }, lock, { now: new Date('2099-01-01') }), []);
console.log('PASS dependency policy rejects production findings, new advisories, changed versions/paths, cycles, critical escalation, invalid reports and expired exceptions.');
