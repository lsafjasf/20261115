(function () {
  'use strict';

  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var renderer = new Renderer.Renderer(ctx);
  var history = null;
  var selected = { kind: null, id: null };
  var drag = null;
  var workingPlan = null;

  function currentPlan() {
    return workingPlan;
  }

  function commit(nextPlan) {
    workingPlan = nextPlan;
    history.push(nextPlan);
    renderAll();
  }

  function findNode(plan, id) {
    return plan.nodes.filter(function (n) { return n.id === id; })[0];
  }

  function findEdge(plan, id) {
    return plan.edges.filter(function (e) { return e.id === id; })[0];
  }

  function undo() {
    var state = history.undo();
    if (state) {
      workingPlan = state;
      pruneSelection(state);
      renderAll();
    }
  }

  function redo() {
    var state = history.redo();
    if (state) {
      workingPlan = state;
      pruneSelection(state);
      renderAll();
    }
  }

  function pruneSelection(plan) {
    if (selected.kind === 'node' && !findNode(plan, selected.id)) {
      selected = { kind: null, id: null };
    }
    if (selected.kind === 'edge' && !findEdge(plan, selected.id)) {
      selected = { kind: null, id: null };
    }
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function savePlan() {
    var plan = currentPlan();
    download((plan.name || 'water-plan') + '.json', JSON.stringify(plan, null, 2));
  }

  function loadPlanText(text) {
    var plan = JSON.parse(text);
    if (!Array.isArray(plan.nodes) || !Array.isArray(plan.edges)) {
      throw new Error('JSON 缺少 nodes 或 edges 数组');
    }
    history = new History(plan);
    workingPlan = history.current();
    selected = { kind: null, id: null };
    renderAll();
  }

  function resetDemo() {
    fetch('data/demo-plan.json')
      .then(function (res) { return res.json(); })
      .then(function (plan) {
        history = new History(plan);
        workingPlan = history.current();
        selected = { kind: null, id: null };
        renderAll();
      });
  }

  function distanceToEdge(px, py, edge, plan) {
    var from = findNode(plan, edge.from);
    var to = findNode(plan, edge.to);
    var vx = to.x - from.x;
    var vy = to.y - from.y;
    var lengthSquared = vx * vx + vy * vy || 1;
    var t = ((px - from.x) * vx + (py - from.y) * vy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    var closestX = from.x + t * vx;
    var closestY = from.y + t * vy;
    return Math.hypot(px - closestX, py - closestY);
  }

  function hitTest(px, py) {
    var plan = currentPlan();
    for (var i = plan.nodes.length - 1; i >= 0; i--) {
      var node = plan.nodes[i];
      var radius = node.kind === 'junction' ? 11 : 15;
      if (Math.hypot(px - node.x, py - node.y) <= radius) {
        return { kind: 'node', id: node.id };
      }
    }
    var best = null;
    plan.edges.forEach(function (edge) {
      var distance = distanceToEdge(px, py, edge, plan);
      var tolerance = Math.max(8, edge.diameter * 26 / 2 + 6);
      if (distance <= tolerance && (!best || distance < best.distance)) {
        best = { kind: 'edge', id: edge.id, distance: distance };
      }
    });
    if (best) return { kind: 'edge', id: best.id };
    return { kind: null, id: null };
  }

  function pointerPosition(event) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  canvas.addEventListener('mousedown', function (event) {
    var point = pointerPosition(event);
    var hit = hitTest(point.x, point.y);
    selected = hit;
    if (hit.kind === 'node') {
      var node = findNode(currentPlan(), hit.id);
      drag = {
        type: 'node',
        id: hit.id,
        startX: point.x,
        startY: point.y,
        originalX: node.x,
        originalY: node.y,
        moved: false
      };
    } else if (hit.kind === 'edge') {
      var edge = findEdge(currentPlan(), hit.id);
      var fromNode = findNode(currentPlan(), edge.from);
      var toNode = findNode(currentPlan(), edge.to);
      var midX = (fromNode.x + toNode.x) / 2;
      var midY = (fromNode.y + toNode.y) / 2;
      var nearFrom = Math.hypot(point.x - fromNode.x, point.y - fromNode.y);
      var nearTo = Math.hypot(point.x - toNode.x, point.y - toNode.y);
      var nearMid = Math.hypot(point.x - midX, point.y - midY);
      if (nearMid <= nearFrom && nearMid <= nearTo) {
        drag = {
          type: 'edge',
          ids: [edge.from, edge.to],
          startX: point.x,
          startY: point.y,
          moved: false
        };
      } else {
        var endpointId = nearFrom <= nearTo ? edge.from : edge.to;
        var endpoint = findNode(currentPlan(), endpointId);
        selected = { kind: 'node', id: endpointId };
        drag = {
          type: 'node',
          id: endpointId,
          startX: point.x,
          startY: point.y,
          originalX: endpoint.x,
          originalY: endpoint.y,
          moved: false
        };
      }
    }
    renderAll();
  });

  canvas.addEventListener('mousemove', function (event) {
    if (!drag) {
      var point = pointerPosition(event);
      var hover = hitTest(point.x, point.y);
      canvas.style.cursor = hover.kind ? 'pointer' : 'default';
      return;
    }
    var point = pointerPosition(event);
    if (Math.hypot(point.x - drag.startX, point.y - drag.startY) > 2) {
      drag.moved = true;
    }
    var plan = currentPlan();
    var dx = Math.round(point.x - drag.startX);
    var dy = Math.round(point.y - drag.startY);
    if (drag.type === 'node') {
      var node = findNode(plan, drag.id);
      node.x = drag.originalX + dx;
      node.y = drag.originalY + dy;
    } else {
      drag.ids.forEach(function (id) {
        var target = findNode(plan, id);
        if (!drag.originals) {
          drag.originals = {};
        }
        if (!drag.originals[id]) {
          drag.originals[id] = { x: target.x, y: target.y };
        }
        target.x = drag.originals[id].x + dx;
        target.y = drag.originals[id].y + dy;
      });
    }
    renderAll();
  });

  window.addEventListener('mouseup', function () {
    if (drag && drag.moved) {
      commit(currentPlan());
    }
    drag = null;
  });

  canvas.addEventListener('mouseleave', function () {
    canvas.style.cursor = 'default';
  });

  function renderAll() {
    if (!workingPlan) return;
    var report = HydraulicEngine.analyze(workingPlan);
    drawCanvas(report);
    renderInspector(report);
    renderResults(report);
    renderIssues(report);
    document.getElementById('btn-undo').disabled = !history.canUndo();
    document.getElementById('btn-redo').disabled = !history.canRedo();
  }

  function drawCanvas(report) {
    renderer.drawFactory(canvas.width, canvas.height);
    var pressures = report.solution.nodes
      .map(function (n) { return n.pressureKpa; })
      .filter(function (value) { return value !== null && value !== undefined; });
    var minKpa = Math.min.apply(null, pressures);
    var maxKpa = Math.max.apply(null, pressures);
    var nodePressure = {};
    report.solution.nodes.forEach(function (n) {
      nodePressure[n.id] = n.pressureKpa;
    });

    workingPlan.edges.forEach(function (edge) {
      var result = report.solution.edges.filter(function (r) {
        return r.id === edge.id;
      })[0];
      var from = findNode(workingPlan, edge.from);
      var to = findNode(workingPlan, edge.to);
      var pFrom = nodePressure[edge.from];
      var pTo = nodePressure[edge.to];
      var color = '#94a3b8';
      if (pFrom !== null && pTo !== null &&
        pFrom !== undefined && pTo !== undefined) {
        color = Renderer.pressureColor((pFrom + pTo) / 2, minKpa, maxKpa);
      }
      renderer.drawEdge(edge, from, to, result, color,
        selected.kind === 'edge' && selected.id === edge.id);
    });

    workingPlan.nodes.forEach(function (node) {
      renderer.drawNode(node, nodePressure[node.id],
        selected.kind === 'node' && selected.id === node.id);
    });
    renderer.drawLegend(20, canvas.height - 46, minKpa, maxKpa);
  }

  function field(label, inputHtml) {
    return '<label class="field"><span>' + label + '</span>' + inputHtml + '</label>';
  }

  function renderInspector() {
    var container = document.getElementById('inspector');
    if (!selected.kind) {
      container.innerHTML = '<p class="muted">未选择任何对象</p>';
      return;
    }
    if (selected.kind === 'node') {
      var node = findNode(workingPlan, selected.id);
      var kindName = { source: '水源', junction: '连接节点', demand: '用水设备' }[node.kind];
      var html = field('名称', '<input data-edit="name" value="' + (node.name || '') + '">');
      html += field('类型', '<input value="' + kindName + '" disabled>');
      html += field('X 坐标', '<input type="number" data-edit="x" value="' + node.x + '">');
      html += field('Y 坐标', '<input type="number" data-edit="y" value="' + node.y + '">');
      if (node.kind === 'source') {
        html += field('供水水头 (m)',
          '<input type="number" step="0.1" data-edit="head" value="' + node.head + '">');
      }
      if (node.kind === 'demand') {
        html += field('需水量 (L/s)',
          '<input type="number" step="0.5" data-edit="demandLs" value="' +
          (node.demand * 1000) + '">');
      }
      container.innerHTML = html;
    } else {
      var edge = findEdge(workingPlan, selected.id);
      var valveKind = edge.valve ? edge.valve.kind : 'open';
      var allowDirection = edge.valve ? edge.valve.allowDirection || 'forward' : 'forward';
      var edgeHtml = field('管段编号', '<input value="' + edge.id + '" disabled>');
      edgeHtml += field('连接',
        '<input value="' + edge.from + ' → ' + edge.to + '" disabled>');
      edgeHtml += field('管径 (mm)',
        '<input type="number" step="10" data-edit="diameterMm" value="' +
        Math.round(edge.diameter * 1000) + '">');
      edgeHtml += field('阀门类型',
        '<select data-edit="valveKind">' +
        '<option value="open"' + (valveKind === 'open' ? ' selected' : '') + '>无阀门/常开</option>' +
        '<option value="check"' + (valveKind === 'check' ? ' selected' : '') + '>止回阀</option>' +
        '<option value="closed"' + (valveKind === 'closed' ? ' selected' : '') + '>截止阀（关闭）</option>' +
        '</select>');
      edgeHtml += field('止回阀允许方向',
        '<select data-edit="allowDirection" ' +
        (valveKind !== 'check' ? 'disabled' : '') + '>' +
        '<option value="forward"' + (allowDirection === 'forward' ? ' selected' : '') +
        '>正向 ' + edge.from + '→' + edge.to + '</option>' +
        '<option value="backward"' + (allowDirection === 'backward' ? ' selected' : '') +
        '>反向 ' + edge.to + '→' + edge.from + '</option>' +
        '</select>');
      container.innerHTML = edgeHtml;
    }
    bindInspector();
  }

  function bindInspector() {
    var container = document.getElementById('inspector');
    container.querySelectorAll('[data-edit]').forEach(function (input) {
      input.addEventListener('change', function () {
        applyEdit(input.getAttribute('data-edit'), input.value);
      });
    });
  }

  function applyEdit(key, rawValue) {
    var plan = JSON.parse(JSON.stringify(workingPlan));
    if (selected.kind === 'node') {
      var node = findNode(plan, selected.id);
      if (key === 'name') node.name = rawValue;
      if (key === 'x') node.x = Number(rawValue);
      if (key === 'y') node.y = Number(rawValue);
      if (key === 'head') node.head = Number(rawValue);
      if (key === 'demandLs') node.demand = Number(rawValue) / 1000;
    } else {
      var edge = findEdge(plan, selected.id);
      if (key === 'diameterMm') edge.diameter = Math.max(0.01, Number(rawValue) / 1000);
      if (key === 'valveKind') {
        if (rawValue === 'open') {
          edge.valve = null;
        } else if (rawValue === 'closed') {
          edge.valve = { kind: 'closed' };
        } else {
          var previous = edge.valve || {};
          edge.valve = {
            kind: 'check',
            allowDirection: previous.allowDirection || 'forward'
          };
        }
      }
      if (key === 'allowDirection' && edge.valve && edge.valve.kind === 'check') {
        edge.valve.allowDirection = rawValue;
      }
    }
    commit(plan);
  }

  function renderResults(report) {
    var summary = document.getElementById('summary');
    var pressures = report.solution.nodes
      .map(function (n) { return n.pressureKpa; })
      .filter(function (value) { return value !== null && value !== undefined; });
    var minPressure = Math.min.apply(null, pressures);
    var totalDemand = report.delivered.reduce(function (sum, d) {
      return sum + d.required;
    }, 0);
    var totalDelivered = report.delivered.reduce(function (sum, d) {
      return sum + d.delivered;
    }, 0);
    summary.innerHTML =
      '收敛状态：' + (report.solution.converged ? '已收敛' : '未收敛') +
      '（' + report.solution.iterations + ' 次迭代）<br>' +
      '总需求：' + (totalDemand * 1000).toFixed(1) + ' L/s　' +
      '实供：' + (totalDelivered * 1000).toFixed(1) + ' L/s<br>' +
      '最低压力：<strong>' + minPressure.toFixed(1) + ' kPa</strong>　环路：' +
      report.loops.length + '　死端：' + report.deadEnds.length;

    var rows = report.solution.edges.map(function (edge) {
      return '<tr><td>' + edge.id + '</td><td>' +
        (edge.flow * 1000).toFixed(1) + '</td><td>' +
        edge.velocity.toFixed(2) + '</td><td>' +
        edge.headLoss.toFixed(2) + '</td></tr>';
    });
    document.getElementById('edge-rows').innerHTML = rows.join('');
  }

  function renderIssues(report) {
    var list = document.getElementById('issues');
    if (!report.issues.length) {
      list.innerHTML = '<li class="ok">未发现环路、死端、负压或断连问题</li>';
      return;
    }
    list.innerHTML = report.issues.map(function (issue) {
      return '<li class="' + issue.level + '">[' +
        { error: '错误', warning: '警告', info: '提示' }[issue.level] +
        '] ' + issue.message + '</li>';
    }).join('');
  }

  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);
  document.getElementById('btn-save').addEventListener('click', savePlan);
  document.getElementById('btn-reset').addEventListener('click', resetDemo);
  document.getElementById('btn-load').addEventListener('click', function () {
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', function (event) {
    var file = event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        loadPlanText(reader.result);
      } catch (err) {
        alert('导入失败：' + err.message);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  });

  document.addEventListener('keydown', function (event) {
    var isRedo = (event.ctrlKey || event.metaKey) &&
      (event.key === 'y' || (event.shiftKey && event.key === 'z'));
    var isUndo = (event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey;
    if (isUndo) {
      event.preventDefault();
      undo();
    } else if (isRedo) {
      event.preventDefault();
      redo();
    }
  });

  window.App = {
    commit: commit,
    currentPlan: currentPlan,
    get selected() { return selected; },
    set selected(value) { selected = value; },
    renderAll: renderAll
  };

  resetDemo();
})();
