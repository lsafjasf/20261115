import { setupCanvas, formatClock, clamp } from "./util.js";

const COLORS = {
  speed: "#ff5d5d",
  reverse: "#ffb020",
  skip: "#b06bff",
  accent: "#4da3ff",
  dim: "#3a4d6e",
  text: "#e6edf7",
  muted: "#8ba0bd",
};

export function renderSpeedChart(canvas, route, view) {
  const { ctx, w, h } = setupCanvas(canvas);
  const padL = 52, padR = 16, padT = 16, padB = 34;
  const cw = w - padL - padR, ch = h - padT - padB;
  const samples = route.samples;
  const t0 = view.window[0], t1 = view.window[1];
  const vis = samples.filter((p) => p.t >= t0 && p.t <= t1);

  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, w, h);

  let vMax = route.speedLimit + 18;
  for (const p of vis) vMax = Math.max(vMax, Math.abs(p.speed) + 6);
  const vMin = -Math.max(20, ...vis.map((p) => Math.abs(Math.min(0, p.speed))));

  const xOf = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * cw;
  const yOf = (v) => padT + ((vMax - v) / (vMax - vMin)) * ch;

  ctx.strokeStyle = "rgba(120,150,190,0.14)";
  ctx.fillStyle = COLORS.muted;
  ctx.lineWidth = 1;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const v = vMax - ((vMax - vMin) * i) / ticks;
    const y = yOf(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillText(`${Math.round(v)}`, padL - 6, y);
  }

  ctx.strokeStyle = "rgba(230,237,247,0.55)";
  ctx.setLineDash([5, 4]);
  const yZero = yOf(0);
  ctx.beginPath(); ctx.moveTo(padL, yZero); ctx.lineTo(w - padR, yZero); ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = COLORS.speed;
  ctx.setLineDash([7, 4]);
  const yLimit = yOf(route.speedLimit);
  ctx.beginPath(); ctx.moveTo(padL, yLimit); ctx.lineTo(w - padR, yLimit); ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.speed;
  ctx.fillText(`限速 ${route.speedLimit}`, padL + 4, yLimit - 7);

  const typeAt = new Map();
  for (const a of route.anomalies) {
    if (a.type === "skip" || !view.filters[a.type]) continue;
    for (let tt = a.start; tt < a.end; tt++) typeAt.set(tt, a.type);
  }

  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  for (let i = 1; i < vis.length; i++) {
    const p0 = vis[i - 1], p1 = vis[i];
    const type = typeAt.get(p1.t);
    ctx.strokeStyle = type ? COLORS[type] : COLORS.accent;
    ctx.beginPath();
    ctx.moveTo(xOf(p0.t), yOf(p0.speed));
    ctx.lineTo(xOf(p1.t), yOf(p1.speed));
    ctx.stroke();
  }

  for (const a of route.anomalies) {
    if (a.type !== "skip" || !view.filters.skip) continue;
    if (a.start < t0 || a.start > t1) continue;
    const x = xOf(a.start);
    ctx.strokeStyle = COLORS.skip;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ch); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.skip;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("未停靠", x, padT + 2);
  }

  const cur = samples[clamp(view.cursor, 0, samples.length - 1)];
  if (cur && cur.t >= t0 && cur.t <= t1) {
    const x = xOf(cur.t);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ch); ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(x, yOf(cur.speed), 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(`${formatClock(cur.clock)} · ${cur.speed} km/h`, clamp(x, padL + 55, w - padR - 55), padT - 2);
  }

  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  const tickN = 8;
  for (let i = 0; i <= tickN; i++) {
    const t = t0 + ((t1 - t0) * i) / tickN;
    ctx.fillText(formatClock(samples[Math.round(clamp(t, 0, samples.length - 1))].clock), xOf(t), padT + ch + 8);
  }
  ctx.textAlign = "left";
  ctx.fillText("km/h", 8, padT);

  return {
    hitTest(mx) {
      if (mx < padL || mx > w - padR) return null;
      const t = t0 + ((mx - padL) / cw) * (t1 - t0);
      return clamp(Math.round(t), 0, samples.length - 1);
    },
  };
}
