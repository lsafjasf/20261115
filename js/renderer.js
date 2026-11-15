import { v3 } from './acoustics.js';

export class RoomRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.azimuth = 0.7;
    this.elevation = 0.35;
    this.distance = 12;
    this._bindControls();
  }

  _bindControls() {
    const el = this.canvas;
    let dragging = false;
    let lastX = 0, lastY = 0;
    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.azimuth -= (e.clientX - lastX) * 0.01;
      this.elevation = Math.max(-1.3, Math.min(1.45,
        this.elevation + (e.clientY - lastY) * 0.01));
      lastX = e.clientX;
      lastY = e.clientY;
    });
    el.addEventListener('pointerup', () => { dragging = false; });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance = Math.max(4, Math.min(40, this.distance + e.deltaY * 0.01));
    }, { passive: false });
  }

  _camera() {
    const ce = Math.cos(this.elevation), se = Math.sin(this.elevation);
    const ca = Math.cos(this.azimuth), sa = Math.sin(this.azimuth);
    const pos = [this.distance * ce * sa, this.distance * se, this.distance * ce * ca];
    const target = [0, 1.2, 0];
    const forward = v3.norm(v3.sub(target, pos));
    const right = v3.norm(v3.cross(forward, [0, 1, 0]));
    const up = v3.cross(right, forward);
    return { pos, forward, right, up };
  }

  _project(p, cam) {
    const rel = v3.sub(p, cam.pos);
    const z = v3.dot(rel, cam.forward);
    if (z <= 0.1) return null;
    const focal = this.canvas.height * 1.1;
    const x = v3.dot(rel, cam.right) * focal / z + this.canvas.width / 2;
    const y = -v3.dot(rel, cam.up) * focal / z + this.canvas.height / 2;
    return { x, y, z };
  }

  _roomCorners(room) {
    const hx = room.width / 2, hz = room.depth / 2;
    const pts = [];
    for (const y of [0, room.height]) {
      for (const z of [-hz, hz]) {
        for (const x of [-hx, hx]) pts.push([x, y, z]);
      }
    }
    return pts;
  }

  render({ room, pathPoints, sourcePos, listener, inside }) {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cam = this._camera();
    const proj = (p) => this._project(p, cam);

    this._drawGrid(cam, proj, room);
    this._drawRoom(cam, room);
    this._drawPath(pathPoints, cam, proj);
    this._drawListener(listener, cam, proj);
    this._drawSource(sourcePos, cam, proj, inside);
  }

  _drawGrid(cam, proj, room) {
    const ctx = this.ctx;
    const hx = room.width / 2 + 1.5, hz = room.depth / 2 + 1.5;
    ctx.strokeStyle = 'rgba(120,140,170,0.18)';
    ctx.lineWidth = 1;
    for (let x = -hx; x <= hx; x += 1) {
      const a = proj([x, 0, -hz]), b = proj([x, 0, hz]);
      if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    }
    for (let z = -hz; z <= hz; z += 1) {
      const a = proj([-hx, 0, z]), b = proj([hx, 0, z]);
      if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    }
  }

  _drawRoom(cam, room) {
    const c = this._roomCorners(room);
    const faces = [
      [0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1],
      [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3],
    ];
    const ordered = faces.map((idx) => {
      const pts = idx.map((i) => c[i]);
      const center = pts.reduce((acc, p) => v3.add(acc, v3.scale(p, 1 / pts.length)), [0, 0, 0]);
      return { pts, depth: v3.dist(center, cam.pos) };
    }).sort((a, b) => b.depth - a.depth);
    const ctx = this.ctx;
    for (const face of ordered) {
      const poly = face.pts.map((p) => this._project(p, cam));
      if (poly.some((p) => !p)) continue;
      ctx.beginPath();
      poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = 'rgba(94,164,233,0.08)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(94,164,233,0.75)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }

  _drawPath(points, cam, proj) {
    if (!points || points.length < 2) return;
    const ctx = this.ctx;
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(240,180,90,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (const p of points) {
      const q = proj(p);
      if (!q) { started = false; continue; }
      started ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      started = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of points) {
      const q = proj(p);
      if (!q) continue;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(240,180,90,0.95)';
      ctx.fill();
    }
  }

  _drawListener(listener, cam, proj) {
    const ctx = this.ctx;
    const q = proj(listener.position);
    if (!q) return;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#46d39a';
    ctx.fill();
    ctx.strokeStyle = '#0e3a2a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const tip = v3.add(listener.position, v3.scale(listener.forward, 1.1));
    const q2 = proj(tip);
    if (q2) {
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q2.x, q2.y);
      ctx.strokeStyle = '#46d39a';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  _drawSource(pos, cam, proj, inside) {
    const q = proj(pos);
    if (!q) return;
    const ctx = this.ctx;
    const color = inside ? '#ff5d5d' : '#ffb020';
    const pulse = 7 + Math.sin(performance.now() / 180) * 1.6;
    ctx.beginPath();
    ctx.arc(q.x, q.y, pulse + 6, 0, Math.PI * 2);
    ctx.fillStyle = inside ? 'rgba(255,93,93,0.18)' : 'rgba(255,176,32,0.22)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(q.x, q.y, pulse, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#3a0d0d';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
