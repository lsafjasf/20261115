import {
  DEFAULT_STATE,
  MODES,
  PRESET_MEASUREMENTS,
  ROOM,
  SPEED_OF_SOUND,
  SPEAKERS,
  applyPreset,
  buildSpatialState,
  clamp,
  estimateRT60,
  sanitizeState,
} from "./geometry.js";
import {
  IR_ENGINE,
  renderSpatialImpulseResponses,
} from "./audio-engine.js";
import {
  drawImpulseChart,
  drawSparkline,
  renderRoom,
  svgPointToWorld,
} from "./visuals.js";

const dom = {
  modeControl: document.querySelector("#modeControl"),
  roomView: document.querySelector("#roomView"),
  roomState: document.querySelector("#roomState"),
  sourceReadout: document.querySelector("#sourceReadout"),
  listenerReadout: document.querySelector("#listenerReadout"),
  orientationInput: document.querySelector("#orientationInput"),
  orientationReadout: document.querySelector("#orientationReadout"),
  absorptionInput: document.querySelector("#absorptionInput"),
  absorptionReadout: document.querySelector("#absorptionReadout"),
  reflectionToggle: document.querySelector("#reflectionToggle"),
  resetButton: document.querySelector("#resetButton"),
  measureButton: document.querySelector("#measureButton"),
  autoMeasureButton: document.querySelector("#autoMeasureButton"),
  renderStatus: document.querySelector("#renderStatus"),
  tdoaValue: document.querySelector("#tdoaValue"),
  tdoaNote: document.querySelector("#tdoaNote"),
  tdoaSpark: document.querySelector("#tdoaSpark"),
  splValue: document.querySelector("#splValue"),
  rtValue: document.querySelector("#rtValue"),
  rtNote: document.querySelector("#rtNote"),
  activeChannelText: document.querySelector("#activeChannelText"),
  channelList: document.querySelector("#channelList"),
  irCanvas: document.querySelector("#irCanvas"),
  chartEmpty: document.querySelector("#chartEmpty"),
  chartToggle: document.querySelector("#chartToggle"),
  sampleRateLabel: document.querySelector("#sampleRateLabel"),
  irDurationLabel: document.querySelector("#irDurationLabel"),
  pathCountLabel: document.querySelector("#pathCountLabel"),
  measurementLog: document.querySelector("#measurementLog"),
  verifyBanner: document.querySelector("#verifyBanner"),
  verifyIcon: document.querySelector("#verifyBanner .verify-icon"),
  verifyTitle: document.querySelector("#verifyTitle"),
  verifyCopy: document.querySelector("#verifyCopy"),
  clearLogButton: document.querySelector("#clearLogButton"),
  exportButton: document.querySelector("#exportButton"),
  jsonExportButton: document.querySelector("#jsonExportButton"),
  csvExportButton: document.querySelector("#csvExportButton"),
  reportTimestamp: document.querySelector("#reportTimestamp"),
  toast: document.querySelector("#toast"),
  helpButton: document.querySelector("#helpButton"),
  helpModal: document.querySelector("#helpModal"),
  closeHelp: document.querySelector("#closeHelp"),
};

let state = sanitizeState(DEFAULT_STATE);
let spatial = buildSpatialState(state);
let currentMeasurement = null;
let measurements = [];
let orientationSweep = [];
let busy = false;
let showReflections = true;
let chartMode = "impulse";
let dragState = null;
let toastTimer = null;
let measureTimer = null;
let hasMeasured = false;
const ORIENTATION_YAWS = [0, 60, 120];

function setStatus(message, kind = "ready") {
  dom.renderStatus.classList.toggle("working", kind === "working");
  dom.renderStatus.classList.toggle("error", kind === "error");
  dom.renderStatus.innerHTML = "<i></i><span></span>";
  dom.renderStatus.querySelector("span").textContent = message;
}

function showToast(message, kind = "normal") {
  dom.toast.textContent = message;
  dom.toast.classList.toggle("error", kind === "error");
  dom.toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove("visible");
  }, 2600);
}

function formatDegrees(yaw) {
  const normalized = Math.round(yaw);
  const value = normalized < 0 ? 360 + normalized : normalized;
  return `${String(value).padStart(3, "0")}°`;
}

function mean(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  return usable.length
    ? usable.reduce((sum, value) => sum + value, 0) / usable.length
    : null;
}

