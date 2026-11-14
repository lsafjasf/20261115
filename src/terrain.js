/* Seeded sand-dune height field. Heights/gradients are analytic and deterministic. */
(function (global) {
  const App = (global.App = global.App || {});
  const { fbm2D } = App.PRNG;

  const WORLD = {
    width: 1200,
    height: 800,
    cell: 4,
    steepStart: 0.24,
    slideStart: 0.3,
  };

  const DUNE = {
    amp: 13,
    lambda: 460,
    angle: 0.62,
    fbmAmp: 3.2,
    fbmScale: 1 / 280,
    hillAmp: 24,
    hillSigma: 90,
    tilt: 0.05,
  };

  function createTerrain(seedString) {
    const seed = App.PRNG.hashSeed(seedString);
    const rng = App.PRNG.mulberry32(seed ^ 0x9e3779b9);
    const ca = Math.cos(DUNE.angle);
    const sa = Math.sin(DUNE.angle);

    const hills = [];
    for (let i = 0; i < 4; i++) {
      hills.push({
        x: 120 + rng() * (WORLD.width - 240),
        y: 100 + rng() * (WORLD.height - 200),
        amp: DUNE.hillAmp * (0.75 + rng() * 0.5),
        sigma: DUNE.hillSigma * (0.8 + rng() * 0.5),
      });
    }

    function duneHeight(x, y) {
      const p = x * ca + y * sa;
      const q = -x * sa + y * ca;
      const primary = Math.sin((2 * Math.PI * p) / DUNE.lambda);
      const secondary = 0.35 * Math.sin((2 * Math.PI * q) / (DUNE.lambda * 0.62) + 1.7);
      return DUNE.amp * (primary + secondary);
    }

    function duneGrad(x, y) {
      const p = x * ca + y * sa;
      const q = -x * sa + y * ca;
      const dpdx = ca;
      const dpdy = sa;
      const dqdx = -sa;
      const dqdy = ca;
      const dPrimary =
        (DUNE.amp * 2 * Math.PI) / DUNE.lambda * Math.cos((2 * Math.PI * p) / DUNE.lambda);
      const dSecondary =
        (DUNE.amp * 0.35 * 2 * Math.PI) /
        (DUNE.lambda * 0.62) *
        Math.cos((2 * Math.PI * q) / (DUNE.lambda * 0.62) + 1.7);
      return {
        dx: dPrimary * dpdx + dSecondary * dqdx,
        dy: dPrimary * dpdy + dSecondary * dqdy,
      };
    }

    function hillTerm(x, y, h) {
      const dx = x - h.x;
      const dy = y - h.y;
      const s2 = h.sigma * h.sigma;
      return h.amp * Math.exp(-(dx * dx + dy * dy) / (2 * s2));
    }

    function hillGrad(x, y, h) {
      const dx = x - h.x;
      const dy = y - h.y;
      const s2 = h.sigma * h.sigma;
      const e = Math.exp(-(dx * dx + dy * dy) / (2 * s2));
      const k = (-h.amp / s2) * e;
      return { dx: k * dx, dy: k * dy };
    }

    function heightAt(x, y) {
      const n = (fbm2D(x * DUNE.fbmScale, y * DUNE.fbmScale, seed, 3, 2.1, 0.5) - 0.5) * 2;
      let h = duneHeight(x, y) + DUNE.fbmAmp * n + DUNE.tilt * (0.62 * x + 0.78 * y);
      for (const hill of hills) h += hillTerm(x, y, hill);
      return h;
    }

    function gradientAt(x, y) {
      const e = 3;
      const dx = (heightAt(x + e, y) - heightAt(x - e, y)) / (2 * e);
      const dy = (heightAt(x, y + e) - heightAt(x, y - e)) / (2 * e);
      return { dx, dy };
    }

    function analyticGrad(x, y) {
      const g = duneGrad(x, y);
      g.dx += DUNE.tilt * 0.62;
      g.dy += DUNE.tilt * 0.78;
      for (const hill of hills) {
        const hg = hillGrad(x, y, hill);
        g.dx += hg.dx;
        g.dy += hg.dy;
      }
      return g;
    }

    function slopeAt(x, y) {
      const g = analyticGrad(x, y);
      return Math.hypot(g.dx, g.dy);
    }

    function contourAngle(x, y) {
      const g = analyticGrad(x, y);
      return Math.atan2(-g.dx, g.dy);
    }

    function downhillAngle(x, y) {
      const g = analyticGrad(x, y);
      return Math.atan2(g.dy, g.dx);
    }

    function inBounds(x, y, margin) {
      const m = margin || 0;
      return x >= m && x <= WORLD.width - m && y >= m && y <= WORLD.height - m;
    }

    return {
      seed,
      seedString,
      world: WORLD,
      hills,
      heightAt,
      gradientAt,
      analyticGrad,
      slopeAt,
      contourAngle,
      downhillAngle,
      inBounds,
    };
  }

  App.Terrain = { createTerrain, WORLD, DUNE };
  if (typeof module !== 'undefined' && module.exports) {
    require('./prng.js');
    module.exports = App.Terrain;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
