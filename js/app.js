import {
  SAMPLE_RATE,
  MODULE_DEFINITIONS,
  DEFAULT_CHAIN,
  cloneChain,
  createModule,
  synthesizeTestRecording,
  renderChain as renderDspChain,
  detectClipping,
  encodeGuardedWav,
  chainFingerprint,
  computeSpectrum,
  analyzeSignal,
  findSpectralPeak,
  bufferFingerprint,
} from "./dsp.js";
import { ClippingError, inspectWav } from "./wav.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const waitFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const STORAGE_KEY = "phase302.savedChains.v1";
const PEAK_MARKERS = [
  { frequency: 50, label: "HUM 50", tolerance: 14 },
  { frequency: 150, label: "HARM 150", tolerance: 14 },
  { frequency: 1180, label: "NB-1 1.18K", tolerance: 28 },
  { frequency: 2950, label: "NB-2 2.95K", tolerance: 34 },
];

const state = {
  source: null,
  processed: null,
  sourceSpectrum: null,
  processedSpectrum: null,
  sourceAnalysis: null,
  processedAnalysis: null,
  sourceEnvelope: null,
  processedEnvelope: null,
  chain: cloneChain(DEFAULT_CHAIN),
  selectedId: "nb-1180",
  bypass: false,
  monitor: "B",
  playing: false,
  loop: true,
  playhead: 0,
  dspDirty: true,
  processTimer: null,
  previewFingerprint: "—",
  clipping: null,
  qa: null,
  audioContext: null,
  audioNode: null,
  audioBuffer: null,
  audioStartedAt: 0,
  audioStartOffset: 0,
  hoverFrequency: null,
  localPresets: [],
};

const dom = {
  chainList: $("#chainList"),
  chainCount: $("#chainCount"),
  inspectorTitle: $("#inspectorTitle"),
  inspectorType: $("#inspectorType"),
  inspectorSlot: $("#inspectorSlot"),
  inspectorState: $("#inspectorState"),
  inspectorControls: $("#inspectorControls"),
  spectrumCanvas: $("#spectrumCanvas"),
  waveformCanvas: $("#waveformCanvas"),
  playButton: $("#playButton"),
  loopButton: $("#loopButton"),
  bypassButton: $("#bypassButton"),
  resetButton: $("#resetButton"),
  exportButton: $("#exportButton"),
  exportStatus: $("#exportStatus"),
  exportButtonMeta: $("#exportButtonMeta"),
  qaSummary: $("#qaSummary"),
  qaLog: $("#qaLog"),
  qaRunButton: $("#runQaButton"),
  footerStatus: $("#footerStatus"),
  chainFingerprint: $("#chainFingerprint"),
  presetSelect: $("#presetSelect"),
};

function selectedModule() {
  return state.chain.find((module) => module.id === state.selectedId) ?? state.chain[0];
}

function formatFrequency(frequency) {
  if (frequency >= 1000) return `${(frequency / 1000).toFixed(frequency < 10000 ? 2 : 1)}k`;
  return `${Math.round(frequency)} Hz`;
}

function formatDb(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : value > 0 ? "+" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

function moduleSummary(module) {
  if (module.type === "gain") return `${formatDb(module.params.gain)} dB`;
  if (module.type === "gate") {
    return `${formatDb(module.params.threshold)} dB · ${formatDb(module.params.range)} dB`;
  }
  if (module.type === "peaking") {
    return `${formatFrequency(module.params.frequency)} · ${formatDb(module.params.gain)} dB`;
  }
  return `${formatFrequency(module.params.frequency)} · Q ${module.params.q.toFixed(1)}`;
}

function moduleGlyph(module) {
  return MODULE_DEFINITIONS[module.type]?.glyph ?? "FX";
}

function renderChain() {
  dom.chainList.innerHTML = "";
  state.chain.forEach((module, index) => {
    const selected = module.id === state.selectedId;
    const row = document.createElement("div");
    row.className = [
      "chain-module",
      selected ? "is-selected" : "",
      module.enabled ? "" : "is-disabled",
    ].filter(Boolean).join(" ");
    row.dataset.id = module.id;
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.innerHTML = `
      <span class="chain-index">${String(index + 1).padStart(2, "0")}</span>
      <span class="module-glyph ${module.type}">${moduleGlyph(module)}</span>
      <span class="chain-copy">
        <b>${module.name}</b>
        <span>${moduleSummary(module)}</span>
      </span>
      <button class="module-switch ${module.enabled ? "is-on" : ""}" data-toggle title="${module.enabled ? "Bypass" : "Enable"} module"></button>
    `;
    dom.chainList.append(row);
  });
  dom.chainCount.textContent = String(state.chain.length).padStart(2, "0");
  dom.chainFingerprint.textContent = chainFingerprint(state.chain);
}

function renderInspector() {
  const module = selectedModule();
  if (!module) {
    dom.inspectorControls.innerHTML = '<div class="empty-inspector">NO MODULE SELECTED</div>';
    return;
  }
  const index = state.chain.findIndex((item) => item.id === module.id);
  dom.inspectorTitle.textContent = module.name;
  dom.inspectorType.textContent = MODULE_DEFINITIONS[module.type]?.short ?? module.type.toUpperCase();
  dom.inspectorSlot.textContent = String(index + 1).padStart(2, "0");
  dom.inspectorState.classList.toggle("is-off", !module.enabled);
  dom.inspectorState.innerHTML = module.enabled
    ? '<i class="status-dot"></i> ACTIVE'
    : '<i class="status-dot" style="background:#ff8065"></i> BYPASSED';
  dom.inspectorControls.innerHTML = controlsForModule(module);
  $$("input[type=range]", dom.inspectorControls).forEach(updateRangeFill);
  $("#moveUpButton").disabled = index <= 0;
  $("#moveDownButton").disabled = index >= state.chain.length - 1;
}

function updateRangeFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const percent = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty("--fill", `${Math.max(0, Math.min(100, percent))}%`);
}

