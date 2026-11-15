"use strict";

// ---------- 1. 程序化生成点云（不加载任何模型文件） ----------
const POINT_COUNT = 260000;
const positions = new Float32Array(POINT_COUNT * 3);

function gauss(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 可复现的伪随机数
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateCloud() {
  const rand = mulberry32(20261115);
  let i = 0;
  // 成分 A：双峰山谷地形壳层（60%）
  const nA = Math.floor(POINT_COUNT * 0.6);
  for (; i < nA; i++) {
    const x = (rand() * 2 - 1) * 3.2;
    const z = (rand() * 2 - 1) * 3.2;
    const r = Math.hypot(x, z);
    let y = 1.6 * Math.exp(-r * r * 0.35) * Math.cos(2.2 * x) * Math.sin(1.8 * z)
          + 0.5 * Math.sin(3.1 * x + 1.3 * z) * Math.exp(-r * 0.5);
    y += gauss(rand) * 0.06 + 0.25 * rand();
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
  }
  // 成分 B：螺旋环带（25%）
  const nB = nA + Math.floor(POINT_COUNT * 0.25);
  for (; i < nB; i++) {
    const t = rand() * Math.PI * 6;
    const rad = 1.1 + 0.35 * Math.sin(t * 0.7) + gauss(rand) * 0.07;
    positions[i * 3] = rad * Math.cos(t) + gauss(rand) * 0.06;
    positions[i * 3 + 1] = 0.9 * Math.sin(t * 0.5) + gauss(rand) * 0.12 - 0.4;
    positions[i * 3 + 2] = rad * Math.sin(t) + gauss(rand) * 0.06;
  }
  // 成分 C：三个高斯团簇（15%）
  const centers = [[1.8, 1.2, -1.4], [-2.0, 0.6, 1.6], [0.2, -1.1, 0.4]];
  for (; i < POINT_COUNT; i++) {
    const c = centers[i % 3];
    positions[i * 3] = c[0] + gauss(rand) * 0.45;
    positions[i * 3 + 1] = c[1] + gauss(rand) * 0.45;
    positions[i * 3 + 2] = c[2] + gauss(rand) * 0.45;
  }
}

// ---------- 2. 逐点密度（空间哈希网格统计邻居数） ----------
const densities = new Float32Array(POINT_COUNT);
let densityMax = 1;

function computeDensity() {
  const cell = 0.22;
  const grid = new Map();
  for (let i = 0; i < POINT_COUNT; i++) {
    const k = Math.floor(positions[i * 3] / cell) + ":" +
              Math.floor(positions[i * 3 + 1] / cell) + ":" +
              Math.floor(positions[i * 3 + 2] / cell);
    grid.set(k, (grid.get(k) || 0) + 1);
  }
  for (let i = 0; i < POINT_COUNT; i++) {
    const k = Math.floor(positions[i * 3] / cell) + ":" +
              Math.floor(positions[i * 3 + 1] / cell) + ":" +
              Math.floor(positions[i * 3 + 2] / cell);
    densities[i] = grid.get(k);
  }
  for (let i = 0; i < POINT_COUNT; i++) if (densities[i] > densityMax) densityMax = densities[i];
  for (let i = 0; i < POINT_COUNT; i++) densities[i] /= densityMax;
}

generateCloud();
computeDensity();

// 场景包围盒（供剖切滑块映射）
const bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < POINT_COUNT; i++) {
  for (let a = 0; a < 3; a++) {
    const v = positions[i * 3 + a];
    if (v < bbox.min[a]) bbox.min[a] = v;
    if (v > bbox.max[a]) bbox.max[a] = v;
  }
}
// ---------- 3. WebGL2 渲染器 ----------
const canvas = document.getElementById("glcanvas");
const gl = canvas.getContext("webgl2", { antialias: true, preserveDrawingBuffer: false });
if (!gl) { document.body.innerHTML = "<p style='color:#fff;padding:2em'>需要 WebGL2 支持</p>"; throw new Error("no webgl2"); }

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in float aDensity;
uniform mat4 uMVP;
uniform vec3 uClipMin, uClipMax;
uniform float uPointSize;
uniform int uColorMode;      // 0=高度 1=密度
uniform vec2 uYRange;        // 高度归一化范围
out vec3 vColor;

