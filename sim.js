// 仿真:用与游戏完全相同的声学模型,模拟玩家驾驶听漏车完成一次定位。
// 运行: node sim.js [seed]
import {
  createWorld,
  leakGain, panGains, valveGain, engineGain, segmentAt,
} from './js/world.js';

const seed = Number(process.argv[2] ?? 20261114);
const world = createWorld(seed);
const MAX_SPEED = 130;
const NOISE_FLOOR = 0.02;

const car = { x: 0, y: 0, heading: 0, speed: 0 };
let clock = 0;          // 任务总耗时(秒)
let mistakes = 0;
const log = (...a) => console.log(...a);

// 停车听漏:漏声恒定,阀门是脉冲,耐心等待取最安静时刻可分离干扰
function listen(x, y) {
  let sig = 0;
  for (const l of world.leaks) if (!l.found) sig += leakGain(l, x, y);
  let minNoise = Infinity, maxNoise = 0;
  for (let t = 0; t < 4; t += 0.05) {
    let n = engineGain(0, MAX_SPEED) + NOISE_FLOOR;
    for (const v of world.valves) n += valveGain(v, x, y, t);
    minNoise = Math.min(minNoise, n);
    maxNoise = Math.max(maxNoise, n);
  }
  clock += 4; // 停车听 4 秒
  return { sig, snr: sig / minNoise, valvePeak: maxNoise };
}

// 开车引擎噪声会掩蔽水声 —— 演示一次
{
  const l = world.leaks[0];
  const moving = engineGain(MAX_SPEED, MAX_SPEED) + NOISE_FLOOR;
  const still = engineGain(0, MAX_SPEED) + NOISE_FLOOR;
  log(`[演示] 漏点旁 10m 处: 行驶时 SNR=${(leakGain(l, l.x + 10, l.y) / moving).toFixed(2)}` +
      `,停车后 SNR=${(leakGain(l, l.x + 10, l.y) / still).toFixed(2)} -> 必须减速停车才能听清`);
}

// 沿街道网驾驶到目标点(先横后纵),累计行驶时间
function driveTo(tx, ty) {
  const dist = Math.abs(tx - car.x) + Math.abs(ty - car.y);
  clock += dist / MAX_SPEED;
  car.x = tx; car.y = ty;
  car.heading = Math.atan2(ty - car.y, tx - car.x);
  return dist;
}

function fmt(seg) {
  return `段#${seg.id} (${seg.x1},${seg.y1})->(${seg.x2},${seg.y2})`;
}

log(`\n=== 听漏车出勤 · 城市种子 ${seed} · 3 处泄漏待定位 ===\n`);

let round = 0;
const excluded = new Set();
while (world.leaks.some(l => !l.found) && round++ < 12) {
  // 阶段1: 巡测 —— 在每段街道上停车采样,找信号最强的管段
  let best = null;
  for (const seg of world.segments) {
    if (excluded.has(seg.id)) continue;
    let peak = { snr: 0, sig: 0 };
    for (let k = 1; k <= 9; k++) {
      const t = k / 10;
      const px = seg.x1 + (seg.x2 - seg.x1) * t;
      const py = seg.y1 + (seg.y2 - seg.y1) * t;
      const r = listen(px, py);
      if (r.snr > peak.snr) peak = { ...r, px, py };
    }
    if (!best || peak.snr > best.peak.snr) best = { seg, peak };
  }
  if (!best || best.peak.snr < 0.8) { log('巡测未发现可信信号,失败。'); break; }
  log(`[巡测] 第 ${round} 轮:最强信号在 ${fmt(best.seg)},SNR=${best.peak.snr.toFixed(1)}`);

  // 阶段2: 开到该段,细扫并用左右声道确认方位
  const d = driveTo(best.peak.px, best.peak.py);
  log(`[驾驶] 行驶 ${d.toFixed(0)}m 抵达候选管段(行驶中发动机掩蔽,无法听漏)`);
  let fine = { sig: -1 };
  for (let k = 0; k <= 20; k++) {
    const t = k / 20;
    const px = best.seg.x1 + (best.seg.x2 - best.seg.x1) * t;
    const py = best.seg.y1 + (best.seg.y2 - best.seg.y1) * t;
    const r = listen(px, py);
    if (r.sig > fine.sig) fine = { ...r, px, py };
  }
  car.x = fine.px; car.y = fine.py;
  const target = world.leaks.find(l => !l.found && l.segId === best.seg.id);
  const ref = target ?? world.leaks.find(l => !l.found);
  const [gL, gR] = panGains(ref, car.x, car.y, 0);
  log(`[精扫] 峰值位于 (${fine.px.toFixed(0)},${fine.py.toFixed(0)}),` +
      `声像 L=${gL.toFixed(2)}/R=${gR.toFixed(2)} -> ${gL > gR ? '偏左' : '偏右'}`);

  // 阶段3: 标记当前管段
  const seg = segmentAt(world, car.x, car.y);
  const hit = world.leaks.find(l => !l.found && l.segId === seg.id);
  if (hit) {
    hit.found = true;
    log(`[标记] ${fmt(seg)} ... 命中!漏点实际位于 (${hit.x.toFixed(0)},${hit.y.toFixed(0)}),` +
        `误差 ${Math.hypot(hit.x - car.x, hit.y - car.y).toFixed(1)}m\n`);
  } else {
    mistakes++;
    excluded.add(seg.id);
    log(`[标记] ${fmt(seg)} ... 误标!该段无泄漏,复盘后排除\n`);
  }
}

const found = world.leaks.filter(l => l.found).length;
log(`=== 任务结束:定位 ${found}/3 处泄漏,误标 ${mistakes} 次,` +
    `总耗时 ${(clock / 60).toFixed(1)} 分钟 ===`);
process.exit(found === 3 ? 0 : 1);
