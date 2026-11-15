/* 交互：左侧 2D 轮廓编辑，右侧 WebGL 预览（轨道旋转，实体/线框）。 */
(function () {
  'use strict';

  const SEGMENTS = Pot.DEFAULT_SEGMENTS;
  let profile = Pot.defaultProfile();
  let mesh = Pot.buildMesh(profile, SEGMENTS);
  let mode = 'solid'; // solid | wire | both

  // ---------- WebGL ----------
  const view = document.getElementById('view');
  const gl = view.getContext('webgl', { antialias: true });
  if (!gl) { document.getElementById('status').textContent = '当前浏览器不支持 WebGL'; return; }

  const VS = [
    'attribute vec3 aPos;',
    'attribute vec3 aNormal;',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'varying vec3 vNormal;',
    'void main(){',
    '  gl_Position = uProj * uView * vec4(aPos, 1.0);',
    '  vNormal = aNormal;',
    '}',
  ].join('\n');
  const FS = [
    'precision mediump float;',
    'varying vec3 vNormal;',
    'uniform vec3 uLightDir;',
    'uniform vec3 uBaseColor;',
    'void main(){',
    '  vec3 n = normalize(vNormal);',
    '  if (!gl_FrontFacing) n = -n;', // 背面翻正法线，任何角度都不会显示翻面
    '  float diff = max(dot(n, normalize(uLightDir)), 0.0);',
    '  vec3 col = uBaseColor * (0.28 + 0.72 * diff);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}',
  ].join('\n');

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const loc = {
    aPos: gl.getAttribLocation(prog, 'aPos'),
    aNormal: gl.getAttribLocation(prog, 'aNormal'),
    uProj: gl.getUniformLocation(prog, 'uProj'),
    uView: gl.getUniformLocation(prog, 'uView'),
    uLightDir: gl.getUniformLocation(prog, 'uLightDir'),
    uBaseColor: gl.getUniformLocation(prog, 'uBaseColor'),
  };

  const solidPosBuf = gl.createBuffer();
  const solidNrmBuf = gl.createBuffer();
  const wireBuf = gl.createBuffer();
  let solidCount = 0;
  let wireCount = 0;

  // 平面着色：每个三角形复制 3 个顶点并写入面法线
  function rebuildBuffers() {
    const p = mesh.positions;
    const solidPos = new Float32Array(mesh.faces.length * 9);
    const solidNrm = new Float32Array(mesh.faces.length * 9);
    mesh.faces.forEach(function (f, fi) {
      const n = Pot.faceNormal(p, f);
      for (let k = 0; k < 3; k++) {
        const vi = f[k];
        solidPos.set([p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2]], fi * 9 + k * 3);
        solidNrm.set(n, fi * 9 + k * 3);
      }
    });
    solidCount = mesh.faces.length * 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, solidPosBuf);
    gl.bufferData(gl.ARRAY_BUFFER, solidPos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, solidNrmBuf);
    gl.bufferData(gl.ARRAY_BUFFER, solidNrm, gl.STATIC_DRAW);

    const seen = new Set();
    const wire = [];
    for (const f of mesh.faces) {
      for (let k = 0; k < 3; k++) {
        const a = f[k];
        const b = f[(k + 1) % 3];
        const key = a < b ? a + '_' + b : b + '_' + a;
        if (seen.has(key)) continue;
        seen.add(key);
        wire.push(p[a * 3], p[a * 3 + 1], p[a * 3 + 2], p[b * 3], p[b * 3 + 1], p[b * 3 + 2]);
      }
    }
    wireCount = wire.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, wireBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(wire), gl.STATIC_DRAW);
  }

  // ---------- 相机与矩阵 ----------
  let yaw = 0.7;
  let pitch = 0.35;
  let dist = 6.0;

  function perspective(fov, aspect, near, far) {
    const t = 1 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      t / aspect, 0, 0, 0,
      0, t, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  }

  function viewMatrix() {
    const cx = dist * Math.cos(pitch) * Math.sin(yaw);
    const cy = dist * Math.sin(pitch);
    const cz = dist * Math.cos(pitch) * Math.cos(yaw);
    const target = [0, 1.0, 0];
    let fx = target[0] - cx, fy = target[1] - cy, fz = target[2] - cz;
    let fl = Math.hypot(fx, fy, fz);
    fx /= fl; fy /= fl; fz /= fl;
    // up = (0,1,0)，右 = f x up，上 = 右 x f
    let rx = -fz, ry = 0, rz = fx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; rz /= rl;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    return new Float32Array([
      rx, ux, -fx, 0,
      ry, uy, -fy, 0,
      rz, uz, -fz, 0,
      -(rx * cx + ry * cy + rz * cz),
      -(ux * cx + uy * cy + uz * cz),
      fx * cx + fy * cy + fz * cz, 1,
    ]);
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = view.clientWidth * dpr;
    const h = view.clientHeight * dpr;
    if (view.width !== w || view.height !== h) {
      view.width = w;
      view.height = h;
    }
    const ed = editor;
    const ew = ed.clientWidth * dpr;
    const eh = ed.clientHeight * dpr;
    if (ed.width !== ew || ed.height !== eh) {
      ed.width = ew;
      ed.height = eh;
    }
  }

  function render() {
    resize();
    gl.viewport(0, 0, view.width, view.height);
    gl.clearColor(0.11, 0.12, 0.14, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(loc.uProj, false, perspective(Math.PI / 4, view.width / view.height, 0.1, 100));
    gl.uniformMatrix4fv(loc.uView, false, viewMatrix());
    gl.uniform3f(loc.uLightDir, 0.5, 0.9, 0.6);

    if (mode === 'solid' || mode === 'both') {
      gl.bindBuffer(gl.ARRAY_BUFFER, solidPosBuf);
      gl.enableVertexAttribArray(loc.aPos);
      gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, solidNrmBuf);
      gl.enableVertexAttribArray(loc.aNormal);
      gl.vertexAttribPointer(loc.aNormal, 3, gl.FLOAT, false, 0, 0);
      gl.uniform3f(loc.uBaseColor, 0.72, 0.42, 0.27); // 陶土色
      gl.drawArrays(gl.TRIANGLES, 0, solidCount);
      gl.disableVertexAttribArray(loc.aNormal);
    }
    if (mode === 'wire' || mode === 'both') {
      gl.bindBuffer(gl.ARRAY_BUFFER, wireBuf);
      gl.enableVertexAttribArray(loc.aPos);
      gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.disableVertexAttribArray(loc.aNormal);
      gl.vertexAttrib3f(loc.aNormal, 0, 1, 0);
      gl.uniform3f(loc.uBaseColor, mode === 'both' ? 0.15 : 0.85, mode === 'both' ? 0.1 : 0.8, 0.2);
      gl.drawArrays(gl.LINES, 0, wireCount);
    }
    requestAnimationFrame(render);
  }

  // 轨道旋转 / 缩放
  let draggingView = false;
  let lastX = 0;
  let lastY = 0;
  view.addEventListener('pointerdown', function (e) {
    draggingView = true;
    lastX = e.clientX;
    lastY = e.clientY;
    view.setPointerCapture(e.pointerId);
  });
  view.addEventListener('pointermove', function (e) {
    if (!draggingView) return;
    yaw += (e.clientX - lastX) * 0.01;
    pitch = Math.max(-1.4, Math.min(1.4, pitch + (e.clientY - lastY) * 0.01));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  view.addEventListener('pointerup', function () { draggingView = false; });
  view.addEventListener('wheel', function (e) {
    e.preventDefault();
    dist = Math.max(2.5, Math.min(15, dist * (1 + e.deltaY * 0.001)));
  }, { passive: false });

  // ---------- 2D 轮廓编辑器 ----------
  const editor = document.getElementById('editor');
  const ctx = editor.getContext('2d');
  const H_MAX = 2.6;
  const R_MAX = 1.6;

  function edMap(r, h) { // 轮廓坐标 -> 画布坐标
    const w = editor.width;
    const hh = editor.height;
    const scale = Math.min(w / 2 / (R_MAX + 0.25), hh / (H_MAX + 0.4));
    return [w / 2 + r * scale, hh - 20 - h * scale];
  }
  function edUnmap(x, y) {
    const w = editor.width;
    const hh = editor.height;
    const scale = Math.min(w / 2 / (R_MAX + 0.25), hh / (H_MAX + 0.4));
    return [(x - w / 2) / scale, (hh - 20 - y) / scale];
  }

  function drawEditor() {
    const w = editor.width;
    const h = editor.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#3a3d44';
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    // 镜像轮廓（左半淡显，右半实线）
    for (const side of [-1, 1]) {
      ctx.strokeStyle = side < 0 ? '#4a4d55' : '#c98a5b';
      ctx.lineWidth = side < 0 ? 1 : 2;
      ctx.beginPath();
      profile.forEach(function (pt, i) {
        const xy = edMap(pt.r * side, pt.h);
        if (i === 0) ctx.moveTo(xy[0], xy[1]);
        else ctx.lineTo(xy[0], xy[1]);
      });
      ctx.stroke();
    }
    ctx.font = '12px sans-serif';
    profile.forEach(function (pt, i) {
      const xy = edMap(pt.r, pt.h);
      ctx.fillStyle = i === dragIdx ? '#ffb066' : '#e0e0e0';
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9aa0aa';
      ctx.fillText(pt.name, xy[0] + 10, xy[1] + 4);
    });
  }

  let dragIdx = -1;
  editor.addEventListener('pointerdown', function (e) {
    const rect = editor.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const x = (e.clientX - rect.left) * dpr;
    const y = (e.clientY - rect.top) * dpr;
    for (let i = profile.length - 1; i >= 0; i--) {
      const xy = edMap(profile[i].r, profile[i].h);
      if (Math.hypot(xy[0] - x, xy[1] - y) < 14 * dpr) {
        dragIdx = i;
        editor.setPointerCapture(e.pointerId);
        break;
      }
    }
  });
  editor.addEventListener('pointermove', function (e) {
    if (dragIdx < 0) return;
    const rect = editor.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const rh = edUnmap((e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr);
    const pt = profile[dragIdx];
    pt.r = Math.max(0.1, Math.min(R_MAX, Math.abs(rh[0])));
    const lo = dragIdx > 0 ? profile[dragIdx - 1].h + 0.06 : 0;
    const hi = dragIdx < profile.length - 1 ? profile[dragIdx + 1].h - 0.06 : H_MAX;
    pt.h = Math.max(lo, Math.min(hi, rh[1]));
    rebuild();
  });
  editor.addEventListener('pointerup', function () { dragIdx = -1; });

  // ---------- 状态 / 导入导出 ----------
  const status = document.getElementById('status');
  function updateStatus(extra) {
    const nv = mesh.positions.length / 3;
    const nf = mesh.faces.length;
    const nb = Pot.boundaryEdges(mesh.faces).length;
    status.textContent = '顶点 ' + nv + ' · 三角形 ' + nf + ' · 边界边 ' + nb + '（瓶口）'
      + (extra ? '\n' + extra : '');
  }

  function rebuild() {
    mesh = Pot.buildMesh(profile, SEGMENTS);
    rebuildBuffers();
    drawEditor();
    updateStatus();
  }

  document.getElementById('btnExport').addEventListener('click', function () {
    const blob = new Blob([Pot.toOBJ(mesh, 'pot')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pot.obj';
    a.click();
    URL.revokeObjectURL(a.href);
    updateStatus('已导出 pot.obj');
  });

  const fileInput = document.getElementById('fileInput');
  document.getElementById('btnImport').addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      const loaded = Pot.parseOBJ(String(reader.result));
      const nv = loaded.positions.length / 3;
      let maxDiff = 0;
      if (nv === mesh.positions.length / 3) {
        for (let i = 0; i < mesh.positions.length; i++) {
          maxDiff = Math.max(maxDiff, Math.abs(loaded.positions[i] - mesh.positions[i]));
        }
      }
      mesh = { positions: loaded.positions, faces: loaded.faces,
        segments: SEGMENTS, rings: profile.length };
      rebuildBuffers();
      updateStatus(nv === profile.length * SEGMENTS + 1 && maxDiff < 1e-4
        ? '重新载入一致：顶点 ' + nv + '，最大偏差 ' + maxDiff.toExponential(1)
        : '已载入 ' + nv + ' 个顶点（与当前轮廓不同）');
    };
    reader.readAsText(file);
    fileInput.value = '';
  });

  function setMode(m) {
    mode = m;
    for (const pair of [['btnSolid', 'solid'], ['btnWire', 'wire'], ['btnBoth', 'both']]) {
      document.getElementById(pair[0]).classList.toggle('active', pair[1] === m);
    }
  }
  document.getElementById('btnSolid').addEventListener('click', function () { setMode('solid'); });
  document.getElementById('btnWire').addEventListener('click', function () { setMode('wire'); });
  document.getElementById('btnBoth').addEventListener('click', function () { setMode('both'); });

  rebuild();
  render();
})();
