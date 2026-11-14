/* Minimal test harness for Node. */
const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}

function approx(a, b, tol) {
  return Math.abs(a - b) <= (tol || 1e-9);
}

function finish() {
  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      console.log('  PASS', r.name);
    } else {
      failed++;
      console.log('  FAIL', r.name, '-', r.err.message);
    }
  }
  console.log('\n' + (results.length - failed) + '/' + results.length + ' tests passed');
  if (failed > 0) process.exitCode = 1;
  return failed;
}

module.exports = { test, assert, approx, finish };
