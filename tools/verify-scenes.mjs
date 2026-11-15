// Node 验证：对比“小房间 / 长走廊”的早期反射与 RT60，
// 并用纯 JS 移植 FDN 仿真（与 engine.js 同构）检查尾音衰减。
import { computeAcoustics, computePaths } from "../js/acoustics.js";

const scenes = {
  small: {
    name: "小房间",
    state: { width: 3.0, depth: 3.2, height: 2.4, wet: 0.35,
      walls: { left: "wood", right: "wood", back: "acoustic" } },
  },
  hall: {
    name: "长走廊",
    state: { width: 2.6, depth: 22, height: 3.2, wet: 0.45,
      walls: { left: "concrete", right: "concrete", back: "plaster" } },
  },
};

function summarize(key) {
  const { state: s, name } = scenes[key];
  const ac = computeAcoustics(s);
  const paths = computePaths(s);
  const first = paths.find((p) => p.order === 1);
  const firstOrder = paths.filter((p) => p.order === 1)
    .sort((x, y) => x.relDelay - y.relDelay);
  const secondOrder = paths.filter((p) => p.order === 2)
    .sort((x, y) => x.relDelay - y.relDelay);
  const thirdOrder = paths.filter((p) => p.order === 3)
    .sort((x, y) => x.relDelay - y.relDelay);
  return {
    name,
    state: s,
    rt60: ac.rt60,
    firstMs: firstOrder[0].relDelay * 1000,
    lastFirstMs: firstOrder.at(-1).relDelay * 1000,
    spanMs: (firstOrder.at(-1).relDelay - firstOrder[0].relDelay) * 1000,
    secondFirstMs: secondOrder[0].relDelay * 1000,
    secondLastMs: secondOrder.at(-1).relDelay * 1000,
    axialMs: thirdOrder[0].relDelay * 1000,
    volume: ac.volume,
    alpha: ac.alphaAvg,
    ac,
  };
}

// ---- 纯 JS FDN 仿真（与 reverb-worklet.js 逐行同构）----
function simulateFDN(ac, seconds = 6, sr = 44100) {
  const N = Math.floor(sr * seconds);
  const MAX_DELAY = 0.85;
  const NL = 4;
  const buffers = Array.from({ length: NL },
    () => new Float64Array(Math.ceil(MAX_DELAY * sr) + 2));
  const readIdx = new Array(NL).fill(0);
  const writeIdx = new Array(NL).fill(0);
  const lpState = new Array(NL).fill(0);
  const delaySamples = ac.delayTimes.map((t) => Math.max(2, Math.round(t * sr)));
  const lpA = Math.min(0.95, (2 * Math.PI * ac.dampingCutoff) / sr);
  const H = [
    [0.5, 0.5, 0.5, 0.5],
    [0.5, -0.5, 0.5, -0.5],
    [0.5, 0.5, -0.5, -0.5],
    [0.5, -0.5, -0.5, 0.5],
  ];
  const out = new Float64Array(N);
  const input = new Float64Array(N);
  input[0] = 1;
  for (let n = 0; n < N; n++) {
    const reads = new Array(NL);
    for (let i = 0; i < NL; i++) {
      const raw = buffers[i][readIdx[i]];
      lpState[i] += lpA * (raw - lpState[i]);
      reads[i] = lpState[i];
    }
    let y = 0;
    for (let i = 0; i < NL; i++) y += reads[i];
    out[n] = y;
    for (let j = 0; j < NL; j++) {
      let mix = input[n] * 0.25;
      for (let i = 0; i < NL; i++) mix += reads[i] * ac.feedbackGains[i] * H[i][j];
      const buf = buffers[j];
      buf[writeIdx[j]] = mix;
      writeIdx[j] = (writeIdx[j] + 1) % buf.length;
      readIdx[j] = (writeIdx[j] - delaySamples[j] + buf.length * 2) % buf.length;
    }
  }
  return out;
}

