// Tidal barrage simulation core.
// Runs unchanged in browser (window.TidalSim) and Node (module.exports).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TidalSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CFG = {
    DURATION: 720,                 // sim seconds = 12 game minutes (1 s = 1 game s)
    TIDE_PERIOD: 720,
    TIDE_AMP: 3.0,                 // metres
    BASIN_AREA: 55.0,              // m^2 equivalent (tuned scale)
    FLOW_K: 0.15,                  // generation flow coefficient
    SLUICE_K: 1.3,                 // turbine bypass: faster equalisation for transit
    GATE_RATE: 0.1,                // gate travel: 10 s fully open <-> closed
    TURB_MULT: [1.0, 1.3, 1.8],    // sluice flow / normal generation / overdrive
    POWER_K: 12.0,                 // kW per (m^3/s * m head), before efficiency
    OVERDRIVE_POWER: 1.35,
    CHARGE_EFF: 0.92,
    BATTERY_CAP: 9000.0,           // energy units (kJ-scale display unit)
    BAND_LO: 0.55,
    BAND_HI: 0.85,
    SAFE_HEAD: 0.35,               // max |sea-basin| for transit
    SAFE_GATE: 0.6,                // gates must be at least this open for transit
    TRANSIT_TIME: 25,
    SHIPS: [
      { release: 90, deadline: 230 },
      { release: 310, deadline: 500 },
      { release: 560, deadline: 700 }
    ]
  };

  function tideLevel(t) {
    return CFG.TIDE_AMP * Math.sin((2 * Math.PI * t) / CFG.TIDE_PERIOD);
  }

  function createSim() {
    const state = {
      t: 0,
      sea: 0,
      basin: 0,
      gates: [0, 0],               // actual positions 0..1
      gateTargets: [0, 0],         // commanded positions (movement is the delay)
      turbines: [0, 0],            // 0 off, 1 normal, 2 overdrive
      flows: [0, 0],
      power: 0,
      energy: CFG.BATTERY_CAP * 0.5,
      spilled: 0,                  // curtailed energy (battery full)
      wear: [0, 0],                // damage percent per turbine
      totalGenerated: 0,
      outOfBandTime: 0,
      ships: CFG.SHIPS.map(function (s, i) {
        return {
          id: i,
          release: s.release,
          deadline: s.deadline,
          state: 'waiting',        // waiting -> transiting -> done
          startedAt: null,
          finishedAt: null,
          delay: 0,
          progress: 0
        };
      }),
      events: [],
      finished: false
    };

    const api = { CFG: CFG, state: state };

    api.commandGate = function (i, target) {
      if (i < 0 || i > 1) return;
      state.gateTargets[i] = Math.max(0, Math.min(1, target));
    };

    api.commandTurbine = function (i, mode) {
      if (i < 0 || i > 1) return;
      state.turbines[i] = Math.max(0, Math.min(2, Math.round(mode)));
    };

    api.event = function (msg) {
      state.events.push({ t: state.t, msg: msg });
      if (state.events.length > 60) state.events.shift();
    };

    api.step = function (dt) {
      // fixed internal sub-step for stability
      const h = 0.1;
      let remaining = Math.max(0, Math.min(dt, 0.25));
      while (remaining > 1e-6) {
        const step = Math.min(h, remaining);
        substep(step);
        remaining = Math.round((remaining - step) * 1e6) / 1e6;
      }
      if (state.t >= CFG.DURATION) finish(state);
      return state.finished;
    };

    function substep(dt) {
      state.t += dt;
      state.sea = tideLevel(state.t);

      // Gates slew toward target at a fixed rate: this is the operation delay.
      for (let i = 0; i < 2; i++) {
        const g = state.gates[i], target = state.gateTargets[i];
        if (g < target) state.gates[i] = Math.min(target, g + CFG.GATE_RATE * dt);
        else if (g > target) state.gates[i] = Math.max(target, g - CFG.GATE_RATE * dt);
      }

      // Flow through each channel.
      const head = state.sea - state.basin;
      let totalQ = 0;
      for (let i = 0; i < 2; i++) {
        const k = state.turbines[i] === 0 ? CFG.SLUICE_K : CFG.FLOW_K;
        const opening = state.gates[i] * CFG.TURB_MULT[state.turbines[i]];
        const q = opening === 0
          ? 0
          : k * opening * Math.sign(head) * Math.sqrt(Math.abs(head));
        state.flows[i] = q;
        totalQ += q;
        accumulateWear(i, q, head, dt);
      }
      state.basin += (totalQ * dt) / CFG.BASIN_AREA;

      // Power + battery.
      let power = 0;
      for (let i = 0; i < 2; i++) {
        if (state.turbines[i] === 0) continue;
        const p = CFG.POWER_K * Math.abs(state.flows[i]) * Math.abs(head) *
          (state.turbines[i] === 2 ? CFG.OVERDRIVE_POWER : 1);
        power += p;
      }
      state.power = power;
      const gained = power * dt * CFG.CHARGE_EFF;
      const room = CFG.BATTERY_CAP - state.energy;
      state.energy += Math.min(gained, room);
      state.spilled += Math.max(0, gained - room);
      state.totalGenerated += gained;

      const frac = state.energy / CFG.BATTERY_CAP;
      if (frac < CFG.BAND_LO || frac > CFG.BAND_HI) state.outOfBandTime += dt;

      updateShips(head, dt);
    }

    function accumulateWear(i, q, head, dt) {
      const mode = state.turbines[i];
      if (mode === 0) return;
      let rate = 0.0015 * state.gates[i];            // normal baseline wear
      if (mode === 2) {
        rate = 0.06 + 0.006 * Math.abs(q);           // overdrive wear
        if (Math.abs(head) < 0.25) rate += 0.09;     // cavitation at low head
      }
      state.wear[i] = Math.min(100, state.wear[i] + rate * dt);
    }

    function transitReady(head) {
      if (Math.abs(head) > CFG.SAFE_HEAD) return false;
      for (let i = 0; i < 2; i++) {
        if (state.gates[i] < CFG.SAFE_GATE) return false;
        if (state.turbines[i] !== 0) return false;
      }
      return true;
    }

    function updateShips(head, dt) {
      for (const ship of state.ships) {
        if (ship.state === 'transiting') {
          ship.progress += dt;
          if (ship.progress >= CFG.TRANSIT_TIME) {
            ship.state = 'done';
            ship.finishedAt = state.t;
            ship.delay = Math.max(0, ship.finishedAt - ship.deadline);
            api.event('船 ' + (ship.id + 1) + ' 完成通航');
          }
        }
      }
      const active = state.ships.find(function (s) { return s.state === 'transiting'; });
      if (active || !transitReady(head)) return;
      const next = state.ships.find(function (s) {
        return s.state === 'waiting' && state.t >= s.release;
      });
      if (next) {
        next.state = 'transiting';
        next.startedAt = state.t;
        next.progress = 0;
        api.event('船 ' + (next.id + 1) + ' 开始通航');
      }
    }

    function finish(s) {
      s.finished = true;
      for (const ship of s.ships) {
        if (ship.state !== 'done') ship.delay = 60; // missed-transit penalty
      }
    }

    api.results = function () {
      const s = state;
      const completed = s.ships.filter(function (sh) { return sh.state === 'done'; }).length;
      const delay = s.ships.reduce(function (a, sh) { return a + sh.delay; }, 0);
      const wear = s.wear[0] + s.wear[1];
      const frac = s.energy / CFG.BATTERY_CAP;
      const inBand = frac >= CFG.BAND_LO && frac <= CFG.BAND_HI;
      const passed = completed === 3 && inBand;
      return {
        generatedKWh: s.totalGenerated / 3600,
        spilledKWh: s.spilled / 3600,
        delayS: delay,
        completed: completed,
        wearPct: wear,
        wearPerTurbine: s.wear.slice(),
        finalStoragePct: frac * 100,
        outOfBandS: s.outOfBandTime,
        inBandAtEnd: inBand,
        passed: passed,
        shipDelays: s.ships.map(function (sh) { return sh.delay; })
      };
    };

    return api;
  }

  return { CFG: CFG, createSim: createSim, tideLevel: tideLevel };
});
