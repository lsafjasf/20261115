import { createSourceCanvas, SOURCE_WIDTH, SOURCE_HEIGHT } from './drawing.js';
import { renderLens } from './sampler.js';
import { buildComparisonImage, buildSideBySide } from './export.js';

const LENS_SIZE = 320;

const sourceCanvas = createSourceCanvas();
const sourceCtx = sourceCanvas.getContext('2d');
const sourceData = sourceCtx.getImageData(0, 0, SOURCE_WIDTH, SOURCE_HEIGHT);

const map = document.getElementById('map');
const mapCtx = map.getContext('2d');
const lens = document.getElementById('lens');
const lensCtx = lens.getContext('2d');

const state = {
  center: { x: 320, y: 300 },
  zoom: 6,
  mode: 'nearest',
  pins: { A: null, B: null },
};

// Main map is a plain 1:1 copy of the source bitmap (never zoomed/scaled
// to manufacture detail); CSS only fits it to the page width.
mapCtx.imageSmoothingEnabled = false;
mapCtx.drawImage(sourceCanvas, 0, 0);

function toSourceCoords(evt) {
  const rect = map.getBoundingClientRect();
  const x = ((evt.clientX - rect.left) / rect.width) * SOURCE_WIDTH;
  const y = ((evt.clientY - rect.top) / rect.height) * SOURCE_HEIGHT;
  return {
    x: Math.min(SOURCE_WIDTH - 1, Math.max(0, x)),
    y: Math.min(SOURCE_HEIGHT - 1, Math.max(0, y)),
  };
}

function drawOverlay() {
  mapCtx.drawImage(sourceCanvas, 0, 0);
  // Crosshair at current lens center.
  mapCtx.strokeStyle = 'rgba(78,161,255,0.9)';
  mapCtx.lineWidth = 1;
  mapCtx.beginPath();
  mapCtx.moveTo(state.center.x - 10, state.center.y);
  mapCtx.lineTo(state.center.x + 10, state.center.y);
  mapCtx.moveTo(state.center.x, state.center.y - 10);
  mapCtx.lineTo(state.center.x, state.center.y + 10);
  mapCtx.stroke();
  // Pins.
  const marks = [
    [state.pins.A, '#ff5d5d', 'A'],
    [state.pins.B, '#5dffb0', 'B'],
  ];
  marks.forEach(([p, color, name]) => {
    if (!p) return;
    mapCtx.strokeStyle = color;
    mapCtx.lineWidth = 1.5;
    mapCtx.beginPath();
    mapCtx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    mapCtx.stroke();
    mapCtx.fillStyle = color;
    mapCtx.font = 'bold 11px ui-monospace, monospace';
    mapCtx.textAlign = 'center';
    mapCtx.textBaseline = 'middle';
    mapCtx.fillText(name, p.x, p.y);
  });
}

function drawCrosshair(ctx) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  const c = LENS_SIZE / 2;
  ctx.beginPath();
  ctx.moveTo(c - 14, c);
  ctx.lineTo(c + 14, c);
  ctx.moveTo(c, c - 14);
  ctx.lineTo(c, c + 14);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.arc(c, c, 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function updateLens() {
  // Fully per-pixel: renderLens walks each output pixel itself.
  const frame = renderLens(sourceData, LENS_SIZE, {
    center: state.center,
    zoom: state.zoom,
    mode: state.mode,
  });
  lensCtx.putImageData(frame, 0, 0);
  drawCrosshair(lensCtx);
  document.getElementById('cx').textContent = state.center.x.toFixed(1);
  document.getElementById('cy').textContent = state.center.y.toFixed(1);
  document.getElementById('rz').textContent = `${state.zoom.toFixed(1)}×`;
  document.getElementById('rm').textContent =
    state.mode === 'nearest' ? '最近邻' : '平滑(双线性)';
  drawOverlay();
}

map.addEventListener('mousemove', (evt) => {
  state.center = toSourceCoords(evt);
  updateLens();
});

// Wheel changes zoom while keeping the same source point at lens center.
map.addEventListener('wheel', (evt) => {
  evt.preventDefault();
  const step = evt.deltaY < 0 ? 0.5 : -0.5;
  state.zoom = Math.min(16, Math.max(2, state.zoom + step));
  document.getElementById('zoom').value = state.zoom;
  document.getElementById('zoomVal').textContent = `${state.zoom.toFixed(1)}×`;
  updateLens();
}, { passive: false });

const zoomSlider = document.getElementById('zoom');
zoomSlider.addEventListener('input', () => {
  state.zoom = Number(zoomSlider.value);
  document.getElementById('zoomVal').textContent = `${state.zoom.toFixed(1)}×`;
  updateLens(); // center untouched: zoom-in-place
});

function setMode(mode) {
  state.mode = mode;
  document.getElementById('modeNearest').classList.toggle('active', mode === 'nearest');
  document.getElementById('modeSmooth').classList.toggle('active', mode === 'smooth');
  updateLens();
}
document.getElementById('modeNearest').addEventListener('click', () => setMode('nearest'));
document.getElementById('modeSmooth').addEventListener('click', () => setMode('smooth'));

function pinMeta(p) {
  return p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) @ ${state.zoom.toFixed(1)}×` : '未固定';
}

function setPin(slot) {
  state.pins[slot] = { ...state.center };
  document.getElementById(`pin${slot}Meta`).textContent = pinMeta(state.pins[slot]);
  updateLens();
}
document.getElementById('pinA').addEventListener('click', () => setPin('A'));
document.getElementById('pinB').addEventListener('click', () => setPin('B'));

document.getElementById('pinClear').addEventListener('click', () => {
  state.pins = { A: null, B: null };
  document.getElementById('pinAMeta').textContent = '未固定';
  document.getElementById('pinBMeta').textContent = '未固定';
  updateLens();
});

document.querySelectorAll('[data-jump]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const p = state.pins[btn.dataset.jump];
    if (!p) return;
    state.center = { ...p };
    updateLens();
  });
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const canvas = buildComparisonImage(sourceData, state.pins, state.zoom);
  const a = document.createElement('a');
  a.download = 'magnifier-comparison.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
});

updateLens();

// Debug/test hooks used by automated verification.
window.__app = {
  state,
  sourceCanvas,
  sourceData,
  lens,
  renderLens,
  setCenter(x, y) {
    state.center = { x, y };
    updateLens();
  },
  setZoom(z) {
    state.zoom = z;
    zoomSlider.value = z;
    document.getElementById('zoomVal').textContent = `${z.toFixed(1)}×`;
    updateLens();
  },
  setMode,
  setPin,
  exportImage: () => buildComparisonImage(sourceData, state.pins, state.zoom),
  exportSideBySide: () => buildSideBySide(sourceData, state.center, state.zoom),
};
