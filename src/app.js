// Application controller: camera, threshold, picking, contour state and I/O.

import { GLRenderer } from './gl-renderer.js';
import { Overlay } from './overlay.js';
import { buildHeightfield, sampleHeight, PEAKS, VALLEYS } from './terrain.js';
import { contourAtLevel, joinChains } from './marching.js';
import {
  mat4Perspective,
  mat4Multiply,
  mat4Identity,
  orbitCamera,
  pickTerrain,
  invertMat4,
} from './math3d.js';
import { exportSVG, exportPNG, downloadBlob } from './exporter.js';

export const CONTOUR_LEVELS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

export function createApp({ glCanvas, overlayCanvas, ui }) {
  const renderer = new GLRenderer(glCanvas, 96);
  const overlay = new Overlay(overlayCanvas);
  const field = buildHeightfield(96);
  const state = {
    yaw: 0.7,
    pitch: 0.55,
    distance: 4.1,
    threshold: 0.5,
    pointer: { x: 0, y: 0, inside: false },
    hover: null,
    dragging: false,
    autoRotate: false,
    sweep: null,
    fixedContours: new Map(),
    activeContour: null,
    metrics: { loops: 0, segments: 0, triangles: 0 },
  };

  for (const level of CONTOUR_LEVELS) {
    const result = contourAtLevel(field, level);
    state.fixedContours.set(level, {
      level,
      chains: joinChains(result.segments),
      active: false,
    });
  }
  const landmarks = buildLandmarks();
  const overlayContours = [...state.fixedContours.values()];

  function updateThreshold(value) {
    state.threshold = Math.max(0, Math.min(1, value));
    const result = contourAtLevel(field, state.threshold);
    state.activeContour = {
      level: state.threshold,
      chains: joinChains(result.segments),
      active: true,
    };
    state.metrics = {
      loops: state.activeContour.chains.filter((c) => c.closed).length,
      chains: state.activeContour.chains.length,
      segments: result.segments.length,
      triangles: result.triangles.length / 3,
    };
    renderer.setHighlight(result.triangles);
    ui.threshold.value = String(state.threshold);
    ui.thresholdValue.textContent = `${(state.threshold * 1000).toFixed(0)} m`;
    ui.metrics.textContent =
      `闭合环 ${state.metrics.loops} · 链 ${state.metrics.chains} · ` +
      `线段 ${state.metrics.segments} · 高亮三角面 ${state.metrics.triangles}`;
  }

  function frame() {
    const { width, height, dpr } = renderer.resize();
    overlay.resize(width, height);
    const projection = mat4Perspective(Math.PI / 4, width / height, 0.1, 50);
    const camera = orbitCamera(state.yaw, state.pitch, state.distance);
    const mvp = mat4Multiply(projection, camera.view);
    renderer.render(mvp, mat4Identity());

    updateHover(mvp, dpr);
    const entries = [...overlayContours, state.activeContour];

    overlay.render({
      renderer,
      project: { mvp, width, height },
      contours: entries,
      hover: state.hover,
      landmarks,
    });
    requestAnimationFrame(frame);
  }

  function updateHover(mvp, dpr) {
    if (!state.pointer.inside || state.dragging) {
      state.hover = null;
      return;
    }
    const inv = invertMat4(mvp);
    const hit = pickTerrain(
      mvp,
      inv,
      glCanvas.width,
      glCanvas.height,
      state.pointer.x * dpr,
      state.pointer.y * dpr,
    );
    state.hover = hit ? { point: hit.point, height: hit.height } : null;
  }

  function buildLandmarks() {
    const landmarks = [];
    for (const p of PEAKS) {
      const h = sampleHeight(p.x, p.z);
      landmarks.push({ kind: 'peak', point: [p.x, h, p.z] });
    }
    for (const v of VALLEYS) {
      const h = sampleHeight(v.x, v.z);
      landmarks.push({ kind: 'valley', point: [v.x, h, v.z] });
    }
    return landmarks;
  }

  function bindControls() {
    ui.threshold.addEventListener('input', (event) => {
      state.sweep = null;
      updateThreshold(Number(event.target.value));
    });
    ui.exportSVG.addEventListener('click', () => {
      const blob = exportSVG(field, CONTOUR_LEVELS, state.threshold);
      downloadBlob(blob, `contours-${Math.round(state.threshold * 1000)}.svg`);
    });
    ui.exportPNG.addEventListener('click', async () => {
      const blob = await exportPNG(field, CONTOUR_LEVELS, state.threshold);
      downloadBlob(blob, `contours-${Math.round(state.threshold * 1000)}.png`);
    });
    ui.autoRotate.addEventListener('click', () => {
      state.autoRotate = !state.autoRotate;
      ui.autoRotate.classList.toggle('active', state.autoRotate);
    });
    ui.sweep.addEventListener('click', startSweep);
    ui.reset.addEventListener('click', () => {
      state.yaw = 0.7;
      state.pitch = 0.55;
      updateThreshold(0.5);
    });
    bindPointer();
  }

  function bindPointer() {
    glCanvas.addEventListener('pointerdown', (event) => {
      state.dragging = true;
      state.drag = { x: event.clientX, y: event.clientY, yaw: state.yaw, pitch: state.pitch };
      glCanvas.setPointerCapture(event.pointerId);
    });
    glCanvas.addEventListener('pointermove', (event) => {
      const rect = glCanvas.getBoundingClientRect();
      state.pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        inside: true,
      };
      if (!state.dragging || !state.drag) return;
      const dx = event.clientX - state.drag.x;
      const dy = event.clientY - state.drag.y;
      state.yaw = state.drag.yaw + dx * 0.008;
      state.pitch = Math.max(0.12, Math.min(1.35, state.drag.pitch + dy * 0.006));
    });
    glCanvas.addEventListener('pointerup', (event) => {
      state.dragging = false;
      glCanvas.releasePointerCapture(event.pointerId);
    });
    glCanvas.addEventListener('pointerleave', () => {
      state.pointer.inside = false;
    });
    glCanvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        state.distance = Math.max(2.6, Math.min(7, state.distance + event.deltaY * 0.002));
      },
      { passive: false },
    );
  }

  function startSweep() {
    state.sweep = {
      t: 0,
      direction: 1,
      samples: [],
      lastTopology: null,
    };
  }

  function tickSweep(dt) {
    if (!state.sweep) return;
    const sweep = state.sweep;
    sweep.t += dt * 0.18 * sweep.direction;
    if (sweep.t >= 1) {
      sweep.t = 1;
      sweep.direction = -1;
    } else if (sweep.t <= 0) {
      sweep.t = 0;
      sweep.direction = 1;
    }
    updateThreshold(sweep.t);
    const signature = `${state.metrics.loops}:${state.metrics.segments}`;
    if (signature !== sweep.lastTopology) {
      sweep.samples.push({
        level: Number(sweep.t.toFixed(3)),
        loops: state.metrics.loops,
        segments: state.metrics.segments,
      });
      sweep.lastTopology = signature;
      ui.sweepLog.textContent = sweep.samples
        .slice(-6)
        .map((s) => `h=${s.level} 环${s.loops}/段${s.segments}`)
        .join('  ·  ');
    }
  }

  let lastTime = performance.now();
  function clock(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    if (state.autoRotate) state.yaw += dt * 0.25;
    tickSweep(dt);
    requestAnimationFrame(clock);
  }

  bindControls();
  updateThreshold(0.5);
  requestAnimationFrame(frame);
  requestAnimationFrame(clock);

  return { state, updateThreshold };
}
