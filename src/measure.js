/*
 * 字腔自适应引擎：
 * 1) 在基准粗细下测量字腔（背景封闭连通域）数量与面积；
 * 2) 对目标粗细做二分搜索，约束：
 *    - 字腔数量不得减少（吞腔检测）
 *    - 每个字腔面积不得低于基准的 35%（抗吞腔）
 *    - 墨象连通块数量不得增加（相邻笔画粘连检测）
 *    - 笔画不得细于 18/1000 em（抗锯齿粘连/断线）
 */
(function (root) {
  'use strict';

  const MIN_COUNTER_RATIO = 0.35;
  const MIN_STROKE = 18;

  function createMeasurer(rasterize) {
    const cache = new Map();

    function baseMetrics(glyph) {
      if (cache.has(glyph.id)) return cache.get(glyph.id);
      const m = rasterize(glyph, 1);
      cache.set(glyph.id, m);
      return m;
    }

    function safe(glyph, base, scale) {
      if (glyph.strokes.some((s) => s.w * scale < MIN_STROKE)) return false;
      const m = rasterize(glyph, scale);
      if (m.counterCount < base.counterCount) return false;
      // 墨象连通块增多意味着原本相离的笔画被粘连（变细导致的减少属于正常）
      if (m.bodyCount > base.bodyCount) return false;
      const baseSorted = base.counters.map((c) => c.area).sort((a, b) => b - a);
      const nowSorted = m.counters.map((c) => c.area).sort((a, b) => b - a);
      for (let i = 0; i < baseSorted.length; i++) {
        if (nowSorted[i] < baseSorted[i] * MIN_COUNTER_RATIO) return false;
      }
      return true;
    }

    function resolve(glyph, targetScale) {
      const base = baseMetrics(glyph);
      const minW = Math.min(...glyph.strokes.map((s) => s.w));
      const floor = Math.max(MIN_STROKE / minW, 0.05);

      // 目标本身安全：直接采用
      if (safe(glyph, base, targetScale)) {
        return { scale: targetScale, clamped: false, base, metrics: rasterize(glyph, targetScale) };
      }

      // 目标不安全：在安全区间内二分最大安全粗细。
      // scale=1（基准）恒安全；下限仅用于满足最小笔画宽度。
      let lo = safe(glyph, base, floor) ? floor : 1;
      let hi = targetScale;
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        if (safe(glyph, base, mid)) lo = mid;
        else hi = mid;
      }
      const finalScale = lo;
      return {
        scale: finalScale,
        clamped: finalScale < targetScale - 0.02,
        base,
        metrics: rasterize(glyph, finalScale),
      };
    }

    return { resolve, baseMetrics, _cache: cache };
  }

  const api = { createMeasurer, MIN_COUNTER_RATIO, MIN_STROKE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Measure = api;
})(typeof window !== 'undefined' ? window : globalThis);
