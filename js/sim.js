// 仿真核心：纯逻辑，不依赖 DOM，可在 Node 中测试
import {
  GEARS, MESHES, ESCAPEMENT, BARREL_TORQUE, MESH_EFFICIENCY,
  pitchRadius, gearById, meshTeeth, meshCenterDist,
} from './data.js';

const TWO_PI = Math.PI * 2;
const DIST_TOL = 0.6;
const SPEED_TOL = 1e-6;

export function createSim() {
  return {
    time: 0,
    running: false,
    timeScale: 20,
    beatCount: 0,
    escapeAngle: 0,
    escapeOmega: 0,
    ramp: 0,
    angles: {},
    omegas: {},
    torques: {},
    recording: null,
    onBeat: null,
  };
}

// 校验：所有连接必须闭合，齿比必须连续传递
export function verifyTrain() {
  const results = [];
  const push = (ok, msg) => results.push({ ok, msg });

  for (const g of GEARS) {
    if (g.wheel < 0 || g.pinion < 0 || (g.wheel === 0 && g.pinion === 0)) {
      push(false, `${g.name}：齿数非法`);
      return results;
    }
  }
  push(true, '全部零件齿数合法，模数一致 m=4');

  let distOk = true;
  for (const m of MESHES) {
    const na = meshTeeth(m, 'a');
    const nb = meshTeeth(m, 'b');
    const expect = pitchRadius(na) + pitchRadius(nb);
    const actual = meshCenterDist(m);
    const err = Math.abs(expect - actual);
    if (err > DIST_TOL) {
      distOk = false;
      const ga = gearById(m.a);
      const gb = gearById(m.b);
      push(false, `${ga.name}(${na}T) <-> ${gb.name}(${nb}T)：中心距 ${actual.toFixed(1)}px，` +
        `节圆要求和 ${expect.toFixed(1)}px，偏差 ${err.toFixed(1)}px，视觉啮合但齿比矛盾`);
    }
  }
  if (distOk) push(true, `${MESHES.length} 处啮合中心距全部闭合`);

  let omega;
  try {
    omega = propagateOmegas(1);
  } catch (e) {
    push(false, e.message);
    return results;
  }
  const reached = Object.keys(omega).length;
  if (reached === GEARS.length) {
    push(true, `传动链连通：${reached}/${GEARS.length} 个零件转速连续传递，无矛盾`);
  } else {
    push(false, `传动链断裂：仅 ${reached}/${GEARS.length} 个零件可达`);
  }

  const ws = Math.abs(omega.fourth || 0);
  const wm = Math.abs(omega.center || 0);
  const wh = Math.abs(omega.hour || 0);
  if (ws > 0 && Math.abs(ws / wm - 60) < 1e-6 && Math.abs(wm / wh - 12) < 1e-6) {
    push(true, '指针速比正确：秒:分 = 60:1，分:时 = 12:1');
  } else {
    push(false, `指针速比错误：秒:分 = ${wm ? (ws / wm).toFixed(2) : 'inf'}:1，` +
      `分:时 = ${wh ? (wm / wh).toFixed(2) : 'inf'}:1（应为 60:1 与 12:1）`);
  }
  return results;
}

export function verifyOk() {
  return verifyTrain().every((r) => r.ok);
}

// 从擒纵轮出发沿啮合图传播角速度（含刚性同轴），检测回路矛盾
function propagateOmegas(escapeOmega) {
  const omega = { escape: escapeOmega };
  const queue = ['escape'];
  const adj = buildAdjacency();
  while (queue.length) {
    const id = queue.shift();
    for (const edge of adj[id] || []) {
      const next = edge.to;
      const w = edge.rigid ? omega[id] : -omega[id] * edge.ratio;
      if (next in omega) {
        if (Math.abs(omega[next] - w) > SPEED_TOL) {
          throw new Error(`转速矛盾：${next} 经不同路径得到不同转速`);
        }
        continue;
      }
      omega[next] = w;
      queue.push(next);
    }
  }
  return omega;
}

function buildAdjacency() {
  const adj = {};
  const add = (from, to, ratio, rigid) => {
    (adj[from] = adj[from] || []).push({ to, ratio, rigid });
  };
  for (const m of MESHES) {
    const na = meshTeeth(m, 'a');
    const nb = meshTeeth(m, 'b');
    add(m.a, m.b, na / nb, false);
    add(m.b, m.a, nb / na, false);
  }
  for (const g of GEARS) {
    if (g.rigid) {
      add(g.id, g.rigid, 1, true);
      add(g.rigid, g.id, 1, true);
    }
  }
  return adj;
}