function rangeControl(key, label, min, max, step, value, unit = "", digits = 1, className = "") {
  const shown = Number(value).toFixed(digits);
  return `
    <div class="control-group ${className}">
      <div class="control-top">
        <label for="param-${key}">${label}</label>
        <output for="param-${key}" data-output="${key}">${shown} <small>${unit}</small></output>
      </div>
      <input id="param-${key}" type="range" data-key="${key}" data-unit="${unit}"
        data-digits="${digits}" min="${min}" max="${max}" step="${step}" value="${value}">
    </div>
  `;
}

function controlsForModule(module) {
  if (module.type === "gain") {
    return rangeControl("gain", "OUTPUT TRIM", -24, 24, 0.1, module.params.gain, "dB", 1);
  }
  if (module.type === "gate") {
    return [
      rangeControl("threshold", "THRESHOLD", -70, -10, 0.5, module.params.threshold, "dB", 1, "gate-control"),
      rangeControl("range", "DEPTH BELOW", -60, 0, 1, module.params.range, "dB", 0, "gate-control"),
      rangeControl("attack", "ATTACK", 1, 80, 1, module.params.attack, "ms", 0, "gate-control"),
      rangeControl("release", "RELEASE", 20, 500, 5, module.params.release, "ms", 0, "gate-control"),
    ].join("");
  }

  const controls = [
    rangeControl("frequency", "FREQUENCY", 20, 12000, 1, module.params.frequency, "Hz", 0),
    rangeControl("q", "Q / WIDTH", 0.1, 60, 0.1, module.params.q, "", 1),
  ];
  if (module.type === "peaking") {
    controls.push(rangeControl("gain", "GAIN", -18, 18, 0.1, module.params.gain, "dB", 1));
  }
  return controls.join("");
}

function selectModule(id) {
  state.selectedId = id;
  renderChain();
  renderInspector();
}

function updateSelectedParameter(key, value) {
  const module = selectedModule();
  if (!module) return;
  module.params[key] = Number(value);
  const output = $("output[data-output='" + key + "']", dom.inspectorControls);
  if (output) {
    const unit = output.querySelector("small")?.outerHTML ?? "";
    const digits = Number(output.closest(".control-group")?.querySelector("input")?.dataset.digits ?? 1);
    output.innerHTML = `${Number(value).toFixed(digits)} ${unit}`;
  }
  const row = $(`.chain-module[data-id="${module.id}"]`, dom.chainList);
  if (row) $(".chain-copy span", row).textContent = moduleSummary(module);
  dom.chainFingerprint.textContent = chainFingerprint(state.chain);
  scheduleDsp();
}

function scheduleDsp(delay = 55) {
  window.clearTimeout(state.processTimer);
  state.dspDirty = true;
  dom.footerStatus.textContent = "Parameter change queued · rendering updated 48 kHz preview";
  state.processTimer = window.setTimeout(() => renderPreview(), delay);
}

function buildEnvelope(rendered, bins = 1600) {
  const envelope = new Float32Array(bins * 2);
  const frameCount = rendered.frameCount;
  const channels = rendered.channels;
  for (let bin = 0; bin < bins; bin += 1) {
    const start = Math.floor(bin * frameCount / bins);
    const end = Math.max(start + 1, Math.floor((bin + 1) * frameCount / bins));
    let minimum = 1;
    let maximum = -1;
    for (let frame = start; frame < end; frame += 1) {
      for (let channel = 0; channel < channels.length; channel += 1) {
        const sample = channels[channel][frame];
        if (sample < minimum) minimum = sample;
        if (sample > maximum) maximum = sample;
      }
    }
    envelope[bin * 2] = minimum;
    envelope[bin * 2 + 1] = maximum;
  }
  return envelope;
}

function channelPeakDb(channel) {
  let peak = 0;
  for (let index = 0; index < channel.length; index += 1) {
    peak = Math.max(peak, Math.abs(channel[index]));
  }
  return 20 * Math.log10(Math.max(1e-9, peak));
}

