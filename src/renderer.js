/* Canvas 渲染：舞台、布景、角色与安全边距、禁入区、可行域、最终取景框。 */
(function (root) {
  'use strict';

  function drawRect(ctx, r, fill, stroke, lineWidth, dash) {
    ctx.save();
    if (fill) ctx.fillStyle = fill;
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth || 1;
      if (dash) ctx.setLineDash(dash);
    }
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
    ctx.restore();
  }

  function drawStage(ctx, stage) {
    ctx.fillStyle = '#f4ecd8';
    ctx.fillRect(stage.x, stage.y, stage.w, stage.h);
    ctx.strokeStyle = '#8a7a55';
    ctx.lineWidth = 3;
    ctx.strokeRect(stage.x, stage.y, stage.w, stage.h);
    ctx.strokeStyle = 'rgba(120,105,70,0.25)';
    ctx.lineWidth = 1;
    for (var gx = stage.x; gx <= stage.x + stage.w; gx += 50) {
      ctx.beginPath(); ctx.moveTo(gx, stage.y); ctx.lineTo(gx, stage.y + stage.h); ctx.stroke();
    }
    for (var gy = stage.y; gy <= stage.y + stage.h; gy += 50) {
      ctx.beginPath(); ctx.moveTo(stage.x, gy); ctx.lineTo(stage.x + stage.w, gy); ctx.stroke();
    }
  }

  function drawObstacles(ctx, set) {
    set.forEach(function (ob) {
      ctx.save();
      ctx.fillStyle = '#5d4a38';
      ctx.fillRect(ob.x, ob.y, ob.w, ob.h);
      ctx.strokeStyle = '#2e241a';
      ctx.lineWidth = 2;
      ctx.strokeRect(ob.x, ob.y, ob.w, ob.h);
      ctx.fillStyle = '#e8dcc4';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ob.name || ob.id, ob.x + ob.w / 2, ob.y + 18);
      ctx.restore();
    });
  }

  function drawForbidden(ctx, forbiddenList) {
    forbiddenList.forEach(function (f) {
      drawRect(ctx, f, 'rgba(220,90,90,0.18)', '#dc5a5a', 1.5, [7, 6]);
    });
  }

  function drawFeasible(ctx, base, forbiddenList, cellSize) {
    if (!base || base.w <= 1 || base.h <= 1) return;
    var step = cellSize || 14;
    ctx.save();
    ctx.fillStyle = 'rgba(64,192,120,0.32)';
    for (var x = base.x; x < base.x + base.w - 0.5; x += step) {
      for (var y = base.y; y < base.y + base.h - 0.5; y += step) {
        var w = Math.min(step, base.x + base.w - x);
        var h = Math.min(step, base.y + base.h - y);
        var cell = { x: x, y: y, w: w, h: h };
        var blocked = forbiddenList.some(function (f) {
          return f.x < cell.x + cell.w && f.x + f.w > cell.x &&
            f.y < cell.y + cell.h && f.y + f.h > cell.y;
        });
        if (!blocked) ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
      }
    }
    ctx.strokeStyle = '#40c078';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(base.x, base.y, base.w, base.h);
    ctx.restore();
  }

  function drawCharacters(ctx, characters, lock) {
    characters.forEach(function (ch, idx) {
      var safeR = ch.r + (ch.margin || 0);
      ctx.save();
      ctx.beginPath();
      ctx.arc(ch.x, ch.y, safeR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(216,180,74,0.12)';
      ctx.fill();
      ctx.strokeStyle = '#d8b44a';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(ch.x, ch.y, ch.r, 0, Math.PI * 2);
      ctx.fillStyle = idx === 0 ? '#3f7fd1' : '#c7633f';
      ctx.fill();
      ctx.strokeStyle = '#10161f';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ch.name || ch.id, ch.x, ch.y);

      if (lock === idx) {
        ctx.beginPath();
        ctx.arc(ch.x, ch.y, safeR + 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffd84d';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawView(ctx, view, camera) {
    if (!view) return;
    ctx.save();
    ctx.fillStyle = 'rgba(90,169,255,0.08)';
    ctx.fillRect(view.x, view.y, view.w, view.h);
    ctx.strokeStyle = '#5aa9ff';
    ctx.lineWidth = 3;
    ctx.strokeRect(view.x, view.y, view.w, view.h);

    ctx.strokeStyle = 'rgba(90,169,255,0.6)';
    ctx.lineWidth = 1;
    var thirdW = view.w / 3;
    var thirdH = view.h / 3;
    for (var i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(view.x + thirdW * i, view.y);
      ctx.lineTo(view.x + thirdW * i, view.y + view.h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(view.x, view.y + thirdH * i);
      ctx.lineTo(view.x + view.w, view.y + thirdH * i);
      ctx.stroke();
    }

    if (camera) {
      ctx.beginPath();
      ctx.arc(camera.x, camera.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#5aa9ff';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  function render(canvas, state, result) {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawStage(ctx, state.stage);
    drawObstacles(ctx, state.set);
    drawForbidden(ctx, result.forbidden || []);
    drawFeasible(ctx, result.feasibleBase, result.forbidden || []);
    drawCharacters(ctx, state.characters, state.lock);
    drawView(ctx, result.view, result.camera);

    if (!result.feasible) {
      ctx.save();
      ctx.fillStyle = 'rgba(142,40,40,0.35)';
      ctx.fillRect(state.stage.x, state.stage.y, state.stage.w, state.stage.h);
      ctx.fillStyle = '#ffd6d6';
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('无可行机位', canvas.width / 2, canvas.height / 2 - 10);
      ctx.font = '16px sans-serif';
      var first = result.conflicts[0];
      if (first) ctx.fillText(first.message, canvas.width / 2, canvas.height / 2 + 26);
      ctx.restore();
    }
  }

  root.CameraRenderer = {
    render: render,
    drawRect: drawRect
  };
})(typeof self !== 'undefined' ? self : this);
