// 风车旱地水车调水模拟引擎（纯 ESM，浏览器与 Node 共用）
// 单位：长度 m、体积 L、压力换算为扬程 m、时间 s、转速 rad/s

export const G = 9.81;

export const CONFIG = {
  duration: 120,          // 限定时间 s
  dt: 0.1,                // 固定积分步长 s
  budgetLitres: 260,      // 总耗水上限 L
  targetMoisture: 70,     // 三块田湿度阈值 %
  startMoisture: 20,
  maxMoisture: 100,
  inertia: 1.4,           // 风轮转动惯量
  friction: 0.18,         // 风轮摩擦系数
  maxPitch: Math.PI / 4,  // 最大迎角 45°
  pumpK: 0.05,            // 泵扭矩系数
  pumpDisplacement: 0.2,  // 每弧度排水量 L/rad
  pipeCompliance: 0.35,   // 管道柔度（压力缓冲）
  spillConductance: 4.0,  // 超压溢流系数
  maxPressure: 22,        // 管道承压上限（扬程 m）
  waterhammerAlarm: 25,   // 水锤报警阈值（瞬时压力峰）
  pressureWarn: 18,       // 泵压偏高预警
  waveCelerity: 9,        // 有效水击系数（L/s 流量 → 扬程 m 冲击）
  hammerDamping: 0.18,    // 水击压力逐步衰减系数
  gateSlew: 2.0,          // 普通操作闸门每秒开合速率（全开→全关 0.5s）
  density: 1,             // kg/L
};

export const FIELDS = [
  { id: 0, name: '低田', elevation: 2, capacity: 1.0, infiltration: 0.004 },
  { id: 1, name: '中田', elevation: 5, capacity: 1.15, infiltration: 0.004 },
  { id: 2, name: '高田', elevation: 8, capacity: 1.3, infiltration: 0.004 },
];

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createState() {
  return {
    t: 0,
    wind: 8,
    targetWind: 8,
    pitch: 0.35,
    pumpSpeed: 0,            // 风轮/泵转速 rad/s
    rotorAngle: 0,          // 风轮累计转角（渲染用）
    pressure: 0,             // 当前泵压（扬程 m）
    peakTransient: 0,        // 本步水锤瞬时峰
    gateTarget: [0, 0, 0],   // 闸门指令 0..1
    gate: [0, 0, 0],         // 闸门实际开度
    flow: [0, 0, 0],         // 入田流量 L/s
    pumpFlow: 0,
    spill: 0,
    totalPumped: 0,
    moisture: [
      CONFIG.startMoisture,
      CONFIG.startMoisture,
      CONFIG.startMoisture,
      ],
    wetLitres: [0, 0, 0],
    snapClosure: null,
    events: [],
    alarmActive: false,
    alarmLatch: false,
    overPressure: false,
    finished: false,
    result: null,
  };
}

function windCurve(t) {
  // 脚本化风况：阵风 + 缓变，保证可复现
  const base = 8 + 2.2 * Math.sin(t / 21) + 1.3 * Math.sin(t / 7.3 + 1.7);
  const gust = t > 44 && t < 58 ? 2.6 * Math.sin(((t - 44) / 14) * Math.PI) : 0;
  return clamp(base + gust, 3.5, 14);
}

export function setWind(state, value) {
  state.targetWind = clamp(value, 0, 16);
}

export function setPitch(state, rad) {
  state.pitch = clamp(rad, 0, CONFIG.maxPitch);
}

export function setGate(state, index, open) {
  if (state.snapClosure) return;
  state.gateTarget[index] = clamp(open, 0, 1);
}

// snap=true 时本步直接关死，用于演示急关水锤
export function closeGates(state, snap = false) {
  state.gateTarget = [0, 0, 0];
  if (snap) {
    state.snapClosure = {
      prevGate: state.gate.slice(),
      flow: state.flow.slice(),
    };
    state.gate = [0, 0, 0];
  }
}

function stepGates(state, dt) {
  const prev = state.gate.slice();
  if (state.snapClosure) return prev; // 急关由 closeGates 直接处理
  for (let i = 0; i < 3; i++) {
    const diff = state.gateTarget[i] - state.gate[i];
    const move = clamp(diff, -CONFIG.gateSlew * dt, CONFIG.gateSlew * dt);
    state.gate[i] += move;
  }
  return prev;
}

function stepRotor(state, dt) {
  // 叶片气动扭矩：迎角 45° 捕获效率最高，失速区外近似 sin(2β)
  const capture = 0.92 * Math.sin(2 * state.pitch) + 0.06;
  const windTorque = 0.55 * state.wind * state.wind * capture;
  // 容积式泵：排出压力形成反作用扭矩 T = V·P（单位换算系数）
  const headLoad = 0.055 * state.pressure * state.pumpSpeed;
  const pumpTorque =
    CONFIG.pumpK * state.pumpSpeed * state.pumpSpeed +
    headLoad +
    0.35 * state.pumpSpeed;
  const omegaDot =
    (windTorque - pumpTorque - CONFIG.friction * state.pumpSpeed) /
    CONFIG.inertia;
  state.pumpSpeed = Math.max(0, state.pumpSpeed + omegaDot * dt);
  return state.pumpSpeed * CONFIG.pumpDisplacement; // 理论泵流量 L/s
}

function requiredHead(state) {
  // 按当前最大开度田块的高程决定扬水高度
  let head = 1.2;
  for (let i = 0; i < 3; i++) {
    if (state.gate[i] > 0.02) head = Math.max(head, FIELDS[i].elevation);
  }
  return head;
}

