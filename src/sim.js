/* Headless simulation core: one fixed-timestep world usable by Canvas UI and Node tests. */
(function (global) {
  const App = (global.App = global.App || {});

  const WIDTHS = [8, 14, 22];
  const DT = 1 / 30;

  function createSim(options) {
    const opts = options || {};
    const seedString = opts.seed != null ? String(opts.seed) : 'dune-2026';
    const terrain = App.Terrain.createTerrain(seedString);
    const wind = App.Wind.createWind(seedString);
    const rng = App.PRNG.mulberry32(terrain.seed ^ 0x51ed270b);
    const cell = terrain.world.cell;
    const grid = App.Coverage.createCoverageGrid(terrain.world, cell);
    const zones = App.Zones.createZones(terrain, rng, cell);

    const spawn = { x: zones[0].start.x - 60, y: zones[0].start.y };
    if (!terrain.inBounds(spawn.x, spawn.y, 40)) {
      spawn.x = zones[0].start.x + 60;
    }
    const vehicle = App.Vehicle.createVehicle(spawn.x, spawn.y, terrain);

    const totalZoneArea = zones.reduce((sum, z) => sum + z.cells.length * cell * cell, 0);
    const stock = Math.ceil(totalZoneArea * 1.5);

    const sim = {
      seedString,
      terrain,
      wind,
      grid,
      zones,
      vehicle,
      cell,
      dt: DT,
      time: 0,
      width: WIDTHS[1],
      stock,
      seedUsed: 0,
      freshArea: 0,
      touchedArea: 0,
      finished: false,
      won: false,
      failReason: null,
      windCompensation: opts.windCompensation != null ? opts.windCompensation : true,
      input: { throttle: 0, steer: 0, brake: false, contourAssist: true },
    };

    sim.setWidth = function (w) {
      if (WIDTHS.indexOf(w) >= 0) sim.width = w;
    };

    sim.step = function () {
      if (sim.finished) return sim.snapshot();
      const v = sim.vehicle;
      const prevX = v.x;
      const prevY = v.y;
      App.Vehicle.stepVehicle(v, terrain, sim.input, DT);
      const moving = v.speed > 0.4;
      v.sowing = sim.input.sowing === true && sim.stock > sim.seedUsed && moving;

      if (v.sowing) {
        const driftMag = wind.baseSpeed * wind.driftPerMeter;
        let ax = prevX;
        let ay = prevY;
        let bx = v.x;
        let by = v.y;
        if (!sim.windCompensation) {
          ax += wind.unit.x * driftMag;
          ay += wind.unit.y * driftMag;
          bx += wind.unit.x * driftMag;
          by += wind.unit.y * driftMag;
        }
        const result = App.Coverage.markSegment(grid, ax, ay, bx, by, sim.width);
        const freshAreaNow = result.fresh * cell * cell;
        const travel = Math.hypot(v.x - prevX, v.y - prevY);
        const consumed = sim.width * travel;
        sim.touchedArea += consumed;
        sim.seedUsed += consumed;
        sim.freshArea += freshAreaNow;
        if (sim.seedUsed >= sim.stock) {
          sim.finished = true;
          sim.failReason = 'seed-exhausted';
        }
      }

      sim.time += DT;
      App.Zones.zoneStats(sim.zones, grid);
      if (sim.zones.every((z) => z.ratio >= 0.8)) {
        sim.finished = true;
        sim.won = true;
      }
      return sim.snapshot();
    };

    sim.snapshot = function () {
      const idealArea = sim.touchedArea;
      const wastedArea = Math.max(0, idealArea - sim.freshArea);
      return {
        time: sim.time,
        stock: sim.stock,
        seedUsed: sim.seedUsed,
        seedWasted: wastedArea,
        freshArea: sim.freshArea,
        touchedArea: sim.touchedArea,
        wasteRatio:
          idealArea > 0
            ? wastedArea / idealArea
            : 0,
        width: sim.width,
        finished: sim.finished,
        won: sim.won,
        failReason: sim.failReason,
        zoneRatios: sim.zones.map((z) => z.ratio),
        vehicle: {
          x: sim.vehicle.x,
          y: sim.vehicle.y,
          heading: sim.vehicle.heading,
          speed: sim.vehicle.speed,
          slope: sim.vehicle.slope,
          sliding: sim.vehicle.sliding,
          sowing: sim.vehicle.sowing,
        },
      };
    };

    sim.reset = function () {
      grid.clear();
      sim.time = 0;
      sim.seedUsed = 0;
      sim.freshArea = 0;
      sim.touchedArea = 0;
      sim.finished = false;
      sim.won = false;
      sim.failReason = null;
      const nv = App.Vehicle.createVehicle(spawn.x, spawn.y, terrain);
      sim.vehicle.x = nv.x;
      sim.vehicle.y = nv.y;
      sim.vehicle.heading = nv.heading;
      sim.vehicle.speed = 0;
      sim.vehicle.slideVx = 0;
      sim.vehicle.slideVy = 0;
      App.Zones.zoneStats(sim.zones, grid);
    };

    App.Zones.zoneStats(zones, grid);
    return sim;
  }

  App.Sim = { createSim, WIDTHS, DT };
  if (typeof module !== 'undefined' && module.exports) {
    require('./prng.js');
    require('./terrain.js');
    require('./wind.js');
    require('./coverage.js');
    require('./zones.js');
    require('./vehicle.js');
    module.exports = App.Sim;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
