/* 应用主控：状态、实时求解、拖动、关键帧存取与导出。 */
(function () {
  'use strict';

  var canvas = document.getElementById('stage');
  var statusEl = document.getElementById('status');
  var conflictEl = document.getElementById('conflict');
  var frameListEl = document.getElementById('frameList');
  var store = KeyframeStore.createStore();

  var state = null;
  var lastResult = null;
  var drag = null;

  function buildSolverInput() {
    return {
      stage: state.stage,
      characters: state.characters,
      set: state.set,
      focal: state.focal,
      aspect: state.aspect,
      lock: state.lock,
      relax: state.relax
    };
  }

  function recompute() {
    lastResult = CameraSolver.solve(buildSolverInput());
    CameraRenderer.render(canvas, state, lastResult);
    updatePanels();
  }

  function updatePanels() {
    if (lastResult.feasible) {
      statusEl.className = 'status ok';
      statusEl.textContent = '可行：相机中心 (' +
        lastResult.camera.x.toFixed(1) + ', ' + lastResult.camera.y.toFixed(1) +
        ')，取景框 ' + lastResult.viewW.toFixed(0) + ' × ' +
        lastResult.viewH.toFixed(0) +
        (state.lock != null ? '，已锁定角色 ' + state.characters[state.lock].name : '');
      conflictEl.hidden = true;
      conflictEl.innerHTML = '';
    } else {
      statusEl.className = 'status bad';
      statusEl.textContent = '无解：当前约束下不存在可行机位';
      conflictEl.hidden = false;
      conflictEl.innerHTML = '<strong>冲突来源：</strong><ul>' +
        lastResult.conflicts.map(function (c) { return '<li>' + c.message + '</li>'; }).join('') +
        '</ul>';
    }
  }

  function loadScene(id) {
    state = CameraScenarios.load(id);
    state.scenarioId = id;
    syncControls();
    recompute();
  }

  function syncControls() {
    document.getElementById('focal').value = state.focal;
    document.getElementById('focalValue').textContent = state.focal;
    document.getElementById('margin').value = state.characters[0].margin;
    document.getElementById('marginValue').textContent = state.characters[0].margin;
    document.getElementById('relaxStage').checked = state.relax.stage;
    document.getElementById('relaxSet').checked = state.relax.set;
    var lockValue = state.lock == null ? '-1' : String(state.lock);
    var radios = document.querySelectorAll('input[name="lock"]');
    radios.forEach(function (r) { r.checked = r.value === lockValue; });
  }

  function canvasPoint(evt) {
    var rectBox = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rectBox.left) * canvas.width / rectBox.width,
      y: (evt.clientY - rectBox.top) * canvas.height / rectBox.height
    };
  }

  function hitCharacter(p) {
    for (var i = state.characters.length - 1; i >= 0; i--) {
      var ch = state.characters[i];
      if (Math.hypot(p.x - ch.x, p.y - ch.y) <= ch.r + 6) return i;
    }
    return -1;
  }

  canvas.addEventListener('pointerdown', function (evt) {
    var p = canvasPoint(evt);
    var idx = hitCharacter(p);
    if (idx < 0) return;
    drag = { index: idx };
    canvas.classList.add('dragging');
    canvas.setPointerCapture(evt.pointerId);
  });

  canvas.addEventListener('pointermove', function (evt) {
    if (!drag) return;
    var p = canvasPoint(evt);
    var ch = state.characters[drag.index];
    var r = ch.r + (ch.margin || 0);
    ch.x = Math.max(state.stage.x + r, Math.min(state.stage.x + state.stage.w - r, p.x));
    ch.y = Math.max(state.stage.y + r, Math.min(state.stage.y + state.stage.h - r, p.y));
    recompute();
  });

  canvas.addEventListener('pointerup', function (evt) {
    drag = null;
    canvas.classList.remove('dragging');
    try { canvas.releasePointerCapture(evt.pointerId); } catch (e) { /* ignore */ }
  });

  document.querySelectorAll('button[data-scene]').forEach(function (btn) {
    btn.addEventListener('click', function () { loadScene(btn.dataset.scene); });
  });

  document.getElementById('focal').addEventListener('input', function (evt) {
    state.focal = Number(evt.target.value);
    document.getElementById('focalValue').textContent = state.focal;
    recompute();
  });

  document.getElementById('margin').addEventListener('input', function (evt) {
    var m = Number(evt.target.value);
    state.characters.forEach(function (ch) { ch.margin = m; });
    document.getElementById('marginValue').textContent = m;
    recompute();
  });

  document.querySelectorAll('input[name="lock"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      var v = Number(radio.value);
      state.lock = v < 0 ? null : v;
      recompute();
    });
  });

  document.getElementById('relaxStage').addEventListener('change', function (evt) {
    state.relax.stage = evt.target.checked;
    recompute();
  });

  document.getElementById('relaxSet').addEventListener('change', function (evt) {
    state.relax.set = evt.target.checked;
    recompute();
  });

  document.getElementById('saveFrame').addEventListener('click', function () {
    var note = window.prompt('关键帧备注（可留空）', '');
    if (note === null) return;
    store.save(store.snapshot(state, lastResult, note));
    renderFrameList();
  });

  document.getElementById('clearFrames').addEventListener('click', function () {
    store.clear();
    renderFrameList();
  });

  document.getElementById('exportFrames').addEventListener('click', function () {
    var blob = new Blob([store.exportJSON()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'camera-keyframes.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  function restoreFrame(id) {
    var frame = store.list().find(function (f) { return f.id === id; });
    if (!frame) return;
    var restored = store.restore(frame);
    state = Object.assign({}, restored, { scenarioId: restored.scenarioId });
    syncControls();
    recompute();
  }

  function renderFrameList() {
    var frames = store.list();
    frameListEl.innerHTML = '';
    frames.forEach(function (f) {
      var li = document.createElement('li');
      var label = f.note || ('关键帧 ' + new Date(f.time).toLocaleTimeString());
      var stateText = f.result && f.result.feasible
        ? '<span class="ok-text">可行</span>'
        : '<span class="bad-text">无解</span>';
      li.innerHTML = '<div>' + label + ' · ' + stateText + '</div>' +
        '<div>' + f.focal + 'mm · ' + (f.result && f.result.camera
          ? '机位 ' + f.result.camera.x.toFixed(0) + ',' + f.result.camera.y.toFixed(0)
          : '无机位') + '</div>';
      var actions = document.createElement('div');
      actions.className = 'frame-actions';
      var restoreBtn = document.createElement('button');
      restoreBtn.textContent = '恢复';
      restoreBtn.addEventListener('click', function () { restoreFrame(f.id); });
      var delBtn = document.createElement('button');
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', function () { store.remove(f.id); renderFrameList(); });
      actions.appendChild(restoreBtn);
      actions.appendChild(delBtn);
      li.appendChild(actions);
      frameListEl.appendChild(li);
    });
  }

  loadScene('solvable');
  renderFrameList();
})();
