/* 两套预置场景：一套有解、一套无解（中央布景封死机位）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CameraScenarios = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STAGE = { id: 'stage', name: '舞台', x: 0, y: 0, w: 1000, h: 600 };

  /* 场景 A：两名角色分居两侧，中央无遮挡，任意常用焦段都能同框。 */
  var solvable = {
    id: 'solvable',
    name: '场景 A · 可解：双人中景',
    stage: STAGE,
    characters: [
      { id: 'A', name: '角色 A', x: 330, y: 300, r: 42, margin: 24 },
      { id: 'B', name: '角色 B', x: 670, y: 300, r: 42, margin: 24 }
    ],
    set: [
      { id: 'pillarL', name: '左立柱', x: 40, y: 120, w: 70, h: 360 },
      { id: 'pillarR', name: '右立柱', x: 890, y: 120, w: 70, h: 360 }
    ],
    focal: 50,
    aspect: 16 / 9,
    lock: null,
    relax: { stage: false, set: false }
  };

  /* 场景 B：一道贯穿上下的高墙横在两人之间，任何能同时框住两人的
     取景框都会与墙相交 -> 无解；放宽布景约束后立刻可解。 */
  var infeasible = {
    id: 'infeasible',
    name: '场景 B · 无解：布景封死机位',
    stage: STAGE,
    characters: [
      { id: 'A', name: '角色 A', x: 300, y: 300, r: 42, margin: 24 },
      { id: 'B', name: '角色 B', x: 700, y: 300, r: 42, margin: 24 }
    ],
    set: [
      { id: 'wall', name: '中央高墙', x: 470, y: 0, w: 60, h: 600 }
    ],
    focal: 50,
    aspect: 16 / 9,
    lock: null,
    relax: { stage: false, set: false }
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function load(id) {
    var base = id === 'infeasible' ? infeasible : solvable;
    return clone(base);
  }

  return {
    STAGE: STAGE,
    solvable: solvable,
    infeasible: infeasible,
    load: load,
    clone: clone
  };
});
