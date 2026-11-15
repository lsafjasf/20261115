import {
  COLLISION_WAYPOINTS,
  OBSTACLES,
  SAFE_WAYPOINTS,
  SHOT_DURATION,
  clamp,
  clampWaypoint,
  computeShotPlan,
  formatClearance,
  formatSeconds,
  getHorizontalFov,
} from './planner.js';
import { BeatEngine } from './audio.js';
import { StageRenderer } from './renderer.js';

const $ = (id) => document.getElementById(id);
const elements = {
  canvas: $('stageCanvas'),
  canvasWrap: $('canvasWrap'),
  tooltip: $('canvasTooltip'),
  heading: $('heading'),
  focal: $('focal'),
  safety: $('safety'),
  headingValue: $('headingValue'),
  focalValue: $('focalValue'),
  safetyValue: $('safetyValue'),
  fovValue: $('fovValue'),
  metricFov: $('metricFov'),
  waypointList: $('waypointList'),
  previewButton: $('previewButton'),
  previewLabel: $('previewLabel'),
  exportButton: $('exportButton'),
  exportLabel: $('exportLabel'),
  timeline: $('timeline'),
  timelineProgress: $('timelineProgress'),
  timelineIntervals: $('timelineIntervals'),
  playhead: $('playhead'),
  currentTime: $('currentTime'),
  timelineMeta: $('timelineMeta'),
  statusCard: $('statusCard'),
  statusIcon: $('statusIcon'),
  statusLabel: $('statusLabel'),
  statusTitle: $('statusTitle'),
  statusDescription: $('statusDescription'),
  analysisLed: $('analysisLed'),
  canvasStatus: $('canvasStatus'),
  minClearance: $('minClearance'),
  pathLength: $('pathLength'),
  metricFocal: $('focalValue'),
  conflictCount: $('conflictCount'),
  objectCount: $('objectCount'),
  conflictList: $('conflictList'),
  intervalList: $('intervalList'),
  safePreset: $('safePreset'),
  collisionPreset: $('collisionPreset'),
  exportStatus: $('exportStatus'),
  toast: $('toast'),
  audioIndicator: document.querySelector('.audio-indicator'),
};

const state = {
  waypoints: SAFE_WAYPOINTS.map((point) => [...point]),
  safety: 0.8,
  focal: 28,
  heading: 8,
  duration: SHOT_DURATION,
  progress: 0,
  time: 0,
  playing: false,
  playingSince: 0,
  preset: 'safe',
  hoveredWaypoint: -1,
  draggingIndex: -1,
  exporting: false,
  exportStartedAt: 0,
  exportRecorder: null,
  exportChunks: [],
  exportStream: null,
  lastExport: null,
};

const renderer = new StageRenderer(elements.canvas);
const beat = new BeatEngine();
let plan = null;
let toastTimer = 0;
let lastUiSecond = -1;

function recreatePlan() {
  plan = computeShotPlan(state.waypoints, {
    safety: state.safety,
    focal: state.focal,
    heading: state.heading,
    duration: state.duration,
  });
  return plan;
}

function updateAll({ recalc = true } = {}) {
  if (recalc) recreatePlan();
  updateControlLabels();
  updateWaypointPanel();
  updateAnalysis();
  updateTimeline();
  updatePlayhead();
}

function updateControlLabels() {
  const heading = Number(state.heading);
  elements.headingValue.textContent =
    heading === 0 ? '跟随路径' : `${heading > 0 ? '+' : '−'}${Math.abs(heading)}°`;
  elements.focalValue.textContent = `${state.focal} mm`;
  elements.fovValue.textContent = `${getHorizontalFov(state.focal).toFixed(1)}°`;
  elements.safetyValue.textContent = `${state.safety.toFixed(2)} m`;
  elements.metricFov.textContent = `${getHorizontalFov(state.focal).toFixed(1)}°`;
  elements.heading.value = String(state.heading);
  elements.focal.value = String(state.focal);
  elements.safety.value = String(state.safety);
}

