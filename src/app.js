import {
  DEFAULT_CONFIG,
  DEFAULT_LOOP_LENGTH,
  DEFAULT_SAMPLE_RATE,
  PRIORITY_FADE_SECONDS,
  TRIGGER_KEYS,
  encodeWav,
  makeExportConfig,
  normalizeConfig,
  resolveSample,
  resolveSequence,
  synthesizeDrumLoop,
} from "./audio-model.js";

let sourcePcm = synthesizeDrumLoop(DEFAULT_SAMPLE_RATE, DEFAULT_LOOP_LENGTH);
const MIN_SAMPLE_DURATION = 0.02;
const VIEW_OVERHANG = 0.35;

const state = {
  config: normalizeConfig(structuredClone(DEFAULT_CONFIG), DEFAULT_SAMPLE_RATE),
  selectedId: 1,
  drag: null,
  activeKey: null,
  flashSampleId: null,
  transport: {
    playing: false,
    startedAt: 0,
    duration: DEFAULT_LOOP_LENGTH,
    raf: 0,
  },
};

const elements = {
  waveform: document.querySelector("#waveformCanvas"),
  keyboard: document.querySelector("#keyboardCanvas"),
  sampleList: document.querySelector("#sampleList"),
  sampleCount: document.querySelector("#sampleCount"),
  playButton: document.querySelector("#playButton"),
  stopButton: document.querySelector("#stopButton"),
  addSampleButton: document.querySelector("#addSampleButton"),
  exportConfigButton: document.querySelector("#exportConfigButton"),
  importConfigButton: document.querySelector("#importConfigButton"),
  rebuildButton: document.querySelector("#rebuildButton"),
  configFileInput: document.querySelector("#configFileInput"),
  ioStatus: document.querySelector("#ioStatus"),
  transportTime: document.querySelector("#transportTime"),
  transportDot: document.querySelector("#transportDot"),
  toast: document.querySelector("#toast"),
  startReadout: document.querySelector("#startReadout"),
  endReadout: document.querySelector("#endReadout"),
  fadeInReadout: document.querySelector("#fadeInReadout"),
  fadeOutReadout: document.querySelector("#fadeOutReadout"),
  seamNotice: document.querySelector("#seamNotice"),
  footerClock: document.querySelector("#footerClock"),
};

const waveView = {
  width: 0,
  height: 0,
  xStart: 49,
  xEnd: 23,
  top: 48,
  bottom: 0,
  viewEnd: 2.35,
  peaks: [],
  peakWidth: 0,
  handleHitboxes: [],
};

let keyboardHitboxes = [];
let toastTimer = 0;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function selectedSample() {
  return state.config.samples.find((sample) => sample.id === state.selectedId) || state.config.samples[0];
}

function resolvedSelected() {
  return resolveSample(selectedSample(), state.config.loopLength);
}

function formatTime(value, digits = 3) {
  return Number(value).toFixed(digits);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("show");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 2600);
}

function setIoStatus(message, mode = "") {
  elements.ioStatus.textContent = message;
  elements.ioStatus.className = `io-status ${mode}`.trim();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadJson(value, filename) {
  downloadBlob(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }), filename);
}

function downloadWav(pcm, sampleRate, filename) {
  downloadBlob(new Blob([encodeWav(pcm, sampleRate)], { type: "audio/wav" }), filename);
}

function miniWaveMarkup(seed, sample) {
  return Array.from({ length: 22 }, (_, index) => {
    const wave = Math.abs(Math.sin((index + 1) * (seed + 2) * 0.47));
    const taper = Math.sin((index / 21) * Math.PI) * 0.7 + 0.3;
    const height = Math.max(3, Math.round((wave * taper * 22) + (sample.truncatedAtLoop ? index * 0.2 : 0)));
    return `<i style="height:${Math.min(24, height)}px"></i>`;
  }).join("");
}

function renderSampleList() {
  elements.sampleCount.textContent = String(state.config.samples.length).padStart(2, "0");
  elements.sampleList.innerHTML = state.config.samples.map((sample, index) => {
    const resolved = resolveSample(sample, state.config.loopLength);
    const usedKeys = new Set(state.config.samples.filter((entry) => entry.id !== sample.id).map((entry) => entry.key));
    const options = TRIGGER_KEYS.map((key) => {
      const selected = key === sample.key ? " selected" : "";
      const disabled = usedKeys.has(key) ? " disabled" : "";
      return `<option value="${key}"${selected}${disabled}>${key}</option>`;
    }).join("");
    const activeClass = sample.id === state.selectedId ? " active" : "";
    const flashClass = sample.id === state.flashSampleId ? " flash" : "";
    return `
      <div class="sample-card${activeClass}${flashClass}" data-sample-id="${sample.id}" role="button" tabindex="0" aria-label="编辑采样 ${escapeHtml(sample.name)}">
        <span class="sample-key">${escapeHtml(sample.key)}</span>
        <div class="sample-meta">
          <div class="sample-name">${escapeHtml(sample.name)}</div>
          <div class="sample-sub">
            <span>${String(index + 1).padStart(2, "0")} · ${formatTime(resolved.duration, 2)}s</span>
            ${resolved.truncatedAtLoop ? '<span class="truncated-tag">SEAM CUT</span>' : ""}
          </div>
        </div>
        <div class="mini-wave" aria-hidden="true">${miniWaveMarkup(sample.id, resolved)}</div>
        <select class="key-select" data-action="key" data-sample-id="${sample.id}" aria-label="${escapeHtml(sample.name)} 触发键">${options}</select>
      </div>
    `;
  }).join("");
}

