import { WORLD_W, WORLD_H } from "./scene.js";

const CELL = 256;
const GRID_COLS = Math.ceil(WORLD_W / CELL);
const GRID_ROWS = Math.ceil(WORLD_H / CELL);
const CELL_COUNT = GRID_COLS * GRID_ROWS;
const SHADOW_MARGIN = 24; // blur(12) + offsetY(8), rounded up
// A shape (max 96px, cell 256px) overlaps at most 2x2 cells.
const MAX_CELLS_PER_SHAPE = 4;

// Owns per-frame scratch buffers so a long benchmark never allocates in
// the hot loop. The visible list is always ascending shape id, which is
// the canonical painter order; spatial sort changes only how the list is
// gathered, never paint order, so every configuration paints identical
// pixels.
export class Renderer {
  constructor(ctx) {
    this.ctx = ctx;
    this.head = new Int32Array(CELL_COUNT);
    this.entryShape = new Int32Array(0);
    this.entryNext = new Int32Array(0);
    this.emitted = new Uint8Array(0);
    this.visible = [];
    this.lastFrameCount = { fill: 0, text: 0, culled: 0, visible: 0 };
  }

  renderFrame(scene, camera, viewW, viewH, options) {
    const layoutStart = performance.now();
    const list = this.buildList(scene, camera, viewW, viewH, options);
    const layoutMs = performance.now() - layoutStart;

    const drawStart = performance.now();
    const calls = this.paint(scene, camera, list, options);
    const drawMs = performance.now() - drawStart;

    return { layoutMs, drawMs, ...calls };
  }

  viewBounds(camera, viewW, viewH, shadows) {
    const margin = shadows ? SHADOW_MARGIN : 0;
    return {
      x0: camera.x - margin,
      y0: camera.y - margin,
      x1: camera.x + viewW + margin,
      y1: camera.y + viewH + margin,
    };
  }

  overlaps(s, b) {
    return s.x <= b.x1 && s.x + s.size >= b.x0 &&
      s.y <= b.y1 && s.y + s.size >= b.y0;
  }

  buildList(scene, camera, viewW, viewH, options) {
    const shapes = scene.shapes;
    const n = shapes.length;
    if (this.emitted.length < n) {
      this.emitted = new Uint8Array(n);
    }
    if (this.entryShape.length < n * MAX_CELLS_PER_SHAPE) {
      const capacity = n * MAX_CELLS_PER_SHAPE;
      this.entryShape = new Int32Array(capacity);
      this.entryNext = new Int32Array(capacity).fill(-1);
    }
    const { spatialSort, culling, shadows } = options;
    const out = [];
    this.visible = out;

    if (!spatialSort) {
      const b = this.viewBounds(camera, viewW, viewH, shadows);
      for (let i = 0; i < n; i++) {
        if (!culling || this.overlaps(shapes[i], b)) out.push(i);
      }
      this.recordCount(n, out);
      return out;
    }

    // Bucket each shape into every cell its AABB covers. Shapes are
    // smaller than a cell but can straddle a boundary, so single-cell
    // anchoring would miss shapes when the viewport starts mid-cell.
    this.head.fill(-1);
    this.emitted.fill(0);
    this.entryNext.fill(-1);
    let entryCount = 0;
    for (let i = 0; i < n; i++) {
      const s = shapes[i];
      const c0 = Math.max(0, Math.floor(s.x / CELL));
      const c1 = Math.min(GRID_COLS - 1, Math.floor((s.x + s.size) / CELL));
      const r0 = Math.max(0, Math.floor(s.y / CELL));
      const r1 = Math.min(GRID_ROWS - 1, Math.floor((s.y + s.size) / CELL));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const cell = r * GRID_COLS + c;
          const entry = entryCount++;
          this.entryShape[entry] = i;
          this.entryNext[entry] = this.head[cell];
          this.head[cell] = entry;
        }
      }
    }

    // Walk only cells overlapping the (optionally shadow-expanded) view.
    const b = this.viewBounds(camera, viewW, viewH, shadows);
    // With culling off every shape must be painted, so walk every cell.
    // With culling on, expand the viewport cell range by one on each side:
    // a shape anchored just outside a viewport cell can still overlap via
    // its AABB or shadow margin.
    const c0 = culling ? Math.max(0, Math.floor(b.x0 / CELL) - 1) : 0;
    const c1 = culling ? Math.min(GRID_COLS - 1, Math.floor(b.x1 / CELL) + 1) : GRID_COLS - 1;
    const r0 = culling ? Math.max(0, Math.floor(b.y0 / CELL) - 1) : 0;
    const r1 = culling ? Math.min(GRID_ROWS - 1, Math.floor(b.y1 / CELL) + 1) : GRID_ROWS - 1;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = r * GRID_COLS + c;
        let entry = this.head[cell];
        while (entry !== -1) {
          const idx = this.entryShape[entry];
          const s = shapes[idx];
          if ((!culling || this.overlaps(s, b)) && this.emitted[idx] === 0) {
            this.emitted[idx] = 1;
            out.push(idx);
          }
          entry = this.entryNext[entry];
        }
      }
    }
    // Cell/chain traversal is spatially ordered; restore canonical id order
    // so the painted result is pixel-identical to the linear path.
    out.sort((a, z) => a - z);
    this.recordCount(n, out);
    return out;
  }

  recordCount(total, out) {
    this.lastFrameCount.culled = total - out.length;
    this.lastFrameCount.visible = out.length;
  }

  paint(scene, camera, list, options) {
    const ctx = this.ctx;
    const shapes = scene.shapes;
    let fillCalls = 0;
    let textCalls = 0;

    ctx.save();
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.translate(-Math.round(camera.x), -Math.round(camera.y));

    // Pass 1: shadows. Grouped so shadow state is set once.
    if (options.shadows) {
      ctx.save();
      ctx.shadowColor = "rgba(20, 24, 33, 0.35)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 8;
      for (let k = 0; k < list.length; k++) {
        const s = shapes[list[k]];
        ctx.fillStyle = s.color;
        this.tracePath(s);
        ctx.fill();
        fillCalls++;
      }
      ctx.restore();
    }

    // Pass 2: solid fills (no shadow state).
    for (let k = 0; k < list.length; k++) {
      const s = shapes[list[k]];
      ctx.fillStyle = s.color;
      this.tracePath(s);
      ctx.fill();
      fillCalls++;
    }

    // Pass 3: labels, always without shadow state for stable parity.
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let k = 0; k < list.length; k++) {
      const s = shapes[list[k]];
      ctx.fillText(s.label, s.x + s.size / 2, s.y + s.size / 2);
      textCalls++;
    }

    ctx.restore();

    this.lastFrameCount.fill = fillCalls;
    this.lastFrameCount.text = textCalls;
    return {
      fillCalls,
      textCalls,
      drawCalls: fillCalls + textCalls,
    };
  }

  tracePath(s) {
    const ctx = this.ctx;
    ctx.beginPath();
    if (s.type === "rect") {
      ctx.rect(s.x, s.y, s.size, s.size);
    } else if (s.type === "circle") {
      const r = s.size / 2;
      ctx.arc(s.x + r, s.y + r, r, 0, Math.PI * 2);
    } else {
      const q = Math.min(18, s.size * 0.22);
      this.roundRectPath(s.x, s.y, s.size, s.size, q);
    }
  }

  roundRectPath(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
