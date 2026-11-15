(function () {
  "use strict";

  const Data = window.RadarData;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const FRAME_DURATION = 950;

  const elements = {
    canvas: $("#radar-canvas"),
    mapWrap: $("#map-wrap"),
    tooltip: $("#map-tooltip"),
    tooltipDbz: $("#tooltip-dbz"),
    tooltipLon: $("#tooltip-lon"),
    tooltipLat: $("#tooltip-lat"),
    tooltipDot: $("#tooltip-dot"),
    currentTime: $("#current-time"),
    currentDate: $("#current-date"),
    frameIndex: $("#frame-index"),
    frameSlider: $("#frame-slider"),
    timelineFill: $("#timeline-fill"),
    timelineTicks: $("#timeline-ticks"),
    playButton: $("#play-button"),
    prevButton: $("#prev-button"),
    nextButton: $("#next-button"),
    loopButton: $("#loop-button"),
    speedButtons: $$(".speed-control button"),
    playStatus: $("#play-status"),
    frameNote: $("#frame-note"),
    mapFootnote: $("#map-footnote"),
    dbzValue: $("#dbz-value"),
    echoState: $("#echo-state"),
    lonValue: $("#lon-value"),
    latValue: $("#lat-value"),
    gridValue: $("#grid-value"),
    classValue: $("#class-value"),
    scaleMarker: $("#scale-marker"),
    markButton: $("#mark-button"),
    modeBanner: $("#mode-banner"),
    anomalyCount: $("#anomaly-count"),
    anomalyEmpty: $("#anomaly-empty"),
    anomalyList: $("#anomaly-list"),
    exportButton: $("#export-button"),
    headerClock: $("#header-clock"),
    toast: $("#toast"),
    helpButton: $("#help-button"),
    helpPopover: $("#help-popover")
  };

  const state = {
    frameIndex: 0,
    playing: false,
    speed: 1,
    loop: true,
    markMode: false,
    pointer: null,
    markers: [],
    nextMarkerId: 1,
    accumulator: 0,
    lastFrameStep: 0
  };

  const renderer = new window.RadarMap(elements.canvas);
  let renderQueued = false;
  let toastTimer = 0;

  function currentFrame() {
    return Data.frames[state.frameIndex];
  }

  function currentMarkers() {
    return state.markers.filter((marker) => marker.frameIndex === state.frameIndex);
  }

  function scheduleRender() {
    if (renderQueued) {
      return;
    }
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderer.render({
        frame: currentFrame(),
        markers: currentMarkers(),
        hover: state.pointer,
        markMode: state.markMode
      });
    });
  }

  function showToast(message, warning) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle("is-warning", Boolean(warning));
    elements.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
  }

  function formatCoord(value, suffix) {
    return Number.isFinite(value) ? `${value.toFixed(3)}°${suffix}` : "--.---°";
  }

  function updateClock() {
    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    elements.headerClock.textContent = `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
  }

  function updateReadout(sample) {
    const dbz = sample && Number.isFinite(sample.dbz) ? sample.dbz : null;
    const classification = Data.classify(dbz);
    elements.dbzValue.textContent = dbz === null ? "--.-" : dbz.toFixed(1);
    elements.dbzValue.style.color = dbz === null ? "" : `rgb(${Data.colorForDbz(dbz).color.join(", ")})`;
    elements.echoState.textContent = dbz === null ? "无有效回波" : classification.label;
    elements.echoState.className = `echo-state ${classification.tone || ""}`.trim();
    elements.classValue.textContent = classification.label;
    elements.lonValue.textContent = sample ? formatCoord(sample.lon, "E") : "--.---°";
    elements.latValue.textContent = sample ? formatCoord(sample.lat, "N") : "--.---°";
    elements.gridValue.textContent = sample
      ? `${String(sample.col + 1).padStart(3, "0")} · ${String(sample.row + 1).padStart(3, "0")}`
      : "-- · --";
    elements.scaleMarker.style.opacity = dbz === null ? "0" : "1";
    if (dbz !== null) {
      elements.scaleMarker.style.left = `${Math.max(1, Math.min(99, ((dbz - 8) / 62) * 100))}%`;
    }
  }

  function positionTooltip(x, y) {
    const wrap = elements.mapWrap.getBoundingClientRect();
    const width = 152;
    const height = 82;
    let left = x + 17;
    let top = y + 17;
    if (left + width > wrap.width - 9) {
      left = x - width - 17;
    }
    if (top + height > wrap.height - 9) {
      top = y - height - 17;
    }
    elements.tooltip.style.left = `${Math.max(8, left)}px`;
    elements.tooltip.style.top = `${Math.max(8, top)}px`;
  }

  function updateTooltip(sample) {
    if (!sample || !state.pointer) {
      elements.tooltip.hidden = true;
      return;
    }
    const dbz = Number.isFinite(sample.dbz) ? sample.dbz : null;
    elements.tooltip.hidden = false;
    elements.tooltipDbz.textContent = dbz === null ? "—" : dbz.toFixed(1);
    elements.tooltipLon.textContent = formatCoord(sample.lon, "E");
    elements.tooltipLat.textContent = formatCoord(sample.lat, "N");
    elements.tooltipDot.style.background = dbz === null ? "#53676d" : `rgb(${Data.colorForDbz(dbz).color.join(", ")})`;
    positionTooltip(state.pointer.x, state.pointer.y);
  }

  function syncPointerSample() {
    if (!state.pointer) {
      updateReadout(null);
      elements.tooltip.hidden = true;
      return;
    }
    const sample = Data.sample(state.frameIndex, state.pointer.lon, state.pointer.lat);
    updateReadout(sample);
    updateTooltip(sample);
  }

  function updateTimeline() {
    const max = Data.FRAME_COUNT - 1;
    elements.frameSlider.value = String(state.frameIndex);
    elements.frameSlider.setAttribute("aria-valuetext", `${currentFrame().label}，第 ${state.frameIndex + 1} 帧`);
    elements.timelineFill.style.width = `${(state.frameIndex / max) * 100}%`;
    Array.from(elements.timelineTicks.children).forEach((tick, index) => {
      tick.classList.toggle("is-passed", index <= state.frameIndex);
    });
  }

  function updateFrameChrome() {
    const frame = currentFrame();
    elements.currentTime.textContent = frame.label;
    elements.currentDate.textContent = `${frame.date} CST`;
    elements.frameIndex.textContent = String(state.frameIndex + 1).padStart(2, "0");
    elements.frameNote.textContent = `第 ${String(state.frameIndex + 1).padStart(2, "0")} / ${Data.FRAME_COUNT} 帧 · 10 分钟间隔`;
    elements.mapFootnote.textContent = `当前帧 ${frame.label} · 光标读数已同步`;
    document.body.dataset.frame = String(state.frameIndex);
    elements.canvas.dataset.frame = frame.label;
  }

  function setFrame(index, options) {
    const settings = options || {};
    const last = Data.FRAME_COUNT - 1;
    let next = Number(index);
    if (!Number.isFinite(next)) {
      next = 0;
    }
    if (settings.wrap !== false) {
      next = ((next % Data.FRAME_COUNT) + Data.FRAME_COUNT) % Data.FRAME_COUNT;
    } else {
      next = Math.max(0, Math.min(last, next));
    }
    state.frameIndex = next;
    updateTimeline();
    updateFrameChrome();
    syncPointerSample();
    scheduleRender();
    window.dispatchEvent(new CustomEvent("radar-frame-change", { detail: { frameIndex: next, label: currentFrame().label } }));
  }

  function updatePlaybackUi() {
    elements.playButton.classList.toggle("is-playing", state.playing);
    elements.playButton.setAttribute("aria-label", state.playing ? "暂停回放" : "播放回放");
    elements.playStatus.textContent = state.playing ? `回放中 · ${state.speed}×` : "已暂停";
    elements.loopButton.classList.toggle("is-active", state.loop);
    elements.loopButton.setAttribute("aria-pressed", String(state.loop));
    document.body.dataset.playing = String(state.playing);
    document.body.dataset.speed = String(state.speed);
  }

  function setPlaying(playing) {
    if (playing && !state.loop && state.frameIndex === Data.FRAME_COUNT - 1) {
      setFrame(0, { wrap: false });
    }
    state.playing = playing;
    state.accumulator = 0;
    updatePlaybackUi();
  }

  function togglePlayback() {
    setPlaying(!state.playing);
  }

  function stepFrame(direction) {
    setPlaying(false);
    const last = Data.FRAME_COUNT - 1;
    let next = state.frameIndex + direction;
    if (next > last) {
      next = state.loop ? 0 : last;
    }
    if (next < 0) {
      next = state.loop ? last : 0;
    }
    setFrame(next, { wrap: false });
  }

  function animationLoop(timestamp) {
    if (!state.lastFrameStep) {
      state.lastFrameStep = timestamp;
    }
    const elapsed = Math.min(400, timestamp - state.lastFrameStep);
    state.lastFrameStep = timestamp;
    if (state.playing) {
      state.accumulator += elapsed * state.speed;
      let safety = 0;
      while (state.accumulator >= FRAME_DURATION && safety < 8) {
        state.accumulator -= FRAME_DURATION;
        safety += 1;
        const isLast = state.frameIndex === Data.FRAME_COUNT - 1;
        if (isLast && !state.loop) {
          setPlaying(false);
          break;
        }
        setFrame(state.frameIndex + 1);
      }
    }
    requestAnimationFrame(animationLoop);
  }

  function pointerFromEvent(event) {
    const rect = elements.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      return null;
    }
    const geo = renderer.screenToGeo(x, y, rect.width, rect.height);
    return {
      x,
      y,
      lon: geo.lon,
      lat: geo.lat,
      sample: Data.sample(state.frameIndex, geo.lon, geo.lat)
    };
  }

  function handlePointerMove(event) {
    const point = pointerFromEvent(event);
    if (!point) {
      return;
    }
    state.pointer = { x: point.x, y: point.y, lon: point.lon, lat: point.lat };
    updateReadout(point.sample);
    updateTooltip(point.sample);
    scheduleRender();
  }

  function clearPointer() {
    state.pointer = null;
    elements.tooltip.hidden = true;
    updateReadout(null);
    scheduleRender();
  }

  function addMarker(sample) {
    const duplicate = state.markers.find((marker) =>
      marker.frameIndex === state.frameIndex && marker.col === sample.col && marker.row === sample.row
    );
    if (duplicate) {
      showToast(`单元 ${duplicate.id} 已在当前帧标记`, true);
      return null;
    }
    const id = `A-${String(state.nextMarkerId).padStart(2, "0")}`;
    state.nextMarkerId += 1;
    const marker = {
      id,
      frameIndex: state.frameIndex,
      frameLabel: currentFrame().label,
      col: sample.col,
      row: sample.row,
      lon: Data.lonAt(sample.col),
      lat: Data.latAt(sample.row),
      dbz: sample.dbz
    };
    state.markers.push(marker);
    renderAnomalyList();
    scheduleRender();
    return marker;
  }

  function markCurrentSample(sample) {
    if (!sample || !Number.isFinite(sample.dbz)) {
      showToast("该位置没有有效回波，请选择雨云单元", true);
      return false;
    }
    const marker = addMarker(sample);
    if (!marker) {
      return false;
    }
    setMarkMode(false);
    showToast(`${marker.id} 已标记 · ${marker.dbz.toFixed(1)} dBZ · ${marker.frameLabel}`);
    return true;
  }

  function setMarkMode(active) {
    if (active && state.playing) {
      setPlaying(false);
    }
    state.markMode = active;
    elements.markButton.classList.toggle("is-active", active);
    elements.markButton.setAttribute("aria-pressed", String(active));
    elements.mapWrap.classList.toggle("mark-active", active);
    elements.modeBanner.hidden = !active;
    const title = elements.markButton.querySelector("strong");
    const hint = elements.markButton.querySelector("small");
    title.textContent = active ? "点击地图选择单元" : "标记当前单元";
    hint.textContent = active ? "再次点击按钮可退出标记模式" : "进入地图选点模式";
    if (active) {
      showToast("标记模式已开启，请点击有回波的地图单元");
    }
    scheduleRender();
  }

  function renderAnomalyList() {
    elements.anomalyList.replaceChildren();
    elements.anomalyCount.textContent = String(state.markers.length);
    elements.anomalyEmpty.hidden = state.markers.length > 0;
    document.body.dataset.anomalies = String(state.markers.length);

    state.markers
      .slice()
      .reverse()
      .forEach((marker) => {
        const item = document.createElement("div");
        item.className = `anomaly-item${marker.frameIndex === state.frameIndex ? " is-current" : ""}`;
        item.dataset.markerId = marker.id;
        item.dataset.markerFrame = String(marker.frameIndex);
        item.title = "点击跳转到该帧";

        const id = document.createElement("span");
        id.className = "anomaly-id";
        id.textContent = marker.id.replace("A-", "");

        const info = document.createElement("div");
        info.className = "anomaly-info";
        const main = document.createElement("strong");
        main.textContent = `${marker.frameLabel} · ${marker.dbz.toFixed(1)} dBZ`;
        const coordinates = document.createElement("span");
        coordinates.textContent = `${formatCoord(marker.lon, "E")} / ${formatCoord(marker.lat, "N")}`;
        info.append(main, coordinates);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "delete-anomaly";
        remove.dataset.deleteMarker = marker.id;
        remove.setAttribute("aria-label", `删除异常标记 ${marker.id}`);
        remove.innerHTML = '<svg aria-hidden="true"><use href="#i-trash"></use></svg>';

        item.addEventListener("click", () => {
          if (marker.frameIndex !== state.frameIndex) {
            setFrame(marker.frameIndex, { wrap: false });
            const x = ((marker.lon - Data.BOUNDS.west) / (Data.BOUNDS.east - Data.BOUNDS.west)) * renderer.width;
            const y = ((Data.BOUNDS.north - marker.lat) / (Data.BOUNDS.north - Data.BOUNDS.south)) * renderer.height;
            state.pointer = { x, y, lon: marker.lon, lat: marker.lat };
            syncPointerSample();
            scheduleRender();
          }
        });
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          state.markers = state.markers.filter((entry) => entry.id !== marker.id);
          renderAnomalyList();
          scheduleRender();
          showToast(`${marker.id} 已移除`);
        });

        item.append(id, info, remove);
        elements.anomalyList.append(item);
      });
  }

  function exportCurrentFrame() {
    if (state.playing) {
      setPlaying(false);
    }
    const frame = currentFrame();
    const markers = currentMarkers();
    const filename = `radar_${frame.fileStamp}_frame${String(frame.index + 1).padStart(2, "0")}.png`;
    const exportCanvas = renderer.renderExport({ frame, markers }, 1800, 1100);
    const buttonText = elements.exportButton.querySelector("span");
    elements.exportButton.disabled = true;
    buttonText.textContent = "生成中…";

    exportCanvas.toBlob((blob) => {
      elements.exportButton.disabled = false;
      buttonText.textContent = "导出 PNG";
      if (!blob) {
        showToast("导出失败，请重试", true);
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 3000);
      state.lastExport = { filename, frameIndex: frame.index, markers: markers.length };
      showToast(`已导出 ${filename}`);
      window.dispatchEvent(new CustomEvent("radar-export-ready", {
        detail: { filename, frameIndex: frame.index, markers: markers.length }
      }));
    }, "image/png");
  }

  function buildTimelineTicks() {
    elements.timelineTicks.replaceChildren();
    for (let index = 0; index < Data.FRAME_COUNT; index += 1) {
      const tick = document.createElement("i");
      tick.dataset.frame = String(index);
      elements.timelineTicks.append(tick);
    }
  }

  function bindEvents() {
    elements.playButton.addEventListener("click", togglePlayback);
    elements.prevButton.addEventListener("click", () => stepFrame(-1));
    elements.nextButton.addEventListener("click", () => stepFrame(1));

    elements.loopButton.addEventListener("click", () => {
      state.loop = !state.loop;
      updatePlaybackUi();
      showToast(state.loop ? "循环回放已开启" : "循环回放已关闭");
    });

    elements.speedButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.speed = Number(button.dataset.speed);
        elements.speedButtons.forEach((entry) => entry.classList.toggle("is-active", entry === button));
        updatePlaybackUi();
        showToast(`回放速度 ${state.speed}×`);
      });
    });

    elements.frameSlider.addEventListener("pointerdown", () => setPlaying(false));
    elements.frameSlider.addEventListener("input", () => {
      setFrame(Number(elements.frameSlider.value), { wrap: false });
    });

    elements.canvas.addEventListener("pointermove", handlePointerMove);
    elements.canvas.addEventListener("pointerleave", clearPointer);
    elements.canvas.addEventListener("click", (event) => {
      if (!state.markMode) {
        return;
      }
      const point = pointerFromEvent(event);
      if (!point) {
        return;
      }
      state.pointer = { x: point.x, y: point.y, lon: point.lon, lat: point.lat };
      updateReadout(point.sample);
      updateTooltip(point.sample);
      markCurrentSample(point.sample);
    });

    elements.markButton.addEventListener("click", () => setMarkMode(!state.markMode));
    elements.exportButton.addEventListener("click", exportCurrentFrame);

    elements.helpButton.addEventListener("click", (event) => {
      event.stopPropagation();
      elements.helpPopover.hidden = !elements.helpPopover.hidden;
    });
    document.addEventListener("click", (event) => {
      if (!elements.helpPopover.hidden && !elements.helpPopover.contains(event.target)) {
        elements.helpPopover.hidden = true;
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setMarkMode(false);
        elements.helpPopover.hidden = true;
        return;
      }
      const tag = event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepFrame(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepFrame(1);
      } else if (event.key.toLowerCase() === "m") {
        setMarkMode(!state.markMode);
      }
    });
  }

  function initialize() {
    buildTimelineTicks();
    bindEvents();
    updateClock();
    window.setInterval(updateClock, 1000);
    renderAnomalyList();
    updateReadout(null);
    updatePlaybackUi();
    setFrame(0, { wrap: false });

    const observer = new ResizeObserver(() => {
      renderer.resize();
      scheduleRender();
    });
    observer.observe(elements.mapWrap);
    renderer.resize();
    requestAnimationFrame(animationLoop);
  }

  window.RadarApp = {
    getState: () => ({
      frameIndex: state.frameIndex,
      frameLabel: currentFrame().label,
      playing: state.playing,
      speed: state.speed,
      loop: state.loop,
      markMode: state.markMode,
      markers: state.markers.map((marker) => ({ ...marker })),
      lastExport: state.lastExport || null
    }),
    getCurrentFrame: () => currentFrame(),
    getSample: (lon, lat) => Data.sample(state.frameIndex, lon, lat),
    setFrame,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    markMode: (active) => setMarkMode(Boolean(active)),
    markAt: (lon, lat) => markCurrentSample(Data.sample(state.frameIndex, lon, lat)),
    exportCurrentFrame
  };

  initialize();
})();
