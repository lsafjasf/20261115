import {
  createState, currentMetrics, advanceSource, rebuildPath, simulateSweep,
  PATH_PRESETS, listSavedScenes, saveScene, deleteScene, exportScene, applyScene,
} from './scene-state.js';
import { sabineRT60 } from './acoustics.js';
import { AudioEngine } from './audio-engine.js';
import { RoomRenderer } from './renderer.js';
import { runSelfTest, startLoop } from './app-loop.js';

function bindSelfTest() {
  $('btnSelfTest').addEventListener('click', () => runSelfTest(state));
}

const $ = (id) => document.getElementById(id);

const state = createState();
const engine = new AudioEngine();
const renderer = new RoomRenderer($('scene'));

const yawToForward = (deg) => {
  const r = (deg * Math.PI) / 180;
  // 0° 朝向 -Z，顺时针旋转。
  return [Math.sin(r), 0, -Math.cos(r)];
};

function pathText() {
  return state.pathPoints.map((p) => p.map((n) => +n.toFixed(2)).join(', ')).join('\n');
}

function syncForm() {
  const { room, listener } = state;
  $('roomW').value = room.width;
  $('roomH').value = room.height;
  $('roomD').value = room.depth;
  $('absorption').value = room.absorption;
  $('wVal').textContent = `${room.width.toFixed(1)} m`;
  $('hVal').textContent = `${room.height.toFixed(1)} m`;
  $('dVal').textContent = `${room.depth.toFixed(1)} m`;
  $('aVal').textContent = room.absorption.toFixed(2);
  $('rtInline').textContent = `${sabineRT60(room).toFixed(2)} s`;
  $('lisX').value = listener.position[0];
  $('lisY').value = listener.position[1];
  $('lisZ').value = listener.position[2];
  const yaw = Math.atan2(listener.forward[0], -listener.forward[2]) * 180 / Math.PI;
  $('lisYaw').value = Math.round(yaw);
  $('speed').value = state.speed;
  $('speedVal').textContent = `${state.speed.toFixed(2)} m/s`;
  $('wet').value = state.wetMix;
  $('wetVal').textContent = `${Math.round(state.wetMix * 100)}%`;
  $('pingpong').checked = state.pingpong;
  $('pathText').value = pathText();
  document.querySelectorAll('input[name="mode"]').forEach((el) => {
    el.checked = el.value === state.mode;
  });
  $('sourceType').value = state.sourceType;
  $('pathInfo').textContent =
    `路径长 ${state.path.length.toFixed(2)} m · ${state.pathPoints.length} 个途经点`;
}

function bindRoomControls() {
  const roomIds = [
    ['roomW', 'width', 'wVal', ' m'],
    ['roomH', 'height', 'hVal', ' m'],
    ['roomD', 'depth', 'dVal', ' m'],
    ['absorption', 'absorption', 'aVal', ''],
  ];
  for (const [id, key, valId, suffix] of roomIds) {
    $(id).addEventListener('input', () => {
      state.room[key] = parseFloat($(id).value);
      $(valId).textContent = key === 'absorption'
        ? state.room[key].toFixed(2)
        : `${state.room[key].toFixed(1)}${suffix}`;
      $('rtInline').textContent = `${sabineRT60(state.room).toFixed(2)} s`;
      engine.setReverb(sabineRT60(state.room));
    });
  }

  const lisInputs = [['lisX', 0], ['lisY', 1], ['lisZ', 2]];
  for (const [id, idx] of lisInputs) {
    $(id).addEventListener('change', () => {
      state.listener.position[idx] = parseFloat($(id).value) || 0;
    });
  }
  $('lisYaw').addEventListener('input', () => {
    state.listener.forward = yawToForward(parseInt($('lisYaw').value, 10));
  });

  $('speed').addEventListener('input', () => {
    state.speed = parseFloat($('speed').value);
    $('speedVal').textContent = `${state.speed.toFixed(2)} m/s`;
  });
  $('wet').addEventListener('input', () => {
    state.wetMix = parseFloat($('wet').value);
    $('wetVal').textContent = `${Math.round(state.wetMix * 100)}%`;
    engine.setWetMix(state.wetMix);
  });
  $('pingpong').addEventListener('change', () => {
    state.pingpong = $('pingpong').checked;
  });
}