function stateMatchesMeasurement(measurement) {
  if (!measurement) return false;
  return (
    measurement.mode === state.mode &&
    Math.abs(measurement.listener.x - state.listener.x) < 0.001 &&
    Math.abs(measurement.listener.y - state.listener.y) < 0.001 &&
    Math.abs(measurement.listener.yaw - state.listener.yaw) < 0.01 &&
    Math.abs(measurement.source.x - state.source.x) < 0.001 &&
    Math.abs(measurement.source.y - state.source.y) < 0.001 &&
    Math.abs(measurement.absorption - state.absorption) < 0.001
  );
}

function updateControls() {
  dom.sourceReadout.textContent =
    `X ${state.source.x.toFixed(2)}   Y ${state.source.y.toFixed(2)}`;
  dom.listenerReadout.textContent =
    `X ${state.listener.x.toFixed(2)}   Y ${state.listener.y.toFixed(2)}`;
  dom.orientationInput.value = String(Math.round(state.listener.yaw));
  dom.orientationReadout.textContent = formatDegrees(state.listener.yaw);
  dom.absorptionInput.value = String(state.absorption);
  dom.absorptionReadout.textContent = `${state.absorption.toFixed(2)} α`;
  for (const button of dom.modeControl.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  }
  dom.activeChannelText.textContent =
    `${String(spatial.activeChannels.length).padStart(2, "0")} CH ACTIVE`;
  dom.pathCountLabel.textContent = String(spatial.pathCount);
}

function makeChannelRow(channel, measurement) {
  const row = document.createElement("div");
  const current = measurement?.channels.find((item) => item.id === channel.id);
  const matches = stateMatchesMeasurement(measurement);
  const delay = current && matches ? current.onsetMs : channel.diagramDelayMs;
  row.className = `channel-row${channel.active ? "" : " inactive"}`;
  row.dataset.channel = channel.id;
  row.title = current
    ? `图示 ${current.pathDelayMs.toFixed(2)} ms · 实测 ${current.onsetMs.toFixed(2)} ms`
    : `几何预测 ${channel.diagramDelayMs.toFixed(2)} ms`;

  const name = document.createElement("span");
  name.className = "channel-name";
  const dot = document.createElement("i");
  dot.style.background = channel.color;
  name.append(dot, channel.id);

  const track = document.createElement("div");
  track.className = "channel-bar-track";
  const bar = document.createElement("div");
  bar.className = "channel-bar";
  bar.style.background = channel.color;
  bar.style.width = "0%";
  track.appendChild(bar);

  const value = document.createElement("span");
  value.className = "channel-delay";
  value.textContent = `${current && !matches ? "~" : ""}${delay.toFixed(2)} `;
  const unit = document.createElement("small");
  unit.textContent = "ms";
  value.appendChild(unit);
  row.append(name, track, value);
  return { row, bar, delay };
}

function renderChannels(measurement = currentMeasurement) {
  dom.channelList.replaceChildren();
  const maximum = Math.max(
    1,
    ...spatial.channels.map((channel) => channel.diagramDelayMs),
  );
  for (const channel of spatial.channels) {
    const item = makeChannelRow(channel, measurement);
    dom.channelList.appendChild(item.row);
    const delay = measurement && stateMatchesMeasurement(measurement)
      ? measurement.channels.find((entry) => entry.id === channel.id)?.onsetMs
      : channel.diagramDelayMs;
    item.bar.style.width = `${Math.min(100, ((delay ?? item.delay) / maximum) * 100)}%`;
  }
}

function renderMetrics(measurement = currentMeasurement) {
  if (!measurement) {
    dom.tdoaValue.textContent = "0.00";
    dom.tdoaNote.textContent = "等待脉冲响应";
    dom.splValue.textContent = "--.-";
    dom.rtValue.textContent = "-.--";
    dom.rtNote.textContent = `理论 ${spatial.rt60.toFixed(2)} s`;
    return;
  }
  const stale = !stateMatchesMeasurement(measurement);
  dom.tdoaValue.textContent = measurement.tdoa.measured.toFixed(2);
  dom.tdoaNote.textContent = stale
    ? `位置已变化 · 待复测`
    : `图示 ${measurement.tdoa.predicted.toFixed(2)} · Δ ${Math.abs(measurement.tdoa.error).toFixed(2)} ms`;
  dom.splValue.textContent = measurement.splDb.toFixed(1);
  dom.rtValue.textContent = measurement.rt60 != null
    ? measurement.rt60.toFixed(2)
    : "-.--";
  dom.rtNote.textContent = measurement.activeChannelCount
    ? `${measurement.activeChannelCount} 声道 T20 均值`
    : "T20 估计";
}

