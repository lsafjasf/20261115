// terrain.js — 种子化岛屿地形核心模块（浏览器与 Node 通用，无任何外部依赖）

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeValueNoise(rand) {
  const G = 128;
  const vals = new Float32Array(G * G);
  for (let i = 0; i < vals.length; i++) vals[i] = rand();
  const fade = (t) => t * t * (3 - 2 * t);
  return function noise(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const xi = ((x0 % G) + G) % G, yi = ((y0 % G) + G) % G;
    const x1 = (xi + 1) % G, y1 = (yi + 1) % G;
    const xf = fade(x - x0), yf = fade(y - y0);
    const v00 = vals[yi * G + xi], v10 = vals[yi * G + x1];
    const v01 = vals[y1 * G + xi], v11 = vals[y1 * G + x1];
    return (v00 * (1 - xf) + v10 * xf) * (1 - yf) + (v01 * (1 - xf) + v11 * xf) * yf;
  };
}

export function fbm(noise, x, y, octaves = 4) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

const RADIUS_SAMPLES = 64;
export const CONTROL_POINTS = 16;

export class Island {
  constructor(seed, n = 220) {
    this.seed = seed;
    this.n = n;
    this.noise = makeValueNoise(mulberry32(hashSeed(seed) ^ 0x85ebca6b));
    this.radius = new Float32Array(RADIUS_SAMPLES);
    const shapeNoise = makeValueNoise(mulberry32(hashSeed(seed) ^ 0xc2b2ae35));
    for (let k = 0; k < RADIUS_SAMPLES; k++) {
      const th = (k / RADIUS_SAMPLES) * Math.PI * 2;
      const w = fbm(shapeNoise, Math.cos(th) * 1.6 + 3.1, Math.sin(th) * 1.6 + 8.7, 3);
      this.radius[k] = 0.33 * (0.72 + 0.56 * w);
    }
    this.wetland = null; // {cx, cy, rx, ry, rot} 世界坐标，首次生成后固定
    this.regenerate();
  }

  interpRadius(theta) {
    let t = theta / (Math.PI * 2) * RADIUS_SAMPLES;
    t = ((t % RADIUS_SAMPLES) + RADIUS_SAMPLES) % RADIUS_SAMPLES;
    const k0 = Math.floor(t), k1 = (k0 + 1) % RADIUS_SAMPLES;
    const f = t - k0;
    return this.radius[k0] * (1 - f) + this.radius[k1] * f;
  }

  regenerate() {
    this.computeHeight();
    this.computeFilled();
    this.computeSeaDist();
    this.computeRivers();
    this.computeWetland();
    this.computeVillages();
  }

