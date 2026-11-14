// 渲染器测试：用完整的 CanvasRenderingContext2D 方法桩，
// 在成功局与冲突急停两种世界状态下逐帧调用 draw，确保渲染不抛错、坐标为有限数。
const S = require('./sim.js');
const Q = require('./solver.js');

function makeCtx() {
  const gradient = { addColorStop() {} };
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', font: '',
    textAlign: '', textBaseline: '',
    clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    fillText() {}, arc() {}, setLineDash() {},
    createRadialGradient() { return gradient; }
  };
}

// renderer.js 通过 window 全局挂载，在 Node 中提供全局别名
global.window = global;
global.MaglevSim = S;
require('./renderer.js');
const Renderer = global.MaglevRenderer;

function fakeCanvas() {
  return { width: 820, height: 820, getContext: () => makeCtx() };
}

function runScenario(buildWorld, label) {
  const renderer = new Renderer(fakeCanvas(), S);
  const world = buildWorld();
  let frames = 0;
  let finite = true;
  const cap = 120 / world.dt;
  let n = 0;
  while (n < cap) {
    if (world.status === 'running') world.step();
    renderer.draw(world, n * world.dt);
    frames++;
    world.pallets.concat(world.parked).forEach((p) => {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) finite = false;
    });
    if (world.status !== 'running' && frames >= 3) break;
    n++;
  }
  const ok = frames > 10 && finite;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + label + '（渲染 ' + frames +
    ' 帧，坐标有限=' + finite + '，终态=' + world.status + '）');
  return ok;
}

const ok1 = runScenario(
  () => new S.World({ seed: 239, settings: Q.solveSettings(239) }),
  '成功局全程渲染'
);

function conflictWorld() {
  const missions = S.generateMissions(239);
  const world = new S.World({ seed: 239, settings: Q.solveSettings(239) });
  const second = missions[1];
  world.queue = world.queue.filter((m) => m.index !== second.index);
  const injected = {
    id: second.id, mission: second, s: -210, v: 45, mode: 'coast',
    enterZone: false, switchDone: false, switchAt: null, waiting: false,
    phase: 'outbound', departAt: 0,
    cfg: { accel: 42, brakePoint: 200, switchLead: 0.5 },
    result: null, x: 0, y: 0, arm: second.enters, magnet: 0
  };
  world.pallets.push(injected);
  const base = world.step.bind(world);
  let armed = false, frozen = false;
  world.step = function () {
    if (!armed && world.zoneOccupant && world.zoneOccupant !== injected) {
      armed = true; frozen = true; injected.cfg.switchLead = 9;
    }
    if (frozen) {
      const ss = injected.s, vv = injected.v;
      base();
      if (injected.mode !== 'estop') { injected.s = ss; injected.v = vv; }
      world._refreshPose(injected);
      return world.status === 'running';
    }
    return base();
  };
  return world;
}

const ok2 = runScenario(conflictWorld, '冲突急停场景渲染');

const allOk = ok1 && ok2;
console.log(allOk ? '\n渲染测试全部通过' : '\n渲染测试存在失败');
process.exit(allOk ? 0 : 1);