function refreshView({ drawChart = true } = {}) {
  spatial = buildSpatialState(state);
  state = spatial.state;
  updateControls();
  renderRoom(dom.roomView, spatial, { showReflections });
  renderChannels();
  renderMetrics();
  drawSparkline(dom.tdoaSpark, measurements);
  dom.sampleRateLabel.textContent = "48,000";
  dom.irDurationLabel.textContent = "1.80";
  if (drawChart && currentMeasurement) {
    drawImpulseChart(dom.irCanvas, currentMeasurement, chartMode);
  }
}

function buildMeasurementRecord(rendered, spatialSnapshot, meta = {}) {
  const activeChannels = spatialSnapshot.activeChannels;
  const channels = rendered.channels.map((response) => {
    const model = spatialSnapshot.channels.find(
      (channel) => channel.id === response.channelId,
    );
    return {
      id: model.id,
      name: model.name,
      short: model.short,
      color: model.color,
      active: model.active,
      nearEar: model.nearSide,
      sourceDistance: model.sourceDistance,
      nearEarDistance: model.nearDistance,
      pathDelayMs: model.diagramDelayMs,
      onsetMs: response.analysis.onsetMs,
      errorMs: response.analysis.onsetMs - model.diagramDelayMs,
      splDb: response.analysis.splDb,
      rt60: response.analysis.rt60,
      envelope: Array.from(response.analysis.envelope),
      reflections: model.reflections.map((reflection) => ({
        wallId: reflection.wallId,
        wallLabel: reflection.wallLabel,
        hit: { ...reflection.hit },
        pathDistance: reflection.distance,
        delayMs: (
          model.sourceDistance + reflection.distance
        ) / SPEED_OF_SOUND * 1000,
        reflectionGain: reflection.reflectionGain,
      })),
    };
  });
  const activeResults = channels.filter((channel) => channel.active);
  const measuredDelays = activeResults.map((channel) => channel.onsetMs);
  const pathDelays = activeResults.map((channel) => channel.pathDelayMs);
  const measuredTDOA = measuredDelays.length
    ? Math.max(...measuredDelays) - Math.min(...measuredDelays)
    : 0;
  const predictedTDOA = pathDelays.length
    ? Math.max(...pathDelays) - Math.min(...pathDelays)
    : 0;
  const maxDelayError = channels.reduce(
    (maximum, channel) => Math.max(maximum, Math.abs(channel.errorMs)),
    0,
  );
  const averageSpl = mean(activeResults.map((channel) => channel.splDb)) ?? 0;
  const averageRT60 = mean(activeResults.map((channel) => channel.rt60));

  return {
    id: meta.id ?? `M${measurements.length + 1}`,
    label: meta.label ?? "手动测量",
    timestamp: new Date().toISOString(),
    mode: spatialSnapshot.state.mode,
    modeLabel: MODES[spatialSnapshot.state.mode].label,
    source: { ...spatialSnapshot.state.source },
    listener: { ...spatialSnapshot.state.listener },
    absorption: spatialSnapshot.state.absorption,
    room: { ...ROOM },
    activeChannels: [...spatialSnapshot.activeIds],
    activeChannelCount: activeResults.length,
    channels,
    tdoa: {
      measured: measuredTDOA,
      predicted: predictedTDOA,
      error: measuredTDOA - predictedTDOA,
    },
    splDb: averageSpl,
    rt60: averageRT60,
    theoreticalRT60: spatialSnapshot.rt60,
    verification: {
      maxDelayErrorMs: maxDelayError,
      tdoaErrorMs: Math.abs(measuredTDOA - predictedTDOA),
      thresholdMs: 0.45,
      pass: maxDelayError <= 0.45 && Math.abs(measuredTDOA - predictedTDOA) <= 0.45,
    },
    ir: {
      engine: rendered.engine,
      sampleRate: rendered.sampleRate,
      duration: rendered.duration,
      channelsRendered: rendered.channels.length,
    },
  };
}

function renderChart(record = currentMeasurement) {
  if (!record) {
    dom.chartEmpty.classList.remove("hidden");
    const context = dom.irCanvas.getContext("2d");
    context.clearRect(0, 0, dom.irCanvas.width, dom.irCanvas.height);
    return;
  }
  dom.chartEmpty.classList.add("hidden");
  drawImpulseChart(dom.irCanvas, record, chartMode);
  dom.sampleRateLabel.textContent = record.ir.sampleRate.toLocaleString("en-US");
  dom.irDurationLabel.textContent = record.ir.duration.toFixed(2);
}