function estimateRT60(ir, sr) {
  let peak = 0;
  for (let i = 0; i < ir.length; i++) if (Math.abs(ir[i]) > Math.abs(ir[peak])) peak = i;
  let energy = 0;
  const db = new Float64Array(ir.length);
  for (let i = ir.length - 1; i >= peak; i--) {
    energy += ir[i] * ir[i];
    db[i] = 10 * Math.log10(energy + 1e-12);
  }
  const ref = db[peak];
  const tAt = (level) => {
    for (let i = peak; i < ir.length; i++) if (db[i] - ref <= level) return (i - peak) / sr;
    return null;
  };
  const t5 = tAt(-5), t35 = tAt(-35);
  return t5 && t35 ? (t35 - t5) * 2 : null; // T30 → RT60
}

const rows = ["small", "hall"].map(summarize);
console.log("=== 场景声学对比（Eyring 理论 + 镜像声源）===");
for (const r of rows) {
  console.log(`\n[${r.name}] ${r.state.width}×${r.state.depth}×${r.state.height} m`);
  console.log(`  容积            : ${r.volume.toFixed(1)} m³`);
  console.log(`  平均吸声系数 α  : ${r.alpha.toFixed(3)}`);
  console.log(`  RT60(Eyring)    : ${r.rt60.toFixed(3)} s`);
  console.log(`  最早一次反射    : ${r.firstMs.toFixed(1)} ms`);
  console.log(`  最晚一次反射    : ${r.lastFirstMs.toFixed(1)} ms`);
  console.log(`  一次反射跨度    : ${r.spanMs.toFixed(1)} ms`);
  console.log(`  最早二阶反射    : ${r.secondFirstMs.toFixed(1)} ms`);
  console.log(`  最晚二阶（轴向）: ${r.secondLastMs.toFixed(1)} ms`);
  console.log(`  三阶轴向弹跳    : ${r.axialMs.toFixed(1)} ms`);
}

console.log("\n=== FDN 仿真实测 RT60（Schroeder 反向积分 T30）===");
const sim = {};
for (const key of ["small", "hall"]) {
  const ac = computeAcoustics(scenes[key].state);
  const ir = simulateFDN(ac, 7);
  const measured = estimateRT60(ir, 44100);
  sim[key] = measured;
  console.log(`[${scenes[key].name}] 理论 ${ac.rt60.toFixed(3)} s / 仿真 ${measured.toFixed(3)} s`);
}

const [a, b] = rows;
const assertions = [
  ["走廊 RT60 显著更长（≥3×）", b.rt60 / a.rt60 >= 3],
  ["走廊仿真 RT60 显著更长（≥3×）", sim.hall / sim.small >= 3],
  ["两场景首反射延迟有明显差异（相差 ≥30%）",
    Math.abs(b.firstMs - a.firstMs) / a.firstMs >= 0.3],
  ["走廊侧向反射极早（≤2 ms，颤动回声特征）", b.firstMs <= 2],
  ["小房间一次反射更晚（≥2.5 ms，密集簇状）", a.firstMs >= 2.5],
  ["走廊三阶轴向回声显著更晚（≥2×）", b.axialMs / a.axialMs >= 2],
  ["两场景三阶轴向回声绝对差 ≥30 ms", b.axialMs - a.axialMs >= 30],
  ["仿真与理论 RT60 误差在 35% 以内（小房间）",
    Math.abs(sim.small - a.rt60) / a.rt60 < 0.35],
  ["仿真与理论 RT60 误差在 35% 以内（走廊）",
    Math.abs(sim.hall - b.rt60) / b.rt60 < 0.35],
];
console.log("\n=== 断言 ===");
let pass = 0;
for (const [label, ok] of assertions) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (ok) pass++;
}
console.log(`\n${pass}/${assertions.length} 项通过`);
process.exit(pass === assertions.length ? 0 : 1);
