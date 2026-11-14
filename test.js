// 总测试入口：依次运行引擎成功局、道岔冲突、渲染器、浏览器冒烟测试。
const { execFileSync } = require('child_process');
const path = require('path');

const cases = [
  ['成功局（固定 seed 六次换线无碰撞）', null, () => {
    const S = require('./sim.js');
    const Q = require('./solver.js');
    const r = Q.runFullGame(239, Q.solveSettings(239), 180);
    const ok = r.status === 'success' && r.completed === 6 &&
      r.stats.collisions === 0 && r.stats.conflicts === 0 && r.stats.overshoots === 0;
    console.log((ok ? 'PASS' : 'FAIL') + ' | 成功局 status=' + r.status +
      ' completed=' + r.completed + ' stats=' + JSON.stringify(r.stats) +
      ' duration=' + r.duration + 's');
    return ok;
  }],
  ['错过制动点滑过目标', null, () => {
    const S = require('./sim.js');
    const missions = S.generateMissions(239);
    const settings = {};
    missions.forEach((m) => {
      settings[m.id + ':' + m.index] = { accel: 60, brakePoint: 280, switchLead: 0.4 };
    });
    const w = new S.World({ seed: 239, settings });
    let n = 0;
    while (w.status === 'running' && n < 60 / w.dt) { w.step(); n++; }
    const ok = w.status === 'failed' && w.stats.overshoots === 1 &&
      w.failReason && w.failReason.indexOf('滑过目标') >= 0;
    console.log((ok ? 'PASS' : 'FAIL') + ' | 滑过目标 reason=' + w.failReason);
    return ok;
  }],
  ['道岔冲突急停', 'conflict-test.js'],
  ['渲染器', 'renderer-test.js'],
  ['浏览器层冒烟', 'browser-smoke-test.js']
];

let passed = 0;
for (const [name, file, fn] of cases) {
  let ok = false;
  try {
    if (file) {
      execFileSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
      ok = true;
    } else {
      ok = fn();
    }
  } catch (e) {
    ok = false;
    console.log('FAIL | ' + name + ' 抛错: ' + e.message);
  }
  if (ok) passed++;
  console.log('--- ' + name + (ok ? ' ✓' : ' ✗') + ' ---\n');
}

console.log('总计 ' + passed + '/' + cases.length + ' 组通过');
process.exit(passed === cases.length ? 0 : 1);