function updateMetrics() {
  const source = state.sourceAnalysis;
  const output = state.processedAnalysis;
  if (!source || !output) return;
  const clipping = state.clipping;
  const lift = source.noiseFloorDb - output.noiseFloorDb;

  $("#metricPeak").textContent = formatDb(output.peakDb);
  $("#metricFloor").textContent = formatDb(output.noiseFloorDb);
  $("#metricSnr").textContent = output.snrDb.toFixed(1);

  $("#metricPeakNote").textContent = clipping.clipped ? "OVER 0 dBFS" : `${Math.max(0, output.headroomDb).toFixed(1)} dB HEADROOM`;
  $("#metricFloorNote").textContent = `${lift >= 0 ? "−" : "+"}${Math.abs(lift).toFixed(1)} dB ${lift >= 0 ? "LIFT" : "RISE"}`;
  $("#peakBar").style.setProperty("--level", `${Math.min(100, Math.max(2, (1 - Math.abs(output.peakDb) / 72) * 100))}%`);
  $("#floorBar").style.setProperty("--level", `${Math.min(100, Math.max(2, (1 - Math.abs(output.noiseFloorDb) / 90) * 100))}%`);
  $("#snrBar").style.setProperty("--level", `${Math.min(100, Math.max(2, output.snrDb / 60 * 100))}%`);

  const guardValue = $("#metricGuard");
  guardValue.textContent = clipping.clipped ? "TRIPPED" : "ARMED";
  guardValue.classList.toggle("is-tripped", clipping.clipped);
  $("#metricGuardNote").textContent = clipping.clipped
    ? `${clipping.clippedSamples.toLocaleString()} SAMPLES AT ≥ 0 dBFS`
    : `${Math.max(0, output.headroomDb).toFixed(1)} dB HEADROOM`;
  $("#guardBar").style.setProperty("--level", clipping.clipped ? "100%" : "62%");

  const setMeter = (element, db) => {
    const percent = Math.max(0.5, Math.min(100, (db + 48) / 48 * 100));
    element.style.width = `${percent}%`;
    element.style.backgroundSize = `${10000 / percent}% 100%`;
  };
  setMeter($("#meterL"), channelPeakDb(state.processed.channels[0]));
  setMeter($("#meterR"), channelPeakDb(state.processed.channels[1] ?? state.processed.channels[0]));
  $("#outputDb").textContent = `${formatDb(output.peakDb)} dB`;

  const status = $("#exportStatus");
  status.classList.toggle("is-error", clipping.clipped);
  if (clipping.clipped) {
    status.innerHTML = `<i class="status-dot"></i><span>Export blocked · ${clipping.clippedSamples.toLocaleString()} clipped sample(s) at ≥ 0 dBFS</span>`;
    dom.exportButton.classList.add("is-blocked");
    dom.exportButtonMeta.textContent = "CLIPPING · BLOCKED";
  } else {
    status.innerHTML = `<i class="status-dot"></i><span>Clipping guard armed · ${Math.max(0, output.headroomDb).toFixed(1)} dB headroom · buffer ${state.previewFingerprint}</span>`;
    dom.exportButton.classList.remove("is-blocked");
    dom.exportButtonMeta.textContent = "MATCHES PREVIEW";
  }
}

function renderPreview() {
  if (!state.source) return;
  window.clearTimeout(state.processTimer);
  const started = performance.now();
  const processed = renderDspChain(state.source, state.chain, { bypass: state.bypass });
  state.processed = processed;
  state.processedAnalysis = analyzeSignal(processed);
  state.processedSpectrum = computeSpectrum(processed, { fftSize: 2048, hop: 2048 });
  state.clipping = detectClipping(processed);
  state.previewFingerprint = bufferFingerprint(processed);
  state.processedEnvelope = buildEnvelope(processed);
  state.dspDirty = false;
  const elapsed = Math.round(performance.now() - started);
  updateMetrics();
  updateMarkers();
  drawSpectrum();
  drawWaveform();
  dom.footerStatus.textContent = `DSP settled in ${elapsed} ms · preview + export share buffer ${state.previewFingerprint}`;
  if (state.playing) refreshPlaybackBuffer();
}

function updateMarkers() {
  if (!state.sourceSpectrum) return;
  const row = $("#markerRow");
  row.innerHTML = "";
  for (const marker of PEAK_MARKERS) {
    const peak = findSpectralPeak(state.sourceSpectrum, marker.frequency, marker.tolerance);
    if (!peak) continue;
    const item = document.createElement("span");
    item.className = "marker";
    item.innerHTML = `<b>${marker.label}</b> ${formatFrequency(peak.frequency)} / ${formatDb(peak.db)} dB`;
    row.append(item);
  }
}

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  return { context, width: rect.width, height: rect.height };
}

function interpolatedDb(spectrum, frequency) {
  if (!spectrum) return -90;
  const exactBin = frequency * spectrum.fftSize / spectrum.sampleRate;
  const low = Math.floor(exactBin);
  const high = Math.min(spectrum.db.length - 1, low + 1);
  if (low < 0 || low >= spectrum.db.length) {
    return low < 0 ? -90 : spectrum.db[spectrum.db.length - 1];
  }
  const ratio = exactBin - low;
  return spectrum.db[low] * (1 - ratio) + spectrum.db[high] * ratio;
}

