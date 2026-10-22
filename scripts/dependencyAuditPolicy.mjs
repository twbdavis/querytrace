/** Reject every advisory, including development dependencies, and malformed reports. */
export function auditErrors(report) {
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(report) || report.auditReportVersion !== 2 || report.error
    || !isObject(report.metadata?.vulnerabilities) || !isObject(report.vulnerabilities)) {
    return ['The registry did not return a valid npm audit report.'];
  }
  const entries = Object.entries(report.vulnerabilities);
  const counts = report.metadata.vulnerabilities;
  const severities = ['info', 'low', 'moderate', 'high', 'critical'];
  if (!entries.every(([, finding]) => isObject(finding) && severities.includes(finding.severity))
    || ![...severities, 'total'].every((level) => Number.isSafeInteger(counts[level]) && counts[level] >= 0)
    || counts.total !== entries.length || severities.reduce((sum, level) => sum + counts[level], 0) !== counts.total
    || severities.some((level) => entries.filter(([, finding]) => finding.severity === level).length !== counts[level])) {
    return ['The npm audit summary and vulnerability findings are inconsistent.'];
  }
  return entries.map(([name]) => 'Dependency vulnerability: ' + name);
}
