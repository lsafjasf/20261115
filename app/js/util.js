export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function formatClock(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

export function formatDur(seconds) {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}分${pad2(sec)}秒` : `${sec}秒`;
}

export function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(50, rect.width);
  const h = Math.max(50, rect.height);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export function makePath(waypoints) {
  const segLens = [];
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i][0] - waypoints[i - 1][0];
    const dy = waypoints[i][1] - waypoints[i - 1][1];
    const len = Math.hypot(dx, dy);
    segLens.push(len);
    total += len;
  }
  return {
    waypoints,
    segLens,
    total,
    pointAt(s) {
      const target = clamp(s, 0, 1) * total;
      let acc = 0;
      for (let i = 0; i < segLens.length; i++) {
        if (acc + segLens[i] >= target) {
          const r = segLens[i] === 0 ? 0 : (target - acc) / segLens[i];
          return [
            waypoints[i][0] + (waypoints[i + 1][0] - waypoints[i][0]) * r,
            waypoints[i][1] + (waypoints[i + 1][1] - waypoints[i][1]) * r,
          ];
        }
        acc += segLens[i];
      }
      return waypoints[waypoints.length - 1].slice();
    },
  };
}

export function downloadPNG(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
