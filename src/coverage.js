/* Coverage raster + sowing bookkeeping (fresh cover, overlap waste, zone coverage stats). */
(function (global) {
  const App = (global.App = global.App || {});

  function createCoverageGrid(world, cell) {
    const nx = Math.ceil(world.width / cell);
    const ny = Math.ceil(world.height / cell);
    const covered = new Uint8Array(nx * ny);
    let touchCount = 0;

    function idx(gx, gy) {
      return gy * nx + gx;
    }

    function cellAt(x, y) {
      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      if (gx < 0 || gy < 0 || gx >= nx || gy >= ny) return null;
      return { gx, gy, index: idx(gx, gy) };
    }

    function markCell(gx, gy) {
      if (gx < 0 || gy < 0 || gx >= nx || gy >= ny) return 0;
      const i = idx(gx, gy);
      touchCount++;
      if (covered[i]) return 0;
      covered[i] = 1;
      return 1;
    }


    function isCovered(gx, gy) {
      if (gx < 0 || gy < 0 || gx >= nx || gy >= ny) return false;
      return covered[idx(gx, gy)] === 1;
    }

    function clear() {
      covered.fill(0);
      touchCount = 0;
    }

    return {
      nx,
      ny,
      cell,
      covered,
      cellAt,
      markCell,
      isCovered,
      clear,
      get touchCount() {
        return touchCount;
      },
    };
  }

  /* Mark the capsule swept from a to b with full width (m). Used once per physics step so
     successive calls tile the driven path instead of stamping overlapping rectangles. */
  function markSegment(grid, ax, ay, bx, by, width) {
    const cell = grid.cell;
    const halfW = width / 2;
    const minX = Math.floor((Math.min(ax, bx) - halfW) / cell);
    const maxX = Math.ceil((Math.max(ax, bx) + halfW) / cell);
    const minY = Math.floor((Math.min(ay, by) - halfW) / cell);
    const maxY = Math.ceil((Math.max(ay, by) + halfW) / cell);
    const segLen2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const half = cell / 2;
    let fresh = 0;
    let touched = 0;
    for (let gy = minY; gy <= maxY; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        if (gx < 0 || gy < 0 || gx >= grid.nx || gy >= grid.ny) continue;
        const cx = (gx + 0.5) * cell;
        const cy = (gy + 0.5) * cell;
        const t = segLen2 === 0 ? 0 : clamp01(((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / segLen2);
        const qx = ax + (bx - ax) * t;
        const qy = ay + (by - ay) * t;
        const dx = Math.abs(cx - qx) - half;
        const dy = Math.abs(cy - qy) - half;
        const outside = Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2;
        if (outside <= halfW * halfW) {
          touched++;
          fresh += grid.markCell(gx, gy);
        }
      }
    }
    return { fresh, wasted: touched - fresh, touched };
  }

  function clamp01(t) {
    return Math.max(0, Math.min(1, t));
  }

  function countCoveredInRegion(grid, cellSet) {
    let coveredCount = 0;
    for (let i = 0; i < cellSet.length; i++) {
      const [gx, gy] = cellSet[i];
      if (grid.isCovered(gx, gy)) coveredCount++;
    }
    return coveredCount;
  }

  App.Coverage = { createCoverageGrid, markSegment, countCoveredInRegion };
  if (typeof module !== 'undefined' && module.exports) module.exports = App.Coverage;
})(typeof globalThis !== 'undefined' ? globalThis : this);