function updateWaypointPanel() {
  if (!elements.waypointList.children.length) {
    for (let index = 0; index < 4; index += 1) {
      const row = document.createElement('div');
      row.className = 'waypoint-row';
      row.dataset.index = String(index);
      row.innerHTML = `
        <span class="waypoint-index">${String(index + 1).padStart(2, '0')}</span>
        <b>路径点 ${String(index + 1).padStart(2, '0')}</b>
        <span class="waypoint-coord"></span>
      `;
      row.addEventListener('mouseenter', () => {
        state.hoveredWaypoint = index;
      });
      row.addEventListener('mouseleave', () => {
        if (state.draggingIndex < 0) state.hoveredWaypoint = -1;
      });
      elements.waypointList.append(row);
    }
  }

  for (const row of elements.waypointList.children) {
    const index = Number(row.dataset.index);
    const point = state.waypoints[index];
    row.querySelector('.waypoint-coord').textContent =
      `${point[0].toFixed(1)}, ${point[1].toFixed(1)}`;
    row.classList.toggle(
      'is-active',
      state.hoveredWaypoint === index || state.draggingIndex === index,
    );
  }
}

function updateAnalysis() {
  const invalid = !plan.valid;
  elements.statusCard.classList.toggle('is-valid', !invalid);
  elements.statusCard.classList.toggle('is-invalid', invalid);
  elements.analysisLed.classList.toggle('is-invalid', invalid);
  elements.canvasStatus.classList.toggle('is-valid', !invalid);
  elements.canvasStatus.classList.toggle('is-invalid', invalid);
  elements.minClearance.classList.toggle('is-danger', invalid);
  elements.conflictCount.classList.toggle('is-danger', invalid);
  elements.objectCount.classList.toggle('is-danger', invalid);

  elements.minClearance.textContent = formatClearance(plan.minimumClearance);
  elements.pathLength.textContent = `${plan.path.length.toFixed(1)} m`;
  elements.conflictCount.textContent = String(plan.intervals.length);
  elements.objectCount.textContent = String(plan.conflictObjects.length);

  if (invalid) {
    const names = plan.conflictObjects.map((object) => object.name).join('、');
    elements.statusIcon.textContent = '!';
    elements.statusLabel.textContent = '路径不可用';
    elements.statusTitle.textContent = `检测到 ${plan.conflictObjects.length} 个冲突对象`;
    elements.statusDescription.textContent = `${names} 侵入最小安全距离，红色区间禁止拍摄。`;
    elements.canvasStatus.textContent = '路径不可用';
    elements.timelineMeta.textContent = '红色区间不可用 · 请移开冲突路径点';
  } else {
    elements.statusIcon.textContent = '✓';
    elements.statusLabel.textContent = '镜头可用';
    elements.statusTitle.textContent = '安全距离内无遮挡';
    elements.statusDescription.textContent = `全部演员与立柱均满足 ${state.safety.toFixed(2)} m 安全边界。`;
    elements.canvasStatus.textContent = '路径可用';
    elements.timelineMeta.textContent = '拖动路径点实时检测';
  }

  elements.conflictList.replaceChildren();
  if (!plan.conflictObjects.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '当前路径与两名演员、两根立柱均保持安全距离。';
    elements.conflictList.append(empty);
  } else {
    for (const object of plan.conflictObjects) {
      const card = document.createElement('div');
      card.className = 'conflict-card';
      card.dataset.obstacle = object.id;
      card.innerHTML = `
        <span class="conflict-icon">${object.type === 'actor' ? 'A' : 'P'}</span>
        <span><b>${object.name}</b><small>${object.type === 'actor' ? '演员' : '立柱'} · 安全边界被侵入</small></span>
        <span class="conflict-value">${object.minClearance.toFixed(2)} m</span>
      `;
      elements.conflictList.append(card);
    }
  }

  elements.intervalList.replaceChildren();
  if (!plan.intervals.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '无不可用区间，十秒镜头可连续拍摄。';
    elements.intervalList.append(empty);
  } else {
    for (const interval of plan.intervals) {
      const item = document.createElement('div');
      item.className = 'interval-item';
      item.dataset.obstacle = interval.obstacleId;
      item.innerHTML = `
        <time>${formatSeconds(interval.startTime)}–${formatSeconds(interval.endTime)}</time>
        <span>${interval.obstacleName}</span>
      `;
      elements.intervalList.append(item);
    }
  }

  elements.exportButton.disabled = invalid || state.exporting;
  elements.exportButton.title = invalid ? '存在路径冲突，无法导出' : '导出十秒 WebM 预览';
}

