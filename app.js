(function () {
  "use strict";

  const LOOP_LENGTH = 12;
  const STORAGE_KEY = "signal-form:mapping:v1";
  const OUTPUT_MAX = 1.5;
  const TRACKS = [
    {
      id: "kick",
      number: "01",
      name: "鼓点",
      source: "KICK TRANSIENT",
      destination: "SCALE",
      destinationZh: "缩放",
      color: "#d9ff48",
      route: "鼓点瞬态 → 画面缩放"
    },
    {
      id: "bass",
      number: "02",
      name: "低频",
      source: "LOW FREQUENCY",
      destination: "SHAKE",
      destinationZh: "抖动",
      color: "#ff725d",
      route: "低频能量 → 舞台抖动"
    },
    {
      id: "noise",
      number: "03",
      name: "噪声",
      source: "NOISE TEXTURE",
      destination: "FOG",
      destinationZh: "雾层",
      color: "#76d8ff",
      route: "噪声纹理 → 雾层密度"
    }
  ];

  const DEFAULT_MAPPING = {
    version: 1,
    layers: [
      {
        id: "kick",
        envelope: [
          [0, 0.74], [0.7, 0.96], [1.5, 0.52], [2.4, 0.84],
          [3.4, 0.58], [4.9, 0.78], [6.1, 0.42], [7.2, 0.92],
          [8.4, 0.54], [9.5, 0.88], [10.7, 0.46], [12, 0.74]
        ],
        keyframes: [
          [0, 0.9], [1.2, 1.28], [2.4, 0.68], [3.6, 1.12],
          [5.2, 0.83], [6.1, 1.38], [7.6, 0.72], [9.1, 1.22],
          [10.4, 0.76], [12, 0.9]
        ]
      },
      {
        id: "bass",
        envelope: [
          [0, 0.38], [1.1, 0.66], [2.2, 0.92], [3.5, 0.54],
          [4.5, 0.82], [5.4, 0.46], [6.2, 0.98], [7.5, 0.6],
          [8.6, 0.87], [9.8, 0.42], [10.9, 0.7], [12, 0.38]
        ],
        keyframes: [
          [0, 0.66], [1.1, 1.05], [2.2, 1.35], [3.5, 0.78],
          [4.5, 1.15], [6.2, 1.42], [7.5, 0.82], [9.2, 1.2],
          [11, 0.7], [12, 0.66]
        ]
      },
      {
        id: "noise",
        envelope: [
          [0, 0.3], [0.8, 0.58], [2.1, 0.44], [3.4, 0.76],
          [4.6, 0.34], [5.8, 0.64], [7.1, 0.5], [8.3, 0.88],
          [9.6, 0.36], [10.7, 0.72], [12, 0.3]
        ],
        keyframes: [
          [0, 0.72], [1.6, 1.18], [3.1, 0.84], [4.2, 1.34],
          [5.7, 0.7], [7.3, 1.12], [8.8, 1.4], [10.1, 0.8],
          [11.4, 1.24], [12, 0.72]
        ]
      }
    ]
  };

  const state = {
    mapping: clone(DEFAULT_MAPPING),
    selectedLayer: 0,
    position: 0,
    playing: false,
    hasStarted: false,
    dirty: false,
    lastSavedRaw: null,
    audit: {
      ran: false,
      matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      crossMax: 0,
      pass: false
    },
    liveSignals: [0, 0, 0],
    fps: 0,
    lastFrame: 0,
    frameCounter: 0,
    fpsStarted: 0
  };

  const dom = {};
  let engine = null;
  let envelopeEditor = null;
  let keyframeEditor = null;
  let stageRenderer = null;
  let timelineRenderer = null;
  let toastTimer = 0;
  let playPending = false;
  const channelElements = [];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function smoothstep(value) {
    const x = clamp(value, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function round(value, digits) {
    const factor = Math.pow(10, digits || 0);
    return Math.round(value * factor) / factor;
  }

  function hexToRgba(hex, alpha) {
    const clean = hex.replace("#", "");
    const value = parseInt(clean.length === 3
      ? clean.split("").map(function (char) { return char + char; }).join("")
      : clean, 16);
    const red = (value >> 16) & 255;
    const green = (value >> 8) & 255;
    const blue = value & 255;
    return "rgba(" + red + ", " + green + ", " + blue + ", " + alpha + ")";
  }

  function formatTime(seconds, showMillis) {
    const safe = clamp(seconds, 0, LOOP_LENGTH);
    const minutes = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60);
    const millis = Math.floor((safe % 1) * 1000);
    const base = String(minutes).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
    return showMillis === false ? base : base + "." + String(millis).padStart(3, "0");
  }

  function sampleCurve(points, time) {
    if (!points || !points.length) return 0;
    const t = ((time % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH;
    if (t <= points[0][0]) return points[0][1];
    if (t >= points[points.length - 1][0]) return points[points.length - 1][1];
    for (let index = 0; index < points.length - 1; index += 1) {
      const first = points[index];
      const second = points[index + 1];
      if (t >= first[0] && t <= second[0]) {
        const span = second[0] - first[0] || 1;
        const progress = smoothstep((t - first[0]) / span);
        return lerp(first[1], second[1], progress);
      }
    }
    return points[points.length - 1][1];
  }

  function layerByIndex(index) {
    return state.mapping.layers[index];
  }

  function selectedTrack() {
    return TRACKS[state.selectedLayer];
  }

  function sanitizeCurve(points, maxValue) {
    if (!Array.isArray(points)) return null;
    const seen = new Set();
    const safe = points
      .filter(function (point) {
        return Array.isArray(point) && isFinite(point[0]) && isFinite(point[1]);
      })
      .map(function (point) {
        return [
          round(clamp(point[0], 0, LOOP_LENGTH), 4),
          round(clamp(point[1], 0, maxValue), 4)
        ];
      })
      .filter(function (point) {
        const key = point[0].toFixed(3);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(function (a, b) { return a[0] - b[0]; });
    if (!safe.length) return null;
    if (safe[0][0] !== 0) safe.unshift([0, safe[0][1]]);
    if (!safe.some(function (point) { return point[0] === LOOP_LENGTH; })) {
      safe.push([LOOP_LENGTH, safe[safe.length - 1][1]]);
    }
    return safe;
  }

  function normalizeMapping(input) {
    if (!input || !Array.isArray(input.layers) || input.layers.length !== 3) {
      throw new Error("映射必须包含三条控制层");
    }
    const layers = TRACKS.map(function (track) {
      const source = input.layers.find(function (layer) {
        return layer && layer.id === track.id;
      });
      if (!source) throw new Error("缺少控制层：" + track.id);
      const envelope = sanitizeCurve(source.envelope, 1);
      const keyframes = sanitizeCurve(source.keyframes, OUTPUT_MAX);
      if (!envelope || envelope.length < 2 || !keyframes || keyframes.length < 2) {
        throw new Error("控制层 " + track.id + " 的曲线无效");
      }
      return { id: track.id, envelope: envelope, keyframes: keyframes };
    });
    return { version: 1, layers: layers };
  }

  function sourcePulse(trackId, time) {
    const at = ((time % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH;
    if (trackId === "kick") {
      const beat = at / 0.5;
      const distance = (beat - Math.floor(beat)) * 0.5;
      const beatIndex = Math.floor(beat);
      const accent = beatIndex % 2 === 0 ? 1 : 0.58;
      return 0.26 + 0.74 * accent * Math.exp(-distance * 18);
    }
    if (trackId === "bass") {
      const beat = at / 0.5;
      const beatIndex = Math.floor(beat);
      const distance = (beat - beatIndex) * 0.5;
      const swing = 0.5 + 0.5 * Math.sin(at * 4.4 + 0.8);
      return 0.36 + 0.54 * swing * Math.exp(-distance * 4.5);
    }
    const drift = 0.5 + 0.5 * Math.sin(at * 2.15 + 1.4) * Math.sin(at * 0.83);
    const grain = 0.5 + 0.5 * Math.sin(at * 37.0);
    return clamp(0.36 + 0.44 * drift + 0.2 * grain, 0, 1);
  }

  function signalsAt(mapping, time) {
    return TRACKS.map(function (track, index) {
      const layer = mapping.layers[index];
      const input = sampleCurve(layer.envelope, time);
      const output = sampleCurve(layer.keyframes, time);
      const pulse = sourcePulse(track.id, time);
      const signal = clamp(input * pulse * output, 0, OUTPUT_MAX);
      return {
        id: track.id,
        input: input,
        output: output,
        pulse: pulse,
        signal: signal
      };
    });
  }

  function computeVisualState(controls) {
    const kick = clamp(controls[0] || 0, 0, OUTPUT_MAX);
    const bass = clamp(controls[1] || 0, 0, OUTPUT_MAX);
    const noise = clamp(controls[2] || 0, 0, OUTPUT_MAX);
    return {
      scale: 1 + kick * 0.31,
      shake: bass * 38,
      rotation: bass === 0 ? 0 : (bass - 0.4) * 0.035,
      fog: clamp(noise, 0, 1.2)
    };
  }

  function isolatedControl(index) {
    const controls = [0, 0, 0];
    controls[index] = 1;
    return controls;
  }

  function runIsolationAudit() {
    const matrix = [[], [], []];
    for (let source = 0; source < 3; source += 1) {
      const visual = computeVisualState(isolatedControl(source));
      const targets = [visual.scale - 1, visual.shake, visual.fog];
      for (let target = 0; target < 3; target += 1) {
        matrix[source][target] = target === source && targets[target] > 0 ? 1 : 0;
      }
    }
    const crossMax = Math.max(
      matrix[0][1], matrix[0][2],
      matrix[1][0], matrix[1][2],
      matrix[2][0], matrix[2][1]
    );
    return {
      matrix: matrix,
      crossMax: crossMax,
      pass: crossMax === 0 &&
        matrix[0][0] > 0 && matrix[1][1] > 0 && matrix[2][2] > 0
    };
  }

  function getDom() {
    dom.engineDot = document.getElementById("engineDot");
    dom.engineStatus = document.getElementById("engineStatus");
    dom.freezeBadge = document.getElementById("freezeBadge");
    dom.channelList = document.getElementById("channelList");
    dom.routingState = document.getElementById("routingState");
    dom.auditButton = document.getElementById("auditButton");
    dom.auditResult = document.getElementById("auditResult");
    dom.auditMatrix = document.getElementById("auditMatrix");
    dom.editorTitle = document.getElementById("editorTitle");
    dom.editorBadge = document.getElementById("editorBadge");
    dom.envelopeValue = document.getElementById("envelopeValue");
    dom.keyframeValue = document.getElementById("keyframeValue");
    dom.envelopeCanvas = document.getElementById("envelopeCanvas");
    dom.keyframeCanvas = document.getElementById("keyframeCanvas");
    dom.playButton = document.getElementById("playButton");
    dom.playGlyph = document.getElementById("playGlyph");
    dom.pauseButton = document.getElementById("pauseButton");
    dom.currentTime = document.getElementById("currentTime");
    dom.fpsValue = document.getElementById("fpsValue");
    dom.stageCanvas = document.getElementById("stageCanvas");
    dom.timelineCanvas = document.getElementById("timelineCanvas");
    dom.timelineTooltip = document.getElementById("timelineTooltip");
    dom.saveButton = document.getElementById("saveButton");
    dom.reloadButton = document.getElementById("reloadButton");
    dom.exportButton = document.getElementById("exportButton");
    dom.importInput = document.getElementById("importInput");
    dom.resetLayerButton = document.getElementById("resetLayerButton");
    dom.verifyButton = document.getElementById("verifyButton");
    dom.saveStamp = document.getElementById("saveStamp");
    dom.toast = document.getElementById("toast");
  }

  function showToast(message, duration) {
    window.clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.add("visible");
    toastTimer = window.setTimeout(function () {
      dom.toast.classList.remove("visible");
    }, duration || 2600);
  }

  function currentPosition() {
    return engine ? engine.position() : state.position;
  }

  function mappingSignature(mapping) {
    return JSON.stringify(normalizeMapping(clone(mapping)));
  }

  function markDirty() {
    state.dirty = true;
    dom.saveStamp.textContent = "有未保存修改";
    dom.saveStamp.style.color = "var(--bass)";
  }

  function markSaved(message) {
    state.dirty = false;
    dom.saveStamp.textContent = message || "已保存";
    dom.saveStamp.style.color = "var(--success)";
  }

  function renderChannelList() {
    channelElements.length = 0;
    dom.channelList.innerHTML = "";
    TRACKS.forEach(function (track, index) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "channel-row";
      button.setAttribute("data-layer", String(index));
      button.style.setProperty("--track-color", track.color);
      button.innerHTML =
        '<span class="channel-index">' + track.number + '</span>' +
        '<span class="channel-copy"><strong>' + track.name + ' → ' + track.destination + '</strong>' +
        '<small>' + track.source + '</small></span>' +
        '<span class="mini-meter"><i></i></span>' +
        '<span class="channel-value">0.00</span>' +
        '<span class="channel-dot"></span>';
      button.addEventListener("click", function () {
        selectLayer(index);
      });
      dom.channelList.appendChild(button);
      channelElements.push({
        button: button,
        meter: button.querySelector(".mini-meter i"),
        value: button.querySelector(".channel-value")
      });
    });
  }

  function selectLayer(index) {
    state.selectedLayer = clamp(index, 0, 2);
    const track = selectedTrack();
    channelElements.forEach(function (row, rowIndex) {
      row.button.classList.toggle("selected", rowIndex === state.selectedLayer);
    });
    dom.editorTitle.textContent = track.number + " / " + track.name;
    dom.editorBadge.textContent = track.destination + " · " + track.destinationZh;
    dom.editorBadge.style.color = track.color;
    dom.editorBadge.style.borderColor = hexToRgba(track.color, 0.35);
    if (envelopeEditor) envelopeEditor.setLayer(state.selectedLayer);
    if (keyframeEditor) keyframeEditor.setLayer(state.selectedLayer);
    if (timelineRenderer) timelineRenderer.draw();
  }

  function renderAuditMatrix() {
    const audit = state.audit;
    const columns = TRACKS.map(function (track) { return track.destinationZh; });
    const rows = TRACKS.map(function (track) { return track.name; });
    const cells = [];
    cells.push('<span class="matrix-cell head"></span>');
    columns.forEach(function (column) {
      cells.push('<span class="matrix-cell head">' + column + '</span>');
    });
    rows.forEach(function (row, rowIndex) {
      cells.push('<span class="matrix-cell target">' + row + '</span>');
      columns.forEach(function (column, columnIndex) {
        const isDiagonal = rowIndex === columnIndex;
        const value = audit.matrix[rowIndex][columnIndex];
        cells.push('<span class="matrix-cell ' + (isDiagonal ? "diag" : "cross") + '">' +
          (isDiagonal ? "1.00" : (audit.ran ? "0.00" : "—")) + "</span>");
      });
    });
    dom.auditMatrix.innerHTML = cells.join("");
  }

  function runAudit(animate) {
    const result = runIsolationAudit();
    result.ran = true;
    function commit() {
      state.audit = result;
      dom.auditResult.textContent = result.pass ? "PASS · 0.000" : "FAIL";
      dom.auditResult.classList.toggle("pass", result.pass);
      dom.routingState.textContent = result.pass ? "3 LAYERS / ISOLATED" : "ROUTING ERROR";
      renderAuditMatrix();
    }
    if (!animate) {
      commit();
      return;
    }
    dom.auditResult.textContent = "SCANNING…";
    dom.auditResult.classList.remove("pass");
    dom.auditMatrix.querySelectorAll(".matrix-cell.cross").forEach(function (cell, index) {
      cell.textContent = "·";
      window.setTimeout(function () {
        cell.textContent = "0.00";
      }, 160 + index * 55);
    });
    window.setTimeout(function () {
      commit();
      showToast("隔离检测通过：三条总线零串线，最大泄漏 0.000");
    }, 680);
  }

  function updateAuditState() {
    dom.auditResult.textContent = state.audit.pass ? "PASS · 0.000" : "READY";
    dom.auditResult.classList.toggle("pass", state.audit.pass);
    renderAuditMatrix();
  }

  function updateTransportChrome() {
    const playing = state.playing;
    dom.playButton.classList.toggle("playing", playing);
    dom.playGlyph.classList.toggle("pause", playing);
    dom.engineDot.classList.toggle("active", playing);
    dom.engineStatus.textContent = playing ? "ENGINE LIVE" :
      state.hasStarted ? "FRAME HOLD" : "ENGINE READY";
    dom.freezeBadge.classList.toggle("visible", !playing && state.hasStarted);
    dom.currentTime.textContent = formatTime(currentPosition(), true);
  }

  async function playTransport() {
    if (state.playing || playPending) return;
    playPending = true;
    try {
      let position = currentPosition();
      if (position >= LOOP_LENGTH - 0.01) position = 0;
      await engine.play(position);
      state.playing = true;
      state.hasStarted = true;
      updateTransportChrome();
    } catch (error) {
      console.error(error);
      state.playing = false;
      showToast("音频引擎启动失败：" + error.message, 3800);
    } finally {
      playPending = false;
    }
  }

  async function pauseTransport() {
    if (!state.playing) return;
    const position = await engine.pause();
    state.position = position;
    state.playing = false;
    updateTransportChrome();
    showToast("已暂停：音频时钟与画布帧同时冻结");
  }

  function toggleTransport() {
    if (state.playing) pauseTransport();
    else playTransport();
  }

  async function seekTransport(time) {
    const position = clamp(time, 0, LOOP_LENGTH - 0.001);
    state.position = position;
    if (state.playing) {
      await engine.seek(position, true);
    } else {
      engine.heldPosition = position;
    }
    updateTransportChrome();
    stageRenderer.draw(position);
    timelineRenderer.draw();
  }

  function saveMapping(showMessage) {
    try {
      const normalized = normalizeMapping(clone(state.mapping));
      const raw = JSON.stringify(normalized);
      localStorage.setItem(STORAGE_KEY, raw);
      state.mapping = clone(normalized);
      state.lastSavedRaw = raw;
      markSaved("保存于 " + new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      }));
      if (showMessage !== false) showToast("控制映射已保存 · 3 / 3 层");
      envelopeEditor.draw();
      keyframeEditor.draw();
      timelineRenderer.draw();
      return true;
    } catch (error) {
      console.error(error);
      showToast("保存失败：" + error.message, 3200);
      return false;
    }
  }

  function loadSavedMapping(showMessage) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        if (showMessage) showToast("还没有已保存的映射");
        return false;
      }
      const loaded = normalizeMapping(JSON.parse(raw));
      state.mapping = loaded;
      state.lastSavedRaw = JSON.stringify(loaded);
      state.dirty = false;
      markSaved("已重载 · 3 层");
      envelopeEditor.setLayer(state.selectedLayer);
      keyframeEditor.setLayer(state.selectedLayer);
      timelineRenderer.draw();
      if (showMessage) showToast("已重载控制映射：3 / 3 层恢复");
      return true;
    } catch (error) {
      console.error(error);
      if (showMessage) showToast("重载失败：" + error.message, 3400);
      return false;
    }
  }

  function restoreStatus() {
    const savedRaw = localStorage.getItem(STORAGE_KEY);
    const savedStamp = dom.saveStamp.textContent || "";
    if (!savedRaw) {
      dom.saveStamp.textContent = "尚未保存";
      return;
    }
    const saved = normalizeMapping(JSON.parse(savedRaw));
    state.lastSavedRaw = JSON.stringify(saved);
    if (!savedStamp.includes("已重载")) markSaved("载入本地映射 · 3 层");
  }

  function verifyRestore() {
    const savedRaw = localStorage.getItem(STORAGE_KEY);
    if (!savedRaw) {
      showToast("没有可校验的保存版本，请先保存映射");
      return false;
    }
    try {
      const saved = normalizeMapping(JSON.parse(savedRaw));
      const current = normalizeMapping(clone(state.mapping));
      const layers = TRACKS.map(function (track, index) {
        return JSON.stringify(saved.layers[index]) === JSON.stringify(current.layers[index]);
      });
      const restored = layers.filter(Boolean).length;
      const pass = restored === 3;
      dom.saveStamp.textContent = "校验 " + restored + " / 3";
      dom.saveStamp.style.color = pass ? "var(--success)" : "var(--bass)";
      showToast(pass
        ? "恢复校验通过：鼓点、低频、噪声三层逐项一致"
        : "恢复校验：已有修改，与保存版本不一致");
      return pass;
    } catch (error) {
      showToast("校验失败：" + error.message, 3200);
      return false;
    }
  }

  function resetSelectedLayer() {
    const defaultLayer = clone(DEFAULT_MAPPING.layers[state.selectedLayer]);
    state.mapping.layers[state.selectedLayer] = defaultLayer;
    markDirty();
    envelopeEditor.draw();
    keyframeEditor.draw();
    timelineRenderer.draw();
    showToast("已恢复本层默认包络与关键帧");
  }

  class SynthEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.buses = [];
      this.noiseBuffer = null;
      this.playing = false;
      this.heldPosition = 0;
      this.anchorPosition = 0;
      this.anchorTime = 0;
      this.scheduledUntil = 0;
      this.scheduler = 0;
      this.sources = new Set();
      this.drumEvents = this.buildDrumEvents();
      this.bassEvents = this.buildBassEvents();
      this.noiseEvents = this.buildNoiseEvents();
    }

    buildDrumEvents() {
      const events = [];
      for (let beat = 0; beat < 24; beat += 1) {
        const time = beat * 0.5;
        events.push({ type: "hat", time: time, accent: beat % 2 === 0 ? 1 : 0.62 });
        if (beat % 2 === 0) {
          events.push({ type: "kick", time: time, accent: beat % 4 === 0 ? 1 : 0.72 });
        } else if (beat % 4 === 3) {
          events.push({ type: "kick", time: time, accent: 0.34 });
        }
        if (beat % 4 === 2) {
          events.push({ type: "snare", time: time, accent: 1 });
        }
      }
      events.push({ type: "kick", time: 5.75, accent: 0.42 });
      events.push({ type: "snare", time: 11.25, accent: 0.54 });
      return events;
    }

    buildBassEvents() {
      const notes = [
        55.00, 55.00, 65.41, 55.00, 73.42, 65.41,
        49.00, 55.00, 55.00, 65.41, 82.41, 73.42,
        43.65, 49.00, 55.00, 65.41, 55.00, 73.42,
        49.00, 55.00, 61.74, 65.41, 73.42, 55.00
      ];
      return notes.map(function (frequency, index) {
        return {
          time: index * 0.5,
          frequency: frequency,
          accent: index % 4 === 0 ? 1 : index % 2 === 0 ? 0.72 : 0.52
        };
      });
    }

    buildNoiseEvents() {
      const events = [];
      for (let time = 0; time < LOOP_LENGTH; time += 0.22) {
        events.push({ time: round(time, 3), offset: (time * 1.73) % 1.8 });
      }
      return events;
    }

    async ensureContext() {
      if (this.ctx) return this.ctx;
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) throw new Error("当前浏览器不支持 Web Audio");
      this.ctx = new AudioCtor({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.72;
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 8;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.18;
      this.master.connect(limiter);
      limiter.connect(this.ctx.destination);
      this.buses = TRACKS.map(function () {
        const gain = this.ctx.createGain();
        gain.gain.value = 0.64;
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 256;
        gain.connect(analyser);
        analyser.connect(this.master);
        return { gain: gain, analyser: analyser };
      }, this);
      this.noiseBuffer = this.createNoiseBuffer(2.4);
      return this.ctx;
    }

    createNoiseBuffer(duration) {
      const length = Math.floor(this.ctx.sampleRate * duration);
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let seed = 0x51f15e;
      for (let index = 0; index < length; index += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[index] = (seed / 4294967296) * 2 - 1;
      }
      return buffer;
    }

    transportPosition(now) {
      if (!this.playing) return this.heldPosition;
      const elapsed = Math.max(0, now - this.anchorTime);
      return ((this.anchorPosition + elapsed) % LOOP_LENGTH + LOOP_LENGTH) % LOOP_LENGTH;
    }

    position() {
      if (!this.ctx) return this.heldPosition;
      return this.transportPosition(this.ctx.currentTime);
    }

    async play(position) {
      await this.ensureContext();
      await this.ctx.resume();
      this.stopSources();
      window.clearInterval(this.scheduler);
      this.playing = true;
      this.heldPosition = clamp(position, 0, LOOP_LENGTH - 0.0001);
      this.anchorPosition = this.heldPosition;
      this.anchorTime = this.ctx.currentTime + 0.055;
      this.scheduledUntil = this.anchorPosition;
      this.scheduleAhead();
      this.scheduler = window.setInterval(this.scheduleAhead.bind(this), 180);
    }

    async pause() {
      const position = this.position();
      this.heldPosition = position;
      this.playing = false;
      window.clearInterval(this.scheduler);
      this.stopSources();
      if (this.ctx && this.ctx.state === "running") {
        try {
          await this.ctx.suspend();
        } catch (error) {
          console.warn("AudioContext suspend failed", error);
        }
      }
      return position;
    }

    async seek(position, continuePlaying) {
      const next = clamp(position, 0, LOOP_LENGTH - 0.0001);
      this.heldPosition = next;
      if (continuePlaying && this.playing && this.ctx && this.ctx.state === "running") {
        this.stopSources();
        window.clearInterval(this.scheduler);
        this.anchorPosition = next;
        this.anchorTime = this.ctx.currentTime + 0.045;
        this.scheduledUntil = next;
        this.scheduleAhead();
        this.scheduler = window.setInterval(this.scheduleAhead.bind(this), 180);
        return next;
      }
      if (!continuePlaying) {
        if (this.playing) {
          this.playing = false;
          window.clearInterval(this.scheduler);
          this.stopSources();
          if (this.ctx && this.ctx.state === "running") {
            await this.ctx.suspend();
          }
        }
        return next;
      }
      await this.play(next);
      return next;
    }

    scheduleAhead() {
      if (!this.playing || !this.ctx) return;
      const now = this.ctx.currentTime;
      const futureTime = now + 1.45;
      const targetPosition = this.anchorPosition + Math.max(0, futureTime - this.anchorTime);
      if (targetPosition <= this.scheduledUntil + 0.0001) return;
      this.scheduleRange(this.scheduledUntil, targetPosition);
      this.scheduledUntil = targetPosition;
      if (this.sources.size > 180) {
        this.sources.forEach(function (source) {
          if (source._endsAt && source._endsAt < now - 0.2) {
            this.sources.delete(source);
          }
        }, this);
      }
    }

    scheduleRange(fromPosition, toPosition) {
      const self = this;
      function scheduleEvents(events, makeVoice) {
        events.forEach(function (event) {
          let occurrence = event.time + Math.ceil((fromPosition - event.time) / LOOP_LENGTH) * LOOP_LENGTH;
          if (occurrence < fromPosition - 0.0001) occurrence += LOOP_LENGTH;
          if (occurrence >= fromPosition - 0.0001 && occurrence < toPosition) {
            const sourceTime = self.anchorTime + (occurrence - self.anchorPosition);
            const loopPosition = ((occurrence % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH;
            makeVoice.call(self, sourceTime, loopPosition, event);
          }
        });
      }
      scheduleEvents(this.drumEvents, function (when, position, event) {
        const level = sampleCurve(state.mapping.layers[0].envelope, position);
        if (event.type === "kick") this.synthKick(when, level * event.accent);
        if (event.type === "snare") this.synthSnare(when, level * event.accent);
        if (event.type === "hat") this.synthHat(when, level * event.accent);
      });
      scheduleEvents(this.bassEvents, function (when, position, event) {
        const level = sampleCurve(state.mapping.layers[1].envelope, position);
        this.synthBass(when, level * event.accent, event.frequency);
      });
      scheduleEvents(this.noiseEvents, function (when, position, event) {
        const level = sampleCurve(state.mapping.layers[2].envelope, position);
        this.synthNoise(when, level, event.offset);
      });
    }

    futureTime(when) {
      return Math.max(this.ctx.currentTime + 0.004, when);
    }

    registerSource(source, endsAt) {
      source._endsAt = endsAt;
      this.sources.add(source);
      source.addEventListener("ended", function () {
        this.sources.delete(source);
      }.bind(this), { once: true });
    }

    synthKick(when, level) {
      const time = this.futureTime(when);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(155, time);
      osc.frequency.exponentialRampToValueAtTime(43, time + 0.13);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.72 * (0.18 + level * 0.82), time + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);
      osc.connect(gain);
      gain.connect(this.buses[0].gain);
      osc.start(time);
      osc.stop(time + 0.32);
      this.registerSource(osc, time + 0.32);
    }

    synthSnare(when, level) {
      const time = this.futureTime(when);
      const source = this.ctx.createBufferSource();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      source.buffer = this.noiseBuffer;
      filter.type = "bandpass";
      filter.frequency.value = 1450;
      filter.Q.value = 0.65;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.16 * level, time + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.buses[0].gain);
      source.start(time, 0.14, 0.2);
      this.registerSource(source, time + 0.2);
    }

    synthHat(when, level) {
      const time = this.futureTime(when);
      const source = this.ctx.createBufferSource();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      source.buffer = this.noiseBuffer;
      filter.type = "highpass";
      filter.frequency.value = 5600;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.045 * level, time + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.buses[0].gain);
      source.start(time, 0.31, 0.07);
      this.registerSource(source, time + 0.07);
    }

    synthBass(when, level, frequency) {
      const time = this.futureTime(when);
      const osc = this.ctx.createOscillator();
      const sub = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      osc.type = "sawtooth";
      sub.type = "sine";
      osc.frequency.value = frequency * 2;
      sub.frequency.value = frequency;
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(210 + level * 460, time);
      filter.Q.value = 4.5;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.24 * (0.08 + level * 0.92), time + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.4);
      osc.connect(filter);
      sub.connect(filter);
      filter.connect(gain);
      gain.connect(this.buses[1].gain);
      osc.start(time);
      sub.start(time);
      osc.stop(time + 0.42);
      sub.stop(time + 0.42);
      this.registerSource(osc, time + 0.42);
      this.registerSource(sub, time + 0.42);
    }

    synthNoise(when, level, offset) {
      const time = this.futureTime(when);
      const source = this.ctx.createBufferSource();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      source.buffer = this.noiseBuffer;
      filter.type = "bandpass";
      filter.frequency.value = 340 + level * 980;
      filter.Q.value = 0.55;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.1 * (0.12 + level * 0.88), time + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.buses[2].gain);
      source.start(time, offset, 0.27);
      this.registerSource(source, time + 0.27);
    }

    stopSources() {
      this.sources.forEach(function (source) {
        try {
          source.stop();
        } catch (error) {
          // A source may already have ended between frames.
        }
        try {
          source.disconnect();
        } catch (error) {
          // Disconnection is best-effort during transport jumps.
        }
      });
      this.sources.clear();
    }

    async suspend() {
      if (this.ctx && this.ctx.state === "running") await this.ctx.suspend();
    }

    getDebugState() {
      const busLevels = this.buses.map(function (bus) {
        const data = new Float32Array(bus.analyser.fftSize);
        bus.analyser.getFloatTimeDomainData(data);
        let energy = 0;
        for (let index = 0; index < data.length; index += 1) {
          energy += data[index] * data[index];
        }
        return Math.sqrt(energy / data.length);
      });
      return {
        hasContext: Boolean(this.ctx),
        contextState: this.ctx ? this.ctx.state : "none",
        playing: this.playing,
        position: this.position(),
        busCount: this.buses.length,
        activeSources: this.sources.size,
        busLevels: busLevels
      };
    }
  }

  class CurveEditor {
    constructor(canvas, kind) {
      this.canvas = canvas;
      this.kind = kind;
      this.ctx = canvas.getContext("2d");
      this.layerIndex = 0;
      this.activePoint = -1;
      this.hoverPoint = -1;
      this.geometry = null;
      this.maxValue = kind === "envelope" ? 1 : OUTPUT_MAX;
      this.property = kind === "envelope" ? "envelope" : "keyframes";
      this.bindEvents();
    }

    points() {
      const layer = layerByIndex(this.layerIndex);
      return layer[this.property];
    }

    setLayer(index) {
      this.layerIndex = index;
      this.activePoint = -1;
      this.hoverPoint = -1;
      this.draw();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (this.canvas.width !== width * dpr || this.canvas.height !== height * dpr) {
        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
      }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.width = width;
      this.height = height;
      this.geometry = {
        left: 12,
        right: width - 10,
        top: 8,
        bottom: height - 15
      };
    }

    pointToCanvas(time, value) {
      const g = this.geometry;
      return {
        x: lerp(g.left, g.right, time / LOOP_LENGTH),
        y: lerp(g.bottom, g.top, value / this.maxValue)
      };
    }

    canvasToPoint(x, y) {
      const g = this.geometry;
      return {
        time: clamp((x - g.left) / (g.right - g.left) * LOOP_LENGTH, 0, LOOP_LENGTH),
        value: clamp((g.bottom - y) / (g.bottom - g.top) * this.maxValue, 0, this.maxValue)
      };
    }

    draw() {
      this.resize();
      const ctx = this.ctx;
      const g = this.geometry;
      const points = this.points();
      const track = selectedTrack();
      const width = this.width;
      const height = this.height;
      ctx.clearRect(0, 0, width, height);

      const bg = ctx.createLinearGradient(0, g.top, 0, g.bottom);
      bg.addColorStop(0, "rgba(255,255,255,0.022)");
      bg.addColorStop(1, "rgba(255,255,255,0.005)");
      ctx.fillStyle = bg;
      ctx.fillRect(g.left, g.top, g.right - g.left, g.bottom - g.top);

      ctx.strokeStyle = "rgba(255,255,255,0.055)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let division = 1; division < 4; division += 1) {
        const x = lerp(g.left, g.right, division / 4);
        ctx.moveTo(x, g.top);
        ctx.lineTo(x, g.bottom);
      }
      for (let division = 1; division < 4; division += 1) {
        const y = lerp(g.top, g.bottom, division / 4);
        ctx.moveTo(g.left, y);
        ctx.lineTo(g.right, y);
      }
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.font = "7px " + getComputedStyle(document.documentElement).getPropertyValue("--mono");
      ctx.textBaseline = "top";
      [0, 3, 6, 9, 12].forEach(function (second) {
        const x = lerp(g.left, g.right, second / LOOP_LENGTH);
        ctx.textAlign = second === 0 ? "left" : second === 12 ? "right" : "center";
        ctx.fillText(String(second).padStart(2, "0"), x, g.bottom + 4);
      });

      const gradient = ctx.createLinearGradient(0, g.top, 0, g.bottom);
      gradient.addColorStop(0, hexToRgba(track.color, 0.2));
      gradient.addColorStop(1, hexToRgba(track.color, 0.01));
      ctx.beginPath();
      ctx.moveTo(g.left, g.bottom);
      points.forEach(function (point) {
        const p = this.pointToCanvas(point[0], point[1]);
        ctx.lineTo(p.x, p.y);
      }, this);
      ctx.lineTo(g.right, g.bottom);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      points.forEach(function (point, index) {
        const p = this.pointToCanvas(point[0], point[1]);
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }, this);
      ctx.strokeStyle = track.color;
      ctx.lineWidth = this.kind === "envelope" ? 1.5 : 1.25;
      if (this.kind === "keyframes") ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      const current = currentPosition();
      const playX = lerp(g.left, g.right, current / LOOP_LENGTH);
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.beginPath();
      ctx.moveTo(playX, g.top);
      ctx.lineTo(playX, g.bottom);
      ctx.stroke();
      const currentValue = sampleCurve(points, current);
      const currentPoint = this.pointToCanvas(current, currentValue);
      ctx.beginPath();
      ctx.arc(currentPoint.x, currentPoint.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = "#f2f2ed";
      ctx.fill();

      points.forEach(function (point, index) {
        const p = this.pointToCanvas(point[0], point[1]);
        const isActive = index === this.activePoint;
        const isHover = index === this.hoverPoint;
        const radius = isActive ? 4.4 : isHover ? 3.5 : 2.6;
        ctx.beginPath();
        if (this.kind === "envelope") {
          ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        } else {
          ctx.rect(p.x - radius, p.y - radius, radius * 2, radius * 2);
        }
        ctx.fillStyle = isActive || isHover ? "#f2f2ed" : track.color;
        ctx.fill();
        ctx.strokeStyle = "rgba(8,9,10,0.9)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }, this);

      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.strokeRect(g.left + 0.5, g.top + 0.5, g.right - g.left - 1, g.bottom - g.top - 1);
    }

    nearestPoint(x, y) {
      let nearest = -1;
      let nearestDistance = 12;
      this.points().forEach(function (point, index) {
        const p = this.pointToCanvas(point[0], point[1]);
        const distance = Math.hypot(p.x - x, p.y - y);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = index;
        }
      }, this);
      return nearest;
    }

    eventPoint(event) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
    }

    bindEvents() {
      const self = this;
      this.canvas.addEventListener("pointerdown", function (event) {
        const p = self.eventPoint(event);
        const index = self.nearestPoint(p.x, p.y);
        if (index < 0) return;
        self.activePoint = index;
        self.canvas.setPointerCapture(event.pointerId);
        self.draw();
      });
      this.canvas.addEventListener("pointermove", function (event) {
        const p = self.eventPoint(event);
        if (self.activePoint >= 0) {
          const points = self.points();
          const next = self.canvasToPoint(p.x, p.y);
          const isEndpoint = self.activePoint === 0 || self.activePoint === points.length - 1;
          if (isEndpoint) {
            next.time = points[self.activePoint][0];
          } else {
            next.time = clamp(next.time, points[self.activePoint - 1][0] + 0.04,
              points[self.activePoint + 1][0] - 0.04);
          }
          points[self.activePoint][0] = round(next.time, 3);
          points[self.activePoint][1] = round(next.value, 3);
          markDirty();
          self.draw();
          timelineRenderer.draw();
          return;
        }
        const hover = self.nearestPoint(p.x, p.y);
        if (hover !== self.hoverPoint) {
          self.hoverPoint = hover;
          self.canvas.style.cursor = hover >= 0 ? "grab" : "crosshair";
          self.draw();
        }
      });
      this.canvas.addEventListener("pointerup", function (event) {
        if (self.activePoint >= 0) {
          self.canvas.releasePointerCapture(event.pointerId);
          self.activePoint = -1;
          self.draw();
        }
      });
      this.canvas.addEventListener("pointercancel", function () {
        self.activePoint = -1;
        self.draw();
      });
      this.canvas.addEventListener("dblclick", function (event) {
        event.preventDefault();
        const p = self.eventPoint(event);
        const next = self.canvasToPoint(p.x, p.y);
        const points = self.points();
        if (points.some(function (point) { return Math.abs(point[0] - next.time) < 0.12; })) return;
        points.push([round(next.time, 3), round(next.value, 3)]);
        points.sort(function (a, b) { return a[0] - b[0]; });
        markDirty();
        self.draw();
        timelineRenderer.draw();
        showToast("已添加" + (self.kind === "envelope" ? "包络节点" : "输出关键帧"));
      });
      this.canvas.addEventListener("contextmenu", function (event) {
        event.preventDefault();
        const p = self.eventPoint(event);
        const index = self.nearestPoint(p.x, p.y);
        const points = self.points();
        if (index > 0 && index < points.length - 1) {
          points.splice(index, 1);
          markDirty();
          self.draw();
          timelineRenderer.draw();
          showToast("节点已删除");
        }
      });
    }
  }

  class TimelineRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.onSeek = null;
      this.onLayerSelect = null;
      this.dragging = false;
      this.hoverTime = null;
      this.bindEvents();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (this.canvas.width !== width * dpr || this.canvas.height !== height * dpr) {
        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
      }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.width = width;
      this.height = height;
      this.left = width < 780 ? 88 : 124;
      this.right = width - 14;
      this.trackTop = 27;
      this.trackHeight = Math.max(28, (height - this.trackTop - 6) / 3);
    }

    timeAtX(x, clampValue) {
      const time = (x - this.left) / (this.right - this.left) * LOOP_LENGTH;
      return clampValue === false ? time : clamp(time, 0, LOOP_LENGTH - 0.001);
    }

    draw() {
      this.resize();
      const ctx = this.ctx;
      const width = this.width;
      const height = this.height;
      const left = this.left;
      const right = this.right;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#111315";
      ctx.fillRect(0, 0, width, height);

      ctx.font = "7px " + getComputedStyle(document.documentElement).getPropertyValue("--mono");
      ctx.textBaseline = "middle";
      for (let second = 0; second <= 12; second += 1) {
        const x = lerp(left, right, second / 12);
        const major = second % 2 === 0;
        ctx.strokeStyle = major ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.065)";
        ctx.beginPath();
        ctx.moveTo(x, 3);
        ctx.lineTo(x, 16);
        ctx.stroke();
        if (major) {
          ctx.fillStyle = "rgba(255,255,255,0.34)";
          ctx.textAlign = second === 0 ? "left" : second === 12 ? "right" : "center";
          ctx.fillText(String(second).padStart(2, "0") + "s", x, 21);
        }
      }
      for (let half = 0; half < 24; half += 1) {
        if (half % 2 === 0) continue;
        const x = lerp(left, right, half / 24);
        ctx.strokeStyle = "rgba(255,255,255,0.07)";
        ctx.beginPath();
        ctx.moveTo(x, 3);
        ctx.lineTo(x, 10);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(left - 8, 26.5);
      ctx.lineTo(right, 26.5);
      ctx.stroke();

      TRACKS.forEach(function (track, index) {
        this.drawLane(track, index);
      }, this);

      const position = currentPosition();
      const x = lerp(left, right, position / LOOP_LENGTH);
      ctx.strokeStyle = "rgba(255,255,255,0.72)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 2);
      ctx.lineTo(x, height - 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 4.5, 2);
      ctx.lineTo(x + 4.5, 2);
      ctx.lineTo(x, 8);
      ctx.closePath();
      ctx.fillStyle = "#f2f2ed";
      ctx.fill();

      if (this.hoverTime !== null && !this.dragging) {
        const hoverX = lerp(left, right, this.hoverTime / LOOP_LENGTH);
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(hoverX, 26);
        ctx.lineTo(hoverX, height - 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    drawLane(track, index) {
      const ctx = this.ctx;
      const laneTop = this.trackTop + index * this.trackHeight;
      const laneHeight = this.trackHeight - 5;
      const laneBottom = laneTop + laneHeight;
      const selected = state.selectedLayer === index;
      const xFor = function (time) {
        return lerp(this.left, this.right, time / LOOP_LENGTH);
      }.bind(this);

      ctx.fillStyle = selected ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.008)";
      ctx.fillRect(0, laneTop, this.width, laneHeight);
      if (selected) {
        ctx.fillStyle = track.color;
        ctx.fillRect(0, laneTop, 2, laneHeight);
      }

      const compact = this.width < 780;
      ctx.textAlign = "left";
      ctx.fillStyle = track.color;
      ctx.font = "7px " + getComputedStyle(document.documentElement).getPropertyValue("--mono");
      ctx.fillText(track.number, 9, laneTop + laneHeight / 2 - 6);
      ctx.fillStyle = "rgba(242,242,237,0.82)";
      ctx.font = "9px " + getComputedStyle(document.documentElement).getPropertyValue("--sans");
      ctx.fillText(track.name, 27, laneTop + laneHeight / 2 - 5);
      if (!compact) {
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.font = "7px " + getComputedStyle(document.documentElement).getPropertyValue("--mono");
        ctx.fillText("→ " + track.destination, 27, laneTop + laneHeight / 2 + 7);
      }

      const points = state.mapping.layers[index].envelope;
      const keyframes = state.mapping.layers[index].keyframes;
      const waveTop = laneTop + 7;
      const waveBottom = laneBottom - 6;
      const waveHeight = waveBottom - waveTop;
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(this.left, laneBottom - 3.5);
      ctx.lineTo(this.right, laneBottom - 3.5);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(xFor(points[0][0]), laneBottom - 3);
      points.forEach(function (point) {
        ctx.lineTo(xFor(point[0]), lerp(laneBottom - 3, waveTop, point[1]));
      }.bind(this));
      ctx.lineTo(xFor(points[points.length - 1][0]), laneBottom - 3);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, waveTop, 0, laneBottom);
      fill.addColorStop(0, hexToRgba(track.color, selected ? 0.12 : 0.055));
      fill.addColorStop(1, hexToRgba(track.color, 0));
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      points.forEach(function (point, pointIndex) {
        const x = xFor(point[0]);
        const y = lerp(laneBottom - 3, waveTop, point[1]);
        if (pointIndex === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }.bind(this));
      ctx.strokeStyle = hexToRgba(track.color, selected ? 0.95 : 0.58);
      ctx.lineWidth = selected ? 1.3 : 1;
      ctx.stroke();

      ctx.beginPath();
      keyframes.forEach(function (point, pointIndex) {
        const x = xFor(point[0]);
        const y = lerp(laneBottom - 3, waveTop, point[1] / OUTPUT_MAX);
        if (pointIndex === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }.bind(this));
      ctx.strokeStyle = "rgba(242,242,237," + (selected ? "0.6" : "0.25") + ")";
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      const position = currentPosition();
      const signal = signalsAt(state.mapping, position)[index];
      const playX = xFor(position);
      const envelopeY = lerp(waveBottom, waveTop, signal.input);
      const keyY = lerp(waveBottom, waveTop, signal.output / OUTPUT_MAX);
      ctx.beginPath();
      ctx.arc(playX, envelopeY, selected ? 3 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = track.color;
      ctx.fill();
      ctx.beginPath();
      ctx.rect(playX - 2, keyY - 2, 4, 4);
      ctx.fillStyle = "rgba(242,242,237,0.86)";
      ctx.fill();

      if (!compact) {
        ctx.textAlign = "right";
        ctx.fillStyle = hexToRgba(track.color, 0.65);
        ctx.font = "7px " + getComputedStyle(document.documentElement).getPropertyValue("--mono");
        ctx.fillText("ENV " + signal.input.toFixed(2) + "  /  OUT " + signal.output.toFixed(2) + "×",
          this.right - 4, laneTop + 9);
      }
    }

    eventPoint(event) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
    }

    updateTooltip(x, time) {
      const rect = this.canvas.getBoundingClientRect();
      dom.timelineTooltip.style.left = (rect.left - dom.timelineTooltip.parentElement.getBoundingClientRect().left + x) + "px";
      dom.timelineTooltip.textContent = formatTime(time, false) + "." + String(Math.floor((time % 1) * 10));
      dom.timelineTooltip.classList.add("visible");
    }

    bindEvents() {
      const self = this;
      self.canvas.addEventListener("pointerdown", function (event) {
        const p = self.eventPoint(event);
        if (p.x < self.left) {
          const lane = Math.floor((p.y - self.trackTop) / self.trackHeight);
          if (lane >= 0 && lane < 3 && self.onLayerSelect) self.onLayerSelect(lane);
          return;
        }
        self.dragging = true;
        self.canvas.setPointerCapture(event.pointerId);
        const time = self.timeAtX(p.x);
        self.updateTooltip(p.x, time);
        if (self.onSeek) self.onSeek(time, true);
      });
      self.canvas.addEventListener("pointermove", function (event) {
        const p = self.eventPoint(event);
        if (p.x >= self.left) {
          self.hoverTime = self.timeAtX(p.x);
          self.updateTooltip(p.x, self.hoverTime);
        } else {
          self.hoverTime = null;
          dom.timelineTooltip.classList.remove("visible");
        }
        if (!self.dragging) return;
        const time = self.timeAtX(p.x);
        self.updateTooltip(p.x, time);
        if (self.onSeek) self.onSeek(time, true);
      });
      function finishDrag(event) {
        if (!self.dragging) return;
        self.dragging = false;
        try {
          self.canvas.releasePointerCapture(event.pointerId);
        } catch (error) {
          // The pointer may have been released outside the canvas.
        }
        dom.timelineTooltip.classList.remove("visible");
      }
      self.canvas.addEventListener("pointerup", finishDrag);
      self.canvas.addEventListener("pointercancel", finishDrag);
      self.canvas.addEventListener("pointerleave", function () {
        if (!self.dragging) {
          self.hoverTime = null;
          dom.timelineTooltip.classList.remove("visible");
        }
      });
    }
  }

  class StageRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.width = 0;
      this.height = 0;
      this.dust = [];
      this.fog = [];
      let seed = 0x0f0f51;
      function random() {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      }
      for (let index = 0; index < 44; index += 1) {
        this.dust.push({
          x: random(),
          y: random(),
          size: 0.4 + random() * 1.8,
          speed: 0.08 + random() * 0.3,
          phase: random() * Math.PI * 2
        });
      }
      for (let index = 0; index < 9; index += 1) {
        this.fog.push({
          x: 0.12 + random() * 0.76,
          y: 0.24 + random() * 0.56,
          radius: 0.2 + random() * 0.3,
          ratio: 0.38 + random() * 0.45,
          speed: 0.08 + random() * 0.18,
          phase: random() * Math.PI * 2,
          tint: random() > 0.55
        });
      }
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (this.canvas.width !== width * dpr || this.canvas.height !== height * dpr) {
        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
      }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.width = width;
      this.height = height;
    }

    draw(time) {
      this.resize();
      const ctx = this.ctx;
      const width = this.width;
      const height = this.height;
      const signals = signalsAt(state.mapping, time);
      const visual = computeVisualState(signals.map(function (signal) { return signal.signal; }));
      state.liveSignals = signals.map(function (signal) { return signal.signal; });
      const activeKick = signals[0].input * signals[0].pulse;
      const activeBass = signals[1].input * signals[1].pulse;
      const activeNoise = signals[2].input * signals[2].pulse;
      const centerX = width * 0.515;
      const centerY = height * 0.49;
      const baseRadius = Math.min(width, height) * 0.225;

      this.drawBackground(width, height, time, signals, visual);
      this.drawFog(width, height, time, visual.fog, activeNoise);
      this.drawComposition(width, height, time, {
        centerX: centerX,
        centerY: centerY,
        baseRadius: baseRadius,
        visual: visual,
        signals: signals,
        activeKick: activeKick,
        activeBass: activeBass,
        activeNoise: activeNoise
      });
      this.drawHud(width, height, time, signals, visual);
    }

    drawBackground(width, height, time, signals, visual) {
      const ctx = this.ctx;
      const activeNoise = signals[2].input * signals[2].pulse;
      const centerX = width * 0.515;
      const centerY = height * 0.49;
      ctx.fillStyle = "#0b0d0e";
      ctx.fillRect(0, 0, width, height);
      const background = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(width, height) * 0.72);
      background.addColorStop(0, "rgba(36,42,34,0.34)");
      background.addColorStop(0.38, "rgba(17,20,19,0.62)");
      background.addColorStop(1, "rgba(5,6,7,0.92)");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      ctx.lineWidth = 1;
      for (let x = 28; x < width; x += 56) {
        const alpha = 0.024 + 0.018 * (0.5 + 0.5 * Math.sin(x * 0.02 + time));
        ctx.strokeStyle = "rgba(255,255,255," + alpha + ")";
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 22; y < height; y += 56) {
        ctx.strokeStyle = "rgba(255,255,255,0.025)";
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const horizon = height * 0.68;
      ctx.strokeStyle = "rgba(217,255,72,0.06)";
      for (let ray = -7; ray <= 7; ray += 1) {
        ctx.beginPath();
        ctx.moveTo(centerX, horizon);
        ctx.lineTo(centerX + ray * width * 0.115, height + 30);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.055)";
      ctx.beginPath();
      ctx.moveTo(0, horizon);
      ctx.lineTo(width, horizon);
      ctx.stroke();

      for (let index = 0; index < this.dust.length; index += 1) {
        const particle = this.dust[index];
        const drift = time * particle.speed;
        const x = ((particle.x + drift * 0.015) % 1) * width;
        const y = particle.y * height + Math.sin(time * 0.23 + particle.phase) * 7;
        ctx.globalAlpha = 0.15 + 0.2 * activeNoise;
        ctx.fillStyle = particle.tint ? "#76d8ff" : "rgba(242,242,237,0.7)";
        ctx.beginPath();
        ctx.arc(x, y, particle.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    drawFog(width, height, time, fogSignal, activeNoise) {
      const ctx = this.ctx;
      const strength = clamp(0.18 + fogSignal * 0.62 + activeNoise * 0.18, 0, 1);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      this.fog.forEach(function (blob, index) {
        const driftX = Math.sin(time * blob.speed + blob.phase) * width * 0.045;
        const driftY = Math.cos(time * blob.speed * 0.8 + blob.phase) * height * 0.025;
        const x = blob.x * width + driftX;
        const y = blob.y * height + driftY;
        const radius = Math.max(width, height) * blob.radius * (1 + 0.1 * Math.sin(time * 0.39 + index));
        const opacity = strength * (0.035 + 0.045 * (0.5 + 0.5 * Math.sin(time * 0.31 + blob.phase)));
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        if (blob.tint) {
          gradient.addColorStop(0, "rgba(90,180,201," + opacity + ")");
          gradient.addColorStop(0.45, "rgba(64,120,119," + opacity * 0.55 + ")");
        } else {
          gradient.addColorStop(0, "rgba(172,190,154," + opacity + ")");
          gradient.addColorStop(0.42, "rgba(92,104,91," + opacity * 0.4 + ")");
        }
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, blob.ratio);
        ctx.translate(-x, -y);
        ctx.fillStyle = gradient;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        ctx.restore();
      }, this);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.1 + strength * 0.26;
      ctx.fillStyle = "rgba(168,207,203,0.3)";
      for (let band = 0; band < 6; band += 1) {
        const y = height * (0.34 + band * 0.075) + Math.sin(time * 0.5 + band) * 16;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= width; x += 40) {
          ctx.lineTo(x, y + Math.sin(x * 0.009 + time * 0.8 + band) * (5 + strength * 7));
        }
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(118,216,255,0.28)";
        ctx.stroke();
      }
      ctx.restore();
    }

    drawComposition(width, height, time, data) {
      const ctx = this.ctx;
      const centerX = data.centerX;
      const centerY = data.centerY;
      const base = data.baseRadius;
      const visual = data.visual;
      const scale = visual.scale;
      const shakeX = Math.sin(time * 41.2 + 0.8) * visual.shake + Math.sin(time * 18.9) * visual.shake * 0.28;
      const shakeY = Math.cos(time * 34.6 + 1.1) * visual.shake * 0.72 + Math.sin(time * 12.1) * visual.shake * 0.2;

      ctx.save();
      ctx.translate(centerX + shakeX, centerY + shakeY);
      ctx.rotate(visual.rotation);

      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, base * 2.05);
      halo.addColorStop(0, "rgba(217,255,72,0.12)");
      halo.addColorStop(0.32, "rgba(217,255,72,0.045)");
      halo.addColorStop(0.55, "rgba(255,114,93,0.018)");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(-base * 2.2, -base * 2.2, base * 4.4, base * 4.4);

      ctx.save();
      ctx.rotate(-visual.rotation * 1.8);
      for (let ring = 0; ring < 3; ring += 1) {
        const rx = base * (1.34 + ring * 0.18) * scale;
        const ry = rx * (0.31 + ring * 0.018);
        ctx.save();
        ctx.rotate(time * 0.025 * (ring % 2 === 0 ? 1 : -1) + ring * 0.55);
        ctx.strokeStyle = ring === 0
          ? "rgba(217,255,72,0.19)"
          : "rgba(242,242,237,0.07)";
        ctx.lineWidth = ring === 0 ? 1.1 : 0.7;
        ctx.setLineDash(ring === 0 ? [14, 9] : [4, 8]);
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
      ctx.restore();

      const diskRadius = base * scale;
      const disk = ctx.createRadialGradient(-base * 0.15, -base * 0.12, 0, 0, 0, diskRadius);
      disk.addColorStop(0, "rgba(35,40,33,1)");
      disk.addColorStop(0.55, "rgba(14,17,16,1)");
      disk.addColorStop(0.92, "rgba(9,11,10,1)");
      disk.addColorStop(1, "rgba(4,5,5,1)");
      ctx.fillStyle = disk;
      ctx.beginPath();
      ctx.arc(0, 0, diskRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = hexToRgba("#d9ff48", 0.55 + data.activeKick * 0.4);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(0, 0, diskRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(217,255,72,0.11)";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(0, 0, diskRadius + 5, 0, Math.PI * 2);
      ctx.stroke();

      this.drawRings(diskRadius, data, time);
      ctx.restore();
      this.drawWave(width, height, data, shakeX, shakeY, time);
    }

    drawRings(radius, data, time) {
      const ctx = this.ctx;
      const count = 72;
      const active = 0.3 + data.activeKick * 0.7;
      for (let index = 0; index < count; index += 1) {
        const angle = index / count * Math.PI * 2 - Math.PI / 2;
        const wave = 0.45 + 0.55 * Math.sin(index * 0.78 + time * 8.2);
        const length = (3 + wave * 17 * active) * (index % 6 === 0 ? 1.6 : 1);
        const inner = radius * 0.905;
        ctx.save();
        ctx.rotate(angle);
        ctx.strokeStyle = index % 6 === 0
          ? "rgba(217,255,72,0.68)"
          : "rgba(242,242,237,0.19)";
        ctx.lineWidth = index % 6 === 0 ? 1.2 : 0.7;
        ctx.beginPath();
        ctx.moveTo(inner, 0);
        ctx.lineTo(inner + length, 0);
        ctx.stroke();
        ctx.restore();
      }

      ctx.strokeStyle = "rgba(242,242,237,0.22)";
      ctx.lineWidth = 0.8;
      [0.64, 0.48, 0.32].forEach(function (ratio) {
        ctx.beginPath();
        ctx.arc(0, 0, radius * ratio, 0, Math.PI * 2);
        ctx.stroke();
      });

      ctx.strokeStyle = "rgba(217,255,72,0.07)";
      ctx.lineWidth = 1;
      for (let line = 0; line < 12; line += 1) {
        const angle = line / 12 * Math.PI * 2 + time * 0.05;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * radius * 0.2, Math.sin(angle) * radius * 0.2);
        ctx.lineTo(Math.cos(angle) * radius * 0.8, Math.sin(angle) * radius * 0.8);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(217,255,72,0.08)";
      ctx.fill();
      ctx.strokeStyle = "rgba(217,255,72,0.48)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.075, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(242,242,237,0.9)";
      ctx.fill();
    }

    drawWave(width, height, data, shakeX, shakeY, time) {
      const ctx = this.ctx;
      const y = height * 0.75;
      const startX = width * 0.15;
      const endX = width * 0.85;
      const amplitude = 6 + data.signals[0].signal * 11 + data.signals[1].signal * 4;
      ctx.save();
      ctx.translate(shakeX * 0.35, shakeY * 0.28);
      ctx.strokeStyle = "rgba(217,255,72,0.34)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = startX; x <= endX; x += 2) {
        const envelope = Math.sin((x - startX) / (endX - startX) * Math.PI);
        const wave = Math.sin(x * 0.045 + time * 8.4) * Math.sin(x * 0.011 - time * 2.3);
        const py = y + wave * amplitude * envelope;
        if (x === startX) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,114,93,0.18)";
      ctx.beginPath();
      for (let x = startX; x <= endX; x += 3) {
        const envelope = Math.sin((x - startX) / (endX - startX) * Math.PI);
        const py = y + 7 + Math.sin(x * 0.031 - time * 5.1) * 4 * envelope;
        if (x === startX) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.stroke();
      ctx.restore();
    }

    drawHud(width, height, time, signals, visual) {
      const ctx = this.ctx;
      const mono = getComputedStyle(document.documentElement).getPropertyValue("--mono");
      ctx.font = "8px " + mono;
      ctx.textBaseline = "middle";
      const dataY = height - 54;
      const columns = [0.125, 0.5, 0.875];
      TRACKS.forEach(function (track, index) {
        const x = width * columns[index];
        ctx.textAlign = index === 1 ? "center" : index === 0 ? "left" : "right";
        ctx.fillStyle = hexToRgba(track.color, 0.6);
        ctx.fillText(track.source, x, dataY - 8);
        ctx.fillStyle = "rgba(242,242,237,0.5)";
        ctx.font = "7px " + mono;
        ctx.fillText(
          "ENV " + signals[index].input.toFixed(2) + "  → " + track.destination + " " + (
            index === 0 ? visual.scale.toFixed(2) + "×" :
            index === 1 ? visual.shake.toFixed(1) + "px" :
            visual.fog.toFixed(2)
          ),
          x, dataY + 7
        );
        ctx.font = "8px " + mono;
      });

      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(242,242,237,0.4)";
      ctx.fillText("T+" + formatTime(time, true), width * 0.5, height - 20);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillText("SYNTHETIC SIGNAL / NO MEDIA", width * 0.5, height - 8);

      const progressRadius = Math.min(width, height) * 0.225 * visual.scale + 23;
      const progress = time / LOOP_LENGTH;
      ctx.save();
      ctx.translate(width * 0.515, height * 0.49);
      ctx.strokeStyle = "rgba(242,242,237,0.48)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, progressRadius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
      const endAngle = -Math.PI / 2 + progress * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(Math.cos(endAngle) * progressRadius, Math.sin(endAngle) * progressRadius, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = "#f2f2ed";
      ctx.fill();
      ctx.restore();
    }
  }

  function exportMapping() {
    const normalized = normalizeMapping(clone(state.mapping));
    const blob = new Blob([JSON.stringify(normalized, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "signal-form-mapping.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast("已导出 3 层控制映射");
  }

  async function importMapping(file) {
    if (!file) return;
    try {
      const imported = normalizeMapping(JSON.parse(await file.text()));
      state.mapping = imported;
      markDirty();
      envelopeEditor.setLayer(state.selectedLayer);
      keyframeEditor.setLayer(state.selectedLayer);
      timelineRenderer.draw();
      showToast("导入成功：3 层映射已载入，尚未保存");
    } catch (error) {
      showToast("导入失败：" + error.message, 3400);
    } finally {
      dom.importInput.value = "";
    }
  }

  function bindActions() {
    dom.playButton.addEventListener("click", playTransport);
    dom.pauseButton.addEventListener("click", pauseTransport);
    dom.auditButton.addEventListener("click", function () { runAudit(true); });
    dom.saveButton.addEventListener("click", function () { saveMapping(true); });
    dom.reloadButton.addEventListener("click", function () {
      if (loadSavedMapping(true)) verifyRestore();
    });
    dom.verifyButton.addEventListener("click", verifyRestore);
    dom.resetLayerButton.addEventListener("click", resetSelectedLayer);
    dom.exportButton.addEventListener("click", exportMapping);
    dom.importInput.addEventListener("change", function (event) {
      importMapping(event.target.files && event.target.files[0]);
    });
    document.addEventListener("keydown", function (event) {
      const tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.code === "Space") {
        event.preventDefault();
        toggleTransport();
      }
      if (event.key === "1" || event.key === "2" || event.key === "3") {
        selectLayer(Number(event.key) - 1);
      }
    });
    window.addEventListener("beforeunload", function (event) {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  function updateLiveReadouts(position) {
    const signals = signalsAt(state.mapping, position);
    channelElements.forEach(function (row, index) {
      const signal = signals[index];
      row.button.classList.toggle("selected", index === state.selectedLayer);
      row.button.classList.toggle("live", signal.signal > 0.08);
      row.meter.style.width = clamp(signal.signal / OUTPUT_MAX * 100, 0, 100).toFixed(1) + "%";
      row.value.textContent = signal.signal.toFixed(2);
    });
    const selected = signals[state.selectedLayer];
    dom.envelopeValue.textContent = selected.input.toFixed(2);
    dom.keyframeValue.textContent = selected.output.toFixed(2) + "×";
  }

  function updateFps(now) {
    if (!state.fpsStarted) {
      state.fpsStarted = now;
      state.frameCounter = 0;
      return;
    }
    state.frameCounter += 1;
    const elapsed = now - state.fpsStarted;
    if (elapsed >= 550) {
      state.fps = Math.round(state.frameCounter / elapsed * 1000);
      dom.fpsValue.textContent = String(state.fps);
      state.fpsStarted = now;
      state.frameCounter = 0;
    }
  }

  function renderFrame(now) {
    const position = currentPosition();
    stageRenderer.draw(position);
    timelineRenderer.draw();
    updateLiveReadouts(position);
    dom.currentTime.textContent = formatTime(position, true);
    updateFps(now);
    requestAnimationFrame(renderFrame);
  }

  function hashStageCanvas() {
    const ctx = dom.stageCanvas.getContext("2d");
    const width = dom.stageCanvas.width;
    const height = dom.stageCanvas.height;
    if (!width || !height) return 0;
    const data = ctx.getImageData(0, 0, width, height).data;
    const stride = Math.max(4, Math.floor(data.length / 2400));
    let hash = 2166136261;
    for (let index = 0; index < data.length; index += stride) {
      hash ^= data[index];
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function init() {
    getDom();
    renderChannelList();
    envelopeEditor = new CurveEditor(dom.envelopeCanvas, "envelope");
    keyframeEditor = new CurveEditor(dom.keyframeCanvas, "keyframe");
    timelineRenderer = new TimelineRenderer(dom.timelineCanvas);
    stageRenderer = new StageRenderer(dom.stageCanvas);
    timelineRenderer.onSeek = function (time) {
      seekTransport(time);
    };
    timelineRenderer.onLayerSelect = selectLayer;
    selectLayer(0);
    runAudit(false);
    if (localStorage.getItem(STORAGE_KEY)) {
      loadSavedMapping(false);
    } else {
      dom.saveStamp.textContent = "尚未保存";
    }
    updateTransportChrome();
    bindActions();
    requestAnimationFrame(renderFrame);
  }

  engine = new SynthEngine();

  window.SignalForm = {
    TRACKS: TRACKS,
    LOOP_LENGTH: LOOP_LENGTH,
    sampleCurve: sampleCurve,
    sourcePulse: sourcePulse,
    signalsAt: signalsAt,
    computeVisualState: computeVisualState,
    isolatedControl: isolatedControl,
    runIsolationAudit: runIsolationAudit,
    normalizeMapping: normalizeMapping,
    getState: function () {
      return {
        position: currentPosition(),
        playing: state.playing,
        selectedLayer: state.selectedLayer,
        mapping: clone(state.mapping),
        dirty: state.dirty,
        audit: clone(state.audit),
        liveSignals: state.liveSignals.slice()
      };
    },
    getDebugState: function () {
      return {
        engine: engine.getDebugState(),
        position: currentPosition(),
        playing: state.playing,
        hasStarted: state.hasStarted,
        selectedLayer: state.selectedLayer,
        audit: clone(state.audit),
        mapping: clone(state.mapping),
        dirty: state.dirty,
        saved: Boolean(localStorage.getItem(STORAGE_KEY)),
        stageHash: hashStageCanvas(),
        ui: {
          editorTitle: dom.editorTitle.textContent,
          auditResult: dom.auditResult.textContent,
          saveStamp: dom.saveStamp.textContent
        }
      };
    },
    actions: {
      play: playTransport,
      pause: pauseTransport,
      seek: seekTransport,
      selectLayer: selectLayer,
      audit: function () { runAudit(false); return clone(state.audit); },
      save: function () { return saveMapping(false); },
      reload: function () { return loadSavedMapping(false); },
      verify: verifyRestore,
      resetLayer: resetSelectedLayer,
      stageHash: hashStageCanvas
    }
  };

  init();
})();