function renderReadouts() {
  const sample = selectedSample();
  const resolved = resolveSample(sample, state.config.loopLength);
  elements.startReadout.textContent = formatTime(resolved.start);
  elements.endReadout.textContent = formatTime(resolved.end);
  elements.fadeInReadout.textContent = formatTime(resolved.fadeIn);
  elements.fadeOutReadout.textContent = formatTime(resolved.fadeOut);
  const endReadout = elements.endReadout.closest(".readout");
  endReadout.classList.toggle("outside", resolved.truncatedAtLoop);
  const noticeText = resolved.truncatedAtLoop
    ? `接缝截断：请求裁切到 ${formatTime(resolved.requestedEnd)}s，实际只播放到 ${formatTime(state.config.loopLength)}s。`
    : `拖动圆形手柄：起点 ${formatTime(resolved.start)}s，终点 ${formatTime(resolved.end)}s；释放后写入采样配置。`;
  elements.seamNotice.classList.toggle("clipped", resolved.truncatedAtLoop);
  elements.seamNotice.querySelector("span:last-child").textContent = noticeText;
  elements.footerClock.textContent = `${state.config.bpm} BPM · ${state.config.samples.length} SAMPLES`;
  setIoStatus(`READY / ${state.config.samples.length} SAMPLES / ${state.config.sequence.length} EVENTS`);
}

function refreshInterface({ rebuildList = true } = {}) {
  if (rebuildList) renderSampleList();
  renderReadouts();
  drawWaveform();
  drawKeyboard();
}

function selectSample(id) {
  if (!state.config.samples.some((sample) => sample.id === id)) return;
  state.selectedId = id;
  refreshInterface();
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { context, width, height };
}

function getWaveLayout(width, height) {
  const viewEnd = Math.max(
    state.config.loopLength + VIEW_OVERHANG,
    Math.min(state.config.loopLength + 0.75, resolvedSelected().requestedEnd + 0.06),
  );
  const xStart = Math.min(52, width * 0.12);
  const xEnd = Math.max(18, width * 0.025);
  return {
    width,
    height,
    viewEnd,
    xStart,
    xEnd,
    plotWidth: width - xStart - xEnd,
    rulerBottom: 33,
    waveTop: 47,
    waveBottom: height - 37,
  };
}

function timeToX(time, layout) {
  return layout.xStart + (time / layout.viewEnd) * layout.plotWidth;
}

function xToTime(x, layout) {
  return clamp((x - layout.xStart) / layout.plotWidth, 0, 1) * layout.viewEnd;
}

function rebuildPeakCache(layout) {
  const binCount = Math.max(1, Math.ceil(layout.plotWidth));
  if (waveView.peaks.length === binCount && waveView.peakWidth === layout.plotWidth) return;
  const peaks = [];
  const framesPerBin = (state.config.loopLength / layout.plotWidth) * state.config.sampleRate;
  for (let bin = 0; bin < binCount; bin += 1) {
    const first = Math.min(sourcePcm.length - 1, Math.floor(bin * framesPerBin));
    const last = Math.min(sourcePcm.length, Math.ceil((bin + 1) * framesPerBin));
    let minimum = 0;
    let maximum = 0;
    for (let frame = first; frame < Math.max(first + 1, last); frame += 1) {
      minimum = Math.min(minimum, sourcePcm[frame]);
      maximum = Math.max(maximum, sourcePcm[frame]);
    }
    peaks.push({ minimum, maximum });
  }
  waveView.peaks = peaks;
  waveView.peakWidth = layout.plotWidth;
}

function drawHandle(context, x, y, color, label = "") {
  context.save();
  context.shadowColor = color;
  context.shadowBlur = 8;
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, 5.5, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = "rgba(7, 10, 8, 0.9)";
  context.lineWidth = 1;
  context.beginPath();
  context.arc(x, y, 2.2, 0, Math.PI * 2);
  context.stroke();
  if (label) {
    context.fillStyle = "rgba(226, 234, 220, 0.56)";
    context.font = "600 8px SFMono-Regular, Consolas, monospace";
    context.textAlign = "center";
    context.fillText(label, x, y + 17);
  }
  context.restore();
}

