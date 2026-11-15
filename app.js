// UI layer: canvas rendering, divider dragging, hover readout, exports.
/* global SpectroCore */
(function () {
  'use strict';

  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');
  const tooltip = document.getElementById('tooltip');
  const statusEl = document.getElementById('status');

  const COLORBAR_WIDTH = 56; // right-hand strip reserved for the colorbar
  const DIVIDER_HIT = 6; // px tolerance for grabbing a divider

  const params = SpectroCore.defaultParams();
  const specs = SpectroCore.generateAll(params.seed);

  function plotWidth() { return canvas.width - COLORBAR_WIDTH; }
  function dividerPx() {
    return {
      x: Math.round(params.dividerX * plotWidth()),
      y: Math.round(params.dividerY * canvas.height),
    };
  }

  // --- rendering -------------------------------------------------------------
  function render() {
    const scale = SpectroCore.makeColorScale(params.vmin, params.vmax, params.colormap);
    const w = plotWidth();
    const h = canvas.height;
    const div = dividerPx();
    const rendered = SpectroCore.renderAll(specs, scale, w, h, div.x, div.y);
    ctx.putImageData(new ImageData(rendered.pixels, w, h), 0, 0);
    drawColorbar(scale);
    drawDividers(div);
    drawTitles(rendered.rects);
  }

  function drawColorbar(scale) {
    const x0 = plotWidth() + 10;
    const barW = 18;
    const top = 10;
    const bottom = canvas.height - 10;
    const barH = bottom - top;
    const img = ctx.createImageData(barW, barH);
    for (let y = 0; y < barH; y++) {
      const value = params.vmax - (y / (barH - 1)) * (params.vmax - params.vmin);
      const rgb = scale(value);
      for (let x = 0; x < barW; x++) {
        const i = (y * barW + x) * 4;
        img.data[i] = rgb[0];
        img.data[i + 1] = rgb[1];
        img.data[i + 2] = rgb[2];
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, x0, top);
    ctx.fillStyle = '#ccc';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const value = params.vmax - (i / 4) * (params.vmax - params.vmin);
      const y = top + (i / 4) * barH;
      ctx.fillText(value.toFixed(2), x0 + barW + 4, y + 4);
      ctx.fillRect(x0 + barW, y, 3, 1);
    }
  }

  function drawDividers(div) {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(div.x + 0.5, 0);
    ctx.lineTo(div.x + 0.5, canvas.height);
    ctx.moveTo(0, div.y + 0.5);
    ctx.lineTo(plotWidth(), div.y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawTitles(rects) {
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    for (let i = 0; i < 4; i++) {
      const label = specs[i].title;
      const x = rects[i].x + 8;
      const y = rects[i].y + 18;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - 3, y - 13, ctx.measureText(label).width + 6, 17);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x, y);
    }
  }

  // --- divider dragging --------------------------------------------------------
  let dragMode = null; // 'x' | 'y' | 'xy'

  function hitDivider(mx, my) {
    const div = dividerPx();
    const nearX = Math.abs(mx - div.x) <= DIVIDER_HIT && my <= canvas.height;
    const nearY = Math.abs(my - div.y) <= DIVIDER_HIT && mx <= plotWidth();
    if (nearX && nearY) return 'xy';
    if (nearX) return 'x';
    if (nearY) return 'y';
    return null;
  }

  function canvasPos(evt) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - r.left) * (canvas.width / r.width),
      y: (evt.clientY - r.top) * (canvas.height / r.height),
    };
  }

  function applyDrag(pos) {
    if (dragMode === 'x' || dragMode === 'xy') {
      params.dividerX = Math.min(0.95, Math.max(0.05, pos.x / plotWidth()));
    }
    if (dragMode === 'y' || dragMode === 'xy') {
      params.dividerY = Math.min(0.95, Math.max(0.05, pos.y / canvas.height));
    }
    render();
  }

  canvas.addEventListener('mousedown', function (evt) {
    const pos = canvasPos(evt);
    dragMode = hitDivider(pos.x, pos.y);
    if (dragMode) evt.preventDefault();
  });

  window.addEventListener('mousemove', function (evt) {
    const pos = canvasPos(evt);
    if (dragMode) {
      applyDrag(pos);
      return;
    }
    const hover = hitDivider(pos.x, pos.y);
    canvas.className = hover ? 'drag-' + hover : '';
    updateTooltip(pos, evt);
  });

  window.addEventListener('mouseup', function () {
    if (dragMode) {
      dragMode = null;
      setStatus('分界线已更新');
    }
  });

  canvas.addEventListener('mouseleave', function () {
    tooltip.style.display = 'none';
  });

  // --- hover readout -----------------------------------------------------------
  function updateTooltip(pos, evt) {
    if (pos.x < 0 || pos.x >= plotWidth() || pos.y < 0 || pos.y >= canvas.height) {
      tooltip.style.display = 'none';
      return;
    }
    const div = dividerPx();
    // Normalized position inside whichever quadrant the cursor is in; the same
    // (u, v) is then sampled in every subplot so all four values correspond.
    const inRight = pos.x >= div.x;
    const inBottom = pos.y >= div.y;
    const qw = inRight ? plotWidth() - div.x : div.x;
    const qh = inBottom ? canvas.height - div.y : div.y;
    const u = (pos.x - (inRight ? div.x : 0)) / qw;
    const v = (pos.y - (inBottom ? div.y : 0)) / qh;
    const values = SpectroCore.valuesAt(specs, u, v);
    const lines = values.map(function (val, i) {
      return specs[i].title + '  ' + val.toFixed(4);
    });
    lines.push('(u=' + u.toFixed(3) + ', v=' + v.toFixed(3) + ')');
    tooltip.textContent = lines.join('\n');
    tooltip.style.display = 'block';
    const stage = document.getElementById('stage');
    const r = stage.getBoundingClientRect();
    tooltip.style.left = (evt.clientX - r.left + 14) + 'px';
    tooltip.style.top = (evt.clientY - r.top + 14) + 'px';
  }

  // --- controls ----------------------------------------------------------------
  const vminInput = document.getElementById('vmin');
  const vmaxInput = document.getElementById('vmax');
  const vminSlider = document.getElementById('vminSlider');
  const vmaxSlider = document.getElementById('vmaxSlider');

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function syncRangeUI() {
    vminInput.value = params.vmin;
    vmaxInput.value = params.vmax;
    vminSlider.value = params.vmin;
    vmaxSlider.value = params.vmax;
  }

  function applyRange() {
    if (!(params.vmax > params.vmin)) {
      params.vmax = params.vmin + 0.01;
    }
    syncRangeUI();
    render();
  }

  function bindRange(input, key) {
    input.addEventListener('input', function () {
      const val = parseFloat(input.value);
      if (Number.isFinite(val)) {
        params[key] = val;
        applyRange();
      }
    });
  }
  bindRange(vminInput, 'vmin');
  bindRange(vmaxInput, 'vmax');
  bindRange(vminSlider, 'vmin');
  bindRange(vmaxSlider, 'vmax');

  const cmapButtons = Array.from(document.querySelectorAll('#cmapRow button'));
  function syncCmapUI() {
    cmapButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.cmap === params.colormap);
    });
  }
  cmapButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      params.colormap = btn.dataset.cmap;
      syncCmapUI();
      render();
      setStatus('色标已切换为 ' + params.colormap + '，四个子图已同步更新');
    });
  });

  // --- exports -----------------------------------------------------------------
  function download(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }

  document.getElementById('exportPng').addEventListener('click', function () {
    render(); // ensure the canvas reflects current params
    download(canvas.toDataURL('image/png'), 'spectrograms_' + params.colormap + '.png');
    setStatus('PNG 已导出');
  });

  document.getElementById('exportJson').addEventListener('click', function () {
    const json = SpectroCore.serializeParams(params);
    const blob = new Blob([json], { type: 'application/json' });
    download(URL.createObjectURL(blob), 'spectrograms_params.json');
    setStatus('参数 JSON 已导出');
  });

  // --- init --------------------------------------------------------------------
  syncRangeUI();
  syncCmapUI();
  render();
})();