vec3 heightRamp(float t) {   // 蓝->青->绿->黄->红
  vec3 c1 = vec3(0.10, 0.25, 0.95), c2 = vec3(0.05, 0.80, 0.90);
  vec3 c3 = vec3(0.20, 0.90, 0.30), c4 = vec3(0.98, 0.85, 0.15);
  vec3 c5 = vec3(0.95, 0.20, 0.12);
  if (t < 0.25) return mix(c1, c2, t / 0.25);
  if (t < 0.50) return mix(c2, c3, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c3, c4, (t - 0.50) / 0.25);
  return mix(c4, c5, (t - 0.75) / 0.25);
}
vec3 densityRamp(float t) {  // 紫->品红->橙->白
  vec3 c1 = vec3(0.15, 0.05, 0.35), c2 = vec3(0.75, 0.15, 0.55);
  vec3 c3 = vec3(1.00, 0.55, 0.10), c4 = vec3(1.00, 1.00, 0.90);
  if (t < 0.4) return mix(c1, c2, t / 0.4);
  if (t < 0.8) return mix(c2, c3, (t - 0.4) / 0.4);
  return mix(c3, c4, (t - 0.8) / 0.2);
}

void main() {
  // 剖切盒：盒外点移到裁剪空间外
  if (any(lessThan(aPos, uClipMin)) || any(greaterThan(aPos, uClipMax))) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    return;
  }
  gl_Position = uMVP * vec4(aPos, 1.0);
  float dist = max(gl_Position.w, 0.1);
  gl_PointSize = clamp(uPointSize / dist, 1.0, 12.0);
  if (uColorMode == 0) {
    float t = clamp((aPos.y - uYRange.x) / (uYRange.y - uYRange.x), 0.0, 1.0);
    vColor = heightRamp(t);
  } else {
    vColor = densityRamp(clamp(aDensity, 0.0, 1.0));
  }
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;   // 圆形点
  outColor = vec4(vColor, 1.0);
}`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);

const U = {};
for (const n of ["uMVP", "uClipMin", "uClipMax", "uPointSize", "uColorMode", "uYRange"])
  U[n] = gl.getUniformLocation(prog, n);

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
const posBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
const denBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, denBuf);
gl.bufferData(gl.ARRAY_BUFFER, densities, gl.STATIC_DRAW);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);

gl.enable(gl.DEPTH_TEST);
gl.clearColor(0.043, 0.055, 0.078, 1.0);

// ---------- 4. 相机与交互（拖动旋转 / 滚轮缩放 / 右键平移） ----------
const cam = { theta: 0.9, phi: 1.05, dist: 9.0, target: [0, 0, 0] };

function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) / (near - far); m[11] = -1;
  m[14] = 2 * far * near / (near - far);
  return m;
}
function mat4LookAt(eye, c, up) {
  let zx = eye[0] - c[0], zy = eye[1] - c[1], zz = eye[2] - c[2];
  let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx;
  m[4] = xy; m[5] = yy; m[6] = zy;
  m[8] = xz; m[9] = yz; m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}
function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                   a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

let dragging = false, panning = false, lastX = 0, lastY = 0;
canvas.addEventListener("pointerdown", e => {
  if (e.button === 2) panning = true; else dragging = true;
  lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointerup", () => { dragging = panning = false; });
canvas.addEventListener("pointermove", e => {
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  if (dragging) {
    cam.theta -= dx * 0.006;
    cam.phi = Math.min(3.13, Math.max(0.01, cam.phi - dy * 0.006));
  } else if (panning) {
    const s = cam.dist * 0.0012;
    const sx = Math.cos(cam.theta), sz = -Math.sin(cam.theta);
    cam.target[0] += -dx * s * sx; cam.target[2] += -dx * s * sz;
    cam.target[1] += dy * s;
  }
});
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  cam.dist = Math.min(40, Math.max(2, cam.dist * Math.exp(e.deltaY * 0.001)));
}, { passive: false });
canvas.addEventListener("contextmenu", e => e.preventDefault());

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
window.addEventListener("resize", resize);

// ---------- 5. 渲染循环 ----------
let colorMode = 0;
const clipMin = [0, 0, 0], clipMax = [0, 0, 0];
let frames = 0, fpsTime = performance.now();

function render() {
  resize();
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const sp = Math.sin(cam.phi), eye = [
    cam.target[0] + cam.dist * sp * Math.sin(cam.theta),
    cam.target[1] + cam.dist * Math.cos(cam.phi),
    cam.target[2] + cam.dist * sp * Math.cos(cam.theta)];
  const proj = mat4Perspective(0.9, canvas.width / canvas.height, 0.1, 200);
  const view = mat4LookAt(eye, cam.target, [0, 1, 0]);
  gl.uniformMatrix4fv(U.uMVP, false, mat4Mul(proj, view));
  gl.uniform3fv(U.uClipMin, clipMin);
  gl.uniform3fv(U.uClipMax, clipMax);
  gl.uniform1f(U.uPointSize, 3.2 * (canvas.height / 900));
  gl.uniform1i(U.uColorMode, colorMode);
  gl.uniform2f(U.uYRange, bbox.min[1], bbox.max[1]);
  gl.drawArrays(gl.POINTS, 0, POINT_COUNT);
  frames++;
  const now = performance.now();
  if (now - fpsTime > 500) {
    document.getElementById("fps").textContent = Math.round(frames * 1000 / (now - fpsTime));
    frames = 0; fpsTime = now;
  }
  requestAnimationFrame(render);
}

// ---------- 6. 剖切盒与 UI ----------
const sliders = { x: document.getElementById("clipX"), y: document.getElementById("clipY"), z: document.getElementById("clipZ") };
const outs = { x: document.getElementById("ox"), y: document.getElementById("oy"), z: document.getElementById("oz") };

function applyClip() {
  // 滑块值 = 保留盒的“半宽比例”：100=完整，0=仅中心薄片
  for (const [axis, idx] of [["x", 0], ["y", 1], ["z", 2]]) {
    const t = sliders[axis].value / 100;
    const mid = (bbox.min[idx] + bbox.max[idx]) / 2;
    const half = (bbox.max[idx] - bbox.min[idx]) / 2 * t;
    clipMin[idx] = mid - half; clipMax[idx] = mid + half;
    outs[axis].textContent = sliders[axis].value + "%";
  }
  updateCount();
}

function updateCount() {
  let n = 0;
  for (let i = 0; i < POINT_COUNT; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x >= clipMin[0] && x <= clipMax[0] &&
        y >= clipMin[1] && y <= clipMax[1] &&
        z >= clipMin[2] && z <= clipMax[2]) n++;
  }
  document.getElementById("count").textContent = n.toLocaleString();
}

for (const axis of ["x", "y", "z"]) sliders[axis].addEventListener("input", applyClip);

function setClip(x, y, z) {
  sliders.x.value = x; sliders.y.value = y; sliders.z.value = z;
  applyClip();
}
document.getElementById("presetFull").onclick = () => setClip(100, 100, 100);
document.getElementById("presetHalf").onclick = () => setClip(50, 100, 50);
document.getElementById("presetCore").onclick = () => setClip(28, 45, 28);

const btnH = document.getElementById("colorHeight"), btnD = document.getElementById("colorDensity");
function setColorMode(m) {
  colorMode = m;
  btnH.classList.toggle("active", m === 0);
  btnD.classList.toggle("active", m === 1);
}
btnH.onclick = () => setColorMode(0);
btnD.onclick = () => setColorMode(1);

document.getElementById("total").textContent = POINT_COUNT.toLocaleString();

// ---------- 7. 导出当前视角截图 ----------
function exportScreenshot() {
  render();  // 先同步重绘，确保拿到当前画面
  canvas.toBlob(blob => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pointcloud_view.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
}
document.getElementById("shotBtn").onclick = exportScreenshot;

// 供自动化测试调用的钩子
window.__pcloud = {
  setColorMode, setClip, exportScreenshot,
  setView(theta, phi, dist) { cam.theta = theta; cam.phi = phi; cam.dist = dist; },
  get count() { return document.getElementById("count").textContent; },
  ready: false
};

applyClip();
render();
window.__pcloud.ready = true;

