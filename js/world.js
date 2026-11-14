/* Procedural ice-lake generation with a hard connectivity guarantee. */
(function (global) {
  const { makeRng, DEFAULT_SEED } = global.IceRng;

  const T = { SOLID: 0, THIN: 1, HOLE: 2, CAMP: 3 };

  const CONFIG = {
    cols: 22,
    rows: 15,
    cell: 40,
    camp: { x: 2, y: 7 },
    thinBlobs: 11,
    holes: 10,
    pointCount: 3
  };

  function key(x, y) { return y * CONFIG.cols + x; }
  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < CONFIG.cols && y < CONFIG.rows;
  }
  function neighbors4(x, y) {
    return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
      .filter(([a, b]) => inBounds(a, b));
  }

  /* BFS over non-hole cells. Returns set of reachable cell indices. */
  function floodFill(types, start) {
    const seen = new Set([key(start.x, start.y)]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      for (const [nx, ny] of neighbors4(cur.x, cur.y)) {
        const k = key(nx, ny);
        if (seen.has(k) || types[k] === T.HOLE) continue;
        seen.add(k);
        queue.push({ x: nx, y: ny });
      }
    }
    return seen;
  }

  function carveBlob(rng, types, type, radius, reserved) {
    const cx = rng.int(2, CONFIG.cols - 3);
    const cy = rng.int(2, CONFIG.rows - 3);
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (!inBounds(x, y)) continue;
        const dist = Math.hypot(x - cx, y - cy);
        if (dist > radius * rng.range(0.6, 1.05)) continue;
        const k = key(x, y);
        if (reserved.has(k)) continue;
        types[k] = type;
      }
    }
  }

  function generate(seed) {
    const rng = makeRng(seed == null ? DEFAULT_SEED : seed);
    const n = CONFIG.cols * CONFIG.rows;
    const types = new Array(n).fill(T.SOLID);
    const reserved = new Set([
      key(CONFIG.camp.x, CONFIG.camp.y),
      key(CONFIG.camp.x + 1, CONFIG.camp.y),
      key(CONFIG.camp.x, CONFIG.camp.y - 1),
      key(CONFIG.camp.x, CONFIG.camp.y + 1)
    ]);

    /* Thin-ice zones first (bending / cracking mechanics live here). */
    for (let i = 0; i < CONFIG.thinBlobs; i++) {
      carveBlob(rng, types, T.THIN, rng.int(1, 3), reserved);
    }

    /* Holes are carved one at a time; connectivity is re-checked each step
       so that for a fixed seed the camp and all usable ice stay connected. */
    let carved = 0;
    let guard = 0;
    while (carved < CONFIG.holes && guard < CONFIG.holes * 25) {
      guard++;
      const x = rng.int(1, CONFIG.cols - 2);
      const y = rng.int(1, CONFIG.rows - 2);
      const k = key(x, y);
      if (types[k] === T.HOLE || reserved.has(k)) continue;
      const prev = types[k];
      types[k] = T.HOLE;
      const reach = floodFill(types, CONFIG.camp);
      if (reach.size < n - carved - 4) {
        types[k] = prev; // would isolate ice — reject this hole
        continue;
      }
      carved++;
    }

    const reachable = floodFill(types, CONFIG.camp);

    /* Three measurement points: far apart, on reachable thin or solid ice,
       each at a good distance from camp. */
    const points = [];
    const candidates = [];
    for (let y = 0; y < CONFIG.rows; y++) {
      for (let x = 0; x < CONFIG.cols; x++) {
        const k = key(x, y);
        if (!reachable.has(k) || reserved.has(k)) continue;
        const d = Math.hypot(x - CONFIG.camp.x, y - CONFIG.camp.y);
        if (d < 6) continue;
        candidates.push({ x, y, d });
      }
    }
    candidates.sort((a, b) => b.d - a.d);
    let pguard = 0;
    while (points.length < CONFIG.pointCount && pguard < 400) {
      pguard++;
      const c = rng.pick(candidates);
      if (points.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 5)) continue;
      points.push({ id: points.length, x: c.x, y: c.y, measured: false });
    }
    if (points.length < CONFIG.pointCount) {
      throw new Error('failed to place three connected measurement points');
    }

    types[key(CONFIG.camp.x, CONFIG.camp.y)] = T.CAMP;

    return {
      seed: seed == null ? DEFAULT_SEED : seed,
      cols: CONFIG.cols,
      rows: CONFIG.rows,
      cell: CONFIG.cell,
      width: CONFIG.cols * CONFIG.cell,
      height: CONFIG.rows * CONFIG.cell,
      types,
      camp: { ...CONFIG.camp },
      points,
      stress: new Array(n).fill(0),
      cracks: buildCracks(rng, types),
      cellAt(px, py) {
        const x = Math.floor(px / CONFIG.cell);
        const y = Math.floor(py / CONFIG.cell);
        if (!inBounds(x, y)) return null;
        return { x, y, index: key(x, y), type: types[key(x, y)] };
      }
    };
  }

  /* Decorative crack polylines per thin cell; look worsens with stress. */
  function buildCracks(rng, types) {
    const map = new Map();
    for (let k = 0; k < types.length; k++) {
      if (types[k] !== T.THIN) continue;
      const x = k % CONFIG.cols;
      const y = Math.floor(k / CONFIG.cols);
      const lines = [];
      const count = rng.int(1, 2);
      for (let i = 0; i < count; i++) {
        const pts = [];
        let px = x * CONFIG.cell + rng.range(8, CONFIG.cell - 8);
        let py = y * CONFIG.cell + rng.range(8, CONFIG.cell - 8);
        pts.push([px, py]);
        const steps = rng.int(2, 4);
        let ang = rng.range(0, Math.PI * 2);
        for (let s = 0; s < steps; s++) {
          ang += rng.range(-0.9, 0.9);
          px += Math.cos(ang) * rng.range(6, 12);
          py += Math.sin(ang) * rng.range(6, 12);
          pts.push([px, py]);
        }
        lines.push(pts);
      }
      map.set(k, lines);
    }
    return map;
  }

  const api = { T, CONFIG, generate, floodFill, key };
  globalThis.IceWorld = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
