(function () {
  'use strict';

  const Core = window.MapCore;
  const T = Core.T;
  const CELL = 40;
  const STORAGE_KEY = 'seed-map-session-v1';

  const canvas = document.getElementById('mapCanvas');
  const ctx = canvas.getContext('2d');
  const seedInput = document.getElementById('seedInput');
  const modeSelect = document.getElementById('modeSelect');
  const tickInput = document.getElementById('tickInput');
  const hintEl = document.getElementById('hint');
  const resultListEl = document.getElementById('resultList');
  const editLogEl = document.getElementById('editLog');
  const budgetEl = document.getElementById('budget');
  const gateInfoEl = document.getElementById('gateInfo');

  let map = null;
  let results = [];
  let selectedGoal = 0;
  let tick = 0;
  let playing = false;
  let playTimer = null;
  let moveSource = null;

  function newMap(seed) {
    map = Core.generateMap(seed);
    results = Core.analyzeMap(map);
    selectedGoal = 0;
    tick = 0;
    tickInput.value = 0;
    moveSource = null;
    seedInput.value = seed;
    saveSession();
    renderAll();
  }

  function recompute() {
    results = Core.analyzeMap(map);
    saveSession();
    renderAll();
  }

  /* ---------------- Canvas 绘制 ---------------- */

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        drawCell(x, y, map.grid[y][x]);
      }
    }
    drawPath();
    drawEntities();
    drawGridLines();
  }

  function drawCell(x, y, cell) {
    const px = x * CELL;
    const py = y * CELL;
    if (cell === T.FLOOR) {
      ctx.fillStyle = '#16203a';
      ctx.fillRect(px, py, CELL, CELL);
      return;
    }
    if (cell === T.WALL) {
      ctx.fillStyle = '#3a4a6b';
      ctx.fillRect(px, py, CELL, CELL);
      ctx.strokeStyle = '#5b6b8c';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 3, py + 3, CELL - 6, CELL - 6);
      return;
    }
    if (cell === T.BREAKABLE) {
      ctx.fillStyle = '#7a4f1d';
      ctx.fillRect(px, py, CELL, CELL);
      ctx.strokeStyle = '#e0a45c';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(px + 4, py + 4, CELL - 8, CELL - 8);
      ctx.setLineDash([]);
      ctx.fillStyle = '#e0a45c';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✕', px + CELL / 2, py + CELL / 2 + 1);
      return;
    }
    if (cell === T.GATE) {
      const open = Core.gateOpenAt(map, x, y, tick);
      ctx.fillStyle = open ? '#0f3a44' : '#123a52';
      ctx.fillRect(px, py, CELL, CELL);
      ctx.strokeStyle = open ? '#43e0a8' : '#43c6e8';
      ctx.lineWidth = 3;
      const gap = open ? 9 : 4;
      for (let i = 0; i < 3; i++) {
        const bx = px + 8 + i * 10;
        ctx.beginPath();
        ctx.moveTo(bx, py + gap);
        ctx.lineTo(bx, py + CELL - gap);
        ctx.stroke();
      }
    }
  }

  function drawGridLines() {
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= map.width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL, 0);
      ctx.lineTo(x * CELL, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= map.height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL);
      ctx.lineTo(canvas.width, y * CELL);
      ctx.stroke();
    }
  }

  function drawPath() {
    const result = results[selectedGoal];
    if (!result || !result.path) return;
    const isGate = result.status === Core.STATUS.GATE;
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = isGate ? '#fbbf24' : '#4ade80';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    result.path.forEach(function (p, i) {
      const cx = p.x * CELL + CELL / 2;
      const cy = p.y * CELL + CELL / 2;
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (isGate) {
      result.path.forEach(function (p) {
        if (!p.wait) return;
        ctx.fillStyle = '#fff7d6';
        ctx.beginPath();
        ctx.arc(p.x * CELL + CELL / 2, p.y * CELL + CELL / 2, 5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  function drawEntities() {
    drawMarker(map.start.x, map.start.y, '#4ade80', 'S');
    map.goals.forEach(function (g, i) {
      const colors = {
        static: '#4ade80',
        gate: '#fbbf24',
        unreachable: '#f87171'
      };
      const color = colors[results[i].status];
      drawMarker(g.x, g.y, color, g.id);
    });
    if (moveSource) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.strokeRect(moveSource.x * CELL + 2, moveSource.y * CELL + 2,
        CELL - 4, CELL - 4);
    }
  }

  function drawMarker(x, y, color, label) {
    const cx = x * CELL + CELL / 2;
    const cy = y * CELL + CELL / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f1420';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy + 1);
  }

  /* ---------------- 侧栏渲染 ---------------- */

  function renderResults() {
    resultListEl.innerHTML = '';
    results.forEach(function (r, i) {
      const li = document.createElement('li');
      li.className = 'result' + (i === selectedGoal ? ' active' : '');
      const labelMap = {
        static: '静止可达',
        gate: '等待闸门可达',
        unreachable: '永久不可达'
      };
      const pos = '(' + r.goal.x + ',' + r.goal.y + ')';
      const row = document.createElement('div');
      row.className = 'row';
      const name = document.createElement('span');
      name.textContent = r.goal.id + ' ' + pos;
      const badge = document.createElement('span');
      badge.className = 'badge ' + r.status;
      badge.textContent = labelMap[r.status];
      row.appendChild(name);
      row.appendChild(badge);
      const detail = document.createElement('div');
      detail.className = 'detail';
      detail.textContent = renderDetail(r);
      li.appendChild(row);
      li.appendChild(detail);
      if (r.status === Core.STATUS.UNREACHABLE &&
          r.reason.indexOf('可破坏墙体') >= 0 && Core.canEdit(map)) {
        const actions = document.createElement('div');
        actions.className = 'actions';
        const btn = document.createElement('button');
        btn.textContent = '高亮可删除墙体';
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          highlightSuggestedBlocker(i);
        });
        actions.appendChild(btn);
        li.appendChild(actions);
      }
      li.addEventListener('click', function () {
        selectedGoal = i;
        renderAll();
      });
      resultListEl.appendChild(li);
    });
  }

  function renderDetail(r) {
    if (r.status === Core.STATUS.STATIC) {
      return '最短静止路径长度 ' + r.path.length + ' 步，无需经过闸门。';
    }
    if (r.status === Core.STATUS.GATE) {
      const waits = r.path.filter(function (p) { return p.wait; }).length;
      return r.reason + '；路径共 ' + r.path.length + ' 个时刻。';
    }
    return '失败原因：' + r.reason + '。';
  }

  function highlightSuggestedBlocker(goalIndex) {
    const r = results[goalIndex];
    const goal = r.goal;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.grid[y][x] !== T.BREAKABLE) continue;
        const trialGrid = Core.cloneGrid(map.grid);
        trialGrid[y][x] = T.FLOOR;
        const trial = Object.assign({}, map, { grid: trialGrid });
        if (Core.floodPath(trial, map.start, goal, false)) {
          hintEl.textContent = '建议删除 (' + x + ',' + y +
            ') 处可破坏墙体，可使 ' + goal.id +
            ' 变为静止可达（请切换到“删除可破坏墙”模式后点击该格）。';
          return;
        }
      }
    }
    hintEl.textContent = '没有找到单格删除即可连通的可破坏墙体。';
  }

  function renderBudget() {
    const used = Core.editCount(map);
    let html = '';
    for (let i = 0; i < Core.MAX_EDITS; i++) {
      html += '<span class="pip ' + (i < used ? 'used' : '') + '">' +
        (i < used ? '✓' : i + 1) + '</span>';
    }
    budgetEl.innerHTML = html;
    const g = map.gate;
    const open = Core.gateOpenAt(map, g.x, g.y, tick);
    gateInfoEl.innerHTML =
      '闸门位置 (' + g.x + ',' + g.y + ')<br>' +
      '周期 ' + g.period + ' tick，仅在 t ≡ ' + g.openAt +
      ' (mod ' + g.period + ') 开放<br>' +
      '当前 tick ' + tick + '：' + (open ? '<b style="color:#43e0a8">开放</b>'
        : '<b style="color:#43c6e8">关闭</b>');
  }

  function renderEditLog() {
    if (!map.editLog.length) {
      editLogEl.innerHTML = '<li class="empty">暂无编辑</li>';
      return;
    }
    editLogEl.innerHTML = map.editLog.map(function (e) {
      const action = e.type === 'delete' ? '删除墙体' :
        '移动墙体 → (' + e.to.x + ',' + e.to.y + ')';
      return '<li>#' + e.seq + ' ' + action + ' @ (' + e.at.x + ',' + e.at.y +
        ') <span style="color:#66738c">' + e.timestamp.slice(11, 19) + '</span></li>';
    }).join('');
  }

  function renderAll() {
    if (!map) return;
    draw();
    renderResults();
    renderBudget();
    renderEditLog();
    updateHint();
  }

  function updateHint() {
    const mode = modeSelect.value;
    if (mode === 'delete') {
      hintEl.textContent = '删除模式：点击任意可破坏墙体（橙色虚线格），删除后自动重新分析全部目标。';
    } else if (mode === 'move') {
      hintEl.textContent = moveSource
        ? '已选中 (' + moveSource.x + ',' + moveSource.y +
          ')，再点击一个空地完成移动。'
        : '移动模式：先点击可破坏墙体，再点击目标空地。';
    } else {
      hintEl.textContent = '查看模式：点击右侧目标卡片可切换显示的路径。';
    }
  }

  /* ---------------- 鼠标编辑 ---------------- */

  canvas.addEventListener('click', function (ev) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - rect.left) / CELL);
    const y = Math.floor((ev.clientY - rect.top) / CELL);
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    const mode = modeSelect.value;

    if (mode === 'inspect') {
      const idx = map.goals.findIndex(function (g) {
        return g.x === x && g.y === y;
      });
      if (idx >= 0) {
        selectedGoal = idx;
        renderAll();
      }
      return;
    }

    if (!Core.canEdit(map)) {
      hintEl.textContent = '编辑预算已用完，可“撤销编辑”或“重置地图”。';
      return;
    }

    try {
      if (mode === 'delete') {
        if (map.grid[y][x] !== T.BREAKABLE) {
          hintEl.textContent = '该格不是可破坏墙体，无法删除。';
          return;
        }
        Core.applyEdit(map, { type: 'delete', x: x, y: y });
        recompute();
        return;
      }

      if (mode === 'move') {
        if (!moveSource) {
          if (map.grid[y][x] !== T.BREAKABLE) {
            hintEl.textContent = '移动模式下，请先点击一面可破坏墙体。';
            return;
          }
          moveSource = { x: x, y: y };
          updateHint();
          draw();
          return;
        }
        if (x === moveSource.x && y === moveSource.y) {
          moveSource = null;
          updateHint();
          draw();
          return;
        }
        Core.applyEdit(map, {
          type: 'move',
          x: moveSource.x,
          y: moveSource.y,
          to: { x: x, y: y }
        });
        moveSource = null;
        recompute();
      }
    } catch (err) {
      hintEl.textContent = '编辑失败：' + err.message;
    }
  });

  /* ---------------- 持久化 / 导出 ---------------- */

  function saveSession() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        seed: map.seed,
        editLog: map.editLog,
        grid: map.grid
      }));
    } catch (err) {
      /* 隐私模式等场景下静默降级 */
    }
  }

  function loadSession() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return false;
    }
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      map = Core.generateMap(data.seed);
      if (Array.isArray(data.grid)) map.grid = data.grid;
      map.editLog = Array.isArray(data.editLog) ? data.editLog : [];
      results = Core.analyzeMap(map);
      selectedGoal = 0;
      seedInput.value = data.seed;
      renderAll();
      return true;
    } catch (err) {
      return false;
    }
  }

  function exportRecord() {
    const payload = {
      seed: map.seed,
      exportedAt: new Date().toISOString(),
      gate: map.gate,
      start: map.start,
      goals: map.goals,
      editLog: map.editLog,
      reachability: results.map(function (r) {
        return {
          goal: r.goal.id,
          position: { x: r.goal.x, y: r.goal.y },
          status: r.status,
          reason: r.reason,
          pathLength: r.path ? r.path.length : 0
        };
      })
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)],
      { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'seed-' + map.seed + '-record.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------------- 事件绑定 ---------------- */

  document.getElementById('genBtn').addEventListener('click', function () {
    const seed = Number(seedInput.value) >>> 0;
    newMap(seed);
  });

  document.getElementById('randomBtn').addEventListener('click', function () {
    newMap(Math.floor(Math.random() * 4294967295));
  });

  document.getElementById('resetBtn').addEventListener('click', function () {
    newMap(map.seed);
  });

  document.getElementById('undoBtn').addEventListener('click', function () {
    const record = Core.undoLastEdit(map);
    if (record) recompute();
  });

  document.getElementById('exportBtn').addEventListener('click', exportRecord);

  modeSelect.addEventListener('change', function () {
    moveSource = null;
    updateHint();
    draw();
  });

  tickInput.addEventListener('change', function () {
    tick = Math.max(0, parseInt(tickInput.value, 10) || 0);
    tickInput.value = tick;
    renderAll();
  });

  document.getElementById('playBtn').addEventListener('click', function () {
    playing = !playing;
    document.getElementById('playBtn').textContent =
      playing ? '暂停播放' : '自动播放';
    if (playing) {
      playTimer = setInterval(function () {
        tick += 1;
        tickInput.value = tick;
        draw();
        renderBudget();
      }, 700);
    } else {
      clearInterval(playTimer);
    }
  });

  if (!loadSession()) {
    newMap(2024);
  }
})();

