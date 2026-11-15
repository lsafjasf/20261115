import { DrumMachine } from "./drums.js";
import { computePaths } from "./acoustics.js";

const WORKLET_URL = new URL("./reverb-worklet.js", import.meta.url);

// 在给定上下文（实时或离线）里创建 FDN Worklet 节点并应用声学参数
async function createFDNNode(ctx, ac) {
  await ctx.audioWorklet.addModule(WORKLET_URL);
  const node = new AudioWorkletNode(ctx, "reverb-fdn", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
  });
  applyFDNParams(node, ac, ctx.currentTime);
  return node;
}

function applyFDNParams(node, ac, when) {
  for (let i = 0; i < 4; i++) {
    node.parameters.get(`delay${i}`).setTargetAtTime(ac.delayTimes[i], when, 0.08);
    node.parameters.get(`gain${i}`).setTargetAtTime(ac.feedbackGains[i], when, 0.08);
  }
  node.parameters.get("cutoff").setTargetAtTime(ac.dampingCutoff, when, 0.1);
}

export class StudioEngine {
  constructor() {
    this.ctx = null;
  }

  async init(state, ac) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.drumBus = ctx.createGain();
    this.drumBus.gain.value = 0.9;
    this.dryGain = ctx.createGain();
    this.wetGain = ctx.createGain();
    this.master = ctx.createGain();
    this.drumBus.connect(this.dryGain).connect(this.master);
    this.drumBus.connect(this.wetGain);

    // 早期反射：11 个延迟+增益抽头（直达声之外的全部路径）
    this.earlyTaps = [];
    this.earlyBus = ctx.createGain();
    this.earlyBus.connect(this.wetGain);
    for (let i = 0; i < 11; i++) {
      const d = ctx.createDelay(1.0);
      const g = ctx.createGain();
      this.drumBus.connect(d);
      d.connect(g);
      g.connect(this.earlyBus);
      this.earlyTaps.push({ d, g });
    }

    // 分析器与输出先建好，避免 Worklet 异步加载期间被可视化循环访问
    this.masterAnalyser = ctx.createAnalyser();
    this.masterAnalyser.fftSize = 2048;
    this.wetAnalyser = ctx.createAnalyser();
    this.wetAnalyser.fftSize = 2048;
    this.wetAnalyser.smoothingTimeConstant = 0.75;
    this.master.connect(this.masterAnalyser);
    this.wetGain.connect(this.wetAnalyser);
    this.master.connect(ctx.destination);

    // FDN 混响尾（AudioWorklet 样本级实现）
    this.fdn = await createFDNNode(ctx, ac);
    this.drumBus.connect(this.fdn);
    this.fdn.connect(this.wetGain);

    this.wetGain.gain.value = state.wet;
    this.dryGain.gain.value = 1 - state.wet * 0.5;
    this.updateEarly(state);

    this.drums = new DrumMachine(ctx, this.drumBus);
  }

  updateFDN(ac) {
    if (this.ctx) applyFDNParams(this.fdn, ac, this.ctx.currentTime);
  }

  updateEarly(state) {
    if (!this.ctx) return;
    const paths = computePaths(state).filter((p) => p.order > 0);
    const t = this.ctx.currentTime;
    paths.forEach((p, i) => {
      this.earlyTaps[i].d.delayTime.setTargetAtTime(p.relDelay, t, 0.05);
      this.earlyTaps[i].g.gain.setTargetAtTime(p.gain * 0.7, t, 0.05);
    });
  }

  setWet(wet) {
    if (!this.ctx) return;
    this.wetGain.gain.setTargetAtTime(wet, this.ctx.currentTime, 0.05);
    this.dryGain.gain.setTargetAtTime(1 - wet * 0.5, this.ctx.currentTime, 0.05);
  }

  async resume() { if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume(); }

  // 离线渲染脉冲响应，用同一个 Worklet FDN 渲染后做 Schroeder 反向积分
  async offlineRT60(ac, renderSec) {
    const sr = 44100;
    const off = new OfflineAudioContext(1, Math.ceil(sr * renderSec), sr);
    const fdn = await createFDNNode(off, ac);
    fdn.connect(off.destination);
    const impulse = off.createBufferSource();
    const buf = off.createBuffer(1, 1, sr);
    buf.getChannelData(0)[0] = 1;
    impulse.buffer = buf;
    impulse.connect(fdn);
    impulse.start(0);
    const rendered = await off.startRendering();
    const ir = rendered.getChannelData(0);
    for (let i = 0; i < ir.length; i++) if (!Number.isFinite(ir[i])) ir[i] = 0;
    return estimateRT60(ir, sr);
  }
}

// Schroeder 反向积分 + T30 线性拟合
export function estimateRT60(ir, sr) {
  let peakIdx = 0;
  for (let i = 0; i < ir.length; i++) if (Math.abs(ir[i]) > Math.abs(ir[peakIdx])) peakIdx = i;
  const tail = ir.slice(peakIdx);
  let energy = 0;
  const curve = new Float64Array(tail.length);
  for (let i = tail.length - 1; i >= 0; i--) {
    energy += tail[i] * tail[i];
    curve[i] = energy;
  }
  const noiseFloor = (1e-7) ** 2 * tail.length;
  const db = (i) => 10 * Math.log10(Math.max(curve[i], noiseFloor) / curve[0]);
  const pts = [];
  for (let i = 0; i < curve.length; i++) pts.push({ t: i / sr, db: db(i) });
  const fit = (upper, lower) => {
    const sel = pts.filter((p) => p.db <= upper && p.db >= lower && p.db > -70);
    if (sel.length < 50) return null;
    const n = sel.length;
    const mx = sel.reduce((a, p) => a + p.t, 0) / n;
    const my = sel.reduce((a, p) => a + p.db, 0) / n;
    let num = 0, den = 0;
    sel.forEach((p) => { num += (p.t - mx) * (p.db - my); den += (p.t - mx) ** 2; });
    const slope = num / den; // dB / s
    return slope < 0 ? -60 / slope : null;
  };
  const t30 = fit(-5, -35);
  if (t30) return { rt60: t30, method: "T30", peakMs: (peakIdx / sr) * 1000 };
  const t20 = fit(-5, -25);
  if (t20) return { rt60: t20, method: "T20", peakMs: (peakIdx / sr) * 1000 };
  // 衰减极快时自动取可用动态范围（至少 12 dB）外推
  let floorDb = 0;
  for (const p of pts) if (p.t > 0.05 && p.db < floorDb) floorDb = p.db;
  const usableFloor = Math.max(floorDb + 3, -55);
  const span = -2 - usableFloor;
  const fitAny = span >= 12 ? fit(-2, usableFloor) : null;
  return {
    rt60: fitAny ?? 0.1,
    method: fitAny ? `外推(${span.toFixed(0)}dB)` : "兜底",
    peakMs: (peakIdx / sr) * 1000,
  };
}