function drawWaveform() {
  const { context, width, height } = setupCanvas(elements.waveform);
  const layout = getWaveLayout(width, height);
  Object.assign(waveView, layout);
  rebuildPeakCache(layout);

  const sample = selectedSample();
  const resolved = resolveSample(sample, state.config.loopLength);
  const actualEnd = resolved.end;
  const requestedEnd = Math.max(resolved.start + MIN_SAMPLE_DURATION, resolved.requestedEnd);
  const seamX = timeToX(state.config.loopLength, layout);
  const startX = timeToX(resolved.start, layout);
  const endX = timeToX(actualEnd, layout);
  const requestedX = timeToX(requestedEnd, layout);
  const yMiddle = (layout.waveTop + layout.waveBottom) / 2;
  const amplitude = (layout.waveBottom - layout.waveTop) * 0.43;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0b0f0d";
  context.fillRect(0, 0, width, height);

  const rulerGradient = context.createLinearGradient(0, 0, 0, layout.rulerBottom);
  rulerGradient.addColorStop(0, "rgba(255,255,255,0.035)");
  rulerGradient.addColorStop(1, "rgba(255,255,255,0.006)");
  context.fillStyle = rulerGradient;
  context.fillRect(0, 0, width, layout.rulerBottom);
  context.strokeStyle = "rgba(224, 236, 225, 0.1)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, layout.rulerBottom + 0.5);
  context.lineTo(width, layout.rulerBottom + 0.5);
  context.stroke();

  const tickStep = layout.viewEnd > 2.2 ? 0.25 : 0.2;
  context.font = "500 8px SFMono-Regular, Consolas, monospace";
  context.textAlign = "center";
  for (let time = 0; time <= layout.viewEnd + 1e-9; time += tickStep) {
    const x = timeToX(time, layout);
    const major = Math.abs(time - state.config.loopLength) < 1e-9 || Math.abs((time * 2) % 1) < 1e-9;
    context.strokeStyle = major ? "rgba(224, 236, 225, 0.16)" : "rgba(224, 236, 225, 0.075)";
    context.beginPath();
    context.moveTo(Math.round(x) + 0.5, layout.rulerBottom - (major ? 9 : 5));
    context.lineTo(Math.round(x) + 0.5, layout.rulerBottom);
    context.stroke();
    if (major) {
      context.fillStyle = "rgba(210, 222, 212, 0.42)";
      context.fillText(formatTime(time, 2), Math.min(width - 18, Math.max(18, x)), 17);
    }
  }

  context.fillStyle = "rgba(255, 255, 255, 0.022)";
  context.fillRect(0, layout.waveTop, width, layout.waveBottom - layout.waveTop);
  context.strokeStyle = "rgba(255, 255, 255, 0.035)";
  context.beginPath();
  context.moveTo(0, yMiddle + 0.5);
  context.lineTo(width, yMiddle + 0.5);
  context.stroke();

  context.fillStyle = "rgba(184, 207, 190, 0.42)";
  const peaksToSeam = Math.min(waveView.peaks.length, Math.ceil(layout.plotWidth * (state.config.loopLength / layout.viewEnd)));
  for (let bin = 0; bin < peaksToSeam; bin += 1) {
    const x = layout.xStart + bin;
    const peak = waveView.peaks[bin];
    const top = yMiddle - peak.maximum * amplitude;
    const bottom = yMiddle - peak.minimum * amplitude;
    context.fillRect(x, top, 1, Math.max(1, bottom - top));
  }

  if (seamX < width) {
    context.save();
    context.fillStyle = "rgba(255, 138, 106, 0.055)";
    context.fillRect(seamX, layout.waveTop, width - seamX, layout.waveBottom - layout.waveTop);
    context.strokeStyle = "rgba(255, 138, 106, 0.14)";
    context.lineWidth = 1;
    for (let x = seamX - (layout.waveBottom - layout.waveTop); x < width; x += 12) {
      context.beginPath();
      context.moveTo(x, layout.waveBottom);
      context.lineTo(x + layout.waveBottom - layout.waveTop, layout.waveTop);
      context.stroke();
    }
    context.restore();
  }

  context.fillStyle = "rgba(5, 7, 6, 0.57)";
  context.fillRect(0, layout.waveTop, Math.max(0, startX), layout.waveBottom - layout.waveTop);
  context.fillRect(Math.min(width, requestedX), layout.waveTop, Math.max(0, width - requestedX), layout.waveBottom - layout.waveTop);

  context.fillStyle = "rgba(215, 255, 87, 0.075)";
  context.fillRect(startX, layout.waveTop, Math.max(1, endX - startX), layout.waveBottom - layout.waveTop);
  if (requestedX > endX) {
    context.save();
    context.fillStyle = "rgba(255, 138, 106, 0.07)";
    context.fillRect(endX, layout.waveTop, requestedX - endX, layout.waveBottom - layout.waveTop);
    context.strokeStyle = "rgba(255, 138, 106, 0.42)";
    context.setLineDash([4, 4]);
    context.strokeRect(endX + 2.5, layout.waveTop + 2.5, Math.max(0, requestedX - endX - 5), layout.waveBottom - layout.waveTop - 5);
    context.restore();
  }

  context.strokeStyle = "rgba(255, 138, 106, 0.62)";
  context.lineWidth = 1;
  context.setLineDash([5, 5]);
  context.beginPath();
  context.moveTo(seamX + 0.5, layout.rulerBottom);
  context.lineTo(seamX + 0.5, layout.waveBottom + 9);
  context.stroke();
  context.setLineDash([]);

  const fadeInX = timeToX(resolved.start + resolved.fadeIn, layout);
  const fadeOutX = timeToX(resolved.end - resolved.fadeOut, layout);
  context.strokeStyle = "rgba(215, 255, 87, 0.82)";
  context.lineWidth = 1.4;
  context.beginPath();
  context.moveTo(startX, layout.waveBottom);
  context.lineTo(fadeInX, layout.waveTop + 3);
  context.lineTo(fadeOutX, layout.waveTop + 3);
  context.lineTo(endX, layout.waveBottom);
  context.stroke();

  context.fillStyle = "rgba(215, 255, 87, 0.06)";
  context.beginPath();
  context.moveTo(startX, layout.waveBottom);
  context.lineTo(fadeInX, layout.waveTop + 3);
  context.lineTo(fadeOutX, layout.waveTop + 3);
  context.lineTo(endX, layout.waveBottom);
  context.closePath();
  context.fill();

  drawHandle(context, startX, layout.waveBottom + 16, "#d7ff57", "START");
  drawHandle(context, requestedX, layout.waveBottom + 16, "#d7ff57", "END");
  drawHandle(context, fadeInX, layout.waveTop + 3, "#74e7bb", "IN");
  drawHandle(context, fadeOutX, layout.waveTop + 3, "#74e7bb", "OUT");

  context.save();
  context.font = "600 8px SFMono-Regular, Consolas, monospace";
  context.fillStyle = "rgba(255, 138, 106, 0.82)";
  context.textAlign = leftAlign(seamX, width);
  context.fillText("LOOP SEAM", seamX + (seamX > width - 90 ? -7 : 7), layout.rulerBottom - 4);
  if (requestedX > endX + 8) {
    const labelX = (endX + requestedX) / 2;
    context.fillStyle = "rgba(255, 138, 106, 0.92)";
    context.font = "600 8px SFMono-Regular, Consolas, monospace";
    context.fillText("PLAYBACK CUT", labelX, layout.waveTop - 8);
  }
  context.restore();

  waveView.handleHitboxes = [
    { type: "start", x: startX, y: layout.waveBottom + 16, radius: 15 },
    { type: "end", x: requestedX, y: layout.waveBottom + 16, radius: 15 },
    { type: "fadeIn", x: fadeInX, y: layout.waveTop + 3, radius: 13 },
    { type: "fadeOut", x: fadeOutX, y: layout.waveTop + 3, radius: 13 },
  ];
}