function updateTimeline() {
  elements.timelineIntervals.replaceChildren();
  for (const interval of plan.mergedIntervals) {
    const marker = document.createElement('div');
    marker.className = 'timeline-interval';
    marker.style.left = `${interval.startU * 100}%`;
    marker.style.width = `${Math.max((interval.endU - interval.startU) * 100, 0.5)}%`;
    marker.title = `${formatSeconds(interval.startTime)}–${formatSeconds(interval.endTime)} ${interval.obstacleName}`;
    elements.timelineIntervals.append(marker);
  }
}

function updatePlayhead() {
  const percent = state.progress * 100;
  elements.playhead.style.left = `${percent}%`;
  elements.timelineProgress.style.width = `${percent}%`;
  elements.currentTime.textContent = formatSeconds(state.progress * state.duration);
  lastUiSecond = Math.floor(state.progress * state.duration);
}

function showToast(message, isError = false, timeout = 2800) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('is-error', isError);
  elements.toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove('is-visible');
  }, timeout);
}

function setPresetActive(name) {
  state.preset = name;
  elements.safePreset.classList.toggle('is-active', name === 'safe');
  elements.collisionPreset.classList.toggle('is-active', name === 'collision');
  const safeCheck = elements.safePreset.querySelector('.preset-check');
  const dangerArrow = elements.collisionPreset.querySelector('.preset-arrow');
  safeCheck.textContent = name === 'safe' ? '✓' : '';
  dangerArrow.textContent = name === 'collision' ? '!' : '↗';
}

function loadPreset(name, announce = true) {
  stopPlayback();
  state.waypoints =
    name === 'collision'
      ? COLLISION_WAYPOINTS.map((point) => [...point])
      : SAFE_WAYPOINTS.map((point) => [...point]);
  state.safety = 0.8;
  state.focal = 28;
  state.heading = 8;
  state.progress = 0;
  state.time = 0;
  setPresetActive(name);
  updateAll();
  if (announce) {
    showToast(
      name === 'collision'
        ? '已载入强制穿越测试：立柱 B 的安全区间被侵入。'
        : '安全环绕镜头已载入，四段路径均通过碰撞检测。',
      name === 'collision',
    );
  }
}

function seekTo(progress) {
  state.progress = clamp(progress, 0, 1);
  state.time = state.progress * state.duration;
  if (state.playing) {
    state.playingSince = performance.now() - state.time * 1000;
  }
  updatePlayhead();
}

function timelineProgressFromEvent(event) {
  const rect = elements.timeline.getBoundingClientRect();
  return clamp((event.clientX - rect.left) / rect.width, 0, 1);
}

let scrubbingTimeline = false;

elements.timeline.addEventListener('pointerdown', (event) => {
  scrubbingTimeline = true;
  elements.timeline.setPointerCapture(event.pointerId);
  seekTo(timelineProgressFromEvent(event));
});

elements.timeline.addEventListener('pointermove', (event) => {
  if (scrubbingTimeline) seekTo(timelineProgressFromEvent(event));
});

elements.timeline.addEventListener('pointerup', (event) => {
  scrubbingTimeline = false;
  if (elements.timeline.hasPointerCapture(event.pointerId)) {
    elements.timeline.releasePointerCapture(event.pointerId);
  }
});

elements.heading.addEventListener('input', () => {
  state.heading = Number(elements.heading.value);
  updateAll();
});

elements.focal.addEventListener('input', () => {
  state.focal = Number(elements.focal.value);
  updateAll();
});

elements.safety.addEventListener('input', () => {
  state.safety = Number(elements.safety.value);
  state.preset = 'custom';
  setPresetActive('custom');
  updateAll();
});

elements.safePreset.addEventListener('click', () => loadPreset('safe'));
elements.collisionPreset.addEventListener('click', () => loadPreset('collision'));

