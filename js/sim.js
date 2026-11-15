/*
 * 确定性水力侵蚀模拟核心。
 * 纯逻辑模块：浏览器（window.ErosionSim）与 Node（module.exports）均可使用。
 * 所有迭代顺序固定、随机数来自种子化 PRNG，保证同 seed 完全可复现。
 */
(function (global) {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 基于哈希的格点值噪声（无需存储排列表，天然确定性）
  function hash2(ix, iy, seed) {
    let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  function valueNoise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  function fbm(x, y, seed, octaves) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * valueNoise(x * freq, y * freq, seed + o * 101);
      norm += amp;
      amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }

  const DEFAULTS = {
    size: 128,
    seed: 20261115,
    globalRain: 0.002,     // 全局小雨，保证默认也有水系
    evaporation: 0.05,
    flowRate: 0.5,         // 每步最大下泄比例
    capacityK: 6.0,        // 挟沙能力系数
    erosionRate: 0.35,
    depositionRate: 0.35,
    minSlope: 1e-4,
    fluxDecay: 0.92,       // 河道通量平滑系数
    riverQuantile: 0.97,   // 河道判定：通量分位数阈值
  };
  class ErosionSim {
    constructor(options) {
      const opts = Object.assign({}, DEFAULTS, options || {});
      this.opts = opts;
      this.size = opts.size;
      this.seed = opts.seed;
      const n = this.size * this.size;
      this.height = new Float32Array(n);
      this.water = new Float32Array(n);
      this.sediment = new Float32Array(n);   // 水中悬移质
      this.hardness = new Float32Array(n);   // 0 软 ~ 1 硬
      this.flux = new Float32Array(n);       // 平滑汇流量（河道显示/统计）
      this.accum = new Float32Array(n);      // 本步汇流累积量
      this.rainInput = new Float32Array(n);  // 本步降雨输入
      this.deposit = new Float32Array(n);    // 净堆积量（沉积区显示）
      this.rainZones = [];                   // {x, y, r, intensity}
      this.stepCount = 0;
      this._order = new Int32Array(n);
      this.initial = new Float32Array(n);    // 初始地形快照（侵蚀/沉积量统计）
      this._generateTerrain();
    }

    _generateTerrain() {
      const n = this.size;
      const rng = mulberry32(this.seed);
      const bumpCx = 0.35 + rng() * 0.3, bumpCy = 0.35 + rng() * 0.3;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const u = x / n, v = y / n;
          let h = fbm(u * 6, v * 6, this.seed, 5);
          h = Math.pow(h, 1.6);
          const dx = u - bumpCx, dy = v - bumpCy;
          const bump = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2.2);
          h = h * 0.75 + bump * bump * 0.45;
          this.height[i] = h;
          this.initial[i] = h;
          // 岩层硬度：随高度分层（层理）+ 噪声扰动
          const strata = 0.5 + 0.35 * Math.sin(h * 28 + this.seed % 7);
          const jitter = valueNoise(u * 9, v * 9, this.seed + 999) * 0.2;
          this.hardness[i] = Math.min(1, Math.max(0.05, strata * 0.6 + jitter + 0.15));
        }
      }
    }

    /** 重置到初始 seed 状态：地形、硬度、降雨区全部还原 */
    reset() {
      this.height.fill(0); this.water.fill(0); this.sediment.fill(0);
      this.flux.fill(0); this.deposit.fill(0);
      this.accum.fill(0); this.rainInput.fill(0);
      this.rainZones.length = 0;
      this.stepCount = 0;
      this._generateTerrain();
    }

    addRainZone(x, y, r, intensity) {
      this.rainZones.push({ x, y, r, intensity });
    }

    clearRainZones() { this.rainZones.length = 0; }

    /** 画笔修改岩层硬度（向目标值靠拢） */
    paintHardness(x, y, r, value, strength) {
      const n = this.size, s = strength == null ? 0.5 : strength;
      const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(n - 1, Math.ceil(x + r));
      const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(n - 1, Math.ceil(y + r));
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const d = Math.hypot(xx - x, yy - y);
          if (d > r) continue;
          const w = (1 - d / r) * s;
          const i = yy * n + xx;
          const v = this.hardness[i] + (value - this.hardness[i]) * w;
          this.hardness[i] = Math.min(1, Math.max(0.05, v));
        }
      }
    }
    _applyRain(rainScale) {
      const n = this.size, g = this.opts.globalRain * rainScale;
      this.rainInput.fill(0);
      if (g > 0) for (let i = 0; i < n * n; i++) { this.water[i] += g; this.rainInput[i] += g; }
      for (const z of this.rainZones) {
        const x0 = Math.max(0, Math.floor(z.x - z.r)), x1 = Math.min(n - 1, Math.ceil(z.x + z.r));
        const y0 = Math.max(0, Math.floor(z.y - z.r)), y1 = Math.min(n - 1, Math.ceil(z.y + z.r));
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            const d = Math.hypot(xx - z.x, yy - z.y);
            if (d > z.r) continue;
            const add = z.intensity * rainScale * (1 - d / z.r);
            this.water[yy * n + xx] += add;
            this.rainInput[yy * n + xx] += add;
          }
        }
      }
    }

    /** 推进一步。rainScale 为降雨强度倍率（对比两种强度时传入）。 */
    step(rainScale) {
      const n = this.size, o = this.opts;
      const rs = rainScale == null ? 1 : rainScale;
      this._applyRain(rs);

      // 按总高度（地形+水）降序处理，水只往低处流 —— 河道连续且不会穿山
      const order = this._order;
      for (let i = 0; i < n * n; i++) order[i] = i;
      const H = this.height, W = this.water, S = this.sediment, HD = this.hardness;
      const AC = this.accum;
      AC.set(this.rainInput);
      order.sort((a, b) => ((H[b] + W[b]) - (H[a] + W[a])) || (a - b));

      for (let k = 0; k < order.length; k++) {
        const i = order[k];
        const w = W[i];
        if (w <= 1e-6) continue;
        const x = i % n, y = (i / n) | 0;
        // 找总高度最低的 4 邻居
        let lowest = -1, lowestTotal = H[i] + W[i];
        if (x > 0)     { const j = i - 1, t = H[j] + W[j]; if (t < lowestTotal) { lowestTotal = t; lowest = j; } }
        if (x < n - 1) { const j = i + 1, t = H[j] + W[j]; if (t < lowestTotal) { lowestTotal = t; lowest = j; } }
        if (y > 0)     { const j = i - n, t = H[j] + W[j]; if (t < lowestTotal) { lowestTotal = t; lowest = j; } }
        if (y < n - 1) { const j = i + n, t = H[j] + W[j]; if (t < lowestTotal) { lowestTotal = t; lowest = j; } }

        const slope = Math.max(o.minSlope, (H[i] + W[i]) - lowestTotal);
        // 挟沙能力：与坡度、水量正相关
        const capacity = o.capacityK * slope * w;
        if (capacity > S[i]) {
          // 侵蚀：软岩快、硬岩慢
          const amount = Math.min((capacity - S[i]) * o.erosionRate * (1 - HD[i] * 0.9), H[i] * 0.5);
          H[i] -= amount; S[i] += amount;
          this.deposit[i] = Math.max(0, this.deposit[i] - amount * 0.5);
        } else {
          // 沉积：低洼/缓坡处堆积
          const amount = (S[i] - capacity) * o.depositionRate;
          H[i] += amount; S[i] -= amount;
          this.deposit[i] += amount;
        }

        if (lowest >= 0) {
          const flow = Math.min(W[i], slope * o.flowRate);
          if (flow > 0) {
            const ratio = flow / W[i];
            W[i] -= flow; W[lowest] += flow;
            const sMove = S[i] * ratio;
            S[i] -= sMove; S[lowest] += sMove;
            AC[lowest] += AC[i]; // 汇流累积：上游来水叠加到下游
          }
        }
        this.flux[i] = this.flux[i] * o.fluxDecay + AC[i];
      }

      // 蒸发；水干时悬移质落淤
      const keep = 1 - o.evaporation;
      for (let i = 0; i < n * n; i++) {
        W[i] *= keep;
        if (W[i] < 1e-5) { H[i] += S[i]; this.deposit[i] += S[i]; S[i] = 0; W[i] = 0; }
      }
      this.stepCount++;
    }
    /** 河道判定的自适应阈值：通量的高分位值（无水流时退化为绝对小量） */
    riverThresholdValue() {
      const n = this.size * this.size;
      const sample = [];
      const stride = Math.max(1, Math.floor(n / 4096));
      for (let i = 0; i < n; i += stride) sample.push(this.flux[i]);
      sample.sort((a, b) => a - b);
      const q = sample[Math.floor(this.opts.riverQuantile * (sample.length - 1))];
      return Math.max(q, 1e-4);
    }

    /**
     * 主河道：从每个河道格出发沿最陡方向游走（允许穿越静水平面，
     * 但绝不爬坡），取最长路径。相邻步必为 8 邻域 —— 连续且不会穿山。
     */
    traceMainRiver() {
      const n = this.size;
      const H = this.height, W = this.water;
      const thr = this.riverThresholdValue();
      const cells = [];
      for (let i = 0; i < n * n; i++) if (this.flux[i] >= thr) cells.push(i);
      if (!cells.length) return [];
      const visited = new Set();
      let bestPath = [];
      for (const start of cells) {
        visited.clear();
        const path = [];
        let cur = start;
        for (let guard = 0; guard < n * n; guard++) {
          path.push(cur); visited.add(cur);
          const x = cur % n, y = (cur / n) | 0;
          const curTotal = H[cur] + W[cur];
          let next = -1, nextTotal = Infinity;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
              const j = ny * n + nx;
              if (visited.has(j)) continue;
              const t = H[j] + W[j];
              if (t < nextTotal) { nextTotal = t; next = j; }
            }
          }
          // 只允许持平或下坡（静水面上继续穿行），绝不爬坡穿山
          if (next < 0 || nextTotal > curTotal + 1e-9) break;
          cur = next;
          if (cur % n === 0 || cur % n === n - 1) { path.push(cur); break; }
          const cy = (cur / n) | 0;
          if (cy === 0 || cy === n - 1) { path.push(cur); break; }
        }
        if (path.length > bestPath.length) bestPath = path;
      }
      return bestPath;
    }

    /** 统计：最高点、最低点、河道格数与主河道长度（格） */
    computeStats() {
      const n = this.size;
      const thr = this.riverThresholdValue();
      let maxH = -Infinity, minH = Infinity, maxI = 0, minI = 0, riverCells = 0;
      for (let i = 0; i < n * n; i++) {
        const h = this.height[i];
        if (h > maxH) { maxH = h; maxI = i; }
        if (h < minH) { minH = h; minI = i; }
        if (this.flux[i] >= thr) riverCells++;
      }
      const river = this.traceMainRiver();
      let eroded = 0, deposited = 0;
      for (let i = 0; i < n * n; i++) {
        const d = this.initial[i] - this.height[i];
        if (d > 0) eroded += d; else deposited -= d;
      }
      return {
        step: this.stepCount,
        maxHeight: maxH, maxPos: { x: maxI % n, y: (maxI / n) | 0 },
        minHeight: minH, minPos: { x: minI % n, y: (minI / n) | 0 },
        riverCells: riverCells,
        riverLength: river.length,
        riverPath: river,
        erodedVolume: eroded,
        depositedVolume: deposited,
      };
    }

    /** 取第 row 行的剖面（高程与水位），供剖面图绘制 */
    profile(row) {
      const n = this.size;
      const r = Math.max(0, Math.min(n - 1, row | 0));
      const hs = new Float32Array(n), ws = new Float32Array(n);
      for (let x = 0; x < n; x++) {
        hs[x] = this.height[r * n + x];
        ws[x] = this.water[r * n + x];
      }
      return { row: r, height: hs, water: ws };
    }
  }

  const api = { ErosionSim: ErosionSim, mulberry32: mulberry32, DEFAULTS: DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ErosionSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
