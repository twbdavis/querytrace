// Temporary, narrowly scoped build-tool exception. See SECURITY.md.
export const BUILD_ADVISORY = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
export const EXCEPTION_EXPIRES = '2026-11-14T00:00:00Z';
const reviewed = new Map([
  ['braces', '3.0.3'], ['chokidar', '3.6.0'], ['micromatch', '4.0.8'],
  ['fast-glob', '3.3.3'], ['tailwindcss', '3.4.19'],
]);

/** Fail closed on new advisories, production exposure, changed paths/versions or expiry. */
export function auditErrors(report, lock, { now = new Date(), productionOnly = false } = {}) {
  if (report.auditReportVersion !== 2 || !report.metadata?.vulnerabilities || !report.vulnerabilities || report.error) {
    return ['The registry did not return a valid npm audit report.'];
  }
  const vulnerabilities = report.vulnerabilities;
  const entries = Object.entries(vulnerabilities);
  const counts = report.metadata.vulnerabilities;
  const severities = ['info', 'low', 'moderate', 'high', 'critical'];
  if (![...severities, 'total'].every((level) => Number.isSafeInteger(counts[level]) && counts[level] >= 0)
    || counts.total !== entries.length || severities.reduce((sum, level) => sum + counts[level], 0) !== counts.total
    || severities.some((level) => entries.filter(([, finding]) => finding.severity === level).length !== counts[level])) {
    return ['The npm audit summary and vulnerability findings are inconsistent.'];
  }
  if (productionOnly) return entries.map(([name]) => `Production dependency vulnerability: ${name}`);
  const permitted = (name, visiting = new Set()) => {
    const finding = vulnerabilities[name];
    const version = reviewed.get(name);
    if (!finding || !version || visiting.has(name) || new Date(now) >= new Date(EXCEPTION_EXPIRES)) return false;
    if (finding.severity === 'critical' || finding.nodes?.length !== 1 || finding.nodes[0] !== `node_modules/${name}`) return false;
    const installed = lock.packages?.[finding.nodes[0]];
    if (installed?.dev !== true || installed.version !== version || !finding.via?.length) return false;
    const next = new Set(visiting).add(name);
    return finding.via.every((via) => typeof via === 'string'
      ? permitted(via, next)
      : name === 'braces' && via.url === BUILD_ADVISORY && via.name === 'braces'
        && via.severity === 'high' && via.range === '<=3.0.3');
  };
  return entries.filter(([name]) => !permitted(name)).map(([name]) => `Unreviewed or expired dependency vulnerability: ${name}`);
}
