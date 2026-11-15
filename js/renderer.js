import { MAP_GEOMETRY, MAP_WORLD, PERIODS, PERIOD_STATS } from "./data.js";

export const COLOR_DOMAIN = Object.freeze({ min: 24, max: 46 });

const COLOR_STOPS = [
  [0.0, "#3461a5"],
  [0.18, "#3f8fc4"],
  [0.36, "#56c2b1"],
  [0.52, "#a7cf73"],
  [0.68, "#dfc160"],
  [0.82, "#ed9552"],
  [0.92, "#e86545"],
  [1.0, "#9f382f"],
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function mixRgb(a, b, amount) {
  return {
    r: Math.round(a.r + (b.r - a.r) * amount),
    g: Math.round(a.g + (b.g - a.g) * amount),
    b: Math.round(a.b + (b.b - a.b) * amount),
  };
}

export function temperatureRgb(temperature) {
  const t = clamp((temperature - COLOR_DOMAIN.min) / (COLOR_DOMAIN.max - COLOR_DOMAIN.min), 0, 1);
  for (let index = 1; index < COLOR_STOPS.length; index += 1) {
    const [stop, hex] = COLOR_STOPS[index];
    const [previousStop, previousHex] = COLOR_STOPS[index - 1];
    if (t <= stop) {
      const local = (t - previousStop) / (stop - previousStop);
      return mixRgb(hexToRgb(previousHex), hexToRgb(hex), local);
    }
  }
  return hexToRgb(COLOR_STOPS.at(-1)[1]);
}

export function temperatureColor(temperature, alpha = 1) {
  const { r, g, b } = temperatureRgb(temperature);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function temperatureHex(temperature) {
  const { r, g, b } = temperatureRgb(temperature);
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function lighten(temperature, amount) {
  const { r, g, b } = mixRgb(temperatureRgb(temperature), { r: 255, g: 247, b: 222 }, amount);
  return `rgb(${r}, ${g}, ${b})`;
}

function darkness(temperature, amount) {
  const { r, g, b } = mixRgb(temperatureRgb(temperature), { r: 12, g: 21, b: 19 }, amount);
  return `rgb(${r}, ${g}, ${b})`;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, r);
}

function normalizeTemperature(temperature) {
  return (temperature - COLOR_DOMAIN.min) / (COLOR_DOMAIN.max - COLOR_DOMAIN.min);
}

function seeded(index, salt = 0) {
  const value = Math.sin((index + 1) * 91.731 + salt * 17.13) * 43758.5453;
  return value - Math.floor(value);
}

export class HeatMapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.dpr = 1;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.cssWidth = Math.max(1, rect.width);
    this.cssHeight = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.25);
    this.canvas.width = Math.round(this.cssWidth * this.dpr);
    this.canvas.height = Math.round(this.cssHeight * this.dpr);
    const inset = this.cssWidth < 620 ? 9 : 13;
    this.scale = Math.min(
      (this.cssWidth - inset * 2) / MAP_GEOMETRY.width,
      (this.cssHeight - inset * 2) / MAP_GEOMETRY.height,
    );
    this.offsetX = (this.cssWidth - MAP_GEOMETRY.width * this.scale) / 2;
    this.offsetY = (this.cssHeight - MAP_GEOMETRY.height * this.scale) / 2;
  }

  setWorldTransform() {
    this.ctx.setTransform(
      this.dpr * this.scale,
      0,
      0,
      this.dpr * this.scale,
      this.dpr * this.offsetX,
      this.dpr * this.offsetY,
    );
  }

  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.offsetX) / this.scale,
      y: (clientY - rect.top - this.offsetY) / this.scale,
    };
  }

  buildingAt(worldX, worldY, buildings = MAP_GEOMETRY.buildings) {
    for (let index = buildings.length - 1; index >= 0; index -= 1) {
      const building = buildings[index];
      const box = building.world;
      if (
        worldX >= box.x
        && worldX <= box.x + box.w
        && worldY >= box.y
        && worldY <= box.y + box.h
      ) {
        return building;
      }
    }
    return null;
  }

  render(state) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "#091112";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.setWorldTransform();
    ctx.save();
    roundRect(ctx, 0, 0, MAP_GEOMETRY.width, MAP_GEOMETRY.height, 10);
    ctx.clip();
    this.drawGround(state.period);
    this.drawHeatZones(state.period);
    this.drawRoadNetwork();
    this.drawBlocks(state.period);
    this.drawParks(state.period);
    this.drawBuildings(state);
    this.drawSelection(state);
    this.drawMapLabels(state.period);
    this.drawLegend(state);
    ctx.restore();
    this.drawFrame();
  }

  drawFrame() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.strokeStyle = "rgba(215, 234, 224, 0.08)";
    ctx.lineWidth = 1;
    roundRect(
      ctx,
      this.offsetX + 0.5,
      this.offsetY + 0.5,
      MAP_GEOMETRY.width * this.scale - 1,
      MAP_GEOMETRY.height * this.scale - 1,
      10,
    );
    ctx.stroke();
  }

  drawGround(period) {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, 0, MAP_GEOMETRY.width, MAP_GEOMETRY.height);
    gradient.addColorStop(0, period === "heatwave" ? "#171817" : "#0e1819");
    gradient.addColorStop(0.55, "#0d1718");
    gradient.addColorStop(1, period === "night" ? "#0a1418" : "#111817");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, MAP_GEOMETRY.width, MAP_GEOMETRY.height);

    ctx.save();
    ctx.strokeStyle = "rgba(185, 208, 194, 0.025)";
    ctx.lineWidth = 0.6;
    for (let x = 0; x <= MAP_GEOMETRY.width; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, MAP_GEOMETRY.height);
      ctx.stroke();
    }
    for (let y = 0; y <= MAP_GEOMETRY.height; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(MAP_GEOMETRY.width, y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(109, 158, 144, 0.13)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 7]);
    roundRect(ctx, 27, 27, MAP_GEOMETRY.width - 54, MAP_GEOMETRY.height - 54, 15);
    ctx.stroke();
    ctx.restore();
  }

  drawHeatZones(period) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const block of MAP_GEOMETRY.blocks) {
      const normalized = normalizeTemperature(block.temperature);
      if (normalized < 0.38) continue;
      const cx = block.world.x + block.world.w / 2;
      const cy = block.world.y + block.world.h / 2;
      const outer = Math.max(block.world.w, block.world.h) * (0.7 + normalized * 0.18);
      const glow = ctx.createRadialGradient(cx, cy, 6, cx, cy, outer);
      glow.addColorStop(0, temperatureColor(block.temperature, 0.08 + (normalized - 0.38) * 0.4));
      glow.addColorStop(0.58, temperatureColor(block.temperature, 0.045 + (normalized - 0.38) * 0.18));
      glow.addColorStop(1, temperatureColor(block.temperature, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(cx - outer, cy - outer, outer * 2, outer * 2);
    }
    ctx.restore();

    if (period === "heatwave") {
      const hottest = [...MAP_GEOMETRY.blocks]
        .sort((a, b) => b.temperature - a.temperature)
        .slice(0, 3);
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 0.7;
      hottest.forEach((block, index) => {
        const pulse = 1 + index * 0.03;
        ctx.strokeStyle = `rgba(247, 145, 96, ${0.2 - index * 0.035})`;
        ctx.beginPath();
        ctx.ellipse(
          block.world.x + block.world.w / 2,
          block.world.y + block.world.h / 2,
          block.world.w * 0.65 * pulse,
          block.world.h * 0.63 * pulse,
          0,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      });
      ctx.restore();
    }
  }

  drawRoadNetwork() {
    const ctx = this.ctx;
    const blocks = MAP_GEOMETRY.blocks;
    const first = blocks[0];
    const second = blocks[1];
    const xStep = second.world.x - first.world.x;
    const yStep = blocks[6].world.y - first.world.y;
    const startX = first.world.x;
    const startY = first.world.y;
    const endX = blocks[5].world.x + blocks[5].world.w;
    const endY = blocks[23].world.y + blocks[23].world.h;

    ctx.save();
    ctx.strokeStyle = "rgba(201, 220, 207, 0.08)";
    ctx.lineWidth = 0.75;
    for (let col = 0; col < 5; col += 1) {
      const x = startX + col * xStep + first.world.w + MAP_WORLD.roadX / 2;
      ctx.beginPath();
      ctx.moveTo(x, startY - 6);
      ctx.lineTo(x, endY + 6);
      ctx.stroke();
      if (col !== 2) {
        ctx.save();
        ctx.setLineDash([7, 9]);
        ctx.strokeStyle = "rgba(214, 223, 199, 0.12)";
        ctx.beginPath();
        ctx.moveTo(x, startY + 6);
        ctx.lineTo(x, endY - 6);
        ctx.stroke();
        ctx.restore();
      }
    }
    for (let row = 0; row < 3; row += 1) {
      const y = startY + row * yStep + first.world.h + MAP_WORLD.roadY / 2;
      ctx.beginPath();
      ctx.moveTo(startX - 6, y);
      ctx.lineTo(endX + 6, y);
      ctx.stroke();
      ctx.save();
      ctx.setLineDash([10, 12]);
      ctx.strokeStyle = "rgba(214, 223, 199, 0.09)";
      ctx.beginPath();
      ctx.moveTo(startX + 8, y);
      ctx.lineTo(endX - 8, y);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  drawBlocks(period) {
    const ctx = this.ctx;
    for (const block of MAP_GEOMETRY.blocks) {
      const { x, y, w, h } = block.world;
      const normalized = normalizeTemperature(block.temperature);
      ctx.save();
      roundRect(ctx, x, y, w, h, 5);
      ctx.fillStyle = period === "night" ? "rgba(18, 29, 31, 0.92)" : "rgba(20, 31, 30, 0.9)";
      ctx.fill();
      ctx.strokeStyle = `rgba(188, 211, 199, ${0.08 + normalized * 0.08})`;
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.strokeStyle = "rgba(4, 10, 10, 0.34)";
      ctx.lineWidth = 1.8;
      roundRect(ctx, x + 5, y + 5, w - 10, h - 10, 3);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawParks(period) {
    const ctx = this.ctx;
    for (const block of MAP_GEOMETRY.blocks) {
      if (!["park", "waterfront"].includes(block.layout)) continue;
      const inner = block.inner;
      ctx.save();
      roundRect(ctx, inner.x, inner.y, inner.w, inner.h, 4);
      if (block.layout === "park") {
        ctx.fillStyle = "rgba(77, 120, 79, 0.3)";
        ctx.fill();
        ctx.strokeStyle = "rgba(143, 179, 120, 0.12)";
        ctx.stroke();
        const count = 17;
        for (let index = 0; index < count; index += 1) {
          const x = inner.x + 5 + seeded(index, block.col) * (inner.w - 10);
          const y = inner.y + 5 + seeded(index, block.row + 9) * (inner.h - 10);
          ctx.fillStyle = `rgba(117, 161, 107, ${0.26 + seeded(index, 4) * 0.2})`;
          ctx.beginPath();
          ctx.arc(x, y, 1.4 + seeded(index, 2) * 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = period === "night" ? "rgba(44, 111, 131, 0.2)" : "rgba(48, 124, 139, 0.18)";
        ctx.fill();
        ctx.strokeStyle = "rgba(99, 178, 185, 0.13)";
        ctx.lineWidth = 0.8;
        for (let line = 0; line < 4; line += 1) {
          const y = inner.y + 8 + line * ((inner.h - 16) / 3);
          ctx.beginPath();
          ctx.moveTo(inner.x + 5, y);
          ctx.bezierCurveTo(inner.x + inner.w * 0.35, y - 3, inner.x + inner.w * 0.65, y + 3, inner.x + inner.w - 5, y);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  drawBuildings(state) {
    const ctx = this.ctx;
    const selected = new Set(state.selectedIds || []);
    const period = state.period;
    for (const building of MAP_GEOMETRY.buildings) {
      const temperature = building.temperatures[period];
      const { x, y, w, h } = building.world;
      const isHovered = state.hoverId === building.id;
      const isSelected = selected.has(building.id);
      const isBelowThreshold = state.filter.enabled
        && temperature < state.filter.threshold;
      const dimmed = isBelowThreshold && !isHovered && !isSelected;
      ctx.save();
      if (dimmed) ctx.globalAlpha = 0.2;

      ctx.fillStyle = "rgba(3, 8, 8, 0.5)";
      roundRect(ctx, x + 2.5, y + 3.5, w, h, 2.2);
      ctx.fill();

      const roof = ctx.createLinearGradient(x, y, x + w, y + h);
      roof.addColorStop(0, lighten(temperature, 0.14));
      roof.addColorStop(0.48, temperatureHex(temperature));
      roof.addColorStop(1, darkness(temperature, 0.18));
      ctx.fillStyle = roof;
      roundRect(ctx, x, y, w, h, 2.2);
      ctx.fill();

      ctx.strokeStyle = "rgba(4, 10, 9, 0.68)";
      ctx.lineWidth = 0.85;
      ctx.stroke();

      if (w > 22 && h > 15) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.lineWidth = 0.55;
        ctx.beginPath();
        ctx.moveTo(x + 2.5, y + 2);
        ctx.lineTo(x + w - 3, y + 2);
        ctx.stroke();
      }
      ctx.restore();

      if (dimmed) {
        ctx.save();
        roundRect(ctx, x, y, w, h, 2.2);
        ctx.clip();
        ctx.strokeStyle = "rgba(7, 14, 14, 0.52)";
        ctx.lineWidth = 0.8;
        for (let offset = -h; offset < w + h; offset += 5) {
          ctx.beginPath();
          ctx.moveTo(x + offset, y + h);
          ctx.lineTo(x + offset + h, y);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (state.filter.enabled && !dimmed && !isSelected) {
        ctx.fillStyle = "rgba(255, 178, 101, 0.95)";
        ctx.beginPath();
        ctx.arc(x + w - 4, y + 4, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      if (isSelected) {
        ctx.save();
        ctx.strokeStyle = "#f6f0c7";
        ctx.lineWidth = 1.65;
        roundRect(ctx, x - 0.6, y - 0.6, w + 1.2, h + 1.2, 2.7);
        ctx.stroke();
        ctx.restore();
      }

      if (isHovered) {
        ctx.save();
        ctx.shadowColor = "rgba(255, 255, 255, 0.7)";
        ctx.shadowBlur = 8;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        roundRect(ctx, x - 1.2, y - 1.2, w + 2.4, h + 2.4, 3);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawSelection(state) {
    const ctx = this.ctx;
    const dragRect = state.dragRect;
    const selectionRect = state.selectionRect;
    const rect = dragRect || selectionRect;
    if (!rect || rect.w < 1 || rect.h < 1) return;

    ctx.save();
    ctx.fillStyle = dragRect ? "rgba(230, 243, 202, 0.06)" : "rgba(246, 240, 199, 0.045)";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = dragRect ? "rgba(230, 243, 202, 0.95)" : "rgba(246, 240, 199, 0.85)";
    ctx.lineWidth = dragRect ? 1.2 : 0.85;
    ctx.setLineDash(dragRect ? [4, 4] : [3, 5]);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.setLineDash([]);

    const corner = Math.min(7, rect.w * 0.22, rect.h * 0.22);
    ctx.strokeStyle = "#f8f0bd";
    ctx.lineWidth = 1.7;
    const corners = [
      [rect.x, rect.y, 1, 1],
      [rect.x + rect.w, rect.y, -1, 1],
      [rect.x, rect.y + rect.h, 1, -1],
      [rect.x + rect.w, rect.y + rect.h, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + sx * corner, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * corner);
      ctx.stroke();
    }

    if (!dragRect && state.selectionStats?.count) {
      const stats = state.selectionStats;
      const text = `${stats.count} 栋 · 平均 ${stats.average.toFixed(1)}°C`;
      ctx.font = '500 8px "Atlas Sans", sans-serif';
      const labelWidth = ctx.measureText(text).width + 15;
      const labelX = clamp(rect.x + 5, 6, MAP_GEOMETRY.width - labelWidth - 6);
      const labelY = clamp(rect.y + 5, 17, MAP_GEOMETRY.height - 20);
      ctx.fillStyle = "rgba(7, 14, 14, 0.88)";
      roundRect(ctx, labelX, labelY, labelWidth, 14, 3.5);
      ctx.fill();
      ctx.strokeStyle = "rgba(246, 240, 199, 0.24)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.fillStyle = "#f6f0c7";
      ctx.fillText(text, labelX + 7, labelY + 9.5);
    }
    ctx.restore();
  }

  drawMapLabels(period) {
    const ctx = this.ctx;
    const stats = PERIOD_STATS[period];
    ctx.save();
    ctx.font = '500 7.5px "Atlas Sans", sans-serif';
    ctx.textAlign = "left";
    for (const block of MAP_GEOMETRY.blocks) {
      ctx.fillStyle = "rgba(201, 216, 208, 0.45)";
      ctx.fillText(block.name, block.world.x + 2, block.world.y - 6);
    }

    const hottest = [...MAP_GEOMETRY.blocks].sort((a, b) => b.temperature - a.temperature)[0];
    if (hottest) {
      const tagX = hottest.world.x + hottest.world.w - 43;
      const tagY = hottest.world.y + hottest.world.h - 18;
      ctx.fillStyle = "rgba(8, 15, 15, 0.74)";
      roundRect(ctx, tagX, tagY, 36, 12, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 172, 113, 0.88)";
      ctx.beginPath();
      ctx.arc(tagX + 6, tagY + 6, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(245, 239, 216, 0.78)";
      ctx.font = '500 6.5px "Atlas Sans", sans-serif';
      ctx.fillText("高热区", tagX + 11, tagY + 8.5);
    }

    ctx.strokeStyle = "rgba(77, 154, 167, 0.28)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(1051, 96);
    ctx.bezierCurveTo(1045, 220, 1058, 368, 1050, 596);
    ctx.stroke();
    ctx.save();
    ctx.translate(1064, 338);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = "rgba(120, 184, 191, 0.42)";
    ctx.font = '400 6.5px "Atlas Sans", sans-serif';
    ctx.fillText("梧 桐 河", 0, 0);
    ctx.restore();

    ctx.fillStyle = "rgba(174, 194, 184, 0.35)";
    ctx.font = '400 6.5px "Ubuntu Mono", monospace';
    ctx.fillText(`SAMPLE / ${stats.count} ROOFS / ${period.toUpperCase()}`, 45, 675);
    ctx.restore();
  }

  drawLegend(state) {
    const ctx = this.ctx;
    const period = PERIODS[state.period];
    const stats = PERIOD_STATS[state.period];
    const x = 701;
    const y = 596;
    const width = 356;
    const height = 70;

    ctx.save();
    ctx.fillStyle = "rgba(7, 14, 15, 0.89)";
    roundRect(ctx, x, y, width, height, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(228, 239, 230, 0.13)";
    ctx.lineWidth = 0.75;
    ctx.stroke();

    ctx.fillStyle = "rgba(238, 240, 230, 0.9)";
    ctx.font = '600 8.5px "Atlas Sans", sans-serif';
    ctx.textAlign = "left";
    ctx.fillText(`表面温度 / ${period.label}`, x + 11, y + 14);

    ctx.fillStyle = "rgba(193, 207, 198, 0.58)";
    ctx.font = '400 7px "Atlas Sans", sans-serif';
    ctx.textAlign = "right";
    ctx.fillText(`均值 ${stats.average.toFixed(1)}°C`, x + width - 11, y + 14);

    const barX = x + 11;
    const barY = y + 21;
    const barW = width - 22;
    const barH = 7;
    const gradient = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    for (const [stop, hex] of COLOR_STOPS) {
      gradient.addColorStop(stop, hex);
    }
    ctx.fillStyle = gradient;
    roundRect(ctx, barX, barY, barW, barH, 3);
    ctx.fill();

    const averageX = barX + clamp(normalizeTemperature(stats.average), 0, 1) * barW;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(averageX, barY - 1.5);
    ctx.lineTo(averageX, barY + barH + 1.5);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(averageX, barY - 1.2);
    ctx.lineTo(averageX - 2.5, barY - 4.4);
    ctx.lineTo(averageX + 2.5, barY - 4.4);
    ctx.closePath();
    ctx.fill();

    if (state.filter.enabled) {
      const thresholdX = barX + clamp(normalizeTemperature(state.filter.threshold), 0, 1) * barW;
      ctx.strokeStyle = "rgba(255, 169, 92, 0.95)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([1.5, 1.5]);
      ctx.beginPath();
      ctx.moveTo(thresholdX, barY - 1);
      ctx.lineTo(thresholdX, barY + barH + 1);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(200, 212, 203, 0.62)";
    ctx.font = '400 6.5px "Ubuntu Mono", monospace';
    ctx.fillText(`${COLOR_DOMAIN.min}°`, barX, y + 40);
    ctx.textAlign = "center";
    ctx.fillText("35°", barX + barW / 2, y + 40);
    ctx.textAlign = "right";
    ctx.fillText(`${COLOR_DOMAIN.max}°`, barX + barW, y + 40);

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(171, 187, 178, 0.54)";
    ctx.font = '400 6.5px "Atlas Sans", sans-serif';
    ctx.fillText("绝对色阶 24–46°C", x + 11, y + 58);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(224, 231, 218, 0.68)";
    ctx.fillText(`当前范围 ${stats.min.toFixed(1)}–${stats.max.toFixed(1)}°C`, x + width - 11, y + 58);
    ctx.restore();
  }
}
