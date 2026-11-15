(function () {
  "use strict";

  const Engine = window.DispatchEngine;
  const Chart = window.GanttChart;
  const STORAGE_KEY = "qingchuan-dispatch-v1";
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const elements = {
    trainRows: document.getElementById("trainRows"),
    addTrainBtn: document.getElementById("addTrainBtn"),
    resetBtn: document.getElementById("resetBtn"),
    exportCsvBtn: document.getElementById("exportCsvBtn"),
    exportPngBtn: document.getElementById("exportPngBtn"),
    globalState: document.getElementById("globalState"),
    globalStateIcon: document.getElementById("globalStateIcon"),
    globalStateLabel: document.getElementById("globalStateLabel"),
    globalStateDetail: document.getElementById("globalStateDetail"),
    metricTrains: document.getElementById("metricTrains"),
    metricDensity: document.getElementById("metricDensity"),
    metricSevere: document.getElementById("metricSevere"),
    metricWarnings: document.getElementById("metricWarnings"),
    metricSection: document.getElementById("metricSection"),
    metricSectionMinutes: document.getElementById("metricSectionMinutes"),
    metricTracks: document.getElementById("metricTracks"),
    metricTrackMinutes: document.getElementById("metricTrackMinutes"),
    scheduleFootNote: document.getElementById("scheduleFootNote"),
    checkCount: document.getElementById("checkCount"),
    conflictList: document.getElementById("conflictList"),
    capacityTag: document.getElementById("capacityTag"),
    barSection: document.getElementById("barSection"),
    barTracks: document.getElementById("barTracks"),
    barSwitch: document.getElementById("barSwitch"),
    capacitySection: document.getElementById("capacitySection"),
    capacityTracks: document.getElementById("capacityTracks"),
    capacitySwitch: document.getElementById("capacitySwitch"),
    capacityTurnaround: document.getElementById("capacityTurnaround"),
    capacityPeak: document.getElementById("capacityPeak"),
    capacityHeadroom: document.getElementById("capacityHeadroom"),
    chartWrap: document.getElementById("chartWrap"),
    canvas: document.getElementById("ganttCanvas"),
    chartTooltip: document.getElementById("chartTooltip"),
    chartEmpty: document.getElementById("chartEmpty"),
    chartStats: document.getElementById("chartStats"),
    toast: document.getElementById("toast"),
  };

  const state = {
    trains: loadTrains(),
    selectedId: null,
    result: null,
    toastTimer: null,
    chartFrame: null,
    lastSevereCount: null,
  };

  function loadTrains() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return Engine.cloneDefaultTrains();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.trains)) return Engine.cloneDefaultTrains();
      return parsed.trains.slice(0, Engine.CONFIG.maxTrains).map(normalizeStoredTrain);
    } catch (error) {
      return Engine.cloneDefaultTrains();
    }
  }

  function normalizeStoredTrain(train, index) {
    return {
      id: String(train.id || "t" + (index + 1)),
      number: String(train.number || "T" + (index + 1)),
      track: train.track === "2" ? "2" : "1",
      arrival: String(train.arrival || "08:00"),
      departure: String(train.departure || "08:16"),
      kind: String(train.kind || "列车"),
      color: train.color || Engine.PALETTE[index % Engine.PALETTE.length],
    };
  }

  function escapeHTML(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, trains: state.trains }));
    } catch (error) {
      // Storage may be unavailable in private browsing; calculations still work.
    }
  }

  function trainById(id) {
    return state.trains.find(function (train) { return train.id === id; }) || null;
  }

  function renderRows() {
    elements.trainRows.innerHTML = state.trains.map(function (train, index) {
      return [
        '<tr data-train-id="' + escapeHTML(train.id) + '"' + (state.selectedId === train.id ? ' class="is-selected"' : "") + '>',
        '  <td>',
        '    <div class="train-identity">',
        '      <span class="train-color" style="--train-color:' + escapeHTML(train.color) + '"></span>',
        '      <div>',
        '        <input class="train-number-input" data-field="number" aria-label="车次" maxlength="8" value="' + escapeHTML(train.number) + '">',
        '        <span class="train-kind">' + escapeHTML(train.kind) + ' · 折返</span>',
        '      </div>',
        '    </div>',
        '  </td>',
        '  <td>',
        '    <select class="track-select" data-field="track" aria-label="' + escapeHTML(train.number) + '占用股道">',
        '      <option value="1"' + (train.track === "1" ? " selected" : "") + '>1道</option>',
        '      <option value="2"' + (train.track === "2" ? " selected" : "") + '>2道</option>',
        '    </select>',
        '  </td>',
        '  <td><input class="time-input" type="text" inputmode="numeric" maxlength="5" autocomplete="off" spellcheck="false" data-field="arrival" aria-label="' + escapeHTML(train.number) + '到达时刻" value="' + escapeHTML(train.arrival) + '"></td>',
        '  <td><input class="time-input" type="text" inputmode="numeric" maxlength="5" autocomplete="off" spellcheck="false" data-field="departure" aria-label="' + escapeHTML(train.number) + '发车时刻" value="' + escapeHTML(train.departure) + '"></td>',
        '  <td><span class="turnaround" data-role="turnaround">—</span></td>',
        '  <td><span class="row-status" data-role="status">正常</span></td>',
        '  <td><button class="delete-btn" type="button" data-action="delete" aria-label="删除' + escapeHTML(train.number) + '" title="删除列车">×</button></td>',
        '</tr>',
      ].join("");
    }).join("");
    elements.addTrainBtn.disabled = state.trains.length >= Engine.CONFIG.maxTrains;
    elements.addTrainBtn.title = elements.addTrainBtn.disabled
      ? "已达 " + Engine.CONFIG.maxTrains + " 列上限"
      : "添加一列折返列车";
  }

  function updateRowStates() {
    state.trains.forEach(function (train) {
      const row = elements.trainRows.querySelector('[data-train-id="' + CSS.escape(train.id) + '"]');
      if (!row) return;
      const counts = state.result.trainConflictCounts.get(train.id) || { severe: 0, warning: 0, total: 0 };
      const status = row.querySelector('[data-role="status"]');
      const turnaround = row.querySelector('[data-role="turnaround"]');
      const arrival = Engine.parseTime(train.arrival);
      const departure = Engine.parseTime(train.departure);
      const dwell = arrival !== null && departure !== null ? departure - arrival : null;

      status.className = "row-status";
      if (counts.severe > 0) {
        status.classList.add("is-severe");
        status.textContent = counts.severe + " 严重";
        status.title = counts.codes.join(" ");
      } else if (counts.warning > 0) {
        status.classList.add("is-warning");
        status.textContent = counts.warning + " 提示";
        status.title = counts.codes.join(" ");
      } else {
        status.textContent = "正常";
        status.title = "校验通过";
      }

      turnaround.classList.toggle("is-short", dwell !== null && dwell < Engine.CONFIG.minTurnaround);
      turnaround.innerHTML = dwell === null
        ? "—"
        : "<span>" + Engine.formatDuration(dwell) + "</span><small>min</small>";
      turnaround.title = dwell !== null && dwell < Engine.CONFIG.minTurnaround
        ? "低于最小折返 " + Engine.CONFIG.minTurnaround + " min"
        : "满足折返要求";
    });
  }

  function formatPercent(value) {
    return value.toFixed(1) + "%";
  }

  function updateHeader() {
    const stats = state.result.stats;
    elements.globalState.classList.toggle("is-blocked", !stats.ready);
    if (!stats.ready) {
      elements.globalStateIcon.textContent = "!";
      elements.globalStateLabel.textContent = "导出已锁定";
      elements.globalStateDetail.textContent = stats.severeCount + " 严重冲突 · " + stats.warningCount + " 项提示";
    } else if (stats.warningCount > 0) {
      elements.globalStateIcon.textContent = "✓";
      elements.globalStateLabel.textContent = "可放行 · 有提示";
      elements.globalStateDetail.textContent = "0 严重冲突 · " + stats.warningCount + " 项提示";
    } else {
      elements.globalStateIcon.textContent = "✓";
      elements.globalStateLabel.textContent = "运行图可放行";
      elements.globalStateDetail.textContent = "0 严重冲突 · " + stats.plannedTrains + " 列车已排定";
    }

    [elements.exportCsvBtn, elements.exportPngBtn].forEach(function (button) {
      button.disabled = !stats.ready;
      button.setAttribute("aria-disabled", String(!stats.ready));
      button.title = stats.ready
        ? "校验通过，可以导出"
        : "存在 " + stats.severeCount + " 项严重冲突，修复后才能导出";
    });
  }

  function updateMetrics() {
    const stats = state.result.stats;
    elements.metricTrains.textContent = stats.plannedTrains;
    elements.metricDensity.textContent = stats.density.toFixed(1) + " 列 / 小时";
    elements.metricSevere.textContent = stats.severeCount;
    elements.metricSevere.parentElement.classList.toggle("has-conflict", stats.severeCount > 0);
    elements.metricWarnings.textContent = stats.warningCount + " 项提示";
    elements.metricSection.textContent = stats.sectionUtil.toFixed(1);
    elements.metricSectionMinutes.textContent = stats.sectionMinutes + " min 占用";
    elements.metricTracks.textContent = stats.trackUtil.toFixed(1);
    elements.metricTrackMinutes.textContent = stats.trackMinutes + " min 占用";
    elements.scheduleFootNote.textContent = stats.plannedTrains + " 列车 · 计划窗口 07:50—09:40";
  }

  function updateConflicts() {
    const conflicts = state.result.conflicts;
    const severe = state.result.stats.severeCount;
    elements.checkCount.textContent = conflicts.length ? conflicts.length + " 项" : "0";
    elements.checkCount.classList.toggle("has-conflict", severe > 0);

    if (!conflicts.length) {
      elements.conflictList.innerHTML = [
        '<div class="conflict-empty">',
        '  <span class="checkmark-ring" aria-hidden="true">✓</span>',
        '  <span><strong>所有校验项通过</strong><span>追踪、道岔、股道与折返时间均满足要求</span></span>',
        '</div>',
      ].join("");
      return;
    }

    elements.conflictList.innerHTML = conflicts.map(function (conflict) {
      const firstTrain = conflict.trainIds.length ? trainById(conflict.trainIds[0]) : null;
      return [
        '<button class="conflict-item ' + conflict.severity + '" type="button" data-conflict="' + escapeHTML(conflict.code) + '"' +
          (firstTrain ? ' data-train-id="' + escapeHTML(firstTrain.id) + '"' : "") + '>',
        '  <span class="conflict-code">' + escapeHTML(conflict.code) + '</span>',
        '  <span class="conflict-copy"><strong>' + escapeHTML(conflict.title) + '</strong>',
        '    <span>' + escapeHTML(conflict.detail) + '</span>',
        '  </span>',
        '  <span class="conflict-time">' + escapeHTML(conflict.displayTime) + '</span>',
        '</button>',
      ].join("");
    }).join("");
  }

  function capacityStatus() {
    if (state.result.stats.severeCount > 0) return { label: "需调整", tight: true };
    if (state.result.stats.sectionUtil >= 80) return { label: "接近饱和", tight: true };
    if (state.result.stats.sectionUtil >= 65) return { label: "余量偏紧", tight: true };
    return { label: "余量充足", tight: false };
  }

  function updateCapacity() {
    const stats = state.result.stats;
    elements.barSection.style.width = Math.min(100, stats.sectionUtil) + "%";
    elements.barTracks.style.width = Math.min(100, stats.trackUtil) + "%";
    elements.barSwitch.style.width = Math.min(100, stats.switchUtil) + "%";
    elements.capacitySection.textContent = formatPercent(stats.sectionUtil);
    elements.capacityTracks.textContent = formatPercent(stats.trackUtil);
    elements.capacitySwitch.textContent = formatPercent(stats.switchUtil);
    elements.capacityTurnaround.textContent = stats.averageTurnaround === null
      ? "—"
      : stats.averageTurnaround.toFixed(1) + " min";
    elements.capacityPeak.textContent = stats.peakTracks + " 列";
    elements.capacityHeadroom.textContent = stats.headroom + " min";
    const status = capacityStatus();
    elements.capacityTag.textContent = status.label;
    elements.capacityTag.classList.toggle("is-tight", status.tight);
  }

  function renderChart() {
    if (state.chartFrame !== null) cancelAnimationFrame(state.chartFrame);
    state.chartFrame = requestAnimationFrame(function () {
      state.chartFrame = null;
      elements.chartEmpty.hidden = state.result.stats.plannedTrains > 0;
      Chart.render(elements.canvas, state.result, { selectedId: state.selectedId });
      const stats = state.result.stats;
      const sectionEvents = state.result.occupancies.filter(function (item) {
        return item.kind === "section";
      }).length;
      elements.chartStats.textContent = sectionEvents + " 次区间作业 · " +
        stats.trackMinutes + " min 到发线占用";
    });
  }

  function updateChartFrame() {
    if (state.chartFrame !== null) return;
    state.chartFrame = requestAnimationFrame(function () {
      state.chartFrame = null;
      renderChart();
    });
  }

  function toast(message, isError) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle("is-error", Boolean(isError));
    elements.toast.classList.add("visible");
    state.toastTimer = setTimeout(function () {
      elements.toast.classList.remove("visible");
    }, isError ? 3600 : 2600);
  }

  function applySelection(trainId, options) {
    state.selectedId = trainId;
    const opts = options || {};
    elements.trainRows.querySelectorAll("tr[data-train-id]").forEach(function (row) {
      row.classList.toggle("is-selected", row.dataset.trainId === trainId);
    });
    renderChart();
    if (opts.scrollIntoView) {
      const row = elements.trainRows.querySelector('[data-train-id="' + CSS.escape(trainId) + '"]');
      if (row) row.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
    }
  }

  function refresh(options) {
    const opts = options || {};
    const previousSevere = state.lastSevereCount;
    state.result = Engine.calculate(state.trains);
    state.lastSevereCount = state.result.stats.severeCount;
    updateHeader();
    updateMetrics();
    updateRowStates();
    updateConflicts();
    updateCapacity();
    renderChart();
    if (!opts.silentSave) saveState();
    if (!opts.silentToast && previousSevere !== null) {
      if (previousSevere === 0 && state.result.stats.severeCount > 0) {
        toast("检测到 " + state.result.stats.severeCount + " 项严重冲突，导出已锁定。", true);
      } else if (previousSevere > 0 && state.result.stats.severeCount === 0) {
        toast("严重冲突已清除，运行图恢复可导出。");
      }
    }
  }

  function editTrain(event) {
    const target = event.target;
    if (!target.matches("[data-field]")) return;
    const row = target.closest("tr[data-train-id]");
    if (!row) return;
    const train = trainById(row.dataset.trainId);
    if (!train) return;
    const field = target.dataset.field;
    if (!["number", "track", "arrival", "departure"].includes(field)) return;
    train[field] = target.value;
    state.selectedId = train.id;
    row.classList.add("is-selected");
    elements.trainRows.querySelectorAll("tr[data-train-id]").forEach(function (otherRow) {
      if (otherRow !== row) otherRow.classList.remove("is-selected");
    });
    refresh();
  }

  function normalizeTimeField(event) {
    const target = event.target;
    if (!target.matches('.time-input[data-field]')) return;
    const value = Engine.parseTime(target.value);
    if (value === null) return;
    const row = target.closest("tr[data-train-id]");
    const train = row ? trainById(row.dataset.trainId) : null;
    if (!train) return;
    const normalized = Engine.formatTime(value);
    if (target.value === normalized) return;
    target.value = normalized;
    train[target.dataset.field] = normalized;
    saveState();
  }

  function addTrain() {
    if (state.trains.length >= Engine.CONFIG.maxTrains) {
      toast("本方案最多排列 " + Engine.CONFIG.maxTrains + " 列车。", true);
      return;
    }
    const index = state.trains.length;
    const latestDeparture = state.trains.reduce(function (latest, train) {
      const value = Engine.parseTime(train.departure);
      return value === null ? latest : Math.max(latest, value);
    }, Engine.CONFIG.windowStart);
    const arrivalMin = Math.min(23 * 60 + 20, latestDeparture + 8);
    const newTrain = {
      id: "t" + Date.now().toString(36),
      number: "G" + String(107 + index).slice(-3),
      track: index % 2 === 0 ? "1" : "2",
      arrival: Engine.formatTime(arrivalMin),
      departure: Engine.formatTime(arrivalMin + 16),
      kind: index % 2 === 0 ? "动车组" : "普速",
      color: Engine.PALETTE[index % Engine.PALETTE.length],
    };
    state.trains.push(newTrain);
    state.selectedId = newTrain.id;
    renderRows();
    refresh();
    applySelection(newTrain.id, { scrollIntoView: true });
    toast("已添加 " + newTrain.number + "，请调整时刻与股道。");
  }

  function deleteTrain(trainId) {
    const train = trainById(trainId);
    if (!train) return;
    state.trains = state.trains.filter(function (item) { return item.id !== trainId; });
    if (state.selectedId === trainId) state.selectedId = null;
    renderRows();
    refresh();
    toast("已删除 " + train.number + "；占用图与容量统计已同步更新。");
  }

  function resetScenario() {
    state.trains = Engine.cloneDefaultTrains();
    state.selectedId = null;
    renderRows();
    refresh();
    applySelection(null);
    toast("已恢复 6 列车无冲突示例。");
  }

  function fileDate() {
    const now = new Date();
    return String(now.getFullYear()) +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }

  function ensureExportable() {
    if (state.result.stats.ready) return true;
    toast("存在 " + state.result.stats.severeCount + " 项严重冲突，修复后才能导出。", true);
    return false;
  }

  function exportCSV() {
    if (!ensureExportable()) return;
    const csv = Engine.buildCSV(state.result);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "青川站_列车时刻表_" + fileDate() + ".csv");
    toast("时刻表已导出，共 " + state.result.stats.plannedTrains + " 列。");
  }

  function exportPNG() {
    if (!ensureExportable()) return;
    const exportCanvas = document.createElement("canvas");
    Chart.render(exportCanvas, state.result, { mode: "export" });
    if (typeof exportCanvas.toBlob !== "function") {
      toast("当前浏览器不支持 PNG 导出。", true);
      return;
    }
    exportCanvas.toBlob(function (blob) {
      if (!blob) {
        toast("PNG 生成失败，请重试。", true);
        return;
      }
      downloadBlob(blob, "青川站_占用甘特图_" + fileDate() + ".png");
      toast("占用甘特图已导出为 1600 × 900 PNG。");
    }, "image/png");
  }

  function showChartTooltip(event, hit) {
    if (!hit) {
      elements.chartTooltip.classList.remove("visible");
      elements.canvas.style.cursor = "default";
      return;
    }
    const item = hit.item;
    const kindLabel = item.kind === "section"
      ? "单线区段"
      : item.kind === "switch"
        ? "咽喉道岔"
        : item.resource + "道";
    elements.chartTooltip.innerHTML = [
      "<strong>" + escapeHTML(item.trainNumber) + " · " + escapeHTML(kindLabel) + "</strong>",
      escapeHTML(item.label),
      "<br>" + Engine.formatTime(item.start) + "—" + Engine.formatTime(item.end) +
        " · " + Math.round(item.end - item.start) + " min",
    ].join("");
    elements.chartTooltip.classList.add("visible");
    elements.canvas.style.cursor = "pointer";
    const wrap = elements.chartWrap.getBoundingClientRect();
    const tooltipWidth = elements.chartTooltip.offsetWidth;
    const tooltipHeight = elements.chartTooltip.offsetHeight;
    let left = event.clientX - wrap.left + 13;
    let top = event.clientY - wrap.top - tooltipHeight - 13;
    if (left + tooltipWidth > wrap.width - 10) left = wrap.width - tooltipWidth - 10;
    if (top < 7) top = event.clientY - wrap.top + 16;
    elements.chartTooltip.style.left = Math.max(7, left) + "px";
    elements.chartTooltip.style.top = Math.max(7, top) + "px";
  }

  elements.trainRows.addEventListener("input", editTrain);
  elements.trainRows.addEventListener("change", editTrain);
  elements.trainRows.addEventListener("focusout", normalizeTimeField);

  elements.trainRows.addEventListener("click", function (event) {
    const deleteButton = event.target.closest('[data-action="delete"]');
    if (deleteButton) {
      const row = deleteButton.closest("tr[data-train-id]");
      if (row) deleteTrain(row.dataset.trainId);
      return;
    }
    const row = event.target.closest("tr[data-train-id]");
    if (row) applySelection(row.dataset.trainId);
  });

  elements.conflictList.addEventListener("click", function (event) {
    const item = event.target.closest("[data-conflict]");
    if (!item) return;
    const trainId = item.dataset.trainId;
    if (trainId && trainById(trainId)) {
      applySelection(trainId, { scrollIntoView: true });
      const conflict = state.result.conflicts.find(function (entry) { return entry.code === item.dataset.conflict; });
      if (conflict) toast(conflict.code + " · " + conflict.detail);
    }
  });

  elements.canvas.addEventListener("mousemove", function (event) {
    showChartTooltip(event, Chart.hitTest(elements.canvas, event.clientX, event.clientY, state.result));
  });

  elements.canvas.addEventListener("mouseleave", function () {
    elements.chartTooltip.classList.remove("visible");
    elements.canvas.style.cursor = "default";
  });

  elements.canvas.addEventListener("click", function (event) {
    const hit = Chart.hitTest(elements.canvas, event.clientX, event.clientY, state.result);
    if (!hit) return;
    applySelection(hit.item.trainId);
    toast("已定位 " + hit.item.trainNumber + "，可在上方继续调整时刻。");
  });

  elements.addTrainBtn.addEventListener("click", addTrain);
  elements.resetBtn.addEventListener("click", resetScenario);
  elements.exportCsvBtn.addEventListener("click", exportCSV);
  elements.exportPngBtn.addEventListener("click", exportPNG);

  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(function () {
      if (state.result) updateChartFrame();
    });
    observer.observe(elements.chartWrap);
  } else {
    window.addEventListener("resize", updateChartFrame);
  }

  window.__dispatchApp = {
    getResult: function () { return state.result; },
    getTrains: function () { return state.trains.map(function (train) { return Object.assign({}, train); }); },
    selectTrain: applySelection,
    deleteTrain: deleteTrain,
    recalculate: refresh,
  };

  renderRows();
  refresh();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { renderChart(); });
  }
})();
