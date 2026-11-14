import {
  ANCHOR_DEFS,
  DEFAULT_TENSION,
  QuarrySimulation,
  SIMULATION_SECONDS,
  TENSION_SAFE,
  WORLD
} from './simulation.js';
import { QuarryAudio } from './audio.js';

const canvas = document.querySelector('#scene');
const context = canvas.getContext('2d');
const audio = new QuarryAudio();

const dom = {
  systemStatus: document.querySelector('#systemStatus'),
  statusChip: document.querySelector('.status-chip'),
  cursorReadout: document.querySelector('#cursorReadout'),
  countdown: document.querySelector('#countdown'),
  countdownValue: document.querySelector('#countdownValue'),
  timerLabel: document.querySelector('#timerLabel'),
  timerState: document.querySelector('#timerState'),
  timelineFill: document.querySelector('#timelineFill'),
  rockCount: document.querySelector('#rockCount'),
  caughtCount: document.querySelector('#caughtCount'),
  loadReadout: document.querySelector('#loadReadout'),
  breachCount: document.querySelector('#breachCount'),
  tension: document.querySelector('#tension'),
  tensionValue: document.querySelector('#tensionValue'),
  tensionNeedle: document.querySelector('#tensionNeedle'),
  tensionSafe: document.querySelector('#tensionSafe'),
  anchorList: document.querySelector('#anchorList'),
  layoutTag: document.querySelector('#layoutTag'),
  scenarioNote: document.querySelector('#scenarioNote'),
  blastButton: document.querySelector('#blastButton'),
  resetButton: document.querySelector('#resetButton'),
  resultCard: document.querySelector('#resultCard'),
  resultTitle: document.querySelector('#resultTitle'),
  resultBadge: document.querySelector('#resultBadge'),
  resultCopy: document.querySelector('#resultCopy'),
  resultFacts: document.querySelector('#resultFacts'),
  soundToggle: document.querySelector('#soundToggle'),
  soundIcon: document.querySelector('.sound-icon')
};

let simulation = new QuarrySimulation();
let selectedMode = 'normal';
let hoveredAnchor = -1;
let draggedAnchor = -1;
let dragStarted = false;
let countdownTimer = null;
let countdownToken = 0;
let lastFrame = performance.now();
let uiClock = 0;
let frameClock = 0;
let screenShake = 0;
let blastFlash = 0;
let effects = [];
let staticLayer = null;
let viewportDpr = 1;

const palette = {
  ink: '#0b1210',
  terrain: '#17221d',
  terrainLight: '#223029',
  line: 'rgba(151, 177, 155, 0.16)',
  acid: '#d9f16b',
  amber: '#ff9e4a',
  danger: '#ff5e53',
  safe: '#66ddb4',
  blue: '#7ab8eb',
  text: '#edf4e9',
  muted: '#8fa096'
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function formatSeconds(value) {
  return value.toFixed(1);
}

function getTensionColor(tension) {
  if (tension < TENSION_SAFE.min) return palette.blue;
  if (tension > TENSION_SAFE.max) return palette.danger;
  return palette.acid;
}

function resetInteractionState() {
  hoveredAnchor = -1;
  draggedAnchor = -1;
  dragStarted = false;
  canvas.classList.remove('dragging');
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * WORLD.width,
    y: ((event.clientY - rect.top) / rect.height) * WORLD.height
  };
}

function findAnchorAt(point) {
  for (let index = simulation.anchors.length - 1; index >= 0; index -= 1) {
    const anchor = simulation.anchors[index];
    if (Math.hypot(point.x - anchor.x, point.y - anchor.y) <= 20) {
      return index;
    }
  }
  return -1;
}

simulation.onEvent((event) => {
  if (event.type === 'blast') {
    blastFlash = 1;
    screenShake = 11;
    audio.blast();
    addBurst(WORLD.blast.x, WORLD.blast.y, 24, palette.amber, 160);
  }
  if (event.type === 'impact') {
    audio.impact(clamp(event.load * 0.8, 0.1, 0.9));
    addBurst(event.x, event.y, 4 + Math.round(event.load * 7), palette.acid, 70);
    screenShake = Math.max(screenShake, 2 + event.load * 5);
  }
  if (event.type === 'tear') {
    audio.tear();
    screenShake = 16;
    const anchor = simulation.anchors[event.index];
    addBurst(anchor.x, anchor.y, 24, palette.danger, 130);
  }
  if (event.type === 'breach') {
    screenShake = 10;
  }
  if (event.type === 'complete') {
    audio.result(event.result.success);
    renderResult(event.result);
  }
});

