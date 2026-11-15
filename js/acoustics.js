// 纯声学计算模块：无 DOM / Web Audio 依赖，可在 Node 中直接测试。

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  norm(a) {
    const len = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / len, a[1] / len, a[2] / len];
  },
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
};

export const DEFAULT_ROOM = { width: 6, height: 3, depth: 5, absorption: 0.35 };
export const DEFAULT_LISTENER = { position: [0, 1.5, 0], forward: [0, 0, -1] };

export function roomVolume(room) {
  return room.width * room.height * room.depth;
}

export function roomSurfaceArea(room) {
  const { width: w, height: h, depth: d } = room;
  return 2 * (w * h + w * d + h * d);
}

// Sabine 公式：RT60 = 0.161 V / (S * α)，α 为六面统一吸声系数。
export function sabineRT60(room) {
  const denom = roomSurfaceArea(room) * clamp(room.absorption, 0.01, 1);
  return (0.161 * roomVolume(room)) / denom;
}

// 与 Web Audio PannerNode distanceModel="inverse" 一致的距离增益。
export function inverseDistanceGain(distance, {
  refDistance = 1, rolloffFactor = 1, maxDistance = 100,
} = {}) {
  if (distance <= refDistance) return 1;
  const d = Math.min(distance, maxDistance);
  return refDistance / (refDistance + rolloffFactor * (d - refDistance));
}

// 监听者坐标系：forward 为朝向，right = forward × up（右手系，Y 朝上）。
// 朝向 -Z 时 right = +X，即世界 X 正方向对应监听者右侧，与 Web Audio 一致。
export function listenerBasis(forward) {
  const up = [0, 1, 0];
  const f = v3.norm(forward);
  return { forward: f, right: v3.norm(v3.cross(f, up)) };
}

// 普通立体声的等功率声像 pan ∈ [-1, 1]，仅取决于水平面相对朝向的角度。
export function stereoPan(source, listener, forward) {
  const { right } = listenerBasis(forward);
  const rel = v3.sub(source, listener.position);
  const angle = Math.atan2(v3.dot(rel, right), v3.dot(rel, forward));
  return clamp(Math.sin(angle), -1, 1);
}

// 等功率声像：中心位置每声道 -3 dB，与 StereoPannerNode 算法一致。
export function equalPowerGains(pan) {
  const p = clamp(pan, -1, 1);
  const x = (p + 1) * (Math.PI / 4);
  return { left: Math.cos(x), right: Math.sin(x) };
}

export function isInsideRoom(pos, room) {
  const hx = room.width / 2, hy = room.height / 2, hz = room.depth / 2;
  return Math.abs(pos[0]) <= hx && Math.abs(pos[1]) <= hy && Math.abs(pos[2]) <= hz;
}

// 折线路径按弧长均匀重采样，采样密度 samplesPerMeter。
export function buildPath(points, samplesPerMeter = 24) {
  if (points.length < 2) throw new Error('路径至少需要两个点');
  const samples = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const len = v3.dist(points[i], points[i + 1]);
    const steps = Math.max(1, Math.round(len * samplesPerMeter));
    for (let s = 0; s < steps; s++) {
      samples.push({ point: points[i].map((c, k) => lerp(c, points[i + 1][k], s / steps)), dist: total });
      total += len / steps;
    }
  }
  samples.push({ point: points[points.length - 1], dist: total });
  return { points, samples, length: total };
}

export function positionAt(path, u) {
  const target = clamp(u, 0, 1) * path.length;
  let lo = 0, hi = path.samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (path.samples[mid].dist < target) lo = mid + 1; else hi = mid;
  }
  const b = path.samples[lo];
  const a = path.samples[Math.max(0, lo - 1)];
  const span = b.dist - a.dist || 1;
  const t = clamp((target - a.dist) / span, 0, 1);
  return a.point.map((c, k) => lerp(c, b.point[k], t));
}

// 生成指数衰减白噪声脉冲响应，时长取 1.5×RT60（夹在 0.1–4s）。
export function makeImpulseResponse(audioCtx, rt60) {
  const rate = audioCtx.sampleRate;
  const duration = clamp(rt60 * 1.5, 0.1, 4);
  const length = Math.max(1, Math.floor(rate * duration));
  const ir = audioCtx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const decay = Math.exp(-6.9078 * (i / length) * (duration / Math.max(rt60, 0.01)));
      data[i] = (Math.random() * 2 - 1) * decay;
    }
  }
  return ir;
}