  computeHeight() {
    const n = this.n;
    const h = (this.h = new Float32Array(n * n));
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) / n, y = (j + 0.5) / n;
        const dx = x - 0.5, dy = y - 0.5;
        const d = Math.hypot(dx, dy);
        let th = Math.atan2(dy, dx);
        if (th < 0) th += Math.PI * 2;
        const r = this.interpRadius(th);
        const t = 1 - d / r;
        const relief = fbm(this.noise, x * 6 + 11.3, y * 6 + 4.7, 4) - 0.5;
        const m = smoothstep(-0.3, 0.35, t);
        h[j * n + i] = t * 0.85 + relief * 0.65 * m;
      }
    }
  }

  // 优先泛洪（priority-flood）填洼：保证每个陆地格都有通往海洋的下降路径
  computeFilled() {
    const n = this.n, h = this.h;
    const filled = (this.filled = new Float32Array(n * n));
    const seen = new Uint8Array(n * n);
    const heapIdx = [], heapKey = [];
    const push = (idx, key) => {
      heapIdx.push(idx); heapKey.push(key);
      let c = heapIdx.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (heapKey[p] <= heapKey[c]) break;
        [heapKey[p], heapKey[c]] = [heapKey[c], heapKey[p]];
        [heapIdx[p], heapIdx[c]] = [heapIdx[c], heapIdx[p]];
        c = p;
      }
    };
    const pop = () => {
      const top = heapIdx[0], lastK = heapKey.pop(), lastI = heapIdx.pop();
      if (heapIdx.length) {
        heapIdx[0] = lastI; heapKey[0] = lastK;
        let p = 0;
        for (;;) {
          let c = p * 2 + 1;
          if (c + 1 < heapIdx.length && heapKey[c + 1] < heapKey[c]) c++;
          if (c >= heapIdx.length || heapKey[c] >= heapKey[p]) break;
          [heapKey[p], heapKey[c]] = [heapKey[c], heapKey[p]];
          [heapIdx[p], heapIdx[c]] = [heapIdx[c], heapIdx[p]];
          p = c;
        }
      }
      return top;
    };
    for (let idx = 0; idx < n * n; idx++) {
      if (h[idx] <= 0) { filled[idx] = h[idx]; seen[idx] = 1; push(idx, h[idx]); }
    }
    const EPS = 1e-3;
    while (heapIdx.length) {
      const cur = pop();
      const ci = cur % n, cj = (cur / n) | 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          const nx = j * n + i;
          if (seen[nx]) continue;
          seen[nx] = 1;
          const f = Math.max(h[nx], filled[cur] + EPS);
          filled[nx] = f;
          push(nx, f);
        }
      }
    }
  }

  // 距海格数（4 连通 BFS），供村落/湿地选址使用
  computeSeaDist() {
    const n = this.n, h = this.h;
    const dist = (this.seaDist = new Int16Array(n * n).fill(-1));
    const queue = [];
    for (let idx = 0; idx < n * n; idx++) {
      if (h[idx] <= 0) { dist[idx] = 0; queue.push(idx); }
    }
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const ci = cur % n, cj = (cur / n) | 0;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [di, dj] of nb) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const nx = j * n + i;
        if (dist[nx] >= 0) continue;
        dist[nx] = dist[cur] + 1;
        queue.push(nx);
      }
    }
  }
  // 三条河流：从高地局部极值出发，沿填洼面最陡下降方向溯源，必达海岸
  computeRivers() {
    const n = this.n, h = this.h, filled = this.filled;
    const flowTo = (this.flowTo = new Int32Array(n * n).fill(-1));
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        if (h[idx] <= 0) continue;
        let best = -1, bestVal = filled[idx];
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const x = i + di, y = j + dj;
            if (x < 0 || y < 0 || x >= n || y >= n) continue;
            const nx = y * n + x;
            if (filled[nx] < bestVal) { bestVal = filled[nx]; best = nx; }
          }
        }
        flowTo[idx] = best;
      }
    }
    // 候选河源：高地局部极大值，按高程排序（确定性）；间距/高程阈值自适应放宽
    const thresholds = [0.4, 0.25, 0.12, 0.02];
    const spacings = [0.22, 0.15, 0.08];
    let sources = [];
    outer:
    for (const sp of spacings) {
      for (const th of thresholds) {
        const cands = [];
        for (let j = 1; j < n - 1; j++) {
          for (let i = 1; i < n - 1; i++) {
            const idx = j * n + i;
            if (h[idx] < th) continue;
            let isMax = true;
            for (let dj = -1; dj <= 1 && isMax; dj++) {
              for (let di = -1; di <= 1; di++) {
                if (!di && !dj) continue;
                if (h[idx] < h[(j + dj) * n + (i + di)]) { isMax = false; break; }
              }
            }
            if (isMax) cands.push(idx);
          }
        }
        cands.sort((a, b) => h[b] - h[a] || a - b);
        const picked = [];
        const minDist = n * sp;
        for (const idx of cands) {
          if (picked.length >= 3) break;
          const i = idx % n, j = (idx / n) | 0;
          let ok = true;
          for (const s of picked) {
            const si = s % n, sj = (s / n) | 0;
            if (Math.hypot(i - si, j - sj) < minDist) { ok = false; break; }
          }
          if (ok) picked.push(idx);
        }
        if (picked.length > sources.length) sources = picked;
        if (sources.length >= 3) break outer;
      }
    }
    this.rivers = [];
    this.riverCells = new Set();
    for (const src of sources.slice(0, 3)) {
      const path = [];
      const visited = new Set();
      let cur = src;
      while (cur >= 0 && !visited.has(cur) && path.length < n * 4) {
        path.push(cur);
        visited.add(cur);
        if (h[cur] <= 0) break;
        if (h[cur] > 0) this.riverCells.add(cur);
        cur = flowTo[cur];
      }
      this.rivers.push(path);
    }
  }

  // 禁入湿地：低平内陆椭圆区域；改边后若陆地覆盖率过低则确定性地重新选址
  selectWetlandSite(maxR) {
    const n = this.n, h = this.h;
    const rand = mulberry32(hashSeed(this.seed) ^ 0x5bd1e995);
    const need = Math.max(4, Math.ceil(maxR * n) + 2);
    for (const minDist of [need, 6, 3]) {
      let best = -1, bestScore = -1;
      for (let j = 2; j < n - 2; j++) {
        for (let i = 2; i < n - 2; i++) {
          const idx = j * n + i;
          if (h[idx] < 0.02 || h[idx] > 0.25) continue;
          if (this.seaDist[idx] < minDist) continue;
          let flat = 0;
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++)
              flat = Math.max(flat, Math.abs(h[idx] - h[(j + dj) * n + (i + di)]));
          const score = (1 - flat * 20) + rand() * 0.15;
          if (score > bestScore) { bestScore = score; best = idx; }
        }
      }
      if (best >= 0) return { cx: ((best % n) + 0.5) / n, cy: (((best / n) | 0) + 0.5) / n };
    }
    const idx = this.nearestLandIndex(n / 2, n / 2);
    return { cx: ((idx % n) + 0.5) / n, cy: (((idx / n) | 0) + 0.5) / n };
  }

  computeWetland() {
    const n = this.n, h = this.h;
    if (!this.wetland) {
      const rand = mulberry32(hashSeed(this.seed) ^ 0x165667b1);
      const rx = 0.05 + rand() * 0.035, ry = 0.04 + rand() * 0.03, rot = rand() * Math.PI;
      const site = this.selectWetlandSite(Math.max(rx, ry));
      this.wetland = { cx: site.cx, cy: site.cy, rx, ry, rot };
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const w = this.wetland;
      const mask = (this.wetlandMask = new Uint8Array(n * n));
      const cosR = Math.cos(w.rot), sinR = Math.sin(w.rot);
      let landCount = 0, total = 0;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const x = (i + 0.5) / n - w.cx, y = (j + 0.5) / n - w.cy;
          const lx = x * cosR + y * sinR, ly = -x * sinR + y * cosR;
          const e = (lx * lx) / (w.rx * w.rx) + (ly * ly) / (w.ry * w.ry);
          if (e <= 1) {
            total++;
            if (h[j * n + i] > 0) { mask[j * n + i] = 1; landCount++; }
          }
        }
      }
      if (total > 0 && landCount / total >= 0.6) return;
      const site = this.selectWetlandSite(Math.max(w.rx, w.ry));
      w.cx = site.cx;
      w.cy = site.cy;
    }
  }

  nearestLandIndex(i, j) {
    const n = this.n, h = this.h;
    let best = -1, bestD = Infinity;
    for (let idx = 0; idx < n * n; idx++) {
      if (h[idx] <= 0) continue;
      const di = (idx % n) - i, dj = ((idx / n) | 0) - j;
      const d = di * di + dj * dj;
      if (d < bestD) { bestD = d; best = idx; }
    }
    return best;
  }

  // 村落：陆地上、坡度小、离海/河流/湿地保持距离的确定性选址
  computeVillages() {
    const n = this.n, h = this.h;
    const rand = mulberry32(hashSeed(this.seed) ^ 0x9e3779b9);
    const cands = [];
    for (let j = 3; j < n - 3; j++) {
      for (let i = 3; i < n - 3; i++) {
        const idx = j * n + i;
        if (h[idx] < 0.05 || h[idx] > 0.4) continue;
        if (this.seaDist[idx] < 3) continue;
        if (this.wetlandMask[idx]) continue;
        let slope = 0, nearRiver = false;
        for (let dj = -3; dj <= 3 && !nearRiver; dj++) {
          for (let di = -3; di <= 3; di++) {
            const x = i + di, y = j + dj;
            if (x < 0 || y < 0 || x >= n || y >= n) continue;
            if (Math.abs(di) <= 1 && Math.abs(dj) <= 1)
              slope = Math.max(slope, Math.abs(h[idx] - h[y * n + x]));
            if (this.riverCells.has(y * n + x)) nearRiver = true;
          }
        }
        if (nearRiver || slope > 0.12) continue;
        cands.push(idx);
      }
    }
    for (let i = cands.length - 1; i > 0; i--) {
      const k = Math.floor(rand() * (i + 1));
      [cands[i], cands[k]] = [cands[k], cands[i]];
    }
    this.villages = [];
    const minDist = n * 0.14;
    for (const idx of cands) {
      if (this.villages.length >= 5) break;
      const i = idx % n, j = (idx / n) | 0;
      let ok = true;
      for (const v of this.villages) {
        if (Math.hypot(i - v.i, j - v.j) < minDist) { ok = false; break; }
      }
      if (ok) this.villages.push({ i, j, x: (i + 0.5) / n, y: (j + 0.5) / n });
    }
  }
  sampleHeight(x, y) {
    const n = this.n;
    const fx = x * n - 0.5, fy = y * n - 0.5;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(fx)));
    const j0 = Math.max(0, Math.min(n - 1, Math.floor(fy)));
    const i1 = Math.min(n - 1, i0 + 1), j1 = Math.min(n - 1, j0 + 1);
    const tx = Math.min(1, Math.max(0, fx - i0)), ty = Math.min(1, Math.max(0, fy - j0));
    const a = this.h[j0 * n + i0], b = this.h[j0 * n + i1];
    const c = this.h[j1 * n + i0], d = this.h[j1 * n + i1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  // 沿射线求海岸线半径（世界坐标，相对中心 0.5,0.5）
  coastRadius(theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    let prev = this.sampleHeight(0.5 + c * 0.02, 0.5 + s * 0.02);
    for (let t = 0.024; t <= 0.5; t += 0.003) {
      const v = this.sampleHeight(0.5 + c * t, 0.5 + s * t);
      if (prev > 0 && v <= 0) {
        const f = prev / (prev - v);
        return t - 0.003 + 0.003 * f;
      }
      prev = v;
    }
    return 0.5;
  }

  getControlPoints(count = CONTROL_POINTS) {
    const pts = [];
    for (let m = 0; m < count; m++) {
      const theta = (m / count) * Math.PI * 2;
      const r = this.coastRadius(theta);
      pts.push({ index: m, theta, r, x: 0.5 + Math.cos(theta) * r, y: 0.5 + Math.sin(theta) * r });
    }
    return pts;
  }

  // 用户拖动边界：把径向形变平滑地写回半径场，再整体重算（水系自动回流入海）
  applyBoundaryEdit(pointIndex, newRadius, count = CONTROL_POINTS) {
    const theta = (pointIndex / count) * Math.PI * 2;
    const oldR = this.coastRadius(theta);
    const delta = newRadius - oldR;
    const sigma = ((Math.PI * 2) / count) * 1.1;
    for (let k = 0; k < RADIUS_SAMPLES; k++) {
      const th = (k / RADIUS_SAMPLES) * Math.PI * 2;
      const w = Math.exp(-(angDiff(th, theta) ** 2) / (2 * sigma * sigma));
      this.radius[k] = Math.min(0.47, Math.max(0.1, this.radius[k] + delta * w));
    }
    this.regenerate();
  }

  checksum() {
    let acc = 0;
    for (let i = 0; i < this.h.length; i += 7)
      acc = (acc + Math.round(this.h[i] * 1e6) * (i + 1)) % 1000000007;
    return acc.toString(16);
  }
}

