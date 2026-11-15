import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sabineRT60, inverseDistanceGain, stereoPan, equalPowerGains,
  buildPath, positionAt, isInsideRoom, v3, roomSurfaceArea,
  DEFAULT_ROOM, DEFAULT_LISTENER, makeImpulseResponse,
} from '../js/acoustics.js';

const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('Sabine RT60：体积不变时与吸声系数成反比', () => {
  const r1 = { ...DEFAULT_ROOM, absorption: 0.2 };
  const r2 = { ...DEFAULT_ROOM, absorption: 0.4 };
  const t1 = sabineRT60(r1);
  const t2 = sabineRT60(r2);
  approx(t1 / t2, 2, 1e-12);
  // 6×3×5=90m³，S=126m²，α=0.35 → 0.161*90/(126*0.35)
  approx(sabineRT60(DEFAULT_ROOM), 0.161 * 90 / (126 * 0.35), 1e-12);
  assert.ok(t2 > 0);
});

test('距离衰减：单调下降，refDistance 内为 1，远距离按反比', () => {
  assert.equal(inverseDistanceGain(0.5, { refDistance: 1 }), 1);
  assert.equal(inverseDistanceGain(1, { refDistance: 1 }), 1);
  const g2 = inverseDistanceGain(2, { refDistance: 1, rolloffFactor: 1 });
  approx(g2, 1 / 2);
  const g4 = inverseDistanceGain(4, { refDistance: 1, rolloffFactor: 1 });
  approx(g4, 1 / 4);
  const gains = [1, 2, 4, 8].map((d) => inverseDistanceGain(d));
  for (let i = 1; i < gains.length; i++) assert.ok(gains[i] < gains[i - 1]);
});

test('立体声 pan：右侧声源 pan>0、左侧 pan<0、前后为 0', () => {
  const L = DEFAULT_LISTENER;
  const right = stereoPan([3, 1.6, 0], L, L.forward);
  const left = stereoPan([-3, 1.6, 0], L, L.forward);
  const front = stereoPan([0, 1.6, -4], L, L.forward);
  const back = stereoPan([0, 1.6, 4], L, L.forward);
  assert.ok(right > 0.99 && left < -0.99);
  approx(front, 0, 1e-12);
  approx(back, 0, 1e-12);
  approx(right, -left, 1e-12);
  // 监听者转向 90°（朝向 +X）时，其右向量为 +Z，故世界 -Z 处声源在左侧。
  const turned = stereoPan([0, 1.5, -4], { position: [0, 1.5, 0] }, [1, 0, 0]);
  assert.ok(turned < -0.99);
});

test('等功率增益：能量守恒、pan=1 时全右声道', () => {
  const c = equalPowerGains(0);
  approx(c.left, c.right, 1e-12);
  approx(c.left ** 2 + c.right ** 2, 1, 1e-12);
  const r = equalPowerGains(1);
  approx(r.right, 1, 1e-12);
  approx(r.left, 0, 1e-12);
  const l = equalPowerGains(-1);
  approx(l.left, 1, 1e-12);
});

test('路径采样：端点正确、总长为各段之和、中点在线段上', () => {
  const path = buildPath([[0, 0, 0], [3, 0, 0], [3, 0, 4]]);
  approx(path.length, 7, 1e-9);
  assert.deepEqual(positionAt(path, 0), [0, 0, 0]);
  assert.deepEqual(positionAt(path, 1), [3, 0, 4]);
  const mid = positionAt(path, 0.5);
  approx(v3.dist(mid, [3, 0, 0.5]), 0, 1e-9);
});

test('房间边界判定', () => {
  assert.equal(isInsideRoom([0, 0, 0], DEFAULT_ROOM), true);
  assert.equal(isInsideRoom([3.01, 0, 0], DEFAULT_ROOM), false);
  assert.equal(isInsideRoom([3, 1.5, 2.5], DEFAULT_ROOM), true);
  assert.equal(isInsideRoom([0, 0, 2.6], DEFAULT_ROOM), false);
});

test('脉冲响应：长度随 RT60 增长且幅度整体衰减', () => {
  const ctx = {
    sampleRate: 1000,
    createBuffer(ch, length, rate) {
      const channels = Array.from({ length: ch }, () => new Float32Array(length));
      return {
        length, sampleRate: rate,
        getChannelData: (i) => channels[i],
      };
    },
  };
  const shortIR = makeImpulseResponse(ctx, 0.2);
  const longIR = makeImpulseResponse(ctx, 1);
  assert.ok(longIR.length > shortIR.length);
  const data = longIR.getChannelData(0);
  let early = 0, late = 0;
  for (let i = 0; i < 100; i++) early += Math.abs(data[i]);
  for (let i = data.length - 101; i < data.length - 1; i++) late += Math.abs(data[i]);
  assert.ok(early > late * 5);
  assert.equal(roomSurfaceArea(DEFAULT_ROOM), 126);
});
