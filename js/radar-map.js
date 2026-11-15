(function () {
  "use strict";

  const Data = window.RadarData;
  const bounds = Data.BOUNDS;
  const grid = Data.GRID;

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function project(lon, lat, width, height) {
    return {
      x: ((lon - bounds.west) / (bounds.east - bounds.west)) * width,
      y: ((bounds.north - lat) / (bounds.north - bounds.south)) * height
    };
  }

  function tracePath(ctx, points, width, height, close) {
    points.forEach((point, index) => {
      const projected = project(point[0], point[1], width, height);
      if (index === 0) {
        ctx.moveTo(projected.x, projected.y);
      } else {
        ctx.lineTo(projected.x, projected.y);
      }
    });
    if (close) {
      ctx.closePath();
    }
  }

  const LAND = [
    [118, 32.8], [123.2, 32.8], [123.2, 32.17], [122.93, 32.06], [122.55, 32.02],
    [122.28, 31.88], [122.0, 31.77], [121.86, 31.52], [121.7, 31.32],
    [121.8, 31.12], [121.64, 30.82], [121.83, 30.57], [121.61, 30.31],
    [121.86, 30.09], [121.74, 29.91], [121.52, 29.77], [121.4, 29.55],
    [121.12, 29.37], [120.86, 29.24], [120.64, 29.1], [118, 29.1]
  ];

  const CHONGMING = [
    [121.17, 31.81], [121.57, 31.78], [121.92, 31.61], [121.72, 31.49],
    [121.38, 31.52], [121.14, 31.66]
  ];

  const ZHOUSHAN = [
    [122.02, 30.21], [122.28, 30.2], [122.43, 30.04], [122.24, 29.91],
    [122.03, 29.98], [121.93, 30.11]
  ];

  const CITIES = [
    { name: "南京", lon: 118.78, lat: 32.06, major: true },
    { name: "常州", lon: 119.97, lat: 31.81 },
    { name: "无锡", lon: 120.31, lat: 31.49 },
    { name: "苏州", lon: 120.62, lat: 31.30, major: true },
    { name: "南通", lon: 120.89, lat: 31.98 },
    { name: "上海", lon: 121.47, lat: 31.23, major: true },
    { name: "湖州", lon: 120.09, lat: 30.89 },
    { name: "嘉兴", lon: 120.75, lat: 30.75 },
    { name: "杭州", lon: 120.16, lat: 30.27, major: true },
    { name: "绍兴", lon: 120.58, lat: 30.0 },
    { name: "宁波", lon: 121.55, lat: 29.87, major: true }
  ];

  class RadarMap {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.echoCache = new Map();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.width = width;
      this.height = height;
      this.canvas.width = Math.round(width * this.dpr);
      this.canvas.height = Math.round(height * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      return { width, height };
    }

    buildEcho(frame) {
      if (this.echoCache.has(frame.index)) {
        return this.echoCache.get(frame.index);
      }
      const echo = document.createElement("canvas");
      echo.width = grid.cols;
      echo.height = grid.rows;
      const context = echo.getContext("2d");
      const image = context.createImageData(grid.cols, grid.rows);
      const pixels = image.data;

      for (let row = 0; row < grid.rows; row += 1) {
        for (let col = 0; col < grid.cols; col += 1) {
          const dbz = frame.field[row * grid.cols + col];
          const shade = Data.colorForDbz(dbz);
          const offset = (row * grid.cols + col) * 4;
          pixels[offset] = shade.color[0];
          pixels[offset + 1] = shade.color[1];
          pixels[offset + 2] = shade.color[2];
          pixels[offset + 3] = Math.round(shade.alpha * 255);
        }
      }
      context.putImageData(image, 0, 0);
      this.echoCache.set(frame.index, echo);
      return echo;
    }

    screenToGeo(x, y, width, height) {
      return {
        lon: bounds.west + (x / width) * (bounds.east - bounds.west),
        lat: bounds.north - (y / height) * (bounds.north - bounds.south)
      };
    }

    render(options) {
      this.drawScene(this.ctx, this.width, this.height, options);
    }

    renderExport(options, width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      this.drawScene(context, width, height, { ...options, exportMode: true, hover: null });
      return canvas;
    }

    drawScene(ctx, width, height, options) {
      ctx.clearRect(0, 0, width, height);
      this.drawBaseMap(ctx, width, height);
      this.drawEcho(ctx, width, height, options.frame);
      this.drawMapReference(ctx, width, height, options.exportMode);

      if (options.markers && options.markers.length) {
        this.drawMarkers(ctx, width, height, options.markers);
      }
      if (options.hover && !options.exportMode) {
        this.drawHover(ctx, width, height, options.hover, options.markMode);
      }
      this.drawLegend(ctx, width, height, options.exportMode);
      if (options.exportMode) {
        this.drawExportChrome(ctx, width, height, options.frame, options.markers || []);
      }
      this.drawVignette(ctx, width, height);
    }

    drawEcho(ctx, width, height, frame) {
      const echo = this.buildEcho(frame);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalAlpha = 0.96;
      ctx.drawImage(echo, 0, 0, width, height);
      ctx.restore();
    }

    buildLandPath(ctx, width, height) {
      ctx.beginPath();
      tracePath(ctx, LAND, width, height, true);
    }

    drawBaseMap(ctx, width, height) {
      const ocean = ctx.createLinearGradient(0, 0, width, height);
      ocean.addColorStop(0, "#0b2028");
      ocean.addColorStop(0.56, "#0a1b23");
      ocean.addColorStop(1, "#08161d");
      ctx.fillStyle = ocean;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.globalAlpha = 0.22;
      const seaGlow = ctx.createRadialGradient(width * 0.79, height * 0.5, 0, width * 0.79, height * 0.5, width * 0.5);
      seaGlow.addColorStop(0, "rgba(64, 154, 163, 0.4)");
      seaGlow.addColorStop(1, "rgba(64, 154, 163, 0)");
      ctx.fillStyle = seaGlow;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      this.buildLandPath(ctx, width, height);
      const land = ctx.createLinearGradient(width * 0.22, 0, width * 0.9, height);
      land.addColorStop(0, "#14282c");
      land.addColorStop(0.55, "#12252a");
      land.addColorStop(1, "#102125");
      ctx.fillStyle = land;
      ctx.fill();
      ctx.strokeStyle = "rgba(145, 190, 190, 0.24)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.save();
      this.buildLandPath(ctx, width, height);
      ctx.clip();
      const terrainA = ctx.createRadialGradient(width * 0.26, height * 0.3, 0, width * 0.26, height * 0.3, width * 0.28);
      terrainA.addColorStop(0, "rgba(67, 105, 93, 0.18)");
      terrainA.addColorStop(1, "rgba(67, 105, 93, 0)");
      ctx.fillStyle = terrainA;
      ctx.fillRect(0, 0, width, height);
      const terrainB = ctx.createRadialGradient(width * 0.51, height * 0.25, 0, width * 0.51, height * 0.25, width * 0.18);
      terrainB.addColorStop(0, "rgba(89, 117, 99, 0.11)");
      terrainB.addColorStop(1, "rgba(89, 117, 99, 0)");
      ctx.fillStyle = terrainB;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      ctx.fillStyle = "#12262b";
      ctx.strokeStyle = "rgba(145, 190, 190, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      tracePath(ctx, CHONGMING, width, height, true);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      tracePath(ctx, ZHOUSHAN, width, height, true);
      ctx.fill();
      ctx.stroke();

      const taihu = [
        [119.94, 31.44], [120.04, 31.52], [120.28, 31.51], [120.48, 31.41],
        [120.56, 31.25], [120.45, 31.09], [120.27, 31.02], [120.08, 31.08],
        [119.93, 31.22]
      ];
      ctx.fillStyle = "#0b2029";
      ctx.beginPath();
      tracePath(ctx, taihu, width, height, true);
      ctx.fill();
      ctx.strokeStyle = "rgba(99, 155, 162, 0.2)";
      ctx.stroke();

      const yangtze = [
        [118.0, 31.62], [118.72, 31.68], [119.38, 31.74], [120.02, 31.87],
        [120.68, 31.82], [121.08, 31.68], [121.48, 31.53], [121.9, 31.47],
        [122.32, 31.37]
      ];
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(8, 25, 32, 0.95)";
      ctx.lineWidth = Math.max(4, height * 0.011);
      ctx.beginPath();
      tracePath(ctx, yangtze, width, height, false);
      ctx.stroke();
      ctx.strokeStyle = "rgba(47, 100, 110, 0.46)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();

      const huangpu = [
        [120.94, 31.17], [121.16, 31.2], [121.34, 31.18], [121.52, 31.24], [121.67, 31.33]
      ];
      ctx.strokeStyle = "rgba(77, 132, 139, 0.32)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      tracePath(ctx, huangpu, width, height, false);
      ctx.stroke();

      const qiantang = [
        [119.82, 29.99], [120.16, 30.1], [120.5, 30.16], [120.86, 30.23], [121.18, 30.34], [121.55, 30.42]
      ];
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      tracePath(ctx, qiantang, width, height, false);
      ctx.stroke();
    }

    drawMapReference(ctx, width, height, exportMode) {
      ctx.save();
      ctx.strokeStyle = "rgba(139, 186, 189, 0.075)";
      ctx.fillStyle = "rgba(139, 186, 189, 0.32)";
      ctx.lineWidth = 1;
      ctx.font = `${exportMode ? 11 : 7}px ${getComputedStyle(document.body).getPropertyValue("--mono")}`;

      for (let lon = 118.5; lon <= 123; lon += 0.5) {
        const x = project(lon, 0, width, height).x;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        if (Math.abs(lon - Math.round(lon)) < 0.01) {
          ctx.fillText(`${lon.toFixed(0)}°E`, x + 3, exportMode ? 16 : 10);
        }
      }
      for (let lat = 29.5; lat <= 32.5; lat += 0.5) {
        const y = project(0, lat, width, height).y;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        if (Math.abs(lat - Math.round(lat)) < 0.01) {
          ctx.fillText(`${lat.toFixed(0)}°N`, 5, y - 4);
        }
      }

      ctx.strokeStyle = "rgba(142, 196, 195, 0.22)";
      ctx.lineWidth = exportMode ? 1.5 : 1;
      ctx.beginPath();
      tracePath(ctx, LAND, width, height, false);
      ctx.stroke();
      ctx.beginPath();
      tracePath(ctx, CHONGMING, width, height, true);
      ctx.stroke();
      ctx.beginPath();
      tracePath(ctx, ZHOUSHAN, width, height, true);
      ctx.stroke();

      ctx.font = `${exportMode ? 13 : 9}px ${getComputedStyle(document.body).getPropertyValue("--mono")}`;
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(2, 10, 14, 0.9)";
      ctx.shadowBlur = exportMode ? 4 : 3;
      CITIES.forEach((city) => {
        const point = project(city.lon, city.lat, width, height);
        if (point.x < 4 || point.y < 4 || point.x > width - 4 || point.y > height - 4) {
          return;
        }
        const dot = city.major ? 2.4 : 1.7;
        ctx.fillStyle = city.major ? "rgba(206, 224, 219, 0.72)" : "rgba(164, 192, 190, 0.54)";
        ctx.beginPath();
        ctx.arc(point.x, point.y, dot, 0, Math.PI * 2);
        ctx.fill();
        if (city.major) {
          ctx.strokeStyle = "rgba(183, 214, 207, 0.35)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(point.x, point.y, dot + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = city.major ? "rgba(205, 223, 219, 0.8)" : "rgba(157, 181, 180, 0.66)";
        ctx.fillText(city.name, point.x + dot + 5, point.y);
      });
      ctx.restore();

      const sea = project(122.62, 30.66, width, height);
      ctx.save();
      ctx.fillStyle = "rgba(128, 176, 180, 0.2)";
      ctx.font = `600 ${exportMode ? 14 : 8}px ${getComputedStyle(document.body).getPropertyValue("--mono")}`;
      ctx.textAlign = "center";
      ctx.letterSpacing = exportMode ? "5px" : "2px";
      ctx.fillText("东 海", sea.x, sea.y);
      const lake = project(120.25, 31.27, width, height);
      ctx.fillStyle = "rgba(124, 170, 175, 0.27)";
      ctx.font = `${exportMode ? 12 : 7}px ${getComputedStyle(document.body).getPropertyValue("--mono")}`;
      ctx.fillText("太湖", lake.x, lake.y);
      ctx.restore();
    }

    drawLegend(ctx, width, height, exportMode) {
      const compact = width < 620;
      const panelWidth = compact ? 112 : exportMode ? 158 : 134;
      const panelHeight = compact ? 184 : exportMode ? 246 : 210;
      const margin = compact ? 10 : 16;
      const x = width - panelWidth - margin;
      const y = height - panelHeight - margin;
      const mono = getComputedStyle(document.body).getPropertyValue("--mono");

      ctx.save();
      roundedRect(ctx, x, y, panelWidth, panelHeight, compact ? 8 : 10);
      ctx.fillStyle = "rgba(5, 15, 20, 0.78)";
      ctx.fill();
      ctx.strokeStyle = "rgba(155, 198, 199, 0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();

      const pad = compact ? 9 : 12;
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(168, 194, 193, 0.74)";
      ctx.font = `600 ${compact ? 7 : 8}px ${mono}`;
      ctx.fillText("REFLECTIVITY", x + pad, y + 14);
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(127, 230, 178, 0.8)";
      ctx.fillText("dBZ", x + panelWidth - pad, y + 14);
      ctx.textAlign = "left";

      const barX = x + pad;
      const barY = y + 27;
      const barWidth = compact ? 10 : 13;
      const barHeight = panelHeight - 49;
      const topValue = 68;
      const bottomValue = 7;
      const segments = 72;
      for (let index = 0; index < segments; index += 1) {
        const ratio = index / segments;
        const value = topValue - ratio * (topValue - bottomValue);
        const shade = Data.colorForDbz(value);
        ctx.fillStyle = shade.alpha === 0
          ? "rgba(31, 57, 62, 0.65)"
          : `rgba(${shade.color[0]}, ${shade.color[1]}, ${shade.color[2]}, ${Math.max(0.6, shade.alpha)})`;
        ctx.fillRect(barX, barY + ratio * barHeight, barWidth, barHeight / segments + 0.6);
      }
      ctx.strokeStyle = "rgba(221, 236, 232, 0.22)";
      ctx.strokeRect(barX - 0.5, barY - 0.5, barWidth + 1, barHeight + 1);

      const ticks = [60, 50, 40, 30, 20, 10];
      ctx.font = `${compact ? 7 : 8}px ${mono}`;
      ctx.textBaseline = "middle";
      ticks.forEach((tick) => {
        const ratio = (topValue - tick) / (topValue - bottomValue);
        const tickY = barY + ratio * barHeight;
        ctx.strokeStyle = "rgba(205, 225, 221, 0.3)";
        ctx.beginPath();
        ctx.moveTo(barX + barWidth, tickY);
        ctx.lineTo(barX + barWidth + 4, tickY);
        ctx.stroke();
        ctx.fillStyle = "rgba(183, 207, 203, 0.74)";
        ctx.fillText(String(tick), barX + barWidth + 9, tickY);
      });

      if (!compact) {
        const labels = [
          { value: 55, text: "强" },
          { value: 34, text: "中" },
          { value: 15, text: "弱" }
        ];
        ctx.font = `${exportMode ? 10 : 8}px ${mono}`;
        labels.forEach((label) => {
          const ratio = (topValue - label.value) / (topValue - bottomValue);
          ctx.fillStyle = "rgba(139, 167, 167, 0.54)";
          ctx.fillText(label.text, x + pad + 43, barY + ratio * barHeight);
        });
      }

      ctx.strokeStyle = "rgba(155, 198, 199, 0.12)";
      ctx.beginPath();
      ctx.moveTo(x + pad, y + panelHeight - 13);
      ctx.lineTo(x + panelWidth - pad, y + panelHeight - 13);
      ctx.stroke();
      ctx.fillStyle = "rgba(117, 143, 143, 0.55)";
      ctx.font = `${compact ? 6 : 7}px ${mono}`;
      ctx.fillText("COMPOSITE / SIM", x + pad, y + panelHeight - 6.5);
      ctx.restore();
    }

    drawMarkers(ctx, width, height, markers) {
      markers.forEach((marker, index) => {
        const point = project(marker.lon, marker.lat, width, height);
        const scale = Math.max(0.75, Math.min(1.4, width / 1000));
        const radius = 10 * scale;
        ctx.save();
        ctx.shadowColor = "rgba(255, 137, 79, 0.65)";
        ctx.shadowBlur = 14;
        ctx.strokeStyle = "#ff9b5d";
        ctx.fillStyle = "rgba(255, 118, 67, 0.13)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.setLineDash([2 * scale, 3 * scale]);
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius + 5 * scale, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 166, 107, 0.42)";
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(255, 213, 184, 0.9)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(point.x - radius - 4, point.y);
        ctx.lineTo(point.x - radius + 2, point.y);
        ctx.moveTo(point.x + radius - 2, point.y);
        ctx.lineTo(point.x + radius + 4, point.y);
        ctx.moveTo(point.x, point.y - radius - 4);
        ctx.lineTo(point.x, point.y - radius + 2);
        ctx.moveTo(point.x, point.y + radius - 2);
        ctx.lineTo(point.x, point.y + radius + 4);
        ctx.stroke();
        ctx.fillStyle = "#ffd4b3";
        ctx.beginPath();
        ctx.arc(point.x, point.y, 2.2 * scale, 0, Math.PI * 2);
        ctx.fill();

        const label = marker.id || `A-${String(index + 1).padStart(2, "0")}`;
        ctx.font = `600 ${Math.round(9 * scale)}px ${getComputedStyle(document.body).getPropertyValue("--mono")}`;
        const labelWidth = ctx.measureText(label).width + 12 * scale;
        const labelHeight = 16 * scale;
        let labelX = point.x + radius + 9;
        let labelY = point.y - labelHeight - 7 * scale;
        labelX = Math.min(labelX, width - labelWidth - 6);
        labelY = Math.max(6, labelY);
        roundedRect(ctx, labelX, labelY, labelWidth, labelHeight, 4);
        ctx.fillStyle = "rgba(10, 25, 29, 0.9)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 155, 93, 0.46)";
        ctx.stroke();
        ctx.fillStyle = "#ffb17b";
        ctx.textBaseline = "middle";
        ctx.fillText(label, labelX + 6 * scale, labelY + labelHeight / 2 + 0.5);
        ctx.restore();
      });
    }

    drawHover(ctx, width, height, hover, markMode) {
      const point = project(hover.lon, hover.lat, width, height);
      const cellWidth = width / grid.cols;
      const cellHeight = height / grid.rows;
      const cellX = hover.col * cellWidth;
      const cellY = hover.row * cellHeight;
      const accent = markMode ? "255, 210, 94" : "127, 230, 178";

      ctx.save();
      ctx.strokeStyle = `rgba(${accent}, 0.32)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(0, point.y);
      ctx.lineTo(width, point.y);
      ctx.moveTo(point.x, 0);
      ctx.lineTo(point.x, height);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = `rgba(${accent}, 0.08)`;
      ctx.fillRect(cellX, cellY, cellWidth, cellHeight);
      ctx.strokeStyle = `rgba(${accent}, 0.85)`;
      ctx.lineWidth = 1;
      ctx.strokeRect(cellX + 0.5, cellY + 0.5, Math.max(2, cellWidth - 1), Math.max(2, cellHeight - 1));
      ctx.strokeStyle = `rgba(${accent}, 0.28)`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = markMode ? "#ffd25e" : "#bdf5d9";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawExportChrome(ctx, width, height, frame, markers) {
      const scale = width / 1800;
      const mono = getComputedStyle(document.body).getPropertyValue("--mono");
      const left = 30 * scale;
      const top = 28 * scale;
      const panelWidth = 510 * scale;
      const panelHeight = 95 * scale;

      ctx.save();
      roundedRect(ctx, left, top, panelWidth, panelHeight, 10 * scale);
      ctx.fillStyle = "rgba(5, 16, 21, 0.8)";
      ctx.fill();
      ctx.strokeStyle = "rgba(134, 190, 188, 0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#7fe6b2";
      ctx.fillRect(left, top + 18 * scale, 3 * scale, 56 * scale);

      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(155, 183, 182, 0.8)";
      ctx.font = `600 ${10 * scale}px ${mono}`;
      ctx.fillText("ECHOMARK / 区域雷达回放", left + 18 * scale, top + 22 * scale);
      ctx.fillStyle = "#eef5f2";
      ctx.font = `500 ${23 * scale}px ${mono}`;
      ctx.fillText(`${frame.date}  ${frame.label}`, left + 18 * scale, top + 50 * scale);
      ctx.fillStyle = "rgba(172, 197, 194, 0.76)";
      ctx.font = `${10 * scale}px ${mono}`;
      ctx.fillText(`FRAME ${String(frame.index + 1).padStart(2, "0")} / ${Data.FRAME_COUNT}  ·  合成反射率  ·  长三角拼图`, left + 18 * scale, top + 73 * scale);
      ctx.fillStyle = markers.length ? "#ffb17b" : "rgba(129, 157, 155, 0.7)";
      ctx.textAlign = "right";
      ctx.fillText(markers.length ? `ANOMALY × ${markers.length}` : "NO ANOMALY", left + panelWidth - 16 * scale, top + 22 * scale);

      const stampWidth = 238 * scale;
      const stampHeight = 41 * scale;
      const stampX = width - stampWidth - 30 * scale;
      const stampY = 28 * scale;
      roundedRect(ctx, stampX, stampY, stampWidth, stampHeight, 7 * scale);
      ctx.fillStyle = "rgba(5, 16, 21, 0.72)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 210, 94, 0.2)";
      ctx.stroke();
      ctx.fillStyle = "#d9c27a";
      ctx.font = `600 ${9 * scale}px ${mono}`;
      ctx.textAlign = "center";
      ctx.fillText("SIMULATED RADAR  /  NOT FOR OPERATIONS", stampX + stampWidth / 2, stampY + 18 * scale);
      ctx.fillStyle = "rgba(151, 174, 171, 0.64)";
      ctx.font = `${8 * scale}px ${mono}`;
      ctx.fillText("程序化回波 · 非真实观测图像", stampX + stampWidth / 2, stampY + 31 * scale);

      ctx.strokeStyle = "rgba(163, 201, 199, 0.18)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(139, 166, 164, 0.65)";
      ctx.font = `${9 * scale}px ${mono}`;
      ctx.fillText(`SOURCE  SIM-03  ·  ${frame.iso}  ·  ${markers.length} ANOMALY CELLS`, 30 * scale, height - 24 * scale);
      ctx.textAlign = "right";
      ctx.fillText("ECHOMARK RADAR CONSOLE / 2026", width - 30 * scale, height - 24 * scale);
      ctx.restore();
    }

    drawVignette(ctx, width, height) {
      const gradient = ctx.createRadialGradient(
        width * 0.5, height * 0.45, Math.min(width, height) * 0.25,
        width * 0.5, height * 0.45, Math.max(width, height) * 0.72
      );
      gradient.addColorStop(0, "rgba(2, 10, 14, 0)");
      gradient.addColorStop(1, "rgba(2, 9, 13, 0.47)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }
  }

  window.RadarMap = RadarMap;
})();