function drawSpectrum() {
  const fitted = fitCanvas(dom.spectrumCanvas);
  if (!fitted || !state.sourceSpectrum || !state.processedSpectrum) return;
  const { context: ctx, width, height } = fitted;
  const left = 38;
  const right = 12;
  const top = 12;
  const bottom = 24;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const minFrequency = 20;
  const maxFrequency = 20000;
  const minDb = -90;
  const maxDb = 0;
  const xForFrequency = (frequency) => left
    + Math.log10(Math.max(minFrequency, frequency) / minFrequency)
    / Math.log10(maxFrequency / minFrequency) * plotWidth;
  const frequencyForX = (x) => minFrequency
    * (maxFrequency / minFrequency) ** ((x - left) / plotWidth);
  const yForDb = (db) => top + (maxDb - Math.max(minDb, Math.min(maxDb, db)))
    / (maxDb - minDb) * plotHeight;

  ctx.fillStyle = "rgba(79, 126, 127, 0.04)";
  ctx.fillRect(left, top, plotWidth, plotHeight);

  ctx.save();
  ctx.strokeStyle = "rgba(115, 151, 152, 0.12)";
  ctx.lineWidth = 1;
  ctx.font = '7px "DM Mono", monospace';
  ctx.fillStyle = "rgba(108, 134, 135, 0.72)";
  const frequencyTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  for (const frequency of frequencyTicks) {
    const x = xForFrequency(frequency);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + plotHeight);
    ctx.stroke();
    const label = frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`;
    ctx.textAlign = frequency === 20 ? "left" : frequency === 20000 ? "right" : "center";
    ctx.fillText(label, x, height - 7);
  }
  ctx.textAlign = "right";
  for (const db of [0, -20, -40, -60, -80]) {
    const y = yForDb(db);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + plotWidth, y);
    ctx.stroke();
    ctx.fillText(`${db}`, left - 7, y + 2.5);
  }
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(105, 132, 133, 0.55)";
  ctx.fillText("dBFS", 6, top + 7);
  ctx.restore();

  const drawCurve = (spectrum, stroke, fill, dash = []) => {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash(dash);
    if (fill) {
      const gradient = ctx.createLinearGradient(0, top, 0, top + plotHeight);
      gradient.addColorStop(0, fill);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.moveTo(left, top + plotHeight);
      for (let x = 0; x <= plotWidth; x += 1) {
        ctx.lineTo(left + x, yForDb(interpolatedDb(spectrum, frequencyForX(left + x))));
      }
      ctx.lineTo(left + plotWidth, top + plotHeight);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }
    ctx.beginPath();
    for (let x = 0; x <= plotWidth; x += 1) {
      const y = yForDb(interpolatedDb(spectrum, frequencyForX(left + x)));
      if (x === 0) ctx.moveTo(left + x, y);
      else ctx.lineTo(left + x, y);
    }
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.restore();
  };

  drawCurve(state.sourceSpectrum, "rgba(123, 147, 153, 0.55)", "rgba(99, 126, 133, 0.10)", [3, 4]);
  ctx.save();
  ctx.shadowColor = "rgba(134, 239, 198, 0.32)";
  ctx.shadowBlur = 5;
  drawCurve(state.processedSpectrum, "rgba(134, 239, 198, 0.94)", "rgba(68, 197, 160, 0.12)");
  ctx.restore();

  if (state.processedAnalysis) {
    const floorY = yForDb(state.processedAnalysis.noiseFloorDb);
    ctx.save();
    ctx.strokeStyle = "rgba(240, 193, 99, 0.52)";
    ctx.setLineDash([2, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, floorY);
    ctx.lineTo(left + plotWidth, floorY);
    ctx.stroke();
    ctx.font = '7px "DM Mono", monospace';
    ctx.fillStyle = "rgba(240, 193, 99, 0.8)";
    ctx.textAlign = "right";
    ctx.fillText(`NF ${formatDb(state.processedAnalysis.noiseFloorDb)}`, left + plotWidth - 4, floorY - 4);
    ctx.restore();
  }

  for (const marker of PEAK_MARKERS) {
    const x = xForFrequency(marker.frequency);
    ctx.save();
    ctx.strokeStyle = "rgba(255, 128, 101, 0.19)";
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + plotHeight);
    ctx.stroke();
    const peak = findSpectralPeak(state.sourceSpectrum, marker.frequency, marker.tolerance);
    if (peak) {
      ctx.fillStyle = "rgba(255, 128, 101, 0.8)";
      ctx.beginPath();
      ctx.arc(x, yForDb(peak.db), 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (state.clipping?.clipped) {
    const shade = ctx.createLinearGradient(0, top, 0, top + plotHeight * 0.35);
    shade.addColorStop(0, "rgba(255, 80, 60, 0.20)");
    shade.addColorStop(1, "rgba(255, 80, 60, 0)");
    ctx.fillStyle = shade;
    ctx.fillRect(left, top, plotWidth, plotHeight * 0.35);
    ctx.fillStyle = "rgba(255, 128, 101, 0.95)";
    ctx.font = 'bold 8px "DM Mono", monospace';
    ctx.textAlign = "right";
    ctx.fillText("CLIP GUARD TRIPPED", left + plotWidth - 8, top + 13);
  }

  if (state.hoverFrequency !== null) {
    const x = xForFrequency(state.hoverFrequency);
    ctx.save();
    ctx.strokeStyle = "rgba(231, 239, 235, 0.32)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + plotHeight);
    ctx.stroke();
    ctx.fillStyle = "var(--mint)";
    ctx.restore();
  }
}

function drawEnvelope(ctx, envelope, left, top, width, height, fill, stroke, dash = []) {
  if (!envelope) return;
  const bins = envelope.length / 2;
  const center = top + height / 2;
  const amplitude = height / 2;
  const yFor = (sample) => center - sample * amplitude;
  ctx.save();
  ctx.setLineDash(dash);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < width; x += 1) {
    const bin = Math.min(bins - 1, Math.floor(x / width * bins));
    ctx.lineTo(left + x, yFor(envelope[bin * 2 + 1]));
  }
  ctx.strokeStyle = stroke;
  ctx.stroke();
  if (fill) {
    const gradient = ctx.createLinearGradient(0, top, 0, top + height);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.5, fill);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    for (let x = 0; x < width; x += 1) {
      const bin = Math.min(bins - 1, Math.floor(x / width * bins));
      ctx.lineTo(left + x, yFor(envelope[bin * 2 + 1]));
    }
    for (let x = width - 1; x >= 0; x -= 1) {
      const bin = Math.min(bins - 1, Math.floor(x / width * bins));
      ctx.lineTo(left + x, yFor(envelope[bin * 2]));
    }
    ctx.fillStyle = gradient;
    ctx.fill();
  }
  ctx.restore();
}

function drawWaveform() {
  const fitted = fitCanvas(dom.waveformCanvas);
  if (!fitted || !state.sourceEnvelope || !state.processedEnvelope || !state.source) return;
  const { context: ctx, width, height } = fitted;
  const left = 8;
  const right = 8;
  const top = 11;
  const bottom = 16;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const duration = state.source.duration;

  ctx.save();
  ctx.fillStyle = "rgba(92, 130, 129, 0.04)";
  ctx.fillRect(left, top, plotWidth, plotHeight);
  ctx.strokeStyle = "rgba(115, 151, 152, 0.12)";
  ctx.lineWidth = 1;
  ctx.font = '7px "DM Mono", monospace';
  ctx.fillStyle = "rgba(108, 134, 135, 0.68)";
  for (let second = 0; second <= duration; second += 1) {
    const x = left + second / duration * plotWidth;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + plotHeight);
    ctx.stroke();
    if (second < duration) ctx.fillText(`00:0${second}`, x + 3, height - 4);
  }
  ctx.strokeStyle = "rgba(115, 151, 152, 0.16)";
  ctx.beginPath();
  ctx.moveTo(left, top + plotHeight / 2);
  ctx.lineTo(left + plotWidth, top + plotHeight / 2);
  ctx.stroke();
  ctx.restore();

  drawEnvelope(
    ctx,
    state.sourceEnvelope,
    left,
    top,
    plotWidth,
    plotHeight * 0.92,
    "rgba(91, 113, 120, 0.10)",
    "rgba(112, 135, 142, 0.40)",
    [3, 4],
  );
  ctx.save();
  ctx.shadowColor = "rgba(134, 239, 198, 0.2)";
  ctx.shadowBlur = 3;
  drawEnvelope(
    ctx,
    state.processedEnvelope,
    left,
    top,
    plotWidth,
    plotHeight,
    "rgba(81, 205, 166, 0.11)",
    "rgba(134, 239, 198, 0.78)",
  );
  ctx.restore();

  if (state.clipping?.clipped) {
    ctx.fillStyle = "rgba(255, 85, 64, 0.08)";
    ctx.fillRect(left, top, plotWidth, plotHeight);
    ctx.fillStyle = "rgba(255, 128, 101, 0.95)";
    ctx.font = 'bold 8px "DM Mono", monospace';
    ctx.textAlign = "right";
    ctx.fillText("CLIPPED", left + plotWidth - 6, top + 12);
    ctx.textAlign = "left";
  }

  const playX = left + Math.max(0, Math.min(1, state.playhead / duration)) * plotWidth;
  ctx.save();
  ctx.strokeStyle = "rgba(201, 243, 107, 0.85)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(playX, top);
  ctx.lineTo(playX, top + plotHeight);
  ctx.stroke();
  ctx.fillStyle = "#c9f36b";
  ctx.beginPath();
  ctx.moveTo(playX - 3, top);
  ctx.lineTo(playX + 3, top);
  ctx.lineTo(playX, top + 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function monitoredRender() {
  return state.monitor === "A" || state.bypass ? state.source : state.processed;
}

async function ensureAudioContext() {
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is not available in this browser");
    state.audioContext = new AudioContextClass({ latencyHint: "interactive" });
  }
  if (state.audioContext.state === "suspended") await state.audioContext.resume();
  return state.audioContext;
}

function createAudioBuffer(rendered) {
  const buffer = state.audioContext.createBuffer(
    rendered.channels.length,
    rendered.frameCount,
    rendered.sampleRate,
  );
  rendered.channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
  return buffer;
}

function stopAudioNode() {
  if (!state.audioNode) return;
  state.audioNode.onended = null;
  try {
    state.audioNode.stop();
  } catch {
    // The node may already have stopped at the end of the buffer.
  }
  state.audioNode.disconnect();
  state.audioNode = null;
}

function startAudioNode(offset) {
  const rendered = monitoredRender();
  if (!rendered) return;
  stopAudioNode();
  state.audioBuffer = createAudioBuffer(rendered);
  const node = state.audioContext.createBufferSource();
  node.buffer = state.audioBuffer;
  node.loop = state.loop;
  node.connect(state.audioContext.destination);
  state.audioNode = node;
  state.audioStartedAt = state.audioContext.currentTime;
  state.audioStartOffset = Math.max(0, Math.min(rendered.duration - 0.001, offset));
  node.start(0, state.audioStartOffset);
  state.playing = true;
  dom.playButton.classList.add("is-playing");
  dom.playButton.setAttribute("aria-label", "Pause");
}

function currentPlayhead() {
  if (!state.playing || !state.audioContext) return state.playhead;
  const duration = state.source.duration;
  let value = state.audioStartOffset + state.audioContext.currentTime - state.audioStartedAt;
  if (state.loop) value %= duration;
  return Math.max(0, Math.min(duration, value));
}

async function togglePlayback() {
  if (state.playing) {
    state.playhead = currentPlayhead();
    stopAudioNode();
    state.playing = false;
    dom.playButton.classList.remove("is-playing");
    dom.playButton.setAttribute("aria-label", "Play");
    drawWaveform();
    return;
  }
  try {
    await ensureAudioContext();
    if (state.dspDirty) renderPreview();
    const proposal = state.playhead >= state.source.duration - 0.01 ? 0 : state.playhead;
    startAudioNode(proposal);
  } catch (error) {
    showToast("AUDIO UNAVAILABLE", error.message, true);
  }
}

function refreshPlaybackBuffer() {
  if (!state.playing || state.monitor === "A") return;
  const position = currentPlayhead();
  startAudioNode(position);
}

function seekTo(position) {
  const duration = state.source.duration;
  state.playhead = Math.max(0, Math.min(duration, position));
  if (state.playing) startAudioNode(state.playhead);
  updateTransport();
  drawWaveform();
}

function updateTransport() {
  if (!state.source) return;
  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
  };
  $("#currentTime").textContent = formatTime(state.playhead);
  $("#totalTime").textContent = formatTime(state.source.duration);
  $("#transportProgress").style.width = `${state.playhead / state.source.duration * 100}%`;
}

function setMonitor(monitor) {
  state.monitor = monitor;
  $$("[data-monitor]").forEach((button) => {
    const active = button.dataset.monitor === monitor;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (state.playing) {
    const position = currentPlayhead();
    stopAudioNode();
    state.playing = false;
    state.audioContext.resume().then(() => startAudioNode(position));
  }
  dom.footerStatus.textContent = monitor === "A"
    ? "Monitoring A · dry source, no processing"
    : "Monitoring B · processed preview buffer";
}

function toggleBypass() {
  state.bypass = !state.bypass;
  dom.bypassButton.classList.toggle("is-active", state.bypass);
  dom.bypassButton.setAttribute("aria-pressed", String(state.bypass));
  scheduleDsp(0);
  showToast(
    state.bypass ? "BYPASS ENGAGED" : "PROCESSING RESTORED",
    state.bypass ? "Monitor signal is now the dry source." : "Monitor signal returned to the chain.",
  );
}

function resetChain() {
  state.chain = cloneChain(DEFAULT_CHAIN);
  state.selectedId = "nb-1180";
  state.bypass = false;
  dom.bypassButton.classList.remove("is-active");
  dom.bypassButton.setAttribute("aria-pressed", "false");
  renderChain();
  renderInspector();
  scheduleDsp(0);
  setMonitor("B");
  showToast("CHAIN RESET", "Seven default repair stages restored · headroom guard armed.");
}

function showToast(title, message, error = false) {
  const toast = document.createElement("div");
  toast.className = `toast${error ? " error" : ""}`;
  toast.innerHTML = `<b>${title}</b>${message}`;
  $("#toastStack").append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportWav() {
  if (!state.source) return;
  if (state.dspDirty) renderPreview();
  const fingerprint = bufferFingerprint(state.processed);
  if (fingerprint !== state.previewFingerprint) {
    renderPreview();
  }

  try {
    const result = encodeGuardedWav(state.processed, { bitDepth: 24 });
    const info = inspectWav(result.bytes);
    if (!info.valid || info.channels !== 2 || Math.abs(info.duration - state.source.duration) > 1e-9) {
      throw new Error("WAV header failed duration or channel validation");
    }
    downloadBytes(result.bytes, "field-voice_repaired_48k_24bit_stereo.wav");
    dom.exportStatus.classList.remove("is-error");
    dom.exportStatus.innerHTML = `<i class="status-dot"></i><span>Exported ${info.duration.toFixed(3)} s · ${info.channels} ch · ${info.bitsPerSample}-bit · buffer ${fingerprint}</span>`;
    dom.exportButtonMeta.textContent = `${info.duration.toFixed(3)}s · ${info.channels} CH`;
    showToast(
      "WAV EXPORTED",
      `${info.duration.toFixed(3)} s · ${info.channels} channels · ${info.bitsPerSample}-bit · preview buffer match ${fingerprint}`,
    );
  } catch (error) {
    const clipping = error instanceof ClippingError ? error.info : detectClipping(state.processed);
    state.clipping = clipping;
    updateMetrics();
    drawSpectrum();
    drawWaveform();
    dom.exportButton.classList.add("is-blocked");
    dom.exportButtonMeta.textContent = "CLIPPING · BLOCKED";
    dom.exportStatus.classList.add("is-error");
    dom.exportStatus.innerHTML = `<i class="status-dot"></i><span>EXPORT BLOCKED · peak ${formatDb(clipping.peakDb)} dBFS · ${clipping.clippedSamples.toLocaleString()} clipped samples</span>`;
    showToast(
      "EXPORT BLOCKED",
      `No file was written. Peak ${formatDb(clipping.peakDb)} dBFS exceeds the 0 dBFS guard.`,
      true,
    );
  }
}

function setQaSummary(title, detail, passed = false) {
  dom.qaSummary.className = `qa-summary${passed ? " is-pass" : ""}`;
  dom.qaSummary.innerHTML = `<span class="qa-spinner"></span><div><b>${title}</b><span>${detail}</span></div>`;
}

function renderQa(report) {
  const passed = report.checks.filter((check) => check.pass).length;
  setQaSummary(
    `${passed} / ${report.checks.length} CHECKS PASS`,
    report.checks.every((check) => check.pass)
      ? "Default repair chain · shared renderer verified"
      : "One or more acceptance checks failed",
    report.checks.every((check) => check.pass),
  );
  dom.qaLog.innerHTML = report.checks.map((check) => (
    `<div title="${check.detail}"><span>${check.label}</span><b class="${check.pass ? "pass" : "fail"}">${check.pass ? "PASS" : "FAIL"} · ${check.value}</b></div>`
  )).join("");
}

async function runQa() {
  if (!state.source || dom.qaRunButton.disabled) return;
  dom.qaRunButton.disabled = true;
  setQaSummary("Running acceptance tests", "Offline render · same source and DSP core");
  dom.qaLog.innerHTML = `
    <div><span>DENOISE</span><b class="pending">RUNNING</b></div>
    <div><span>CLIP BLOCK</span><b class="pending">RUNNING</b></div>
    <div><span>WAV CHECK</span><b class="pending">RUNNING</b></div>`;
  await waitFrame();

  const started = performance.now();
  const clean = renderDspChain(state.source, cloneChain(DEFAULT_CHAIN));
  const cleanAnalysis = analyzeSignal(clean);
  const cleanClipping = detectClipping(clean);
  const sourceAnalysis = analyzeSignal(state.source);
  const lift = sourceAnalysis.noiseFloorDb - cleanAnalysis.noiseFloorDb;
  const denoisePass = lift >= 3 && !cleanClipping.clipped;

  const clippingChain = cloneChain(DEFAULT_CHAIN);
  const trim = clippingChain.find((module) => module.type === "gain");
  trim.params.gain = 18;
  trim.enabled = true;
  const clipped = renderDspChain(state.source, clippingChain);
  const clipping = detectClipping(clipped);
  let blocked = false;
  let rejection = null;
  try {
    encodeGuardedWav(clipped);
  } catch (error) {
    if (error instanceof ClippingError) {
      blocked = true;
      rejection = error.info;
    }
  }
  const clipPass = clipping.clipped && blocked;

  const exported = encodeGuardedWav(clean);
  const wav = inspectWav(exported.bytes);
  const wavPass = wav.valid
    && wav.channels === 2
    && wav.bitsPerSample === 24
    && wav.frames === state.source.frameCount
    && Math.abs(wav.duration - state.source.duration) < 1e-9;

  const report = {
    checks: [
      {
        label: "DENOISE",
        pass: denoisePass,
        value: `${formatDb(-lift)} dB`,
        detail: `Noise floor ${formatDb(sourceAnalysis.noiseFloorDb)} → ${formatDb(cleanAnalysis.noiseFloorDb)} dBFS; peak ${formatDb(cleanAnalysis.peakDb)} dBFS.`,
      },
      {
        label: "CLIP BLOCK",
        pass: clipPass,
        value: "+18 dB REJECTED",
        detail: `Injected peak ${formatDb(rejection?.peakDb ?? clipping.peakDb)} dBFS; ${clipping.clippedSamples.toLocaleString()} samples ≥ 0 dBFS; file write blocked.`,
      },
      {
        label: "WAV CHECK",
        pass: wavPass,
        value: `${wav.duration.toFixed(3)}s · ${wav.channels}CH`,
        detail: `PCM ${wav.bitsPerSample}-bit · ${wav.frames.toLocaleString()} frames · ${wav.sampleRate} Hz.`,
      },
    ],
    wav,
    cleaned: cleanAnalysis,
    clipping: rejection ?? clipping,
    elapsedMs: Math.round(performance.now() - started),
  };
  state.qa = report;
  renderQa(report);
  dom.qaRunButton.disabled = false;
  const allPass = report.checks.every((check) => check.pass);
  showToast(
    allPass ? "ACCEPTANCE PASS" : "ACCEPTANCE FAILED",
    `Noise floor ${formatDb(-lift)} dB · clipping blocked · WAV ${wav.duration.toFixed(3)} s / ${wav.channels} ch`,
    !allPass,
  );
}

function loadPresets() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    state.localPresets = Array.isArray(saved) ? saved : [];
  } catch {
    state.localPresets = [];
  }
  refreshPresetOptions();
}

function refreshPresetOptions(selected = "") {
  dom.presetSelect.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = state.localPresets.length ? "Select saved chain…" : "No saved chain";
  dom.presetSelect.append(empty);
  state.localPresets.forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    option.selected = preset.id === selected;
    dom.presetSelect.append(option);
  });
}

function saveCurrentChain() {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const name = `CHAIN ${String(state.localPresets.length + 1).padStart(2, "0")} · ${time}`;
  const preset = {
    id: `preset-${now.getTime()}`,
    name,
    createdAt: now.toISOString(),
    selectedId: state.selectedId,
    chain: cloneChain(state.chain),
  };
  state.localPresets.push(preset);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.localPresets));
    refreshPresetOptions(preset.id);
    showToast("CHAIN SAVED", `${name} · ${state.chain.length} modules · stored locally.`);
  } catch {
    state.localPresets.pop();
    showToast("SAVE FAILED", "Browser storage is unavailable for this session.", true);
  }
}

function restorePreset(id) {
  const preset = state.localPresets.find((item) => item.id === id);
  if (!preset) return;
  state.chain = cloneChain(preset.chain);
  state.selectedId = preset.chain.some((module) => module.id === preset.selectedId)
    ? preset.selectedId
    : state.chain[0]?.id;
  renderChain();
  renderInspector();
  scheduleDsp(0);
  showToast("CHAIN RESTORED", `${preset.name} · preview recalculated from the shared DSP path.`);
}

function toggleModule(id) {
  const module = state.chain.find((item) => item.id === id);
  if (!module) return;
  module.enabled = !module.enabled;
  renderChain();
  if (state.selectedId === id) renderInspector();
  scheduleDsp();
}

function moveSelected(direction) {
  const index = state.chain.findIndex((module) => module.id === state.selectedId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.chain.length) return;
  [state.chain[index], state.chain[target]] = [state.chain[target], state.chain[index]];
  renderChain();
  renderInspector();
  scheduleDsp();
}

function removeSelected() {
  if (state.chain.length <= 1) {
    showToast("CANNOT REMOVE", "The chain must contain at least one module.", true);
    return;
  }
  const index = state.chain.findIndex((module) => module.id === state.selectedId);
  if (index < 0) return;
  const [removed] = state.chain.splice(index, 1);
  state.selectedId = state.chain[Math.min(index, state.chain.length - 1)].id;
  renderChain();
  renderInspector();
  scheduleDsp();
  showToast("MODULE REMOVED", `${removed.name} was removed from the signal path.`);
}

function addModule(type) {
  const module = createModule(type);
  const outputIndex = state.chain.findIndex((item) => item.type === "gain");
  if (outputIndex >= 0 && type !== "gain") state.chain.splice(outputIndex, 0, module);
  else state.chain.push(module);
  state.selectedId = module.id;
  $("#addMenu").hidden = true;
  $("#addModuleButton").setAttribute("aria-expanded", "false");
  renderChain();
  renderInspector();
  scheduleDsp();
  showToast("MODULE ADDED", `${module.name} inserted before output trim.`);
}

function bindEvents() {
  dom.chainList.addEventListener("click", (event) => {
    const row = event.target.closest(".chain-module");
    if (!row) return;
    if (event.target.closest(".module-switch")) {
      toggleModule(row.dataset.id);
      return;
    }
    selectModule(row.dataset.id);
  });

  dom.chainList.addEventListener("keydown", (event) => {
    const row = event.target.closest(".chain-module");
    if (!row || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    selectModule(row.dataset.id);
  });

  dom.inspectorControls.addEventListener("input", (event) => {
    const input = event.target.closest("input[type=range]");
    if (!input) return;
    updateRangeFill(input);
    updateSelectedParameter(input.dataset.key, input.value);
  });

  $("#moveUpButton").addEventListener("click", () => moveSelected(-1));
  $("#moveDownButton").addEventListener("click", () => moveSelected(1));
  $("#removeButton").addEventListener("click", removeSelected);

  $("#addModuleButton").addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = $("#addMenu");
    menu.hidden = !menu.hidden;
    $("#addModuleButton").setAttribute("aria-expanded", String(!menu.hidden));
  });
  $("#addMenu").addEventListener("click", (event) => {
    const button = event.target.closest("[data-add]");
    if (button) addModule(button.dataset.add);
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest(".add-wrap")) return;
    $("#addMenu").hidden = true;
    $("#addModuleButton").setAttribute("aria-expanded", "false");
  });

  $$("[data-monitor]").forEach((button) => {
    button.addEventListener("click", () => setMonitor(button.dataset.monitor));
  });
  dom.bypassButton.addEventListener("click", toggleBypass);
  dom.resetButton.addEventListener("click", resetChain);
  dom.playButton.addEventListener("click", togglePlayback);
  dom.loopButton.addEventListener("click", () => {
    state.loop = !state.loop;
    dom.loopButton.classList.toggle("is-active", state.loop);
    dom.loopButton.setAttribute("aria-pressed", String(state.loop));
    if (state.audioNode) state.audioNode.loop = state.loop;
  });
  dom.exportButton.addEventListener("click", exportWav);
  dom.qaRunButton.addEventListener("click", runQa);
  $("#saveButton").addEventListener("click", saveCurrentChain);
  dom.presetSelect.addEventListener("change", (event) => restorePreset(event.target.value));

  dom.waveformCanvas.addEventListener("click", (event) => {
    if (!state.source) return;
    const rect = dom.waveformCanvas.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    seekTo(Math.max(0, Math.min(1, ratio)) * state.source.duration);
  });

  dom.spectrumCanvas.addEventListener("pointermove", (event) => {
    if (!state.processedSpectrum) return;
    const rect = dom.spectrumCanvas.getBoundingClientRect();
    const left = 38;
    const right = 12;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - left) / (rect.width - left - right)));
    const frequency = 20 * 1000 ** ratio;
    state.hoverFrequency = frequency;
    const db = interpolatedDb(state.processedSpectrum, frequency);
    const readout = $("#hoverReadout");
    readout.hidden = false;
    readout.style.left = `${Math.min(rect.width - 104, Math.max(44, event.clientX - rect.left + 10))}px`;
    readout.style.top = `${Math.max(8, event.clientY - rect.top - 44)}px`;
    $("#hoverFreq").textContent = formatFrequency(frequency);
    $("#hoverDb").textContent = `B ${formatDb(db)} dB`;
    drawSpectrum();
  });
  dom.spectrumCanvas.addEventListener("pointerleave", () => {
    state.hoverFrequency = null;
    $("#hoverReadout").hidden = true;
    drawSpectrum();
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.closest("input, select, textarea") || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape") {
      $("#addMenu").hidden = true;
      $("#addModuleButton").setAttribute("aria-expanded", "false");
      return;
    }
    if (event.target.closest("button")) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key.toLowerCase() === "a") {
      setMonitor("A");
    } else if (event.key.toLowerCase() === "b") {
      setMonitor("B");
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    drawSpectrum();
    drawWaveform();
  });
  resizeObserver.observe($(".workspace"));
}

function animationTick() {
  if (state.playing && state.source && state.audioContext) {
    const next = currentPlayhead();
    if (!state.loop && next >= state.source.duration - 0.002) {
      state.playhead = state.source.duration;
      stopAudioNode();
      state.playing = false;
      dom.playButton.classList.remove("is-playing");
      dom.playButton.setAttribute("aria-label", "Play");
    } else {
      state.playhead = next;
    }
    updateTransport();
    drawWaveform();
  }
  requestAnimationFrame(animationTick);
}

async function init() {
  bindEvents();
  loadPresets();
  renderChain();
  renderInspector();
  dom.qaRunButton.disabled = true;
  dom.footerStatus.textContent = "Synthesizing field capture · noise bed + 50 Hz hum + two narrowband carriers";
  await waitFrame();

  state.source = synthesizeTestRecording({ sampleRate: SAMPLE_RATE });
  state.sourceAnalysis = analyzeSignal(state.source);
  state.sourceSpectrum = computeSpectrum(state.source, { fftSize: 2048, hop: 2048 });
  state.sourceEnvelope = buildEnvelope(state.source);
  renderPreview();
  updateTransport();
  dom.qaRunButton.disabled = false;
  dom.footerStatus.textContent = "Capture ready · 8.000 s · 2 ch · 48 kHz · preview and export share one buffer";

  await waitFrame();
  runQa();
  requestAnimationFrame(animationTick);
}

init();
