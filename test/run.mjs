import { runSelfTest } from '../src/selftest.mjs';

const { passed, total, results } = runSelfTest();
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : ` -> ${r.error}`}`);
}
console.log(`\n${passed}/${total} checks passed`);
process.exit(passed === total ? 0 : 1);
