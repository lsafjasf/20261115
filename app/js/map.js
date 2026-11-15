import { setupCanvas } from "./util.js";

const COLORS = {
  speed: "#ff5d5d",
  reverse: "#ffb020",
  skip: "#b06bff",
  ok: "#37c978",
  accent: "#4da3ff",
  dim: "#3a4d6e",
  text: "#e6edf7",
  muted: "#8ba0bd",
};

function buildTransform(route, w, h, pad) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of route.path.waypoints) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const sx = (w - pad * 2) / Math.max(1, maxX - minX);
  const sy = (h - pad * 2) / Math.max(1, maxY - minY);
  const scale = Math.min(sx, sy);
  const ox = pad + ((w - pad * 2) - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = pad + ((h - pad * 2) - (maxY - minY) * scale) / 2 - minY * scale;
  return { x: (gx) => ox + gx * scale, y: (gy) => oy + gy * scale };
}

export function renderMap(canvas, route, view, theme = "screen") {
  const { ctx, w, h } = setupCanvas(canvas);
  const tr = buildTransform(route, w, h, 46);
  const bg = theme === "report" ? "#0b1220" : "#0b1220";

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(120,150,190,0.08)";
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= 1000; gx += 100) {
    ctx.beginPath(); ctx.moveTo(tr.x(gx), 0); ctx.lineTo(tr.x(gx), h); ctx.stroke();
  }
  for (let gy = 0; gy <= 600; gy += 100) {
    ctx.beginPath(); ctx.moveTo(0, tr.y(gy)); ctx.lineTo(w, tr.y(gy)); ctx.stroke();
  }

  const wp = route.path.waypoints;
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.strokeStyle = COLORS.dim;
  ctx.lineWidth = 9;
  ctx.beginPath();
  wp.forEach(([x, y], i) => i ? ctx.lineTo(tr.x(x), tr.y(y)) : ctx.moveTo(tr.x(x), tr.y(y)));
  ctx.stroke();

  const samples = route.samples;
  const t0 = view.window[0], t1 = view.window[1];
  const visible = samples.filter((p) => p.t >= t0 && p.t <= t1);

  const typeAt = new Map();
  for (const a of route.anomalies) {
    if (a.type === "skip") continue;
    if (!view.filters[a.type]) continue;
    for (let tt = a.start; tt < a.end; tt++) typeAt.set(tt, a.type);
  }

  ctx.lineWidth = 5;
  for (let i = 1; i < visible.length; i++) {
    const p0 = visible[i - 1], p1 = visible[i];
    const type = typeAt.get(p1.t);
    ctx.strokeStyle = type ? COLORS[type] : COLORS.accent;
    ctx.beginPath();
    ctx.moveTo(tr.x(p0.x), tr.y(p0.y));
    ctx.lineTo(tr.x(p1.x), tr.y(p1.y));
    ctx.stroke();
  }

  const dirIcon = { speed: "▲", reverse: "▼" };
  for (const a of route.anomalies) {
    if (a.type === "skip" || !view.filters[a.type]) continue;
    if (a.end < t0 || a.start > t1) continue;
    const mid = samples[Math.min(a.start, samples.length - 1)];
    const mx = tr.x(mid.x), my = tr.y(mid.y);
    ctx.fillStyle = COLORS[a.type];
    ctx.beginPath(); ctx.arc(mx, my, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#0b1220";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(dirIcon[a.type], mx, my + 1);
  }

  for (const st of route.stations) {
    const p = samples.reduce((best, sp) =>
      Math.abs(sp.s - st.s) < Math.abs(best.s - st.s) ? sp : best);
    const sx = tr.x(p.x), sy = tr.y(p.y);
    const skipped = !st.dwell || st.dwell === 0;
    const inWindow = p.t >= t0 && p.t <= t1;
    ctx.beginPath();
    ctx.arc(sx, sy, skipped ? 7 : 6, 0, Math.PI * 2);
    ctx.fillStyle = !inWindow ? "#44556f" : skipped
      ? (view.filters.skip ? COLORS.skip : "#44556f")
      : COLORS.ok;
    ctx.fill();
    ctx.strokeStyle = "#0b1220"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = inWindow ? COLORS.text : COLORS.muted;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(st.name, sx, sy + 9);
  }

  const cur = samples[Math.min(view.cursor, samples.length - 1)];
  if (cur && cur.t >= t0 && cur.t <= t1) {
    const cx = tr.x(cur.x), cy = tr.y(cur.y);
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
  }

  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.font = "11px sans-serif";
  const legend = [
    [COLORS.accent, "正常轨迹"],
    [COLORS.speed, "超速段"],
    [COLORS.reverse, "逆行段"],
    [COLORS.ok, "正常停靠站"],
    [COLORS.skip, "未停靠站"],
  ];
  let lx = 12;
  for (const [color, label] of legend) {
    ctx.fillStyle = color;
    ctx.fillRect(lx, h - 16, 10, 10);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(label, lx + 14, h - 11);
    lx += 14 + ctx.measureText(label).width + 16;
  }

  function hitTest(mx, my) {
    for (const st of route.stations) {
      const near = samples.reduce((best, sp) =>
        Math.abs(sp.s - st.s) < Math.abs(best.s - st.s) ? sp : best);
      const [sx, sy] = [tr.x(near.x), tr.y(near.y)];
      if (Math.hypot(mx - sx, my - sy) <= 14) {
        return { kind: "station", station: st, t: near.t };
      }
    }
    for (const a of route.anomalies) {
      if (a.type === "skip" || !view.filters[a.type]) continue;
      if (a.end < t0 || a.start > t1) continue;
      const mid = samples[Math.min(a.start, samples.length - 1)];
      if (Math.hypot(mx - tr.x(mid.x), my - tr.y(mid.y)) <= 16) {
        return { kind: "anomaly", anomaly: a, t: a.start };
      }
    }
    return null;
  }

  return { hitTest };
}
