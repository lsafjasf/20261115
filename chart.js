(function (root) {
  "use strict";

  const COLORS = {
    ink: "#14263a",
    muted: "#7d8b9c",
    faint: "#a8b3bf",
    grid: "#e7ecf1",
    gridStrong: "#d5dde5",
    plot: "#fbfcfd",
    section: "#3f92e2",
    switch: "#d99735",
    red: "#cf3f45",
    amber: "#c57a12",
    green: "#18845c",
  };

  const FONT = '"Noto Sans SC Local", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif';
  const MONO = '"SFMono-Regular", "Cascadia Code", "Liberation Mono", "Noto Sans SC Local", monospace';
  const layouts = new WeakMap();

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function hexToRgba(hex, alpha) {
    const value = hex.replace("#", "");
    const full = value.length === 3
      ? value.split("").map(function (char) { return char + char; }).join("")
      : value;
    const number = parseInt(full, 16);
    const r = (number >> 16) & 255;
    const g = (number >> 8) & 255;
    const b = number & 255;
    return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
  }

  function makeLayout(width, height, mode, result) {
    const isExport = mode === "export";
    const compact = !isExport && width < 540;
    const margin = isExport
      ? { left: 175, right: 54, top: 250, bottom: 112 }
      : { left: compact ? 68 : width < 760 ? 93 : 122, right: compact ? 14 : 23, top: 67, bottom: 31 };
    const plotWidth = width - margin.left - margin.right;
    const top = margin.top;
    const rowGap = isExport ? 15 : compact ? 6 : 8;
    const heights = isExport ? [70, 48, 62, 62] : compact ? [40, 24, 34, 34] : [46, 30, 38, 38];
    const labels = [
      { title: compact ? "单线" : "单线区段", sub: "青川—岭口", kind: "section" },
      { title: compact ? "道岔" : "咽喉道岔", sub: "接发车互斥", kind: "switch" },
      { title: "1道", sub: "到发线", kind: "track", track: "1" },
      { title: "2道", sub: "到发线", kind: "track", track: "2" },
    ];
    let y = top;
    const rows = labels.map(function (label, index) {
      const row = Object.assign({}, label, {
        y: y,
        height: heights[index],
        center: y + heights[index] / 2,
      });
      y += heights[index] + rowGap;
      return row;
    });
    return {
      width: width,
      height: height,
      mode: mode,
      margin: margin,
      plotLeft: margin.left,
      plotRight: width - margin.right,
      plotWidth: plotWidth,
      plotTop: top,
      plotBottom: y - rowGap,
      rows: rows,
      windowStart: result.window.start,
      windowEnd: result.window.end,
      isExport: isExport,
      compact: compact,
    };
  }

  function timeToX(layout, time) {
    const ratio = (time - layout.windowStart) / (layout.windowEnd - layout.windowStart);
    return layout.plotLeft + Math.max(0, Math.min(1, ratio)) * layout.plotWidth;
  }

  function rowForOccupancy(layout, item) {
    if (item.kind === "section") return layout.rows[0];
    if (item.kind === "switch") return layout.rows[1];
    if (item.kind === "track") return item.resource === "1" ? layout.rows[2] : layout.rows[3];
    return null;
  }

  function prepareCanvas(canvas, width, height, dpr) {
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return ctx;
  }

  function drawDisplayHeader(ctx, layout, result) {
    const left = layout.plotLeft;
    const right = layout.plotRight;
    ctx.fillStyle = COLORS.ink;
    ctx.font = "700 11px " + MONO;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(layout.compact ? "占用时间轴" : "资源占用时间轴", left, 24);

    ctx.fillStyle = COLORS.muted;
    ctx.font = "500 9px " + FONT;
    if (!layout.compact) ctx.fillText("计划窗口 07:50—09:40 · 每格 10 min", left + 91, 24);

    ctx.textAlign = "right";
    ctx.fillStyle = result.stats.severeCount ? COLORS.red : COLORS.green;
    ctx.font = "700 9px " + MONO;
    ctx.fillText(layout.compact
      ? result.stats.severeCount ? "BLOCKED" : "PASSED"
      : result.stats.severeCount ? "BLOCKED · " + result.stats.severeCount + " SEVERE" : "CHECK PASSED · 0 SEVERE",
    right, 24);
  }

  function drawExportHeader(ctx, layout, result) {
    const width = layout.width;
    ctx.fillStyle = "#0d1b2a";
    ctx.fillRect(0, 0, width, 92);

    ctx.fillStyle = "#63d9c5";
    roundedRect(ctx, 48, 27, 39, 39, 10);
    ctx.fill();
    ctx.fillStyle = "#08231f";
    ctx.font = "800 10px " + MONO;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("QY", 67.5, 47);

    ctx.textAlign = "left";
    ctx.fillStyle = "#8fa8b8";
    ctx.font = "700 10px " + MONO;
    ctx.fillText("RAIL OPS / 单线会让 · QY-06", 102, 34);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 24px " + FONT;
    ctx.fillText("青川站 · 占用甘特图", 102, 59);

    ctx.textAlign = "right";
    ctx.fillStyle = "#b9c9d4";
    ctx.font = "500 11px " + FONT;
    ctx.fillText("计划窗口 07:50—09:40", width - 50, 35);
    ctx.fillStyle = result.stats.ready ? "#72dfca" : "#ff9da1";
    ctx.font = "700 11px " + MONO;
    ctx.fillText(result.stats.ready ? "✓ 校验通过，可放行" : "× 存在严重冲突，禁止导出", width - 50, 58);

    const metrics = [
      { label: "图定列车", value: result.stats.plannedTrains + " 列" },
      { label: "单线占用", value: result.stats.sectionMinutes + " min" },
      { label: "到发线占用", value: result.stats.trackMinutes + " min" },
      { label: "单线利用率", value: result.stats.sectionUtil.toFixed(1) + "%" },
    ];
    metrics.forEach(function (metric, index) {
      const x = 48 + index * 368;
      ctx.fillStyle = "#f5f8fa";
      roundedRect(ctx, x, 112, 348, 65, 8);
      ctx.fill();
      ctx.fillStyle = "#7f91a1";
      ctx.textAlign = "left";
      ctx.font = "500 10px " + FONT;
      ctx.fillText(metric.label, x + 15, 133);
      ctx.fillStyle = "#14263a";
      ctx.font = "700 20px " + MONO;
      ctx.fillText(metric.value, x + 15, 157);
    });

    ctx.fillStyle = COLORS.ink;
    ctx.font = "700 11px " + MONO;
    ctx.textAlign = "left";
    ctx.fillText("资源占用时间轴", layout.plotLeft, 202);
    ctx.fillStyle = COLORS.muted;
    ctx.font = "500 9px " + FONT;
    ctx.fillText("每格 10 min", layout.plotLeft + 88, 202);
    ctx.textAlign = "right";
    ctx.fillStyle = result.stats.severeCount ? COLORS.red : COLORS.green;
    ctx.font = "700 9px " + MONO;
    ctx.fillText(
      result.stats.severeCount ? "BLOCKED · " + result.stats.severeCount + " SEVERE" : "CHECK PASSED · 0 SEVERE",
      layout.plotRight,
      202
    );
  }

  function drawTimeAxis(ctx, layout) {
    const start = layout.windowStart;
    const end = layout.windowEnd;
    const tickStep = layout.compact ? 20 : 10;
    const firstTick = Math.ceil(start / tickStep) * tickStep;
    const labels = [start].concat(
      Array.from({ length: Math.floor((end - firstTick) / tickStep) + 1 }, function (_, index) {
        return firstTick + index * tickStep;
      })
    );
    const uniqueLabels = Array.from(new Set(labels));
    const axisY = layout.plotTop - 14;

    ctx.save();
    ctx.textBaseline = "middle";
    uniqueLabels.forEach(function (time) {
      const x = timeToX(layout, time);
      ctx.strokeStyle = time === start ? COLORS.gridStrong : COLORS.grid;
      ctx.lineWidth = 1;
      ctx.setLineDash(time === start ? [3, 3] : []);
      ctx.beginPath();
      ctx.moveTo(x, layout.plotTop - 5);
      ctx.lineTo(x, layout.plotBottom);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = time === start ? COLORS.ink : COLORS.muted;
      ctx.font = (time === start ? "700 " : "500 ") + (layout.isExport ? "10px " : "8px ") + MONO;
      ctx.textAlign = time === start ? "left" : "center";
      ctx.fillText(
        String(Math.floor(time / 60)).padStart(2, "0") + ":" + String(time % 60).padStart(2, "0"),
        x,
        axisY
      );
    });

    for (let time = Math.ceil(start / 5) * 5; time < end; time += 5) {
      if (time % 10 === 0) continue;
      const x = timeToX(layout, time);
      ctx.fillStyle = "#d6dee6";
      ctx.beginPath();
      ctx.arc(x, axisY, 1.15, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawRows(ctx, layout, result, selectedId) {
    const selectedTrainRows = new Set();
    result.occupancies.forEach(function (item) {
      if (item.trainId !== selectedId) return;
      const row = rowForOccupancy(layout, item);
      if (row) selectedTrainRows.add(row);
    });

    ctx.save();
    layout.rows.forEach(function (row) {
      ctx.fillStyle = selectedTrainRows.has(row) ? "#edf5f7" : "#f7f9fb";
      roundedRect(ctx, layout.plotLeft, row.y, layout.plotWidth, row.height, 5);
      ctx.fill();
      ctx.strokeStyle = selectedTrainRows.has(row) ? "#c8e1df" : "#f0f3f6";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = COLORS.ink;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.font = "700 " + (layout.isExport ? "12px " : "9px ") + FONT;
      ctx.fillText(row.title, layout.plotLeft - 16, row.center - 6);
      ctx.fillStyle = COLORS.muted;
      ctx.font = "500 " + (layout.isExport ? "9px " : "7px ") + FONT;
      if (!layout.compact) ctx.fillText(row.sub, layout.plotLeft - 16, row.center + 7);
    });
    ctx.restore();
  }

  function barAppearance(item) {
    if (item.kind === "section") return { fill: COLORS.section, text: "#ffffff" };
    if (item.kind === "switch") return { fill: COLORS.switch, text: "#ffffff" };
    return { fill: item.color || "#2f9f91", text: "#ffffff" };
  }

  function drawOccupancyBars(ctx, layout, result, selectedId) {
    ctx.save();
    roundedRect(ctx, layout.plotLeft, layout.plotTop, layout.plotWidth, layout.plotBottom - layout.plotTop, 5);
    ctx.clip();

    result.occupancies.forEach(function (item) {
      const row = rowForOccupancy(layout, item);
      if (!row) return;
      const start = Math.max(item.start, layout.windowStart);
      const end = Math.min(item.end, layout.windowEnd);
      if (end <= start) return;
      const x = timeToX(layout, start);
      const right = timeToX(layout, end);
      const width = Math.max(1.5, right - x);
      const padY = layout.isExport ? 9 : 6;
      const y = row.y + padY;
      const height = row.height - padY * 2;
      const appearance = barAppearance(item);
      const isSelected = item.trainId === selectedId;

      ctx.save();
      if (isSelected) {
        ctx.shadowColor = "rgba(13, 27, 42, 0.22)";
        ctx.shadowBlur = 7;
      }
      ctx.globalAlpha = isSelected ? 1 : 0.91;
      ctx.fillStyle = appearance.fill;
      roundedRect(ctx, x, y, width, height, Math.min(4, height / 2));
      ctx.fill();
      ctx.shadowBlur = 0;

      if (item.kind !== "switch") {
        const gradient = ctx.createLinearGradient(x, y, x, y + height);
        gradient.addColorStop(0, "rgba(255,255,255,0.17)");
        gradient.addColorStop(0.55, "rgba(255,255,255,0)");
        gradient.addColorStop(1, "rgba(0,0,0,0.08)");
        ctx.fillStyle = gradient;
        roundedRect(ctx, x, y, width, height, Math.min(4, height / 2));
        ctx.fill();
      }

      if (isSelected) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = COLORS.ink;
        ctx.lineWidth = 2;
        roundedRect(ctx, x - 1, y - 1, width + 2, height + 2, Math.min(5, height / 2));
        ctx.stroke();
      }
      ctx.restore();

      const label = item.kind === "track"
        ? item.trainNumber + " · " + Math.round(item.end - item.start) + "m"
        : item.trainNumber;
      const minWidth = layout.isExport ? 48 : 31;
      if (width >= minWidth) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 3, y, width - 6, height);
        ctx.clip();
        ctx.fillStyle = appearance.text;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = "700 " + (layout.isExport ? "10px " : "7px ") + MONO;
        ctx.fillText(label, x + 5, row.center);
        ctx.restore();
      }
    });
    ctx.restore();
  }

  function drawConflictMarkers(ctx, layout, result) {
    const markers = result.conflicts.filter(function (conflict) {
      return conflict.time !== null &&
        conflict.time >= layout.windowStart &&
        conflict.time <= layout.windowEnd &&
        conflict.kind !== "input";
    });
    if (!markers.length) return;

    const laneCenters = [];
    ctx.save();
    markers.forEach(function (conflict) {
      const x = timeToX(layout, conflict.time);
      const color = conflict.severity === "severe" ? COLORS.red : COLORS.amber;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, layout.plotTop - 2);
      ctx.lineTo(x, layout.plotBottom + 4);
      ctx.stroke();
      ctx.setLineDash([]);

      const label = conflict.code;
      ctx.font = "700 " + (layout.isExport ? "9px " : "7px ") + MONO;
      const textWidth = ctx.measureText(label).width;
      const pillWidth = textWidth + 10;
      const pillHeight = layout.isExport ? 17 : 13;
      let lane = 0;
      while (laneCenters[lane] !== undefined && Math.abs(laneCenters[lane] - x) < pillWidth + 3) {
        lane += 1;
      }
      laneCenters[lane] = x;
      const pillY = layout.plotTop - (layout.isExport ? 34 : 28) - lane * (pillHeight + 2);
      const pillX = Math.max(layout.plotLeft, Math.min(x - pillWidth / 2, layout.plotRight - pillWidth));
      ctx.fillStyle = color;
      roundedRect(ctx, pillX, pillY, pillWidth, pillHeight, 5);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, pillX + pillWidth / 2, pillY + pillHeight / 2 + 0.5);
    });
    ctx.restore();
  }

  function drawDisplayFooter(ctx, layout, result) {
    const y = layout.height - 15;
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.muted;
    ctx.font = "500 8px " + FONT;
    ctx.fillText(
      result.stats.plannedTrains + " 列车 · " + result.occupancies.length + " 个占用片段",
      layout.plotLeft,
      y
    );
    ctx.textAlign = "right";
    ctx.font = "700 8px " + MONO;
    ctx.fillStyle = result.stats.severeCount ? COLORS.red : COLORS.green;
    ctx.fillText(result.stats.severeCount ? "导出已锁定" : "实时校验通过", layout.plotRight, y);
    ctx.restore();
  }

  function drawExportSchedule(ctx, layout, result) {
    const titleY = layout.plotBottom + 38;
    const cardTop = titleY + 18;
    const columns = 3;
    const gap = 10;
    const cardWidth = (layout.plotWidth - gap * (columns - 1)) / columns;
    const cardHeight = 52;
    const rowGap = 9;

    ctx.save();
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.ink;
    ctx.font = "700 11px " + MONO;
    ctx.fillText("列车时刻摘要", layout.plotLeft, titleY);
    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.muted;
    ctx.font = "500 9px " + FONT;
    ctx.fillText(
      result.stats.plannedTrains + " 列 · 平均折返 " +
        (result.stats.averageTurnaround === null ? "—" : result.stats.averageTurnaround.toFixed(1) + " min"),
      layout.plotRight,
      titleY
    );

    result.trains.forEach(function (train, index) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = layout.plotLeft + column * (cardWidth + gap);
      const y = cardTop + row * (cardHeight + rowGap);
      ctx.fillStyle = "#ffffff";
      roundedRect(ctx, x, y, cardWidth, cardHeight, 6);
      ctx.fill();
      ctx.strokeStyle = "#e3e9ee";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = train.color || COLORS.section;
      roundedRect(ctx, x, y + 8, 3, cardHeight - 16, 2);
      ctx.fill();

      ctx.fillStyle = COLORS.ink;
      ctx.font = "700 11px " + MONO;
      ctx.textAlign = "left";
      ctx.fillText(train.number, x + 13, y + 17);
      ctx.fillStyle = COLORS.muted;
      ctx.font = "500 8px " + FONT;
      ctx.textAlign = "right";
      ctx.fillText(train.track + "道 · 折返 " + (train.departureMin - train.arrivalMin) + " min", x + cardWidth - 14, y + 17);
      ctx.fillStyle = COLORS.ink;
      ctx.font = "700 10px " + MONO;
      ctx.textAlign = "left";
      ctx.fillText(train.arrival + "  →  " + train.departure, x + 13, y + 36);
    });
    ctx.restore();
  }

  function drawExportFooter(ctx, layout, result) {
    const y = layout.height - 67;
    const items = [
      { label: "单线占用", color: COLORS.section },
      { label: "道岔锁闭", color: COLORS.switch },
      { label: "到发线停留", color: COLORS.ink },
      { label: "冲突位置", color: COLORS.red, line: true },
    ];
    ctx.save();
    let x = layout.plotLeft;
    ctx.textBaseline = "middle";
    items.forEach(function (item) {
      if (item.line) {
        ctx.fillStyle = item.color;
        ctx.fillRect(x, y - 7, 2, 14);
      } else {
        ctx.fillStyle = item.color;
        roundedRect(ctx, x, y - 4, 14, 8, 2);
        ctx.fill();
      }
      ctx.fillStyle = COLORS.muted;
      ctx.font = "500 9px " + FONT;
      ctx.textAlign = "left";
      ctx.fillText(item.label, x + 21, y);
      x += ctx.measureText(item.label).width + 64;
    });

    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.faint;
    ctx.font = "500 8px " + FONT;
    ctx.fillText(
      "青川站调度台生成 · " + new Date().toLocaleString("zh-CN", { hour12: false }) + " · 所有时间均为当地时间",
      layout.plotRight,
      y
    );
    ctx.restore();
  }

  function render(canvas, result, options) {
    const opts = options || {};
    const mode = opts.mode === "export" ? "export" : "display";
    const isExport = mode === "export";
    const rect = canvas.getBoundingClientRect();
    const width = isExport ? 1600 : Math.max(300, Math.round(rect.width || 1100));
    const height = isExport ? 900 : Math.max(300, Math.round(rect.height || 354));
    const dpr = isExport ? 1 : Math.min(2.5, window.devicePixelRatio || 1);
    const ctx = prepareCanvas(canvas, width, height, dpr);
    const layout = makeLayout(width, height, mode, result);
    layouts.set(canvas, {
      layout: layout,
      result: result,
      dpr: dpr,
    });

    ctx.fillStyle = isExport ? "#f2f5f8" : COLORS.plot;
    ctx.fillRect(0, 0, width, height);

    if (isExport) {
      drawExportHeader(ctx, layout, result);
    } else {
      drawDisplayHeader(ctx, layout, result);
    }

    drawRows(ctx, layout, result, opts.selectedId || null);
    drawTimeAxis(ctx, layout);
    drawOccupancyBars(ctx, layout, result, opts.selectedId || null);
    drawConflictMarkers(ctx, layout, result);

    if (isExport) {
      drawExportSchedule(ctx, layout, result);
      drawExportFooter(ctx, layout, result);
    } else {
      drawDisplayFooter(ctx, layout, result);
    }

    return { width: width, height: height };
  }

  function hitTest(canvas, clientX, clientY, result) {
    const stored = layouts.get(canvas);
    if (!stored) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (stored.layout.width / rect.width);
    const y = (clientY - rect.top) * (stored.layout.height / rect.height);
    const layout = stored.layout;

    for (let index = result.occupancies.length - 1; index >= 0; index -= 1) {
      const item = result.occupancies[index];
      const row = rowForOccupancy(layout, item);
      if (!row) continue;
      if (y < row.y || y > row.y + row.height) continue;
      const startX = timeToX(layout, Math.max(item.start, layout.windowStart));
      const endX = timeToX(layout, Math.min(item.end, layout.windowEnd));
      if (endX <= startX) continue;
      if (x >= startX - 2 && x <= endX + 2) {
        return {
          item: item,
          row: row,
          left: startX,
          right: endX,
          top: row.y,
          bottom: row.y + row.height,
        };
      }
    }
    return null;
  }

  root.GanttChart = {
    render: render,
    hitTest: hitTest,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
