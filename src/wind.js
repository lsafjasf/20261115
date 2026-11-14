/* Fixed-seed crosswind field. Wind direction/strength is deterministic for a given seed. */
(function (global) {
  const App = (global.App = global.App || {});

  function createWind(seedString) {
    const seed = App.PRNG.hashSeed(seedString + ':wind');
    const rng = App.PRNG.mulberry32(seed);
    const angle = -0.35 + rng() * 1.1;
    const baseSpeed = 2.2 + rng() * 1.1;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);

    function gust(t) {
      return (
        0.55 +
        0.25 * Math.sin(t * 0.7 + seed % 7) +
        0.2 * Math.sin(t * 1.73 + (seed % 11) * 0.5)
      );
    }

    function vectorAt(x, y, t) {
      const g = gust(t);
      const flutter = 0.12 * Math.sin(x * 0.021 + y * 0.017 + t * 2.1);
      const s = baseSpeed * (g + flutter);
      return { vx: ux * s, vy: uy * s, speed: s };
    }

    function speedAt(x, y, t) {
      return vectorAt(x, y, t).speed;
    }

    return {
      seed,
      angle,
      unit: { x: ux, y: uy },
      baseSpeed,
      gust,
      vectorAt,
      speedAt,
      driftPerMeter: 3.6,
    };
  }

  App.Wind = { createWind };
  if (typeof module !== 'undefined' && module.exports) module.exports = App.Wind;
})(typeof globalThis !== 'undefined' ? globalThis : this);
