// 道岔冲突测试：在保护区被占用、道岔已锁向其他出口时，
// 后车以过大的道岔提前量强行请求切换，验证系统触发急停而非碰撞。
const S = require('./sim.js');

function buildConflictWorld() {
  // 复用固定 seed 的前两次任务，但让第二辆车提前并发进入，
  // 并把道岔提前量调到极大，使其在第一辆仍占用保护区时就请求切换。
  const missions = S.generateMissions(239);
  const settings = {};
  missions.forEach((m) => {
    settings[m.id + ':' + m.index] = { accel: 42, brakePoint: -100, switchLead: 0.5 };
  });
  const world = new S.World({ seed: 239, settings });

  // 手动注入第二辆活动托盘，制造并发占用；其目标出口与第一辆不同，
  // 且道岔提前量极大，会在第一辆位于保护区内时立即请求切换。
  const second = missions[1];
  world.queue = world.queue.filter((m) => m.index !== second.index);
  const injected = {
    id: second.id,
    mission: second,
    s: -210,
    v: 45,
    mode: 'coast',
    enterZone: false,
    switchDone: false,
    switchAt: null,
    switchQueued: false,
    waiting: false,
    phase: 'outbound',
    departAt: 0,
    cfg: { accel: 42, brakePoint: 200, switchLead: 0.5 },
    result: null,
    x: 0, y: 0, arm: second.enters,
    magnet: 0
  };
  world.pallets.push(injected);

  // 等第一辆 P0 锁定道岔并进入保护区后，再令 P1 强行请求切换到不同出口。
  // 此时保护区被占用且道岔已锁向 N，而 P1 要切到 E -> 必须急停。
  const baseStep = world.step.bind(world);
  let armed = false;
  let frozen = false;
  world.step = function () {
    if (!armed && world.zoneOccupant && world.zoneOccupant !== injected) {
      armed = true;
      frozen = true;
      injected.cfg.switchLead = 9; // 放大提前量，使本帧立即触发请求
      world.log('test-arm', injected.id, '测试注入：保护区占用中，强制 ' + injected.id + ' 请求道岔切换');
    }
    if (frozen) {
      // 冻结 P1 的位置更新，仅保留道岔请求逻辑，避免提前闯入保护区
      const savedS = injected.s, savedV = injected.v;
      baseStep();
      if (injected.mode !== 'estop') { injected.s = savedS; injected.v = savedV; }
      world._refreshPose(injected);
      return world.status === 'running';
    }
    return baseStep();
  };
  return { world, injectedId: injected.id };
}

const { world, injectedId } = buildConflictWorld();
let n = 0;
const cap = 12 / world.dt;
while (world.status === 'running' && n < cap) {
  world.step();
  n++;
}

const conflictEvents = world.events.filter((e) => e.type === 'conflict' || e.type === 'switch' || e.type === 'zone-enter' || e.type === 'fail');
console.log('--- 道岔冲突测试事件 ---');
conflictEvents.forEach((e) => console.log(e.t.toFixed(2).padStart(6), e.type.padEnd(12), e.msg));
console.log('--- 结果 ---');
console.log('status      :', world.status);
console.log('failReason  :', world.failReason);
console.log('conflicts   :', world.stats.conflicts);
console.log('collisions  :', world.stats.collisions);
const injected = world.pallets.find((p) => p.id === injectedId && p.result === 'conflict');
console.log('急停托盘    :', injected ? injected.id + ' mode=' + injected.mode + ' result=' + injected.result : '未找到');

const ok = world.status === 'failed' &&
  world.stats.conflicts >= 1 &&
  world.stats.collisions === 0 &&
  !!injected && injected.mode === 'estop';
console.log(ok ? '\nPASS: 道岔冲突被联锁捕获并触发急停，未发生碰撞' : '\nFAIL: 冲突测试未达预期');
process.exit(ok ? 0 : 1);