function leftAlign(x, width) {
  if (x > width - 95) return "right";
  return "left";
}

function roundedRectPath(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function drawKeyboard() {
  const { context, width, height } = setupCanvas(elements.keyboard);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(8, 11, 9, 0.56)";
  roundedRectPath(context, 0.5, 0.5, width - 1, height - 1, 10);
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.055)";
  context.stroke();

  const samples = state.config.samples;
  const horizontalPadding = Math.min(18, width * 0.03);
  const gap = Math.min(12, Math.max(4, width * 0.008));
  const available = width - horizontalPadding * 2 - gap * Math.max(0, samples.length - 1);
  const keyWidth = Math.min(122, available / Math.max(1, samples.length));
  const totalWidth = keyWidth * samples.length + gap * Math.max(0, samples.length - 1);
  const startX = (width - totalWidth) / 2;
  const keyTop = 13;
  const keyHeight = height - 27;

  keyboardHitboxes = samples.map((sample, index) => ({
    sampleId: sample.id,
    x: startX + index * (keyWidth + gap),
    y: keyTop,
    width: keyWidth,
    height: keyHeight,
  }));

  samples.forEach((sample, index) => {
    const hit = keyboardHitboxes[index];
    const resolved = resolveSample(sample, state.config.loopLength);
    const isActive = state.activeKey === sample.key || state.flashSampleId === sample.id;
    const isSelected = state.selectedId === sample.id;
    const accent = ["#d7ff57", "#74e7bb", "#8fb7ff", "#ff8a6a"][index % 4];

    context.save();
    context.fillStyle = isActive ? accent : "rgba(255, 255, 255, 0.026)";
    context.strokeStyle = isActive
      ? accent
      : isSelected
        ? "rgba(215, 255, 87, 0.52)"
        : "rgba(222, 235, 223, 0.14)";
    context.lineWidth = isSelected || isActive ? 1.2 : 1;
    roundedRectPath(context, hit.x + 0.5, hit.y + 0.5, hit.width - 1, hit.height - 1, 9);
    context.fill();
    context.stroke();

    context.fillStyle = isActive ? "rgba(9, 12, 8, 0.72)" : "rgba(205, 217, 207, 0.34)";
    context.font = "600 8px SFMono-Regular, Consolas, monospace";
    context.textAlign = "left";
    context.fillText(resolved.truncatedAtLoop ? "CUT" : "SMP", hit.x + 10, hit.y + 14);

    context.fillStyle = isActive ? "#101408" : accent;
    context.font = "700 20px SFMono-Regular, Consolas, monospace";
    context.textAlign = "center";
    context.fillText(sample.key, hit.x + hit.width / 2, hit.y + 39);

    context.fillStyle = isActive ? "rgba(11, 15, 9, 0.8)" : "rgba(224, 233, 223, 0.72)";
    context.font = "600 9px Avenir Next, Segoe UI, sans-serif";
    const maxNameWidth = hit.width - 16;
    let name = sample.name;
    if (context.measureText(name).width > maxNameWidth) {
      while (name.length > 2 && context.measureText(`${name}…`).width > maxNameWidth) name = name.slice(0, -1);
      name = `${name}…`;
    }
    context.fillText(name, hit.x + hit.width / 2, hit.y + hit.height - 15);
    context.restore();
  });
}