function renderLog() {
  dom.measurementLog.replaceChildren();
  if (!measurements.length) {
    const placeholder = document.createElement("div");
    placeholder.className = "log-placeholder";
    placeholder.innerHTML = "<span>01</span><span>02</span><span>03</span><p>点击“三点自动测量”开始校准</p>";
    dom.measurementLog.appendChild(placeholder);
    dom.reportTimestamp.textContent = "尚未记录";
    return;
  }
  for (const [index, record] of measurements.entries()) {
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = `log-entry${record.verification.pass ? "" : " fail"}`;
    entry.dataset.measurementId = record.id;
    entry.title = "载入这次测量";
    const badge = document.createElement("span");
    badge.className = "log-index";
    badge.textContent = record.verification.pass ? `0${index + 1}` : "!";
    const main = document.createElement("div");
    main.className = "log-main";
    const title = document.createElement("strong");
    title.textContent = `${record.id} · ${record.label}`;
    const meta = document.createElement("span");
    meta.textContent = `${formatDegrees(record.listener.yaw)} · X ${record.listener.x.toFixed(2)} / Y ${record.listener.y.toFixed(2)}`;
    main.append(title, meta);
    const values = document.createElement("div");
    values.className = "log-values";
    values.innerHTML = `TDOA <b>${record.tdoa.measured.toFixed(2)} ms</b><br>Δ ${record.verification.maxDelayErrorMs.toFixed(2)} ms`;
    entry.append(badge, main, values);
    dom.measurementLog.appendChild(entry);
  }
  const latest = measurements[measurements.length - 1];
  dom.reportTimestamp.textContent = new Date(latest.timestamp).toLocaleTimeString(
    "zh-CN",
    { hour: "2-digit", minute: "2-digit", second: "2-digit" },
  );
}

function renderVerification() {
  if (orientationSweep.length) {
    const passed = orientationSweep.filter((sample) => sample.pass).length;
    const maxError = Math.max(
      ...orientationSweep.map((sample) => sample.maxDelayErrorMs),
    );
    const measured = orientationSweep.map((sample) => sample.measuredTDOA);
    const allPass = passed === orientationSweep.length
      && measurements.length >= 3
      && measurements.every((record) => record.verification.pass);
    dom.verifyBanner.className = `verify-banner${allPass ? "" : " fail"}`;
    dom.verifyIcon.textContent = allPass ? "✓" : "!";
    dom.verifyTitle.textContent = allPass
      ? "同位置朝向扫描与路径一致"
      : `朝向扫描 ${passed}/${orientationSweep.length} 通过`;
    dom.verifyCopy.textContent = allPass
      ? `0° → 120° · 最大到时误差 ${maxError.toFixed(2)} ms · TDOA ${Math.min(...measured).toFixed(2)}–${Math.max(...measured).toFixed(2)} ms`
      : `阈值 0.45 ms · 当前最大误差 ${maxError.toFixed(2)} ms`;
    return;
  }
  if (!measurements.length) {
    dom.verifyBanner.className = "verify-banner pending";
    dom.verifyIcon.textContent = "–";
    dom.verifyTitle.textContent = "等待三点测量";
    dom.verifyCopy.textContent = "实测 IR 到时将与反射路径逐项比对";
    return;
  }
  const passed = measurements.filter((record) => record.verification.pass).length;
  const maxError = Math.max(
    ...measurements.map((record) => record.verification.maxDelayErrorMs),
  );
  const yaws = measurements.map((record) => formatDegrees(record.listener.yaw));
  const allPass = passed === measurements.length && measurements.length >= 3;
  dom.verifyBanner.className = `verify-banner${allPass ? "" : " fail"}`;
  dom.verifyIcon.textContent = allPass ? "✓" : "!";
  dom.verifyTitle.textContent = allPass
    ? "朝向变化与路径模型一致"
    : `${passed}/${measurements.length} 测量通过`;
  dom.verifyCopy.textContent = allPass
    ? `最大到时误差 ${maxError.toFixed(2)} ms · 朝向 ${yaws[0]} → ${yaws[yaws.length - 1]}`
    : `阈值 0.45 ms · 当前最大误差 ${maxError.toFixed(2)} ms`;
}

function updateMeasurementViews() {
  renderChannels(currentMeasurement);
  renderMetrics(currentMeasurement);
  renderChart(currentMeasurement);
  renderLog();
  renderVerification();
  drawSparkline(dom.tdoaSpark, measurements);
}

