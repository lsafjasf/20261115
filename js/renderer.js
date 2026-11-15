(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Renderer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function pressureColor(kpa, minKpa, maxKpa) {
    var range = Math.max(maxKpa - minKpa, 1);
    var t = (kpa - minKpa) / range;
    t = Math.max(0, Math.min(1, t));
    var hue = 240 - 240 * t;
    return 'hsl(' + hue + ', 85%, 48%)';
  }

  function Renderer(ctx) {
    this.ctx = ctx;
  }

  Renderer.prototype.drawFactory = function (width, height) {
    var ctx = this.ctx;
    ctx.fillStyle = '#f4f6f8';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (var x = 0; x <= width; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (var y = 0; y <= height; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    this.drawBuilding(40, 60, 140, 440, '泵房与水源区', '#dbeafe');
    this.drawBuilding(780, 70, 200, 140, '冷却车间', '#dcfce7');
    this.drawBuilding(800, 250, 180, 100, '动力车间', '#fef3c7');
    this.drawBuilding(780, 400, 200, 110, '清洗车间', '#fce7f3');
  };

  Renderer.prototype.drawBuilding = function (x, y, w, h, label, fill) {
    var ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = '#94a3b8';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#475569';
    ctx.font = '13px sans-serif';
    ctx.fillText(label, x + 10, y + 22);
    ctx.restore();
  };

  Renderer.prototype.drawEdge = function (edge, fromNode, toNode, result, color, selected) {
    var ctx = this.ctx;
    var x1 = fromNode.x;
    var y1 = fromNode.y;
    var x2 = toNode.x;
    var y2 = toNode.y;
    var width = Math.max(3, edge.diameter * 26);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = width + 5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    if (selected) {
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (edge.valve && edge.valve.kind !== 'open') {
      this.drawValve(edge, x1, y1, x2, y2);
    }
    ctx.restore();

    if (result && Math.abs(result.flow) > 1e-5) {
      this.drawFlowArrow(x1, y1, x2, y2, result.flow);
    }
  };

  Renderer.prototype.drawValve = function (edge, x1, y1, x2, y2) {
    var ctx = this.ctx;
    var mx = (x1 + x2) / 2;
    var my = (y1 + y2) / 2;
    var angle = Math.atan2(y2 - y1, x2 - x1);
    var size = 9;
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(angle);
    if (edge.valve.kind === 'closed') {
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.moveTo(-size, -size);
      ctx.lineTo(size, size);
      ctx.moveTo(size, -size);
      ctx.lineTo(-size, size);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#dc2626';
      ctx.stroke();
    } else {
      ctx.fillStyle = '#f59e0b';
      ctx.strokeStyle = '#92400e';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-size, -size);
      ctx.lineTo(size, 0);
      ctx.lineTo(-size, size);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      var forward = edge.valve.allowDirection !== 'backward';
      ctx.beginPath();
      ctx.moveTo(forward ? 0 : 0, 0);
      ctx.lineTo(forward ? size + 6 : -size - 6, 0);
      ctx.strokeStyle = '#92400e';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  };

  Renderer.prototype.drawFlowArrow = function (x1, y1, x2, y2, flow) {
    var ctx = this.ctx;
    var mx = (x1 + x2) / 2;
    var my = (y1 + y2) / 2;
    var angle = Math.atan2(y2 - y1, x2 - x1);
    if (flow < 0) angle += Math.PI;
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(angle);
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-5, -6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  Renderer.prototype.drawNode = function (node, pressureKpa, selected) {
    var ctx = this.ctx;
    var radius = node.kind === 'junction' ? 7 : 12;
    var fill = '#e2e8f0';
    if (node.kind === 'source') fill = '#2563eb';
    if (node.kind === 'demand') fill = '#16a34a';
    if (pressureKpa !== undefined && pressureKpa < 0) fill = '#dc2626';

    ctx.save();
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius + (selected ? 4 : 2), 0, Math.PI * 2);
    ctx.fillStyle = selected ? '#0f172a' : '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#334155';
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(node.name || node.id, node.x, node.y - radius - 8);
    if (pressureKpa !== undefined && pressureKpa !== null) {
      ctx.fillStyle = pressureKpa < 0 ? '#dc2626' : '#475569';
      ctx.font = '11px sans-serif';
      ctx.fillText(pressureKpa.toFixed(0) + ' kPa', node.x, node.y + radius + 14);
    }
    ctx.restore();
  };

  Renderer.prototype.drawLegend = function (x, y, minKpa, maxKpa) {
    var ctx = this.ctx;
    var width = 220;
    var height = 14;
    ctx.save();
    for (var i = 0; i < width; i++) {
      var kpa = minKpa + (maxKpa - minKpa) * (i / width);
      ctx.fillStyle = pressureColor(kpa, minKpa, maxKpa);
      ctx.fillRect(x + i, y, 1, height);
    }
    ctx.strokeStyle = '#334155';
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = '#0f172a';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(minKpa.toFixed(0) + ' kPa（低压）', x, y + height + 14);
    ctx.textAlign = 'right';
    ctx.fillText(maxKpa.toFixed(0) + ' kPa（高压）', x + width, y + height + 14);
    ctx.restore();
  };

  return {
    Renderer: Renderer,
    pressureColor: pressureColor
  };
});
