// Plan-view contour map export: resolution-independent SVG and raster PNG.

import { contourAtLevel } from './marching.js';
import { buildPlanLoops, fullTerrainPolygon } from './contour-loops.js';

const MARGIN = 56;
const SIZE = 760;

const COLORS = {
  bg: '#0c1018',
  panel: '#111826',
  grid: 'rgba(160,190,230,0.12)',
  contour: 'rgba(214,228,255,0.62)',
  active: '#ffb340',
  fill: 'rgba(255,179,64,0.28)',
  text: '#e7eefc',
};

function makePlan(field, levels, activeLevel) {
  const map = new Map();
  for (const level of levels) {
    const result = contourAtLevel(field, level);
    map.set(level, {
      level,
      chains: buildPlanLoops(result.segments),
      active: Math.abs(level - activeLevel) < 1e-9,
    });
  }
  let highlight = [];
  const active = map.get(activeLevel);
  if (active) highlight = active.chains;
  if (activeLevel <= 0) highlight = [fullTerrainPolygon()];
  return { entries: [...map.values()], highlight };
}

function project(x, z) {
  const scale = SIZE - MARGIN * 2;
  return [MARGIN + ((x + 1) / 2) * scale, MARGIN + ((z + 1) / 2) * scale];
}

function pathData(loop) {
  return loop
    .map(([x, z], idx) => {
      const [px, py] = project(x, z);
      return `${idx === 0 ? 'M' : 'L'}${px.toFixed(2)},${py.toFixed(2)}`;
    })
    .join(' ') + ' Z';
}

function legendY(index) {
  return SIZE - 26 - index * 0;
}

export function exportSVG(field, levels, activeLevel) {
  const plan = makePlan(field, levels, activeLevel);
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" font-family="ui-sans-serif, system-ui, sans-serif">`,
  );
  parts.push(`<rect width="100%" height="100%" fill="${COLORS.bg}"/>`);
  parts.push(`<rect x="${MARGIN}" y="${MARGIN}" width="${SIZE - MARGIN * 2}" height="${SIZE - MARGIN * 2}" fill="${COLORS.panel}" stroke="rgba(255,255,255,0.18)"/>`);
  for (let k = 1; k < 4; k++) {
    const p = MARGIN + ((SIZE - MARGIN * 2) * k) / 4;
    parts.push(`<line x1="${p}" y1="${MARGIN}" x2="${p}" y2="${SIZE - MARGIN}" stroke="${COLORS.grid}"/>`);
    parts.push(`<line x1="${MARGIN}" y1="${p}" x2="${SIZE - MARGIN}" y2="${p}" stroke="${COLORS.grid}"/>`);
  }
  for (const loop of plan.highlight) {
    parts.push(`<path d="${pathData(loop)}" fill="${COLORS.fill}" stroke="none"/>`);
  }
  for (const entry of plan.entries) {
    const stroke = entry.active ? COLORS.active : COLORS.contour;
    const width = entry.active ? 2.4 : 1;
    for (const loop of entry.chains) {
      parts.push(`<path d="${pathData(loop)}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`);
    }
  }
  parts.push(`<text x="${MARGIN}" y="30" fill="${COLORS.text}" font-size="18" font-weight="600">地形等高线图</text>`);
  parts.push(`<text x="${SIZE - MARGIN}" y="30" text-anchor="end" fill="${COLORS.active}" font-size="14">阈值 ${Math.round(activeLevel * 1000)} m</text>`);
  for (let k = 0; k < plan.entries.length; k++) {
    const entry = plan.entries[k];
    const x = MARGIN + k * 72;
    parts.push(`<line x1="${x}" y1="${legendY(0)}" x2="${x + 18}" y2="${legendY(0)}" stroke="${entry.active ? COLORS.active : COLORS.contour}" stroke-width="${entry.active ? 2.4 : 1}"/>`);
    parts.push(`<text x="${x + 24}" y="${legendY(0) + 4}" fill="${COLORS.text}" font-size="11">${Math.round(entry.level * 1000)}</text>`);
  }
  parts.push('</svg>');
  return new Blob([parts.join('\n')], { type: 'image/svg+xml;charset=utf-8' });
}

export function exportPNG(field, levels, activeLevel) {
  const plan = makePlan(field, levels, activeLevel);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE * 2;
  canvas.height = SIZE * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(MARGIN, MARGIN, SIZE - MARGIN * 2, SIZE - MARGIN * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.strokeRect(MARGIN, MARGIN, SIZE - MARGIN * 2, SIZE - MARGIN * 2);
  ctx.strokeStyle = COLORS.grid;
  for (let k = 1; k < 4; k++) {
    const p = MARGIN + ((SIZE - MARGIN * 2) * k) / 4;
    ctx.beginPath();
    ctx.moveTo(p, MARGIN);
    ctx.lineTo(p, SIZE - MARGIN);
    ctx.moveTo(MARGIN, p);
    ctx.lineTo(SIZE - MARGIN, p);
    ctx.stroke();
  }
  const trace = (loop) => {
    ctx.beginPath();
    loop.forEach(([x, z], idx) => {
      const [px, py] = project(x, z);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  };
  for (const loop of plan.highlight) {
    trace(loop);
    ctx.fillStyle = COLORS.fill;
    ctx.fill();
  }
  for (const entry of plan.entries) {
    ctx.strokeStyle = entry.active ? COLORS.active : COLORS.contour;
    ctx.lineWidth = entry.active ? 2.4 : 1;
    for (const loop of entry.chains) {
      trace(loop);
      ctx.stroke();
    }
  }
  ctx.fillStyle = COLORS.text;
  ctx.font = '600 18px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText('地形等高线图', MARGIN, 30);
  ctx.fillStyle = COLORS.active;
  ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`阈值 ${Math.round(activeLevel * 1000)} m`, SIZE - MARGIN, 30);
  ctx.textAlign = 'left';
  plan.entries.forEach((entry, k) => {
    const x = MARGIN + k * 72;
    const y = legendY(0);
    ctx.strokeStyle = entry.active ? COLORS.active : COLORS.contour;
    ctx.lineWidth = entry.active ? 2.4 : 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 18, y);
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(String(Math.round(entry.level * 1000)), x + 24, y + 4);
  });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
