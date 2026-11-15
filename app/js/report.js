import { renderMap } from "./map.js";
import { renderSpeedChart } from "./speedChart.js";
import { formatClock, formatDur, downloadPNG } from "./util.js";

const TYPE_LABEL = { speed: "超速", reverse: "逆行", skip: "未停靠" };
const TYPE_COLOR = { speed: "#ff5d5d", reverse: "#ffb020", skip: "#b06bff" };

export function exportReport(route, view) {
  const W = 1600, H = 1180;
  const root = document.createElement("canvas");
  root.width = W; root.height = H;
  const ctx = root.getContext("2d");
  ctx.fillStyle = "#0f1622";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#e6edf7";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillText(`车辆轨迹审计报告 · ${route.name}`, 40, 48);

  const [t0, t1] = view.window;
  const s0 = route.samples[t0], s1 = route.samples[Math.min(t1, route.samples.length - 1)];
  const counts = { speed: 0, reverse: 0, skip: 0 };
  for (const a of route.anomalies) {
    if (a.start > t1 || (a.type !== "skip" && a.end < t0)) continue;
    if (a.type === "skip" && (a.start < t0 || a.start > t1)) continue;
    if (!view.filters[a.type]) continue;
    counts[a.type] += 1;
  }
  ctx.font = "15px sans-serif";
  ctx.fillStyle = "#8ba0bd";
  const now = new Date();
  const genAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${formatClock(now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds())}`;
  ctx.fillText(
    `时段 ${formatClock(s0.clock)} – ${formatClock(s1.clock)}（${formatDur(t1 - t0)}） · 限速 ${route.speedLimit} km/h · 生成于 ${genAt}`,
    40, 80
  );

  function panel(x, y, w, h, title) {
    ctx.fillStyle = "#182234";
    ctx.strokeStyle = "#2c3d5a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#8ba0bd";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(title, x + 16, y + 26);
  }

  const mapCanvas = document.createElement("canvas");
  mapCanvas.style.width = "900px";
  mapCanvas.style.height = "404px";
  document.body.appendChild(mapCanvas);
  renderMap(mapCanvas, route, view, "report");
  panel(40, 100, 940, 470, "地图轨迹与异常标记");
  ctx.drawImage(mapCanvas, 56, 140, 908, 416);
  mapCanvas.remove();

  const speedCanvas = document.createElement("canvas");
  speedCanvas.style.width = "900px";
  speedCanvas.style.height = "274px";
  document.body.appendChild(speedCanvas);
  renderSpeedChart(speedCanvas, route, view);
  panel(40, 590, 940, 340, "速度曲线");
  ctx.drawImage(speedCanvas, 56, 630, 908, 286);
  speedCanvas.remove();

  panel(1000, 100, 560, 470, "异常事件汇总");
  let ay = 140;
  ctx.font = "14px sans-serif";
  for (const type of ["speed", "reverse", "skip"]) {
    ctx.fillStyle = TYPE_COLOR[type];
    ctx.fillRect(1020, ay - 12, 12, 12);
    ctx.fillStyle = "#e6edf7";
    ctx.fillText(`${TYPE_LABEL[type]}：${counts[type]} 起`, 1042, ay - 2);
    ay += 30;
  }
  ay += 6;
  const rows = route.anomalies.filter((a) => view.filters[a.type]).filter((a) => {
    if (a.type === "skip") return a.start >= t0 && a.start <= t1;
    return a.end >= t0 && a.start <= t1;
  }).slice(0, 14);
  for (const a of rows) {
    ctx.fillStyle = TYPE_COLOR[a.type];
    ctx.fillText(TYPE_LABEL[a.type], 1020, ay);
    ctx.fillStyle = "#c9d6e8";
    const detail = a.type === "skip"
      ? `${a.stationName} 未停靠`
      : a.type === "speed"
        ? `峰值 ${a.peak} km/h（限 ${a.speedLimit}）`
        : `峰值 ${a.peak} km/h`;
    ctx.fillText(`${formatClock(route.samples[a.start].clock)}  ${detail}`, 1090, ay);
    ay += 26;
    if (ay > 548) break;
  }

  panel(1000, 590, 560, 340, "站点停靠记录");
  let sy = 630;
  ctx.font = "14px sans-serif";
  for (const st of route.stations) {
    const near = route.samples.reduce((best, p) =>
      Math.abs(p.s - st.s) < Math.abs(best.s - st.s) ? p : best);
    const skipped = !st.dwell || st.dwell === 0;
    ctx.fillStyle = skipped ? TYPE_COLOR.skip : "#37c978";
    ctx.fillText(skipped ? "未停靠" : "已停靠", 1020, sy);
    ctx.fillStyle = "#c9d6e8";
    const dwell = skipped ? "—" : `${st.dwellSec}s @ ${formatClock(route.samples[st.arrival].clock)}`;
    ctx.fillText(`${st.name}  ${dwell}`, 1100, sy);
    sy += 28;
  }

  ctx.fillStyle = "#5f7393";
  ctx.font = "12px sans-serif";
  ctx.fillText("本报告由车辆轨迹审计平台自动生成，数据为内置模拟数据，全部图形由 Canvas 离线渲染。", 40, H - 24);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  downloadPNG(root.toDataURL("image/png"), `audit-${route.id}-${stamp}.png`);
}
