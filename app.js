(function () {
  "use strict";

  const sample = window.TIDE_SAMPLE;
  const DEFAULT_THRESHOLD = 2.6;
  const DEFAULT_WINDOW = "24";
  const FALLBACK_COLORS = ["#087c73", "#477fa2", "#9a783e", "#7f6a9e"];
  const STATION_COLORS = new Map(sample.stations.map((station) => [station.name, station.color]));
  const STATION_ORDER = sample.stations.map((station) => station.name);

  const state = {
    station: "all",
    threshold: DEFAULT_THRESHOLD,
    windowMode: DEFAULT_WINDOW,
    hoverMs: null,
  };

  const elements = {
    stationSelect: document.getElementById("stationSelect"),
    thresholdInput: document.getElementById("thresholdInput"),
    windowSelect: document.getElementById("windowSelect"),
    resetButton: document.getElementById("resetButton"),
    thresholdEcho: document.getElementById("thresholdEcho"),
    scaleMarker: document.getElementById("scaleMarker"),
    dataRange: document.getElementById("dataRange"),
    currentLevel: document.getElementById("currentLevel"),
    currentMeta: document.getElementById("currentMeta"),
    peakLevel: document.getElementById("peakLevel"),
    peakMeta: document.getElementById("peakMeta"),
    alertCount: document.getElementById("alertCount"),
    gapCount: document.getElementById("gapCount"),
    gapMeta: document.getElementById("gapMeta"),
    alertStat: document.querySelector(".alert-stat"),
    chartTitle: document.getElementById("chartTitle"),
    chartSummary: document.getElementById("chartSummary"),
    chartFrame: document.getElementById("chartFrame"),
    canvas: document.getElementById("tideChart"),
    tooltip: document.getElementById("chartTooltip"),
    chartEmpty: document.getElementById("chartEmpty"),
    chartLegend: document.querySelector(".chart-legend"),
    stationLegend: document.getElementById("stationLegend"),
    alertPill: document.getElementById("alertPill"),
    alertList: document.getElementById("alertList"),
    logSummary: document.getElementById("logSummary"),
    logList: document.getElementById("logList"),
    exportPngButton: document.getElementById("exportPngButton"),
    exportLogButton: document.getElementById("exportLogButton"),
  };

  let parsedData = null;
  let lastRender = null;

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function parseCsvLine(line) {
    const cells = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === "," && !quoted) {
        cells.push(value.trim());
        value = "";
      } else {
        value += char;
      }
    }
    cells.push(value.trim());
    return cells;
  }

  function formatDateTime(ms, withSeconds = false) {
    const shifted = new Date(ms + 8 * 60 * 60 * 1000);
    const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
    const day = String(shifted.getUTCDate()).padStart(2, "0");
    const hour = String(shifted.getUTCHours()).padStart(2, "0");
    const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
    if (withSeconds) {
      const second = String(shifted.getUTCSeconds()).padStart(2, "0");
      return `${month}-${day} ${hour}:${minute}:${second}`;
    }
    return `${month}-${day} ${hour}:${minute}`;
  }

  function formatFullDate(ms) {
    const shifted = new Date(ms + 8 * 60 * 60 * 1000);
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(
      shifted.getUTCDate(),
    ).padStart(2, "0")}`;
  }

  function stationColor(name) {
    if (STATION_COLORS.has(name)) return STATION_COLORS.get(name);
    const order = parsedData?.stations.findIndex((station) => station.name === name) ?? 0;
    return FALLBACK_COLORS[Math.max(0, order) % FALLBACK_COLORS.length];
  }

  function parseTimestamp(raw) {
    if (!raw) return NaN;
    const direct = Date.parse(raw);
    if (Number.isFinite(direct)) return direct;
    const normalized = raw.replace(" ", "T");
    return Date.parse(normalized);
  }

  function parseCsv(csvText) {
    const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
    const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
    const aliases = {
      station: ["station", "站点", "站名"],
      timestamp: ["timestamp", "time", "datetime", "时间", "时间戳"],
      level: ["water_level", "level", "tide", "水位", "潮位"],
    };
    const indexes = {};
    for (const [key, names] of Object.entries(aliases)) {
      indexes[key] = headers.findIndex((header) => names.includes(header));
    }
    if (Object.values(indexes).some((index) => index < 0)) {
      throw new Error("CSV 需包含 station、timestamp、water_level 三列");
    }

    const groups = new Map();
    const logs = [];
    let invalidRows = 0;
    for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
      const cells = parseCsvLine(lines[lineIndex]);
      if (cells.every((cell) => !cell)) continue;
      const station = cells[indexes.station];
      const timestampRaw = cells[indexes.timestamp];
      const levelRaw = cells[indexes.level] ?? "";
      const ms = parseTimestamp(timestampRaw);
      if (!station || !Number.isFinite(ms)) {
        invalidRows += 1;
        logs.push({
          type: "invalid",
          ms: Number.isFinite(ms) ? ms : null,
          station: station || "未知站点",
          title: "整行无效",
          detail: `CSV 第 ${lineIndex + 1} 行站点或时间戳无法解析，已跳过`,
        });
        continue;
      }
      const key = `${station}|${ms}`;
      if (!groups.has(key)) {
        groups.set(key, { station, ms, records: [] });
      }
      groups.get(key).records.push({
        raw: levelRaw,
        value: levelRaw === "" ? NaN : Number(levelRaw),
        line: lineIndex + 1,
      });
    }

    const cleanedGroups = [];
    let duplicateGroups = 0;
    let invalidLevels = 0;
    for (const group of groups.values()) {
      const validRecords = group.records.filter((record) => Number.isFinite(record.value));
      const invalidRecords = group.records.filter((record) => !Number.isFinite(record.value));
      invalidLevels += invalidRecords.length;
      const value = validRecords.length
        ? validRecords.reduce((sum, record) => sum + record.value, 0) / validRecords.length
        : null;
      if (group.records.length > 1) {
        duplicateGroups += 1;
        const rawValues = group.records.map((record) => record.raw || "空值").join(" / ");
        logs.push({
          type: "duplicate",
          ms: group.ms,
          station: group.station,
          title: "重复时间戳",
          detail:
            value === null
              ? `${formatDateTime(group.ms)} 共 ${group.records.length} 条记录均无效（${rawValues}），保留为缺测`
              : `${formatDateTime(group.ms)} 合并 ${group.records.length} 条记录（${rawValues}），采用均值 ${value.toFixed(2)} m`,
        });
      }
      for (const record of invalidRecords) {
        if (record.raw !== "") {
          logs.push({
            type: "invalid",
            ms: group.ms,
            station: group.station,
            title: "非法水位",
            detail: `CSV 第 ${record.line} 行“${record.raw}”不是有效数字，按缺测处理`,
          });
        }
      }
      cleanedGroups.push({ station: group.station, ms: group.ms, value, records: group.records });
    }

    const stations = Array.from(new Set(cleanedGroups.map((group) => group.station))).sort(
      (a, b) => {
        const ai = STATION_ORDER.indexOf(a);
        const bi = STATION_ORDER.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b, "zh-CN");
      },
    );
    const sortedTimes = cleanedGroups.map((group) => group.ms).sort((a, b) => a - b);
    const startMs = Date.parse(sample.startTime) || sortedTimes[0];
    const endMs = Date.parse(sample.endTime) || sortedTimes.at(-1);
    const stepMs = sample.expectedStepMs;
    const slotCount = Math.round((endMs - startMs) / stepMs) + 1;
    const groupsByStation = new Map(stations.map((station) => [station, new Map()]));
    for (const group of cleanedGroups) {
      groupsByStation.get(group.station).set(group.ms, group);
    }

    const series = [];
    const gaps = [];
    for (const station of stations) {
      const stationGroups = groupsByStation.get(station);
      const points = [];
      for (let index = 0; index < slotCount; index += 1) {
        const ms = startMs + index * stepMs;
        const group = stationGroups.get(ms);
        points.push({
          ms,
          value: group?.value ?? null,
          reason: !group ? "absent" : group.value === null ? "invalid" : null,
          sourceRows: group?.records.length ?? 0,
        });
      }
      let gapStart = -1;
      for (let index = 0; index <= points.length; index += 1) {
        const point = points[index];
        if (point && point.value === null) {
          if (gapStart === -1) gapStart = index;
        } else if (gapStart !== -1) {
          const gapPoints = points.slice(gapStart, index);
          const gap = {
            station,
            startMs: gapPoints[0].ms,
            endMs: gapPoints.at(-1).ms,
            count: gapPoints.length,
            reasons: Array.from(new Set(gapPoints.map((entry) => entry.reason))),
          };
          gaps.push(gap);
          logs.push({
            type: "missing",
            ms: gap.startMs,
            station,
            title: "连续缺测",
            detail: `${formatDateTime(gap.startMs)}–${formatDateTime(gap.endMs)} 共 ${gap.count} 个时次无有效水位，曲线已断开`,
          });
          gapStart = -1;
        }
      }
      series.push({ station, points });
    }

    logs.sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0) || a.station.localeCompare(b.station, "zh-CN"));
    const missingPoints = series.reduce(
      (sum, item) => sum + item.points.filter((point) => point.value === null).length,
      0,
    );
    return {
      stations,
      series,
      logs,
      gaps,
      startMs,
      endMs,
      stepMs,
      sourceRows: Math.max(0, lines.length - 1),
      uniqueRows: cleanedGroups.length,
      duplicateGroups,
      invalidRows: invalidRows + invalidLevels,
      missingPoints,
    };
  }

  function getCutoffMs() {
    if (state.windowMode === "all") return parsedData.startMs;
    return parsedData.endMs - Number(state.windowMode) * parsedData.stepMs;
  }

  function getVisibleSeries() {
    const cutoff = getCutoffMs();
    return parsedData.series
      .filter((item) => state.station === "all" || item.station === state.station)
      .map((item) => ({
        ...item,
        points: item.points.filter(
          (point) => point.ms >= cutoff && point.ms <= parsedData.endMs,
        ),
      }));
  }

  function getVisibleGaps(series) {
    const cutoff = getCutoffMs();
    return parsedData.gaps
      .filter((gap) => state.station === "all" || gap.station === state.station)
      .map((gap) => {
        const visiblePoints = parsedData.series
          .find((item) => item.station === gap.station)
          .points.filter(
            (point) =>
              point.ms >= cutoff &&
              point.ms <= parsedData.endMs &&
              point.value === null &&
              point.ms >= gap.startMs &&
              point.ms <= gap.endMs,
          );
        if (!visiblePoints.length) return null;
        return {
          ...gap,
          startMs: visiblePoints[0].ms,
          endMs: visiblePoints.at(-1).ms,
          count: visiblePoints.length,
        };
      })
      .filter(Boolean);
  }

  function getAlerts(series) {
    const alerts = [];
    for (const item of series) {
      for (const point of item.points) {
        if (point.value !== null && point.value > state.threshold) {
          alerts.push({
            station: item.station,
            ms: point.ms,
            value: point.value,
            exceedance: point.value - state.threshold,
          });
        }
      }
    }
    return alerts.sort((a, b) => b.value - a.value || b.ms - a.ms);
  }

  function currentWindowLabel() {
    return state.windowMode === "all" ? "全部时段" : `最近 ${state.windowMode} 小时`;
  }

  function renderSummary(series, gaps, alerts) {
    const validPoints = series.flatMap((item) =>
      item.points.filter((point) => point.value !== null).map((point) => ({ ...point, station: item.station })),
    );
    const latestByStation = series
      .map((item) => {
        const point = item.points.filter((entry) => entry.value !== null).at(-1);
        return point ? { ...point, station: item.station } : null;
      })
      .filter(Boolean);
    const current = latestByStation.length
      ? latestByStation.reduce((sum, point) => sum + point.value, 0) / latestByStation.length
      : null;
    const peak = validPoints.reduce(
      (best, point) => (!best || point.value > best.value ? point : best),
      null,
    );
    const missingCount = gaps.reduce((sum, gap) => sum + gap.count, 0);

    elements.currentLevel.innerHTML =
      current === null ? "--" : `${current.toFixed(2)}<span>m</span>`;
    elements.currentMeta.textContent = latestByStation.length
      ? `${state.station === "all" ? `${latestByStation.length} 站均值` : state.station} · ${formatDateTime(
          latestByStation.at(-1).ms,
        )}`
      : "当前范围无有效水位";
    elements.peakLevel.innerHTML = peak ? `${peak.value.toFixed(2)}<span>m</span>` : "--";
    elements.peakMeta.textContent = peak
      ? `${peak.station} · ${formatDateTime(peak.ms)}`
      : "当前范围无数据";
    elements.alertCount.textContent = String(alerts.length).padStart(2, "0");
    elements.alertStat.classList.toggle("has-alerts", alerts.length > 0);
    elements.gapCount.textContent = String(missingCount).padStart(2, "0");
    elements.gapMeta.textContent = gaps.length
      ? `${gaps.length} 个连续缺口 · 曲线已断开`
      : "当前范围无缺测";
    elements.thresholdEcho.textContent = state.threshold.toFixed(2);
    elements.alertPill.textContent = String(alerts.length);

    elements.dataRange.textContent = `${formatDateTime(parsedData.startMs)} → ${formatDateTime(
      parsedData.endMs,
    )}`;
    elements.chartTitle.textContent =
      state.station === "all" ? "水位随时间变化" : `${state.station} · 水位随时间变化`;
    elements.chartSummary.textContent = `${series.length} 个站点 · ${currentWindowLabel()} · ${
      series[0]?.points.length ?? 0
    } 个时次 · 每 1 小时`;
    elements.stationLegend.innerHTML = series
      .map(
        (item) =>
          `<span><i style="--series-color:${stationColor(item.station)}"></i>${escapeHtml(
            item.station,
          )}</span>`,
      )
      .join("");

    const rangeMin = Math.min(1.5, state.threshold - 0.3);
    const rangeMax = Math.max(3.05, state.threshold + 0.3);
    const marker = Math.max(2, Math.min(98, ((state.threshold - rangeMin) / (rangeMax - rangeMin)) * 100));
    elements.scaleMarker.style.left = `${marker}%`;
    const safeBar = document.querySelector(".scale-safe");
    const warnBar = document.querySelector(".scale-warn");
    safeBar.style.width = `${marker}%`;
    warnBar.style.width = `${100 - marker}%`;
    elements.scaleMarker.setAttribute("aria-label", `警戒线 ${state.threshold.toFixed(2)} 米`);
    elements.canvas.setAttribute(
      "aria-label",
      `${elements.chartTitle.textContent}，${currentWindowLabel()}，${missingCount} 个缺测点，${alerts.length} 条越限告警`,
    );
    elements.chartEmpty.hidden = validPoints.length > 0;
  }

  function renderAlerts(alerts) {
    if (!alerts.length) {
      elements.alertList.innerHTML = `
        <div class="alert-empty">
          <div>
            <span class="alert-empty-icon">✓</span>
            当前筛选范围内<br>没有水位超过 ${state.threshold.toFixed(2)} m
          </div>
        </div>`;
      return;
    }
    elements.alertList.innerHTML = alerts
      .map(
        (alert, index) => `
          <article class="alert-item" style="animation-delay:${Math.min(index, 10) * 22}ms">
            <span class="alert-marker" aria-hidden="true"></span>
            <div>
              <p class="alert-station">
                <i class="station-dot" style="background:${stationColor(alert.station)}"></i>
                ${escapeHtml(alert.station)}
              </p>
              <p class="alert-time">${formatDateTime(alert.ms)}</p>
            </div>
            <div class="alert-value">
              <strong>${alert.value.toFixed(2)}<span> m</span></strong>
              <small>+${alert.exceedance.toFixed(2)} m</small>
            </div>
          </article>`,
      )
      .join("");
  }

  function renderLogs(series, gaps) {
    const cutoff = getCutoffMs();
    const visibleLogs = parsedData.logs.filter((log) => {
      if (state.station !== "all" && log.station !== state.station) return false;
      return log.ms === null || log.ms >= cutoff;
    });
    const visiblePoints = series.reduce((sum, item) => sum + item.points.length, 0);
    const missing = gaps.reduce((sum, gap) => sum + gap.count, 0);
    elements.logSummary.innerHTML = `
      <span class="summary-chip"><i></i>CSV <b>${parsedData.sourceRows}</b> 行</span>
      <span class="summary-chip"><i></i>唯一时次 <b>${parsedData.uniqueRows}</b></span>
      <span class="summary-chip is-warning"><i></i>重复合并 <b>${parsedData.duplicateGroups}</b> 组</span>
      <span class="summary-chip is-warning"><i></i>当前范围缺测 <b>${missing}</b> 点</span>
      <span class="summary-chip is-muted"><i></i>当前范围 <b>${visiblePoints}</b> 个时次值</span>`;

    if (!visibleLogs.length) {
      elements.logList.innerHTML = `<div class="log-empty">当前筛选范围内没有清洗异常记录。</div>`;
      return;
    }
    const typeClass = (type) => (type === "missing" ? "type-missing" : type === "invalid" ? "type-invalid" : "");
    const typeLabel = { duplicate: "重复合并", missing: "缺测断开", invalid: "无效数据" };
    elements.logList.innerHTML = visibleLogs
      .map(
        (log) => `
          <div class="log-row">
            <time>${log.ms === null ? "时间未知" : formatDateTime(log.ms)}</time>
            <span class="log-type ${typeClass(log.type)}">${typeLabel[log.type] ?? "清洗"}</span>
            <span class="log-detail" title="${escapeHtml(log.detail)}">
              <b>${escapeHtml(log.station)}</b> · ${escapeHtml(log.detail)}
            </span>
          </div>`,
      )
      .join("");
  }

  function chartRange(series) {
    const validValues = series.flatMap((item) =>
      item.points.filter((point) => point.value !== null).map((point) => point.value),
    );
    const minimum = validValues.length ? Math.min(...validValues) : state.threshold - 0.3;
    const maximum = validValues.length ? Math.max(...validValues) : state.threshold + 0.3;
    const lowAnchor = Math.min(minimum, state.threshold - 0.08);
    const highAnchor = Math.max(maximum, state.threshold + 0.08);
    const step = highAnchor - lowAnchor > 1.15 ? 0.4 : 0.2;
    let yMin = Math.floor((lowAnchor - 0.12) / step) * step;
    let yMax = Math.ceil((highAnchor + 0.16) / step) * step;
    if (yMax - yMin < 0.8) {
      yMin -= 0.2;
      yMax += 0.2;
    }
    return { yMin, yMax, step };
  }

  function chartText(ctx, size, weight = 400, color = "#718281") {
    ctx.font = `${weight} ${size}px "Inter", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif`;
    ctx.fillStyle = color;
  }

  function drawHatch(ctx, left, top, width, height, color, spacing) {
    if (width <= 0 || height <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (let offset = -height; offset < width + height; offset += spacing) {
      ctx.beginPath();
      ctx.moveTo(left + offset, top + height);
      ctx.lineTo(left + offset + height, top);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawChartScene(ctx, width, height, options = {}) {
    const isExport = Boolean(options.export);
    const scale = Math.max(0.75, Math.min(2, width / 920));
    const bg = "#f7faf9";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const series = getVisibleSeries();
    const gaps = getVisibleGaps(series);
    const startMs = getCutoffMs();
    const endMs = parsedData.endMs;
    const slotMs = parsedData.stepMs;
    const range = chartRange(series);
    const left = 54 * scale;
    const right = 22 * scale;
    const top = (isExport ? 88 : 25) * scale;
    const bottom = (isExport ? 42 : 34) * scale;
    const plotLeft = left;
    const plotRight = width - right;
    const plotTop = top;
    const plotBottom = height - bottom;
    const plotWidth = Math.max(10, plotRight - plotLeft);
    const plotHeight = Math.max(10, plotBottom - plotTop);
    const spanMs = Math.max(slotMs, endMs - startMs);
    const xOf = (ms) => plotLeft + ((ms - startMs) / spanMs) * plotWidth;
    const yOf = (value) =>
      plotBottom - ((value - range.yMin) / (range.yMax - range.yMin)) * plotHeight;
    const thresholdY = yOf(state.threshold);
    const slotWidth = (slotMs / spanMs) * plotWidth;

    if (isExport) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      chartText(ctx, 22 * scale, 700, "#132d2e");
      ctx.fillText(
        `潮汐守望 · ${state.station === "all" ? "多站点水位" : `${state.station} 水位`}`,
        left,
        39 * scale,
      );
      chartText(ctx, 9.5 * scale, 500, "#718281");
      ctx.fillText(
        `${currentWindowLabel()}  ·  警戒水位 ${state.threshold.toFixed(2)} m  ·  站点：${series
          .map((item) => item.station)
          .join(" / ")}`,
        left,
        60 * scale,
      );
      ctx.fillText(`导出时间 ${formatFullDate(Date.now())} · 内置样例数据`, left, 75 * scale);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    ctx.fillStyle = "#fbfdfc";
    ctx.fillRect(plotLeft, plotTop, plotWidth, plotHeight);

    if (thresholdY <= plotBottom && thresholdY >= plotTop) {
      ctx.fillStyle = "rgba(225, 89, 69, 0.065)";
      ctx.fillRect(plotLeft, plotTop, plotWidth, thresholdY - plotTop);
      drawHatch(
        ctx,
        plotLeft,
        plotTop,
        plotWidth,
        thresholdY - plotTop,
        "rgba(225, 89, 69, 0.055)",
        18 * scale,
      );
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = "#e1eae8";
    for (let value = range.yMin; value <= range.yMax + range.step / 2; value += range.step) {
      const y = yOf(value);
      ctx.beginPath();
      ctx.setLineDash([]);
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotRight, y);
      ctx.stroke();
    }

    const xTickCount = plotWidth < 450 ? 3 : 5;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let index = 0; index < xTickCount; index += 1) {
      const fraction = index / (xTickCount - 1);
      const ms = startMs + fraction * spanMs;
      const x = plotLeft + fraction * plotWidth;
      ctx.strokeStyle = "#ebf1f0";
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();
      chartText(ctx, 8.2 * scale, 500, "#879795");
      const [dateLabel, timeLabel] = formatDateTime(ms).split(" ");
      ctx.fillText(dateLabel, x, plotBottom + 7 * scale);
      ctx.fillText(timeLabel, x, plotBottom + 18 * scale);
    }

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let value = range.yMin; value <= range.yMax + range.step / 2; value += range.step) {
      chartText(ctx, 8 * scale, 500, "#879795");
      ctx.fillText(`${value.toFixed(1)}`, plotLeft - 9 * scale, yOf(value));
    }
    ctx.textAlign = "left";
    chartText(ctx, 7 * scale, 600, "#9aaba8");
    ctx.fillText("m", 8 * scale, plotTop - 2 * scale);

    const gapBands = [];
    for (const gap of gaps) {
      const gapLeft = Math.max(plotLeft, xOf(gap.startMs) - slotWidth / 2);
      const gapRight = Math.min(plotRight, xOf(gap.endMs) + slotWidth / 2);
      if (gapRight < plotLeft || gapLeft > plotRight) continue;
      const gapWidth = Math.max(2, gapRight - gapLeft);
      ctx.fillStyle = "rgba(114, 132, 130, 0.1)";
      ctx.fillRect(gapLeft, plotTop, gapWidth, plotHeight);
      drawHatch(
        ctx,
        gapLeft,
        plotTop,
        gapWidth,
        plotHeight,
        "rgba(104, 124, 122, 0.12)",
        10 * scale,
      );
      ctx.strokeStyle = "rgba(99, 117, 115, 0.28)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3 * scale, 3 * scale]);
      ctx.strokeRect(gapLeft, plotTop, gapWidth, plotHeight);
      ctx.setLineDash([]);
      gapBands.push({
        station: gap.station,
        startMs: gap.startMs,
        endMs: gap.endMs,
        count: gap.count,
        left: gapLeft,
        right: gapRight,
      });
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeft, plotTop, plotWidth, plotHeight);
    ctx.clip();

    function segment(a, b, color, lineWidth) {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(xOf(a.ms), yOf(a.value));
      ctx.lineTo(xOf(b.ms), yOf(b.value));
      ctx.stroke();
    }

    function coloredSegment(a, b) {
      const safeColor = stationColor(a.station);
      if (a.value <= state.threshold && b.value <= state.threshold) {
        segment(a, b, safeColor, 1.6 * scale);
        return;
      }
      if (a.value > state.threshold && b.value > state.threshold) {
        segment(a, b, "#e15945", 2.1 * scale);
        return;
      }
      const ratio = (state.threshold - a.value) / (b.value - a.value);
      const cross = {
        ms: a.ms + (b.ms - a.ms) * ratio,
        value: state.threshold,
      };
      if (a.value <= state.threshold) {
        segment(a, cross, safeColor, 1.6 * scale);
        segment({ ...cross, station: a.station }, b, "#e15945", 2.1 * scale);
      } else {
        segment(a, cross, "#e15945", 2.1 * scale);
        segment({ ...cross, station: a.station }, b, safeColor, 1.6 * scale);
      }
    }

    for (const item of series) {
      const points = item.points;
      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        if (previous.value === null || current.value === null) continue;
        if (current.ms - previous.ms > parsedData.stepMs * 1.5) continue;
        coloredSegment({ ...previous, station: item.station }, { ...current, station: item.station });
      }
    }

    for (const item of series) {
      for (const point of item.points) {
        if (point.value === null) continue;
        const alert = point.value > state.threshold;
        const radius = (alert ? 2.75 : 2.2) * scale;
        ctx.beginPath();
        ctx.arc(xOf(point.ms), yOf(point.value), radius, 0, Math.PI * 2);
        ctx.fillStyle = alert ? "#e15945" : stationColor(item.station);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
        ctx.lineWidth = 0.8 * scale;
        ctx.stroke();
      }
    }

    if (thresholdY >= plotTop && thresholdY <= plotBottom) {
      ctx.strokeStyle = "rgba(190, 65, 48, 0.82)";
      ctx.lineWidth = 1.2 * scale;
      ctx.setLineDash([5 * scale, 4 * scale]);
      ctx.beginPath();
      ctx.moveTo(plotLeft, thresholdY);
      ctx.lineTo(plotRight, thresholdY);
      ctx.stroke();
      ctx.setLineDash([]);
      chartText(ctx, 8.4 * scale, 600, "#bb4432");
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(`警戒 ${state.threshold.toFixed(2)} m`, plotRight - 7 * scale, thresholdY - 5 * scale);
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    for (const band of gapBands) {
      const label = `缺测 ${band.count}h`;
      ctx.font = `600 ${8 * scale}px "Inter", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", sans-serif`;
      const labelWidth = ctx.measureText(label).width + 8 * scale;
      const x = Math.max(plotLeft + 4 * scale, Math.min(band.left + 3 * scale, plotRight - labelWidth - 3 * scale));
      ctx.fillStyle = "rgba(250, 252, 251, 0.92)";
      ctx.fillRect(x, plotTop + 5 * scale, labelWidth, 15 * scale);
      chartText(ctx, 8 * scale, 700, "#746a5b");
      ctx.fillText(label, x + 4 * scale, plotTop + 7 * scale);
    }

    if (state.hoverMs !== null) {
      const hoverX = xOf(state.hoverMs);
      if (hoverX >= plotLeft && hoverX <= plotRight) {
        ctx.strokeStyle = "rgba(19, 45, 46, 0.22)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hoverX, plotTop);
        ctx.lineTo(hoverX, plotBottom);
        ctx.stroke();
      }
    }
    ctx.restore();

    ctx.strokeStyle = "#dbe6e3";
    ctx.lineWidth = 1;
    ctx.strokeRect(plotLeft, plotTop, plotWidth, plotHeight);
    return { plotLeft, plotRight, plotTop, plotBottom, startMs, endMs, gapBands, series };
  }

  function renderChart() {
    const rect = elements.chartFrame.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    elements.canvas.width = Math.round(rect.width * dpr);
    elements.canvas.height = Math.round(rect.height * dpr);
    elements.canvas.style.width = `${rect.width}px`;
    elements.canvas.style.height = `${rect.height}px`;
    const ctx = elements.canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const meta = drawChartScene(ctx, rect.width, rect.height);
    lastRender = {
      width: rect.width,
      height: rect.height,
      dpr,
      gapBands: meta.gapBands,
      plotLeft: meta.plotLeft,
      plotRight: meta.plotRight,
      plotTop: meta.plotTop,
      plotBottom: meta.plotBottom,
      startMs: meta.startMs,
      endMs: meta.endMs,
    };
    elements.canvas.dataset.gapSegments = String(meta.gapBands.length);
    elements.canvas.dataset.visibleStations = String(meta.series.length);
  }

  function renderAll() {
    const series = getVisibleSeries();
    const gaps = getVisibleGaps(series);
    const alerts = getAlerts(series);
    renderSummary(series, gaps, alerts);
    renderAlerts(alerts);
    renderLogs(series, gaps);
    renderChart();
  }

  function tooltipPointAt(ms) {
    return getVisibleSeries().map((item) => {
      const point = item.points.find((entry) => entry.ms === ms);
      return { station: item.station, point };
    });
  }

  function updateTooltip(event) {
    if (!lastRender) return;
    const rect = elements.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (
      x < lastRender.plotLeft ||
      x > lastRender.plotRight ||
      y < lastRender.plotTop ||
      y > lastRender.plotBottom
    ) {
      elements.tooltip.hidden = true;
      if (state.hoverMs !== null) {
        state.hoverMs = null;
        renderChart();
      }
      return;
    }

    const fraction = (x - lastRender.plotLeft) / (lastRender.plotRight - lastRender.plotLeft);
    const rawMs = lastRender.startMs + fraction * (lastRender.endMs - lastRender.startMs);
    const snapped = Math.round((rawMs - lastRender.startMs) / parsedData.stepMs);
    let hoverMs = lastRender.startMs + snapped * parsedData.stepMs;
    hoverMs = Math.max(lastRender.startMs, Math.min(lastRender.endMs, hoverMs));
    if (hoverMs !== state.hoverMs) {
      state.hoverMs = hoverMs;
      renderChart();
    }

    const rows = tooltipPointAt(hoverMs)
      .map(({ station, point }) => {
        const missing = !point || point.value === null;
        const alert = !missing && point.value > state.threshold;
        return `<div class="tooltip-row ${alert ? "is-alert" : ""} ${missing ? "is-missing" : ""}">
          <span><i style="background:${stationColor(station)}"></i>${escapeHtml(station)}</span>
          <b>${missing ? "缺测" : `${point.value.toFixed(2)} m`}</b>
        </div>`;
      })
      .join("");
    elements.tooltip.innerHTML = `<strong>${formatDateTime(hoverMs)}</strong>${rows}`;
    elements.tooltip.hidden = false;
    const tooltipWidth = 158;
    const left = Math.min(rect.width - tooltipWidth - 8, Math.max(8, x + 14));
    const tooltipHeight = 34 + rows.length * 21;
    const top = Math.min(rect.height - tooltipHeight - 8, Math.max(8, y - tooltipHeight / 2));
    elements.tooltip.style.left = `${left}px`;
    elements.tooltip.style.top = `${top}px`;
  }

  function clearTooltip() {
    elements.tooltip.hidden = true;
    if (state.hoverMs !== null) {
      state.hoverMs = null;
      renderChart();
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportPng() {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = 1800;
    exportCanvas.height = 1060;
    const ctx = exportCanvas.getContext("2d");
    drawChartScene(ctx, exportCanvas.width, exportCanvas.height, { export: true });
    exportCanvas.toBlob((blob) => {
      if (!blob) return;
      const station = state.station === "all" ? "全部站点" : state.station;
      const filename = `潮位图_${station}_${formatFullDate(Date.now())}.png`;
      downloadBlob(blob, filename);
    }, "image/png");
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function exportCleaningLog() {
    const typeLabel = { duplicate: "重复合并", missing: "连续缺测", invalid: "无效数据" };
    const lines = [
      csvCell("潮汐守望 CSV 清洗日志"),
      [csvCell("导出时间"), csvCell(formatDateTime(Date.now(), true))].join(","),
      [csvCell("原始记录"), csvCell(parsedData.sourceRows)].join(","),
      [csvCell("唯一站点时间戳"), csvCell(parsedData.uniqueRows)].join(","),
      [csvCell("重复时间戳组"), csvCell(parsedData.duplicateGroups)].join(","),
      [csvCell("当前筛选"), csvCell(`${state.station === "all" ? "全部站点" : state.station} / ${currentWindowLabel()} / 警戒 ${state.threshold.toFixed(2)} m`)].join(","),
      "",
      ["时间", "站点", "类型", "说明"].map(csvCell).join(","),
    ];
    for (const log of parsedData.logs) {
      lines.push(
        [
          log.ms === null ? "时间未知" : formatDateTime(log.ms, true),
          log.station,
          typeLabel[log.type] ?? "清洗",
          log.detail,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `潮汐清洗日志_${formatFullDate(Date.now())}.csv`);
  }

  function populateStations() {
    elements.stationSelect.innerHTML = [
      '<option value="all">全部站点</option>',
      ...parsedData.stations.map(
        (station) => `<option value="${escapeHtml(station)}">${escapeHtml(station)}</option>`,
      ),
    ].join("");
  }

  function applyControls() {
    state.station = elements.stationSelect.value;
    state.windowMode = elements.windowSelect.value;
    const threshold = Number.parseFloat(elements.thresholdInput.value);
    if (Number.isFinite(threshold)) {
      state.threshold = Math.min(9, Math.max(0, threshold));
    }
    state.hoverMs = null;
    elements.tooltip.hidden = true;
    renderAll();
  }

  function resetControls() {
    state.station = "all";
    state.threshold = DEFAULT_THRESHOLD;
    state.windowMode = DEFAULT_WINDOW;
    elements.stationSelect.value = "all";
    elements.thresholdInput.value = DEFAULT_THRESHOLD.toFixed(2);
    elements.windowSelect.value = DEFAULT_WINDOW;
    state.hoverMs = null;
    renderAll();
  }

  function bindEvents() {
    elements.stationSelect.addEventListener("change", applyControls);
    elements.windowSelect.addEventListener("change", applyControls);
    elements.thresholdInput.addEventListener("input", applyControls);
    elements.thresholdInput.addEventListener("blur", () => {
      if (!Number.isFinite(Number.parseFloat(elements.thresholdInput.value))) {
        elements.thresholdInput.value = DEFAULT_THRESHOLD.toFixed(2);
      } else {
        elements.thresholdInput.value = state.threshold.toFixed(2);
      }
      applyControls();
    });
    elements.resetButton.addEventListener("click", resetControls);
    elements.exportPngButton.addEventListener("click", exportPng);
    elements.exportLogButton.addEventListener("click", exportCleaningLog);
    elements.canvas.addEventListener("pointermove", updateTooltip);
    elements.canvas.addEventListener("pointerleave", clearTooltip);

    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => renderChart());
    });
    observer.observe(elements.chartFrame);
  }

  function exposeDiagnostics() {
    window.tideApp = {
      getDiagnostics() {
        const series = getVisibleSeries();
        const gaps = getVisibleGaps(series);
        const alerts = getAlerts(series);
        const validPoints = series.flatMap((item) =>
          item.points.filter((point) => point.value !== null),
        );
        return {
          state: { ...state },
          windowLabel: currentWindowLabel(),
          visibleStations: series.map((item) => item.station),
          visiblePoints: series.reduce((sum, item) => sum + item.points.length, 0),
          validPoints: validPoints.length,
          missingPoints: gaps.reduce((sum, gap) => sum + gap.count, 0),
          continuousGaps: gaps.map((gap) => ({ ...gap })),
          alertCount: alerts.length,
          maxVisibleLevel: validPoints.length
            ? Math.max(...validPoints.map((point) => point.value))
            : null,
          chart: {
            gapBandCount: lastRender?.gapBands.length ?? 0,
            gapBands: lastRender?.gapBands.map((band) => ({ ...band })) ?? [],
            canvasGapSegments: Number(elements.canvas.dataset.gapSegments || 0),
            canvasWidth: elements.canvas.width,
            canvasHeight: elements.canvas.height,
            plotLeft: lastRender?.plotLeft ?? 0,
            plotRight: lastRender?.plotRight ?? 0,
            plotTop: lastRender?.plotTop ?? 0,
            plotBottom: lastRender?.plotBottom ?? 0,
          },
          cleaning: {
            sourceRows: parsedData.sourceRows,
            uniqueRows: parsedData.uniqueRows,
            duplicateGroups: parsedData.duplicateGroups,
            logs: parsedData.logs.length,
          },
          ui: {
            alertCount: Number(elements.alertCount.textContent),
            gapCount: Number(elements.gapCount.textContent),
            alertPill: Number(elements.alertPill.textContent),
            gapMeta: elements.gapMeta.textContent,
          },
        };
      },
    };
  }

  function init() {
    try {
      parsedData = parseCsv(sample.csv);
      populateStations();
      elements.thresholdInput.value = DEFAULT_THRESHOLD.toFixed(2);
      elements.windowSelect.value = DEFAULT_WINDOW;
      bindEvents();
      renderAll();
      exposeDiagnostics();
    } catch (error) {
      elements.chartEmpty.hidden = false;
      elements.chartEmpty.textContent = `数据载入失败：${error.message}`;
      console.error(error);
    }
  }

  init();
})();