function bindPlayback() {
  $('btnPlay').addEventListener('click', async () => {
    await engine.play();
    engine.setReverb(sabineRT60(state.room));
    engine.setMode(state.mode);
    engine.setWetMix(state.wetMix);
    state.playing = true;
  });
  $('btnPause').addEventListener('click', () => {
    engine.pause();
    state.playing = false;
  });
  document.querySelectorAll('input[name="mode"]').forEach((el) => {
    el.addEventListener('change', () => {
      state.mode = el.value;
      engine.setMode(state.mode);
    });
  });
  $('sourceType').addEventListener('change', () => {
    state.sourceType = $('sourceType').value;
    engine.setSourceType(state.sourceType);
  });
}

function bindPath() {
  $('pathPreset').addEventListener('change', () => {
    const preset = PATH_PRESETS[$('pathPreset').value];
    state.pathPoints = preset.points.map((p) => [...p]);
    state.u = 0;
    state.direction = 1;
    rebuildPath(state);
    syncForm();
  });
  $('applyPath').addEventListener('click', () => {
    try {
      const points = $('pathText').value.split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const nums = line.split(',').map((n) => parseFloat(n.trim()));
          if (nums.length !== 3 || nums.some(Number.isNaN)) throw new Error('bad');
          return nums;
        });
      if (points.length < 2) throw new Error('need 2');
      state.pathPoints = points;
      state.u = 0;
      state.direction = 1;
      rebuildPath(state);
      syncForm();
    } catch {
      alert('路径格式错误：每行三个数字，以逗号分隔，例如\n-4.2, 1.6, -3.6');
    }
  });
  $('resetPath').addEventListener('click', () => {
    $('pathPreset').value = 'crossing';
    $('pathPreset').dispatchEvent(new Event('change'));
  });
}

function bindStorage() {
  refreshSavedList();
  $('btnSave').addEventListener('click', () => {
    const name = $('sceneName').value.trim() || '未命名场景';
    saveScene(name, state);
    refreshSavedList();
  });
  $('btnLoad').addEventListener('click', () => {
    const all = listSavedScenes();
    const scene = all[$('savedList').value];
    if (!scene) return;
    applyScene(state, scene);
    syncForm();
    engine.setMode(state.mode);
    engine.setSourceType(state.sourceType);
    engine.setWetMix(state.wetMix);
    engine.setReverb(sabineRT60(state.room));
  });
  $('btnDelete').addEventListener('click', () => {
    deleteScene($('savedList').value);
    refreshSavedList();
  });
  $('btnExport').addEventListener('click', exportJSON);
  $('btnImport').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', importJSON);
}

function refreshSavedList() {
  const all = listSavedScenes();
  const select = $('savedList');
  select.innerHTML = '';
  const names = Object.keys(all);
  if (!names.length) {
    const opt = document.createElement('option');
    opt.textContent = '（暂无保存）';
    opt.value = '';
    select.append(opt);
    return;
  }
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.append(opt);
  }
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(exportScene($('sceneName').value.trim() || '当前场景', state), null, 2)],
    { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `room-scene-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const scene = JSON.parse(reader.result);
      if (!scene.room || !Array.isArray(scene.pathPoints)) throw new Error('invalid');
      applyScene(state, scene);
      syncForm();
      engine.setMode(state.mode);
      engine.setSourceType(state.sourceType);
      engine.setWetMix(state.wetMix);
      engine.setReverb(sabineRT60(state.room));
    } catch {
      alert('JSON 文件格式无效');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

bindRoomControls();
bindPlayback();
bindPath();
bindStorage();
syncForm();
bindSelfTest();
startLoop(state, renderer, engine);
