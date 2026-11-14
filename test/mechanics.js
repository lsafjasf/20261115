const assert = require('assert');
const C = require('../js/core.js');

/* 1. 急停（高速时）会洒汤，温和制动不洒 */
{
  const g = C.createGame();
  g.v = 140;
  C.step(g, { throttle: 0, estop: true }, 1 / 60);
  assert(g.dishes.every((d) => d.spill > 0), '急停应使汤汁洒出');
  const g2 = C.createGame();
  for (let i = 0; i < 120; i++) C.step(g2, { throttle: -1, estop: false }, 1 / 60);
  assert(g2.dishes.every((d) => d.spill === 0), '温和制动不应洒汤');
}

/* 2. 持续大摆角会持续洒汤直到空盘 */
{
  const g = C.createGame();
  g.theta = 0.9;
  for (let i = 0; i < 400; i++) {
    g.theta = 0.9;
    C.step(g, { throttle: 0 }, 1 / 60);
  }
  assert(g.dishes.every((d) => d.spill >= 0.98), '持续倾斜应洒光汤汁');
  assert(!C.isEdible(g.dishes[0]), '洒光的菜不可食用');
}

/* 3. 温度随时间下降，且风越大冷却越快 */
{
  const g = C.createGame();
  for (let i = 0; i < 60 * 90; i++) C.step(g, { throttle: 0 }, 1 / 60);
  assert(g.dishes[0].temp < C.TEMP_MIN, '90 秒后应已低于阈值');
  assert(C.coolingRate(200) > C.coolingRate(20), '大风冷却系数更高');
  assert(C.coolingRate(0) > 0, '无风仍有自然冷却');
}

/* 4. 未在投递区内不能投递；停稳后在区内可投递 */
{
  const g = C.createGame();
  assert(!C.tryDeliver(g), '起点不在投递区');
  g.s = C.DECKS[0].s;
  g.v = 80;
  assert(!C.tryDeliver(g), '未停稳不能投递');
  g.v = 0; g.theta = 0; g.omega = 0;
  assert(C.tryDeliver(g), '停稳且在区内应可投递');
  assert(g.dishes[0].done && g.nextDeck === 1);
}

/* 5. 仅两盘合格也获胜；仅一盘合格则失败 */
{
  const g = C.createGame();
  g.s = C.DECKS[0].s; g.v = 0;
  for (let i = 0; i < 3; i++) {
    g.s = C.DECKS[i].s;
    C.tryDeliver(g);
  }
  g.dishes[0].good = false; g.dishes[0].temp = 40;
  const goods = g.dishes.filter((d) => d.good).length;
  assert.strictEqual(g.status, goods >= 2 ? 'won' : 'lost');
  assert.strictEqual(g.status, 'won', '两盘合格即胜利');
}

console.log('mechanics: all 5 test groups PASS');
