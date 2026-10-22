import assert from 'node:assert/strict';
import { auditErrors } from './dependencyAuditPolicy.mjs';

const clean = () => ({
  auditReportVersion: 2,
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  vulnerabilities: {},
});
const vulnerable = (severity = 'high') => {
  const report = clean();
  report.metadata.vulnerabilities[severity] = 1;
  report.metadata.vulnerabilities.total = 1;
  report.vulnerabilities.braces = {
    severity, nodes: ['node_modules/braces'],
    via: [{ name: 'braces', url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm', severity, range: '<=3.0.3' }],
  };
  return report;
};

assert.deepEqual(auditErrors(clean()), []);
for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
  assert.deepEqual(auditErrors(vulnerable(severity)), ['Dependency vulnerability: braces'],
    severity + ' findings must fail, including the formerly excepted advisory');
}
const transitive = vulnerable();
transitive.vulnerabilities.tailwindcss = { severity: 'high', via: ['braces'], nodes: ['node_modules/tailwindcss'] };
transitive.metadata.vulnerabilities.high = transitive.metadata.vulnerabilities.total = 2;
assert.equal(auditErrors(transitive).length, 2, 'Every entry in a development dependency chain must fail');

for (const invalid of [null, undefined, [], {}, { ...clean(), error: { code: 'EAUDIT' } }, { ...clean(), auditReportVersion: 1 }]) {
  assert.ok(auditErrors(invalid).length, 'Invalid registry responses must fail closed');
}
for (const alter of [
  (r) => { r.vulnerabilities = {}; },
  (r) => { r.vulnerabilities = []; },
  (r) => { r.vulnerabilities.braces = null; },
  (r) => { r.vulnerabilities.braces.severity = 'unknown'; },
  (r) => { r.metadata.vulnerabilities.total = 0; },
  (r) => { r.metadata.vulnerabilities.high = -1; },
  (r) => { r.metadata.vulnerabilities.low = 0.5; },
  (r) => { r.metadata.vulnerabilities = null; },
  (r) => { r.metadata.vulnerabilities.critical = 1; r.metadata.vulnerabilities.high = 0; },
]) {
  const report = vulnerable();
  alter(report);
  assert.ok(auditErrors(report).length, 'Malformed or inconsistent reports must fail closed');
}
console.log('PASS dependency policy rejects all production/development advisories at every severity and invalid registry reports; no exceptions.');
