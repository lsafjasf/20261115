/*
 * 路径 DSL：所有字形都由若干“笔画”组成，每条笔画是一条开放/闭合路径 + 基准宽度。
 * 坐标统一在 1000 单位的 em 方框内（基线 y=800，字面区约 y=120..800）。
 * 命令：['M',x,y] ['L',x,y] ['Q',cx,cy,x,y] ['C',c1x,c1y,c2x,c2y,x,y] ['Z']
 */
(function (root) {
  'use strict';

  const M = (x, y) => ['M', x, y];
  const L = (x, y) => ['L', x, y];
  const Q = (cx, cy, x, y) => ['Q', cx, cy, x, y];
  const C = (c1x, c1y, c2x, c2y, x, y) => ['C', c1x, c1y, c2x, c2y, x, y];
  const Z = () => ['Z'];

  function stroke(d, w) { return { d, w }; }

  function line(x1, y1, x2, y2, w) {
    return stroke([M(x1, y1), L(x2, y2)], w);
  }

  function poly(points, w, close = false) {
    const d = [M(points[0][0], points[0][1])];
    for (let i = 1; i < points.length; i++) d.push(L(points[i][0], points[i][1]));
    if (close) d.push(Z());
    return stroke(d, w);
  }

  // 矩形的“中心线”闭合路径（圆角由渲染期 roundness 控制）
  function rectStroke(x, y, w, h, sw) {
    return poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], sw, true);
  }

  // 椭圆中心线（用 4 段三次贝塞尔近似，k = 0.5523）
  function ellipseStroke(cx, cy, rx, ry, w, rot = 0) {
    const k = 0.5523;
    const d = [
      M(cx + rx, cy),
      C(cx + rx, cy - ry * k, cx + rx * k, cy - ry, cx, cy - ry),
      C(cx - rx * k, cy - ry, cx - rx, cy - ry * k, cx - rx, cy),
      C(cx - rx, cy + ry * k, cx - rx * k, cy + ry, cx, cy + ry),
      C(cx + rx * k, cy + ry, cx + rx, cy + ry * k, cx + rx, cy),
      Z(),
    ];
    if (rot) return stroke(rotatePath(d, cx, cy, rot), w);
    return stroke(d, w);
  }

  function rotatePath(d, cx, cy, ang) {
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const t = (x, y) => [
      cx + (x - cx) * cos - (y - cy) * sin,
      cy + (x - cx) * sin + (y - cy) * cos,
    ];
    return d.map((cmd) => {
      if (cmd[0] === 'Z') return cmd;
      const out = [cmd[0]];
      for (let i = 1; i < cmd.length; i += 2) {
        const p = t(cmd[i], cmd[i + 1]);
        out.push(p[0], p[1]);
      }
      return out;
    });
  }

  function qPoint(t, p0, p1, p2) {
    const mt = 1 - t;
    return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
  }
  function cPoint(t, p0, p1, p2, p3) {
    const mt = 1 - t;
    return mt ** 3 * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t ** 3 * p3;
  }

  // 把路径细分为折线（每条 M 开启一条新折线，Z 闭合）
  function flatten(d, steps = 12) {
    const lines = [];
    let cur = null;
    let start = null;
    for (const cmd of d) {
      if (cmd[0] === 'M') {
        cur = [[cmd[1], cmd[2]]];
        lines.push(cur);
        start = [cmd[1], cmd[2]];
      } else if (cmd[0] === 'L') {
        cur.push([cmd[1], cmd[2]]);
      } else if (cmd[0] === 'Q') {
        const p0 = cur[cur.length - 1];
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          cur.push([
            qPoint(t, p0[0], cmd[1], cmd[3]),
            qPoint(t, p0[1], cmd[2], cmd[4]),
          ]);
        }
      } else if (cmd[0] === 'C') {
        const p0 = cur[cur.length - 1];
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          cur.push([
            cPoint(t, p0[0], cmd[1], cmd[3], cmd[5]),
            cPoint(t, p0[1], cmd[2], cmd[4], cmd[6]),
          ]);
        }
      } else if (cmd[0] === 'Z') {
        cur.push([start[0], start[1]]);
      }
    }
    return lines;
  }

  let pathStart = null;
  function trace2D(ctx, d) {
    ctx.beginPath();
    pathStart = null;
    for (const cmd of d) {
      if (cmd[0] === 'M') {
        ctx.moveTo(cmd[1], cmd[2]);
        pathStart = [cmd[1], cmd[2]];
      } else if (cmd[0] === 'L') ctx.lineTo(cmd[1], cmd[2]);
      else if (cmd[0] === 'Q') ctx.quadraticCurveTo(cmd[1], cmd[2], cmd[3], cmd[4]);
      else if (cmd[0] === 'C') ctx.bezierCurveTo(cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[6]);
      else if (cmd[0] === 'Z' && pathStart) ctx.lineTo(pathStart[0], pathStart[1]);
    }
  }

  const r1 = (n) => Math.round(n * 10) / 10;
  function toSVG(d) {
    let start = null;
    return d.map((cmd) => {
      if (cmd[0] === 'M') { start = [cmd[1], cmd[2]]; }
      if (cmd[0] === 'Z' && start) return 'L' + r1(start[0]) + ' ' + r1(start[1]);
      return cmd[0] + cmd.slice(1).map((v) => r1(v)).join(' ');
    }).join(' ');
  }

  const api = {
    M, L, Q, C, Z, stroke, line, poly, rectStroke, ellipseStroke,
    rotatePath, flatten, trace2D, toSVG,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Geo = api;
})(typeof window !== 'undefined' ? window : globalThis);