function waterHammer(state, prevGate, demandBefore, dt) {
  // 闸门关闭导致需求流量骤降，按 Joukowsky 估算水击压力峰
  const before = prevGate.reduce((s, g) => s + g, 0);
  const after = state.gate.reduce((s, g) => s + g, 0);
  if (before <= after || demandBefore <= 0.05) return 0;
  const closedFraction = (before - after) / before;
  const closureTime = Math.max(dt, (before - after) / CONFIG.gateSlew);
  // 缓闭时水击被管道柔度吸收，用特征时间比衰减
  const attenuation = 1 / (1 + closureTime * 26);
  return (
    CONFIG.waveCelerity * demandBefore * closedFraction * attenuation
  );
}

function stepHydraulics(state, idealFlow, prevGate, dt) {
  const head = requiredHead(state);
  const minHead = Math.max(1.2, head - 1.5);
  const primed = state.pressure >= minHead;
  const pumpedFlow = primed ? idealFlow : 0; // 引水建压阶段不出水、不计耗水
  const openArea = state.gate.reduce((s, g) => s + g, 0);
  const conductance = 0.85 * openArea;
  const demandFlow =
    conductance > 0
      ? conductance * Math.sqrt(Math.max(0, state.pressure - head))
      : 0;

  let hammer;
  if (state.snapClosure) {
    const snap = state.snapClosure;
    const snapFlow = snap.flow.reduce((a, b) => a + b, 0);
    hammer = snapWaterHammer(snap.prevGate, state.gate, snapFlow, dt);
    state.snapClosure = null;
  } else {
    hammer = waterHammer(state, prevGate, demandFlow, dt);
  }
  state.peakTransient = state.pressure + hammer;
  state.alarmActive = state.peakTransient >= CONFIG.waterhammerAlarm;
  if (state.alarmActive) state.alarmLatch = true;

  // 压力动态：容积泵入 - 闸门出流 - 超压溢流，叠加水锤瞬态
  const spill = state.pressure > CONFIG.maxPressure
    ? CONFIG.spillConductance * (state.pressure - CONFIG.maxPressure)
    : 0;
  const dp =
    (idealFlow - demandFlow - spill) * CONFIG.pipeCompliance * dt +
    hammer * 0.8;
  state.pressure = Math.max(0, state.pressure + dp);
  state.spill = spill;
  state.pumpFlow = pumpedFlow;
  state.overPressure = state.pressure >= CONFIG.pressureWarn;

  // 实际入田流量受泵排量与需求双重限制
  const delivered = Math.min(demandFlow, pumpedFlow);
  distributeFlow(state, delivered, head);
  if (hammer > 0.5) {
    state.events.push({
      t: state.t,
      type: 'waterhammer',
      peak: state.peakTransient,
    });
  }
}

function snapWaterHammer(prevGate, nextGate, flowBefore, dt) {
  const before = prevGate.reduce((s, g) => s + g, 0);
  const after = nextGate.reduce((s, g) => s + g, 0);
  if (before <= after || flowBefore <= 0.05) return 0;
  const closedFraction = (before - after) / before;
  // 急关：关闭时间取一个步长，水击几乎不衰减
  const attenuation = 1 / (1 + dt * 2);
  return CONFIG.waveCelerity * flowBefore * closedFraction * attenuation;
}

function distributeFlow(state, total, head) {
  const weights = state.gate.map((g, i) =>
    g > 0.02 && state.pressure >= FIELDS[i].elevation ? g : 0
  );
  const sum = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 3; i++) {
    state.flow[i] = sum > 0 ? (total * weights[i]) / sum : 0;
  }
}

function stepFields(state, dt) {
  for (let i = 0; i < 3; i++) {
    const field = FIELDS[i];
    const litres = state.flow[i] * dt;
    state.wetLitres[i] += litres;
    const gain = litres / field.capacity;
    const loss = field.infiltration * dt; // 旱地自然下渗/蒸发
    state.moisture[i] = clamp(
      state.moisture[i] + gain - loss,
      0,
      CONFIG.maxMoisture
    );
  }
  state.totalPumped += state.pumpFlow * dt;
}

function evaluate(state) {
  const allWet = state.moisture.every((m) => m >= CONFIG.targetMoisture);
  if (allWet && state.totalPumped <= CONFIG.budgetLitres) {
    state.finished = true;
    state.result = 'success';
    return;
  }
  if (state.totalPumped > CONFIG.budgetLitres) {
    state.finished = true;
    state.result = 'budget_exceeded';
    return;
  }
  if (state.t >= CONFIG.duration) {
    state.finished = true;
    state.result = allWet ? 'success' : 'timeout';
  }
}

export function step(state, dt = CONFIG.dt) {
  if (state.finished) return state;
  state.t = Math.round((state.t + dt) * 1000) / 1000;
  state.wind += (windCurve(state.t) - state.wind) * Math.min(1, dt * 1.5);
  const prevGate = stepGates(state, dt);
  const idealFlow = stepRotor(state, dt);
  state.rotorAngle += state.pumpSpeed * dt;
  stepHydraulics(state, idealFlow, prevGate, dt);
  stepFields(state, dt);
  evaluate(state);
  return state;
}

export function snapshot(state) {
  return {
    t: state.t,
    wind: state.wind,
    pitch: state.pitch,
    pumpSpeed: state.pumpSpeed,
    rotorAngle: state.rotorAngle,
    pressure: state.pressure,
    peakTransient: state.peakTransient,
    gate: state.gate.slice(),
    flow: state.flow.slice(),
    pumpFlow: state.pumpFlow,
    totalPumped: state.totalPumped,
    moisture: state.moisture.slice(),
    wetLitres: state.wetLitres.slice(),
    alarmActive: state.alarmActive,
    alarmLatch: state.alarmLatch,
    overPressure: state.overPressure,
    finished: state.finished,
    result: state.result,
  };
}
