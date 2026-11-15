/*
 * 2D 舞台相机取景求解器（纯几何，无 DOM 依赖，可在 Node 中测试）。
 *
 * 模型：相机取景框是一个轴对齐矩形 view（宽 viewW、高 viewH，
 * 宽高比固定，焦段越长视野越窄）。相机位置即取景框中心。
 *
 * 约束：
 *  1. 入镜：角色（含安全边距）必须完整落在取景框内；
 *  2. 舞台边界：取景框不能越过舞台矩形；
 *  3. 布景：取景框不能与布景矩形相交（等价于相机中心不能进入
 *     “布景按取景框半宽半高扩张”后的禁入矩形）；
 *  4. 锁定角色：相机中心尽量贴近被锁定角色；
 *  5. 放宽：可临时关闭舞台边界 / 布景约束。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CameraSolver = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPS = 1e-6;
  var REFERENCE_FOCAL = 50;       // 参考焦段（毫米）
  var REFERENCE_VIEW_W = 600;     // 参考焦段下的取景宽度（舞台单位）
  var DEFAULT_ASPECT = 16 / 9;

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function rect(x, y, w, h) {
    return { x: x, y: y, w: w, h: h };
  }

  function rectFromCenter(cx, cy, w, h) {
    return rect(cx - w / 2, cy - h / 2, w, h);
  }

  function rectCenter(r) {
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  function rectIntersect(a, b) {
    var x = Math.max(a.x, b.x);
    var y = Math.max(a.y, b.y);
    var right = Math.min(a.x + a.w, b.x + b.w);
    var bottom = Math.min(a.y + a.h, b.y + b.h);
    if (right < x - EPS || bottom < y - EPS) return null;
    return rect(x, y, Math.max(0, right - x), Math.max(0, bottom - y));
  }

  function rectContainsPoint(r, p) {
    return p.x >= r.x - EPS && p.x <= r.x + r.w + EPS &&
      p.y >= r.y - EPS && p.y <= r.y + r.h + EPS;
  }

  function rectClampPoint(r, x, y) {
    return {
      x: clamp(x, r.x, r.x + r.w),
      y: clamp(y, r.y, r.y + r.h)
    };
  }

  function rectCorners(r) {
    return [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h }
    ];
  }

  function dist(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* 焦段 -> 取景尺寸：焦距与视野宽度成反比。 */
  function viewSize(focal, aspect, referenceViewWidth) {
    var f = focal > 0 ? focal : REFERENCE_FOCAL;
    var ar = aspect > 0 ? aspect : DEFAULT_ASPECT;
    var refW = referenceViewWidth > 0 ? referenceViewWidth : REFERENCE_VIEW_W;
    var w = refW * REFERENCE_FOCAL / f;
    return { w: w, h: w / ar };
  }

  /* 角色 i 完整入镜时，相机中心允许所在的矩形。 */
  function characterRegion(ch, viewW, viewH) {
    var r = ch.r + (ch.margin || 0);
    return rect(
      ch.x - viewW / 2 + r,
      ch.y - viewH / 2 + r,
      viewW - 2 * r,
      viewH - 2 * r
    );
  }

  /* 取景框不越出舞台时，相机中心允许所在的矩形。 */
  function stageRegion(stage, viewW, viewH) {
    return rect(
      stage.x + viewW / 2,
      stage.y + viewH / 2,
      Math.max(0, stage.w - viewW),
      Math.max(0, stage.h - viewH)
    );
  }

  /* 取景框不与布景相交时，相机中心的禁入矩形（布景扩张取景框半尺寸）。 */
  function obstacleForbidden(ob, viewW, viewH) {
    return rect(
      ob.x - viewW / 2,
      ob.y - viewH / 2,
      ob.w + viewW,
      ob.h + viewH
    );
  }

  function degenerate(r) {
    return r.w < -EPS || r.h < -EPS;
  }

  /* 快速诊断：在还没做细分搜索前找出明确的硬冲突来源。 */
  function diagnose(input, viewW, viewH, enforceStage, enforceSet) {
    var conflicts = [];
    var a = input.characters[0];
    var b = input.characters[1];

    var ra = a.r + (a.margin || 0);
    var rb = b.r + (b.margin || 0);
    var pairW = viewW - ra - rb;
    var pairH = viewH - ra - rb;
    if (pairW < -EPS || pairH < -EPS) {
      conflicts.push({
        type: 'view-too-small',
        message: '焦段 ' + input.focal + 'mm 视野过窄：两名角色（含安全边距）无法同时入镜',
        detail: { requiredW: ra + rb, requiredH: ra + rb, viewW: viewW, viewH: viewH }
      });
    }

    var regionA = characterRegion(a, viewW, viewH);
    var regionB = characterRegion(b, viewW, viewH);
    var pair = rectIntersect(regionA, regionB);
    if (!pair) {
      conflicts.push({
        type: 'characters-too-far',
        message: '两名角色间距超过取景范围，无法同框（可缩短焦段 / 拉远相机 / 移近角色）',
        detail: { spanX: Math.abs(a.x - b.x) + ra + rb, spanY: Math.abs(a.y - b.y) + ra + rb }
      });
    }

    var base = pair;
    if (enforceStage) {
      var sr = stageRegion(input.stage, viewW, viewH);
      var viewTooBig = viewW > input.stage.w + EPS || viewH > input.stage.h + EPS;
      if (viewTooBig || degenerate(sr) || (base && !rectIntersect(base, sr))) {
        conflicts.push({
          type: 'stage-boundary',
          message: '取景框大于舞台可用区域，或角色贴边导致无法在不越过舞台边界的情况下取景',
          detail: { viewW: viewW, viewH: viewH, stage: input.stage }
        });
      } else if (base) {
        base = rectIntersect(base, sr);
      }
    }

    if (enforceSet && base && !degenerate(base)) {
      for (var i = 0; i < input.set.length; i++) {
        var ob = input.set[i];
        var forbidden = obstacleForbidden(ob, viewW, viewH);
        if (rectIntersect(base, forbidden)) {
          var covered = fullyCovered(base, forbidden);
          conflicts.push({
            type: 'set-collision',
            obstacleId: ob.id,
            obstacleName: ob.name || ob.id,
            blocking: covered,
            message: (covered ? '布景「' : '布景「') + (ob.name || ob.id) +
              (covered ? '」封死了全部候选机位' : '」挡住了部分候选机位'),
            detail: { obstacle: ob, forbidden: forbidden }
          });
        }
      }
    }

    return conflicts;
  }

  function fullyCovered(region, forbidden) {
    return forbidden.x <= region.x + EPS &&
      forbidden.y <= region.y + EPS &&
      forbidden.x + forbidden.w >= region.x + region.w - EPS &&
      forbidden.y + forbidden.h >= region.y + region.h - EPS;
  }

  /* 点是否落在禁入矩形内部（边界相切视为不穿入，允许）。 */
  function pointInForbidden(p, forbidden) {
    return p.x > forbidden.x && p.x < forbidden.x + forbidden.w &&
      p.y > forbidden.y && p.y < forbidden.y + forbidden.h;
  }

  function isFreePoint(p, forbiddenList) {
    for (var i = 0; i < forbiddenList.length; i++) {
      if (pointInForbidden(p, forbiddenList[i])) return false;
    }
    return true;
  }

  function cellIntersectsForbidden(cell, forbiddenList) {
    for (var i = 0; i < forbiddenList.length; i++) {
      var f = forbiddenList[i];
      if (f.x < cell.x + cell.w - EPS && f.x + f.w > cell.x + EPS &&
        f.y < cell.y + cell.h - EPS && f.y + f.h > cell.y + EPS) {
        return true;
      }
    }
    return false;
  }

  /* 在 base 内寻找完全不与禁入区相交的格子，返回其中心；找不到返回 null。 */
  function findFreeCell(base, forbiddenList, maxDepth) {
    if (base.w <= EPS || base.h <= EPS) return null;
    var stack = [{ r: base, depth: 0 }];
    while (stack.length) {
      var item = stack.pop();
      var cell = item.r;
      if (!cellIntersectsForbidden(cell, forbiddenList)) {
        return rectCenter(cell);
      }
      if (item.depth >= maxDepth) continue;
      var mx = cell.x + cell.w / 2;
      var my = cell.y + cell.h / 2;
      var quads = [
        rect(cell.x, cell.y, cell.w / 2, cell.h / 2),
        rect(mx, cell.y, cell.w / 2, cell.h / 2),
        rect(cell.x, my, cell.w / 2, cell.h / 2),
        rect(mx, my, cell.w / 2, cell.h / 2)
      ];
      for (var i = 0; i < quads.length; i++) {
        if (quads[i].w > EPS && quads[i].h > EPS) {
          stack.push({ r: quads[i], depth: item.depth + 1 });
        }
      }
    }
    return null;
  }

  function uniquePoints(points) {
    var out = [];
    points.forEach(function (p) {
      if (!p) return;
      for (var i = 0; i < out.length; i++) {
        if (Math.abs(out[i].x - p.x) <= EPS && Math.abs(out[i].y - p.y) <= EPS) return;
      }
      out.push(p);
    });
    return out;
  }

  function solve(input) {
    var aspect = input.aspect || DEFAULT_ASPECT;
    var size = viewSize(input.focal, aspect, input.referenceViewWidth);
    var viewW = size.w;
    var viewH = size.h;
    var relax = input.relax || {};
    var enforceStage = relax.stage !== true;
    var enforceSet = relax.set !== true;

    var regionA = characterRegion(input.characters[0], viewW, viewH);
    var regionB = characterRegion(input.characters[1], viewW, viewH);
    var pair = rectIntersect(regionA, regionB);
    var base = pair;
    var stage = null;

    if (base && enforceStage) {
      stage = stageRegion(input.stage, viewW, viewH);
      base = rectIntersect(base, stage);
    }

    var forbidden = [];
    var blockedObstacles = [];
    if (enforceSet && base) {
      input.set.forEach(function (ob) {
        var f = obstacleForbidden(ob, viewW, viewH);
        if (rectIntersect(base, f)) {
          forbidden.push(f);
          blockedObstacles.push(ob);
        }
      });
    }

    var freePoint = null;
    if (base && (base.w > EPS || base.h > EPS)) {
      var target = lockedTarget(input) || idealTarget(input);
      if (!forbidden.length) {
        freePoint = rectClampPoint(base, target.x, target.y);
      } else {
        var candidates = buildCandidates(base, forbidden, target);
        for (var i = 0; i < candidates.length; i++) {
          if (rectContainsPoint(base, candidates[i]) && isFreePoint(candidates[i], forbidden)) {
            freePoint = candidates[i];
            break;
          }
        }
        if (!freePoint) {
          freePoint = findFreeCell(base, forbidden, input.maxDepth || 10);
        }
      }
    }

    if (freePoint) {
      return {
        feasible: true,
        camera: { x: freePoint.x, y: freePoint.y },
        view: rectFromCenter(freePoint.x, freePoint.y, viewW, viewH),
        viewW: viewW,
        viewH: viewH,
        feasibleBase: base,
        forbidden: forbidden,
        relaxed: { stage: !enforceStage, set: !enforceSet },
        conflicts: []
      };
    }

    var conflicts = diagnose(input, viewW, viewH, enforceStage, enforceSet);
    if (!conflicts.length) {
      conflicts.push({
        type: 'unknown',
        message: '当前约束组合下没有可行机位'
      });
    }
    return {
      feasible: false,
      camera: null,
      view: null,
      viewW: viewW,
      viewH: viewH,
      feasibleBase: base,
      forbidden: forbidden,
      blockedObstacles: blockedObstacles,
      relaxed: { stage: !enforceStage, set: !enforceSet },
      conflicts: conflicts
    };
  }

  function lockedTarget(input) {
    if (input.lock == null) return null;
    var ch = input.characters[input.lock];
    return ch ? { x: ch.x, y: ch.y } : null;
  }

  function idealTarget(input) {
    var a = input.characters[0];
    var b = input.characters[1];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function buildCandidates(base, forbidden, target) {
    var clamped = rectClampPoint(base, target.x, target.y);
    var points = [
      { x: target.x, y: target.y },
      clamped,
      rectCenter(base),
      { x: target.x, y: base.y },
      { x: target.x, y: base.y + base.h },
      { x: base.x, y: target.y },
      { x: base.x + base.w, y: target.y },
      { x: base.x, y: base.y },
      { x: base.x + base.w, y: base.y },
      { x: base.x + base.w, y: base.y + base.h },
      { x: base.x, y: base.y + base.h }
    ];
    forbidden.forEach(function (f) {
      points = points.concat(rectCorners(f));
      points.push({ x: clamp(target.x, f.x, f.x + f.w), y: clamp(target.y, f.y, f.y + f.h) });
    });
    points.sort(function (p, q) {
      return dist(p, target) - dist(q, target);
    });
    return uniquePoints(points);
  }

  /* 直接对一帧状态求解，便于恢复关键帧时复用同一套约束逻辑。 */
  function solveFrame(frame) {
    return solve(frame);
  }

  return {
    solve: solve,
    solveFrame: solveFrame,
    viewSize: viewSize,
    characterRegion: characterRegion,
    stageRegion: stageRegion,
    obstacleForbidden: obstacleForbidden,
    rectIntersect: rectIntersect,
    rectFromCenter: rectFromCenter,
    rectCenter: rectCenter,
    rectClampPoint: rectClampPoint,
    isFreePoint: isFreePoint,
    findFreeCell: findFreeCell,
    constants: {
      EPS: EPS,
      REFERENCE_FOCAL: REFERENCE_FOCAL,
      REFERENCE_VIEW_W: REFERENCE_VIEW_W,
      DEFAULT_ASPECT: DEFAULT_ASPECT
    }
  };
});
