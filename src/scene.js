import { CONFIG, TRACK, WORLD } from "./sim.js";

const LATERAL_PX = 11.5;
const ROAD_HALF_PX = CONFIG.roadHalfWidth * LATERAL_PX;
const BIN_WIDTH_M = (CONFIG.lateralMax - CONFIG.lateralMin) / (CONFIG.lateralBins - 1);
const BIN_WIDTH_PX = BIN_WIDTH_M * LATERAL_PX;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distanceToTrack(x, y) {
  let nearest = Infinity;
  for (let index = 0; index < TRACK.samples.length; index += 7) {
    const point = TRACK.samples[index];
    nearest = Math.min(nearest, Math.hypot(point.x - x, point.y - y));
  }
  return nearest;
}

function makeScenery() {
  const random = seededRandom(20261115);
  const trees = [];
  let attempts = 0;
  while (trees.length < 105 && attempts < 1200) {
    attempts += 1;
    const x = 28 + random() * (WORLD.width - 56);
    const y = 30 + random() * (WORLD.height - 70);
    if (distanceToTrack(x, y) < 82) continue;
    trees.push({
      x,
      y,
      size: 6 + random() * 13,
      tone: random(),
    });
  }
  const snow = Array.from({ length: 90 }, () => ({
    x: random() * WORLD.width,
    y: random() * WORLD.height,
    radius: 0.6 + random() * 1.6,
    speed: 8 + random() * 18,
    drift: -8 + random() * 16,
    phase: random() * Math.PI * 2,
  }));
  return { trees, snow };
}

