import { T, DIR } from './layout.js';
import { RISK_OCC } from './sim.js';

export const CELL = 26;

const DIR_COLOR = {
  [DIR.OPEN]: '#3ddc84',
  [DIR.UP]: '#4aa3ff',
  [DIR.DOWN]: '#b06bff',
  [DIR.CLOSED]: '#ff5a5a',
};

export function draw(ctx, sim, opts) {
  const { cols, rows, cells } = sim.layout;
  const W = cols * CELL;
  const H = rows * CELL;
  ctx.clearRect(0, 0, W, H);

  // 背景：站台地面
  ctx.fillStyle = '#10161f';
  ctx.fillRect(0, 0, W, H);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * CELL;
      const y = r * CELL;
      if (cells[r][c] === T.WALL) {
        ctx.fillStyle = '#2a3340';
        ctx.fillRect(x, y, CELL, CELL);
        ctx.strokeStyle = '#3a4657';
        ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      } else if (cells[r][c] === T.EXIT) {
        ctx.fillStyle = '#143d2b';
        ctx.fillRect(x, y, CELL, CELL);
        ctx.fillStyle = '#3ddc84';
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('出', x + CELL / 2, y + CELL / 2 + 5);
      } else {
        ctx.fillStyle = '#161e29';
        ctx.fillRect(x, y, CELL, CELL);
      }
    }
  }

  drawSafeZone(ctx, sim);
  if (opts.heatmap) drawHeatmap(ctx, sim);
  drawSmoke(ctx, sim);
  drawControls(ctx, sim);
  drawFans(ctx, sim);
  drawSensors(ctx, sim);
  drawAgents(ctx, sim);
}

function drawSafeZone(ctx, sim) {
  ctx.save();
  ctx.fillStyle = 'rgba(61, 220, 132, 0.08)';
  ctx.strokeStyle = 'rgba(61, 220, 132, 0.5)';
  ctx.setLineDash([6, 4]);
  for (const z of sim.layout.safeZone) {
    ctx.fillRect(z.col * CELL, z.row * CELL, CELL, CELL);
  }
  ctx.strokeRect(CELL, 0, (sim.layout.cols - 2) * CELL, 3 * CELL);
  ctx.setLineDash([]);
  ctx.fillStyle = '#3ddc84';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('安全区（站厅）', CELL + 4, 14);
  ctx.restore();
}

function drawHeatmap(ctx, sim) {
  for (let r = 0; r < sim.layout.rows; r++) {
    for (let c = 0; c < sim.layout.cols; c++) {
      const occ = sim.occupancy[r][c];
      if (occ <= 1) continue;
      const ratio = Math.min(1, occ / RISK_OCC);
      const hue = 120 - ratio * 120; // 绿 -> 红
      ctx.fillStyle = `hsla(${hue}, 90%, 55%, ${0.18 + ratio * 0.5})`;
      ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
      if (occ >= RISK_OCC) {
        ctx.strokeStyle = '#ff2d2d';
        ctx.lineWidth = 2;
        ctx.strokeRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
        ctx.lineWidth = 1;
      }
    }
  }
}

function drawSmoke(ctx, sim) {
  for (let r = 0; r < sim.layout.rows; r++) {
    for (let c = 0; c < sim.layout.cols; c++) {
      const v = sim.smoke[r][c];
      if (v <= 0.02) continue;
      const alpha = Math.min(0.72, v / 3.2);
      ctx.fillStyle = `rgba(180, 180, 190, ${alpha})`;
      ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    }
  }
  // 火源
  const src = sim.layout.smokeSource;
  const fx = src.col * CELL + CELL / 2;
  const fy = src.row * CELL + CELL / 2;
  const flicker = 0.7 + 0.3 * Math.sin(sim.tick * 0.6);
  ctx.fillStyle = `rgba(255, ${Math.round(120 * flicker)}, 20, 0.95)`;
  ctx.beginPath();
  ctx.arc(fx, fy, CELL * 0.36 * flicker, 0, Math.PI * 2);
  ctx.fill();
}

function drawControls(ctx, sim) {
  for (const ctl of [...sim.layout.gates, ...sim.layout.channels]) {
    const x = ctl.col * CELL;
    const y = ctl.row * CELL;
    ctx.fillStyle = DIR_COLOR[ctl.dir];
    ctx.globalAlpha = 0.9;
    ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#0b0f15';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    let mark = '⇅';
    if (ctl.dir === DIR.UP) mark = '↑';
    if (ctl.dir === DIR.DOWN) mark = '↓';
    if (ctl.dir === DIR.CLOSED) mark = '✕';
    ctx.fillText(mark, x + CELL / 2, y + CELL / 2 + 4);

    ctx.fillStyle = '#cfe3ff';
    ctx.font = '9px sans-serif';
    ctx.fillText(ctl.id, x + CELL / 2, y - 2);
  }
}

function drawFans(ctx, sim) {
  for (const fan of sim.layout.fans) {
    const x = fan.col * CELL + CELL / 2;
    const y = fan.row * CELL + CELL / 2;
    ctx.save();
    ctx.translate(x, y);
    if (fan.on) ctx.rotate((sim.tick * 0.4) % (Math.PI * 2));
    ctx.strokeStyle = fan.on ? '#7fd0ff' : '#6b7686';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, CELL * 0.32, (i * 2 * Math.PI) / 3, (i * 2 * Math.PI) / 3 + 1.1);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = fan.on ? '#7fd0ff' : '#6b7686';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(fan.id, x, y + CELL * 0.62);
  }
}

function drawSensors(ctx, sim) {
  for (const s of sim.layout.sensors) {
    const x = s.col * CELL + CELL / 2;
    const y = s.row * CELL + CELL / 2;
    const alarm = s.alarm;
    if (alarm && sim.tick % 10 < 5) {
      ctx.fillStyle = 'rgba(255, 60, 60, 0.35)';
      ctx.beginPath();
      ctx.arc(x, y, CELL * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = alarm ? '#ff4d4d' : '#ffd24d';
    ctx.beginPath();
    ctx.arc(x, y, CELL * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAgents(ctx, sim) {
  for (const a of sim.agents) {
    const x = a.x * CELL;
    const y = a.y * CELL;
    const smoke = sim.smoke[a.row][a.col] || 0;
    ctx.fillStyle = smoke > 1 ? '#e0a0ff' : '#f4f7fb';
    ctx.beginPath();
    ctx.arc(x, y, CELL * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#22303f';
    ctx.stroke();
  }
}
