/*
 * Resolution-independent map renderer.
 * The same vector drawing path is used for on-screen rendering (scale = 1,
 * or the browser devicePixelRatio) and for the 4x export (scale = 4),
 * so an export is re-rasterized at high resolution instead of being an
 * upscaled screenshot of a low-resolution canvas.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./map-data.js'));
  } else {
    root.MapEngine = factory(root.MapData);
  }
})(typeof self !== 'undefined' ? self : this, function (Data) {
  'use strict';

  const ALL_LAYERS = { terrain: true, roads: true, water: true };

  function createView(width, height, overrides) {
    const view = {
      width,
      height,
      zoom: 1,
      centerX: Data.WORLD.width / 2,
      centerY: Data.WORLD.height / 2,
      layers: Object.assign({}, ALL_LAYERS),
    };
    if (overrides) {
      Object.assign(view, overrides);
      if (overrides.layers) view.layers = Object.assign({}, ALL_LAYERS, overrides.layers);
    }
    return view;
  }

  function fitWorld(view) {
    view.zoom = Math.min(view.width / Data.WORLD.width, view.height / Data.WORLD.height);
    view.centerX = Data.WORLD.width / 2;
    view.centerY = Data.WORLD.height / 2;
    return view;
  }

  function worldToScreen(view, x, y, scale) {
    const s = scale || 1;
    return [
      (x - view.centerX) * view.zoom * s + (view.width * s) / 2,
      (y - view.centerY) * view.zoom * s + (view.height * s) / 2,
    ];
  }

  function pathFromWorld(ctx, view, scale, points) {
    ctx.beginPath();
    points.forEach(function (p, i) {
      const sp = worldToScreen(view, p[0], p[1], scale);
      if (i === 0) ctx.moveTo(sp[0], sp[1]);
      else ctx.lineTo(sp[0], sp[1]);
    });
  }

  function font(scale, size, weight, style) {
    return (style || '') + ' ' + (weight || '') + ' ' + Math.round(size * scale) +
      'px "DejaVu Sans", "Ubuntu Sans", sans-serif';
  }

  function labelWithHalo(ctx, text, x, y, scale, size, options) {
    options = options || {};
    ctx.save();
    ctx.font = font(scale, size, options.weight || '600', options.style || '');
    ctx.textAlign = options.align || 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4 * scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = options.color || '#233020';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function labelFits(view, scale, ctx, text, x, y, size, align) {
    ctx.save();
    ctx.font = font(scale, size, '600');
    const width = ctx.measureText(text).width;
    ctx.restore();
    const pad = 8 * scale;
    const minX = align === 'left' ? x - pad : x - width / 2 - pad;
    const maxX = align === 'left' ? x + width + pad : x + width / 2 + pad;
    return minX > 0 && maxX < view.width * scale &&
      y - size * scale > 0 && y + size * scale < view.height * scale;
  }

  function drawTerrain(ctx, view, scale) {
    Data.terrain.forEach(function (zone) {
      const style = Data.terrainStyles[zone.type];
      pathFromWorld(ctx, view, scale, zone.polygon);
      ctx.fillStyle = style.fill;
      ctx.fill();
      ctx.lineWidth = 2.5 * scale;
      ctx.strokeStyle = style.stroke;
      ctx.stroke();
      const anchor = worldToScreen(view, zone.labelAt[0], zone.labelAt[1], scale);
      if (labelFits(view, scale, ctx, zone.label, anchor[0], anchor[1], 17, 'center')) {
        labelWithHalo(ctx, zone.label, anchor[0], anchor[1], scale, 17, {
          weight: '700', style: 'italic', color: '#3a2f17',
        });
      }
    });
  }

  function drawWater(ctx, view, scale) {
    Data.water.forEach(function (feature) {
      if (feature.kind === 'lake') {
        pathFromWorld(ctx, view, scale, feature.polygon);
        ctx.fillStyle = '#7fb6d9';
        ctx.fill();
        ctx.lineWidth = 2 * scale;
        ctx.strokeStyle = '#3d7ba0';
        ctx.stroke();
        const anchor = worldToScreen(view, feature.labelAt[0], feature.labelAt[1], scale);
        if (labelFits(view, scale, ctx, feature.name, anchor[0], anchor[1], 13, 'center')) {
          labelWithHalo(ctx, feature.name, anchor[0], anchor[1], scale, 13, {
            style: 'italic', color: '#12455f',
          });
        }
      } else {
        pathFromWorld(ctx, view, scale, feature.line);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = feature.width * view.zoom * scale;
        ctx.strokeStyle = '#5fa3cc';
        ctx.stroke();
        ctx.lineWidth = Math.max(1, feature.width * view.zoom * scale - 3 * scale);
        ctx.strokeStyle = '#8fc4e2';
        ctx.stroke();
      }
    });
  }

  function drawRoads(ctx, view, scale) {
    const colors = {
      trunk: { casing: '#5d3a1f', fill: '#f5c04e' },
      secondary: { casing: '#4d4d4d', fill: '#f2f2f2' },
      minor: { casing: '#6b6b6b', fill: '#ffffff' },
    };
    Data.roads.forEach(function (road) {
      pathFromWorld(ctx, view, scale, road.line);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const width = road.width * view.zoom * scale;
      ctx.lineWidth = width;
      ctx.strokeStyle = colors[road.kind].casing;
      if (road.dash) ctx.setLineDash(road.dash.map(function (d) { return d * view.zoom * scale; }));
      ctx.stroke();
      ctx.lineWidth = Math.max(1, width - 3 * scale);
      ctx.strokeStyle = colors[road.kind].fill;
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  function drawTowns(ctx, view, scale) {
    Data.towns.forEach(function (town) {
      const p = worldToScreen(view, town.at[0], town.at[1], scale);
      const labelX = p[0] + 10 * scale;
      const labelY = p[1] - 9 * scale;
      const fits = labelFits(view, scale, ctx, town.name, labelX, labelY, 12, 'left');
      if (p[0] < 0 || p[0] > view.width * scale || p[1] < 0 || p[1] > view.height * scale) return;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 5 * scale, 0, Math.PI * 2);
      ctx.fillStyle = '#b23b2e';
      ctx.fill();
      ctx.lineWidth = 1.5 * scale;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      if (fits) {
        labelWithHalo(ctx, town.name, labelX, labelY, scale, 12, {
          align: 'left', color: '#3a1a15',
        });
      }
    });
  }

  function drawScaleBar(ctx, view, scale) {
    const steps = [100, 200, 500, 1000, 2000, 5000, 10000];
    const targetMeters = 120 / view.zoom;
    let chosen = steps[steps.length - 1];
    for (let i = 0; i < steps.length; i++) {
      if (steps[i] >= targetMeters) { chosen = steps[i]; break; }
    }
    const pxLen = chosen * view.zoom * scale;
    const x = 18 * scale;
    const y = (view.height - 34) * scale;
    const h = 8 * scale;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(x - 8 * scale, y - 22 * scale, pxLen + 16 * scale, 40 * scale);
    const half = pxLen / 2;
    ctx.fillStyle = '#222222';
    ctx.fillRect(x, y, half, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + half, y, half, h);
    ctx.strokeStyle = '#222222';
    ctx.lineWidth = 1.5 * scale;
    ctx.strokeRect(x, y, pxLen, h);
    const label = chosen >= 1000 ? (chosen / 1000) + ' km' : chosen + ' m';
    ctx.font = font(scale, 12, '600');
    ctx.fillStyle = '#222222';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('0', x, y - 6 * scale);
    ctx.textAlign = 'center';
    ctx.fillText(label, x + pxLen, y - 6 * scale);
    ctx.restore();
  }

  function legendEntries(view) {
    const entries = [];
    if (view.layers.terrain) {
      Object.keys(Data.terrainStyles).forEach(function (key) {
        entries.push({ kind: 'swatch', color: Data.terrainStyles[key].fill,
          stroke: Data.terrainStyles[key].stroke, text: Data.terrainStyles[key].label });
      });
    }
    if (view.layers.water) {
      entries.push({ kind: 'line', color: '#5fa3cc', text: 'River' });
      entries.push({ kind: 'swatch', color: '#7fb6d9', stroke: '#3d7ba0', text: 'Lake' });
    }
    if (view.layers.roads) {
      entries.push({ kind: 'line', color: '#f5c04e', text: 'Trunk road' });
      entries.push({ kind: 'line', color: '#cfcfcf', text: 'Secondary road' });
      entries.push({ kind: 'line', color: '#999999', text: 'Minor road' });
    }
    entries.push({ kind: 'marker', color: '#b23b2e', text: 'Town' });
    return entries;
  }

  function drawLegend(ctx, view, scale) {
    const entries = legendEntries(view);
    const pad = 10 * scale;
    const rowH = 20 * scale;
    const boxW = 150 * scale;
    const boxH = pad * 2 + rowH * (entries.length + 1);
    const x = (view.width * scale) - boxW - 14 * scale;
    const y = 14 * scale;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.strokeStyle = 'rgba(60,60,60,0.7)';
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, 6 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.font = font(scale, 13, '700');
    ctx.fillStyle = '#222222';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Legend', x + pad, y + pad + rowH / 2);
    entries.forEach(function (entry, i) {
      const rowY = y + pad + rowH * (i + 1) + rowH / 2;
      const sx = x + pad;
      if (entry.kind === 'swatch') {
        ctx.fillStyle = entry.color;
        ctx.fillRect(sx, rowY - 7 * scale, 22 * scale, 14 * scale);
        ctx.strokeStyle = entry.stroke;
        ctx.lineWidth = 1 * scale;
        ctx.strokeRect(sx, rowY - 7 * scale, 22 * scale, 14 * scale);
      } else if (entry.kind === 'line') {
        ctx.strokeStyle = entry.color;
        ctx.lineWidth = 4 * scale;
        ctx.beginPath();
        ctx.moveTo(sx, rowY);
        ctx.lineTo(sx + 22 * scale, rowY);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(sx + 11 * scale, rowY, 4.5 * scale, 0, Math.PI * 2);
        ctx.fillStyle = entry.color;
        ctx.fill();
      }
      ctx.font = font(scale, 12, '500');
      ctx.fillStyle = '#222222';
      ctx.fillText(entry.text, sx + 30 * scale, rowY);
    });
    ctx.restore();
  }

  function render(ctx, view, scale, options) {
    scale = scale || 1;
    options = options || {};
    const w = view.width * scale;
    const h = view.height * scale;
    ctx.save();
    ctx.fillStyle = '#eef2ec';
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    if (view.layers.terrain) drawTerrain(ctx, view, scale);
    if (view.layers.water) drawWater(ctx, view, scale);
    if (view.layers.roads) drawRoads(ctx, view, scale);
    drawTowns(ctx, view, scale);
    ctx.restore();
    if (options.scaleBar !== false) drawScaleBar(ctx, view, scale);
    if (options.legend !== false) drawLegend(ctx, view, scale);
  }

  return {
    createView,
    fitWorld,
    worldToScreen,
    render,
    drawScaleBar,
    drawLegend,
    legendEntries,
  };
});