function pathFromTrack(ctx) {
  const path = new Path2D();
  const first = TRACK.samples[0];
  path.moveTo(first.x, first.y);
  for (let index = 1; index < TRACK.samples.length; index += 1) {
    const point = TRACK.samples[index];
    path.lineTo(point.x, point.y);
  }
  return path;
}

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.scenery = makeScenery();
    this.roadPath = pathFromTrack(this.ctx);
    this.width = WORLD.width;
    this.height = WORLD.height;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.scale = Math.min(this.canvas.width / WORLD.width, this.canvas.height / WORLD.height);
    this.offsetX = (this.canvas.width - WORLD.width * this.scale) / 2;
    this.offsetY = (this.canvas.height - WORLD.height * this.scale) / 2;
  }

  render(run, { time = 0, curveWarning = false, idle = false } = {}) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#07131c";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
    ctx.save();
    this.drawTerrain(ctx, time);
    this.drawStream(ctx, run.getStats().pollution);
    this.drawScenery(ctx);
    this.drawRoad(ctx, run);
    this.drawCoverage(ctx, run);
    this.drawCurves(ctx);
    this.drawSectionMarks(ctx, run);
    this.drawTruck(ctx, run, time);
    this.drawWeather(ctx, time);
    if (curveWarning && run.status === "running") this.drawCurveWarning(ctx, run, time);
    this.drawVignette(ctx);
    ctx.restore();
  }

  drawTerrain(ctx, time) {
    const glow = ctx.createRadialGradient(760, 250, 30, 760, 250, 720);
    glow.addColorStop(0, "rgba(65, 128, 135, 0.2)");
    glow.addColorStop(0.52, "rgba(20, 62, 73, 0.12)");
    glow.addColorStop(1, "rgba(3, 12, 18, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    const ridge = (offsetY, color, alpha) => {
      ctx.beginPath();
      ctx.moveTo(-30, 210 + offsetY);
      ctx.bezierCurveTo(170, 90 + offsetY, 300, 245 + offsetY, 480, 160 + offsetY);
      ctx.bezierCurveTo(660, 74 + offsetY, 780, 235 + offsetY, 970, 145 + offsetY);
      ctx.bezierCurveTo(1110, 82 + offsetY, 1200, 160 + offsetY, 1320, 98 + offsetY);
      ctx.lineTo(1320, 510);
      ctx.lineTo(-30, 510);
      ctx.closePath();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    ridge(48, "#143746", 0.28);
    ridge(-5, "#1b4250", 0.3);

    ctx.save();
    ctx.strokeStyle = "rgba(146, 198, 204, 0.07)";
    ctx.lineWidth = 1.2;
    for (let line = 0; line < 9; line += 1) {
      ctx.beginPath();
      const y = 465 + line * 27;
      ctx.moveTo(-20, y);
      for (let x = 0; x <= WORLD.width + 40; x += 80) {
        const wobble = Math.sin(x * 0.008 + line * 1.7) * 22;
        ctx.lineTo(x, y + wobble);
      }
      ctx.stroke();
    }
    ctx.restore();

    const lowGlow = ctx.createLinearGradient(0, 560, 0, WORLD.height);
    lowGlow.addColorStop(0, "rgba(7, 23, 31, 0)");
    lowGlow.addColorStop(1, "rgba(2, 9, 14, 0.54)");
    ctx.fillStyle = lowGlow;
    ctx.fillRect(0, 520, WORLD.width, WORLD.height - 520);

    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = "#d9f7f5";
    ctx.lineWidth = 0.8;
    for (let mark = 0; mark < 24; mark += 1) {
      const x = 50 + ((mark * 173) % 1180);
      const y = 58 + ((mark * 89) % 605);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 18, y - 4);
      ctx.lineTo(x + 26, y + 1);
      ctx.stroke();
    }
    ctx.restore();

    const shimmer = 0.035 + Math.sin(time * 0.2) * 0.012;
    ctx.fillStyle = `rgba(188, 241, 239, ${shimmer})`;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  }

  drawStream(ctx, pollution) {
    const polluted = clamp(pollution / 100, 0, 1);
    const stream = new Path2D();
    stream.moveTo(1268, -30);
    stream.bezierCurveTo(1190, 105, 1248, 230, 1170, 342);
    stream.bezierCurveTo(1092, 453, 1192, 559, 1128, 662);
    stream.bezierCurveTo(1080, 742, 1122, 776, 1045, 840);

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(52, 158, 174, 0.12)";
    ctx.lineWidth = 32;
    ctx.stroke(stream);
    const water = ctx.createLinearGradient(1240, 0, 1070, 780);
    water.addColorStop(0, polluted > 0.55 ? "#4b6f68" : "#276f83");
    water.addColorStop(0.5, polluted > 0.7 ? "#5d6c5c" : "#2a8ca0");
    water.addColorStop(1, polluted > 0.55 ? "#565d4d" : "#225c74");
    ctx.strokeStyle = water;
    ctx.lineWidth = 16;
    ctx.stroke(stream);
    ctx.strokeStyle = "rgba(170, 238, 240, 0.42)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([18, 23]);
    ctx.stroke(stream);
    ctx.setLineDash([]);
    if (polluted > 0.1) {
      ctx.strokeStyle = `rgba(175, 139, 83, ${polluted * 0.35})`;
      ctx.lineWidth = 7;
      ctx.stroke(stream);
    }
    ctx.restore();

    const pool = ctx.createRadialGradient(1110, 300, 4, 1110, 300, 130);
    pool.addColorStop(0, `rgba(126, 213, 211, ${0.08 + polluted * 0.04})`);
    pool.addColorStop(1, "rgba(46, 139, 150, 0)");
    ctx.fillStyle = pool;
    ctx.fillRect(980, 160, 300, 300);
  }

  drawScenery(ctx) {
    for (const tree of this.scenery.trees) {
      const size = tree.size;
      ctx.save();
      ctx.translate(tree.x, tree.y);
      ctx.globalAlpha = 0.36 + tree.tone * 0.22;
      ctx.fillStyle = "#061a20";
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.8);
      ctx.lineTo(size * 0.65, 0);
      ctx.lineTo(-size * 0.65, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#1f4e50";
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.55);
      ctx.lineTo(size * 0.43, -size * 0.2);
      ctx.lineTo(-size * 0.43, -size * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(202, 239, 236, 0.4)";
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.48);
      ctx.lineTo(size * 0.33, -size * 0.55);
      ctx.lineTo(-size * 0.23, -size * 0.58);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  drawRoad(ctx, run) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = "rgba(0, 7, 11, 0.5)";
    ctx.lineWidth = ROAD_HALF_PX * 2 + 28;
    ctx.stroke(this.roadPath);

    ctx.strokeStyle = "rgba(174, 216, 220, 0.47)";
    ctx.lineWidth = ROAD_HALF_PX * 2 + 17;
    ctx.stroke(this.roadPath);

    ctx.strokeStyle = "#17262d";
    ctx.lineWidth = ROAD_HALF_PX * 2 + 3;
    ctx.stroke(this.roadPath);

    const asphalt = ctx.createLinearGradient(120, 80, 1040, 760);
    asphalt.addColorStop(0, "#26343a");
    asphalt.addColorStop(0.45, "#1c2a31");
    asphalt.addColorStop(1, "#18262c");
    ctx.strokeStyle = asphalt;
    ctx.lineWidth = ROAD_HALF_PX * 2 - 5;
    ctx.stroke(this.roadPath);

    ctx.strokeStyle = "rgba(221, 244, 245, 0.32)";
    ctx.lineWidth = ROAD_HALF_PX * 2 - 13;
    ctx.stroke(this.roadPath);
    ctx.strokeStyle = "rgba(23, 40, 48, 0.88)";
    ctx.lineWidth = ROAD_HALF_PX * 2 - 24;
    ctx.stroke(this.roadPath);

    ctx.strokeStyle = "rgba(208, 236, 238, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 13]);
    ctx.stroke(this.roadPath);
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(151, 219, 221, 0.22)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([22, 17]);
    ctx.stroke(this.roadPath);
    ctx.setLineDash([]);

    if (run.status === "finished") {
      ctx.strokeStyle = "rgba(126, 226, 168, 0.44)";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 11]);
      ctx.stroke(this.roadPath);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawCoverage(ctx, run) {
    const binWidth = (CONFIG.lateralMax - CONFIG.lateralMin) / (CONFIG.lateralBins - 1);
    const cellWidth = BIN_WIDTH_PX * 0.94;
    const rowLength = 8.6;
    ctx.save();
    ctx.lineCap = "butt";
    for (let sampleIndex = 0; sampleIndex < TRACK.samples.length; sampleIndex += 2) {
      const sample = TRACK.samples[sampleIndex];
      const row = sampleIndex * CONFIG.lateralBins;
      let hasVisible = false;
      for (let bin = 0; bin < CONFIG.lateralBins; bin += 1) {
        if (run.density[row + bin] > CONFIG.targetDose * 0.05) {
          hasVisible = true;
          break;
        }
      }
      if (!hasVisible) continue;

      ctx.save();
      ctx.translate(sample.x, sample.y);
      ctx.rotate(Math.atan2(sample.ty, sample.tx));
      for (let bin = 0; bin < CONFIG.lateralBins; bin += 1) {
        const lateral = CONFIG.lateralMin + bin * binWidth;
        if (Math.abs(lateral) > CONFIG.streamBuffer + 0.5) continue;
        const dose = run.density[row + bin];
        if (dose <= CONFIG.targetDose * 0.035) continue;
        const ratio = dose / CONFIG.targetDose;
        const x = lateral * LATERAL_PX - cellWidth * 0.5;
        if (ratio >= 1) {
          const strength = clamp((ratio - 1) / 2.2, 0, 1);
          ctx.fillStyle = `rgba(103, 212, 202, ${0.2 + strength * 0.25})`;
        } else if (Math.abs(lateral) <= CONFIG.roadHalfWidth) {
          ctx.fillStyle = `rgba(255, 143, 78, ${0.18 + (1 - ratio) * 0.28})`;
        } else {
          ctx.fillStyle = `rgba(118, 200, 203, ${0.08 + ratio * 0.08})`;
        }
        ctx.fillRect(x, -rowLength * 0.5, cellWidth, rowLength);
      }
      ctx.restore();
    }

    ctx.globalCompositeOperation = "screen";
    for (let sampleIndex = 4; sampleIndex < TRACK.samples.length; sampleIndex += 9) {
      const sample = TRACK.samples[sampleIndex];
      const row = sampleIndex * CONFIG.lateralBins;
      const start = Math.floor((-CONFIG.roadHalfWidth - CONFIG.lateralMin) / binWidth);
      const end = Math.ceil((CONFIG.roadHalfWidth - CONFIG.lateralMin) / binWidth);
      for (let bin = start; bin <= end; bin += 2) {
        const dose = run.density[row + bin];
        if (dose < CONFIG.targetDose) continue;
        const offset = CONFIG.lateralMin + bin * binWidth;
        const flicker = (sampleIndex * 13 + bin * 7) % 5;
        if (flicker > 2) continue;
        ctx.fillStyle = "rgba(202, 255, 247, 0.3)";
        ctx.beginPath();
        ctx.arc(
          sample.x + sample.nx * offset * LATERAL_PX,
          sample.y + sample.ny * offset * LATERAL_PX,
          0.9,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawCurves(ctx) {
    ctx.save();
    for (const section of TRACK.sections) {
      let lastMark = -20;
      for (let index = section.startSample; index <= section.endSample; index += 1) {
        const sample = TRACK.samples[index];
        if (Math.abs(sample.curve) < 0.22 || index - lastMark < 16) continue;
        lastMark = index;
        const side = -Math.sign(sample.curve);
        const angle = Math.atan2(sample.ty, sample.tx);
        const x = sample.x + sample.nx * side * ROAD_HALF_PX * 0.73;
        const y = sample.y + sample.ny * side * ROAD_HALF_PX * 0.73;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.strokeStyle = `rgba(255, 151, 82, ${0.34 + Math.abs(sample.curve) * 0.3})`;
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(-5, -5);
        ctx.lineTo(2, 0);
        ctx.lineTo(-5, 5);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  drawSectionMarks(ctx, run) {
    const stats = run.getStats();
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const section of TRACK.sections) {
      const divider = TRACK.samples[section.startSample];
      this.drawDivider(ctx, divider, section.code);
      const middle = TRACK.samples[Math.floor((section.startSample + section.endSample) / 2)];
      const sectionStats = stats.sections[section.index];
      const side = section.index === 1 ? 1 : -1;
      const labelX = middle.x + middle.nx * side * (ROAD_HALF_PX + 49);
      const labelY = middle.y + middle.ny * side * (ROAD_HALF_PX + 49);
      const isActive = run.status === "running" && run.activeSection === section.index;
      this.drawSectionLabel(ctx, labelX, labelY, section, sectionStats, isActive);
    }

    const finish = TRACK.samples.at(-1);
    this.drawDivider(ctx, finish, "FINISH");
    ctx.restore();

    const start = TRACK.samples[0];
    this.drawFlag(ctx, start.x, start.y, false);
    this.drawFlag(ctx, finish.x, finish.y, true);
  }

  drawDivider(ctx, sample, label) {
    ctx.save();
    ctx.translate(sample.x, sample.y);
    ctx.rotate(Math.atan2(sample.ty, sample.tx));
    ctx.strokeStyle = "rgba(225, 248, 247, 0.38)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(0, -ROAD_HALF_PX - 6);
    ctx.lineTo(0, ROAD_HALF_PX + 6);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(4, 16, 23, 0.86)";
    ctx.beginPath();
    ctx.roundRect(-19, ROAD_HALF_PX + 7, 38, 13, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(179, 227, 228, 0.85)";
    ctx.font = "600 6px 'SFMono-Regular', Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, ROAD_HALF_PX + 13.6);
    ctx.restore();
  }

  drawSectionLabel(ctx, x, y, section, stats, active) {
    ctx.save();
    const width = 92;
    const height = 28;
    ctx.translate(x - width / 2, y - height / 2);
    ctx.fillStyle = active ? "rgba(11, 38, 47, 0.92)" : "rgba(5, 19, 27, 0.78)";
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 7);
    ctx.fill();
    ctx.strokeStyle = active
      ? "rgba(126, 226, 220, 0.48)"
      : "rgba(134, 190, 196, 0.17)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = active ? "#b9fbf4" : "#c2d9dc";
    ctx.font = "600 7px 'Noto Sans SC', sans-serif";
    ctx.fillText(`${section.code}  ${section.name}`, 8, 9);
    ctx.fillStyle = stats.pass ? "#7ee2a8" : active ? "#ffb277" : "#91aab0";
    ctx.font = "600 7px 'SFMono-Regular', Consolas, monospace";
    ctx.fillText(`${Math.round(stats.coverage * 100)}% COVERAGE`, 8, 19.5);
    ctx.fillStyle = stats.pass ? "#7ee2a8" : "#ff9b54";
    ctx.beginPath();
    ctx.arc(width - 9, 9, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawFlag(ctx, x, y, finish) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = finish ? "rgba(126, 226, 168, 0.7)" : "rgba(185, 237, 235, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -23);
    ctx.stroke();
    ctx.fillStyle = finish ? "rgba(126, 226, 168, 0.7)" : "rgba(185, 237, 235, 0.55)";
    ctx.beginPath();
    ctx.moveTo(1, -23);
    ctx.lineTo(16, -19);
    ctx.lineTo(1, -14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawTruck(ctx, run, time) {
    const sample = run.getSampleAtProgress();
    const angle = Math.atan2(sample.ty, sample.tx);
    const moving = run.status === "running";
    const bob = moving ? Math.sin(time * (9 + run.controls.speed * 0.25)) * 0.8 : 0;
    ctx.save();
    ctx.translate(sample.x, sample.y + bob);
    ctx.rotate(angle);

    if (moving) {
      const beam = ctx.createLinearGradient(20, 0, 105, 0);
      beam.addColorStop(0, "rgba(255, 232, 177, 0.19)");
      beam.addColorStop(1, "rgba(255, 218, 145, 0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(14, -9);
      ctx.lineTo(106, -38);
      ctx.lineTo(106, 38);
      ctx.lineTo(14, 9);
      ctx.closePath();
      ctx.fill();
      this.drawSpray(ctx, run, time);
    }

    ctx.fillStyle = "rgba(0, 5, 9, 0.42)";
    ctx.beginPath();
    ctx.ellipse(-1, 3, 29, 17, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#0b151b";
    for (const wheelX of [-13, 12]) {
      for (const wheelY of [-14.5, 14.5]) {
        ctx.beginPath();
        ctx.roundRect(wheelX - 4.5, wheelY - 3.2, 9, 6.4, 2);
        ctx.fill();
      }
    }

    const body = ctx.createLinearGradient(-18, -10, 18, 10);
    body.addColorStop(0, "#a64e2c");
    body.addColorStop(0.5, "#ef8949");
    body.addColorStop(1, "#c76534");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect(-18, -11, 31, 22, 5);
    ctx.fill();

    ctx.fillStyle = "#1b3037";
    ctx.beginPath();
    ctx.roundRect(9, -9, 11, 18, 3);
    ctx.fill();
    ctx.fillStyle = "#89d9df";
    ctx.beginPath();
    ctx.roundRect(13, -7, 5, 14, 2);
    ctx.fill();

    ctx.fillStyle = "rgba(223, 237, 230, 0.85)";
    ctx.beginPath();
    ctx.roundRect(-15, -6, 18, 12, 3);
    ctx.fill();
    ctx.fillStyle = "#6d9699";
    ctx.beginPath();
    ctx.roundRect(-13, -4, 2, 8, 1);
    ctx.fill();

    ctx.fillStyle = "#12252c";
    ctx.beginPath();
    ctx.arc(-21, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#9fcecd";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(-21, 0, 4.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.translate(-21, 0);
    ctx.rotate(moving ? time * 7 : 0);
    ctx.beginPath();
    ctx.moveTo(-3.5, 0);
    ctx.lineTo(3.5, 0);
    ctx.moveTo(0, -3.5);
    ctx.lineTo(0, 3.5);
    ctx.stroke();
    ctx.restore();

    const beacon = 0.45 + Math.sin(time * 7) * 0.25;
    ctx.fillStyle = `rgba(255, 156, 75, ${beacon})`;
    ctx.beginPath();
    ctx.arc(5, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawSpray(ctx, run, time) {
    const halfWidth = run.controls.width * LATERAL_PX * 0.5;
    const driftPx = run.lastDrift * LATERAL_PX;
    const outlet = run.controls.outlet;
    const particleCount = Math.round(16 + outlet * 20);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.lineCap = "round";
    for (let index = 0; index < particleCount; index += 1) {
      const phase = (time * (2.8 + outlet * 2) + index * 0.163) % 1;
      const spread = (index / particleCount - 0.5) * 2;
      const x = -23 - phase * (38 + outlet * 24);
      const y = driftPx * (0.25 + phase * 0.8)
        + spread * halfWidth * (0.32 + phase * 0.95);
      const size = 0.65 + ((index * 7) % 5) * 0.14;
      ctx.fillStyle = `rgba(177, 244, 236, ${0.45 * (1 - phase)})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = `rgba(151, 231, 221, ${0.12 + outlet * 0.13})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-24, -halfWidth * 0.25);
    ctx.lineTo(-55, driftPx - halfWidth * 0.94);
    ctx.moveTo(-24, halfWidth * 0.25);
    ctx.lineTo(-55, driftPx + halfWidth * 0.94);
    ctx.stroke();
    ctx.restore();
  }

  drawWeather(ctx, time) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const flake of this.scenery.snow) {
      const y = (flake.y + time * flake.speed) % WORLD.height;
      const x = flake.x + Math.sin(time * 0.7 + flake.phase) * 5
        + flake.drift * ((y / WORLD.height) - 0.5);
      ctx.fillStyle = `rgba(218, 248, 245, ${0.14 + flake.radius * 0.035})`;
      ctx.beginPath();
      ctx.arc(x, y, flake.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawCurveWarning(ctx, run, time) {
    const sample = run.getSampleAtProgress();
    if (Math.abs(sample.curve) < 0.12) return;
    const pulse = 0.5 + Math.sin(time * 5) * 0.18;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 155, 84, ${pulse})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 7]);
    ctx.beginPath();
    ctx.ellipse(sample.x, sample.y, 45, 32, Math.atan2(sample.ty, sample.tx), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(36, 21, 12, 0.85)";
    ctx.beginPath();
    ctx.roundRect(sample.x + 35, sample.y - 39, 72, 20, 5);
    ctx.fill();
    ctx.fillStyle = "#ffc093";
    ctx.font = "600 7px 'Noto Sans SC', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      `离心偏析 ${Math.round(Math.abs(run.lastDrift) * 100)} cm`,
      sample.x + 71,
      sample.y - 29,
    );
    ctx.restore();
  }

  drawVignette(ctx) {
    const gradient = ctx.createRadialGradient(650, 385, 250, 650, 385, 760);
    gradient.addColorStop(0, "rgba(2, 8, 13, 0)");
    gradient.addColorStop(0.72, "rgba(2, 8, 13, 0.04)");
    gradient.addColorStop(1, "rgba(1, 6, 10, 0.5)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  }
}
