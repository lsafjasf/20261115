import {
  OBSTACLES,
  STAGE,
  WORLD,
  clamp,
  distance,
  samplePath,
  sampleTangent,
} from './planner.js';

const FONT_MONO = '"IBM Plex Mono", "SFMono-Regular", Consolas, "Noto Sans SC", monospace';
const FONT_SANS = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function measureWorldText(ctx, text, weight, family, worldSize) {
  const previousFont = ctx.font;
  ctx.font = `${weight} 100px ${family}`;
  const width = (ctx.measureText(text).width * worldSize) / 100;
  ctx.font = previousFont;
  return width;
}

function groupSamplesByStatus(samples) {
  const runs = [];
  for (const sample of samples) {
    const current = runs.at(-1);
    if (!current || current.status !== sample.status) {
      runs.push({ status: sample.status, points: [sample] });
    } else {
      current.points.push(sample);
    }
  }
  return runs;
}

export class StageRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.dpr = 1;
    this.previousDpr = null;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.scale = Math.min(this.width / WORLD.width, this.height / WORLD.height);
    this.offsetX = (this.width - WORLD.width * this.scale) / 2;
    this.offsetY = (this.height - WORLD.height * this.scale) / 2;
  }

  setCaptureResolution(width, height) {
    if (this.previousDpr !== null) return;
    this.previousDpr = this.dpr;
    this.canvas.width = width;
    this.canvas.height = height;
    this.dpr = width / this.width;
  }

  endCaptureResolution() {
    if (this.previousDpr === null) return;
    this.dpr = this.previousDpr;
    this.previousDpr = null;
    this.resize();
  }

  toWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.offsetX) / this.scale,
      y: (clientY - rect.top - this.offsetY) / this.scale,
    };
  }

  toScreen(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + this.offsetX + x * this.scale,
      y: rect.top + this.offsetY + y * this.scale,
    };
  }

  drawWorldText(text, x, y, worldSize, options = {}) {
    const {
      family = FONT_SANS,
      weight = 500,
      color = '#ffffff',
      align = 'left',
      baseline = 'alphabetic',
    } = options;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = `${weight} ${worldSize * this.scale}px ${family}`;
    ctx.letterSpacing = '0px';
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(
      text,
      this.offsetX + x * this.scale,
      this.offsetY + y * this.scale,
    );
    ctx.restore();
  }

  render(state) {
    if (!this.width || !this.height) this.resize();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05090e';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(
      this.dpr * this.scale,
      0,
      0,
      this.dpr * this.scale,
      this.dpr * this.offsetX,
      this.dpr * this.offsetY,
    );

    this.drawEnvironment(state);
    this.drawSafetyEnvelopes(state);
    this.drawViewCone(state);
    this.drawPath(state);
    this.drawObstacles(state);
    this.drawCamera(state);
    this.drawWaypoints(state);
    this.drawIntervalLabels(state);
    this.drawHud(state);
  }

  drawEnvironment(state) {
    const ctx = this.ctx;
    const { time, beat, playing } = state;
    const pulse = playing ? 0.5 + Math.sin(beat * Math.PI) * 0.5 : 0.35;

    ctx.fillStyle = '#070c12';
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    const backGlow = ctx.createLinearGradient(0, 0, 0, 1.45);
    backGlow.addColorStop(0, 'rgba(64, 94, 122, 0.12)');
    backGlow.addColorStop(1, 'rgba(8, 13, 19, 0)');
    ctx.fillStyle = backGlow;
    ctx.fillRect(0, 0, WORLD.width, 1.6);

    const floor = ctx.createLinearGradient(0, STAGE.y, 0, STAGE.y + STAGE.height);
    floor.addColorStop(0, '#13232c');
    floor.addColorStop(0.52, '#101b23');
    floor.addColorStop(1, '#0b141b');
    ctx.fillStyle = floor;
    ctx.fillRect(STAGE.x, STAGE.y, STAGE.width, STAGE.height);

    ctx.save();
    roundRect(ctx, STAGE.x, STAGE.y, STAGE.width, STAGE.height, 0.1);
    ctx.clip();
    this.drawFloorGrid();
    this.drawStageLights(state);

    const edgeShade = ctx.createRadialGradient(8, 4.5, 1.8, 8, 4.5, 8.4);
    edgeShade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    edgeShade.addColorStop(1, 'rgba(0, 0, 0, 0.34)');
    ctx.fillStyle = edgeShade;
    ctx.fillRect(STAGE.x, STAGE.y, STAGE.width, STAGE.height);
    ctx.restore();

    ctx.strokeStyle = 'rgba(129, 180, 197, 0.24)';
    ctx.lineWidth = 0.018;
    ctx.strokeRect(STAGE.x, STAGE.y, STAGE.width, STAGE.height);

    ctx.strokeStyle = 'rgba(112, 163, 178, 0.1)';
    ctx.lineWidth = 0.012;
    for (const inset of [0.1, 0.2]) {
      ctx.strokeRect(
        STAGE.x + inset,
        STAGE.y + inset,
        STAGE.width - inset * 2,
        STAGE.height - inset * 2,
      );
    }

    this.drawCornerMarks();

    ctx.fillStyle = `rgba(102, 245, 220, ${0.055 + pulse * 0.025})`;
    ctx.fillRect(STAGE.x + 0.28, STAGE.y + 0.28, 0.55, 0.035);
    this.drawWorldText('MAIN STAGE  /  13.5 × 7.0 M', STAGE.x + 0.95, STAGE.y + 0.35, 0.22, {
      color: 'rgba(183, 208, 213, 0.42)',
    });
    this.drawWorldText('GRID 1.0 M', STAGE.x + STAGE.width - 0.34, STAGE.y + 0.35, 0.18, {
      family: FONT_MONO,
      weight: 400,
      color: 'rgba(106, 128, 140, 0.38)',
      align: 'right',
    });

    this.drawAudience(state);
  }

  drawFloorGrid() {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(150, 210, 221, 0.045)';
    ctx.lineWidth = 0.01;
    for (let x = Math.ceil(STAGE.x); x <= STAGE.x + STAGE.width; x += 1) {
      ctx.beginPath();
      ctx.moveTo(x, STAGE.y);
      ctx.lineTo(x, STAGE.y + STAGE.height);
      ctx.stroke();
    }
    for (let y = Math.ceil(STAGE.y); y <= STAGE.y + STAGE.height; y += 1) {
      ctx.beginPath();
      ctx.moveTo(STAGE.x, y);
      ctx.lineTo(STAGE.x + STAGE.width, y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.11)';
    for (let y = STAGE.y + 0.38; y < STAGE.y + STAGE.height; y += 0.48) {
      ctx.beginPath();
      ctx.moveTo(STAGE.x, y);
      ctx.lineTo(STAGE.x + STAGE.width, y);
      ctx.stroke();
    }
  }

  drawStageLights(state) {
    const ctx = this.ctx;
    const spots = [
      { x: 4.8, y: 2.6, color: '247, 178, 103', phase: 0 },
      { x: 11.2, y: 3.2, color: '255, 105, 130', phase: 1.7 },
      { x: 8.1, y: 6.1, color: '83, 211, 220', phase: 3.2 },
    ];
    for (const spot of spots) {
      const sway = Math.sin(state.time * 0.3 + spot.phase) * 0.34;
      const glow = ctx.createRadialGradient(spot.x + sway, spot.y, 0, spot.x, spot.y, 1.65);
      glow.addColorStop(0, `rgba(${spot.color}, 0.12)`);
      glow.addColorStop(0.48, `rgba(${spot.color}, 0.045)`);
      glow.addColorStop(1, `rgba(${spot.color}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawCornerMarks() {
    const ctx = this.ctx;
    const length = 0.34;
    const corners = [
      [STAGE.x, STAGE.y, 1, 1],
      [STAGE.x + STAGE.width, STAGE.y, -1, 1],
      [STAGE.x, STAGE.y + STAGE.height, 1, -1],
      [STAGE.x + STAGE.width, STAGE.y + STAGE.height, -1, -1],
    ];
    ctx.strokeStyle = 'rgba(102, 245, 220, 0.5)';
    ctx.lineWidth = 0.025;
    for (const [x, y, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + dx * length, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * length);
      ctx.stroke();
    }
  }

  drawAudience(state) {
    const ctx = this.ctx;
    const y = STAGE.y + STAGE.height + 0.28;
    ctx.strokeStyle = 'rgba(97, 123, 136, 0.11)';
    ctx.lineWidth = 0.012;
    for (let row = 0; row < 2; row += 1) {
      for (let x = 2.2 + row * 0.22; x < 14; x += 0.62) {
        ctx.beginPath();
        ctx.arc(x, y + row * 0.33, 0.1, Math.PI, Math.PI * 2);
        ctx.stroke();
      }
    }

    this.drawWorldText('AUDIENCE', 8, 8.86, 0.14, {
      family: FONT_MONO,
      weight: 400,
      color: 'rgba(95, 113, 124, 0.28)',
      align: 'center',
    });

    const beatGlow = state.playing ? 0.08 + Math.sin(state.beat * Math.PI) * 0.035 : 0.04;
    const frontGlow = ctx.createLinearGradient(0, 7.72, 0, 8.5);
    frontGlow.addColorStop(0, 'rgba(102, 245, 220, 0)');
    frontGlow.addColorStop(0.35, `rgba(102, 245, 220, ${beatGlow})`);
    frontGlow.addColorStop(1, 'rgba(102, 245, 220, 0)');
    ctx.fillStyle = frontGlow;
    ctx.fillRect(STAGE.x, 7.65, STAGE.width, 0.9);
  }

  drawSafetyEnvelopes(state) {
    const ctx = this.ctx;
    const conflictIds = new Set(state.plan.conflictObjects.map((object) => object.id));
    for (const obstacle of OBSTACLES) {
      const conflict = conflictIds.has(obstacle.id);
      const radius = obstacle.radius + state.safety;
      ctx.save();
      ctx.setLineDash([0.12, 0.1]);
      ctx.lineDashOffset = -state.time * 0.1;
      ctx.strokeStyle = conflict ? 'rgba(255, 88, 117, 0.72)' : 'rgba(255, 200, 87, 0.33)';
      ctx.lineWidth = conflict ? 0.035 : 0.018;
      ctx.beginPath();
      ctx.arc(obstacle.x, obstacle.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = conflict ? 'rgba(255, 88, 117, 0.11)' : 'rgba(255, 200, 87, 0.07)';
      ctx.lineWidth = 0.14;
      ctx.beginPath();
      ctx.arc(obstacle.x, obstacle.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawViewCone(state) {
    const ctx = this.ctx;
    const u = state.progress;
    const point = samplePath(state.plan.path, u);
    const tangent = sampleTangent(state.plan.path, u);
    const angle = tangent.angle + (state.heading * Math.PI) / 180;
    const halfAngle = (state.plan.horizontalFov * Math.PI) / 360;
    const reach = 5.15;

    ctx.save();
    const cone = ctx.createRadialGradient(point.x, point.y, 0.15, point.x, point.y, reach);
    cone.addColorStop(0, `rgba(102, 245, 220, ${state.playing ? 0.19 : 0.13})`);
    cone.addColorStop(0.62, 'rgba(102, 245, 220, 0.055)');
    cone.addColorStop(1, 'rgba(102, 245, 220, 0.006)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.arc(point.x, point.y, reach, angle - halfAngle, angle + halfAngle);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(134, 255, 235, 0.28)';
    ctx.lineWidth = 0.015;
    ctx.setLineDash([0.16, 0.12]);
    for (const edge of [-halfAngle, halfAngle]) {
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(
        point.x + Math.cos(angle + edge) * reach,
        point.y + Math.sin(angle + edge) * reach,
      );
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(174, 255, 241, 0.19)';
    ctx.setLineDash([0.1, 0.14]);
    ctx.beginPath();
    ctx.arc(point.x, point.y, reach * 0.72, angle - halfAngle, angle + halfAngle);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(198, 255, 247, 0.25)';
    ctx.setLineDash([0.05, 0.12]);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + Math.cos(angle) * reach * 0.96, point.y + Math.sin(angle) * reach * 0.96);
    ctx.stroke();
    ctx.setLineDash([]);

    const reticleX = point.x + Math.cos(angle) * reach * 0.72;
    const reticleY = point.y + Math.sin(angle) * reach * 0.72;
    ctx.strokeStyle = 'rgba(102, 245, 220, 0.42)';
    ctx.lineWidth = 0.018;
    ctx.beginPath();
    ctx.arc(reticleX, reticleY, 0.12, 0, Math.PI * 2);
    ctx.moveTo(reticleX - 0.2, reticleY);
    ctx.lineTo(reticleX + 0.2, reticleY);
    ctx.moveTo(reticleX, reticleY - 0.2);
    ctx.lineTo(reticleX, reticleY + 0.2);
    ctx.stroke();
    ctx.restore();
  }

  drawPath(state) {
    const ctx = this.ctx;
    const runs = groupSamplesByStatus(state.plan.samples);
    const colors = {
      safe: '#62ead3',
      near: '#ffc857',
      blocked: '#ff5875',
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.strokeRuns(state.plan.samples, 'rgba(0, 0, 0, 0.55)', 0.38);
    this.strokeRuns(state.plan.samples, 'rgba(87, 246, 218, 0.08)', 0.56);

    for (const run of runs) {
      ctx.strokeStyle = colors[run.status];
      ctx.lineWidth = run.status === 'blocked' ? 0.16 : 0.105;
      if (run.status === 'blocked') {
        ctx.shadowColor = 'rgba(255, 48, 91, 0.8)';
        ctx.shadowBlur = 11;
      } else {
        ctx.shadowColor =
          run.status === 'near' ? 'rgba(255, 200, 87, 0.45)' : 'rgba(102, 245, 220, 0.4)';
        ctx.shadowBlur = 5;
      }
      ctx.beginPath();
      ctx.moveTo(run.points[0].x, run.points[0].y);
      for (const point of run.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    for (const fraction of [0.22, 0.46, 0.7, 0.91]) {
      this.drawPathArrow(state.plan.path, fraction);
    }

    ctx.strokeStyle = 'rgba(225, 255, 250, 0.19)';
    ctx.lineWidth = 0.015;
    ctx.setLineDash([0.08, 0.22]);
    ctx.beginPath();
    state.plan.samples.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  strokeRuns(samples, color, width) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    samples.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }

  drawPathArrow(path, u) {
    const ctx = this.ctx;
    const point = samplePath(path, u);
    const tangent = sampleTangent(path, u);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(tangent.angle);
    ctx.fillStyle = 'rgba(225, 255, 250, 0.65)';
    ctx.beginPath();
    ctx.moveTo(0.13, 0);
    ctx.lineTo(-0.08, 0.075);
    ctx.lineTo(-0.04, 0);
    ctx.lineTo(-0.08, -0.075);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawObstacles(state) {
    const conflictIds = new Map(
      state.plan.conflictObjects.map((object) => [object.id, object.minClearance]),
    );
    for (const obstacle of OBSTACLES) {
      if (obstacle.type === 'actor') {
        this.drawActor(obstacle, state, conflictIds.has(obstacle.id));
      } else {
        this.drawPillar(obstacle, state, conflictIds.has(obstacle.id));
      }
    }
  }

  drawActor(obstacle, state, conflict) {
    const ctx = this.ctx;
    const bob = state.playing ? Math.sin(state.time * 2.1 + obstacle.x) * 0.025 : 0;
    const x = obstacle.x;
    const y = obstacle.y + bob;
    const pulse = 0.5 + Math.sin(state.time * 5.2) * 0.5;

    ctx.save();
    const spotlight = ctx.createRadialGradient(x, y, 0, x, y, 1.12);
    spotlight.addColorStop(0, 'rgba(247, 178, 103, 0.1)');
    spotlight.addColorStop(1, 'rgba(247, 178, 103, 0)');
    ctx.fillStyle = spotlight;
    ctx.beginPath();
    ctx.arc(x, y, 1.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.beginPath();
    ctx.ellipse(x + 0.09, y + 0.11, 0.54, 0.38, 0.25, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#171b20';
    ctx.beginPath();
    ctx.ellipse(x, y, 0.46, 0.33, -0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = obstacle.color;
    ctx.lineWidth = 0.045;
    ctx.beginPath();
    ctx.ellipse(x, y, 0.46, 0.33, -0.15, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(247, 178, 103, 0.25)';
    ctx.beginPath();
    ctx.arc(x - 0.08, y - 0.08, 0.19, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffd4a6';
    ctx.lineWidth = 0.015;
    ctx.beginPath();
    ctx.arc(x - 0.08, y - 0.08, 0.19, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 226, 195, 0.55)';
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.moveTo(x - 0.27, y + 0.18);
    ctx.lineTo(x + 0.24, y - 0.2);
    ctx.stroke();

    if (conflict) {
      ctx.strokeStyle = `rgba(255, 88, 117, ${0.45 + pulse * 0.35})`;
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      ctx.arc(x, y, obstacle.radius + 0.11 + pulse * 0.05, 0, Math.PI * 2);
      ctx.stroke();
    }

    this.drawObjectLabel(
      obstacle.type === 'actor' ? `演员 ${obstacle.short.slice(1).padStart(2, '0')}` : '立柱 A',
      x,
      y + obstacle.radius + 0.3,
      conflict ? '#ff9aaa' : '#e5cbb0',
      conflict ? 'rgba(61, 19, 29, 0.92)' : 'rgba(17, 21, 25, 0.88)',
      conflict ? '冲突' : '',
    );
    ctx.restore();
  }

  drawPillar(obstacle, state, conflict) {
    const ctx = this.ctx;
    const x = obstacle.x;
    const y = obstacle.y;
    const pulse = 0.5 + Math.sin(state.time * 5.2 + 1) * 0.5;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x + 0.11, y + 0.13, 0.52, 0.52, 0, 0, Math.PI * 2);
    ctx.fill();

    const column = ctx.createRadialGradient(x - 0.12, y - 0.14, 0.02, x, y, 0.5);
    column.addColorStop(0, '#abbac4');
    column.addColorStop(0.38, '#5b6b77');
    column.addColorStop(0.78, '#2e3942');
    column.addColorStop(1, '#151d23');
    ctx.fillStyle = column;
    ctx.beginPath();
    ctx.arc(x, y, 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(210, 228, 236, 0.28)';
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    ctx.arc(x, y, 0.42, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(197, 219, 226, 0.15)';
    ctx.lineWidth = 0.012;
    for (let offset = -0.28; offset <= 0.28; offset += 0.11) {
      ctx.beginPath();
      ctx.moveTo(x - 0.3, y + offset - 0.17);
      ctx.lineTo(x + 0.3, y + offset + 0.17);
      ctx.stroke();
    }

    ctx.fillStyle = '#d4e0e6';
    ctx.beginPath();
    ctx.arc(x, y, 0.025, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(8, 12, 15, 0.7)';
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.arc(x, y, 0.22, 0, Math.PI * 2);
    ctx.stroke();

    if (conflict) {
      ctx.strokeStyle = `rgba(255, 88, 117, ${0.45 + pulse * 0.4})`;
      ctx.lineWidth = 0.055;
      ctx.beginPath();
      ctx.arc(x, y, 0.5 + pulse * 0.06, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 88, 117, 0.24)';
      ctx.lineWidth = 0.02;
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 2) {
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle) * 0.58, y + Math.sin(angle) * 0.58);
        ctx.lineTo(x + Math.cos(angle) * 0.72, y + Math.sin(angle) * 0.72);
        ctx.stroke();
      }
    }

    this.drawObjectLabel(
      obstacle.name.split(' · ')[0],
      x,
      y + 0.7,
      conflict ? '#ff9aaa' : '#c4d0d7',
      conflict ? 'rgba(61, 19, 29, 0.92)' : 'rgba(17, 21, 25, 0.88)',
      conflict ? '冲突' : '',
    );
    ctx.restore();
  }

  drawObjectLabel(name, x, y, color, background, rightText) {
    const ctx = this.ctx;
    const nameWidth = measureWorldText(ctx, name, 500, FONT_SANS, 0.29);
    const rightWidth = measureWorldText(ctx, rightText, 500, FONT_MONO, 0.18);
    const hasRight = Boolean(rightText);
    const width = nameWidth + rightWidth + (hasRight ? 0.32 : 0.24);
    const height = 0.44;
    ctx.fillStyle = background;
    roundRect(ctx, x - width / 2, y, width, height, 0.07);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 0.012;
    ctx.stroke();
    this.drawWorldText(name, x - width / 2 + 0.12, y + height / 2, 0.29, {
      color,
      baseline: 'middle',
    });
    if (hasRight) {
      this.drawWorldText(rightText, x + width / 2 - 0.1, y + height / 2, 0.18, {
        family: FONT_MONO,
        color: color === '#ff9aaa' ? '#ff5875' : '#74828b',
        align: 'right',
        baseline: 'middle',
      });
    }
  }

  drawCamera(state) {
    const ctx = this.ctx;
    const point = samplePath(state.plan.path, state.progress);
    const tangent = sampleTangent(state.plan.path, state.progress);
    const angle = tangent.angle + (state.heading * Math.PI) / 180;
    const pulse = 0.5 + Math.sin(state.time * 5) * 0.5;

    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(angle);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
    roundRect(ctx, -0.38, -0.23, 0.76, 0.48, 0.09);
    ctx.fill();

    ctx.fillStyle = '#0b1318';
    roundRect(ctx, -0.36, -0.21, 0.68, 0.42, 0.08);
    ctx.fill();
    ctx.strokeStyle = '#79f7e0';
    ctx.lineWidth = 0.027;
    ctx.stroke();

    ctx.fillStyle = '#23343a';
    roundRect(ctx, -0.24, -0.31, 0.27, 0.12, 0.04);
    ctx.fill();
    ctx.strokeStyle = 'rgba(121, 247, 224, 0.45)';
    ctx.lineWidth = 0.014;
    ctx.stroke();

    ctx.fillStyle = '#59d7c3';
    ctx.beginPath();
    ctx.arc(0.18, -0.06, 0.055, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 88, 117, 0.75)';
    ctx.beginPath();
    ctx.arc(0.28, 0.07, 0.03 + pulse * 0.008, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#bdfff4';
    roundRect(ctx, 0.33, -0.13, 0.15, 0.26, 0.05);
    ctx.fill();
    ctx.fillStyle = '#17272c';
    ctx.beginPath();
    ctx.ellipse(0.44, 0, 0.035, 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#9ffff1';
    ctx.lineWidth = 0.012;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(121, 247, 224, 0.26)';
    ctx.lineWidth = 0.014;
    ctx.beginPath();
    ctx.arc(0, 0, 0.5 + pulse * 0.03, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const labelAngle = angle;
    const labelX = point.x + Math.cos(labelAngle) * 0.95;
    const labelY = point.y + Math.sin(labelAngle) * 0.95;
    ctx.fillStyle = 'rgba(9, 20, 23, 0.88)';
    const text = 'CAM A';
    const width = measureWorldText(ctx, text, 500, FONT_MONO, 0.18) + 0.2;
    roundRect(ctx, labelX - width / 2, labelY - 0.12, width, 0.24, 0.05);
    ctx.fill();
    ctx.strokeStyle = 'rgba(102, 245, 220, 0.2)';
    ctx.lineWidth = 0.012;
    ctx.stroke();
    this.drawWorldText(text, labelX, labelY, 0.18, {
      family: FONT_MONO,
      color: '#9ff9ea',
      align: 'center',
      baseline: 'middle',
    });
  }

  drawWaypoints(state) {
    const ctx = this.ctx;
    for (let index = 0; index < state.waypoints.length; index += 1) {
      const [x, y] = state.waypoints[index];
      const point = { x, y };
      const active = state.draggingIndex === index || state.hoveredWaypoint === index;
      const dangerous = OBSTACLES.some(
        (obstacle) => distance(point, obstacle) < obstacle.radius + state.safety,
      );
      const color = dangerous ? '#ff5875' : '#8bffee';

      ctx.save();
      if (active) {
        ctx.fillStyle = dangerous ? 'rgba(255, 88, 117, 0.13)' : 'rgba(102, 245, 220, 0.13)';
        ctx.beginPath();
        ctx.arc(point.x, point.y, 0.6, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = 'rgba(8, 17, 19, 0.92)';
      ctx.beginPath();
      ctx.arc(point.x, point.y, active ? 0.29 : 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = active ? 0.045 : 0.032;
      ctx.beginPath();
      ctx.arc(point.x, point.y, active ? 0.29 : 0.26, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = dangerous ? 'rgba(255, 88, 117, 0.35)' : 'rgba(102, 245, 220, 0.3)';
      ctx.lineWidth = 0.015;
      ctx.setLineDash([0.06, 0.08]);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 0.38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      this.drawWorldText(String(index + 1).padStart(2, '0'), point.x, point.y - 0.01, active ? 0.23 : 0.21, {
        family: FONT_MONO,
        weight: 600,
        color,
        align: 'center',
        baseline: 'middle',
      });

      if (active) {
        const coord = `${point.x.toFixed(1)} / ${point.y.toFixed(1)}`;
        const width = measureWorldText(ctx, coord, 500, FONT_MONO, 0.18) + 0.16;
        ctx.fillStyle = 'rgba(7, 14, 17, 0.92)';
        roundRect(ctx, point.x - width / 2, point.y - 0.62, width, 0.26, 0.04);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 0.01;
        ctx.stroke();
        this.drawWorldText(coord, point.x, point.y - 0.49, 0.18, {
          family: FONT_MONO,
          color: '#9aaeb5',
          align: 'center',
          baseline: 'middle',
        });
      }
      ctx.restore();
    }
  }

  drawIntervalLabels(state) {
    const ctx = this.ctx;
    for (const interval of state.plan.intervals) {
      const midpointU = (interval.startU + interval.endU) / 2;
      const point = samplePath(state.plan.path, midpointU);
      const start = interval.startTime;
      const end = interval.endTime;
      const text = `${start.toFixed(1)}–${end.toFixed(1)}s`;
      const width = measureWorldText(ctx, text, 500, FONT_MONO, 0.19) + 0.2;
      const y = clamp(point.y - 0.58, STAGE.y + 0.22, STAGE.y + STAGE.height - 0.44);
      ctx.fillStyle = 'rgba(55, 14, 23, 0.94)';
      roundRect(ctx, point.x - width / 2, y, width, 0.25, 0.05);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 88, 117, 0.55)';
      ctx.lineWidth = 0.018;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 88, 117, 0.42)';
      ctx.lineWidth = 0.014;
      ctx.beginPath();
      ctx.moveTo(point.x, y + 0.25);
      ctx.lineTo(point.x, point.y - 0.25);
      ctx.stroke();
      this.drawWorldText(text, point.x, y + 0.125, 0.19, {
        family: FONT_MONO,
        color: '#ff95a7',
        align: 'center',
        baseline: 'middle',
      });
    }
  }

  drawHud(state) {
    const ctx = this.ctx;
    const sec = state.progress * state.plan.duration;
    const label = `CAM A   ${sec.toFixed(1).padStart(2, '0')} / 10.0`;
    ctx.fillStyle = 'rgba(6, 10, 14, 0.74)';
    roundRect(ctx, STAGE.x + 0.28, 8.22, 1.84, 0.3, 0.06);
    ctx.fill();
    ctx.strokeStyle = state.plan.valid
      ? 'rgba(102, 245, 220, 0.17)'
      : 'rgba(255, 88, 117, 0.34)';
    ctx.lineWidth = 0.014;
    ctx.stroke();
    this.drawWorldText(label, STAGE.x + 0.42, 8.43, 0.18, {
      family: FONT_MONO,
      color: state.plan.valid ? '#8cf7e5' : '#ff7b91',
    });

    this.drawWorldText(
      state.plan.valid ? 'ROUTE CLEAR' : `${state.plan.conflictObjects.length} OBJ CONFLICT`,
      STAGE.x + STAGE.width - 0.3,
      8.42,
      0.16,
      {
        family: FONT_MONO,
        weight: 400,
        color: 'rgba(128, 149, 160, 0.4)',
        align: 'right',
      },
    );

    const centerX = 15.26;
    ctx.strokeStyle = 'rgba(123, 153, 164, 0.24)';
    ctx.lineWidth = 0.012;
    ctx.beginPath();
    ctx.arc(centerX, 0.45, 0.17, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX, 0.22);
    ctx.lineTo(centerX, 0.34);
    ctx.stroke();
    this.drawWorldText('N', centerX, 0.5, 0.13, {
      family: FONT_MONO,
      color: 'rgba(123, 153, 164, 0.48)',
      align: 'center',
    });
  }
}
