/*
 * 纯逻辑核心：随机数、地形噪声、水面/道路避让、植被分布、季节参数。
 * 不依赖 DOM，可同时被浏览器 (app.js) 与 Node (verify.js) 引用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MeadowCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WORLD_W = 960;
  var WORLD_H = 600;

  function u32(n) {
    return (n >>> 0);
  }

  function hash2(ix, iy, seed) {
    var h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }

  function mulberry32(a) {
    a = u32(a);
    return function () {
      a = u32(a + 0x6D2B79F5);
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  function valueNoise(x, y, scale, seed) {
    var gx = x / scale;
    var gy = y / scale;
    var ix = Math.floor(gx);
    var iy = Math.floor(gy);
    var fx = smooth(gx - ix);
    var fy = smooth(gy - iy);
    var a = hash2(ix, iy, seed);
    var b = hash2(ix + 1, iy, seed);
    var c = hash2(ix, iy + 1, seed);
    var d = hash2(ix + 1, iy + 1, seed);
    var top = a + (b - a) * fx;
    var bot = c + (d - c) * fx;
    return top + (bot - top) * fy;
  }

  function elevation(x, y, seed) {
    var n1 = valueNoise(x, y, 220, seed);
    var n2 = valueNoise(x, y, 90, seed ^ 0x9e3779b9);
    return 0.72 * n1 + 0.28 * n2;
  }

  function gradient(x, y, seed) {
    var e = 2;
    var dx = elevation(x + e, y, seed) - elevation(x - e, y, seed);
    var dy = elevation(x, y + e, seed) - elevation(x, y - e, seed);
    return { dx: dx, dy: dy };
  }

  function aspectInfo(x, y, seed) {
    var g = gradient(x, y, seed);
    var angle = Math.atan2(g.dy, g.dx);
    var steepness = Math.sqrt(g.dx * g.dx + g.dy * g.dy);
    return { angle: angle, steepness: steepness };
  }

  var ASPECT_MODES = {
    all: { label: '任意坡向', target: null },
    east: { label: '阳坡（东坡向）', target: 0 },
    south: { label: '南坡向', target: Math.PI / 2 },
    ridge: { label: '脊线（陡坡优先）', target: null }
  };

  function aspectScore(x, y, seed, mode) {
    var info = aspectInfo(x, y, seed);
    if (mode === 'ridge') {
      return Math.min(1, info.steepness * 18);
    }
    var target = ASPECT_MODES[mode] ? ASPECT_MODES[mode].target : null;
    if (target === null || target === undefined) {
      return 0.85;
    }
    var diff = Math.atan2(Math.sin(info.angle - target), Math.cos(info.angle - target));
    return 0.25 + 0.75 * Math.max(0, Math.cos(diff));
  }

  function makeWater(seed) {
    var rng = mulberry32(seed ^ 0x51ed270b);
    var cx = WORLD_W * 0.82;
    var cy = WORLD_H * 0.72;
    var rx = WORLD_W * 0.14;
    var ry = WORLD_H * 0.11;
    var lake = [];
    var lobes = 14;
    for (var i = 0; i < lobes; i++) {
      var a = (i / lobes) * Math.PI * 2;
      var wobble = 0.78 + rng() * 0.42;
      lake.push({
        x: cx + Math.cos(a) * rx * wobble,
        y: cy + Math.sin(a) * ry * wobble
      });
    }
    var px = WORLD_W * 0.16;
    var py = WORLD_H * 0.2;
    var pond = [];
    for (var j = 0; j < 10; j++) {
      var b = (j / 10) * Math.PI * 2;
      var w2 = 0.82 + rng() * 0.36;
      pond.push({
        x: px + Math.cos(b) * 46 * w2,
        y: py + Math.sin(b) * 30 * w2
      });
    }
    return [lake, pond];
  }

  function pointInPolygon(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i].x;
      var yi = poly[i].y;
      var xj = poly[j].x;
      var yj = poly[j].y;
      var intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) {
        inside = !inside;
      }
    }
    return inside;
  }

  function isWater(x, y, waterPolys) {
    for (var i = 0; i < waterPolys.length; i++) {
      if (pointInPolygon(x, y, waterPolys[i])) {
        return true;
      }
    }
    return false;
  }

  function distToSegment(px, py, ax, ay, bx, by) {
    var vx = bx - ax;
    var vy = by - ay;
    var wx = px - ax;
    var wy = py - ay;
    var lenSq = vx * vx + vy * vy;
    var t = lenSq > 0 ? (wx * vx + wy * vy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = ax + t * vx;
    var cy = ay + t * vy;
    return Math.hypot(px - cx, py - cy);
  }

  function distanceToRoad(x, y, road) {
    var pts = road.points;
    if (!pts || pts.length === 0) {
      return Infinity;
    }
    if (pts.length === 1) {
      return Math.hypot(x - pts[0].x, y - pts[0].y);
    }
    var best = Infinity;
    for (var i = 0; i < pts.length - 1; i++) {
      var d = distToSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      if (d < best) {
        best = d;
      }
    }
    return best;
  }

  function isOnRoad(x, y, road) {
    return distanceToRoad(x, y, road) <= road.width / 2;
  }

  function roadBounds(road, pad) {
    pad = pad || road.width / 2 + 8;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    road.points.forEach(function (p) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
    return {
      minX: minX - pad,
      minY: minY - pad,
      maxX: maxX + pad,
      maxY: maxY + pad
    };
  }

  var TREE_POOL = 420;
  var GRASS_COLS = 64;
  var GRASS_ROWS = 40;

  function makeTreeCandidates(seed, waterPolys) {
    var rng = mulberry32(seed ^ 0x77a7);
    var list = [];
    var guard = 0;
    while (list.length < TREE_POOL && guard < TREE_POOL * 40) {
      guard++;
      var x = rng() * WORLD_W;
      var y = rng() * WORLD_H;
      if (isWater(x, y, waterPolys)) {
        continue;
      }
      var kindRoll = rng();
      list.push({
        x: x,
        y: y,
        kind: kindRoll < 0.22 ? 'pine' : 'broad',
        scale: 0.72 + rng() * 0.62,
        phase: rng() * Math.PI * 2,
        h1: hash2(list.length + 7, seed, 101),
        h2: hash2(list.length + 7, seed, 202),
        h3: hash2(list.length + 7, seed, 303)
      });
    }
    return list;
  }

  function makeGrassCandidates(seed, waterPolys) {
    var list = [];
    var cellW = WORLD_W / GRASS_COLS;
    var cellH = WORLD_H / GRASS_ROWS;
    for (var row = 0; row < GRASS_ROWS; row++) {
      for (var col = 0; col < GRASS_COLS; col++) {
        var jx = hash2(col, row, seed ^ 0x11) - 0.5;
        var jy = hash2(col, row, seed ^ 0x22) - 0.5;
        var x = (col + 0.5 + jx * 0.82) * cellW;
        var y = (row + 0.5 + jy * 0.82) * cellH;
        if (isWater(x, y, waterPolys)) {
          continue;
        }
        list.push({
          x: x,
          y: y,
          phase: hash2(col, row, seed ^ 0x33) * Math.PI * 2,
          blades: 3 + Math.floor(hash2(col, row, seed ^ 0x44) * 3),
          h1: hash2(col, row, 505),
          h2: hash2(col, row, 606)
        });
      }
    }
    return list;
  }

  function buildVegetation(params, staticData) {
    var density = params.density;
    var aspect = params.aspect;
    var trees = [];
    var grass = [];

    staticData.treeCandidates.forEach(function (c, idx) {
      if (isOnRoad(c.x, c.y, params.road)) {
        return;
      }
      var aScore = aspectScore(c.x, c.y, params.seed, aspect);
      var keep = c.h1 < density && c.h2 < aScore;
      if (keep) {
        trees.push(c);
      }
    });

    staticData.grassCandidates.forEach(function (c) {
      if (isOnRoad(c.x, c.y, params.road)) {
        return;
      }
      if (c.h1 < 0.35 + density * 0.6) {
        grass.push(c);
      }
    });

    trees.sort(function (a, b) {
      return a.y - b.y;
    });
    grass.sort(function (a, b) {
      return a.y - b.y;
    });
    return { trees: trees, grass: grass };
  }

  function buildStaticData(seed) {
    var waterPolys = makeWater(seed);
    return {
      waterPolys: waterPolys,
      treeCandidates: makeTreeCandidates(seed, waterPolys),
      grassCandidates: makeGrassCandidates(seed, waterPolys)
    };
  }

  var SEASONS = {
    spring: {
      label: '春',
      ground: '#8fbf63',
      groundShade: '#6ea04a',
      hillA: 'rgba(126, 178, 92, 0.55)',
      hillB: 'rgba(176, 214, 130, 0.35)',
      broad: ['#5ea33f', '#79bd52', '#93ce68'],
      pine: ['#2f6b3a', '#3d8247', '#4f9756'],
      grass: ['#6fae43', '#86c457', '#5d9a38'],
      leafAmount: 0.92,
      trunk: '#6b4a30',
      snow: 0
    },
    summer: {
      label: '夏',
      ground: '#5f9e3c',
      groundShade: '#467f2b',
      hillA: 'rgba(84, 150, 60, 0.55)',
      hillB: 'rgba(128, 184, 88, 0.35)',
      broad: ['#2f7d2c', '#3f9536', '#57ab45'],
      pine: ['#21552e', '#2c6b38', '#377e43'],
      grass: ['#3f8f33', '#55a643', '#357d2b'],
      leafAmount: 1,
      trunk: '#5f432c',
      snow: 0
    },
    autumn: {
      label: '秋',
      ground: '#a98a44',
      groundShade: '#856a2f',
      hillA: 'rgba(176, 134, 66, 0.55)',
      hillB: 'rgba(206, 170, 96, 0.35)',
      broad: ['#c9772b', '#d99a37', '#b8532a'],
      pine: ['#355f33', '#41723d', '#4f8349'],
      grass: ['#b08a3e', '#c2a155', '#94702e'],
      leafAmount: 0.72,
      trunk: '#5f432c',
      snow: 0
    },
    winter: {
      label: '冬',
      ground: '#dfe6ec',
      groundShade: '#b9c6d2',
      hillA: 'rgba(206, 218, 228, 0.6)',
      hillB: 'rgba(232, 238, 244, 0.4)',
      broad: ['#8a97a3', '#9aa7b2', '#7c8995'],
      pine: ['#2c4a3f', '#385c4d', '#47705d'],
      grass: ['#b9c6a4', '#cdd7bb', '#a7b692'],
      leafAmount: 0.28,
      trunk: '#55463c',
      snow: 0.75
    }
  };

  function defaultParams() {
    return {
      seed: 1024,
      density: 0.8,
      aspect: 'all',
      windSpeed: 1.4,
      season: 'summer',
      road: {
        width: 30,
        points: [
          { x: -20, y: 500 },
          { x: 240, y: 430 },
          { x: 470, y: 470 },
          { x: 720, y: 350 },
          { x: 980, y: 300 }
        ]
      }
    };
  }

  var PARAM_KEYS = ['seed', 'density', 'aspect', 'windSpeed', 'season', 'road'];

  function serializeParams(params) {
    var out = {};
    PARAM_KEYS.forEach(function (k) {
      out[k] = params[k];
    });
    return JSON.stringify({ version: 1, params: out }, null, 2);
  }

  function hydrateParams(json) {
    var data = typeof json === 'string' ? JSON.parse(json) : json;
    var base = defaultParams();
    var p = data && data.params ? data.params : data;
    PARAM_KEYS.forEach(function (k) {
      if (p[k] !== undefined) {
        base[k] = p[k];
      }
    });
    base.seed = Math.floor(Number(base.seed)) || 1;
    base.density = Math.min(1, Math.max(0, Number(base.density)));
    base.windSpeed = Math.min(5, Math.max(0, Number(base.windSpeed)));
    if (!SEASONS[base.season]) {
      base.season = 'summer';
    }
    if (!ASPECT_MODES[base.aspect]) {
      base.aspect = 'all';
    }
    if (!base.road || !Array.isArray(base.road.points) || base.road.points.length < 2) {
      base.road = defaultParams().road;
    }
    base.road.width = Math.max(8, Math.min(80, Number(base.road.width) || 30));
    return base;
  }

  return {
    WORLD_W: WORLD_W,
    WORLD_H: WORLD_H,
    hash2: hash2,
    mulberry32: mulberry32,
    valueNoise: valueNoise,
    elevation: elevation,
    aspectInfo: aspectInfo,
    aspectScore: aspectScore,
    ASPECT_MODES: ASPECT_MODES,
    makeWater: makeWater,
    pointInPolygon: pointInPolygon,
    isWater: isWater,
    distToSegment: distToSegment,
    distanceToRoad: distanceToRoad,
    isOnRoad: isOnRoad,
    roadBounds: roadBounds,
    TREE_POOL: TREE_POOL,
    makeTreeCandidates: makeTreeCandidates,
    makeGrassCandidates: makeGrassCandidates,
    buildVegetation: buildVegetation,
    buildStaticData: buildStaticData,
    SEASONS: SEASONS,
    defaultParams: defaultParams,
    serializeParams: serializeParams,
    hydrateParams: hydrateParams
  };
});