function hitWaypoint(world) {
  let best = -1;
  let bestDistance = 0.43;
  for (let index = 0; index < state.waypoints.length; index += 1) {
    const point = state.waypoints[index];
    const currentDistance = Math.hypot(world.x - point[0], world.y - point[1]);
    if (currentDistance < bestDistance) {
      best = index;
      bestDistance = currentDistance;
    }
  }
  return best;
}

function updateTooltip(world, clientX, clientY) {
  let text = '';
  const obstacle = OBSTACLES.find(
    (item) =>
      Math.hypot(world.x - item.x, world.y - item.y) < item.radius + 0.18,
  );
  if (obstacle) {
    const conflict = plan.conflictObjects.find((item) => item.id === obstacle.id);
    const clearance = Math.hypot(world.x - obstacle.x, world.y - obstacle.y) - obstacle.radius;
    text = conflict
      ? `${obstacle.name} · 冲突 ${conflict.minClearance.toFixed(2)}m`
      : `${obstacle.name} · 净距 ${Math.max(clearance, 0).toFixed(2)}m`;
  } else {
    const nearest = plan.samples.reduce(
      (best, sample) => {
        const current = Math.hypot(world.x - sample.x, world.y - sample.y);
        return current < best.distance ? { sample, distance: current } : best;
      },
      { sample: null, distance: Infinity },
    );
    if (nearest.sample && nearest.distance < 0.22 && nearest.sample.status !== 'safe') {
      const interval = plan.intervals.find(
        (item) => nearest.sample.u >= item.startU && nearest.sample.u <= item.endU,
      );
      text = interval
        ? `不可用 ${formatSeconds(interval.startTime)}–${formatSeconds(interval.endTime)} · ${interval.obstacleName}`
        : '安全距离不足';
    }
  }

  if (!text) {
    elements.tooltip.hidden = true;
    return;
  }
  const rect = elements.canvasWrap.getBoundingClientRect();
  elements.tooltip.textContent = text;
  elements.tooltip.style.left = `${clientX - rect.left}px`;
  elements.tooltip.style.top = `${clientY - rect.top}px`;
  elements.tooltip.hidden = false;
}

elements.canvas.addEventListener('pointerdown', (event) => {
  const world = renderer.toWorld(event.clientX, event.clientY);
  const index = hitWaypoint(world);
  if (index < 0) return;
  if (state.playing) stopPlayback();
  state.draggingIndex = index;
  state.hoveredWaypoint = index;
  state.waypoints[index] = clampWaypoint([world.x, world.y]);
  setPresetActive('custom');
  elements.canvas.classList.add('is-dragging');
  elements.canvas.setPointerCapture(event.pointerId);
  elements.tooltip.hidden = true;
  updateAll();
});

elements.canvas.addEventListener('pointermove', (event) => {
  const world = renderer.toWorld(event.clientX, event.clientY);
  if (state.draggingIndex >= 0) {
    state.waypoints[state.draggingIndex] = clampWaypoint([world.x, world.y]);
    updateAll();
    elements.tooltip.hidden = true;
    state.hoveredWaypoint = state.draggingIndex;
    updateWaypointPanel();
    return;
  }

  const hovered = hitWaypoint(world);
  state.hoveredWaypoint = hovered;
  updateWaypointPanel();
  elements.canvas.style.cursor = hovered >= 0 ? 'grab' : 'default';
  updateTooltip(world, event.clientX, event.clientY);
});

function endDrag(event) {
  if (state.draggingIndex < 0) return;
  const index = state.draggingIndex;
  state.draggingIndex = -1;
  elements.canvas.classList.remove('is-dragging');
  if (elements.canvas.hasPointerCapture(event.pointerId)) {
    elements.canvas.releasePointerCapture(event.pointerId);
  }
  updateAll();
  const point = state.waypoints[index];
  showToast(
    plan.valid
      ? `路径点 ${String(index + 1).padStart(2, '0')} 已更新 · 无碰撞`
      : `路径点 ${String(index + 1).padStart(2, '0')} 触发碰撞 · 红色区间不可用`,
    !plan.valid,
  );
}

