import test from 'node:test';
import assert from 'node:assert/strict';
import { TowerGame, TOP_INPUTS, BOTTOM_INPUTS } from '../js/engine.js';

function makeRng(seed = 7) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function makeGame(config = {}) {
  return new TowerGame({ outageIntervalMs: 100000, ...config }, makeRng());
}

test('强风会持续吹偏未锁定的摇臂', () => {
  const game = makeGame();
  const start = game.armAngle;
  game.runFor(2000, 100);
  assert.notEqual(game.armAngle, start);
  game.pinEngaged = true;
  const locked = game.armAngle;
  game.runFor(2000, 100);
  assert.equal(game.armAngle, locked, '锁定销固定后摇臂不再被风吹动');
});

test('锁定销只有在对正窗口内才能插入', () => {
  const game = makeGame();
  game.armAngle = 45;
  game.handleInput({ top: 'pinIn' });
  assert.equal(game.pinEngaged, false);
  game.armAngle = 2;
  game.handleInput({ top: 'pinIn' });
  assert.equal(game.pinEngaged, true);
  game.handleInput({ top: 'left' });
  assert.equal(game.armAngle, 2, '锁定状态下旋转输入无效');
});

test('主电源周期性中断，备用电池可维持链路', () => {
  const game = makeGame({ outageIntervalMs: 3000, outageDurationMs: 1500 });
  assert.equal(game.mainOnline, true);
  game.runFor(3050, 50);
  assert.equal(game.mainOnline, false);
  assert.equal(game.linkOnline, false, '无人切电时链路随之中断');
  game.handleInput({ bottom: 'battery' });
  assert.equal(game.powered, true);
  game.runFor(100, 50);
  assert.equal(game.linkOnline, true);
  const before = game.battery;
  game.runFor(1000, 100);
  assert.ok(game.battery < before, '电池持续放电');
});

test('仪器更换需要锁定销就位且断电，完成后计数增加', () => {
  const game = makeGame({ replaceMs: 1000, outageIntervalMs: 1_000_000, graceMs: 5000 });
  game.armAngle = 0;
  game.handleInput({ top: 'pinIn' });
  game.handleInput({ bottom: 'battery' });
  // 电池仍在供电，更换不会推进
  game.runFor(600, 100);
  assert.equal(game.replaceProgress, 0);
  game.handleInput({ bottom: 'off' });
  game.runFor(1050, 50);
  assert.equal(game.replacement, 1);
  assert.equal(game.replaceProgress, 0);
});

test('两个玩家的输入集合互不重叠', () => {
  assert.deepEqual(TOP_INPUTS, ['left', 'right', 'pinIn', 'pinOut', 'alarm']);
  assert.deepEqual(BOTTOM_INPUTS, ['main', 'battery', 'off', 'alarm']);
  assert.equal(TOP_INPUTS.filter((x) => BOTTOM_INPUTS.includes(x)).length, 1, '只有共享报警键重叠');
});

test('塔顶与塔底看到的状态不同，共享报警一致', () => {
  const game = makeGame();
  game.handleInput({ top: 'alarm' });
  const top = game.topView();
  const bottom = game.bottomView();
  assert.ok('armAngle' in top);
  assert.ok(!('armAngle' in bottom), '塔底看不到摇臂角度');
  assert.ok(!('pinEngaged' in bottom), '塔底看不到锁定销');
  assert.ok('battery' in bottom);
  assert.ok(!('battery' in top), '塔顶看不到电池余量');
  assert.ok(!('mainOnline' in top), '塔顶看不到主电源在线状态');
  assert.equal(top.alarms.length, bottom.alarms.length);
  assert.equal(top.alarms[0].message, bottom.alarms[0].message);
});
