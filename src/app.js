import { Camera, generateStars, pickStar, clamp } from './core.js';
import {
  createConstellation, renameConstellation, addStar, removeStar,
  toggleEdge, setMagRange, isConstellationInRange,
  serializeProject, deserializeProject,
} from './project.js';
import { renderScene } from './render.js';
import { buildDemoConstellations } from './demo.js';

const STORAGE_KEY = 'star-canvas-project-v1';
const WORLD_SIZE = 2000;
const DEFAULT_SEED = 20261115;

const state = {
  seed: DEFAULT_SEED,
  worldSize: WORLD_SIZE,
  stars: [],
  constellations: [],
  magnitudeThreshold: 6,
  camera: null,
  mode: 'pan', // 'pan' | 'connect'
  selectedId: null,
  hoveredStarId: null,
  connectFirst: null,
};

const canvas = document.getElementById('sky');
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip');
const statusEl = document.getElementById('status');

function setStatus(message, ok = true) {
  statusEl.textContent = message;
  statusEl.style.color = ok ? '#8be9a8' : '#ffb4bd';
}

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  if (state.camera) {
    state.camera.viewWidth = rect.width;
    state.camera.viewHeight = rect.height;
  }
  return { width: rect.width, height: rect.height, dpr };
}

function draw() {
  const { width, height, dpr } = resizeCanvas();
  renderScene(ctx, {
    stars: state.stars,
    constellations: state.constellations,
    camera: state.camera,
    magnitudeThreshold: state.magnitudeThreshold,
    selectedConstellationId: state.selectedId,
    hoveredStarId: state.hoveredStarId,
    width,
    height,
    dpr,
  });
}

function persistLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, serializeProject({
      seed: state.seed,
      worldSize: state.worldSize,
      magnitudeThreshold: state.magnitudeThreshold,
      constellations: state.constellations,
      camera: state.camera,
    }));
  } catch (error) {
    setStatus(`本地自动保存失败：${error.message}`, false);
  }
}