function waveformPointerPosition(event) {
  const rect = elements.waveform.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function hitWaveHandle(position) {
  let closest = null;
  let closestDistance = Infinity;
  for (const handle of waveView.handleHitboxes) {
    const distance = Math.hypot(position.x - handle.x, position.y - handle.y);
    if (distance <= handle.radius && distance < closestDistance) {
      closest = handle;
      closestDistance = distance;
    }
  }
  return closest;
}

function onWavePointerDown(event) {
  const position = waveformPointerPosition(event);
  const handle = hitWaveHandle(position);
  if (!handle) return;
  event.preventDefault();
  state.drag = { type: handle.type, pointerId: event.pointerId };
  elements.waveform.setPointerCapture(event.pointerId);
  elements.waveform.style.cursor = "grabbing";
}

function onWavePointerMove(event) {
  const position = waveformPointerPosition(event);
  if (!state.drag) {
    elements.waveform.style.cursor = hitWaveHandle(position) ? "grab" : "crosshair";
    return;
  }
  if (event.pointerId !== state.drag.pointerId) return;
  event.preventDefault();
  const sample = selectedSample();
  const time = xToTime(position.x, waveView);
  const resolved = resolveSample(sample, state.config.loopLength);

  if (state.drag.type === "start") {
    sample.start = clamp(time, 0, Math.max(0, resolved.requestedEnd - MIN_SAMPLE_DURATION));
    const duration = resolveSample(sample, state.config.loopLength).duration;
    sample.fadeIn = clamp(sample.fadeIn, 0, duration);
    sample.fadeOut = clamp(sample.fadeOut, 0, duration);
  }
  if (state.drag.type === "end") {
    sample.requestedEnd = clamp(
      time,
      resolved.start + MIN_SAMPLE_DURATION,
      state.config.loopLength + VIEW_OVERHANG,
    );
    const updated = resolveSample(sample, state.config.loopLength);
    sample.fadeIn = clamp(sample.fadeIn, 0, updated.duration);
    sample.fadeOut = clamp(sample.fadeOut, 0, updated.duration);
  }
  if (state.drag.type === "fadeIn") {
    sample.fadeIn = clamp(time - resolved.start, 0, Math.max(0, resolved.duration - resolved.fadeOut));
  }
  if (state.drag.type === "fadeOut") {
    sample.fadeOut = clamp(resolved.end - time, 0, Math.max(0, resolved.duration - resolved.fadeIn));
  }

  renderReadouts();
  drawWaveform();
}

function endWavePointerDrag(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) return;
  try {
    elements.waveform.releasePointerCapture(event.pointerId);
  } catch {
    // The pointer can already be released by the browser.
  }
  state.drag = null;
  elements.waveform.style.cursor = "crosshair";
  renderSampleList();
  drawWaveform();
}

function onKeyboardPointerDown(event) {
  const rect = elements.keyboard.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const hit = keyboardHitboxes.find((box) => (
    x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height
  ));
  if (!hit) return;
  const sample = state.config.samples.find((entry) => entry.id === hit.sampleId);
  if (sample) triggerSample(sample);
}

let audioContext = null;
let sourceBuffer = null;
let masterGain = null;
let activeVoices = [];
let keyHighlightTimer = 0;
let transportToken = 0;

function createLoopBuffer(context) {
  const buffer = context.createBuffer(
    1,
    Math.round(state.config.loopLength * context.sampleRate),
    context.sampleRate,
  );
  const pcm = context.sampleRate === state.config.sampleRate && sourcePcm.length === buffer.length
    ? sourcePcm
    : synthesizeDrumLoop(context.sampleRate, state.config.loopLength);
  buffer.copyToChannel(pcm, 0);
  return buffer;
}

function ensureAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio");
    audioContext = new AudioContextClass({ latencyHint: "interactive" });
    sourceBuffer = createLoopBuffer(audioContext);
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.82;
    masterGain.connect(audioContext.destination);
  }
  if (audioContext.state === "suspended") return audioContext.resume();
  return Promise.resolve();
}

function stopVoice(voice, when) {
  if (voice.stopped) return;
  voice.stopped = true;
  const stopAt = Math.max(when, audioContext.currentTime);
  const gain = voice.gain.gain;
  try {
    gain.cancelScheduledValues(stopAt);
    gain.setValueAtTime(gain.value, stopAt);
    gain.linearRampToValueAtTime(0, stopAt + PRIORITY_FADE_SECONDS);
    voice.source.stop(stopAt + PRIORITY_FADE_SECONDS + 0.001);
  } catch {
    // A voice may have ended between selection and stopping.
  }
}

function stopActiveVoices(when = audioContext?.currentTime || 0) {
  for (const voice of activeVoices) stopVoice(voice, when);
  activeVoices = activeVoices.filter((voice) => !voice.stopped);
}