elements.canvas.addEventListener('pointerup', endDrag);
elements.canvas.addEventListener('pointercancel', endDrag);
elements.canvas.addEventListener('pointerleave', () => {
  elements.tooltip.hidden = true;
  if (state.draggingIndex < 0) {
    state.hoveredWaypoint = -1;
    updateWaypointPanel();
  }
});

function setPreviewUi(playing) {
  elements.previewButton.classList.toggle('is-playing', playing);
  elements.previewLabel.textContent = playing ? '暂停预览' : '播放 10 秒';
  elements.audioIndicator.classList.toggle('is-playing', playing);
}

function setExportLabel(label) {
  elements.exportLabel.textContent = label;
  elements.exportButton.setAttribute('aria-label', label);
}

async function startPlayback() {
  state.progress = 0;
  state.time = 0;
  state.playing = true;
  state.playingSince = performance.now();
  updatePlayhead();
  setPreviewUi(true);
  try {
    await beat.start();
  } catch (error) {
    showToast(`音频引擎不可用：${error.message}。画面将继续播放。`, true, 4000);
  }
}

function stopPlayback({ keepExport = false } = {}) {
  state.playing = false;
  beat.stop();
  setPreviewUi(false);
  elements.audioIndicator.classList.remove('is-playing');
  if (state.exporting && !keepExport) cancelExport();
}

function finishPlayback() {
  state.progress = 1;
  state.time = state.duration;
  updatePlayhead();
  if (state.exporting) {
    completeExport();
    return;
  }
  stopPlayback();
  elements.previewLabel.textContent = '重播 10 秒';
}

elements.previewButton.addEventListener('click', async () => {
  if (state.exporting) {
    showToast('正在导出预览，请稍候。', true);
    return;
  }
  if (state.playing) {
    stopPlayback();
    return;
  }
  await startPlayback();
});

function getRecordingMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

async function startExport() {
  if (state.exporting) return;
  if (!plan.valid) {
    showToast('当前路径存在碰撞，不能导出。请移开冲突路径点或提高安全距离。', true, 4200);
    return;
  }
  if (typeof elements.canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
    showToast('当前浏览器不支持 Canvas 视频导出，请使用最新版 Chrome。', true, 4200);
    return;
  }

  try {
    await beat.ensure();
  } catch (error) {
    showToast(`无法创建音频轨道：${error.message}`, true);
    return;
  }

  renderer.setCaptureResolution(1920, 1080);
  const mimeType = getRecordingMimeType();
  const canvasStream = elements.canvas.captureStream(30);
  const audioStream = beat.getStream();
  state.exportStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...(audioStream ? audioStream.getAudioTracks() : []),
  ]);
  state.exportChunks = [];

  try {
    state.exportRecorder = new MediaRecorder(
      state.exportStream,
      mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined,
    );
  } catch (error) {
    showToast(`无法启动录像：${error.message}`, true);
    cleanupExportStream();
    return;
  }

  state.exportRecorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) state.exportChunks.push(event.data);
  });
  state.exportRecorder.addEventListener('error', (event) => {
    showToast(`导出失败：${event.error?.message ?? '录像器异常'}`, true, 4200);
    cleanupExport();
  });
  state.exportRecorder.addEventListener('stop', writeExportFile);

  state.exporting = true;
  state.exportStartedAt = performance.now();
  elements.exportButton.disabled = true;
  setExportLabel('正在录制 0%');
  elements.exportStatus.textContent = '录制中 · 30 FPS';
  state.exportRecorder.start(100);
  await startPlayback();
}

function completeExport() {
  stopPlayback({ keepExport: true });
  if (state.exportRecorder?.state === 'recording') {
    state.exportRecorder.stop();
  }
}

