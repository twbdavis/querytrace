import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { auditErrors, BUILD_ADVISORY, EXCEPTION_EXPIRES } from './dependencyAuditPolicy.mjs';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this check using npm run audit:release.');
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
for (const productionOnly of [true, false]) {
  const result = spawnSync(process.execPath, [npm, 'audit', '--json', ...(productionOnly ? ['--omit=dev'] : [])], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error || (result.status !== 0 && result.status !== 1)) throw new Error(`npm audit failed: ${result.error ?? result.stderr}`);
  const report = JSON.parse(result.stdout);
  const errors = auditErrors(report, lock, { productionOnly });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(productionOnly ? 'PASS production dependencies: zero reported vulnerabilities.' : 'PASS complete dependency policy.');
  if (!productionOnly && Object.keys(report.vulnerabilities).length) {
    console.warn(`REVIEWED BUILD-ONLY RISK: ${BUILD_ADVISORY}; exception expires ${EXCEPTION_EXPIRES}. See SECURITY.md. This is not a clean full dependency audit.`);
  }
}
