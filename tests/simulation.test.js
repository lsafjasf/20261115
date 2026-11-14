import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../js/world.js';
import { createRover, step, runEpisode, measureBraking } from '../js/simulation.js';
import { autopilot } from '../js/autopilot.js';
import { SEED, DAMAGE_ABORT, TOTAL_JARS, LANDER_RADIUS, SLIP_SIDE_SPEED } from '../js/config.js';

test('固定 seed 生成确定性世界：样本/陨坑/地形可复现', () => {
  const a = createWorld(SEED);
  const b = createWorld(SEED);
  assert.equal(a.samples.length, TOTAL_JARS);
  assert.deepEqual(a.samples.map((s) => [s.x, s.y]), b.samples.map((s) => [s.x, s.y]));
  assert.equal(a.heightAt(40, 30), b.heightAt(40, 30));
  // 样本点都在平缓安全区，保证路线可达
  for (const s of a.samples) {
    assert.ok(a.slopeAt(s.x, s.y).mag < 0.2);
    for (const c of a.craters) {
      assert.ok(Math.hypot(s.x - c.x, s.y - c.y) > c.rim + c.band + 2);
    }
  }
});

test('完整任务：自动驾驶收集三罐并返回着陆器，且零滑坡零中止', () => {
  const world = createWorld(SEED);
  const { rover, log } = runEpisode(world, autopilot, 60 * 160);
  assert.equal(rover.status, 'returned');
  assert.equal(rover.jars, TOTAL_JARS);
  assert.ok(world.samples.every((s) => s.collected));
  assert.equal(log.filter((e) => e.type === 'landslide').length, 0);
  assert.equal(log.filter((e) => e.type === 'abort').length, 0);
  assert.ok(rover.damage < DAMAGE_ABORT);
  assert.ok(Math.hypot(rover.x - world.lander.x, rover.y - world.lander.y) <= LANDER_RADIUS + 0.01);
  // 拾取顺序严格为 1 -> 2 -> 3
  const pickups = log.filter((e) => e.type === 'pickup').map((e) => e.jar);
  assert.deepEqual(pickups, [1, 2, 3]);
});

test('制动距离随载荷单调增加', () => {
  const world = createWorld(SEED);
  const distances = [0, 1, 2, 3].map((jars) =>
    measureBraking(world, 12, 33, 0, 6, jars).distance);
  for (let i = 1; i < distances.length; i++) {
    assert.ok(distances[i] > distances[i - 1], `jar ${i} 应比 jar ${i - 1} 制动更长`);
  }
  const gain = distances[3] - distances[0];
  assert.ok(gain > 0.4, `三罐相对空载制动距离应明显增加，实际 ${gain.toFixed(2)}m`);
});

test('高速急转触发打滑：横向速度越阈、车辙偏移并记录滑距', () => {
  const world = createWorld(SEED);
  const rover = createRover(world);
  rover.x = 4; rover.y = 27; rover.heading = 0;
  const y0 = rover.y;
  let slipStart = -1;
  let maxSide = 0;
  for (let i = 0; i < 60 * 10 && rover.status === 'active'; i++) {
    const speed = Math.hypot(rover.vx, rover.vy);
    step(world, rover, { throttle: 1, brake: 0, steer: speed > 4 ? 1 : 0 });
    const rx = -Math.sin(rover.heading);
    const ry = Math.cos(rover.heading);
    maxSide = Math.max(maxSide, Math.abs(rover.vx * rx + rover.vy * ry));
    if (rover.slip && slipStart < 0) slipStart = rover.time;
  }
  assert.ok(slipStart > 0, '应在测试窗口内进入打滑');
  assert.ok(maxSide > SLIP_SIDE_SPEED);
  assert.ok(rover.slipDistance > 3, `打滑累计距离应可观，实际 ${rover.slipDistance.toFixed(2)}m`);
  assert.ok(Math.abs(rover.y - y0) > 1, '打滑应造成可观测的横向路径偏移');
  assert.ok(rover.events.some((e) => e.type === 'slip-start') || slipStart > 0);
});

test('转向迟滞：相同满舵输入下，高速转角明显小于低速', () => {
  const world = createWorld(SEED);
  const headingAfter = (speed0) => {
    const r = createRover(world);
    r.x = 8; r.y = 27;
    r.vx = speed0;
    for (let i = 0; i < 60; i++) step(world, r, { throttle: 0, brake: 0, steer: 1 });
    return Math.abs(r.heading);
  };
  const slow = headingAfter(1);
  const fast = headingAfter(5.5);
  assert.ok(fast < slow * 0.85, `高速转角 ${fast.toFixed(2)} 应显著小于低速 ${slow.toFixed(2)}`);
});

test('陨坑边缘只触发一次滑坡：造成损伤、横向冲击并标记', () => {
  const world = createWorld(SEED);
  const crater = world.craters[4]; // (40,33) 小陨坑
  const rover = createRover(world);
  rover.x = crater.x - crater.rim - 4;
  rover.y = crater.y;
  rover.heading = 0;
  rover.vx = 5.5;
  let slides = 0;
  for (let i = 0; i < 60 * 6 && rover.status === 'active'; i++) {
    step(world, rover, { throttle: 1, brake: 0, steer: 0 });
    slides += rover.events.filter((e) => e.type === 'landslide').length;
  }
  assert.equal(slides, 1);
  assert.equal(crater.triggered, true);
  assert.ok(rover.damage > 15);
  assert.ok(Math.abs(rover.vy) > 1 || rover.slipDistance > 0 || rover.damage > 0);
});

test('损伤累积到上限即任务中止', () => {
  const world = createWorld(SEED);
  const rover = createRover(world);
  rover.damage = DAMAGE_ABORT - 1;
  const crater = world.craters[0];
  rover.x = crater.x - crater.rim - 2;
  rover.y = crater.y;
  rover.heading = 0;
  rover.vx = 6;
  for (let i = 0; i < 60 * 4 && rover.status === 'active'; i++) {
    step(world, rover, { throttle: 1, brake: 0, steer: 0 });
  }
  assert.equal(rover.status, 'aborted');
  assert.equal(rover.damage, DAMAGE_ABORT);
});

test('低重力腾空：陡坡抛起、落地留跳痕并按冲击计损伤', () => {
  const world = createWorld(SEED);
  const rover = createRover(world);
  // 直接放入陡坡并给速度，诱发 hop
  rover.x = 36; rover.y = 33; rover.heading = 0; rover.vx = 5.5;
  let hopped = false;
  for (let i = 0; i < 60 * 5; i++) {
    step(world, rover, { throttle: 1, brake: 0, steer: 0 });
    if (rover.events.some((e) => e.type === 'hop')) hopped = true;
  }
  assert.ok(hopped, '陡坡高速应触发腾空');
  assert.ok(rover.hopMarks.length > 0, '落地应留下跳痕');
  const mark = rover.hopMarks[0];
  assert.ok(mark.r > 0.5);
});

test('重复运行结果确定：两次自动驾驶轨迹一致', () => {
  const run = () => {
    const world = createWorld(SEED);
    const { rover } = runEpisode(world, autopilot, 60 * 160);
    return [rover.status, rover.time, rover.x, rover.y, rover.totalDistance];
  };
  const a = run();
  const b = run();
  assert.deepEqual(a, b);
});
