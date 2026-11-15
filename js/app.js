/*
 * app.js — Canvas 交互：拖拽三段区域、实时延展、导出 PNG。
 */
(function () {
  'use strict';

  var SRC_W = 480, SRC_H = 300;
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var stage = document.getElementById('stage');
  var info = document.getElementById('info');
  var handles = [document.getElementById('handle0'), document.getElementById('handle1')];

  var seed = 7;
  var src = null;                 // 原始风景 {data,width,height}
  var boundaries = [160, 320];    // 源图分界
  var targetWidths = [160, 160, 160];
  var result = null;

  function regen() {
    src = Landscape.generateLandscape({ width: SRC_W, height: SRC_H, seed: seed });
    render();
  }

  function render() {
    result = Stretch.stretchImage(src, boundaries, targetWidths, {
      blend: 26, detail: 1.0, dither: 2.0
    });
    // 拷贝一份再画标记，导出图也带标记
    var marked = {
      data: new Uint8ClampedArray(result.data),
      width: result.width, height: result.height
    };
    Stretch.drawMarkers(marked, result.offsets);

    canvas.width = marked.width;
    canvas.height = marked.height;
    ctx.putImageData(new ImageData(marked.data, marked.width, marked.height), 0, 0);

    // 区域文字标签（左/中/右）
    var starts = [0, result.offsets[0], result.offsets[1]];
    var ends = [result.offsets[0], result.offsets[1], marked.width];
    var names = ['左', '中', '右'];
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    for (var r = 0; r < 3; r++) {
      var cx = (starts[r] + ends[r]) / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(names[r], cx + 1, 11);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(names[r], cx, 10);
    }

    positionHandles();
    var ratio = (marked.width / SRC_W).toFixed(2);
    info.textContent = '源图 ' + SRC_W + '×' + SRC_H +
      ' → 延展后 ' + marked.width + '×' + marked.height +
      '（×' + ratio + '） 区域宽: ' + targetWidths.join(' / ');
  }

  function positionHandles() {
    var pad = 12; // stage padding
    handles[0].style.left = (pad + result.offsets[0]) + 'px';
    handles[1].style.left = (pad + result.offsets[1]) + 'px';
  }

  // 拖拽手柄：改变相邻两区的目标宽度
  function makeDraggable(handle, idx) {
    handle.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      var startX = e.clientX;
      var startW = targetWidths.slice();
      function onMove(ev) {
        var dx = ev.clientX - startX;
        var next = startW.slice();
        next[idx] = clampW(startW[idx] + dx);
        next[idx + 1] = clampW(startW[idx + 1] - dx);
        // 总量不够时把差额继续向第三区借/还
        var other = idx === 0 ? 2 : 0;
        var overflow = (next[idx] + next[idx + 1]) - (startW[idx] + startW[idx + 1]);
        next[other] = clampW(startW[other] - overflow);
        targetWidths = next;
        render();
      }
      function onUp() {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
      }
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  }

  function clampW(v) { return Math.max(60, Math.min(900, Math.round(v))); }

  makeDraggable(handles[0], 0);
  makeDraggable(handles[1], 1);

  document.getElementById('btnReset').addEventListener('click', function () {
    targetWidths = [160, 160, 160]; render();
  });
  document.getElementById('btnMild').addEventListener('click', function () {
    targetWidths = [200, 240, 200]; render();
  });
  document.getElementById('btnStrong').addEventListener('click', function () {
    targetWidths = [480, 480, 480]; render();
  });
  document.getElementById('btnRegen').addEventListener('click', function () {
    seed = (seed * 31 + 13) % 997; regen();
  });
  document.getElementById('btnExport').addEventListener('click', function () {
    canvas.toBlob(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'stretch_' + canvas.width + 'x' + canvas.height + '.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    }, 'image/png');
  });

  regen();
})();