function setBusy(value) {
  busy = value;
  dom.measureButton.disabled = value;
  dom.autoMeasureButton.disabled = value;
  dom.exportButton.disabled = value;
  dom.jsonExportButton.disabled = value;
  dom.csvExportButton.disabled = value;
}

async function renderMeasurement(spatialSnapshot, meta = {}) {
  setStatus(
    `${meta.label ?? "当前位置"} · OfflineAudioContext 渲染 4 声道`,
    "working",
  );
  const rendered = await renderSpatialImpulseResponses(spatialSnapshot);
  const record = buildMeasurementRecord(rendered, spatialSnapshot, meta);
  currentMeasurement = record;
  hasMeasured = true;
  return record;
}

async function measureCurrent({ append = true, quiet = false } = {}) {
  if (busy) return null;
  setBusy(true);
  const spatialSnapshot = buildSpatialState(state);
  state = spatialSnapshot.state;
  const meta = {
    id: append ? `M${measurements.length + 1}` : "CURRENT",
    label: append ? "手动测量" : "实时复测",
  };
  try {
    const record = await renderMeasurement(spatialSnapshot, meta);
    if (append) measurements.push(record);
    if (!stateMatchesMeasurement(record)) currentMeasurement = record;
    updateMeasurementViews();
    const count = spatialSnapshot.activeChannels.length;
    setStatus(
      `${record.label}完成 · ${count} 声道 · ${record.ir.engine}`,
      "ready",
    );
    dom.roomState.textContent =
      `测量完成 · TDOA ${record.tdoa.measured.toFixed(2)} ms`;
    if (!quiet) {
      showToast(
        `已从 Web Audio IR 测得 ${record.tdoa.measured.toFixed(2)} ms TDOA`,
      );
    }
    return record;
  } catch (error) {
    console.error(error);
    setStatus(error.message || "脉冲响应渲染失败", "error");
    showToast(`测量失败：${error.message}`, "error");
    return null;
  } finally {
    setBusy(false);
  }
}

