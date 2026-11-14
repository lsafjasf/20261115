/* Three contour-aligned sowing zones. Each zone is a reachable corridor polyline + raster cell set. */
(function (global) {
  const App = (global.App = global.App || {});

  const ZONE_CFG = {
    count: 3,
    corridorWidth: 16,
    targetLength: 200,
    step: 12,
    maxSlope: 0.2,
    minSeparation: 70,
    margin: 70,
    maxTurnPerStep: 0.35,
    selfIntersectDist: 32,
  };

  function traceContour(terrain, start, targetLength) {
    const pts = [{ x: start.x, y: start.y }];
    let x = start.x;
    let y = start.y;
    let heading = terrain.contourAngle(x, y);
    const maxSteps = Math.ceil(targetLength / ZONE_CFG.step) + 4;
    for (let i = 0; i < maxSteps; i++) {
      const nx = x + Math.cos(heading) * ZONE_CFG.step;
      const ny = y + Math.sin(heading) * ZONE_CFG.step;
      if (!terrain.inBounds(nx, ny, ZONE_CFG.margin)) break;
      if (terrain.slopeAt(nx, ny) > ZONE_CFG.maxSlope) break;
      const nextHeading = terrain.contourAngle(nx, ny);
      let turn = nextHeading - heading;
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      if (Math.abs(turn) > ZONE_CFG.maxTurnPerStep) break;
      let selfHit = false;
      for (let k = 0; k < pts.length - 2; k++) {
        if (Math.hypot(nx - pts[k].x, ny - pts[k].y) < ZONE_CFG.selfIntersectDist) {
          selfHit = true;
          break;
        }
      }
      if (selfHit) break;
      x = nx;
      y = ny;
      pts.push({ x, y });
      heading = nextHeading;
      if (polylineLength(pts) >= targetLength) break;
    }
    return pts;
  }

  function polylineLength(pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    return len;
  }

  function corridorCells(pts, width, cell) {
    const half = width / 2;
    const set = new Set();
    const list = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const h = Math.atan2(b.y - a.y, b.x - a.x);
      const nx = -Math.sin(h);
      const ny = Math.cos(h);
      const minGx = Math.floor((Math.min(a.x, b.x) - half) / cell);
      const maxGx = Math.ceil((Math.max(a.x, b.x) + half) / cell);
      const minGy = Math.floor((Math.min(a.y, b.y) - half) / cell);
      const maxGy = Math.ceil((Math.max(a.y, b.y) + half) / cell);
      const segLen2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      for (let gy = minGy; gy <= maxGy; gy++) {
        for (let gx = minGx; gx <= maxGx; gx++) {
          const cx = (gx + 0.5) * cell;
          const cy = (gy + 0.5) * cell;
          const t = segLen2 === 0 ? 0 : clamp01(((cx - a.x) * (b.x - a.x) + (cy - a.y) * (b.y - a.y)) / segLen2);
          const qx = a.x + (b.x - a.x) * t;
          const qy = a.y + (b.y - a.y) * t;
          const d = (cx - qx) * nx + (cy - qy) * ny;
          if (Math.abs(d) <= half) {
            const key = gx + ',' + gy;
            if (!set.has(key)) {
              set.add(key);
              list.push([gx, gy]);
            }
          }
        }
      }
    }
    return list;
  }

  function clamp01(t) {
    return Math.max(0, Math.min(1, t));
  }

  function minDistanceToPolyline(pts, x, y) {
    let best = Infinity;
    for (const p of pts) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < best) best = d;
    }
    return best;
  }

  function polylinesSeparated(a, b, minDist) {
    for (const p of a) {
      if (minDistanceToPolyline(b, p.x, p.y) < minDist) return false;
    }
    for (const p of b) {
      if (minDistanceToPolyline(a, p.x, p.y) < minDist) return false;
    }
    return true;
  }

  function findStartCandidates(terrain, rng) {
    const candidates = [];
    const w = terrain.world.width;
    const h = terrain.world.height;
    for (let i = 0; i < 260; i++) {
      const x = ZONE_CFG.margin + rng() * (w - 2 * ZONE_CFG.margin);
      const y = ZONE_CFG.margin + rng() * (h - 2 * ZONE_CFG.margin);
      if (terrain.slopeAt(x, y) <= ZONE_CFG.maxSlope * 0.8) candidates.push({ x, y });
    }
    return candidates;
  }

  function createZones(terrain, rng, cell) {
    const zones = [];
    const candidates = findStartCandidates(terrain, rng);
    for (const start of candidates) {
      if (zones.length >= ZONE_CFG.count) break;
      const pts = traceContour(terrain, start, ZONE_CFG.targetLength);
      if (polylineLength(pts) < ZONE_CFG.targetLength * 0.7) continue;
      let ok = true;
      for (const z of zones) {
        if (!polylinesSeparated(z.polyline, pts, ZONE_CFG.minSeparation)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const cells = corridorCells(pts, ZONE_CFG.corridorWidth, cell);
      zones.push({
        id: zones.length,
        start: pts[0],
        end: pts[pts.length - 1],
        polyline: pts,
        cells,
        width: ZONE_CFG.corridorWidth,
        length: polylineLength(pts),
        coveredCount: 0,
        ratio: 0,
      });
    }
    if (zones.length < ZONE_CFG.count) {
      throw new Error('zone generation failed: only ' + zones.length + ' reachable zones');
    }
    return zones;
  }

  function zoneStats(zones, grid) {
    for (const z of zones) {
      z.coveredCount = App.Coverage.countCoveredInRegion(grid, z.cells);
      z.ratio = z.coveredCount / z.cells.length;
    }
  }

  App.Zones = { createZones, zoneStats, traceContour, corridorCells, ZONE_CFG };
  if (typeof module !== 'undefined' && module.exports) {
    require('./coverage.js');
    module.exports = App.Zones;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
