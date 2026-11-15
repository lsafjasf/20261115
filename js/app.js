'use strict';

(function () {
  var C = window.MeadowCore;
  var W = C.WORLD_W;
  var H = C.WORLD_H;

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');

  var groundCanvas = document.createElement('canvas');
  groundCanvas.width = W;
  groundCanvas.height = H;
  var gctx = groundCanvas.getContext('2d');

  var HALF_W = 240;
  var HALF_H = 150;
  var terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = HALF_W;
  terrainCanvas.height = HALF_H;
  var tctx = terrainCanvas.getContext('2d');

  var params = loadStored() || C.defaultParams();
  var staticData = C.buildStaticData(params.seed);
  var scene = C.buildVegetation(params, staticData);

  var drag = null;
  var hoverNode = -1;
  var flashBox = null;
  var flashUntil = 0;
  var frame = 0;

  var els = {};
  [
    'seed', 'seedVal', 'density', 'densityVal', 'aspect', 'aspectVal',
    'wind', 'windVal', 'seasonRow', 'roadWidth', 'roadWidthVal', 'stats',
    'screenshot', 'save', 'restore', 'reset', 'exportBtn', 'importFile', 'toast'
  ].forEach(function (id) {
    els[id] = document.getElementById(id);
  });

  function loadStored() {
    try {
      var raw = localStorage.getItem('meadow-params-v1');
      return raw ? C.hydrateParams(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function showToast(text) {
    els.toast.textContent = text;
    els.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () {
      els.toast.classList.remove('show');
    }, 1800);
  }

  function hexToRgb(hex) {
    var v = hex.replace('#', '');
    return {
      r: parseInt(v.slice(0, 2), 16),
      g: parseInt(v.slice(2, 4), 16),
      b: parseInt(v.slice(4, 6), 16)
    };
  }

  function shade(rgb, factor) {
    return 'rgb(' +
      Math.max(0, Math.min(255, Math.round(rgb.r * factor))) + ',' +
      Math.max(0, Math.min(255, Math.round(rgb.g * factor))) + ',' +
      Math.max(0, Math.min(255, Math.round(rgb.b * factor))) + ')';
  }

  function rebuildVegetation() {
    scene = C.buildVegetation(params, staticData);
    updateStats();
  }

  function rebuildStatic() {
    staticData = C.buildStaticData(params.seed);
    rebuildVegetation();
    renderGround();
  }

  function markAffected() {
    flashBox = C.roadBounds(params.road);
    flashUntil = performance.now() + 900;
  }

  function renderTerrainBase() {
    var season = C.SEASONS[params.season];
    var base = hexToRgb(season.ground);
    var img = tctx.createImageData(HALF_W, HALF_H);
    var data = img.data;
    for (var py = 0; py < HALF_H; py++) {
      for (var px = 0; px < HALF_W; px++) {
        var wx = (px + 0.5) / HALF_W * W;
        var wy = (py + 0.5) / HALF_H * H;
        var e = C.elevation(wx, wy, params.seed);
        var info = C.aspectInfo(wx, wy, params.seed);
        var light = 0.82 + (e - 0.5) * 0.34 +
          Math.cos(info.angle - 0.6) * info.steepness * 2.2;
        light = Math.max(0.62, Math.min(1.18, light));
        var idx = (py * HALF_W + px) * 4;
        data[idx] = Math.max(0, Math.min(255, base.r * light));
        data[idx + 1] = Math.max(0, Math.min(255, base.g * light));
        data[idx + 2] = Math.max(0, Math.min(255, base.b * light));
        data[idx + 3] = 255;
      }
    }
    tctx.putImageData(img, 0, 0);
  }

  function drawWater() {
    var season = C.SEASONS[params.season];
    staticData.waterPolys.forEach(function (poly, pi) {
      gctx.save();
      gctx.beginPath();
      gctx.moveTo(poly[0].x, poly[0].y);
      poly.slice(1).forEach(function (p) {
        gctx.lineTo(p.x, p.y);
      });
      gctx.closePath();
      var grad = gctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#4d86a8');
      grad.addColorStop(1, '#33627f');
      gctx.fillStyle = grad;
      gctx.fill();
      gctx.clip();
      gctx.strokeStyle = 'rgba(255,255,255,0.35)';
      gctx.lineWidth = 1.2;
      for (var i = 0; i < 6; i++) {
        var yy = poly.reduce(function (s, p) { return s + p.y; }, 0) / poly.length - 18 + i * 7;
        gctx.beginPath();
        gctx.moveTo(poly[0].x - 30 + pi * 10, yy);
        gctx.lineTo(poly[0].x + 90 + pi * 10, yy + 3);
        gctx.stroke();
      }
      gctx.restore();
      gctx.strokeStyle = season.snow ? 'rgba(255,255,255,0.8)' : 'rgba(230,245,230,0.55)';
      gctx.lineWidth = 3;
      gctx.stroke();
    });
  }

  function drawRoad() {
    var pts = params.road.points;
    gctx.lineCap = 'round';
    gctx.lineJoin = 'round';
    gctx.beginPath();
    gctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(function (p) {
      gctx.lineTo(p.x, p.y);
    });
    gctx.strokeStyle = 'rgba(60,50,40,0.35)';
    gctx.lineWidth = params.road.width + 8;
    gctx.stroke();
    gctx.beginPath();
    gctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(function (p) {
      gctx.lineTo(p.x, p.y);
    });
    var grad = gctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#b8ad97');
    grad.addColorStop(1, '#9d927c');
    gctx.strokeStyle = grad;
    gctx.lineWidth = params.road.width;
    gctx.stroke();
    gctx.strokeStyle = 'rgba(255,240,200,0.5)';
    gctx.lineWidth = 2;
    gctx.setLineDash([14, 16]);
    gctx.beginPath();
    gctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(function (p) {
      gctx.lineTo(p.x, p.y);
    });
    gctx.stroke();
    gctx.setLineDash([]);
  }

  function renderGround() {
    renderTerrainBase();
    gctx.imageSmoothingEnabled = true;
    gctx.clearRect(0, 0, W, H);
    gctx.drawImage(terrainCanvas, 0, 0, W, H);
    var season = C.SEASONS[params.season];
    gctx.fillStyle = season.hillA;
    gctx.beginPath();
    gctx.moveTo(0, H * 0.32);
    gctx.quadraticCurveTo(W * 0.3, H * 0.18, W * 0.58, H * 0.3);
    gctx.quadraticCurveTo(W * 0.82, H * 0.4, W, H * 0.26);
    gctx.lineTo(W, 0);
    gctx.lineTo(0, 0);
    gctx.closePath();
    gctx.fill();
    gctx.fillStyle = season.hillB;
    gctx.beginPath();
    gctx.moveTo(0, H * 0.2);
    gctx.quadraticCurveTo(W * 0.25, H * 0.1, W * 0.5, H * 0.18);
    gctx.quadraticCurveTo(W * 0.75, H * 0.26, W, H * 0.14);
    gctx.lineTo(W, 0);
    gctx.lineTo(0, 0);
    gctx.closePath();
    gctx.fill();
    drawWater();
    drawRoad();
  }

  window.__meadow = {
    params: params,
    get scene() { return scene; },
    rebuildVegetation: rebuildVegetation,
    rebuildStatic: rebuildStatic,
    renderGround: renderGround,
    markAffected: markAffected
  };

  function windOffset(x, y, phase, time) {
    var speed = params.windSpeed;
    var gust = Math.sin(time * 0.0022 * speed + phase + x * 0.012) +
      0.5 * Math.sin(time * 0.0037 * speed + y * 0.02 + phase);
    return gust * speed * 1.6;
  }

  function drawGrass(time) {
    var season = C.SEASONS[params.season];
    var colors = season.grass;
    var batches = colors.map(function () {
      return [];
    });
    scene.grass.forEach(function (g) {
      var ci = g.h2 < 0.34 ? 0 : (g.h2 < 0.67 ? 1 : 2);
      batches[ci].push(g);
    });
    ctx.lineCap = 'round';
    batches.forEach(function (list, ci) {
      ctx.strokeStyle = colors[ci];
      list.forEach(function (g) {
        var depth = 0.62 + (g.y / H) * 0.5;
        var bladeH = (5 + g.blades * 1.7) * depth;
        var sway = windOffset(g.x, g.y, g.phase, time) * 0.55;
        ctx.lineWidth = Math.max(0.7, 1.1 * depth);
        ctx.beginPath();
        for (var b = 0; b < g.blades; b++) {
          var spread = (b - (g.blades - 1) / 2) * 2.2 * depth;
          ctx.moveTo(g.x + spread, g.y);
          ctx.quadraticCurveTo(
            g.x + spread + sway * 0.5,
            g.y - bladeH * 0.55,
            g.x + spread + sway,
            g.y - bladeH
          );
        }
        ctx.stroke();
      });
    });
  }

  function drawTreeShadow(t) {
    var r = 16 * t.scale;
    ctx.fillStyle = 'rgba(30,45,25,0.18)';
    ctx.beginPath();
    ctx.ellipse(t.x + r * 0.55, t.y + r * 0.28, r * 1.25, r * 0.48, 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBroadTree(t, time, season) {
    var s = t.scale;
    var sway = windOffset(t.x, t.y, t.phase, time) * 0.85;
    var trunkH = 26 * s;
    ctx.fillStyle = season.trunk;
    ctx.beginPath();
    ctx.moveTo(t.x - 3 * s, t.y);
    ctx.lineTo(t.x - 2 * s, t.y - trunkH);
    ctx.lineTo(t.x + 2 * s, t.y - trunkH);
    ctx.lineTo(t.x + 3 * s, t.y);
    ctx.closePath();
    ctx.fill();

    var leaf = season.leafAmount;
    var radius = 17 * s * (0.55 + leaf * 0.45);
    var cx = t.x + sway;
    var cy = t.y - trunkH - 8 * s + sway * 0.2;
    var blobs = 3 + Math.round(leaf * 3);
    for (var i = 0; i < blobs; i++) {
      var ang = (i / blobs) * Math.PI * 2 + t.phase;
      var ox = Math.cos(ang) * radius * 0.55;
      var oy = Math.sin(ang) * radius * 0.42;
      ctx.fillStyle = season.broad[i % season.broad.length];
      ctx.beginPath();
      ctx.arc(cx + ox, cy + oy, radius * (0.55 + leaf * 0.2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = season.broad[1];
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.72, 0, Math.PI * 2);
    ctx.fill();
    if (season.snow > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + season.snow + ')';
      ctx.beginPath();
      ctx.arc(cx, cy - radius * 0.35, radius * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPine(t, time, season) {
    var s = t.scale;
    var sway = windOffset(t.x, t.y, t.phase, time) * 0.6;
    var trunkH = 12 * s;
    ctx.fillStyle = season.trunk;
    ctx.fillRect(t.x - 2 * s, t.y - trunkH, 4 * s, trunkH);
    var leaf = season.leafAmount;
    var topY = t.y - trunkH - 34 * s * (0.7 + leaf * 0.3);
    var baseX = t.x + sway;
    var layers = 4;
    for (var i = 0; i < layers; i++) {
      var f = i / layers;
      var ly = t.y - trunkH - f * 30 * s;
      var lw = (17 - f * 9) * s * (0.7 + leaf * 0.3);
      var lh = 16 * s;
      ctx.fillStyle = season.pine[i % season.pine.length];
      ctx.beginPath();
      ctx.moveTo(baseX + sway * f * 0.6, ly - lh);
      ctx.lineTo(baseX - lw, ly);
      ctx.lineTo(baseX + lw, ly);
      ctx.closePath();
      ctx.fill();
      if (season.snow > 0 && i < 2) {
        ctx.fillStyle = 'rgba(255,255,255,' + (season.snow * 0.7) + ')';
        ctx.beginPath();
        ctx.moveTo(baseX + sway * f * 0.6, ly - lh);
        ctx.lineTo(baseX - lw * 0.5, ly - lh * 0.35);
        ctx.lineTo(baseX + lw * 0.2, ly - lh * 0.55);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function drawTrees(time) {
    var season = C.SEASONS[params.season];
    scene.trees.forEach(drawTreeShadow);
    scene.trees.forEach(function (t) {
      if (t.kind === 'pine') {
        drawPine(t, time, season);
      } else {
        drawBroadTree(t, time, season);
      }
    });
  }

  function drawRoadOverlay(time) {
    var pts = params.road.points;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (hoverNode >= 0 || drag) {
      ctx.strokeStyle = 'rgba(255,220,120,0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach(function (p) {
        ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      pts.forEach(function (p, i) {
        ctx.beginPath();
        ctx.fillStyle = i === hoverNode ? '#ffd98a' : '#fff4d0';
        ctx.arc(p.x, p.y, i === hoverNode ? 7 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#5a4a2a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }
    if (flashBox && time < flashUntil) {
      var alpha = (flashUntil - time) / 900;
      ctx.strokeStyle = 'rgba(255,217,138,' + alpha + ')';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.strokeRect(flashBox.minX, flashBox.minY,
        flashBox.maxX - flashBox.minX, flashBox.maxY - flashBox.minY);
      ctx.setLineDash([]);
    } else {
      flashBox = null;
    }
  }

  function frameLoop(time) {
    frame++;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(groundCanvas, 0, 0);
    drawGrass(time);
    drawTrees(time);
    drawRoadOverlay(time);
    requestAnimationFrame(frameLoop);
  }

  function syncControls() {
    els.seed.value = params.seed;
    els.seedVal.textContent = params.seed;
    els.density.value = params.density;
    els.densityVal.textContent = Math.round(params.density * 100) + '%';
    els.aspect.value = params.aspect;
    els.aspectVal.textContent = C.ASPECT_MODES[params.aspect].label;
    els.wind.value = params.windSpeed;
    els.windVal.textContent = params.windSpeed.toFixed(1);
    els.roadWidth.value = params.road.width;
    els.roadWidthVal.textContent = params.road.width + 'px';
    Array.prototype.forEach.call(els.seasonRow.children, function (btn) {
      btn.classList.toggle('active', btn.dataset.season === params.season);
    });
    updateStats();
  }

  function updateStats() {
    var blocked = scene.trees.filter(function (t) {
      return C.isOnRoad(t.x, t.y, params.road);
    }).length;
    els.stats.innerHTML =
      '树木：<b>' + scene.trees.length + '</b> 棵<br>' +
      '草丛：<b>' + scene.grass.length + '</b> 簇<br>' +
      '水面避让：<b>' + staticData.waterPolys.length + '</b> 片水域<br>' +
      '道路压线检查：<b>' + (blocked === 0 ? '0 株（通过）' : blocked + ' 株') + '</b><br>' +
      '季节：<b>' + C.SEASONS[params.season].label + '</b>，叶量 ' +
      Math.round(C.SEASONS[params.season].leafAmount * 100) + '%';
  }

  function pointerPos(evt) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * (W / rect.width),
      y: (evt.clientY - rect.top) * (H / rect.height)
    };
  }

  function nearestNode(pos, radius) {
    var best = -1;
    var bestD = radius;
    params.road.points.forEach(function (p, i) {
      var d = Math.hypot(p.x - pos.x, p.y - pos.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function nearestSegment(pos) {
    var pts = params.road.points;
    var best = -1;
    var bestD = 14;
    for (var i = 0; i < pts.length - 1; i++) {
      var d = C.distToSegment(pos.x, pos.y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  canvas.addEventListener('pointerdown', function (evt) {
    var pos = pointerPos(evt);
    var node = nearestNode(pos, 14);
    if (node >= 0) {
      drag = { node: node };
      canvas.setPointerCapture(evt.pointerId);
      canvas.style.cursor = 'grabbing';
    }
  });

  canvas.addEventListener('pointermove', function (evt) {
    var pos = pointerPos(evt);
    if (drag) {
      params.road.points[drag.node].x = Math.max(-40, Math.min(W + 40, pos.x));
      params.road.points[drag.node].y = Math.max(-40, Math.min(H + 40, pos.y));
      renderGround();
      rebuildVegetation();
      markAffected();
      updateStats();
    } else {
      hoverNode = nearestNode(pos, 14);
      canvas.style.cursor = hoverNode >= 0 ? 'grab' : 'crosshair';
    }
  });

  canvas.addEventListener('pointerup', function (evt) {
    if (drag) {
      drag = null;
      canvas.releasePointerCapture(evt.pointerId);
      canvas.style.cursor = hoverNode >= 0 ? 'grab' : 'crosshair';
      showToast('道路已更新，受影响区域已自动重算');
    }
  });

  canvas.addEventListener('dblclick', function (evt) {
    var pos = pointerPos(evt);
    var node = nearestNode(pos, 12);
    if (node >= 0 && params.road.points.length > 2) {
      params.road.points.splice(node, 1);
      hoverNode = -1;
      showToast('已删除道路节点');
    } else {
      var seg = nearestSegment(pos);
      if (seg >= 0) {
        params.road.points.splice(seg + 1, 0, { x: pos.x, y: pos.y });
        showToast('已插入道路节点，可拖动调整');
      } else {
        return;
      }
    }
    renderGround();
    rebuildVegetation();
    markAffected();
    updateStats();
  });

  els.seed.addEventListener('change', function () {
    params.seed = Math.max(1, Math.floor(Number(els.seed.value)) || 1);
    syncControls();
    rebuildStatic();
    showToast('已使用 seed ' + params.seed + ' 重新分布');
  });

  els.density.addEventListener('input', function () {
    params.density = Number(els.density.value);
    els.densityVal.textContent = Math.round(params.density * 100) + '%';
    rebuildVegetation();
  });

  els.aspect.addEventListener('change', function () {
    params.aspect = els.aspect.value;
    els.aspectVal.textContent = C.ASPECT_MODES[params.aspect].label;
    rebuildVegetation();
  });

  els.wind.addEventListener('input', function () {
    params.windSpeed = Number(els.wind.value);
    els.windVal.textContent = params.windSpeed.toFixed(1);
  });

  els.roadWidth.addEventListener('input', function () {
    params.road.width = Number(els.roadWidth.value);
    els.roadWidthVal.textContent = params.road.width + 'px';
    renderGround();
    rebuildVegetation();
    markAffected();
  });

  Array.prototype.forEach.call(els.seasonRow.children, function (btn) {
    btn.addEventListener('click', function () {
      params.season = btn.dataset.season;
      syncControls();
      renderGround();
      showToast('切换到' + C.SEASONS[params.season].label + '季：仅材质与叶量变化，位置不变');
    });
  });

  function download(filename, blobOrUrl) {
    var a = document.createElement('a');
    a.href = blobOrUrl instanceof Blob ? URL.createObjectURL(blobOrUrl) : blobOrUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (blobOrUrl instanceof Blob) {
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 1000);
    }
  }

  els.screenshot.addEventListener('click', function () {
    canvas.toBlob(function (blob) {
      if (!blob) {
        showToast('截图失败');
        return;
      }
      download('meadow-seed' + params.seed + '-' + params.season + '.png', blob);
      showToast('截图已导出');
    }, 'image/png');
  });

  els.save.addEventListener('click', function () {
    localStorage.setItem('meadow-params-v1', C.serializeParams(params));
    showToast('参数已保存到浏览器本地');
  });

  els.restore.addEventListener('click', function () {
    var stored = loadStored();
    if (!stored) {
      showToast('没有找到已保存的参数');
      return;
    }
    applyParams(stored, true);
    showToast('已恢复上次保存的参数');
  });

  els.reset.addEventListener('click', function () {
    applyParams(C.defaultParams(), true);
    showToast('场景已重置');
  });

  els.exportBtn.addEventListener('click', function () {
    var blob = new Blob([C.serializeParams(params)], { type: 'application/json' });
    download('meadow-params-seed' + params.seed + '.json', blob);
    showToast('参数 JSON 已导出');
  });

  els.importFile.addEventListener('change', function (evt) {
    var file = evt.target.files[0];
    if (!file) {
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        applyParams(C.hydrateParams(String(reader.result)), true);
        showToast('参数导入成功');
      } catch (e) {
        showToast('参数文件格式无效');
      }
    };
    reader.readAsText(file);
    evt.target.value = '';
  });

  function applyParams(next, fullReload) {
    var seedChanged = next.seed !== params.seed;
    params.seed = next.seed;
    params.density = next.density;
    params.aspect = next.aspect;
    params.windSpeed = next.windSpeed;
    params.season = next.season;
    params.road = next.road;
    syncControls();
    if (fullReload && seedChanged) {
      rebuildStatic();
    } else {
      renderGround();
      rebuildVegetation();
    }
    markAffected();
  }

  renderGround();
  syncControls();
  requestAnimationFrame(frameLoop);
})();