async function runThreePointMeasurements() {
  if (busy) return;
  setBusy(true);
  measurements = [];
  orientationSweep = [];
  currentMeasurement = null;
  renderLog();
  renderVerification();
  dom.chartEmpty.classList.remove("hidden");
  try {
    for (const [index, preset] of PRESET_MEASUREMENTS.entries()) {
      state = applyPreset(state, preset);
      spatial = buildSpatialState(state);
      state = spatial.state;
      refreshView({ drawChart: false });
      dom.roomState.textContent =
        `自动校准 ${index + 1}/3 · ${preset.label}`;
      setStatus(
        `校准 ${index + 1}/3 · 监听朝向 ${formatDegrees(preset.listener.yaw)}`,
        "working",
      );
      await new Promise((resolve) => window.setTimeout(resolve, 90));
      const spatialSnapshot = buildSpatialState(state);
      const record = await renderMeasurement(spatialSnapshot, {
        id: preset.id,
        label: preset.label,
      });
      measurements.push(record);
      updateMeasurementViews();
    }

    const sweepPosition = { ...state.listener };
    for (const [index, yaw] of ORIENTATION_YAWS.entries()) {
      state.listener.yaw = yaw;
      spatial = buildSpatialState(state);
      state = spatial.state;
      refreshView({ drawChart: false });
      setStatus(
        `朝向校验 ${index + 1}/${ORIENTATION_YAWS.length} · ${formatDegrees(yaw)}`,
        "working",
      );
      await new Promise((resolve) => window.setTimeout(resolve, 70));
      const sweepSnapshot = buildSpatialState(state);
      const sweepRecord = await renderMeasurement(sweepSnapshot, {
        id: `O${index + 1}`,
        label: `朝向 ${formatDegrees(yaw)}`,
      });
      orientationSweep.push({
        yaw,
        listener: { ...sweepRecord.listener },
        predictedTDOA: sweepRecord.tdoa.predicted,
        measuredTDOA: sweepRecord.tdoa.measured,
        errorMs: sweepRecord.tdoa.error,
        maxDelayErrorMs: sweepRecord.verification.maxDelayErrorMs,
        pass: sweepRecord.verification.pass,
        channelDelays: sweepRecord.channels.map((channel) => ({
          channel: channel.id,
          pathDelayMs: channel.pathDelayMs,
          irMeasuredDelayMs: channel.onsetMs,
          errorMs: channel.errorMs,
          rt60: channel.rt60,
        })),
      });
    }

    state.listener = { ...sweepPosition };
    spatial = buildSpatialState(state);
    state = spatial.state;
    currentMeasurement = measurements[measurements.length - 1];
    refreshView();
    updateMeasurementViews();
    setStatus(
      "三点测量完成 · 实测 IR 与路径模型已校验",
      "ready",
    );
    dom.roomState.textContent = "三点校准完成 · 可导出报告";
    const passed = measurements.filter((record) => record.verification.pass).length;
    showToast(
      `三点测量完成：${passed}/3 通过，TDOA 与反射路径一致`,
    );
  } catch (error) {
    console.error(error);
    setStatus(error.message || "三点测量失败", "error");
    showToast(`三点测量失败：${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

function scheduleQuickMeasurement() {
  if (!hasMeasured) return;
  window.clearTimeout(measureTimer);
  measureTimer = window.setTimeout(() => {
    if (!busy) measureCurrent({ append: false, quiet: true });
  }, 220);
}

function updateDrag(event) {
  if (!dragState) return;
  const world = svgPointToWorld(
    dom.roomView,
    event.clientX,
    event.clientY,
  );
  if (!world) return;
  if (dragState === "source") {
    state.source.x = clamp(world.x, 0.25, ROOM.width - 0.25);
    state.source.y = clamp(world.y, 0.25, ROOM.depth - 0.25);
    dom.roomState.textContent = "声源位置已改变 · 点击测量";
  } else if (dragState === "listener") {
    state.listener.x = clamp(world.x, 0.3, ROOM.width - 0.3);
    state.listener.y = clamp(world.y, 0.3, ROOM.depth - 0.3);
    dom.roomState.textContent = "监听位置已改变 · 点击测量";
  } else if (dragState === "orientation") {
    state.listener.yaw = (
      Math.atan2(
        world.y - state.listener.y,
        world.x - state.listener.x,
      ) * 180 / Math.PI
    );
    dom.roomState.textContent =
      `监听朝向 ${formatDegrees(state.listener.yaw)} · 点击测量`;
  }
  refreshView({ drawChart: false });
}

dom.roomView.addEventListener("pointerdown", (event) => {
  if (busy) return;
  const target = event.target.closest("[data-drag]");
  if (!target) return;
  dragState = target.dataset.drag;
  dom.roomView.setPointerCapture(event.pointerId);
  updateDrag(event);
});

dom.roomView.addEventListener("pointermove", (event) => {
  if (dragState) updateDrag(event);
});

dom.roomView.addEventListener("pointerup", (event) => {
  if (!dragState) return;
  dragState = null;
  if (dom.roomView.hasPointerCapture(event.pointerId)) {
    dom.roomView.releasePointerCapture(event.pointerId);
  }
  refreshView({ drawChart: false });
});

dom.roomView.addEventListener("pointercancel", () => {
  dragState = null;
});

dom.modeControl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-mode]");
  if (!button || button.dataset.mode === state.mode || busy) return;
  state.mode = button.dataset.mode;
  refreshView();
  dom.roomState.textContent =
    `${MODES[state.mode].label}模式 · ${spatial.activeChannels.length} 个激活声道`;
  setStatus(
    `已切换${MODES[state.mode].label} · 准备复测`,
    "ready",
  );
  scheduleQuickMeasurement();
});

dom.orientationInput.addEventListener("input", (event) => {
  state.listener.yaw = Number(event.target.value);
  refreshView({ drawChart: false });
  dom.roomState.textContent =
    `监听朝向 ${formatDegrees(state.listener.yaw)} · 等待复测`;
});

dom.orientationInput.addEventListener("change", scheduleQuickMeasurement);
dom.absorptionInput.addEventListener("input", (event) => {
  state.absorption = Number(event.target.value);
  refreshView({ drawChart: false });
  dom.rtNote.textContent = `理论 RT60 ${estimateRT60(state.absorption).toFixed(2)} s`;
});
dom.absorptionInput.addEventListener("change", scheduleQuickMeasurement);

dom.reflectionToggle.addEventListener("click", () => {
  showReflections = !showReflections;
  dom.reflectionToggle.classList.toggle("active", showReflections);
  refreshView({ drawChart: false });
});

dom.resetButton.addEventListener("click", () => {
  state = sanitizeState(DEFAULT_STATE);
  currentMeasurement = null;
  refreshView({ drawChart: false });
  renderMetrics(null);
  renderChart(null);
  dom.roomState.textContent = "已恢复默认位置";
  setStatus("位置已复位 · 等待测量", "ready");
});

dom.measureButton.addEventListener("click", () => measureCurrent());
dom.autoMeasureButton.addEventListener("click", runThreePointMeasurements);

dom.chartToggle.addEventListener("click", () => {
  chartMode = chartMode === "impulse" ? "decay" : "impulse";
  dom.chartToggle.textContent = chartMode === "impulse" ? "衰减 dB" : "振幅";
  renderChart();
});

dom.measurementLog.addEventListener("click", (event) => {
  const entry = event.target.closest("[data-measurement-id]");
  if (!entry || busy) return;
  const record = measurements.find((item) => item.id === entry.dataset.measurementId);
  if (!record) return;
  state = sanitizeState({
    mode: record.mode,
    absorption: record.absorption,
    source: record.source,
    listener: record.listener,
  });
  currentMeasurement = record;
  refreshView();
  updateMeasurementViews();
  dom.roomState.textContent = `已载入 ${record.id} · ${record.label}`;
  showToast(`已载入 ${record.id} 的测量记录`);
});

dom.clearLogButton.addEventListener("click", () => {
  if (busy) return;
  measurements = [];
  orientationSweep = [];
  currentMeasurement = null;
  renderLog();
  renderVerification();
  renderChart(null);
  renderMetrics(null);
  renderChannels(null);
  drawSparkline(dom.tdoaSpark, []);
  showToast("测量日志已清空");
});

dom.helpButton.addEventListener("click", () => {
  dom.helpModal.classList.add("open");
  dom.helpModal.setAttribute("aria-hidden", "false");
});

function closeHelp() {
  dom.helpModal.classList.remove("open");
  dom.helpModal.setAttribute("aria-hidden", "true");
}

dom.closeHelp.addEventListener("click", closeHelp);
dom.helpModal.addEventListener("click", (event) => {
  if (event.target === dom.helpModal) closeHelp();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeHelp();
  const tag = document.activeElement?.tagName;
  if (event.key === "Enter" && !busy && !["INPUT", "BUTTON", "TEXTAREA"].includes(tag)) {
    measureCurrent();
  }
});

function buildReport(records = measurements) {
  const usable = records.length ? records : (currentMeasurement ? [currentMeasurement] : []);
  return {
    schemaVersion: "1.0",
    title: "AURALAB 虚拟房间声学测量报告",
    generatedAt: new Date().toISOString(),
    room: {
      widthM: ROOM.width,
      depthM: ROOM.depth,
      heightM: ROOM.height,
      speakers: SPEAKERS.map((speaker) => ({
        id: speaker.id,
        name: speaker.name,
        xM: speaker.x,
        yM: speaker.y,
      })),
    },
    engine: {
      impulseResponse: IR_ENGINE,
      sampleRateHz: 48000,
      impulseDurationS: 1.8,
      sourceSignal: "Web Audio 阻尼脉冲 + 指数衰减噪声尾",
      onsetDetection: "首个超过直达峰值 5.5% 的采样点",
      splCalibration: "1 m 参考峰值 94 dB SPL",
      decayAnalysis: "Schroeder 反向能量积分，T20 × 3",
    },
    orientationVerification: {
      method: "同一监听位置依次旋转至 0°、60°、120°，每角度渲染真实 IR",
      positionSamples: usable.map((record) => ({
        measurementId: record.id,
        listenerYawDeg: record.listener.yaw,
        pathPredictedTDOAMs: record.tdoa.predicted,
        irMeasuredTDOAMs: record.tdoa.measured,
        tdoaErrorMs: record.tdoa.error,
        maxChannelDelayErrorMs: record.verification.maxDelayErrorMs,
        pass: record.verification.pass,
      })),
      samePositionSweep: orientationSweep.map((sample) => ({
        listenerYawDeg: sample.yaw,
        listener: { ...sample.listener },
        pathPredictedTDOAMs: sample.predictedTDOA,
        irMeasuredTDOAMs: sample.measuredTDOA,
        tdoaErrorMs: sample.errorMs,
        maxChannelDelayErrorMs: sample.maxDelayErrorMs,
        pass: sample.pass,
        channelDelays: sample.channelDelays,
      })),
    },
    measurements: usable.map((record) => ({
      id: record.id,
      label: record.label,
      timestamp: record.timestamp,
      mode: record.mode,
      modeLabel: record.modeLabel,
      source: { ...record.source },
      listener: { ...record.listener },
      absorptionCoefficient: record.absorption,
      activeChannels: [...record.activeChannels],
      tdoaMs: {
        pathPredicted: record.tdoa.predicted,
        irMeasured: record.tdoa.measured,
        error: record.tdoa.error,
      },
      averageSplDb: record.splDb,
      averageRT60s: record.rt60,
      theoreticalRT60s: record.theoreticalRT60,
      impulseResponse: { ...record.ir },
      channelDelays: record.channels.map((channel) => ({
        channel: channel.id,
        name: channel.name,
        active: channel.active,
        nearEar: channel.nearEar,
        sourceToSpeakerM: channel.sourceDistance,
        speakerToNearEarM: channel.nearEarDistance,
        pathPredictedDelayMs: channel.pathDelayMs,
        irMeasuredDelayMs: channel.onsetMs,
        errorMs: channel.errorMs,
        splDb: channel.splDb,
        decayRT60s: channel.rt60,
        reflections: channel.reflections.map((reflection) => ({
          wall: reflection.wallLabel,
          hit: reflection.hit,
          pathDistanceM: reflection.pathDistance,
          delayMs: reflection.delayMs,
          gain: reflection.reflectionGain,
        })),
      })),
      verification: { ...record.verification },
    })),
  };
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function reportFileStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function exportJSON() {
  if (!measurements.length && !currentMeasurement) {
    showToast("请先完成至少一次测量", "error");
    return;
  }
  const report = buildReport();
  downloadFile(
    JSON.stringify(report, null, 2),
    `auralab-report-${reportFileStamp()}.json`,
    "application/json;charset=utf-8",
  );
  showToast(`报告已导出 · ${report.measurements.length} 次测量`);
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

function exportCSV() {
  if (!measurements.length && !currentMeasurement) {
    showToast("请先完成至少一次测量", "error");
    return;
  }
  const report = buildReport();
  const header = [
    "measurement_id",
    "label",
    "timestamp",
    "mode",
    "listener_x_m",
    "listener_y_m",
    "listener_yaw_deg",
    "source_x_m",
    "source_y_m",
    "channel",
    "active",
    "near_ear",
    "path_delay_ms",
    "measured_delay_ms",
    "delay_error_ms",
    "spl_db",
    "rt60_t20_s",
    "tdoa_predicted_ms",
    "tdoa_measured_ms",
    "verification",
  ];
  const rows = [header];
  for (const measurement of report.measurements) {
    for (const channel of measurement.channelDelays) {
      rows.push([
        measurement.id,
        measurement.label,
        measurement.timestamp,
        measurement.mode,
        measurement.listener.x.toFixed(3),
        measurement.listener.y.toFixed(3),
        measurement.listener.yaw.toFixed(1),
        measurement.source.x.toFixed(3),
        measurement.source.y.toFixed(3),
        channel.channel,
        channel.active ? "yes" : "no",
        channel.nearEar,
        channel.pathPredictedDelayMs.toFixed(4),
        channel.irMeasuredDelayMs.toFixed(4),
        channel.errorMs.toFixed(4),
        channel.splDb.toFixed(3),
        channel.decayRT60s == null ? "" : channel.decayRT60s.toFixed(4),
        measurement.tdoaMs.pathPredicted.toFixed(4),
        measurement.tdoaMs.irMeasured.toFixed(4),
        measurement.verification.pass ? "pass" : "fail",
      ]);
    }
  }
  const content = rows
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");
  downloadFile(
    `\ufeff${content}`,
    `auralab-measurements-${reportFileStamp()}.csv`,
    "text/csv;charset=utf-8",
  );
  showToast("CSV 测量数据已导出");
}

dom.exportButton.addEventListener("click", exportJSON);
dom.jsonExportButton.addEventListener("click", exportJSON);
dom.csvExportButton.addEventListener("click", exportCSV);

let resizeTimer = null;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    renderChart();
  }, 120);
});

window.__AURALAB__ = {
  getState: () => JSON.parse(JSON.stringify(state)),
  getMeasurements: () => JSON.parse(JSON.stringify(measurements.map((record) => ({
    ...record,
    channels: record.channels.map(({ envelope, ...channel }) => channel),
  })))),
  getReport: () => buildReport(),
  getOrientationSweep: () => JSON.parse(JSON.stringify(orientationSweep)),
  measureCurrent,
  runThreePointMeasurements,
};

refreshView();
renderLog();
renderVerification();
renderMetrics(null);
renderChannels(null);
renderChart(null);
setStatus("Impulse response engine ready", "ready");
dom.roomState.textContent = "自动校准准备中 · Web Audio 48 kHz";

window.setTimeout(() => {
  runThreePointMeasurements();
}, 650);
