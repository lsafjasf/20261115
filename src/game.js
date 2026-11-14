/**
 * 游戏状态机：调角、热量、过热锁定、天气可见度、光束追踪、胜利判定。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'));
  } else {
    root.CanyonGame = factory(root.CanyonEngine);
  }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const { LAYOUT, TARGET_ANGLES, normDeg, angleDelta, unit, sub, dirOf,
    reflect, rayCircle } = E;

  const CLOUD_COUNT = 4;

  class CanyonGame {
    constructor(seed) {
      this.rng = mulberry(seed == null ? Date.now() >>> 0 : seed >>> 0);
      this.reset();
    }

    reset() {
      this.time = 0;
      this.wind = 0;                    // 风向，-1..1
      this.windTarget = 0;
      this.clouds = [];
      for (let i = 0; i < CLOUD_COUNT; i++) {
        this.clouds.push({
          x: this.rng() * 960,
          y: 60 + this.rng() * 300,
          w: 120 + this.rng() * 90,
          depth: 0.35 + this.rng() * 0.5,
          speed: 8 + this.rng() * 14
        });
      }
      this.mirrors = LAYOUT.mirrors.map((m) => ({
        ...m,
        angle: 0,                   // 法线朝向（度）
        heat: 0,
        locked: false,
        lockUntil: 0,
        lastStepAt: -1e9
      }));
      this.signals = [false, false, false];   // 三段信号是否建立
      this.lockedCount = 0;                   // 同时建立的信号数（帧快照）
      this.won = false;
      this.weatherEnabled = true;             // 测试时可关闭天气干扰
      this.paused = false;                    // 自动化测试暂停实时循环
      this.lastTrace = null;
      this.events = [];                        // 本帧产生的事件（供音频层消费）
    }

    // —— 玩家操作：最小步长旋转，过热或锁定中不可调 ——
    rotate(index, dir) {
      const m = this.mirrors[index];
      if (!m || m.locked) return false;
      if (m.heat >= LAYOUT.overheatAt) {
        m.locked = true;
        m.lockUntil = this.time + LAYOUT.overheatLockMs;
        this.events.push({ type: 'overheat', index });
        return false;
      }
      m.angle = normDeg(m.angle + (dir > 0 ? 1 : -1) * LAYOUT.stepDeg);
      m.heat = Math.min(LAYOUT.overheatAt, m.heat + LAYOUT.heatPerStep);
      m.lastStepAt = this.time;
      this.events.push({ type: 'step', index });
      if (m.heat >= LAYOUT.overheatAt) {
        m.locked = true;
        m.lockUntil = this.time + LAYOUT.overheatLockMs;
        this.events.push({ type: 'overheat', index });
      }
      return true;
    }

    // 云层对某点的遮挡（0 完全晴朗 .. 1 完全遮蔽）
    occlusionAt(x, y) {
      if (!this.weatherEnabled) return 0;
      let occ = 0;
      for (const c of this.clouds) {
        const dx = (x - c.x) / (c.w * 0.5);
        const dy = (y - c.y) / (c.w * 0.22);
        const d2 = dx * dx + dy * dy;
        if (d2 < 1) occ = Math.max(occ, (1 - d2) * c.depth * 0.95);
      }
      return Math.min(1, occ);
    }

    // 一条线段上的平均可见度（0..1），多点采样
    segmentVisibility(a, b) {
      const steps = 6;
      let sum = 0;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        sum += 1 - this.occlusionAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
      return sum / (steps + 1);
    }

    /**
     * 光束追踪：太阳出发，依次经过三面镜子，最后判定接收窗。
     * 每段返回路径点、命中目标与否、可见度。
     */
    trace() {
      const pts = [LAYOUT.sun];
      let origin = LAYOUT.sun;
      let d = unit(sub(LAYOUT.mirrors[0], LAYOUT.sun)); // 阳光射向 M1
      const segments = [];
      const signals = [false, false, false];

      for (let i = 0; i < this.mirrors.length; i++) {
        const m = this.mirrors[i];
        const target = i < 2 ? LAYOUT.mirrors[i + 1] : LAYOUT.receiver;
        const n = dirOf(m.angle);
        const r = reflect(d, n);

        // 几何误差：反射方向与“指向下一目标”方向的夹角
        const want = unit(sub(target, m));
        const err = Math.abs(angleDelta(Math.atan2(r.y, r.x) * E.RAD,
          Math.atan2(want.y, want.x) * E.RAD));
        // 目标朝向误差（等价校验：法线偏离设计解）
        const targetErr = Math.abs(angleDelta(m.angle, TARGET_ANGLES[i]));
        const aligned = err <= LAYOUT.toleranceDeg &&
          targetErr <= LAYOUT.toleranceDeg;

        // 实际光束打到哪里：优先检测下一目标圆，否则射向场景边缘
        const hitR = target === LAYOUT.receiver ? LAYOUT.receiver.radius : 13;
        const tHit = rayCircle(m, r, target, hitR);
        const endPoint = (aligned && tHit != null)
          ? { x: m.x + r.x * tHit, y: m.y + r.y * tHit }
          : { x: m.x + r.x * LAYOUT.beamRange, y: m.y + r.y * LAYOUT.beamRange };

        const incoming = { from: origin, to: m };
        const visIn = this.segmentVisibility(incoming.from, incoming.to);
        const visOut = this.segmentVisibility(m, endPoint);
        segments.push({
          index: i,
          from: m,
          to: endPoint,
          reflected: r,
          errorDeg: err,
          targetErrorDeg: targetErr,
          aligned,
          hit: aligned && tHit != null,
          visibility: Math.min(visIn, visOut),
          incoming
        });
        signals[i] = segments[i].hit && segments[i].visibility > 0.25;
        pts.push(m);
        origin = m;
        d = r;
      }

      return {
        segments,
        signals,
        receiverHit: signals[2],
        polyline: pts
      };
    }

    update(dtMs) {
      this.events.length = 0;
      const dt = Math.min(0.1, dtMs / 1000);
      this.time += dtMs;

      // 风向平滑游走，云随风飘
      if (Math.abs(this.wind - this.windTarget) < 0.05) {
        this.windTarget = (this.rng() * 2 - 1);
      }
      this.wind += (this.windTarget - this.wind) * Math.min(1, dt * 0.7);
      for (const c of this.clouds) {
        c.x += (this.wind * c.speed + 4) * dt;
        if (c.x - c.w > 980) c.x = -c.w;
        if (c.x + c.w < -20) c.x = 980 + c.w;
      }

      // 散热与锁定解除
      for (const m of this.mirrors) {
        if (!m.locked) {
          m.heat = Math.max(0, m.heat - LAYOUT.heatCooldown * dt);
        }
        if (m.locked && this.time >= m.lockUntil) {
          m.locked = false;
          m.heat = LAYOUT.lockReleaseHeat;
          this.events.push({ type: 'unlock', index: this.mirrors.indexOf(m) });
        }
      }

      const trace = this.trace();
      const prevSignals = this.signals;
      this.lastTrace = trace;
      this.signals = trace.signals;
      this.lockedCount = trace.signals.filter(Boolean).length;
      trace.signals.forEach((on, i) => {
        if (on && !prevSignals[i]) this.events.push({ type: 'signal', index: i });
        if (!on && prevSignals[i]) this.events.push({ type: 'signalLost', index: i });
      });

      // 胜利：三组信号全部建立，且无镜片过热/锁定、温度均在上限以下
      const coolEnough = this.mirrors.every((m) =>
        !m.locked && m.heat < LAYOUT.winHeatCeiling);
      if (!this.won && this.lockedCount === 3 && coolEnough) {
        this.won = true;
        this.events.push({ type: 'win' });
      }
      return trace;
    }

    // 直接对齐到设计解（测试与调试用，按合法步长取整）
    alignAll() {
      this.mirrors.forEach((m, i) => {
        const steps = Math.round(TARGET_ANGLES[i] / LAYOUT.stepDeg);
        m.angle = normDeg(steps * LAYOUT.stepDeg);
      });
    }

    // 与某镜片设计解的最短步数差（测试用）
    stepsFromTarget(index) {
      return Math.round(angleDelta(this.mirrors[index].angle, TARGET_ANGLES[index])
        / LAYOUT.stepDeg);
    }
  }

  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return { CanyonGame, CLOUD_COUNT, mulberry };
});
