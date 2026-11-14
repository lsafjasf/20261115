/**
 * 峡谷哨塔镜面通信 —— 纯逻辑引擎（无 DOM 依赖，可在 Node / 浏览器运行）。
 * 角度单位：度；坐标系：x 向右，y 向下。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CanyonEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;
  const normDeg = (a) => ((a % 360) + 360) % 360;
  // 取 -180..180 的最短夹角
  const angleDelta = (a, b) => {
    let d = normDeg(a - b);
    if (d > 180) d -= 360;
    return d;
  };
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const scale = (v, k) => ({ x: v.x * k, y: v.y * k });
  const len = (v) => Math.hypot(v.x, v.y);
  const unit = (v) => {
    const l = len(v) || 1;
    return { x: v.x / l, y: v.y / l };
  };
  const dirOf = (degAngle) => ({ x: Math.cos(degAngle * DEG), y: Math.sin(degAngle * DEG) });

  // 固定场景：太阳 -> M1 -> M2 -> M3 -> 接收窗
  const LAYOUT = Object.freeze({
    sun: { x: 130, y: 70 },
    mirrors: [
      { id: 0, x: 215, y: 175 },
      { id: 1, x: 700, y: 150 },
      { id: 2, x: 250, y: 430 }
    ],
    receiver: { x: 805, y: 350, radius: 16 },
    beamRange: 1400,
    stepDeg: 3,          // 镜片角度调整最小步长
    toleranceDeg: 2.4,   // 对准入射/出射方向的最大允许误差
    heatPerStep: 11,     // 每调一步产生的热量
    heatCooldown: 7.5,   // 每秒自然散热量
    overheatAt: 100,     // 过热阈值
    overheatLockMs: 2600,// 过热锁定时长
    lockReleaseHeat: 52, // 锁定解除时回落到的温度
    winHeatCeiling: 80   // 胜利时所有镜片温度必须低于该值
  });

  // 设计解：每面镜的目标朝向（镜片法线方向，度）
  function solveTargets() {
    const pts = [LAYOUT.sun, ...LAYOUT.mirrors, LAYOUT.receiver];
    return LAYOUT.mirrors.map((m, i) => {
      const inDir = unit(sub(pts[i], m));        // 入射光来向（指向光源）
      const outDir = unit(sub(pts[i + 2], m));   // 反射出去方向
      return normDeg(Math.atan2(inDir.y + outDir.y, inDir.x + outDir.x) * RAD);
    });
  }
  const TARGET_ANGLES = solveTargets();

  /**
   * 镜面反射：入射方向 d（传播方向，单位向量），法线 n（单位向量）
   * r = d - 2(d·n)n
   */
  function reflect(d, n) {
    const dot = d.x * n.x + d.y * n.y;
    return unit({ x: d.x - 2 * dot * n.x, y: d.y - 2 * dot * n.y });
  }

  // 射线 p+t*d 与以 c 为圆心、r 为半径的圆，返回最近正根 t，未命中返回 null
  function rayCircle(p, d, c, r) {
    const m = sub(p, c);
    const b = m.x * d.x + m.y * d.y;
    const cc = m.x * m.x + m.y * m.y - r * r;
    const disc = b * b - cc;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t1 = -b - sq;
    const t2 = -b + sq;
    if (t1 > 1e-6) return t1;
    if (t2 > 1e-6) return t2;
    return null;
  }

  return {
    DEG, RAD, normDeg, angleDelta, sub, scale, len, unit, dirOf,
    reflect, rayCircle, LAYOUT, TARGET_ANGLES
  };
});