function addBurst(x, y, count, color, speed) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const velocity = speed * (0.25 + Math.random() * 0.75);
    effects.push({
      type: 'spark',
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      size: 1 + Math.random() * 2.6,
      age: 0,
      life: 0.25 + Math.random() * 0.55,
      color
    });
  }
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawContourField(ctx) {
  const random = seededRandom(249);
  ctx.save();
  ctx.lineCap = 'round';

  for (let band = 0; band < 16; band += 1) {
    const baseY = 205 + band * 28;
    ctx.beginPath();
    for (let x = -20; x <= WORLD.width + 20; x += 12) {
      const rise = Math.min(90, Math.max(0, (330 - x) * 0.21));
      const wave =
        Math.sin(x * 0.009 + band * 0.86) * (12 + band * 0.35) +
        Math.sin(x * 0.021 - band) * 4;
      const y = baseY - rise + wave;
      if (x === -20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(154, 186, 162, ${0.075 + band * 0.003})`;
    ctx.lineWidth = band % 4 === 0 ? 1.15 : 0.65;
    ctx.stroke();
  }

  for (let index = 0; index < 7; index += 1) {
    const cx = 130 + random() * 780;
    const cy = 90 + random() * 180;
    for (let ring = 0; ring < 3; ring += 1) {
      ctx.beginPath();
      ctx.ellipse(
        cx,
        cy,
        22 + ring * 20 + random() * 6,
        9 + ring * 8 + random() * 4,
        -0.16 + random() * 0.08,
        0,
        Math.PI * 2
      );
      ctx.strokeStyle = `rgba(170, 198, 175, ${0.09 - ring * 0.014})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawQuarryBench(ctx) {
  const top = ctx.createLinearGradient(0, 0, 520, 430);
  top.addColorStop(0, '#26352b');
  top.addColorStop(0.65, '#1b2922');
  top.addColorStop(1, '#14201b');
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(430, 0);
  ctx.lineTo(398, 68);
  ctx.lineTo(356, 96);
  ctx.lineTo(339, 158);
  ctx.lineTo(287, 194);
  ctx.lineTo(256, 277);
  ctx.lineTo(182, 322);
  ctx.lineTo(150, 410);
  ctx.lineTo(0, 456);
  ctx.closePath();
  ctx.fill();

  const strata = [
    [0, 86, 390, 54, 0.18],
    [0, 146, 353, 20, 0.16],
    [0, 203, 303, 32, 0.12],
    [0, 258, 240, 26, 0.1],
    [0, 316, 176, 44, 0.08]
  ];
  strata.forEach(([x, y, width, height, alpha], index) => {
    ctx.fillStyle = `rgba(${index % 2 ? '204, 184, 121' : '176, 190, 155'}, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(width, y - index * 4);
    ctx.lineTo(width + 29, y + height);
    ctx.lineTo(x + 14, y + height + 5);
    ctx.closePath();
    ctx.fill();
  });

  ctx.strokeStyle = 'rgba(221, 230, 203, 0.19)';
  ctx.lineWidth = 1.2;
  for (let step = 0; step < 5; step += 1) {
    const x = 52 + step * 73;
    const y = 78 + step * 58;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 110 - step * 11, y + 12);
    ctx.lineTo(x + 99 - step * 11, y + 33);
    ctx.stroke();
    ctx.fillStyle = 'rgba(10, 16, 13, 0.28)';
    ctx.fillRect(x, y + 33, Math.max(36, 98 - step * 10), 17);
  }

  ctx.fillStyle = 'rgba(255, 158, 74, 0.1)';
  ctx.beginPath();
  ctx.arc(WORLD.blast.x, WORLD.blast.y, 52, 0, Math.PI * 2);
  ctx.fill();
}

function drawBuffer(ctx) {
  const { x, y, width, height } = WORLD.buffer;
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, 'rgba(70, 145, 109, 0.09)');
  gradient.addColorStop(1, 'rgba(102, 221, 180, 0.02)');
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);

  ctx.save();
  ctx.setLineDash([6, 7]);
  ctx.strokeStyle = 'rgba(102, 221, 180, 0.36)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.restore();

  ctx.fillStyle = 'rgba(102, 221, 180, 0.55)';
  ctx.font = '500 10px "DM Mono", "Noto Sans SC", monospace';
  ctx.fillText('BUFFER / 缓冲区', x + 14, y + 23);
  ctx.fillStyle = 'rgba(141, 181, 157, 0.32)';
  for (let dotX = x + 17; dotX < x + width - 10; dotX += 26) {
    for (let dotY = y + 40; dotY < y + height - 10; dotY += 26) {
      ctx.fillRect(dotX, dotY, 1, 1);
    }
  }
}

function drawNoEntryZone(ctx) {
  const { x, y, width, height } = WORLD.noEntry;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 94, 83, 0.055)';
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = 'rgba(255, 94, 83, 0.09)';
  ctx.lineWidth = 2;
  for (let offset = -height; offset < width + height; offset += 20) {
    ctx.beginPath();
    ctx.moveTo(x + offset, y + height);
    ctx.lineTo(x + offset + height, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 94, 83, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 5]);
  ctx.strokeRect(x + 2, y + 2, width - 4, height - 4);
  ctx.restore();

  ctx.fillStyle = 'rgba(255, 115, 102, 0.86)';
  ctx.font = '600 11px "Noto Sans SC", sans-serif';
  ctx.fillText('禁入区 · 车辆与工棚', x + 30, y + 31);
  ctx.fillStyle = 'rgba(255, 94, 83, 0.46)';
  ctx.font = '500 9px "DM Mono", monospace';
  ctx.fillText('NO ENTRY / KEEP CLEAR', x + 30, y + 47);
}

function drawFence(ctx) {
  const x = WORLD.fenceX;
  const top = WORLD.noEntry.y;
  const bottom = WORLD.noEntry.y + WORLD.noEntry.height;
  ctx.save();
  const gradient = ctx.createLinearGradient(x - 4, 0, x + 4, 0);
  gradient.addColorStop(0, 'rgba(255, 158, 74, 0.08)');
  gradient.addColorStop(0.5, 'rgba(255, 158, 74, 0.9)');
  gradient.addColorStop(1, 'rgba(255, 158, 74, 0.08)');
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 158, 74, 0.6)';
  ctx.lineWidth = 1;
  for (let y = top; y < bottom; y += 26) {
    ctx.beginPath();
    ctx.moveTo(x - 3, y);
    ctx.lineTo(x + 3, y + 8);
    ctx.textAlign = 'left';
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255, 158, 74, 0.86)';
  ctx.font = '500 9px "DM Mono", monospace';
  ctx.save();
  ctx.translate(x - 9, top + 96);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('SAFETY FENCE / +0.00', 0, 0);
  ctx.restore();
  ctx.restore();
}

function drawExcavator(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
  ctx.beginPath();
  ctx.ellipse(8, 14, 42, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2c3630';
  roundedRect(ctx, -31, -5, 55, 18, 4);
  ctx.fill();
  ctx.fillStyle = '#d0a24e';
  roundedRect(ctx, -19, -26, 32, 23, 3);
  ctx.fill();
  ctx.fillStyle = '#25322b';
  roundedRect(ctx, -10, -22, 15, 11, 2);
  ctx.fill();
  ctx.strokeStyle = '#b8893c';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(10, -18);
  ctx.lineTo(37, -31);
  ctx.lineTo(56, -3);
  ctx.stroke();
  ctx.strokeStyle = '#635d47';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(56, -3);
  ctx.lineTo(68, 19);
  ctx.stroke();
  ctx.fillStyle = '#9b895d';
  ctx.beginPath();
  ctx.moveTo(63, 18);
  ctx.lineTo(77, 14);
  ctx.lineTo(73, 27);
  ctx.lineTo(59, 28);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#191f1c';
  ctx.beginPath();
  ctx.arc(-23, 13, 6, 0, Math.PI * 2);
  ctx.arc(29, 13, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawShed(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.beginPath();
  ctx.ellipse(8, 26, 42, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#28332e';
  ctx.fillRect(-28, -16, 58, 39);
  ctx.fillStyle = '#4c5b51';
  ctx.beginPath();
  ctx.moveTo(-35, -14);
  ctx.lineTo(1, -38);
  ctx.lineTo(38, -14);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(202, 220, 200, 0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-28, -16, 58, 39);
  ctx.fillStyle = 'rgba(217, 241, 107, 0.45)';
  ctx.fillRect(-15, -7, 15, 12);
  ctx.fillStyle = 'rgba(255, 158, 74, 0.72)';
  ctx.fillRect(8, -1, 9, 24);
  ctx.restore();
}

function drawTruck(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.beginPath();
  ctx.ellipse(2, 17, 48, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#414d42';
  roundedRect(ctx, -45, -13, 60, 25, 4);
  ctx.fill();
  ctx.fillStyle = '#9f7946';
  roundedRect(ctx, 13, -18, 30, 30, 4);
  ctx.fill();
  ctx.fillStyle = '#1b2420';
  roundedRect(ctx, 20, -12, 16, 11, 2);
  ctx.fill();
  ctx.fillStyle = '#232b27';
  [-31, -11, 27].forEach((wheel) => {
    ctx.beginPath();
    ctx.arc(wheel, 14, 7, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#b58d50';
  ctx.fillRect(-40, -10, 50, 3);
  ctx.restore();
}

function buildStaticLayer() {
  const layer = document.createElement('canvas');
  layer.width = WORLD.width;
  layer.height = WORLD.height;
  const ctx = layer.getContext('2d');

  const background = ctx.createLinearGradient(0, 0, WORLD.width, WORLD.height);
  background.addColorStop(0, '#202d26');
  background.addColorStop(0.45, '#17221d');
  background.addColorStop(1, '#0e1714');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  drawContourField(ctx);
  drawQuarryBench(ctx);
  drawBuffer(ctx);

  const floor = ctx.createLinearGradient(0, 600, 0, WORLD.height);
  floor.addColorStop(0, 'rgba(63, 76, 61, 0.38)');
  floor.addColorStop(1, 'rgba(12, 18, 15, 0.8)');
  ctx.fillStyle = floor;
  ctx.fillRect(75, 620, 925, 30);
  ctx.fillStyle = 'rgba(157, 172, 143, 0.13)';
  for (let x = 80; x < 990; x += 17) {
    ctx.fillRect(x, 636 + Math.sin(x * 0.07) * 3, 8, 1);
  }

  drawNoEntryZone(ctx);
  drawFence(ctx);
  drawExcavator(ctx, 1082, 303, 1.04);
  drawShed(ctx, 1150, 446, 1.05);
  drawTruck(ctx, 1110, 584, 1.04);

  ctx.fillStyle = 'rgba(196, 211, 193, 0.22)';
  ctx.font = '500 9px "DM Mono", monospace';
  ctx.fillText('EX-04', 1050, 330);
  ctx.fillText('SHELTER B', 1119, 474);
  ctx.fillText('TRK-12', 1079, 610);

  for (let index = 0; index < 7; index += 1) {
    const x = 345 + index * 83;
    const y = 420 + (index % 3) * 40;
    ctx.strokeStyle = 'rgba(184, 201, 177, 0.1)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 42, y - 6);
    ctx.stroke();
    ctx.fillStyle = 'rgba(219, 230, 208, 0.2)';
    ctx.font = '400 8px "DM Mono", monospace';
    ctx.fillText(`+${150 - index * 10}`, x + 4, y - 10);
  }

  ctx.strokeStyle = 'rgba(217, 241, 107, 0.19)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(1224, 50, 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(1224, 35);
  ctx.lineTo(1218, 51);
  ctx.lineTo(1224, 47);
  ctx.lineTo(1230, 51);
  ctx.closePath();
  ctx.fillStyle = 'rgba(217, 241, 107, 0.45)';
  ctx.fill();
  ctx.fillStyle = 'rgba(217, 241, 107, 0.42)';
  ctx.font = '500 8px "DM Mono", monospace';
  ctx.fillText('N', 1221, 25);
  return layer;
}

function drawBlastOrigin(ctx, time) {
  const { x, y } = WORLD.blast;
  const pulse = (Math.sin(time * 0.0038) + 1) * 0.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = `rgba(255, 158, 74, ${0.3 + pulse * 0.22})`;
  ctx.lineWidth = 1;
  for (let ring = 0; ring < 3; ring += 1) {
    ctx.beginPath();
    ctx.arc(0, 0, 12 + ring * 12 + pulse * 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = palette.amber;
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 158, 74, 0.5)';
  ctx.beginPath();
  ctx.moveTo(-24, -15);
  ctx.lineTo(-9, -15);
  ctx.moveTo(-24, 15);
  ctx.lineTo(-9, 15);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 188, 123, 0.85)';
  ctx.font = '500 9px "DM Mono", monospace';
  ctx.fillText('BLAST 01', 12, -12);
  ctx.fillStyle = 'rgba(255, 158, 74, 0.4)';
  ctx.font = '400 8px "DM Mono", monospace';
  ctx.fillText('DESIGN 42 kg', 12, 1);
  ctx.restore();
}

function drawNet(ctx, time) {
  const color = getTensionColor(simulation.tension);
  const tensionDanger = simulation.tension < TENSION_SAFE.min
    ? 'LOW TENSION'
    : simulation.tension > TENSION_SAFE.max
      ? 'HIGH TENSION'
      : 'NOMINAL';
  const outline = simulation.netOutline;
  ctx.save();

  const fill = ctx.createLinearGradient(
    outline[0].x,
    outline[0].y,
    outline[2].x,
    outline[2].y
  );
  fill.addColorStop(0, `${color}11`);
  fill.addColorStop(0.55, `${color}06`);
  fill.addColorStop(1, `${color}12`);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(outline[0].x, outline[0].y);
  outline.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
  ctx.fill();

  const shadow = ctx.createLinearGradient(0, 160, 0, 560);
  shadow.addColorStop(0, 'rgba(0, 0, 0, 0.04)');
  shadow.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
  ctx.fillStyle = shadow;
  ctx.fill();

  ctx.lineWidth = 0.75;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.42 + Math.sin(time * 0.0015) * 0.03;
  for (let row = 0; row < simulation.netPoints.length; row += 1) {
    const points = simulation.netPoints[row];
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }
  for (let col = 0; col < simulation.netPoints[0].length; col += 1) {
    ctx.beginPath();
    simulation.netPoints.forEach((row, index) => {
      const point = row[col];
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(outline[0].x, outline[0].y);
  outline.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
  ctx.stroke();
  ctx.shadowBlur = 0;

  const labelPoint = simulation.netPoint(0.48, 0.48);
  ctx.fillStyle = 'rgba(9, 14, 12, 0.76)';
  roundedRect(ctx, labelPoint.x - 45, labelPoint.y - 14, 90, 24, 3);
  ctx.fill();
  ctx.strokeStyle = `${color}55`;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = '500 8px "DM Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`NET A-04 · ${tensionDanger}`, labelPoint.x, labelPoint.y + 2);
  ctx.textAlign = 'left';

  simulation.netPulses.forEach((pulse) => {
    const alpha = 1 - pulse.age / pulse.life;
    ctx.strokeStyle = `rgba(217, 241, 107, ${alpha * 0.65})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
    ctx.stroke();
  });

  if (simulation.tearIndex !== null) {
    const anchor = simulation.anchors[simulation.tearIndex];
    ctx.strokeStyle = palette.danger;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y);
    ctx.lineTo(anchor.x + 55, anchor.y + 50);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
  return color;
}

function drawAnchors(ctx, time) {
  const editMode = simulation.state === 'editing';
  simulation.anchors.forEach((anchor, index) => {
    const load = simulation.anchorLoads[index] ?? 0;
    const torn = simulation.tearIndex === index;
    const active = draggedAnchor === index;
    const hovered = hoveredAnchor === index;
    const recommended = selectedMode === 'abnormal' && editMode && index === 1;
    const color = torn
      ? palette.danger
      : load > 0.82
        ? palette.amber
        : load > 0.6
          ? '#f4d46c'
          : palette.amber;
    ctx.save();
    ctx.translate(anchor.x, anchor.y);

    if (recommended) {
      ctx.strokeStyle = `rgba(255, 158, 74, ${0.28 + Math.sin(time * 0.006) * 0.14})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, 22 + Math.sin(time * 0.005) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (!editMode && load > 0.02) {
      ctx.strokeStyle = 'rgba(8, 12, 10, 0.7)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, 15, -Math.PI / 2, Math.PI * 1.5);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(
        0,
        0,
        15,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * clamp(load, 0, 1)
      );
      ctx.stroke();
    }

    if (active || hovered) {
      ctx.fillStyle = 'rgba(255, 158, 74, 0.12)';
      ctx.beginPath();
      ctx.arc(0, 0, 21, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#111b16';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, active ? 10 : 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = color;
    ctx.fillRect(-4, -4, 8, 8);
    ctx.rotate(-Math.PI / 4);

    ctx.fillStyle = 'rgba(9, 14, 12, 0.82)';
    const labelWidth = editMode ? 58 : 74;
    roundedRect(ctx, 14, -13, labelWidth, 20, 2);
    ctx.fill();
    ctx.fillStyle = torn ? palette.danger : 'rgba(224, 234, 222, 0.88)';
    ctx.font = '500 8px "DM Mono", "Noto Sans SC", monospace';
    ctx.fillText(
      tearLabel(anchor, index, load, active),
      20,
      0
    );
    ctx.restore();
  });
}

function tearLabel(anchor, index, load, active) {
  if (simulation.tearIndex === index) return 'ANCHOR TORN';
  if (active && simulation.state === 'editing') return `${Math.round(anchor.x)},${Math.round(anchor.y)}`;
  if (simulation.state === 'editing') return `${anchor.label} ↗`;
  return `${anchor.id.toUpperCase()} · ${Math.round(load * 100)}%`;
}

function drawRockTrails(ctx) {
  simulation.rocks.forEach((rock) => {
    if (rock.trail.length < 2) return;
    ctx.save();
    const color = rock.kind === 'anomaly'
      ? 'rgba(255, 94, 83, 0.62)'
      : rock.netContacts > 0
        ? 'rgba(217, 241, 107, 0.3)'
        : 'rgba(255, 158, 74, 0.25)';
    ctx.strokeStyle = color;
    ctx.lineWidth = rock.kind === 'anomaly' ? 1.8 : 1;
    ctx.setLineDash(rock.kind === 'anomaly' ? [5, 4] : []);
    ctx.beginPath();
    rock.trail.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    if (rock.kind === 'anomaly' && !rock.settled) {
      const head = rock.trail[rock.trail.length - 1];
      ctx.fillStyle = 'rgba(255, 94, 83, 0.8)';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

function drawRocks(ctx, time) {
  simulation.rocks.forEach((rock) => {
    ctx.save();
    ctx.translate(rock.x, rock.y);
    const anomaly = rock.kind === 'anomaly';
    if (anomaly && !rock.settled) {
      const glow = 0.2 + (Math.sin(time * 0.009) + 1) * 0.1;
      ctx.fillStyle = `rgba(255, 94, 83, ${glow})`;
      ctx.beginPath();
      ctx.arc(0, 0, rock.radius * 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 158, 74, 0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, rock.radius + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.rotate(rock.rotation);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(3, 4, rock.radius * 0.9, rock.radius * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    const sides = anomaly ? 8 : 7;
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * Math.PI * 2;
      const jitter = 0.82 + ((rock.id * 17 + side * 29) % 23) / 100;
      const radius = rock.radius * jitter;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (side === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const fill = ctx.createLinearGradient(-rock.radius, -rock.radius, rock.radius, rock.radius);
    if (anomaly) {
      fill.addColorStop(0, '#ffb168');
      fill.addColorStop(0.45, '#7e5740');
      fill.addColorStop(1, '#302b26');
    } else {
      fill.addColorStop(0, '#b8b99b');
      fill.addColorStop(0.5, '#6f7869');
      fill.addColorStop(1, '#353d37');
    }
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = anomaly ? 'rgba(255, 158, 74, 0.9)' : 'rgba(200, 211, 190, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(238, 242, 222, 0.23)';
    ctx.beginPath();
    ctx.arc(-rock.radius * 0.25, -rock.radius * 0.28, rock.radius * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (rock.breached) {
      ctx.save();
      ctx.strokeStyle = palette.danger;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rock.x, rock.y, rock.radius + 11 + Math.sin(time * 0.007) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  });
}

function drawEffects(ctx, dt) {
  effects.forEach((effect) => {
    effect.age += dt;
    effect.x += effect.vx * dt;
    effect.y += effect.vy * dt;
    effect.vy += 100 * dt;
    effect.vx *= 0.985;
    const alpha = Math.max(0, 1 - effect.age / effect.life);
    ctx.fillStyle = effect.color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(effect.x, effect.y, effect.size * alpha, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  effects = effects.filter((effect) => effect.age < effect.life);
}

function drawSceneAnnotations(ctx, time) {
  ctx.save();
  ctx.fillStyle = 'rgba(217, 241, 107, 0.48)';
  ctx.font = '500 9px "DM Mono", monospace';
  ctx.fillText('UPPER BENCH / +132', 62, 46);
  ctx.fillStyle = 'rgba(153, 175, 157, 0.44)';
  ctx.fillText('PIT FLOOR / +000', 77, 672);

  ctx.setLineDash([3, 6]);
  ctx.strokeStyle = 'rgba(149, 177, 154, 0.17)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(42, 82);
  ctx.lineTo(42, 628);
  ctx.stroke();
  ctx.setLineDash([]);
  for (let y = 100; y <= 620; y += 52) {
    ctx.beginPath();
    ctx.moveTo(38, y);
    ctx.lineTo(47, y);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(190, 211, 194, 0.32)';
  ctx.font = '500 8px "DM Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText('SCALE 1:500', 1244, 680);
  ctx.fillText('GRID 20 × 20 m', 1244, 694);
  ctx.textAlign = 'left';

  const anomaly = simulation.rocks.find((rock) => rock.kind === 'anomaly');
  if (anomaly && !anomaly.settled && simulation.state === 'running') {
    ctx.strokeStyle = 'rgba(255, 94, 83, 0.62)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(anomaly.x, anomaly.y - anomaly.radius - 9);
    ctx.lineTo(anomaly.x + 34, anomaly.y - anomaly.radius - 35);
    ctx.lineTo(anomaly.x + 148, anomaly.y - anomaly.radius - 35);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255, 120, 107, 0.92)';
    ctx.font = '500 9px "Noto Sans SC", sans-serif';
    ctx.fillText('ANOMALY / 异常岩块', anomaly.x + 38, anomaly.y - anomaly.radius - 40);
  }

  const { x, y, width } = WORLD.noEntry;
  ctx.strokeStyle = 'rgba(255, 94, 83, 0.22)';
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(x, WORLD.groundY + 4);
  ctx.lineTo(x + width - 16, WORLD.groundY + 4);
  ctx.stroke();
  ctx.setLineDash([]);

  if (simulation.state === 'editing') {
    ctx.fillStyle = 'rgba(9, 15, 12, 0.62)';
    roundedRect(ctx, 493, 584, 254, 28, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(217, 241, 107, 0.18)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(217, 241, 107, 0.78)';
    ctx.font = '500 9px "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('拖动四个锚点 · 调整网面覆盖与垂度', 620, 603);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

function drawHud(ctx, time) {
  ctx.save();
  ctx.fillStyle = 'rgba(9, 15, 13, 0.6)';
  roundedRect(ctx, 22, 18, 208, 43, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(184, 209, 190, 0.13)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(206, 220, 207, 0.48)';
  ctx.font = '500 8px "DM Mono", monospace';
  ctx.fillText('CONTROL POINT', 35, 34);
  ctx.fillStyle = simulation.state === 'running' ? palette.amber : palette.acid;
  ctx.font = '600 12px "Noto Sans SC", sans-serif';
  const statusText = {
    editing: selectedMode === 'abnormal' ? '异常工况 · 布设中' : '常规工况 · 布设中',
    running: simulation.mode === 'abnormal' ? '异常落石模拟中' : '常规落石模拟中',
    complete: simulation.result?.success ? '模拟完成 · 受控' : '模拟完成 · 失效'
  }[simulation.state];
  ctx.fillText(statusText, 35, 51);

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(188, 207, 191, 0.42)';
  ctx.font = '500 8px "DM Mono", monospace';
  ctx.fillText('TARGET / ZERO BREACH', 1253, 31);
  ctx.fillStyle = palette.danger;
  ctx.fillText('NO-GO ZONE  X ≥ 1000', 1253, 47);
  ctx.textAlign = 'left';

  if (simulation.state === 'running') {
    const timeLeft = Math.max(0, SIMULATION_SECONDS - simulation.elapsed);
    ctx.fillStyle = 'rgba(8, 13, 11, 0.68)';
    roundedRect(ctx, 1052, 66, 201, 55, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(217, 241, 107, 0.18)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(196, 214, 198, 0.45)';
    ctx.font = '500 8px "DM Mono", monospace';
    ctx.fillText('SIMULATION WINDOW', 1064, 82);
    ctx.fillStyle = timeLeft < 3 ? palette.amber : palette.acid;
    ctx.font = '500 21px "DM Mono", monospace';
    ctx.fillText(`T−${formatSeconds(timeLeft)}`, 1063, 107);
    ctx.fillStyle = 'rgba(209, 224, 211, 0.5)';
    ctx.font = '500 8px "DM Mono", monospace';
    ctx.fillText(`${Math.round((1 - timeLeft / SIMULATION_SECONDS) * 100)}%`, 1216, 105);
  }

  const breach = simulation.breaches.length;
  if (breach > 0) {
    ctx.fillStyle = `rgba(255, 94, 83, ${0.68 + Math.sin(time * 0.008) * 0.12})`;
    roundedRect(ctx, 1039, 136, 214, 32, 3);
    ctx.fill();
    ctx.fillStyle = '#170b0a';
    ctx.font = '600 10px "Noto Sans SC", sans-serif';
    ctx.fillText(`越界警报 · ${breach} 枚岩块`, 1054, 156);
  }
  ctx.restore();
}

function resizeCanvas() {
  viewportDpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(WORLD.width * viewportDpr);
  canvas.height = Math.round(WORLD.height * viewportDpr);
}

function render(time, dt) {
  context.setTransform(viewportDpr, 0, 0, viewportDpr, 0, 0);
  context.clearRect(0, 0, WORLD.width, WORLD.height);
  context.save();
  if (screenShake > 0.2) {
    context.translate(
      (Math.random() - 0.5) * screenShake,
      (Math.random() - 0.5) * screenShake
    );
  }
  context.drawImage(staticLayer, 0, 0);
  drawBlastOrigin(context, time);
  drawSceneAnnotations(context, time);
  drawRockTrails(context);
  drawNet(context, time);
  drawRocks(context, time);
  drawAnchors(context, time);
  drawEffects(context, dt);
  drawHud(context, time);
  context.restore();

  if (blastFlash > 0) {
    context.fillStyle = `rgba(255, 196, 116, ${blastFlash * 0.18})`;
    context.fillRect(0, 0, WORLD.width, WORLD.height);
  }
  screenShake *= Math.pow(0.012, dt);
  blastFlash *= Math.pow(0.008, dt);
}

function renderAnchorList() {
  dom.anchorList.innerHTML = simulation.anchors.map((anchor, index) => {
    const load = simulation.anchorLoads[index] ?? 0;
    const value = simulation.state === 'editing'
      ? `${Math.round(anchor.x)} · ${Math.round(anchor.y)}`
      : `${Math.round(load * 100)}%`;
    return `
      <div class="anchor-row" data-anchor="${index}">
        <i></i>
        <span>${anchor.label}</span>
        <b>${value}</b>
      </div>
    `;
  }).join('');
}

function updateButtons() {
  const running = simulation.state === 'running';
  const complete = simulation.state === 'complete';
  const counting = Boolean(countdownTimer);
  dom.blastButton.disabled = running || counting;
  dom.tension.disabled = running || complete || counting;
  document.querySelectorAll('.scenario-option').forEach((button) => {
    button.disabled = running || complete || counting;
  });
  if (counting) {
    dom.blastButton.innerHTML = `
      <span class="blast-icon" aria-hidden="true"></span>
      <span><b>爆破倒计时</b><small>保持安全距离</small></span>
      <em>…</em>
    `;
  } else if (running) {
    dom.blastButton.innerHTML = `
      <span class="blast-icon" aria-hidden="true"></span>
      <span><b>模拟进行中</b><small>正在采集落石轨迹</small></span>
      <em>·</em>
    `;
  } else if (complete) {
    dom.blastButton.innerHTML = `
      <span class="blast-icon" aria-hidden="true"></span>
      <span><b>再次模拟</b><small>沿用当前网面布置</small></span>
      <em>↻</em>
    `;
  } else {
    dom.blastButton.innerHTML = `
      <span class="blast-icon" aria-hidden="true"></span>
      <span><b>确认爆破</b><small>启动 10 秒实时模拟</small></span>
      <em>↗</em>
    `;
  }
}

function updateUI(force = false) {
  const snapshot = simulation.getSnapshot();
  const editing = simulation.state === 'editing';
  const running = simulation.state === 'running';
  const complete = simulation.state === 'complete';
  const remaining = running
    ? Math.max(0, SIMULATION_SECONDS - simulation.elapsed)
    : SIMULATION_SECONDS;

  dom.tension.value = String(Math.round(simulation.tension));
  dom.tensionValue.textContent = `${Math.round(simulation.tension)}%`;
  dom.tensionNeedle.style.left = `${simulation.tension}%`;
  const safeSpan = TENSION_SAFE.max - TENSION_SAFE.min;
  dom.tensionSafe.style.left = `${TENSION_SAFE.min}%`;
  dom.tensionSafe.style.width = `${safeSpan}%`;

  dom.timerLabel.textContent = running
    ? `T−${formatSeconds(remaining)}`
    : complete
      ? 'T−0.0'
      : 'T−10.0';
  dom.timerState.textContent = countdownTimer
    ? '倒计时'
    : running
      ? '模拟中'
      : complete
        ? (simulation.result?.success ? '已验证' : '已失效')
        : '未启动';
  dom.timelineFill.style.width = `${(simulation.elapsed / SIMULATION_SECONDS) * 100}%`;
  dom.rockCount.textContent = String(snapshot.rockCount);
  dom.caughtCount.textContent = String(snapshot.caught);
  dom.loadReadout.textContent = `${Math.round(snapshot.peakAnchorLoad * 100)}%`;
  dom.breachCount.textContent = String(snapshot.breachCount);

  const chipClass = running
    ? 'running'
    : snapshot.tearIndex !== null || snapshot.breachCount > 0
      ? 'danger'
      : '';
  dom.statusChip.className = `status-chip ${chipClass}`.trim();
  dom.systemStatus.textContent = countdownTimer
    ? '爆破倒计时'
    : running
      ? (simulation.mode === 'abnormal' ? '异常落石监测' : '落石监测中')
      : complete
        ? (simulation.result?.success ? '危险物未越界' : '防护失效')
        : '待布设';

  dom.layoutTag.textContent = editing
    ? '4 / 4 固定'
    : running
      ? '受力监测'
      : '布置锁定';

  if (editing) {
    const highLoad = Math.max(...simulation.anchorLoads);
    if (highLoad > 0.75) {
      dom.layoutTag.textContent = '锚点受力偏高';
    }
  }
  if (snapshot.tearIndex !== null) {
    dom.layoutTag.textContent = '锚点撕裂';
  }

  dom.scenarioNote.className = `scenario-note ${selectedMode === 'abnormal' ? 'abnormal' : ''}`;
  dom.scenarioNote.querySelector('span').textContent = countdownTimer || running
    ? (selectedMode === 'abnormal' ? '高位异常岩块 · 单枚跟踪' : '标准爆破序列 · 17 枚岩块')
    : selectedMode === 'abnormal'
      ? '高位切入 · 重点检查两侧上锚点'
      : '标准爆破序列 · 17 枚岩块';

  if (force || uiClock >= 0.08) {
    renderAnchorList();
    uiClock = 0;
  }
  updateButtons();
}

function renderResult(result) {
  dom.resultCard.classList.toggle('success', result.success);
  dom.resultCard.classList.toggle('failure', !result.success);
  dom.resultBadge.className = `result-badge ${result.success ? 'success' : 'failure'}`;
  dom.resultBadge.textContent = result.success ? 'PASS' : 'FAIL';
  dom.resultTitle.textContent = result.success
    ? (result.mode === 'abnormal' ? '异常落石已受控' : '落石已受控')
    : '防护网失效';

  if (result.success) {
    const burstCopy = result.mode === 'abnormal'
      ? '异常岩块被网面吸收能量并导入缓冲区。'
      : `${result.rockCount} 枚岩块完成十秒跟踪，危险物全部停留在围栏内侧。`;
    dom.resultCopy.textContent = `${burstCopy} 峰值锚点受力 ${Math.round(result.peakAnchorLoad * 100)}%。`;
  } else {
    dom.resultCopy.textContent = result.reasons.join(' · ');
  }

  const anchorState = result.tearAnchor
    ? `${result.tearAnchor.toUpperCase()} 撕裂`
    : `峰值 ${Math.round(result.peakAnchorLoad * 100)}%`;
  dom.resultFacts.innerHTML = `
    <div><span>越界岩块</span><b style="color:${result.breachCount ? palette.danger : palette.safe}">${result.breachCount}</b></div>
    <div><span>锚点状态</span><b>${anchorState}</b></div>
    <div><span>网面堆载</span><b>${Math.round(result.pocketLoad * 100)}%</b></div>
  `;
  updateUI(true);
}

function resetResultCard() {
  dom.resultCard.classList.remove('success', 'failure');
  dom.resultBadge.className = 'result-badge idle';
  dom.resultBadge.textContent = 'STANDBY';
  dom.resultTitle.textContent = '等待爆破';
  dom.resultCopy.textContent = '布置完成后执行一次十秒模拟。危险岩块不得越过围栏或进入右侧禁入区。';
  dom.resultFacts.innerHTML = `
    <div><span>越界岩块</span><b>—</b></div>
    <div><span>锚点状态</span><b>—</b></div>
    <div><span>网面堆载</span><b>—</b></div>
  `;
}

function switchMode(mode) {
  if (simulation.state !== 'editing') return;
  selectedMode = mode === 'abnormal' ? 'abnormal' : 'normal';
  simulation.mode = selectedMode;
  document.querySelectorAll('.scenario-option').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === selectedMode);
  });
  updateUI(true);
}

function cancelCountdown() {
  countdownToken += 1;
  if (countdownTimer) clearTimeout(countdownTimer);
  countdownTimer = null;
  dom.countdown.hidden = true;
}

function prepareForRun() {
  if (simulation.state === 'complete') {
    simulation.reset();
    resetResultCard();
  }
  effects = [];
  screenShake = 0;
  blastFlash = 0;
}

function beginSimulation() {
  prepareForRun();
  countdownTimer = null;
  dom.countdown.hidden = true;
  simulation.start(selectedMode);
  lastFrame = performance.now();
  updateUI(true);
}

function startBlast() {
  if (simulation.state === 'running' || countdownTimer) return;
  audio.ensureContext();
  prepareForRun();
  selectedMode = simulation.mode === 'abnormal' ? 'abnormal' : selectedMode;
  const token = ++countdownToken;
  let value = 3;
  dom.countdown.hidden = false;
  dom.countdownValue.textContent = String(value);
  updateUI(true);

  const tick = () => {
    if (token !== countdownToken) return;
    value -= 1;
    if (value <= 0) {
      countdownTimer = null;
      beginSimulation();
      return;
    }
    dom.countdownValue.textContent = String(value);
    audio.tension(45 + value * 12, true);
    countdownTimer = setTimeout(tick, 1000);
  };
  countdownTimer = setTimeout(tick, 1000);
}

function resetLayout() {
  cancelCountdown();
  simulation.reset();
  simulation.setAnchors(ANCHOR_DEFS);
  simulation.setTension(DEFAULT_TENSION);
  resetInteractionState();
  resetResultCard();
  updateUI(true);
}

function handlePointerDown(event) {
  if (simulation.state !== 'editing' || countdownTimer) return;
  audio.ensureContext();
  const point = getCanvasPoint(event);
  const index = findAnchorAt(point);
  if (index < 0) return;
  event.preventDefault();
  draggedAnchor = index;
  hoveredAnchor = index;
  dragStarted = true;
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add('dragging');
  audio.tension(simulation.tension, true);
  updateUI(true);
}

function handlePointerMove(event) {
  const point = getCanvasPoint(event);
  dom.cursorReadout.textContent =
    `X ${String(Math.round(point.x)).padStart(3, '0')} · Y ${String(Math.round(point.y)).padStart(3, '0')}`;

  if (simulation.state !== 'editing') return;
  if (draggedAnchor >= 0) {
    simulation.updateAnchor(draggedAnchor, point.x, point.y);
    audio.tension(simulation.tension, true);
    updateUI(true);
    return;
  }
  hoveredAnchor = findAnchorAt(point);
  canvas.style.cursor = hoveredAnchor >= 0 ? 'grab' : 'crosshair';
}

function handlePointerUp(event) {
  if (draggedAnchor < 0) return;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  draggedAnchor = -1;
  dragStarted = false;
  canvas.classList.remove('dragging');
  audio.tension(simulation.tension);
  updateUI(true);
}

function handleKeyboard(event) {
  if (simulation.state !== 'editing') return;
  const index = draggedAnchor >= 0 ? draggedAnchor : hoveredAnchor;
  if (index < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    return;
  }
  event.preventDefault();
  const step = event.shiftKey ? 8 : 2;
  const anchor = simulation.anchors[index];
  const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
  const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
  simulation.updateAnchor(index, anchor.x + dx, anchor.y + dy);
  audio.tension(simulation.tension, true);
  updateUI(true);
}

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  uiClock += dt;
  if (simulation.state === 'running') {
    simulation.update(dt);
  }
  updateUI();
  render(now, dt);
  requestAnimationFrame(frame);
}

dom.tension.addEventListener('input', (event) => {
  if (!simulation.setTension(Number(event.target.value))) return;
  audio.tension(simulation.tension, true);
  updateUI(true);
});

dom.blastButton.addEventListener('click', () => {
  startBlast();
});

dom.resetButton.addEventListener('click', resetLayout);
dom.soundToggle.addEventListener('click', () => {
  audio.ensureContext();
  audio.setMuted(!audio.muted);
  dom.soundIcon.classList.toggle('muted', audio.muted);
  dom.soundToggle.setAttribute('aria-label', audio.muted ? '开启声音' : '关闭声音');
});
document.querySelectorAll('.scenario-option').forEach((button) => {
  button.addEventListener('click', () => switchMode(button.dataset.mode));
});

canvas.addEventListener('pointerdown', handlePointerDown);
canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerup', handlePointerUp);
canvas.addEventListener('pointercancel', handlePointerUp);
canvas.addEventListener('pointerleave', () => {
  if (draggedAnchor < 0) hoveredAnchor = -1;
});
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('keydown', handleKeyboard);
window.addEventListener('resize', resizeCanvas);

window.__quarryGame = {
  getSnapshot: () => simulation.getSnapshot(),
  getResult: () => simulation.result,
  setLayout: ({ anchors, tension, mode } = {}) => {
    cancelCountdown();
    simulation.reset();
    if (anchors) simulation.setAnchors(anchors);
    if (typeof tension === 'number') simulation.setTension(tension);
    if (mode) switchMode(mode);
    resetResultCard();
    updateUI(true);
    return simulation.getSnapshot();
  },
  selectMode: switchMode,
  start: startBlast,
  startImmediately: () => {
    cancelCountdown();
    audio.ensureContext();
    beginSimulation();
    return simulation.getSnapshot();
  },
  reset: resetLayout
};

staticLayer = buildStaticLayer();
document.fonts.ready.then(() => {
  staticLayer = buildStaticLayer();
});
resizeCanvas();
resetResultCard();
updateUI(true);
requestAnimationFrame((now) => {
  lastFrame = now;
  frame(now);
});