function scheduleLiveVoice(sample) {
  const resolved = resolveSample(sample, state.config.loopLength);
  if (resolved.duration <= 0) return;
  const startAt = audioContext.currentTime + 0.004;
  stopActiveVoices(startAt);
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  source.buffer = sourceBuffer;
  source.connect(gain);
  gain.connect(masterGain);
  const voice = { source, gain, stopped: false, sampleId: sample.id };
  activeVoices.push(voice);
  source.onended = () => {
    activeVoices = activeVoices.filter((entry) => entry !== voice);
  };

  const fadeIn = Math.min(resolved.fadeIn, resolved.duration);
  const fadeOut = Math.min(resolved.fadeOut, resolved.duration);
  const fadeInEnd = startAt + fadeIn;
  const fadeOutStart = Math.max(fadeInEnd, startAt + resolved.duration - fadeOut);
  gain.gain.setValueAtTime(fadeIn > 0 ? 0 : 1, startAt);
  if (fadeIn > 0) gain.gain.linearRampToValueAtTime(1, fadeInEnd);
  if (fadeOut > 0) {
    gain.gain.setValueAtTime(1, fadeOutStart);
    gain.gain.linearRampToValueAtTime(0, startAt + resolved.duration);
  }
  source.start(startAt, resolved.start, resolved.duration);
}

function highlightTrigger(sample) {
  window.clearTimeout(keyHighlightTimer);
  state.activeKey = sample.key;
  state.flashSampleId = sample.id;
  drawKeyboard();
  document.querySelectorAll(".sample-card").forEach((card) => {
    card.classList.toggle("flash", Number(card.dataset.sampleId) === sample.id);
  });
  keyHighlightTimer = window.setTimeout(() => {
    state.activeKey = null;
    state.flashSampleId = null;
    drawKeyboard();
    document.querySelectorAll(".sample-card").forEach((card) => card.classList.remove("flash"));
  }, 220);
}

async function triggerSample(sample) {
  try {
    await ensureAudioContext();
    scheduleLiveVoice(sample);
    highlightTrigger(sample);
    const resolved = resolveSample(sample, state.config.loopLength);
    const suffix = resolved.truncatedAtLoop ? " · 接缝截断" : "";
    setIoStatus(`LIVE / ${sample.name.toUpperCase()} / ${formatTime(resolved.duration, 3)}S${suffix}`);
  } catch (error) {
    setIoStatus(`AUDIO ERROR / ${error.message}`, "error");
    showToast(error.message, true);
  }
}

function clearTransportTimers() {
  for (const timer of state.transport.timers || []) window.clearTimeout(timer);
  state.transport.timers = [];
  window.cancelAnimationFrame(state.transport.raf);
  state.transport.raf = 0;
}

function stopTransport({ resetClock = true } = {}) {
  transportToken += 1;
  state.transport.playing = false;
  clearTransportTimers();
  if (audioContext) stopActiveVoices(audioContext.currentTime);
  elements.transportDot.classList.remove("active");
  if (resetClock) elements.transportTime.textContent = "00.000";
}

function animateTransport() {
  if (!state.transport.playing) return;
  const elapsed = Math.max(0, audioContext.currentTime - state.transport.startedAt);
  elements.transportTime.textContent = formatTime(Math.min(elapsed, state.transport.duration));
  state.transport.raf = window.requestAnimationFrame(animateTransport);
}

async function playSequence() {
  try {
    await ensureAudioContext();
    stopTransport();
    const events = resolveSequence(state.config.sequence, state.config.samples, state.config.loopLength);
    if (events.length === 0) {
      showToast("音序为空，请先添加触发事件");
      return;
    }
    const token = ++transportToken;
    const startAt = audioContext.currentTime + 0.07;
    state.transport.playing = true;
    state.transport.startedAt = startAt;
    state.transport.duration = state.config.loopLength;
    state.transport.timers = [];
    elements.transportDot.classList.add("active");
    for (const event of events) {
      const delay = Math.max(0, (startAt + event.time - audioContext.currentTime) * 1000);
      const timer = window.setTimeout(() => {
        if (!state.transport.playing || token !== transportToken) return;
        scheduleLiveVoice(event.sample);
        highlightTrigger(event.sample);
        elements.transportTime.textContent = formatTime(event.time);
      }, delay);
      state.transport.timers.push(timer);
    }
    const finishTimer = window.setTimeout(() => {
      if (token !== transportToken) return;
      stopTransport();
      setIoStatus(`SEQUENCE END / ${events.length} EVENTS / PRIORITY ON`);
    }, Math.max(0, (startAt + state.config.loopLength - audioContext.currentTime) * 1000) + 20);
    state.transport.timers.push(finishTimer);
    animateTransport();
    elements.playButton.querySelector("span:last-child").textContent = "重新播放";
    setIoStatus(`SEQUENCE PLAY / ${events.length} EVENTS / LATEST WINS`);
  } catch (error) {
    stopTransport();
    setIoStatus(`AUDIO ERROR / ${error.message}`, "error");
    showToast(error.message, true);
  }
}

