/*
 * 渲染层：Canvas 预览 + SVG 导出。
 * 拐角圆度用两遍描边近似：
 *   1) round join/cap 全圆轮廓（半透明随 roundness 增强）
 *   2) miter 几何轮廓（随 roundness 减弱）
 * SVG 同步输出两遍路径，并把全部排版参数写入 <metadata>，重新导入即可恢复。
 */
(function (root) {
  'use strict';

  function drawStroke(ctx, d, width, roundness, mode) {
    root.Geo.trace2D(ctx, d);
    if (mode === 'canvas') {
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.25 + 0.75 * roundness;
      ctx.stroke();
      ctx.globalAlpha = 1 - 0.85 * roundness;
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 2;
      ctx.lineCap = roundness > 0.5 ? 'round' : 'butt';
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function renderCanvas(canvas, layout, opts) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 800;
    const cssH = canvas.clientHeight || 520;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const pad = 32;
    const availW = cssW - pad * 2;
    const availH = cssH - pad * 2;
    const emPx = Math.min(availW / (layout.contentWidth / 1000 || 1),
      availH / (layout.contentHeight / 1000 || 1), 64);

    ctx.save();
    ctx.translate(pad, pad);
    ctx.scale(emPx / 1000, emPx / 1000);
    ctx.translate(0, 760);
    ctx.strokeStyle = opts.color || '#e8eaed';
    for (const it of layout.items) {
      if (it.space) continue;
      ctx.save();
      ctx.translate(it.x, it.y);
      for (const s of it.glyph.strokes) {
        drawStroke(ctx, s.d, s.w * it.scale, opts.roundness, 'canvas');
      }
      ctx.restore();
    }
    ctx.restore();
    return { emPx, pad };
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function exportSVG(layout, state) {
    const emPx = 64;
    const pad = 32;
    const w = layout.contentWidth / 1000 * emPx + pad * 2;
    const h = layout.contentHeight / 1000 * emPx + pad * 2;
    const rows = [];
    rows.push('<?xml version="1.0" encoding="UTF-8"?>');
    rows.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.ceil(w) +
      '" height="' + Math.ceil(h) + '" viewBox="0 0 ' + Math.ceil(w) + ' ' + Math.ceil(h) + '">');
    rows.push('<metadata id="counter-lab-state" type="application/json">' +
      esc(JSON.stringify(state)) + '</metadata>');
    rows.push('<g fill="none" stroke="#111" transform="translate(' + pad + ',' + (pad + emPx * 0.76) +
      ') scale(' + (emPx / 1000) + ')">');
    for (const it of layout.items) {
      if (it.space) continue;
      for (const s of it.glyph.strokes) {
        const d = root.Geo.toSVG(s.d);
        rows.push('  <path d="' + d + '" stroke-width="' + (s.w * it.scale).toFixed(1) +
          '" stroke-linecap="round" stroke-linejoin="round" opacity="' +
          (0.25 + 0.75 * state.roundness).toFixed(2) +
          '" transform="translate(' + it.x.toFixed(1) + ',' + it.y.toFixed(1) + ')"/>');
        if (state.roundness < 0.99) {
          rows.push('  <path d="' + d + '" stroke-width="' + (s.w * it.scale).toFixed(1) +
            '" stroke-linecap="' + (state.roundness > 0.5 ? 'round' : 'butt') +
            '" stroke-linejoin="miter" opacity="' + (1 - 0.85 * state.roundness).toFixed(2) +
            '" transform="translate(' + it.x.toFixed(1) + ',' + it.y.toFixed(1) + ')"/>');
        }
      }
    }
    rows.push('</g>');
    rows.push('</svg>');
    return rows.join('\n');
  }

  function parseStateFromSVG(svgText) {
    const m = svgText.match(/<metadata[^>]*>([\s\S]*?)<\/metadata>/);
    if (!m) return null;
    try {
      return JSON.parse(m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'"));
    } catch (e) {
      return null;
    }
  }

  const api = { renderCanvas, exportSVG, parseStateFromSVG, drawStroke };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Render = api;
})(typeof window !== 'undefined' ? window : globalThis);
