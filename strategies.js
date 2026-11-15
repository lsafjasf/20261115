// Autopilot controllers: conservative vs aggressive.
// Each controller receives sim state and issues gate/turbine commands.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sim.js'));
  else root.TidalStrategies = factory(root.TidalSim);
})(typeof self !== 'undefined' ? self : this, function (TidalSim) {
  'use strict';

  const CFG = TidalSim.CFG;

  function nextShip(s) {
    return s.ships.find(function (sh) { return sh.state === 'waiting'; });
  }

  function setBoth(sim, gate, turb) {
    sim.commandGate(0, gate);
    sim.commandGate(1, gate);
    sim.commandTurbine(0, turb);
    sim.commandTurbine(1, turb);
  }

  // Conservative: protect blades, normal generation only, equalise early,
  // and throttle off whenever storage approaches the top of the band.
  function conservativeControl(sim, s) {
    const ship = nextShip(s);
    const head = s.sea - s.basin;
    const frac = s.energy / CFG.BATTERY_CAP;

    // While a ship transits, turbines stay off but the next ship's
    // equalisation can already proceed in parallel.
    if (ship) {
      const prepStart = ship.deadline - CFG.TRANSIT_TIME - 95;
      if (s.t >= prepStart) {
        setBoth(sim, 1, 0); // sluice equalisation
        return;
      }
    }

    if (frac >= 0.84) {
      setBoth(sim, 0.35, 0); // storage nearly full: rest equipment
      return;
    }
    const gate = frac > 0.75 ? 0.7 : 1;
    setBoth(sim, gate, 1); // normal generation, never overdrive
  }

  // Aggressive: chase every joule — gates wide, overdrive most of the time,
  // equalise as late as possible, and keep running until the battery is full.
  function aggressiveControl(sim, s) {
    const ship = nextShip(s);
    const head = s.sea - s.basin;
    const frac = s.energy / CFG.BATTERY_CAP;

    if (ship) {
      const prepStart = ship.deadline - CFG.TRANSIT_TIME - 50;
      if (s.t >= prepStart) {
        setBoth(sim, 1, 0); // last-minute equalisation
        return;
      }
    }

    if (frac >= 0.995) {
      setBoth(sim, 0.2, 0); // hard stop only at literal full charge
      return;
    }
    if (Math.abs(head) < 0.12) {
      setBoth(sim, 1, 0); // extreme slack: overdrive would cavitate
      return;
    }
    setBoth(sim, 1, Math.abs(head) < 0.3 ? 1 : 2);
  }

  function run(controlFn) {
    const sim = TidalSim.createSim();
    const s = sim.state;
    const dt = 0.1;
    while (!s.finished) {
      controlFn(sim, s);
      sim.step(dt);
    }
    return sim;
  }

  return {
    conservative: conservativeControl,
    aggressive: aggressiveControl,
    run: run
  };
});
