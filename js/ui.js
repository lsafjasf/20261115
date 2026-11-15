// UI：零件信息面板、校验日志、零件库、转速曲线与导出
import { GEARS, PARTS_BIN, MODULE, ESCAPEMENT, pitchRadius, gearById } from './data.js';
import { rpmOf, gearForces } from './sim.js';

const ESC_PARTS = {
  anchor: { name: '擒纵叉（锚）' },
  pendulum: { name: '摆锤' },
};

export function partName(id) {
  const g = gearById(id);
  if (g) return g.name;
  return ESC_PARTS[id] ? ESC_PARTS[id].name : id;
}

// 点击拾取：世界坐标 -> 零件 id
export function pickPart(wx, wy) {
  let best = null;
  let bestD = 1e9;
  for (const g of GEARS) {
    const r = pitchRadius(Math.max(g.wheel, g.pinion)) + 10;
    const d = Math.hypot(wx - g.x, wy - g.y);
    if (d < r && d < bestD) { best = g.id; bestD = d; }
  }
  if (best) return best;
  const esc = gearById('escape');
  const px = esc.x + ESCAPEMENT.anchorPivot.dx;
  const py = esc.y + ESCAPEMENT.anchorPivot.dy;
  if (Math.hypot(wx - px, wy - py) < 40) return 'anchor';
  const by = py + ESCAPEMENT.pendulumLen;
  if (Math.hypot(wx - px, wy - by) < 40) return 'pendulum';
  return null;
}

export function describePart(sim, id, faulty) {
  if (id === 'anchor') {
    const torque = sim.torques.escape || 0;
    return `擒纵叉（锚）\n跨距：${ESCAPEMENT.anchorSpan}px\n` +
      `摆动周期：${(2 * ESCAPEMENT.beatPeriod).toFixed(2)}s\n` +
      `当前摆幅：${(ESCAPEMENT.amplitude * sim.ramp).toFixed(3)} rad\n` +
      `受力：叉瓦冲击 ≈ ${(torque / 60).toFixed(2)} N`;
  }
  if (id === 'pendulum') {
    return `摆锤\n摆长：${ESCAPEMENT.pendulumLen}px\n` +
      `周期：${(2 * ESCAPEMENT.beatPeriod).toFixed(2)}s\n` +
      `摆幅：${(ESCAPEMENT.amplitude * sim.ramp).toFixed(3)} rad`;
  }
  const g = gearById(id);
  if (!g) return '';
  const lines = [`${g.name}${faulty ? '（故障件）' : ''}`];
  if (g.wheel > 0) lines.push(`轮片：${g.wheel}T，节圆半径 ${pitchRadius(g.wheel)}px`);
  if (g.pinion > 0) lines.push(`轴齿：${g.pinion}T，节圆半径 ${pitchRadius(g.pinion)}px`);
  lines.push(`模数：m=${MODULE}`);
  lines.push(`转速：${rpmOf(sim, id).toFixed(4)} rpm`);
  const f = gearForces(sim, id);
  lines.push(`扭矩：${f.torque.toFixed(2)} N·mm`);
  for (const m of f.meshes) {
    lines.push(`啮合 ${m.other}：切向力 ${m.force.toFixed(2)} N @ r=${m.radius}px`);
  }
  return lines.join('\n');
}

export function renderVerifyLog(el, results) {
  el.innerHTML = '';
  for (const r of results) {
    const li = document.createElement('li');
    li.className = r.ok ? 'ok' : 'err';
    li.textContent = `${r.ok ? '✓' : '✗'} ${r.msg}`;
    el.appendChild(li);
  }
}

export function renderPartsBin(el, selectedGearId, onPick) {
  el.innerHTML = '';
  for (const p of PARTS_BIN) {
    const btn = document.createElement('button');
    btn.className = 'part-btn';
    btn.innerHTML = `<span>${p.label}</span><span>→ ${partName(p.target)}</span>`;
    btn.disabled = selectedGearId !== p.target;
    btn.title = btn.disabled ? '先在画布中选中可替换的齿轮' : '点击替换';
    btn.addEventListener('click', () => onPick(p));
    el.appendChild(btn);
  }
}

// 转速曲线：各齿轮按自身峰值归一化，展示启动过渡与波动
export function drawChart(canvas, samples) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d1014';
  ctx.fillRect(0, 0, W, H);
  if (!samples || samples.length < 2) return;
  const ids = ['escape', 'fourth', 'third', 'center'];
  const colors = { escape: '#ffd166', fourth: '#7ee787', third: '#79b8ff', center: '#ff9ecf' };
  const tMax = samples[samples.length - 1].t;
  ctx.strokeStyle = '#2c333d';
  ctx.lineWidth = 1;
  for (let i = 1; i < 10; i++) {
    const x = (i / 10) * W;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (const id of ids) {
    let max = 0;
    for (const s of samples) max = Math.max(max, Math.abs(s[id]));
    if (max === 0) continue;
    ctx.strokeStyle = colors[id];
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    samples.forEach((s, i) => {
      const x = (s.t / tMax) * W;
      const y = H - 6 - (Math.abs(s[id]) / max) * (H - 36);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.font = '11px sans-serif';
  const short = { escape: '擒纵轮', fourth: '四轮(秒)', third: '三轮', center: '中心轮(分)' };
  ids.forEach((id, i) => {
    ctx.fillStyle = colors[id];
    const steady = Math.abs(samples[samples.length - 1][id]).toFixed(3);
    ctx.fillText(`${short[id]} ${steady}rpm`, 8 + (i % 2) * 170, 14 + Math.floor(i / 2) * 14);
  });
  ctx.fillStyle = '#9fb7d4';
  ctx.fillText('0s', 4, H - 2);
  ctx.fillText(`${tMax}s`, W - 30, H - 2);
}

export function exportCsv(samples) {
  const ids = GEARS.map((g) => g.id);
  const head = ['t(s)', ...ids.map((id) => `${id}(rpm)`)].join(',');
  const rows = samples.map((s) => [s.t, ...ids.map((id) => s[id])].join(','));
  download([head, ...rows].join('\n'), 'clock-rpm-10s.csv', 'text/csv');
}

export function exportPng(canvas) {
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = 'clock-rpm-curve.png';
  a.click();
}

function download(text, name, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
