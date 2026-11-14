/*
 * sim.js — 确定性风铃模拟核心（纯逻辑，无 DOM / 无 Audio）。
 * 同一组参数 + 同一种子 => 完全相同的触发事件序列。
 * 在浏览器中作为全局 WindSim 使用，在 Node 中作为 CommonJS module 使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WindSim = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  var LOOP_SECONDS = 12;
  var DT = 1 / 120; // 固定步长，保证可复现
  var STRIKE_THRESHOLD = 1.0;
  var COOLDOWN = 0.28; // 同一根管两次触发的最小间隔（秒）
  var EXCITE_GAIN = 3.2; // 风能 -> 激发累积速率
  var EXCITE_DECAY = 0.9; // 激发自然衰减（每秒比例）

  // 8 根金属管，五声音阶，长度映射频率（管越短音越高）
  var CHIME_FREQS = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];
  var CHIME_NAMES = ['C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'D6', 'E6'];

  // 默认舞台几何（浏览器画布与 Node 测试共用，保证单一真源）
  var STAGE_W = 900, STAGE_H = 480, BAR_Y = 60;

  function defaultTubeGeometry() {
    var tubes = [];
    var margin = 90;
    var span = STAGE_W - margin * 2;
    for (var i = 0; i < CHIME_FREQS.length; i++) {
      var x = margin + (span / (CHIME_FREQS.length - 1)) * i;
      var len = 260 * Math.sqrt(CHIME_FREQS[0] / CHIME_FREQS[i]) * 0.62 + 40;
      tubes.push({ x: x, top: BAR_Y, len: len, midY: BAR_Y + len * 0.55 });
    }
    return tubes;
  }

  // 默认作品：六组风源
  function defaultComposition() {
    return {
      seed: 20261115,
      sources: [
        { x: 60,  y: 130, angle: 0.15,            strength: 0.65, decay: 260 },
        { x: 60,  y: 330, angle: -0.1,            strength: 0.55, decay: 200 },
        { x: 840, y: 150, angle: Math.PI - 0.2,   strength: 0.6,  decay: 240 },
        { x: 840, y: 360, angle: Math.PI + 0.15,  strength: 0.5,  decay: 190 },
        { x: 450, y: 430, angle: -Math.PI / 2,    strength: 0.7,  decay: 230 },
        { x: 450, y: 20,  angle: Math.PI / 2,     strength: 0.4,  decay: 150 }
      ]
    };
  }

  // 确定性伪随机数（mulberry32）
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 每个风源的湍流：若干正弦叠加，相位/频率由种子决定 => 是 t 的确定性函数
  function makeTurbulence(seed) {
    var rng = makeRng(seed);
    var comps = [];
    for (var i = 0; i < 3; i++) {
      comps.push({ freq: 0.6 + rng() * 2.2, phase: rng() * Math.PI * 2, amp: 0.5 + rng() * 0.5 });
    }
    var norm = comps.reduce(function (s, c) { return s + c.amp; }, 0);
    return function (t) {
      var v = 0;
      for (var i = 0; i < comps.length; i++) {
        v += comps[i].amp * Math.sin(comps[i].phase + comps[i].freq * t * Math.PI * 2);
      }
      return 0.72 + 0.28 * (v / norm); // 约 0.44 .. 1.0
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function normAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  // 单个风源对某点的风速贡献：方向衰减(cos^2) + 距离指数衰减
  function windAt(source, x, y, turb) {
    var dx = x - source.x, dy = y - source.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var toPoint = Math.atan2(dy, dx);
    var dirDiff = normAngle(toPoint - source.angle);
    var dirFactor = Math.cos(dirDiff);
    if (dirFactor <= 0) return 0;
    dirFactor *= dirFactor;
    var distFactor = Math.exp(-dist / source.decay);
    return source.strength * dirFactor * distFactor * turb;
  }

  // composition = { seed, sources: [{x,y,angle,strength,decay}] }
  // tubes: 每根管的采样点 {x, y}（取管体中段）
  function createSimulation(composition, tubes) {
    var sources = composition.sources.map(function (s, i) {
      return {
        x: s.x, y: s.y, angle: s.angle,
        strength: clamp(s.strength, 0, 1),
        decay: clamp(s.decay, 20, 600),
        turb: makeTurbulence((composition.seed ^ Math.imul(i + 1, 0x9E3779B9)) >>> 0)
      };
    });
    return {
      t: 0,
      sources: sources,
      tubes: tubes.map(function (p) {
        return { x: p.x, y: p.y, excite: 0, cooldown: 0 };
      })
    };
  }

  // 推进一个固定步长，返回本步触发的事件数组
  function step(sim, rng) {
    sim.t += DT;
    var events = [];
    for (var i = 0; i < sim.tubes.length; i++) {
      var tube = sim.tubes[i];
      var w = 0;
      for (var j = 0; j < sim.sources.length; j++) {
        var src = sim.sources[j];
        w += windAt(src, tube.x, tube.y, src.turb(sim.t));
      }
      tube.excite += Math.max(0, w - 0.18) * EXCITE_GAIN * DT;
      tube.excite *= Math.pow(EXCITE_DECAY, DT);
      if (tube.cooldown > 0) tube.cooldown -= DT;
      if (tube.excite >= STRIKE_THRESHOLD && tube.cooldown <= 0) {
        var velocity = clamp(tube.excite / 1.6, 0.25, 1);
        // 力度微小人性化抖动，但来自种子 rng => 可复现
        velocity = clamp(velocity * (0.92 + 0.16 * rng()), 0.05, 1);
        events.push({ time: sim.t, chime: i, velocity: velocity });
        tube.excite = 0;
        tube.cooldown = COOLDOWN;
      }
    }
    return events;
  }

  // 跑完整个 12 秒循环，返回事件列表 [{time, chime, velocity}]
  function simulateLoop(composition, tubes) {
    var sim = createSimulation(composition, tubes);
    var rng = makeRng((composition.seed ^ 0x51F15EED) >>> 0);
    var events = [];
    var steps = Math.round(LOOP_SECONDS / DT);
    for (var i = 0; i < steps; i++) {
      var ev = step(sim, rng);
      for (var k = 0; k < ev.length; k++) events.push(ev[k]);
    }
    return events;
  }

  // 声部掩盖规则：同管 maskWindow 秒内的重复触发被掩盖；
  // 0.12s 滑窗内声部数超过 maxPolyphony 时，力度最小的事件被掩盖。
  function applyMasking(events, maskWindow, maxPolyphony) {
    var kept = [];
    var windowBuf = [];
    var lastPerChime = {};
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var last = lastPerChime[e.chime];
      if (last !== undefined && e.time - last < maskWindow) continue;
      while (windowBuf.length > 0 && e.time - windowBuf[0].time > 0.12) windowBuf.shift();
      if (windowBuf.length >= maxPolyphony) {
        var weakest = -1, wv = Infinity;
        for (var k = 0; k < windowBuf.length; k++) {
          if (windowBuf[k].velocity < wv) { wv = windowBuf[k].velocity; weakest = k; }
        }
        if (e.velocity <= wv) continue; // 被掩盖
        var removed = windowBuf.splice(weakest, 1)[0];
        kept.splice(kept.indexOf(removed), 1);
      }
      windowBuf.push(e);
      kept.push(e);
      lastPerChime[e.chime] = e.time;
    }
    return kept;
  }

  return {
    LOOP_SECONDS: LOOP_SECONDS,
    DT: DT,
    CHIME_FREQS: CHIME_FREQS,
    CHIME_NAMES: CHIME_NAMES,
    STAGE_W: STAGE_W,
    STAGE_H: STAGE_H,
    BAR_Y: BAR_Y,
    defaultTubeGeometry: defaultTubeGeometry,
    defaultComposition: defaultComposition,
    makeRng: makeRng,
    createSimulation: createSimulation,
    step: step,
    simulateLoop: simulateLoop,
    applyMasking: applyMasking
  };
});
