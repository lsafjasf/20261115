import { MATERIALS, FIXED_MATERIALS } from "./materials.js";
import { sourcePos, listenerPos } from "./acoustics.js";

const PAD = 70;

export class RoomView {
  constructor(canvas, state, hooks) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.state = state;
    this.hooks = hooks; // onResize, onMaterialDrop
    this.dragWall = null;
    this.hoverWall = null;
    this.paths = [];
    this.bindEvents();
  }

  setPaths(paths) { this.paths = paths; this.draw(); }

  scale() {
    const cw = this.cv.width - PAD * 2;
    const ch = this.cv.height - PAD * 2;
    // 按当前房间尺度自适应，保证小房间也能占满画布；留 20% 余量避免贴边
    const fitW = cw / (this.state.width * 1.2);
    const fitD = ch / (this.state.depth * 1.2);
    return Math.min(fitW, fitD);
  }

  toPx(x, z) {
    const s = this.scale();
    const { width: w, depth: d } = this.state;
    const ox = (this.cv.width - w * s) / 2;
    const oz = (this.cv.height - d * s) / 2;
    return { x: ox + x * s, y: oz + z * s };
  }

  wallRect(wall) {
    const t = 14;
    const s = this.scale();
    const { width: w, depth: d } = this.state;
    const tl = this.toPx(0, 0);
    if (wall === "left") return { x: tl.x - t / 2, y: tl.y, w: t, h: d * s };
    if (wall === "right") return { x: tl.x + w * s - t / 2, y: tl.y, w: t, h: d * s };
    if (wall === "back") return { x: tl.x, y: tl.y + d * s - t / 2, w: w * s, h: t };
    if (wall === "front") return { x: tl.x, y: tl.y - t / 2, w: w * s, h: t };
  }

  hitWall(mx, my) {
    for (const wall of ["left", "right", "back", "front"]) {
      const r = this.wallRect(wall);
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return wall;
    }
    return null;
  }

  bindEvents() {
    const pos = (e) => {
      const b = this.cv.getBoundingClientRect();
      return {
        x: (e.clientX - b.left) * (this.cv.width / b.width),
        y: (e.clientY - b.top) * (this.cv.height / b.height),
      };
    };

    this.cv.addEventListener("pointerdown", (e) => {
      const p = pos(e);
      const wall = this.hitWall(p.x, p.y);
      if (wall && wall !== "front") {
        this.dragWall = wall;
        this.cv.setPointerCapture(e.pointerId);
      }
    });
    this.cv.addEventListener("pointermove", (e) => {
      const p = pos(e);
      if (this.dragWall) {
        const s = this.scale();
        const ox = (this.cv.width - this.state.width * s) / 2;
        const oz = (this.cv.height - this.state.depth * s) / 2;
        if (this.dragWall === "left") {
          const rightPx = ox + this.state.width * s;
          this.hooks.onResize({ width: (rightPx - p.x) / s });
        } else if (this.dragWall === "right") {
          this.hooks.onResize({ width: (p.x - ox) / s });
        } else if (this.dragWall === "back") {
          this.hooks.onResize({ depth: (p.y - oz) / s });
        }
      } else {
        this.hoverWall = this.hitWall(p.x, p.y);
        this.cv.style.cursor = this.hoverWall && this.hoverWall !== "front" ? "ew-resize" : "default";
      }
    });
    const end = (e) => { this.dragWall = null; try { this.cv.releasePointerCapture(e.pointerId); } catch {} };
    this.cv.addEventListener("pointerup", end);
    this.cv.addEventListener("pointercancel", end);

    // HTML5 拖放材质
    this.cv.addEventListener("dragover", (e) => {
      e.preventDefault();
      const p = pos(e);
      this.hoverWall = this.hitWall(p.x, p.y);
      this.draw();
    });
    this.cv.addEventListener("drop", (e) => {
      e.preventDefault();
      const p = pos(e);
      const wall = this.hitWall(p.x, p.y);
      const matId = e.dataTransfer.getData("text/material-id");
      if (wall && wall !== "front" && matId && MATERIALS[matId]) {
        this.hooks.onMaterialDrop(wall, matId);
      }
      this.hoverWall = null;
      this.draw();
    });
    this.cv.addEventListener("dragleave", () => { this.hoverWall = null; this.draw(); });
  }

  draw() {
    const c = this.ctx;
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    const { width: w, depth: d } = this.state;
    const tl = this.toPx(0, 0);
    const s = this.scale();

    // 地板
    c.fillStyle = "#111823";
    c.fillRect(tl.x, tl.y, w * s, d * s);
    c.strokeStyle = "#223044";
    c.lineWidth = 1;
    for (let gx = 1; gx < w; gx++) {
      const a = this.toPx(gx, 0);
      c.beginPath(); c.moveTo(a.x, tl.y); c.lineTo(a.x, tl.y + d * s); c.stroke();
    }
    for (let gz = 1; gz < d; gz++) {
      const b = this.toPx(0, gz);
      c.beginPath(); c.moveTo(tl.x, b.y); c.lineTo(tl.x + w * s, b.y); c.stroke();
    }

    // 反射路径（直达声之后的 9 条，二阶更淡）
    const src = sourcePos(this.state);
    const lis = listenerPos(this.state);
    const sp = this.toPx(src.x, src.z);
    const lp = this.toPx(lis.x, lis.z);
    this.paths.forEach((p) => {
      if (p.order === 0) return;
      c.strokeStyle = p.order === 1 ? `rgba(76,194,255,${0.25 + p.gain * 0.55})`
                                     : `rgba(255,206,107,${0.18 + p.gain * 0.4})`;
      c.lineWidth = p.order === 1 ? 1.4 : 1;
      c.setLineDash(p.order === 1 ? [] : [5, 4]);
      c.beginPath();
      c.moveTo(sp.x, sp.y);
      this.drawBentPath(p, src, lis, c);
      c.stroke();
    });
    c.setLineDash([]);
    // 直达声
    c.strokeStyle = "rgba(255,255,255,0.55)";
    c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(sp.x, sp.y); c.lineTo(lp.x, lp.y); c.stroke();

    // 四面墙
    for (const wall of ["left", "right", "back", "front"]) {
      const mat = wall === "front" ? FIXED_MATERIALS.front : MATERIALS[this.state.walls[wall]];
      const r = this.wallRect(wall);
      c.fillStyle = mat.color;
      c.globalAlpha = this.hoverWall === wall ? 1 : 0.85;
      c.fillRect(r.x, r.y, r.w, r.h);
      c.globalAlpha = 1;
      c.strokeStyle = this.hoverWall === wall ? "#4cc2ff" : "#0b0f15";
      c.lineWidth = this.hoverWall === wall ? 2.5 : 1;
      c.strokeRect(r.x, r.y, r.w, r.h);
      this.wallLabel(wall, r, mat, c);
    }

    // 拖动手柄
    for (const wall of ["left", "right", "back"]) {
      const r = this.wallRect(wall);
      const hx = wall === "back" ? r.x + r.w / 2 : r.x + r.w / 2;
      const hy = wall === "back" ? r.y + r.h / 2 : r.y + r.h / 2;
      c.fillStyle = "#ffce6b";
      c.beginPath();
      c.arc(hx, hy, 6, 0, Math.PI * 2);
      c.fill();
    }

    // 鼓与听音位
    this.icon(sp, "🥁", "鼓", c);
    this.icon(lp, "🎧", "听音位", c);
  }

  wallLabel(wall, r, mat, c) {
    c.save();
    c.fillStyle = "#10151d";
    c.font = "11px sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    const text = `${mat.name} α=${mat.alpha}`;
    if (wall === "left" || wall === "right") {
      c.translate(r.x + r.w / 2, r.y + r.h / 2);
      c.rotate(-Math.PI / 2);
      c.fillText(text, 0, 0);
    } else {
      c.fillText(text, r.x + r.w / 2, r.y + r.h / 2);
    }
    c.restore();
  }

  icon(p, emoji, label, c) {
    c.font = "20px sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(emoji, p.x, p.y - 2);
    c.font = "10px sans-serif";
    c.fillStyle = "#8a96a8";
    c.fillText(label, p.x, p.y + 16);
  }

  // 镜像声源 -> 听音位的直线，逐点折叠回真实房间，得到反射折线
  drawBentPath(p, src, lis, c) {
    const { width: w, depth: d } = this.state;
    const fold = (v, size) => {
      let q = ((v % (2 * size)) + 2 * size) % (2 * size);
      return q > size ? 2 * size - q : q;
    };
    const img = p.image;
    const steps = 30;
    let last = null;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const x = img.x + (lis.x - img.x) * t;
      const z = img.z + (lis.z - img.z) * t;
      const q = this.toPx(fold(x, w), fold(z, d));
      // 天花板反射在俯视图中用轻微正弦扰动区分
      if (p.walls.includes("ceiling")) q.y += Math.sin(t * Math.PI) * 10;
      if (last && Math.hypot(q.x - last.x, q.y - last.y) > 40) c.moveTo(q.x, q.y);
      else c.lineTo(q.x, q.y);
      last = q;
    }
  }
}
