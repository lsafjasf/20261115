// 字幕避让引擎：候选位搜索 + 碰撞检测 + 无解回退建议
// 与 UI 解耦，浏览器和 Node 均可加载。
(function (root, factory) {
  const engine = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = engine;
  else root.AvoidEngine = engine;
})(typeof self !== "undefined" ? self : this, function () {
  function normToPx(r, W, H) {
    return { x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H };
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function overlapArea(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function insideSafe(rect, safe) {
    return (
      rect.x >= safe.x - 0.5 &&
      rect.y >= safe.y - 0.5 &&
      rect.x + rect.w <= safe.x + safe.w + 0.5 &&
      rect.y + rect.h <= safe.y + safe.h + 0.5
    );
  }

  // 取 t 时刻所有活动障碍物的像素矩形
  function activeObstacles(obstacles, t, W, H) {
    const out = [];
    for (const ob of obstacles) {
      if (t < ob.t0 || t > ob.t1) continue;
      const r = typeof ob.rect === "function" ? ob.rect(t) : ob.rect;
      out.push({ id: ob.id, type: ob.type, label: ob.label, rect: normToPx(r, W, H) });
    }
    return out;
  }

  // 生成候选锚点（字幕中心，像素）：安全区内 3 列 x 6 行
  function candidateAnchors(safePx) {
    const cols = [0.25, 0.5, 0.75];
    const rows = [0.9, 0.76, 0.62, 0.48, 0.34, 0.2];
    const pts = [];
    for (const ry of rows) {
      for (const cx of cols) {
        pts.push({ x: safePx.x + safePx.w * cx, y: safePx.y + safePx.h * ry });
      }
    }
    return pts;
  }

  function rectFromAnchor(anchor, size) {
    return { x: anchor.x - size.w / 2, y: anchor.y - size.h / 2, w: size.w, h: size.h };
  }

  // 在 blockers（像素矩形数组）中寻找可行位置。
  // 返回 { x, y, rect, avoided, score } 或 null（无可行位）。
  function findPlacement(opts) {
    const { size, blockers, safe, W, H, preferred } = opts;
    const pref = { x: preferred.x * W, y: preferred.y * H };
    // 理想位置本身是否可行（用于标记“自动避让”）
    const prefRect = rectFromAnchor(pref, size);
    const prefBlocked =
      !insideSafe(prefRect, safe) ||
      blockers.some((b) => overlapArea(prefRect, b.rect || b) > 0);
    let best = null;
    for (const anchor of candidateAnchors(safe)) {
      const rect = rectFromAnchor(anchor, size);
      if (!insideSafe(rect, safe)) continue;
      let overlap = 0;
      for (const b of blockers) overlap += overlapArea(rect, b.rect || b);
      if (overlap > 0) continue; // 严格不碰撞
      const dist = Math.hypot(anchor.x - pref.x, anchor.y - pref.y);
      const score = dist;
      if (!best || score < best.score) best = { x: anchor.x, y: anchor.y, rect, score };
    }
    if (!best) return null;
    best.avoided = prefBlocked;
    return best;
  }

  // 无解时的回退建议：缩小字号 / 延长显示（利用障碍物消失后的尾部窗口）
  // 返回建议数组，每项 { kind: 'shrink', fontSize } 或 { kind: 'extend', start, end }
  function fallbackSuggestions(opts) {
    const { text, fontSize, start, end, measure, makeBlockers } = opts;
    const out = [];
    // 1) 缩小字号：原窗口内重试
    for (const scale of [0.85, 0.7, 0.55]) {
      const fs = Math.round(fontSize * scale);
      const p = findPlacement({ ...opts, size: measure(text, fs) });
      if (p) {
        out.push({ kind: "shrink", fontSize: fs, placement: p });
        break;
      }
    }
    // 2) 延长显示：窗口延长到 end+dt，在尾部子窗口 [ts, end+dt] 找可行位置
    const dur = end - start;
    for (const dt of [1, 2, 3]) {
      const newEnd = end + dt;
      let found = null;
      for (let ts = start; ts <= newEnd - dur * 0.8 + 1e-6; ts += 0.25) {
        const blockers = makeBlockers(ts, newEnd);
        const p = findPlacement({ ...opts, size: measure(text, fontSize), blockers });
        if (p) {
          found = { kind: "extend", start: ts, end: newEnd, placement: p };
          break;
        }
      }
      if (found) {
        out.push(found);
        break;
      }
    }
    return out;
  }

  // 整窗布局：按优先级从高到低放置全部字幕。
  // 只有时间段相交的字幕才互相阻挡。结果写回 sub.pos / sub._rect / sub._avoided 等。
  // opts: { measure, safe, W, H, preferred, onStuck(sub) }
  function layoutSubtitles(subtitles, obstacles, opts) {
    const { measure, safe, W, H, preferred, onStuck } = opts;
    const sorted = [...subtitles].sort((a, b) => b.priority - a.priority);
    const placed = [];
    for (const sub of sorted) {
      const size = measure(sub.text, sub.fontSize);
      sub._size = size;
      const others = placed
        .filter((p) => p.sub.start <= sub.end && p.sub.end >= sub.start)
        .map((p) => p.rect);
      const blockers = [];
      for (let t = sub.start; t <= sub.end + 1e-6; t += 0.25) {
        for (const ob of activeObstacles(obstacles, t, W, H)) blockers.push(ob);
      }
      for (const r of others) blockers.push({ rect: r, type: "sub" });
      if (sub.manual && sub.pos) {
        const rect = rectFromAnchor({ x: sub.pos.x * W, y: sub.pos.y * H }, size);
        sub._rect = rect;
        sub._collides = blockers.some((b) => rectsOverlap(rect, b.rect));
        sub._avoided = false;
        sub._stuck = false;
        placed.push({ sub, rect });
        continue;
      }
      const p = findPlacement({ size, blockers, safe, W, H, preferred });
      if (p) {
        sub.pos = { x: p.x / W, y: p.y / H };
        sub._rect = p.rect;
        sub._avoided = p.avoided;
        sub._collides = false;
        sub._stuck = false;
      } else {
        sub.pos = { x: preferred.x, y: preferred.y };
        sub._rect = rectFromAnchor({ x: preferred.x * W, y: preferred.y * H }, size);
        sub._collides = true;
        sub._stuck = true;
        if (onStuck) onStuck(sub);
      }
      placed.push({ sub, rect: sub._rect });
    }
    return subtitles;
  }

  return { normToPx, rectsOverlap, overlapArea, insideSafe, activeObstacles, candidateAnchors, rectFromAnchor, findPlacement, fallbackSuggestions, layoutSubtitles };
});