function saveToFile() {
  const text = serializeProject({
    seed: state.seed,
    worldSize: state.worldSize,
    magnitudeThreshold: state.magnitudeThreshold,
    constellations: state.constellations,
    camera: state.camera,
  });
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `star-project-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus(`已导出 JSON（${state.constellations.length} 个星座）`);
}

function loadFromText(text, sourceLabel = '工程文件') {
  const raw = JSON.parse(text);
  const stars = generateStars({ seed: raw.seed ?? DEFAULT_SEED, worldSize: raw.worldSize ?? WORLD_SIZE });
  const project = deserializeProject(text, stars);
  applyLoadedProject(project, stars);
  setStatus(`已载入${sourceLabel}：${project.constellations.length} 个星座，标注完整恢复`);
}

function applyLoadedProject(project, stars) {
  state.seed = project.seed;
  state.worldSize = project.worldSize ?? WORLD_SIZE;
  state.stars = stars;
  state.constellations = project.constellations;
  state.magnitudeThreshold = clamp(project.magnitudeThreshold, -1.5, 7);
  const rect = canvas.parentElement.getBoundingClientRect();
  state.camera = Camera.fromJSON(project.cameraJSON, rect.width, rect.height);
  state.selectedId = state.constellations[0]?.id ?? null;
  state.connectFirst = null;
  syncPanel();
  draw();
  persistLocal();
}

// ---- Pointer interaction ---------------------------------------------------

const drag = { active: false, moved: false, startX: 0, startY: 0, lastX: 0, lastY: 0 };

function eventPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const pos = eventPosition(event);
  const factor = Math.exp(-event.deltaY * 0.0012);
  state.camera.zoomAt(pos.x, pos.y, factor);
  draw();
  persistLocal();
}, { passive: false });

canvas.addEventListener('pointerdown', (event) => {
  const pos = eventPosition(event);
  drag.active = true;
  drag.moved = false;
  drag.startX = drag.lastX = pos.x;
  drag.startY = drag.lastY = pos.y;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  const pos = eventPosition(event);
  if (drag.active) {
    const dx = pos.x - drag.lastX;
    const dy = pos.y - drag.lastY;
    if (Math.hypot(pos.x - drag.startX, pos.y - drag.startY) > 4) drag.moved = true;
    drag.lastX = pos.x;
    drag.lastY = pos.y;
    state.camera.pan(dx, dy);
    canvas.classList.add('panning');
    draw();
    return;
  }
  updateHover(pos);
});

canvas.addEventListener('pointerup', (event) => {
  canvas.classList.remove('panning');
  drag.active = false;
  const pos = eventPosition(event);
  if (drag.moved) {
    persistLocal();
    return;
  }
  handleClick(pos);
});

function updateHover(pos) {
  const world = state.camera.screenToWorld(pos.x, pos.y);
  const tolerance = 14 / state.camera.scale;
  const star = pickStar(state.stars, world.x, world.y, tolerance);
  state.hoveredStarId = star?.id ?? null;
  if (star) {
    tooltip.hidden = false;
    tooltip.style.left = `${pos.x + 14}px`;
    tooltip.style.top = `${pos.y + 14}px`;
    tooltip.textContent = `${star.id} · 星等 ${star.magnitude.toFixed(2)}`;
  } else {
    tooltip.hidden = true;
  }
  draw();
}

function handleClick(pos) {
  const world = state.camera.screenToWorld(pos.x, pos.y);
  const tolerance = 14 / state.camera.scale;
  const star = pickStar(state.stars, world.x, world.y, tolerance);
  if (!star) return;

  if (state.mode === 'connect') {
    handleConnectClick(star);
  } else {
    selectConstellationOfStar(star);
  }
}

function handleConnectClick(star) {
  const constellation = selected();
  if (!constellation) {
    setStatus('请先在右侧选择或新建一个星座', false);
    return;
  }
  if (!constellation.starIds.includes(star.id)) {
    addStar(constellation, star.id);
    state.connectFirst = star.id;
    setStatus(`已把 ${star.id} 加入「${constellation.name}」，再点一颗星连线`);
  } else if (!state.connectFirst) {
    state.connectFirst = star.id;
    setStatus(`起点 ${star.id}，再点同星座的另一颗星`);
  } else if (state.connectFirst === star.id) {
    state.connectFirst = null;
    setStatus('已取消连线起点');
  } else {
    const added = toggleEdge(constellation, state.connectFirst, star.id);
    setStatus(added
      ? `已连接 ${state.connectFirst} ↔ ${star.id}`
      : `已删除连线 ${state.connectFirst} ↔ ${star.id}`);
    state.connectFirst = null;
  }
  syncPanel();
  draw();
  persistLocal();
}

function selectConstellationOfStar(star) {
  const owner = state.constellations.find((c) => c.starIds.includes(star.id));
  if (owner) {
    state.selectedId = owner.id;
    setStatus(`选中「${owner.name}」`);
    syncPanel();
    draw();
  }
}

function selected() {
  return state.constellations.find((c) => c.id === state.selectedId) ?? null;
}

// ---- Panel -----------------------------------------------------------------

const listEl = document.getElementById('constellationList');
const editorEl = document.getElementById('editor');

function syncPanel() {
  listEl.innerHTML = '';
  for (const constellation of state.constellations) {
    const item = document.createElement('li');
    if (constellation.id === state.selectedId) item.classList.add('selected');
    const visibleNow = isConstellationInRange(constellation, state.magnitudeThreshold);
    item.innerHTML =
      `<span class="dot" style="background:${constellation.color}"></span>` +
      `<span>${constellation.name}</span>` +
      `<span class="meta">${constellation.starIds.length}星 ${constellation.edges.length}线` +
      `${visibleNow ? '' : ' · 范围外'}</span>`;
    item.addEventListener('click', () => {
      state.selectedId = constellation.id;
      state.connectFirst = null;
      syncPanel();
      draw();
    });
    listEl.appendChild(item);
  }

  const constellation = selected();
  editorEl.hidden = !constellation;
  if (!constellation) return;
  document.getElementById('editName').value = constellation.name;
  document.getElementById('editMagMin').value = constellation.magRange[0];
  document.getElementById('editMagMax').value = constellation.magRange[1];
  document.getElementById('editColor').value = constellation.color;
}

function setMode(mode) {
  state.mode = mode;
  state.connectFirst = null;
  document.getElementById('modePan').classList.toggle('active', mode === 'pan');
  document.getElementById('modeConnect').classList.toggle('active', mode === 'connect');
  canvas.classList.toggle('connecting', mode === 'connect');
}

document.getElementById('modePan').addEventListener('click', () => setMode('pan'));
document.getElementById('modeConnect').addEventListener('click', () => setMode('connect'));

document.getElementById('magnitude').addEventListener('input', (event) => {
  state.magnitudeThreshold = Number(event.target.value);
  document.getElementById('magnitudeValue').textContent =
    state.magnitudeThreshold.toFixed(1);
  syncPanel();
  draw();
  persistLocal();
});

document.getElementById('zoomIn').addEventListener('click', () => {
  state.camera.zoomAt(state.camera.viewWidth / 2, state.camera.viewHeight / 2, 1.25);
  draw();
  persistLocal();
});
document.getElementById('zoomOut').addEventListener('click', () => {
  state.camera.zoomAt(state.camera.viewWidth / 2, state.camera.viewHeight / 2, 0.8);
  draw();
  persistLocal();
});
document.getElementById('resetView').addEventListener('click', () => {
  const rect = canvas.parentElement.getBoundingClientRect();
  state.camera = new Camera({ viewWidth: rect.width, viewHeight: rect.height });
  draw();
  persistLocal();
});

document.getElementById('newConstellation').addEventListener('click', () => {
  const palette = ['#7dd3fc', '#f0abfc', '#fcd34d', '#86efac', '#fdba74'];
  const constellation = createConstellation({
    name: `星座 ${state.constellations.length + 1}`,
    color: palette[state.constellations.length % palette.length],
  });
  state.constellations.push(constellation);
  state.selectedId = constellation.id;
  setMode('connect');
  setStatus('已新建星座，进入连线模式：点选星点即可加入并连线');
  syncPanel();
  draw();
  persistLocal();
});

document.getElementById('editName').addEventListener('input', (event) => {
  const constellation = selected();
  if (!constellation) return;
  renameConstellation(constellation, event.target.value);
  syncPanel();
  draw();
  persistLocal();
});
function applyMagMin(event) {
  const constellation = selected();
  if (!constellation) return;
  setMagRange(constellation, Number(event.target.value), constellation.magRange[1]);
  event.target.value = constellation.magRange[0];
  syncPanel();
  draw();
  persistLocal();
}
function applyMagMax(event) {
  const constellation = selected();
  if (!constellation) return;
  setMagRange(constellation, constellation.magRange[0], Number(event.target.value));
  event.target.value = constellation.magRange[1];
  syncPanel();
  draw();
  persistLocal();
}
document.getElementById('editMagMin').addEventListener('change', applyMagMin);
document.getElementById('editMagMin').addEventListener('input', applyMagMin);
document.getElementById('editMagMax').addEventListener('change', applyMagMax);
document.getElementById('editMagMax').addEventListener('input', applyMagMax);
document.getElementById('editColor').addEventListener('input', (event) => {
  const constellation = selected();
  if (!constellation) return;
  constellation.color = event.target.value;
  syncPanel();
  draw();
  persistLocal();
});

document.getElementById('removeSelected').addEventListener('click', () => {
  const constellation = selected();
  if (!constellation || !state.hoveredStarId) {
    setStatus('先在画布上悬停一颗星，再移除它', false);
    return;
  }
  removeStar(constellation, state.hoveredStarId);
  setStatus(`已从「${constellation.name}」移除 ${state.hoveredStarId} 及其连线`);
  state.hoveredStarId = null;
  syncPanel();
  draw();
  persistLocal();
});

document.getElementById('deleteConstellation').addEventListener('click', () => {
  const constellation = selected();
  if (!constellation) return;
  state.constellations = state.constellations.filter((c) => c.id !== constellation.id);
  state.selectedId = state.constellations[0]?.id ?? null;
  setStatus(`已删除星座「${constellation.name}」（重新载入工程可恢复）`);
  syncPanel();
  draw();
  persistLocal();
});

document.getElementById('saveProject').addEventListener('click', saveToFile);
document.getElementById('loadProject').addEventListener('click', () => {
  document.getElementById('fileInput').click();
});
document.getElementById('fileInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    loadFromText(await file.text(), file.name);
  } catch (error) {
    setStatus(`载入失败：${error.message}`, false);
  }
  event.target.value = '';
});

document.getElementById('resetDemo').addEventListener('click', () => {
  state.constellations = buildDemoConstellations(state.stars);
  state.selectedId = state.constellations[0]?.id ?? null;
  const rect = canvas.parentElement.getBoundingClientRect();
  state.camera = new Camera({ viewWidth: rect.width, viewHeight: rect.height });
  setStatus('已重建两个示例星座');
  syncPanel();
  draw();
  persistLocal();
});

// ---- Bootstrap -------------------------------------------------------------

function boot() {
  state.stars = generateStars({ seed: state.seed, worldSize: state.worldSize });
  const rect = canvas.parentElement.getBoundingClientRect();
  state.camera = new Camera({ viewWidth: rect.width, viewHeight: rect.height });
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      loadFromText(saved, '本地自动保存');
      return;
    } catch (error) {
      console.warn('本地工程损坏，回退到示例', error);
    }
  }
  state.constellations = buildDemoConstellations(state.stars);
  state.selectedId = state.constellations[0]?.id ?? null;
  document.getElementById('magnitude').value = String(state.magnitudeThreshold);
  document.getElementById('magnitudeValue').textContent =
    state.magnitudeThreshold.toFixed(1);
  syncPanel();
  draw();
}

window.addEventListener('resize', draw);
boot();

// Exposed for automated browser verification.
window.__starApp = {
  state,
  draw,
  serialize: () => serializeProject({
    seed: state.seed,
    worldSize: state.worldSize,
    magnitudeThreshold: state.magnitudeThreshold,
    constellations: state.constellations,
    camera: state.camera,
  }),
  loadFromText,
  setMode,
};
