/*
 * 栅格测量层：把笔画按给定粗细缩放栅格化为 alpha 网格，
 * 再用连通域分析得到墨象面积、包围盒与“字腔”（被墨象完全包围的背景连通域）。
 * 浏览器环境使用 Canvas；Node 环境使用距离场模拟（无需原生依赖）。
 */
(function (root) {
  'use strict';

  function neighbors8(idx, n) {
    const x = idx % n, y = (idx / n) | 0;
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        out.push(ny * n + nx);
      }
    }
    return out;
  }

  function componentLabel(grid, n) {
    const labels = new Int32Array(n * n).fill(-1);
    const comps = [];
    const stack = [];
    for (let start = 0; start < grid.length; start++) {
      if (grid[start] || labels[start] !== -1) continue;
      const id = comps.length;
      const info = { area: 0, minX: n, minY: n, maxX: -1, maxY: -1, touchesBorder: false };
      comps.push(info);
      labels[start] = id;
      stack.push(start);
      while (stack.length) {
        const idx = stack.pop();
        const x = idx % n, y = (idx / n) | 0;
        info.area++;
        if (x < info.minX) info.minX = x;
        if (x > info.maxX) info.maxX = x;
        if (y < info.minY) info.minY = y;
        if (y > info.maxY) info.maxY = y;
        if (x === 0 || y === 0 || x === n - 1 || y === n - 1) info.touchesBorder = true;
        for (const j of neighbors8(idx, n)) {
          if (!grid[j] && labels[j] === -1) { labels[j] = id; stack.push(j); }
        }
      }
    }
    return { labels, comps };
  }

  function inkComponents(grid, n) {
    let count = 0;
    const seen = new Uint8Array(n * n);
    const stack = [];
    for (let start = 0; start < grid.length; start++) {
      if (!grid[start] || seen[start]) continue;
      count++;
      seen[start] = 1;
      stack.push(start);
      while (stack.length) {
        const idx = stack.pop();
        for (const j of neighbors8(idx, n)) {
          if (seen[j] || !grid[j]) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    return count;
  }

  function analyze(grid, n, cell) {
    const { comps } = componentLabel(grid, n);
    let inkArea = 0;
    let minX = n, minY = n, maxX = -1, maxY = -1;
    for (let i = 0; i < grid.length; i++) {
      if (!grid[i]) continue;
      inkArea++;
      const x = i % n, y = (i / n) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const counters = comps
      .filter((c) => !c.touchesBorder)
      .map((c) => ({ area: c.area * cell * cell }));
    return {
      inkArea: inkArea * cell * cell,
      bbox: { x: minX * cell, y: minY * cell, w: (maxX - minX + 1) * cell, h: (maxY - minY + 1) * cell },
      counters,
      counterCount: counters.length,
      bodyCount: inkComponents(grid, n),
    };
  }

  function createCanvasRasterizer(size) {
    const n = size || 200;
    const cell = 1100 / n; // em=1000，留 5% 边距
    const off = document.createElement('canvas');
    off.width = off.height = n;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    return function rasterize(glyph, scale) {
      ctx.clearRect(0, 0, n, n);
      ctx.fillStyle = '#000';
      ctx.strokeStyle = '#000';
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const k = n / 1100;
      ctx.save();
      ctx.translate(n * 0.0455, n * 0.0455); // 50/1100 偏移
      ctx.scale(k, k);
      for (const s of glyph.strokes) {
        root.Geo.trace2D(ctx, s.d);
        ctx.lineWidth = s.w * scale;
        ctx.stroke();
      }
      ctx.restore();
      const { data } = ctx.getImageData(0, 0, n, n);
      const grid = new Uint8Array(n * n);
      for (let i = 0; i < grid.length; i++) grid[i] = data[i * 4 + 3] > 100 ? 1 : 0;
      return analyze(grid, n, cell);
    };
  }

  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx, qy = ay + t * dy;
    return Math.hypot(px - qx, py - qy);
  }

  // Node 距离场模拟：点到笔画中心线折线的距离 <= 半宽 即视为墨象
  function createMockRasterizer(size) {
    const n = size || 96;
    const cell = 1100 / n;
    return function rasterize(glyph, scale) {
      const segs = [];
      for (const s of glyph.strokes) {
        const half = (s.w * scale) / 2;
        for (const line of root.Geo.flatten(s.d, 10)) {
          for (let i = 0; i < line.length - 1; i++) {
            const a = line[i], b = line[i + 1];
          const margin = half + cell * 0.5;
            segs.push({
              ax: a[0], ay: a[1], bx: b[0], by: b[1], half,
            minX: Math.min(a[0], b[0]) - margin, maxX: Math.max(a[0], b[0]) + margin,
            minY: Math.min(a[1], b[1]) - margin, maxY: Math.max(a[1], b[1]) + margin,
            });
          }
        }
      }
      const grid = new Uint8Array(n * n);
      for (let py = 0; py < n; py++) {
        const emY = 50 + (py + 0.5) * cell;
        for (let px = 0; px < n; px++) {
          const emX = 50 + (px + 0.5) * cell;
          for (const sg of segs) {
            if (emX < sg.minX || emX > sg.maxX || emY < sg.minY || emY > sg.maxY) continue;
            if (segDist(emX, emY, sg.ax, sg.ay, sg.bx, sg.by) <= sg.half + cell * 0.5) {
              grid[py * n + px] = 1;
              break;
            }
          }
        }
      }
      return analyze(grid, n, cell);
    };
  }

  const api = { analyze, createCanvasRasterizer, createMockRasterizer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Raster = api;
})(typeof window !== 'undefined' ? window : globalThis);