// 初始相位：让每对啮合在连心线处齿-槽对齐，视觉上真正啮合
export function computePhases() {
  const phase = { escape: 0 };
  const adj = buildAdjacency();
  const queue = ['escape'];
  while (queue.length) {
    const id = queue.shift();
    for (const edge of adj[id] || []) {
      if (edge.rigid || edge.to in phase) continue;
      const ga = gearById(id);
      const gb = gearById(edge.to);
      const mesh = MESHES.find((m) =>
        (m.a === id && m.b === edge.to) || (m.b === id && m.a === edge.to));
      const na = meshTeeth(mesh, mesh.a === id ? 'a' : 'b');
      const nb = meshTeeth(mesh, mesh.a === id ? 'b' : 'a');
      const dirAB = Math.atan2(gb.y - ga.y, gb.x - ga.x);
      const pb = TWO_PI / nb;
      // B 的相位使其齿槽中心对准连心线反方向，实现视觉啮合
      phase[edge.to] = dirAB + Math.PI - 0.5 * pb;
      queue.push(edge.to);
    }
  }
  for (const g of GEARS) {
    if (g.rigid && !(g.id in phase) && g.rigid in phase) phase[g.id] = phase[g.rigid];
    if (!(g.id in phase)) phase[g.id] = 0;
  }
  return phase;
}

const SIM_DT = 1 / 60; // 内部固定子步长（仿真秒），保证曲线分辨率

// 推进仿真：实际帧时间 × 倍速拆成固定子步，擒纵轮为全链运动源
export function stepSim(sim, dtReal) {
  if (!sim.running) return;
  let remain = dtReal * sim.timeScale;
  while (remain > 1e-9) {
    const dt = Math.min(SIM_DT, remain);
    remain -= dt;
    subStep(sim, dt);
  }
}

function subStep(sim, dt) {
  sim.time += dt;

  // 启动缓动：约 2 秒爬升到满速，形成转速曲线过渡段
  const ease = 1 - Math.exp(-1.5 * sim.time);
  sim.ramp = ease;

  const T = ESCAPEMENT.beatPeriod;
  const beatsNow = Math.floor(sim.time / T);
  if (beatsNow > sim.beatCount) {
    sim.beatCount = beatsNow;
    if (sim.onBeat && ease > 0.05) sim.onBeat(sim);
  }

  // 擒纵轮角速度：每拍前进一个齿距，叠加周期 1s 的微小波动（模拟擒纵误差）
  const pitch = TWO_PI / 30;
  const baseOmega = pitch / T;
  const ripple = 0.05 * Math.sin(TWO_PI * sim.time);
  sim.escapeOmega = baseOmega * ease * (1 + ripple * ease);
  sim.escapeAngle += sim.escapeOmega * dt;

  // 全链角度/转速由单位传播系数 × 擒纵轮状态得到，保证齿比连续
  const ratios = propagateOmegas(1);
  for (const g of GEARS) {
    sim.omegas[g.id] = ratios[g.id] * sim.escapeOmega;
    sim.angles[g.id] = ratios[g.id] * sim.escapeAngle;
  }

  computeTorques(sim);

  if (sim.recording && !sim.recording.done) {
    const rec = sim.recording;
    if (sim.time - rec.lastSample >= 0.1 - 1e-9) {
      rec.lastSample = sim.time;
      const row = { t: +(sim.time - rec.t0).toFixed(2) };
      for (const g of GEARS) row[g.id] = +(sim.omegas[g.id] * 60 / TWO_PI).toFixed(4);
      rec.samples.push(row);
    }
    if (sim.time - rec.t0 >= 10) rec.done = true;
  }
}

// 扭矩从发条沿链传递：T2 = T1 * (N2/N1) * η；啮合切向力 F = T / r
function computeTorques(sim) {
  const t = {};
  t.escape = BARREL_TORQUE / 8; // 擒纵轮端折算扭矩
  const adj = buildAdjacency();
  const queue = ['escape'];
  while (queue.length) {
    const id = queue.shift();
    for (const edge of adj[id] || []) {
      if (edge.to in t) continue;
      t[edge.to] = edge.rigid ? t[id] : t[id] * (1 / edge.ratio) * MESH_EFFICIENCY;
      queue.push(edge.to);
    }
  }
  sim.torques = t;
}

// 某零件的受力明细：扭矩 + 各啮合点切向力
export function gearForces(sim, id) {
  const g = gearById(id);
  const torque = sim.torques[id] || 0;
  const out = { torque, meshes: [] };
  for (const m of MESHES) {
    let teeth = 0;
    let other = null;
    if (m.a === id) { teeth = meshTeeth(m, 'a'); other = gearById(m.b).name; }
    else if (m.b === id) { teeth = meshTeeth(m, 'b'); other = gearById(m.a).name; }
    else continue;
    const r = pitchRadius(teeth);
    out.meshes.push({ other, force: r > 0 ? torque / r : 0, radius: r });
  }
  return out;
}

export function startRecording(sim) {
  sim.recording = { t0: sim.time, lastSample: sim.time - 1, samples: [], done: false };
}

export function rpmOf(sim, id) {
  return (sim.omegas[id] || 0) * 60 / TWO_PI;
}
