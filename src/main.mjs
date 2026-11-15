import { CityApp } from './core.mjs';
import { AXES } from './clipping.mjs';
import { generateCity, buildingHeight } from './citygen.mjs';
import { SEEDS } from './selftest.mjs';
import { USAGE_TYPES, USAGE_LABELS } from './palette.mjs';
import {
  saveToLocal, loadFromLocal, hasLocalSave, downloadScene, uploadScene,
} from './storage.mjs';
import { runSelfTest } from './selftest.mjs';

const $ = (id) => document.getElementById(id);
const AXIS_NAME = { x: 'X 轴', y: 'Y 轴', z: 'Z 轴' };
const AXIS_DOT = { x: '#e5484d', y: '#34a853', z: '#4285f4' };

const app = new CityApp($('view'), $('status'));
let selected = null;

// Seed dropdown: one default city plus two named seeds (all >= 10 buildings).
const seedSelect = $('seedSelect');
for (const seed of SEEDS) {
  const option = document.createElement('option');
  option.value = seed;
  option.textContent = seed;
  seedSelect.appendChild(option);
}

function buildAxisControls() {
  const wrap = $('axisControls');
  wrap.innerHTML = '';
  for (const axis of AXES) {
    const [min, max] = app.clip.range(axis);
    const row = document.createElement('div');
    row.className = 'axis-row';
    row.dataset.axis = axis;
    row.innerHTML = `
      <header>
        <label><input type="checkbox" data-role="enable" />
          <span class="dot" style="background:${AXIS_DOT[axis]}"></span>${AXIS_NAME[axis]}</label>
        <span class="value" data-role="value">0.0</span>
      </header>
      <input type="range" min="${min}" max="${max}" step="0.1" value="0" data-role="slider" />`;
    const enable = row.querySelector('[data-role="enable"]');
    const slider = row.querySelector('[data-role="slider"]');
    const value = row.querySelector('[data-role="value"]');
    enable.addEventListener('change', () => {
      app.clip.toggle(axis, enable.checked);
      app.onClipChange = syncClipUi;
      if (!enable.checked) app.gizmo.hideGuide();
      app.setStatus(`${AXIS_NAME[axis]}剖切已${enable.checked ? '启用' : '关闭'}`);
    });
    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      app.clip.setAxis(axis, { value: v });
      value.textContent = v.toFixed(1);
      app.gizmo.showGuide(axis, v);
      app.setStatus(`${AXIS_NAME[axis]}剖切位置 ${v.toFixed(1)}（保留坐标较小一侧）`);
    });
    slider.addEventListener('change', () => app.gizmo.hideGuide());
    wrap.appendChild(row);
  }
}

function syncClipUi() {
  for (const row of $('axisControls').querySelectorAll('.axis-row')) {
    const axis = row.dataset.axis;
    const state = app.clip.state[axis];
    row.querySelector('[data-role="enable"]').checked = state.enabled;
    const slider = row.querySelector('[data-role="slider"]');
    slider.value = state.value;
    row.querySelector('[data-role="value"]').textContent = state.value.toFixed(1);
  }
}

function openEdit(building) {
  selected = building;
  $('editPanel').classList.remove('hidden');
  $('editId').textContent = building.id;
  $('editFloors').value = building.floors;
  $('editFloorHeight').value = building.floorHeight.toFixed(1);
  const usage = $('editUsage');
  usage.innerHTML = '';
  for (const type of USAGE_TYPES) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = USAGE_LABELS[type];
    option.selected = type === building.usage;
    usage.appendChild(option);
  }
  refreshOutline(building);
}

function refreshOutline(building) {
  $('editHeight').textContent = `${buildingHeight(building).toFixed(1)} m`;
  $('editFootprint').textContent =
    `${building.width.toFixed(1)} × ${building.depth.toFixed(1)} m`;
}

function commitEdit() {
  if (!selected) return;
  const updated = {
    id: selected.id,
    floors: Math.max(1, Math.round(Number($('editFloors').value))),
    floorHeight: Number($('editFloorHeight').value),
    usage: $('editUsage').value,
  };
  const result = app.updateBuilding(updated);
  selected = result.building;
  refreshOutline(result.building);
  app.setStatus(`建筑 ${selected.id} 已重建：${result.outline.floors} 层，高 ${result.outline.height.toFixed(1)} m，剖面即时同步`);
}

// Pointerdown distinguishes a building click from an orbit-drag via movement threshold.
let downPos = null;
$('view').addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY }; });
$('view').addEventListener('pointerup', (e) => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 6) return;
  const building = app.pickBuilding(e);
  if (building) openEdit(building);
});

$('editFloors').addEventListener('input', commitEdit);
$('editFloorHeight').addEventListener('input', commitEdit);
$('editUsage').addEventListener('change', commitEdit);
$('closeEdit').addEventListener('click', () => {
  $('editPanel').classList.add('hidden');
  selected = null;
});

$('regenBtn').addEventListener('click', () => {
  app.regenerate(seedSelect.value);
  buildAxisControls();
});
seedSelect.addEventListener('change', () => {
  app.regenerate(seedSelect.value);
  buildAxisControls();
});

$('saveBtn').addEventListener('click', () => {
  const size = saveToLocal(app.model, app.clip.snapshot());
  app.setStatus(`场景已保存到浏览器（${size} 字节），含 ${app.model.buildings.length} 栋建筑与剖切状态`);
});
$('loadBtn').addEventListener('click', () => {
  const data = loadFromLocal();
  if (!data) return app.setStatus('没有找到本地存档');
  app.loadModel(data.model, data.clipping);
  buildAxisControls();
  syncClipUi();
});
$('exportBtn').addEventListener('click', () => downloadScene(app.model, app.clip.snapshot()));
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = await uploadScene(file);
    app.loadModel(data.model, data.clipping);
    buildAxisControls();
    syncClipUi();
  } catch (err) {
    app.setStatus(`导入失败：${err.message}`);
  }
});

$('shotBtn').addEventListener('click', () => {
  const url = app.screenshot();
  const a = document.createElement('a');
  a.href = url;
  a.download = `city-section-${Date.now()}.png`;
  a.click();
  app.setStatus('截图已保存：辅助手柄与剖切辅助线均已隐藏');
});

$('testBtn').addEventListener('click', () => {
  const report = runSelfTest();
  const box = $('testResults');
  box.classList.remove('hidden');
  box.innerHTML = `<b>自检 ${report.passed}/${report.total} 通过</b>` +
    report.results.map((r) =>
      `<pre class="${r.ok ? 'ok' : 'fail'}">${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ` → ${r.error}`}</pre>`).join('');
});

// Boot: restore a local save when present, otherwise build the default deterministic city.
if (hasLocalSave()) {
  const data = loadFromLocal();
  seedSelect.value = data.model.seed;
  app.loadModel(data.model, data.clipping);
} else {
  app.loadModel(generateCity(SEEDS[0]), null);
}
buildAxisControls();
syncClipUi();
app.start();
window.__cityApp = app;
