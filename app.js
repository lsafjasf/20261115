"use strict";

/* ================= 画布与图层 ================= */

const BOARD_W = 960;
const BOARD_H = 600;

const boardEl = document.getElementById("board");
boardEl.style.width = BOARD_W + "px";
boardEl.style.height = BOARD_H + "px";

const DPR = window.devicePixelRatio || 1;

function makeLayer(canvas) {
  canvas.width = BOARD_W * DPR;
  canvas.height = BOARD_H * DPR;
  canvas.style.width = BOARD_W + "px";
  canvas.style.height = BOARD_H + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(DPR, DPR);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return ctx;
}

const layers = [
  { canvas: document.getElementById("layer0"), ink: "#1a5cff", tool: "line" },
  { canvas: document.getElementById("layer1"), ink: "#e0245e", tool: "line" },
];
layers.forEach((l) => (l.ctx = makeLayer(l.canvas)));

const overlay = document.getElementById("overlay");
const overlayCtx = makeLayer(overlay);

let activeLayer = 0;

/* ================= 轨迹平滑 =================
 * 指数滑动平均抑制手抖，再用中点二次贝塞尔连线，
 * 保证长直线不抖动、转折处圆滑。 */
function createSmoother() {
  let sx = null, sy = null;
  const ALPHA = 0.35; // 越小越平滑
  return {
    push(x, y) {
      if (sx === null) { sx = x; sy = y; }
      else {
        sx += (x - sx) * ALPHA;
        sy += (y - sy) * ALPHA;
      }
      return { x: sx, y: sy };
    },
  };
}

/* ================= 手势识别 =================
 * 基于鼠标轨迹特征：
 *  - 盖章：总路径很短（轻点），或轨迹近似闭合小圈；
 *  - 擦除：方向折返次数多（来回涂抹的锯齿轨迹）；
 *  - 画线：其余连续轨迹。 */
const STAMP_MAX_PATH = 18;      // 轻点判定：路径长度(px)
const STAMP_LOOP_RADIUS = 26;   // 小圈判定：包围盒半径
const ERASE_REVERSALS = 3;      // 折返次数阈值
const REVERSAL_ANGLE = (Math.PI * 2) / 3; // 120° 以上视为折返

function createGestureTracker() {
  const pts = [];
  let pathLen = 0;
  let reversals = 0;
  let mode = "pending"; // pending -> line | erase | stamp(抬起时判定)

  function dirChanges(a, b, c) {
    const v1x = b.x - a.x, v1y = b.y - a.y;
    const v2x = c.x - b.x, v2y = c.y - b.y;
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    if (l1 < 4 || l2 < 4) return false; // 忽略微小抖动
    const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
    return Math.acos(Math.max(-1, Math.min(1, cos))) > REVERSAL_ANGLE;
  }

  return {
    add(p) {
      const n = pts.length;
      // 跳过与上一点几乎重合的采样，避免零长线段干扰折返判定
      if (n > 0 && Math.hypot(p.x - pts[n - 1].x, p.y - pts[n - 1].y) < 1.5) return mode;
      if (n > 0) pathLen += Math.hypot(p.x - pts[n - 1].x, p.y - pts[n - 1].y);
      if (n >= 2 && mode !== "erase" && dirChanges(pts[n - 2], pts[n - 1], p)) {
        reversals++;
        if (reversals >= ERASE_REVERSALS) mode = "erase";
      }
      pts.push(p);
      if (mode === "pending" && pathLen > STAMP_MAX_PATH * 2) mode = "line";
      return mode;
    },
    finish() {
      if (pathLen <= STAMP_MAX_PATH) return { type: "stamp", at: pts[0] };
      // 闭合小圈也视为盖章
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      const start = pts[0], end = pts[pts.length - 1];
      const closed = Math.hypot(end.x - start.x, end.y - start.y) < STAMP_LOOP_RADIUS;
      if (closed && w < STAMP_LOOP_RADIUS * 2 && h < STAMP_LOOP_RADIUS * 2) {
        return { type: "stamp", at: { x: Math.min(...xs) + w / 2, y: Math.min(...ys) + h / 2 } };
      }
      return { type: mode === "erase" ? "erase" : "line" };
    },
    get mode() { return mode; },
  };
}

/* ================= 笔画渲染 ================= */

const LINE_WIDTH = 5;
const ERASE_WIDTH = 34;