// 等高线提取：marching squares，返回世界坐标线段 [x1,y1,x2,y2]
export function marchingSquares(f, n, level) {
  const segs = [];
  const px = (i) => i / (n - 1);
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = f[j * n + i], b = f[j * n + i + 1];
      const c = f[(j + 1) * n + i + 1], d = f[(j + 1) * n + i];
      let idx = 0;
      if (a > level) idx |= 8;
      if (b > level) idx |= 4;
      if (c > level) idx |= 2;
      if (d > level) idx |= 1;
      if (idx === 0 || idx === 15) continue;
      const lerp = (v0, v1) => (level - v0) / (v1 - v0);
      const top = [px(i + lerp(a, b)), px(j)];
      const right = [px(i + 1), px(j + lerp(b, c))];
      const bottom = [px(i + lerp(d, c)), px(j + 1)];
      const left = [px(i), px(j + lerp(a, d))];
      const seg = (p, q) => segs.push([p[0], p[1], q[0], q[1]]);
      switch (idx) {
        case 1: case 14: seg(left, bottom); break;
        case 2: case 13: seg(bottom, right); break;
        case 3: case 12: seg(left, right); break;
        case 4: case 11: seg(top, right); break;
        case 5: seg(top, left); seg(bottom, right); break;
        case 6: case 9: seg(top, bottom); break;
        case 7: case 8: seg(top, left); break;
        case 10: seg(top, right); seg(left, bottom); break;
      }
    }
  }
  return segs;
}

// 把离散线段按端点串成折线（用于 SVG 路径与海岸线绘制）
export function chainSegments(segs) {
  const key = (x, y) => `${x.toFixed(4)},${y.toFixed(4)}`;
  const adj = new Map();
  segs.forEach((s, i) => {
    for (const [x, y] of [[s[0], s[1]], [s[2], s[3]]]) {
      const k = key(x, y);
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k).push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const lines = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const line = [[segs[s0][0], segs[s0][1]], [segs[s0][2], segs[s0][3]]];
    for (let end = 0; end < 2; end++) {
      for (;;) {
        const tip = line[end === 0 ? line.length - 1 : 0];
        const cands = adj.get(key(tip[0], tip[1])) || [];
        let next = -1;
        for (const ci of cands) if (!used[ci]) { next = ci; break; }
        if (next < 0) break;
        used[next] = 1;
        const s = segs[next];
        const tail = key(s[0], s[1]) === key(tip[0], tip[1]) ? [s[2], s[3]] : [s[0], s[1]];
        if (end === 0) line.push(tail); else line.unshift(tail);
      }
    }
    lines.push(line);
  }
  return lines;
}