function writeExportFile() {
  if (!state.exporting) return;
  const mimeType = state.exportRecorder?.mimeType || 'video/webm';
  const blob = new Blob(state.exportChunks, { type: mimeType });
  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `live-axis-stage-preview.${extension}`;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);

  state.lastExport = {
    size: blob.size,
    type: mimeType,
    duration: state.duration,
    fileName: link.download,
    width: 1920,
    height: 1080,
  };
  state.exporting = false;
  state.exportRecorder = null;
  state.exportChunks = [];
  cleanupExportStream();
  setExportLabel('导出预览');
  elements.exportButton.disabled = !plan.valid;
  elements.exportStatus.textContent = '已导出 · 10.0s';
  elements.previewLabel.textContent = '重播 10 秒';
  showToast(`十秒预览已导出（${(blob.size / 1024 / 1024).toFixed(1)} MB）。`);
  window.setTimeout(() => {
    if (!state.exporting) elements.exportStatus.textContent = '1080p · 30 FPS';
  }, 5000);
}

function cleanupExportStream() {
  state.exportStream?.getTracks().forEach((track) => track.stop());
  state.exportStream = null;
  renderer.endCaptureResolution();
}

function cancelExport() {
  if (state.exportRecorder?.state === 'recording') {
    state.exportRecorder.stop();
  }
  state.exporting = false;
  state.exportRecorder = null;
  state.exportChunks = [];
  cleanupExportStream();
  setExportLabel('导出预览');
  elements.exportButton.disabled = !plan.valid;
  elements.exportStatus.textContent = '1080p · 30 FPS';
  showToast('已取消导出。', true);
}

function cleanupExport() {
  state.exporting = false;
  state.exportRecorder = null;
  state.exportChunks = [];
  cleanupExportStream();
  setExportLabel('导出预览');
  elements.exportButton.disabled = !plan.valid;
  elements.exportStatus.textContent = '1080p · 30 FPS';
}

elements.exportButton.addEventListener('click', startExport);

function frame(now) {
  if (state.playing) {
    const elapsed = (now - state.playingSince) / 1000;
    state.progress = clamp(elapsed / state.duration, 0, 1);
    state.time = state.progress * state.duration;
    updatePlayhead();
    if (state.exporting) {
      const percent = Math.min(100, Math.round((elapsed / state.duration) * 100));
      setExportLabel(`正在录制 ${percent}%`);
    }
    if (elapsed >= state.duration - 0.01) finishPlayback();
  }

  renderer.render({
    waypoints: state.waypoints,
    plan,
    safety: state.safety,
    heading: state.heading,
    progress: state.progress,
    playing: state.playing,
    time: state.playing ? state.time : now / 1000,
    beat: (state.playing ? state.time : now / 1000) * (112 / 60),
    draggingIndex: state.draggingIndex,
    hoveredWaypoint: state.hoveredWaypoint,
  });
  requestAnimationFrame(frame);
}

const resizeObserver = new ResizeObserver(() => renderer.resize());
resizeObserver.observe(elements.canvasWrap);
window.addEventListener('resize', () => renderer.resize());

window.__stagePlanner = {
  getState() {
    return {
      waypoints: state.waypoints.map((point) => [...point]),
      valid: plan.valid,
      minimumClearance: plan.minimumClearance,
      safety: state.safety,
      focal: state.focal,
      heading: state.heading,
      horizontalFov: plan.horizontalFov,
      pathLength: plan.path.length,
      intervals: plan.intervals.map((interval) => ({ ...interval })),
      conflictObjects: plan.conflictObjects.map((object) => ({
        id: object.id,
        name: object.name,
        type: object.type,
        minClearance: object.minClearance,
      })),
      exporting: state.exporting,
      playing: state.playing,
      lastExport: state.lastExport,
    };
  },
  setWaypoints(points) {
    state.waypoints = points.map((point) => clampWaypoint(point));
    setPresetActive('custom');
    updateAll();
    return this.getState();
  },
  setSafety(value) {
    state.safety = clamp(Number(value), 0.3, 1.5);
    setPresetActive('custom');
    updateAll();
    return this.getState();
  },
  setFocal(value) {
    state.focal = clamp(Number(value), 18, 85);
    updateAll();
    return this.getState();
  },
  setHeading(value) {
    state.heading = clamp(Number(value), -90, 90);
    updateAll();
    return this.getState();
  },
  loadPreset,
  seek(seconds) {
    seekTo(clamp(Number(seconds), 0, state.duration) / state.duration);
    return this.getState();
  },
};

setPresetActive('safe');
updateAll();
requestAnimationFrame(frame);