// 中点二次贝塞尔：平滑连接一串点
function strokePath(ctx, points, width, color, erase) {
  if (points.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
  ctx.strokeStyle = erase ? "rgba(0,0,0,1)" : color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 1) {
    ctx.lineTo(points[0].x + 0.01, points[0].y + 0.01);
  } else {
    for (let i = 1; i < points.length - 1; i++) {
      const mx = (points[i].x + points[i + 1].x) / 2;
      const my = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
  }
  ctx.stroke();
  ctx.restore();
}

// 印章：双层圆环 + 五角星
function drawStamp(ctx, x, y, color) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, 21, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const outer = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    const px = x + Math.cos(outer) * 14;
    const py = y + Math.sin(outer) * 14;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ================= 撤销 / 重做 ================= */

const undoStack = [];
const redoStack = [];
const HISTORY_LIMIT = 40;

function snapshot() {
  return layers.map((l) => l.ctx.getImageData(0, 0, layers[0].canvas.width, layers[0].canvas.height));
}

function restore(snap) {
  layers.forEach((l, i) => l.ctx.putImageData(snap[i], 0, 0));
}

function pushHistory() {
  undoStack.push(snapshot());
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  updateHistoryButtons();
  setStatus("已撤销");
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  updateHistoryButtons();
  setStatus("已重做");
}

function updateHistoryButtons() {
  document.getElementById("undoBtn").disabled = undoStack.length === 0;
  document.getElementById("redoBtn").disabled = redoStack.length === 0;
}

/* ================= 图层切换：指针样式与工具状态同步 ================= */

const TOOL_NAMES = { line: "画线", erase: "擦除", stamp: "盖章" };

function setStatus(text) {
  document.getElementById("statusText").textContent = text;
}

function syncToolUI() {
  const tool = layers[activeLayer].tool;
  boardEl.classList.remove("tool-line", "tool-erase", "tool-stamp");
  boardEl.classList.add("tool-" + tool);
  const badge = document.getElementById("toolBadge");
  badge.textContent = TOOL_NAMES[tool];
  badge.className = "tool-badge" + (tool === "line" ? "" : " " + tool);
}

function setActiveLayer(index) {
  activeLayer = index;
  document.querySelectorAll(".layer-btn").forEach((btn, i) => {
    btn.classList.toggle("active", i === index);
  });
  layers.forEach((l, i) => (l.canvas.style.zIndex = i === index ? 2 : 1));
  syncToolUI(); // 恢复该图层最近使用的工具：指针样式 + 工具徽标
  setStatus(`已切换到图层 ${index + 1}（工具：${TOOL_NAMES[layers[index].tool]}）`);
}

/* ================= 指针交互 ================= */

let drawing = false;
let tracker = null;
let smoother = null;
let strokePoints = [];
let preStrokeSnap = null;
let eraseStarted = false;

function boardPos(e) {
  const r = overlay.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function clearOverlay() {
  overlayCtx.clearRect(0, 0, BOARD_W, BOARD_H);
}

overlay.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  overlay.setPointerCapture(e.pointerId);
  drawing = true;
  tracker = createGestureTracker();
  smoother = createSmoother();
  strokePoints = [];
  eraseStarted = false;
  preStrokeSnap = snapshot(); // 笔画开始前留档，供撤销
  const raw0 = boardPos(e);
  const p = smoother.push(raw0.x, raw0.y);
  tracker.add(raw0); // 手势识别用原始轨迹，避免平滑抹掉折返特征
  strokePoints.push(p);
});

overlay.addEventListener("pointermove", (e) => {
  if (!drawing) return;
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events) {
    const raw = boardPos(ev);
    const p = smoother.push(raw.x, raw.y);
    const mode = tracker.add(raw);
    strokePoints.push(p);
    if (mode === "erase") {
      // 一旦识别为擦除：清掉预览线，实时擦除当前图层
      clearOverlay();
      if (!eraseStarted) {
        eraseStarted = true;
        // 把识别前走过的整段轨迹也一并擦除
        strokePath(layers[activeLayer].ctx, strokePoints, ERASE_WIDTH, null, true);
      } else {
        const pts = strokePoints.slice(-2);
        if (pts.length === 2) strokePath(layers[activeLayer].ctx, pts, ERASE_WIDTH, null, true);
      }
    } else {
      // 画线预览画在覆盖层，抬起时才落笔，避免误判留下痕迹
      clearOverlay();
      strokePath(overlayCtx, strokePoints, LINE_WIDTH, layers[activeLayer].ink, false);
    }
  }
});

overlay.addEventListener("pointerup", (e) => {
  if (!drawing) return;
  drawing = false;
  clearOverlay();
  const result = tracker.finish();
  const layer = layers[activeLayer];

  if (result.type === "stamp") {
    drawStamp(layer.ctx, result.at.x, result.at.y, layer.ink);
  } else if (result.type === "line") {
    strokePath(layer.ctx, strokePoints, LINE_WIDTH, layer.ink, false);
  }
  // erase 已在移动过程中实时作用于当前图层

  layer.tool = result.type;           // 记录本图层最近使用的工具
  undoStack.push(preStrokeSnap);      // 提交历史
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
  syncToolUI();
  setStatus(`识别为「${TOOL_NAMES[result.type]}」，已作用于图层 ${activeLayer + 1}`);
  preStrokeSnap = null;
});

overlay.addEventListener("pointercancel", () => {
  drawing = false;
  clearOverlay();
  preStrokeSnap = null;
});

/* ================= 导出 PNG ================= */

function exportPNG() {
  const out = document.createElement("canvas");
  out.width = BOARD_W * DPR;
  out.height = BOARD_H * DPR;
  const ctx = out.getContext("2d");
  ctx.scale(DPR, DPR);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  layers.forEach((l) => ctx.drawImage(l.canvas, 0, 0, BOARD_W, BOARD_H));
  return out.toDataURL("image/png");
}

function downloadPNG() {
  const a = document.createElement("a");
  a.href = exportPNG();
  a.download = "drawing.png";
  a.click();
  setStatus("已导出 PNG");
}

/* ================= 事件绑定与初始化 ================= */

document.getElementById("undoBtn").addEventListener("click", undo);
document.getElementById("redoBtn").addEventListener("click", redo);
document.getElementById("exportBtn").addEventListener("click", downloadPNG);
document.querySelectorAll(".layer-btn").forEach((btn, i) => {
  btn.addEventListener("click", () => setActiveLayer(i));
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redo();
  }
});

setActiveLayer(0);
updateHistoryButtons();

// 暴露给自动化测试 / 调试
window.__app = { layers, undo, redo, exportPNG, setActiveLayer, get activeLayer() { return activeLayer; } };
