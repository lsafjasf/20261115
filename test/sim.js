const C = require('../js/core.js');

function run(dt = 1 / 60, maxSeconds = 120, verbose = true) {
  const g = C.createGame();
  let frames = 0;
  while (g.status === 'running' && g.t < maxSeconds) {
    const input = C.autopilot(g);
    C.step(g, input, dt);
    frames++;
  }
  const goods = g.dishes.filter((d) => d.good).length;
  if (verbose) {
    console.log('--- 连续投递仿真 (dt=' + dt + ') ---');
    for (const r of g.deliveries) {
      console.log(
        r.deck + '  t=' + r.t.toFixed(2) + 's  温度=' + r.temp.toFixed(1) +
        '℃  洒出=' + (r.spill * 100).toFixed(1) + '%  ' + (r.good ? '合格' : '不合格')
      );
    }
    console.log('最终状态:', g.status, '| 合格菜品:', goods, '/ 3', '| 用时:', g.t.toFixed(2), 's');
    console.log('未投递菜盘温度:', g.dishes.filter((d) => !d.done).map((d) => d.temp.toFixed(1)));
  }
  return { g, goods, won: g.status === 'won' };
}

if (require.main === module) {
  const r1 = run(1 / 60);
  const r2 = run(1 / 30);
  const r3 = run(1 / 120);
  const allWon = r1.won && r2.won && r3.won;
  console.log('\n三种步长均获胜:', allWon ? 'PASS' : 'FAIL');
  process.exit(allWon ? 0 : 1);
}

module.exports = { run };