function scheduleOfflineSlice(context, destination, buffer, sample, eventTime, nextTime) {
  const resolved = resolveSample(sample, state.config.loopLength);
  if (resolved.duration <= 0) return null;
  const maxDuration = Math.max(0, Math.min(resolved.duration, nextTime - eventTime));
  if (maxDuration <= 0) return null;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  source.connect(gain);
  gain.connect(destination);
  const fadeIn = Math.min(resolved.fadeIn, maxDuration);
  const fadeOut = Math.min(resolved.fadeOut, maxDuration);
  const fadeInEnd = eventTime + fadeIn;
  const isChoked = maxDuration < resolved.duration - 1e-6;
  gain.gain.setValueAtTime(fadeIn > 0 ? 0 : 1, eventTime);
  if (fadeIn > 0) gain.gain.linearRampToValueAtTime(1, fadeInEnd);
  if (isChoked) {
    const chokeStart = Math.max(fadeInEnd, eventTime + maxDuration - PRIORITY_FADE_SECONDS);
    gain.gain.setValueAtTime(1, chokeStart);
    gain.gain.linearRampToValueAtTime(0, eventTime + maxDuration);
  } else if (fadeOut > 0) {
    const fadeOutStart = Math.max(fadeInEnd, eventTime + maxDuration - fadeOut);
    gain.gain.setValueAtTime(1, fadeOutStart);
    gain.gain.linearRampToValueAtTime(0, eventTime + maxDuration);
  }
  source.start(eventTime, resolved.start, maxDuration);
  return {
    sampleId: sample.id,
    start: eventTime,
    duration: maxDuration,
    choked: isChoked,
  };
}

async function renderOffline(config = state.config) {
  const normalized = normalizeConfig(config, state.config.sampleRate);
  const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineContext) throw new Error("当前浏览器不支持 OfflineAudioContext");
  const frameCount = Math.round(normalized.loopLength * normalized.sampleRate);
  const context = new OfflineContext(1, frameCount, normalized.sampleRate);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const pcm = synthesizeDrumLoop(context.sampleRate, normalized.loopLength);
  buffer.copyToChannel(pcm, 0);
  const master = context.createGain();
  master.gain.value = 0.82;
  master.connect(context.destination);
  const events = resolveSequence(normalized.sequence, normalized.samples, normalized.loopLength);
  const report = [];
  events.forEach((event, index) => {
    const nextTime = events[index + 1]?.time ?? normalized.loopLength;
    const item = scheduleOfflineSlice(
      context,
      master,
      buffer,
      event.sample,
      event.time,
      nextTime,
    );
    if (item) report.push(item);
  });
  const rendered = await context.startRendering();
  return {
    pcm: rendered.getChannelData(0),
    sampleRate: rendered.sampleRate,
    duration: rendered.duration,
    events: report,
    priorityCuts: report.filter((event) => event.choked).length,
  };
}

function addSample() {
  const current = selectedSample();
  const resolved = resolveSample(current, state.config.loopLength);
  const usedKeys = new Set(state.config.samples.map((sample) => sample.key));
  const nextKey = TRIGGER_KEYS.find((key) => !usedKeys.has(key));
  if (!nextKey) {
    showToast("可用触发键已耗尽", true);
    return;
  }
  const nextId = Math.max(...state.config.samples.map((sample) => sample.id), 0) + 1;
  state.config.samples.push({
    id: nextId,
    name: `Take ${String(nextId).padStart(2, "0")}`,
    start: resolved.start,
    requestedEnd: resolved.requestedEnd,
    fadeIn: resolved.fadeIn,
    fadeOut: resolved.fadeOut,
    key: nextKey,
  });
  state.selectedId = nextId;
  refreshInterface();
  showToast(`新增采样 ${nextId}，触发键 ${nextKey}`);
}

function exportConfig() {
  const payload = makeExportConfig(state.config);
  downloadJson(payload, "sampler-config.json");
  const truncatedCount = payload.samples.filter((sample) => sample.truncatedAtLoop).length;
  setIoStatus(`CONFIG EXPORT / ${payload.samples.length} SAMPLES / ${truncatedCount} SEAM CUTS`, "success");
  showToast("采样配置已导出为 sampler-config.json");
}

async function importConfig(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const imported = normalizeConfig(JSON.parse(text), state.config.sampleRate);
    state.config = imported;
    state.selectedId = imported.samples[0].id;
    sourcePcm = synthesizeDrumLoop(imported.sampleRate, imported.loopLength);
    waveView.peaks = [];
    waveView.peakWidth = 0;
    if (audioContext) sourceBuffer = createLoopBuffer(audioContext);
    stopTransport();
    refreshInterface();
    const truncatedCount = imported.samples.filter((sample) => sample.truncatedAtLoop).length;
    setIoStatus(`CONFIG LOAD / ${imported.samples.length} SAMPLES / ${truncatedCount} SEAM CUTS`, "success");
    showToast(`已载入 ${imported.samples.length} 段采样与 ${imported.sequence.length} 个事件`);
  } catch (error) {
    setIoStatus(`CONFIG ERROR / ${error.message}`, "error");
    showToast(`配置导入失败：${error.message}`, true);
  } finally {
    elements.configFileInput.value = "";
  }
}

