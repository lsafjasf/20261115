/* 印刷套准调准仿真内核：浏览器与 Node 共用 (UMD) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PrintSim = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONSTANTS = {
    TOLERANCE_UM: 50,        // 套准容差 ±50μm
    DENSITY_MIN: 0.85,       // 油墨浓度合格区间
    DENSITY_MAX: 1.15,
    DENSITY_TARGET: 1.0,
    GHOST_LIMIT: 0.3,        // 重影指数上限
    GHOST_MAX: 0.5,
    STREAK_TARGET: 10,       // 连续合格张数
    MEASURE_NOISE_UM: 8,     // 放大镜测量噪声 σ
    DRIFT_UM: 3,             // 每张机械漂移 σ
    GHOST_OVERSHOOT_DIV: 600,
    GHOST_REVERSAL: 0.12,
    GHOST_DECAY: 0.82,
    GHOST_SETTLE: 0.7,
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rng) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function createSimulator(seed) {
    const rng = mulberry32(typeof seed === 'number' ? seed : (Date.now() & 0xffffffff));
    const C = CONSTANTS;

    const state = {
      machine: { x: 240, y: -160 },      // 蓝版相对红版的机械位移真值 (μm)
      correction: { x: 0, y: 0 },       // 用户累计修正量 (μm)
      density: { red: 0.78, blue: 1.24 },
      ghost: 0,
      streak: 0,
      sheetCount: 0,
      complete: false,
      history: [],
      lastSheet: null,
      lastStep: { x: 0, y: 0 },
    };

    function netError() {
      return {
        x: state.machine.x + state.correction.x,
        y: state.machine.y + state.correction.y,
      };
    }

    function applyCorrection(delta) {
      const d = delta || {};
      const dx = Number(d.dx) || 0;
      const dy = Number(d.dy) || 0;
      const dRed = Number(d.dRed) || 0;
      const dBlue = Number(d.dBlue) || 0;

      state.history.push({
        machine: { x: state.machine.x, y: state.machine.y },
        correction: { x: state.correction.x, y: state.correction.y },
        density: { red: state.density.red, blue: state.density.blue },
        ghost: state.ghost,
        streak: state.streak,
        lastStep: { x: state.lastStep.x, y: state.lastStep.y },
      });

      let overshoot = 0;
      [['x', dx], ['y', dy]].forEach(function (pair) {
        const axis = pair[0];
        const step = pair[1];
        if (step === 0) return;
        const errBefore = state.machine[axis] + state.correction[axis];
        if (Math.sign(step) === -Math.sign(errBefore)) {
          overshoot += Math.max(0, Math.abs(step) - Math.abs(errBefore));
        }
      });

      if ((dx * state.lastStep.x + dy * state.lastStep.y) < 0) {
        state.ghost += C.GHOST_REVERSAL;
      }
      state.ghost += overshoot / C.GHOST_OVERSHOOT_DIV;
      state.ghost = Math.min(C.GHOST_MAX, state.ghost);

      state.correction.x += dx;
      state.correction.y += dy;
      state.density.red = clamp(state.density.red + dRed, 0.5, 1.5);
      state.density.blue = clamp(state.density.blue + dBlue, 0.5, 1.5);
      state.lastStep = { x: dx, y: dy };
      return snapshot();
    }

    function reprint() {
      state.sheetCount += 1;
      state.machine.x += gaussian(rng) * C.DRIFT_UM;
      state.machine.y += gaussian(rng) * C.DRIFT_UM;
      state.ghost *= C.GHOST_DECAY;

      const err = netError();
      const measured = {
        x: err.x + gaussian(rng) * C.MEASURE_NOISE_UM,
        y: err.y + gaussian(rng) * C.MEASURE_NOISE_UM,
      };

      const regOk = Math.abs(measured.x) <= C.TOLERANCE_UM &&
        Math.abs(measured.y) <= C.TOLERANCE_UM;
      const inkOk = state.density.red >= C.DENSITY_MIN &&
        state.density.red <= C.DENSITY_MAX &&
        state.density.blue >= C.DENSITY_MIN &&
        state.density.blue <= C.DENSITY_MAX;
      const ghostOk = state.ghost < C.GHOST_LIMIT;
      const qualified = regOk && inkOk && ghostOk;

      if (qualified) {
        state.streak += 1;
        state.ghost *= C.GHOST_SETTLE;
      } else {
        state.streak = 0;
      }
      if (state.streak >= C.STREAK_TARGET) state.complete = true;

      const sheet = {
        index: state.sheetCount,
        measured: { x: measured.x, y: measured.y },
        trueError: { x: err.x, y: err.y },
        density: { red: state.density.red, blue: state.density.blue },
        ghost: state.ghost,
        checks: { registration: regOk, ink: inkOk, ghost: ghostOk },
        qualified: qualified,
        streak: state.streak,
        complete: state.complete,
      };
      state.lastSheet = sheet;
      return sheet;
    }

    function undo() {
      if (state.history.length === 0) return false;
      const snap = state.history.pop();
      state.machine = { x: snap.machine.x, y: snap.machine.y };
      state.correction = { x: snap.correction.x, y: snap.correction.y };
      state.density = { red: snap.density.red, blue: snap.density.blue };
      state.ghost = snap.ghost;
      state.streak = snap.streak;
      state.lastStep = { x: snap.lastStep.x, y: snap.lastStep.y };
      state.complete = false;
      return snapshot();
    }

    function clamp(v, lo, hi) {
      return Math.max(lo, Math.min(hi, v));
    }

    function snapshot() {
      return {
        machine: { x: state.machine.x, y: state.machine.y },
        correction: { x: state.correction.x, y: state.correction.y },
        density: { red: state.density.red, blue: state.density.blue },
        ghost: state.ghost,
        streak: state.streak,
        sheetCount: state.sheetCount,
        complete: state.complete,
        historyLength: state.history.length,
        lastSheet: state.lastSheet,
        netError: netError(),
      };
    }

    return {
      applyCorrection: applyCorrection,
      reprint: reprint,
      undo: undo,
      netError: netError,
      getState: snapshot,
      canUndo: function () { return state.history.length > 0; },
      _state: state,
    };
  }

  return { createSimulator: createSimulator, CONSTANTS: CONSTANTS };
});
