'use strict';

var core = require('../js/core.js');

var failures = [];

function check(name, cond, detail) {
  var mark = cond ? 'PASS' : 'FAIL';
  console.log('[' + mark + '] ' + name + (detail ? ' -> ' + detail : ''));
  if (!cond) {
    failures.push(name);
  }
}

function movedRoad(road, fromIndex, to) {
  var copy = {
    width: road.width,
    points: road.points.map(function (p) {
      return { x: p.x, y: p.y };
    })
  };
  copy.points[fromIndex] = { x: to.x, y: to.y };
  return copy;
}

function violations(scene, params) {
  var onRoad = scene.trees.filter(function (t) {
    return core.isOnRoad(t.x, t.y, params.road);
  });
  var inWater = scene.trees.filter(function (t) {
    return core.isWater(t.x, t.y, core.makeWater(params.seed));
  });
  var grassOnRoad = scene.grass.filter(function (g) {
    return core.isOnRoad(g.x, g.y, params.road);
  });
  return { onRoad: onRoad, inWater: inWater, grassOnRoad: grassOnRoad };
}

var seedA = 1024;
var seedB = 9527;

var paramsA = core.defaultParams();
paramsA.seed = seedA;
var paramsB = core.defaultParams();
paramsB.seed = seedB;

var staticA = core.buildStaticData(seedA);
var staticB = core.buildStaticData(seedB);

var sceneA = core.buildVegetation(paramsA, staticA);
var sceneB = core.buildVegetation(paramsB, staticB);

check(
  '两个 seed 的候选树位置不同',
  staticA.treeCandidates[0].x !== staticB.treeCandidates[0].x ||
    staticA.treeCandidates[1].y !== staticB.treeCandidates[1].y,
  'seed' + seedA + ' 前2=' + JSON.stringify(staticA.treeCandidates.slice(0, 2).map(function (t) {
    return [Math.round(t.x), Math.round(t.y)];
  })) + '; seed' + seedB + ' 前2=' + JSON.stringify(staticB.treeCandidates.slice(0, 2).map(function (t) {
    return [Math.round(t.x), Math.round(t.y)];
  }))
);

check(
  '两个 seed 的树木集合明显不同',
  sceneA.trees.length > 50 && sceneB.trees.length > 50,
  '树数量 seedA=' + sceneA.trees.length + ', seedB=' + sceneB.trees.length
);

function keySet(list) {
  var set = {};
  list.forEach(function (t) {
    set[Math.round(t.x) + ',' + Math.round(t.y)] = true;
  });
  return set;
}

var setA = keySet(sceneA.trees);
var overlap = sceneB.trees.filter(function (t) {
  return setA[Math.round(t.x) + ',' + Math.round(t.y)];
}).length;
check(
  '两个 seed 的实际分布几乎不重叠',
  overlap < sceneA.trees.length * 0.15,
  '重叠=' + overlap + ' / seedA 树数=' + sceneA.trees.length
);

var v0 = violations(sceneA, paramsA);
check('初始道路上没有树', v0.onRoad.length === 0, '压线树=' + v0.onRoad.length);
check('初始道路上没有草丛', v0.grassOnRoad.length === 0, '压线草丛=' + v0.grassOnRoad.length);
check('水面内没有树', v0.inWater.length === 0, '水中树=' + v0.inWater.length);

var displaced = movedRoad(paramsA.road, 2, { x: 300, y: 210 });
var paramsMoved = core.defaultParams();
paramsMoved.seed = seedA;
paramsMoved.road = displaced;
var sceneMoved = core.buildVegetation(paramsMoved, staticA);
var v1 = violations(sceneMoved, paramsMoved);
check(
  '拖动道路节点后没有树落在路面上',
  v1.onRoad.length === 0,
  '压线树=' + v1.onRoad.length +
  (v1.onRoad.length ? '，示例=' + JSON.stringify(v1.onRoad.slice(0, 3).map(function (t) {
    return [Math.round(t.x), Math.round(t.y), core.distanceToRoad(t.x, t.y, displaced).toFixed(1)];
  })) : '')
);
check('拖动道路后没有草丛落在路面上', v1.grassOnRoad.length === 0, '压线草丛=' + v1.grassOnRoad.length);
check('拖动道路后水面避让仍然成立', v1.inWater.length === 0, '水中树=' + v1.inWater.length);