async function rebuildAudio() {
  const button = elements.rebuildButton;
  if (button.disabled) return;
  button.disabled = true;
  setIoStatus("RENDER / BUILDING SEQUENCE FROM CONFIG…");
  try {
    const result = await renderOffline(makeExportConfig(state.config));
    downloadWav(result.pcm, result.sampleRate, "sequence.wav");
    const reached = Math.max(0, result.events.at(-1)?.start + result.events.at(-1)?.duration || 0);
    setIoStatus(
      `RENDER OK / ${formatTime(result.duration)}S / ${result.pcm.length} FRAMES / ${result.priorityCuts} PRIORITY CUTS`,
      "success",
    );
    showToast(`音序已重建：${formatTime(reached)}s 有声区间，${result.priorityCuts} 次抢占`);
  } catch (error) {
    setIoStatus(`RENDER ERROR / ${error.message}`, "error");
    showToast(`重建失败：${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

async function offlineSummary(config = state.config) {
  const result = await renderOffline(config);
  let peak = 0;
  let energy = 0;
  let firstNonZero = -1;
  let lastNonZero = -1;
  for (let index = 0; index < result.pcm.length; index += 1) {
    const value = result.pcm[index];
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
    if (Math.abs(value) > 1e-4) {
      if (firstNonZero < 0) firstNonZero = index;
      lastNonZero = index;
    }
  }
  const eventEnergy = result.events.map((event) => {
    const first = Math.round(event.start * result.sampleRate);
    const count = Math.round(event.duration * result.sampleRate);
    let sum = 0;
    for (let index = first; index < Math.min(result.pcm.length, first + count); index += 1) {
      sum += result.pcm[index] ** 2;
    }
    return Math.sqrt(sum / Math.max(1, count));
  });
  return {
    duration: result.duration,
    frames: result.pcm.length,
    sampleRate: result.sampleRate,
    peak,
    rms: Math.sqrt(energy / Math.max(1, result.pcm.length)),
    firstNonZero,
    lastNonZero,
    events: result.events,
    eventEnergy,
    priorityCuts: result.priorityCuts,
  };
}

function bindEvents() {
  elements.waveform.addEventListener("pointerdown", onWavePointerDown);
  elements.waveform.addEventListener("pointermove", onWavePointerMove);
  elements.waveform.addEventListener("pointerup", endWavePointerDrag);
  elements.waveform.addEventListener("pointercancel", endWavePointerDrag);
  elements.keyboard.addEventListener("pointerdown", onKeyboardPointerDown);

  elements.sampleList.addEventListener("click", (event) => {
    const select = event.target.closest('[data-action="key"]');
    const card = event.target.closest(".sample-card");
    if (!card) return;
    if (select) return;
    selectSample(Number(card.dataset.sampleId));
  });
  elements.sampleList.addEventListener("keydown", (event) => {
    const card = event.target.closest(".sample-card");
    if (!card || event.target.matches("select")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectSample(Number(card.dataset.sampleId));
    }
  });
  elements.sampleList.addEventListener("change", (event) => {
    const select = event.target.closest('[data-action="key"]');
    if (!select) return;
    const sample = state.config.samples.find((entry) => entry.id === Number(select.dataset.sampleId));
    if (!sample) return;
    const key = String(select.value).toUpperCase();
    if (state.config.samples.some((entry) => entry.id !== sample.id && entry.key === key)) {
      showToast(`触发键 ${key} 已被占用`, true);
      renderSampleList();
      return;
    }
    sample.key = key;
    renderSampleList();
    drawKeyboard();
    showToast(`${sample.name} → 触发键 ${key}`);
  });

  elements.playButton.addEventListener("click", playSequence);
  elements.stopButton.addEventListener("click", () => {
    stopTransport();
    setIoStatus("STOPPED / VOICES CLEARED");
  });
  elements.addSampleButton.addEventListener("click", addSample);
  elements.exportConfigButton.addEventListener("click", exportConfig);
  elements.importConfigButton.addEventListener("click", () => elements.configFileInput.click());
  elements.configFileInput.addEventListener("change", () => importConfig(elements.configFileInput.files[0]));
  elements.rebuildButton.addEventListener("click", rebuildAudio);

  document.addEventListener("keydown", (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.matches("input, select, textarea")) return;
    const key = event.key.toUpperCase();
    const sample = state.config.samples.find((entry) => entry.key === key);
    if (!sample) return;
    event.preventDefault();
    triggerSample(sample);
  });

  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(() => {
      drawWaveform();
      drawKeyboard();
    });
  });
}

window.__SEAM_SAMPLER__ = {
  getState: () => ({
    selectedId: state.selectedId,
    samples: state.config.samples.map((sample) => resolveSample(sample, state.config.loopLength)),
    sequence: state.config.sequence,
    loopLength: state.config.loopLength,
    transport: { ...state.transport, timers: undefined, raf: undefined },
  }),
  selectSample,
  cutSample: (id, patch) => {
    const sample = state.config.samples.find((entry) => entry.id === id);
    if (!sample) throw new Error(`采样 ${id} 不存在`);
    if ("start" in patch) sample.start = Number(patch.start);
    if ("end" in patch) sample.requestedEnd = Number(patch.end);
    if ("fadeIn" in patch) sample.fadeIn = Number(patch.fadeIn);
    if ("fadeOut" in patch) sample.fadeOut = Number(patch.fadeOut);
    state.selectedId = id;
    refreshInterface();
    return resolveSample(sample, state.config.loopLength);
  },
  triggerKey: (key) => {
    const sample = state.config.samples.find((entry) => entry.key === String(key).toUpperCase());
    if (sample) triggerSample(sample);
    return Boolean(sample);
  },
  playSequence,
  stop: () => stopTransport(),
  renderSummary: offlineSummary,
  renderOffline,
  getAudioState: () => ({
    contextState: audioContext?.state || "not-created",
    activeVoices: activeVoices.length,
    sourceFrames: sourceBuffer?.length || 0,
  }),
};

renderSampleList();
renderReadouts();
drawWaveform();
drawKeyboard();
bindEvents();




