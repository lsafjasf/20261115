import test from 'node:test';
import assert from 'node:assert/strict';
import { TowerGame } from '../js/engine.js';

function makeRng(seed = 11) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
 return value / 4294967296;
  };
}

function makeGame(config = {}) {
  return new TowerGame(
    {
      linkHoldMs: 10000,
      graceMs: 5000,
      replaceMs: 800,
      windStepDeg: 0,
      outageIntervalMs: 100000,
      ...config
    },
    makeRng()
  );
}

// 模拟一次完整的“更换一组仪器”协作流程
function performOneReplacement(game) {
  game.armAngle = 0;
  game.handleInput({ top: 'pinIn' });
  assert.equal(game.pinEngaged, true);
  game.handleInput({ bottom: 'off' }); // 塔底按协作报警断开传感器供电
  game.runFor(game.cfg.replaceMs + 50, 50);
  game.handleInput({ top: 'pinOut' });
  if (game.mainOnline) game.handleInput({ bottom: 'main' });
  else game.handleInput({ bottom: 'battery' });
  assert.equal(game.powered, true);
}

test('场景一：双人同时输入在同一原子步骤内生效', () => {
  const game = makeGame();
  game.armAngle = 0;
  const before = game.state();
  // 同一帧：塔顶插销 + 塔底切电池，两个动作必须同时成立
  game.handleInput({ top: 'pinIn', bottom: 'battery' });
  const after = game.state();
  assert.equal(after.pinEngaged, true);
  assert.equal(after.powerSource, 'battery');
  assert.equal(after.powered, true);
  assert.notDeepEqual(before.alarms, after.alarms);

  // 连续同时操作：塔顶旋转 + 塔底切回主电源
  game.handleInput({ top: 'pinOut', bottom: 'main' });
  const angleBefore = game.armAngle;
  game.handleInput({ top: 'right', bottom: 'alarm' });
  assert.equal(game.armAngle, angleBefore + game.cfg.rotationStepDeg);
  assert.equal(game.powerSource, 'main');
  assert.ok(game.alarms.some((a) => a.kind === '塔底'));
});

test('场景二：单人调试——仅用一方输入即可走通完整流程', () => {
  const game = makeGame();
  // 只使用顶部输入完成对正与锁定（底部动作改为直接状态操作，模拟调试辅助）
  game.armAngle = 25;
  for (let i = 0; i < 10 && !game.aligned; i += 1) {
    game.handleInput({ top: 'left' });
  }
  assert.ok(game.aligned);
  game.handleInput({ top: 'pinIn' });
  assert.equal(game.pinEngaged, true);

  // 单人调试：直接切换供电（调试面板暴露的辅助操作），完成三组更换
  game.handleInput({ bottom: 'off' });
  game.runFor(game.cfg.replaceMs + 50, 50);
  assert.equal(game.replacement, 1);
  game.handleInput({ bottom: 'main' });
  game.handleInput({ top: 'pinOut' });
  for (let group = 1; group < 3; group += 1) {
    game.armAngle = 0;
    game.handleInput({ top: 'pinIn' });
    game.handleInput({ bottom: 'off' });
    game.runFor(game.cfg.replaceMs + 50, 50);
    game.handleInput({ bottom: 'main' });
    game.handleInput({ top: 'pinOut' });
  }
  assert.equal(game.replacement, 3);

  // 单人保持链路直到累计在线时长达标
  game.runFor(game.cfg.linkHoldMs + 100, 100);
  assert.equal(game.status, 'won');
});

test('场景三：链路中断超过宽限期即失败（含调试强制中断）', () => {
  const game = makeGame({ graceMs: 2000 });
  game.debugBreakLink();
  assert.equal(game.linkOnline, false);
  assert.equal(game.status, 'running', '宽限期内仍有抢救机会');
  game.runFor(1500, 100);
  assert.equal(game.status, 'running');
  // 宽限期结束仍未恢复供电
  game.runFor(800, 100);
  assert.equal(game.status, 'lost');
  assert.equal(game.lostReason, 'link');

  // 自然中断路径：停电后无人切换电池同样失败
  const game2 = makeGame({
    graceMs: 1000,
    outageIntervalMs: 1000,
    outageDurationMs: 5000
  });
  game2.runFor(1100, 100);
  assert.equal(game2.linkOnline, false);
  game2.runFor(1100, 100);
  assert.equal(game2.status, 'lost');
  assert.equal(game2.lostReason, 'link');
});

test('在宽限期内切换电池可抢救链路，最终完成任务', () => {
  const game = makeGame({
    graceMs: 5000,
    outageIntervalMs: 26000,
    outageDurationMs: 4000
  });
  game.nextOutageAt = 1500; // 第一次停电发生在早期链路累计阶段
  game.runFor(1600, 100);
  assert.equal(game.linkOnline, false);
  game.runFor(900, 100);
  game.handleInput({ bottom: 'battery' });
  game.runFor(200, 100);
  assert.equal(game.linkOnline, true);
  assert.equal(game.status, 'running');

  for (let group = 0; group < 3; group += 1) performOneReplacement(game);
  assert.equal(game.replacement, 3);
  game.handleInput({ bottom: 'main' }); // 主电恢复后切回，避免电池耗尽
  // 链路累计阶段仍会遇到周期停电，塔底持续值守并切电池抢救
  let remaining = game.cfg.linkHoldMs + 200;
  while (remaining > 0 && game.status === 'running') {
    const step = Math.min(100, remaining);
    const wasMainOnline = game.mainOnline;
    game.update(step);
    remaining -= step;
    if (wasMainOnline && !game.mainOnline && game.battery > 0) {
      game.handleInput({ bottom: 'battery' });
    }
    if (game.mainOnline && game.powerSource === 'battery' && game.linkOnline) {
      game.handleInput({ bottom: 'main' });
    }
  }
  assert.equal(game.status, 'won');
});
