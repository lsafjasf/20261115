import test from 'node:test';
import assert from 'node:assert/strict';
import { TowerGame } from '../js/engine.js';

// 模拟 UI 主循环：30× 加速、每帧 16.7ms，完整打完一局
test('端到端：30× 加速下约 20 秒真实时间完成胜利流程', () => {
  const game = new TowerGame({
    windStepDeg: 0,
    outageIntervalMs: 45000,
    graceMs: 8000,
    replaceMs: 6000
  }, (() => {
    let seed = 23;
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  })());

  const frameMs = 1000 / 60;
  const speed = 30;
  let frames = 0;

  function doReplacement() {
    game.armAngle = 0;
    game.handleInput({ top: 'pinIn', bottom: 'off' });
    const target = game.replacement + 1;
    while (game.replacement < target && game.status === 'running') {
      game.update(frameMs * speed);
      frames += 1;
    }
    game.handleInput({ top: 'pinOut', bottom: 'main' });
  }

  for (let group = 0; group < 3; group += 1) doReplacement();
  assert.equal(game.replacement, 3);

  while (game.status === 'running' && frames < 10000) {
    game.update(frameMs * speed);
    frames += 1;
  }
  assert.equal(game.status, 'won');
  const realSeconds = (frames * frameMs) / 1000;
  assert.ok(realSeconds < 25, `应在 25 秒真实时间内完成，实际 ${realSeconds.toFixed(1)}s`);
});

test('端到端：正常速度下五分钟链路目标与三组更换的数值一致', () => {
  const game = new TowerGame({}, () => 0.5);
  assert.equal(game.cfg.linkHoldMs, 5 * 60 * 1000);
  assert.equal(game.cfg.requiredReplacements, 3);
  assert.equal(game.cfg.graceMs, 12000);
  assert.equal(game.cfg.outageIntervalMs, 45000);
});
