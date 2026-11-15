(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HydraulicEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GRAVITY = 9.81;
  var DEFAULT_ROUGHNESS = 0.02;
  var KPA_PER_METER = GRAVITY;

  function edgeLength(edge, nodeMap) {
    if (typeof edge.length === 'number' && edge.length > 0) return edge.length;
    var a = nodeMap[edge.from];
    var b = nodeMap[edge.to];
    if (!a || !b) return 0;
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy) * (a.scale || 0.5);
  }

  function nodeMap(plan) {
    var map = {};
    plan.nodes.forEach(function (n) { map[n.id] = n; });
    return map;
  }

  function buildAdjacency(plan) {
    var adj = {};
    plan.nodes.forEach(function (n) { adj[n.id] = []; });
    plan.edges.forEach(function (e) {
      if (adj[e.from]) adj[e.from].push(e.to);
      if (adj[e.to]) adj[e.to].push(e.from);
    });
    return adj;
  }

  function resistance(edge, length) {
    var diameter = edge.diameter;
    var f = edge.roughness || DEFAULT_ROUGHNESS;
    var area = Math.PI * diameter * diameter / 4;
    return f * length / (2 * GRAVITY * area * area);
  }

  function flowOnEdge(edge, hFrom, hTo, length) {
    if (edge.valve && edge.valve.kind === 'closed') return 0;
    var dh = hFrom - hTo;
    var r = resistance(edge, length);
    var mag = Math.sqrt(Math.abs(dh) / r);
    var signed = mag * (dh >= 0 ? 1 : -1);
    if (edge.valve && edge.valve.kind === 'check') {
      var allow = edge.valve.allowDirection || 'forward';
      if (allow === 'forward' && signed < 0) return 0;
      if (allow === 'backward' && signed > 0) return 0;
    }
    return signed;
  }

  function conductanceDerivative(edge, hFrom, hTo, length) {
    if (edge.valve && edge.valve.kind === 'closed') return 0;
    var dh = hFrom - hTo;
    var r = resistance(edge, length);
    var mag = Math.sqrt(Math.max(Math.abs(dh), 1e-9) / r);
    if (edge.valve && edge.valve.kind === 'check') {
      var allow = edge.valve.allowDirection || 'forward';
      if (allow === 'forward' && dh < 0) return 0;
      if (allow === 'backward' && dh > 0) return 0;
    }
    return mag / (2 * Math.max(Math.abs(dh), 1e-9));
  }

  function solveMatrix(matrix, vector) {
    var n = vector.length;
    var a = matrix.map(function (row) { return row.slice(); });
    var b = vector.slice();
    for (var col = 0; col < n; col++) {
      var pivot = col;
      for (var row = col + 1; row < n; row++) {
        if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
      }
      var tmpRow = a[col];
      a[col] = a[pivot];
      a[pivot] = tmpRow;
      var tmpVal = b[col];
      b[col] = b[pivot];
      b[pivot] = tmpVal;
      if (Math.abs(a[col][col]) < 1e-14) return null;
      for (var r = col + 1; r < n; r++) {
        var factor = a[r][col] / a[col][col];
        for (var c = col; c < n; c++) a[r][c] -= factor * a[col][c];
        b[r] -= factor * b[col];
      }
    }
    var x = new Array(n).fill(0);
    for (var i = n - 1; i >= 0; i--) {
      var sum = b[i];
      for (var j = i + 1; j < n; j++) sum -= a[i][j] * x[j];
      x[i] = sum / a[i][i];
    }
    return x;
  }

  function solve(plan, reachable) {
    var nodes = plan.nodes;
    var edges = plan.edges;
    var map = nodeMap(plan);
    var index = {};
    var unknown = [];
    nodes.forEach(function (n, i) {
      index[n.id] = i;
      if (n.kind !== 'source' && (!reachable || reachable[n.id])) {
        unknown.push(n.id);
      }
    });
    var pos = {};
    unknown.forEach(function (id, i) { pos[id] = i; });
    var lengths = {};
    edges.forEach(function (e) {
      lengths[e.id] = edgeLength(e, map);
    });
    var sourceHeads = {};
    nodes.forEach(function (n) {
      if (n.kind === 'source') sourceHeads[n.id] = n.head;
    });
    var guessHeads = {};
    nodes.forEach(function (n) {
      if (n.kind === 'source') {
        guessHeads[n.id] = n.head;
      } else if (reachable && !reachable[n.id]) {
        guessHeads[n.id] = null;
      } else {
        var sources = nodes.filter(function (s) { return s.kind === 'source'; });
        var ref = sources[0] || { head: 30 };
        guessHeads[n.id] = n.kind === 'demand' ? ref.head - 8 : ref.head - 4;
      }
    });
    var m = unknown.length;
    var converged = false;
    var iterations = 0;
    var residualNorm = Infinity;

    for (iterations = 1; iterations <= 60; iterations++) {
      var residual = new Array(m).fill(0);
      var jacobian = [];
      for (var k = 0; k < m; k++) jacobian.push(new Array(m).fill(0));
      edges.forEach(function (e) {
        if (reachable && (!reachable[e.from] || !reachable[e.to])) return;
        var ha = guessHeads[e.from];
        var hb = guessHeads[e.to];
        var len = lengths[e.id];
        var q = flowOnEdge(e, ha, hb, len);
        var g = conductanceDerivative(e, ha, hb, len);
        var aUnknown = map[e.from].kind !== 'source';
        var bUnknown = map[e.to].kind !== 'source';
        if (aUnknown) residual[pos[e.from]] += q;
        if (bUnknown) residual[pos[e.to]] -= q;
        if (aUnknown) jacobian[pos[e.from]][pos[e.from]] += g;
        if (bUnknown) jacobian[pos[e.to]][pos[e.to]] += g;
        if (aUnknown && bUnknown) {
          jacobian[pos[e.from]][pos[e.to]] -= g;
          jacobian[pos[e.to]][pos[e.from]] -= g;
        }
      });
      unknown.forEach(function (id) {
        var node = map[id];
        if (node.kind === 'demand') residual[pos[id]] += node.demand || 0;
      });
      for (var diag = 0; diag < m; diag++) {
        jacobian[diag][diag] += 1e-9;
      }
      residualNorm = Math.sqrt(residual.reduce(function (s, v) {
        return s + v * v;
      }, 0));
      if (residualNorm < 1e-9) {
        converged = true;
        break;
      }
      var delta = solveMatrix(jacobian, residual.map(function (v) { return -v; }));
      if (!delta) break;
      function trialNorm(damping) {
        var trial = {};
        unknown.forEach(function (id, i) {
          trial[id] = guessHeads[id] + damping * delta[i];
        });
        var balance = {};
        unknown.forEach(function (id) { balance[id] = 0; });
        edges.forEach(function (e) {
          if (reachable && (!reachable[e.from] || !reachable[e.to])) return;
          var ha = map[e.from].kind === 'source' ? sourceHeads[e.from] : trial[e.from];
          var hb = map[e.to].kind === 'source' ? sourceHeads[e.to] : trial[e.to];
          var q = flowOnEdge(e, ha, hb, lengths[e.id]);
          if (pos[e.from] !== undefined) balance[e.from] += q;
          if (pos[e.to] !== undefined) balance[e.to] -= q;
        });
        unknown.forEach(function (id) {
          if (map[id].kind === 'demand') balance[id] += map[id].demand || 0;
        });
        var sum = 0;
        Object.keys(balance).forEach(function (id) {
          sum += balance[id] * balance[id];
        });
        return Math.sqrt(sum);
      }
      var damping = 1;
      for (var step = 0; step < 10; step++) {
        if (trialNorm(damping) <= residualNorm * (1 + 1e-6)) break;
        damping *= 0.5;
      }
      unknown.forEach(function (id, i) {
        guessHeads[id] += damping * delta[i];
      });
    }

    var heads = {};
    nodes.forEach(function (n) { heads[n.id] = guessHeads[n.id]; });
    var edgeResults = edges.map(function (e) {
      if (reachable && (!reachable[e.from] || !reachable[e.to])) {
        return {
          id: e.id,
          flow: 0,
          velocity: 0,
          headLoss: 0,
          length: lengths[e.id],
          fromHead: heads[e.from],
          toHead: heads[e.to]
        };
      }
      var len = lengths[e.id];
      var q = flowOnEdge(e, heads[e.from], heads[e.to], len);
      var diameter = e.diameter;
      var area = Math.PI * diameter * diameter / 4;
      return {
        id: e.id,
        flow: q,
        velocity: q / area,
        headLoss: resistance(e, len) * q * Math.abs(q),
        length: len,
        fromHead: heads[e.from],
        toHead: heads[e.to]
      };
    });
    var nodeResults = nodes.map(function (n) {
      if (heads[n.id] === null || heads[n.id] === undefined) {
        return { id: n.id, head: null, pressureHead: null, pressureKpa: null };
      }
      var pressureHead = heads[n.id] - (n.elevation || 0);
      return {
        id: n.id,
        head: heads[n.id],
        pressureHead: pressureHead,
        pressureKpa: pressureHead * KPA_PER_METER
      };
    });
    return {
      converged: converged,
      iterations: iterations,
      residualNorm: residualNorm,
      heads: heads,
      edges: edgeResults,
      nodes: nodeResults
    };
  }

  function reachableFromSources(plan) {
    var adj = {};
    plan.nodes.forEach(function (n) { adj[n.id] = []; });
    plan.edges.forEach(function (e) {
      if (e.valve && e.valve.kind === 'closed') return;
      if (adj[e.from]) adj[e.from].push(e.to);
      if (adj[e.to]) adj[e.to].push(e.from);
    });
    var map = nodeMap(plan);
    var reachable = {};
    var queue = plan.nodes
      .filter(function (n) { return n.kind === 'source'; })
      .map(function (n) { return n.id; });
    queue.forEach(function (id) { reachable[id] = true; });
    while (queue.length) {
      var id = queue.shift();
      adj[id].forEach(function (next) {
        if (!reachable[next]) {
          reachable[next] = true;
          queue.push(next);
        }
      });
    }
    return reachable;
  }

  function findLoops(plan) {
    var adj = buildAdjacency(plan);
    var map = nodeMap(plan);
    var visited = {};
    var parent = {};
    var depth = {};
    var loops = [];

    function walk(start) {
      var stack = [{ id: start, parent: null }];
      while (stack.length) {
        var frame = stack.pop();
        var id = frame.id;
        if (visited[id]) continue;
        visited[id] = true;
        parent[id] = frame.parent;
        depth[id] = frame.parent === null ? 0 : depth[frame.parent] + 1;
        adj[id].forEach(function (next) {
          if (next === frame.parent) return;
          if (!visited[next]) {
            stack.push({ id: next, parent: id });
          } else if (depth[next] !== undefined && depth[next] < depth[id]) {
            var path = [next];
            var cursor = id;
            while (cursor !== next && cursor !== null && cursor !== undefined) {
              path.push(cursor);
              cursor = parent[cursor];
            }
            path.push(next);
            var label = path.map(function (pid) {
              return map[pid] ? map[pid].name || pid : pid;
            }).join(' → ');
            loops.push({ nodes: path, label: label });
          }
        });
      }
    }

    plan.nodes.forEach(function (n) {
      if (!visited[n.id]) walk(n.id);
    });
    return loops;
  }

  function findDeadEnds(plan) {
    var adj = buildAdjacency(plan);
    var map = nodeMap(plan);
    return plan.nodes
      .filter(function (n) {
        return n.kind === 'junction' && adj[n.id].length <= 1;
      })
      .map(function (n) {
        return { id: n.id, name: n.name || n.id, degree: adj[n.id].length };
      });
  }

  function analyze(plan) {
    var map = nodeMap(plan);
    var reachable = reachableFromSources(plan);
    var solution = solve(plan, reachable);
    var loops = findLoops(plan);
    var deadEnds = findDeadEnds(plan);
    var issues = [];

    if (!solution.converged) {
      issues.push({ level: 'error', type: 'solver', message: '水力计算未收敛，请检查管径或阀门设置' });
    }

    plan.nodes.forEach(function (n) {
      if (!reachable[n.id]) {
        issues.push({
          level: 'error',
          type: 'disconnected',
          nodeId: n.id,
          message: (n.name || n.id) + ' 与水源不连通'
        });
      }
      var result = solution.nodes.filter(function (r) { return r.id === n.id; })[0];
      if (reachable[n.id] && result && result.pressureHead !== null &&
        result.pressureHead < 0) {
        issues.push({
          level: 'error',
          type: 'negative-pressure',
          nodeId: n.id,
          message: (n.name || n.id) + ' 出现负压：' +
            result.pressureKpa.toFixed(1) + ' kPa'
        });
      }
    });

    loops.forEach(function (loop, i) {
      issues.push({
        level: 'info',
        type: 'loop',
        message: '检测到环路 #' + (i + 1) + '：' + loop.label
      });
    });

    deadEnds.forEach(function (d) {
      issues.push({
        level: 'warning',
        type: 'dead-end',
        nodeId: d.id,
        message: '节点 ' + d.name + ' 为死端（仅 ' + d.degree + ' 条管段连接）'
      });
    });

    solution.edges.forEach(function (r) {
      if (Math.abs(r.velocity) > 3) {
        issues.push({
          level: 'warning',
          type: 'high-velocity',
          edgeId: r.id,
          message: '管段 ' + r.id + ' 流速 ' + r.velocity.toFixed(2) +
            ' m/s 超过 3 m/s 建议值'
        });
      }
    });

    var demands = plan.nodes.filter(function (n) { return n.kind === 'demand'; });
    var delivered = demands.map(function (n) {
      var inflow = 0;
      plan.edges.forEach(function (e) {
        var r = solution.edges.filter(function (x) { return x.id === e.id; })[0];
        if (e.to === n.id) inflow += r.flow;
        if (e.from === n.id) inflow -= r.flow;
      });
      return { id: n.id, name: n.name || n.id, required: n.demand || 0, delivered: inflow };
    });

    return {
      plan: plan,
      solution: solution,
      reachable: reachable,
      loops: loops,
      deadEnds: deadEnds,
      delivered: delivered,
      issues: issues,
      hasError: issues.some(function (i) { return i.level === 'error'; }),
      hasNegativePressure: issues.some(function (i) {
        return i.type === 'negative-pressure';
      })
    };
  }

  return {
    GRAVITY: GRAVITY,
    KPA_PER_METER: KPA_PER_METER,
    DEFAULT_ROUGHNESS: DEFAULT_ROUGHNESS,
    edgeLength: edgeLength,
    nodeMap: nodeMap,
    buildAdjacency: buildAdjacency,
    resistance: resistance,
    flowOnEdge: flowOnEdge,
    conductanceDerivative: conductanceDerivative
    ,
    solve: solve,
    reachableFromSources: reachableFromSources,
    findLoops: findLoops,
    findDeadEnds: findDeadEnds,
    analyze: analyze
  };
});