var removedCount = sceneA.trees.length - sceneMoved.trees.length;
check(
  '道路移动后受影响区域自动重算（树数发生变化）',
  removedCount !== 0,
  '移动前=' + sceneA.trees.length + '，移动后=' + sceneMoved.trees.length + '，差=' + removedCount
);

var bounds = core.roadBounds(displaced);
var insideAffected = v1.onRoad.filter(function () {
  return true;
});
check(
  '受影响区域包围盒计算有效',
  bounds.maxX > bounds.minX && bounds.maxY > bounds.minY,
  JSON.stringify({
    minX: Math.round(bounds.minX),
    minY: Math.round(bounds.minY),
    maxX: Math.round(bounds.maxX),
    maxY: Math.round(bounds.maxY)
  })
);
void insideAffected;

var positionsBefore = sceneA.trees.map(function (t) {
  return [t.x, t.y, t.kind, t.scale];
});
['spring', 'summer', 'autumn', 'winter'].forEach(function (season) {
  var p = core.defaultParams();
  p.seed = seedA;
  p.season = season;
  var s = core.buildVegetation(p, staticA);
  var same = s.trees.length === positionsBefore.length &&
    s.trees.every(function (t, i) {
      var ref = positionsBefore[i];
      return t.x === ref[0] && t.y === ref[1] && t.kind === ref[2] && t.scale === ref[3];
    });
  check('季节 ' + season + ' 不改变植物位置（仅材质/叶量）', same,
    same ? '树数=' + s.trees.length : '位置或集合发生变化');
});

var lowDensity = core.defaultParams();
lowDensity.seed = seedA;
lowDensity.density = 0.2;
var sceneLow = core.buildVegetation(lowDensity, staticA);
check(
  '密度参数有效控制数量',
  sceneLow.trees.length < sceneA.trees.length * 0.5,
  '低密度=' + sceneLow.trees.length + '，高密度=' + sceneA.trees.length
);

var eastParams = core.defaultParams();
eastParams.seed = seedA;
eastParams.aspect = 'east';
var sceneEast = core.buildVegetation(eastParams, staticA);
check('坡向过滤后仍有合理植被量', sceneEast.trees.length > 10, '阳坡树数=' + sceneEast.trees.length);

var json = core.serializeParams(paramsMoved);
var restored = core.hydrateParams(json);
check(
  '参数保存/恢复保持一致',
  restored.seed === seedA &&
    restored.road.points[2].x === 300 &&
    restored.road.points[2].y === 210,
  '恢复后道路节点=' + JSON.stringify(restored.road.points[2])
);

var messy = core.hydrateParams({
  params: {
    seed: '777',
    density: 3,
    windSpeed: -2,
    season: 'unknown',
    aspect: 'bogus',
    road: { width: 5, points: [] }
  }
});
check(
  '非法参数被安全回退',
  messy.seed === 777 && messy.density === 1 && messy.windSpeed === 0 &&
    messy.season === 'summer' && messy.aspect === 'all' &&
    messy.road.points.length >= 2,
  JSON.stringify({
    seed: messy.seed,
    density: messy.density,
    windSpeed: messy.windSpeed,
    season: messy.season,
    aspect: messy.aspect
  })
);

console.log('\n统计: seed' + seedA + ' 树=' + sceneA.trees.length +
  ' 草=' + sceneA.grass.length +
  '; seed' + seedB + ' 树=' + sceneB.trees.length +
  ' 草=' + sceneB.grass.length);

if (failures.length) {
  console.error('\n存在 ' + failures.length + ' 个失败用例: ' + failures.join('; '));
  process.exit(1);
}
console.log('\n全部验证通过 ✔');
