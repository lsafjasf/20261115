import { clamp, hash2d, lerp, mulberry32, normalizeAngle, range } from "./rng.js";

export const WORLD_WIDTH = 3800;
export const WORLD_HEIGHT = 3200;
export const WORLD_SEED = 0x7a3f;
export const ROUTE_WIDTH = 52;

const ROUTE_ANCHORS = [
  [530, 2920],
  [660, 2690],
  [560, 2390],
  [760, 2160],
  [1010, 1990],
  [920, 1710],
  [1120, 1470],
  [1490, 1330],
  [1830, 1150],
  [2160, 1190],
  [2420, 1430],
  [2730, 1490],
  [2980, 1320],
  [3200, 1040],
  [3430, 940],
  [3610, 670],
  [3750, 510],
];

const STATION_DATA = [
  { fraction: 0.235, name: "KHAN", code: "OBS-01", elevation: "3,480 m" },
  { fraction: 0.595, name: "RIDGE", code: "OBS-02", elevation: "3,720 m" },
  { fraction: 0.935, name: "NORTH", code: "OBS-03", elevation: "3,910 m" },
];

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function buildRoute() {
  const samples = [];
  for (let i = 0; i < ROUTE_ANCHORS.length - 1; i += 1) {
    const p0 = ROUTE_ANCHORS[Math.max(0, i - 1)];
    const p1 = ROUTE_ANCHORS[i];
    const p2 = ROUTE_ANCHORS[i + 1];
    const p3 = ROUTE_ANCHORS[Math.min(ROUTE_ANCHORS.length - 1, i + 2)];
    const distance = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(8, Math.ceil(distance / 5));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      samples.push({
        x: catmullRom(p0[0], p1[0], p2[0], p3[0], t),
        y: catmullRom(p0[1], p1[1], p2[1], p3[1], t),
        width: ROUTE_WIDTH,
      });
    }
  }
  const last = ROUTE_ANCHORS[ROUTE_ANCHORS.length - 1];
  samples.push({ x: last[0], y: last[1], width: ROUTE_WIDTH });

  let totalLength = 0;
  samples.forEach((sample, index) => {
    sample.distance = totalLength;
    const next = samples[Math.min(samples.length - 1, index + 1)];
    const prev = samples[Math.max(0, index - 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    sample.angle = Math.atan2(dy, dx);
    sample.slope = sample.slope ?? 0;
    if (index < samples.length - 1) {
      totalLength += Math.hypot(next.x - sample.x, next.y - sample.y);
    }
  });

  const stations = STATION_DATA.map((data, index) => {
    const targetDistance = totalLength * data.fraction;
    const routeIndex = samples.findIndex((sample) => sample.distance >= targetDistance);
    const sample = samples[routeIndex];
    return {
      ...data,
      index,
      routeIndex,
      x: sample.x + Math.cos(sample.angle + Math.PI / 2) * 18,
      y: sample.y + Math.sin(sample.angle + Math.PI / 2) * 18,
      angle: sample.angle,
      radius: 110,
      delivered: false,
    };
  });

  return { samples, totalLength, stations };
}

export function createTerrain(seed = WORLD_SEED) {
  const random = mulberry32(seed);
  const phase = Array.from({ length: 8 }, () => range(random, 0, Math.PI * 2));
  const peakX = range(random, 2100, 2800);
  const peakY = range(random, 700, 1250);

  function height(x, y) {
    return (
      24 * Math.sin(x * 0.0017 + phase[0]) +
      18 * Math.cos(y * 0.00145 + phase[1]) +
      11 * Math.sin((x + y) * 0.0021 + phase[2]) +
      8 * Math.cos((x - y) * 0.0032 + phase[3]) +
      38 * Math.exp(-(((x - peakX) ** 2 + (y - peakY) ** 2) / 900000)) +
      11 * Math.sin(x * 0.00042 + y * 0.00033)
    );
  }

  function gradient(x, y) {
    const epsilon = 8;
    sharedGradient.x = (height(x + epsilon, y) - height(x - epsilon, y)) / (epsilon * 2);
    sharedGradient.y = (height(x, y + epsilon) - height(x, y - epsilon)) / (epsilon * 2);
    sharedGradient.magnitude = Math.hypot(sharedGradient.x, sharedGradient.y);
    return sharedGradient;
  }

  return { height, gradient, seed, phase, peakX, peakY };
}

const sharedGradient = { x: 0, y: 0, magnitude: 0 };

export class SnowWorld {
  constructor() {
    this.width = WORLD_WIDTH;
    this.height = WORLD_HEIGHT;
    this.seed = WORLD_SEED;
    this.route = buildRoute();
    this.terrain = createTerrain(WORLD_SEED);
    this.random = mulberry32(WORLD_SEED ^ 0x9e3779b9);
    this.backdrop = null;
    this.backdropScale = 0.62;
    this.decorations = [];
    this.buildBackdrop();
  }

  nearestRoute(x, y) {
    const samples = this.route.samples;
    let bestIndex = 0;
    let bestDistanceSq = Infinity;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const dx = sample.x - x;
      const dy = sample.y - y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestIndex = index;
      }
    }

    const sample = samples[bestIndex];
    return {
      index: bestIndex,
      sample,
      distance: Math.sqrt(bestDistanceSq),
      onRoad: bestDistanceSq <= (ROUTE_WIDTH * 0.62) ** 2,
    };
  }

  buildBackdrop() {
    const scale = this.backdropScale;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(this.width * scale);
    canvas.height = Math.ceil(this.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    const base = ctx.createLinearGradient(0, 0, this.width, this.height);
    base.addColorStop(0, "#8296a0");
    base.addColorStop(0.28, "#667d88");
    base.addColorStop(0.65, "#4e6671");
    base.addColorStop(1, "#314751");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, this.width, this.height);

    this.drawSlopeShading(ctx);
    this.drawContours(ctx);
    this.drawSnowTexture(ctx);
    this.placeDecorations();
    this.drawRoute(ctx);
    this.drawDecorations(ctx);
    this.backdrop = canvas;
  }

  drawSlopeShading(ctx) {
    const cell = 42;
    const gradient = this.terrain.gradient;
    for (let y = 0; y < this.height; y += cell) {
      for (let x = 0; x < this.width; x += cell) {
        gradient(x + cell / 2, y + cell / 2);
        const light = clamp((-gradient.x * 1.25 - gradient.y * 0.7) * 18, -1, 1);
        if (Math.abs(light) < 0.025) continue;
        ctx.fillStyle = light > 0
          ? `rgba(235, 249, 250, ${light * 0.095})`
          : `rgba(9, 24, 31, ${-light * 0.085})`;
        ctx.fillRect(x, y, cell + 1, cell + 1);
      }
    }

    const glow = ctx.createRadialGradient(2450, 920, 20, 2450, 920, 980);
    glow.addColorStop(0, "rgba(225, 243, 244, 0.16)");
    glow.addColorStop(0.55, "rgba(176, 210, 214, 0.06)");
    glow.addColorStop(1, "rgba(18, 40, 49, 0.16)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  drawContours(ctx) {
    const step = 54;
    const levels = [];
    for (let level = -105; level <= 125; level += 9.5) levels.push(level);
    const height = this.terrain.height;
    ctx.lineCap = "round";

    for (const level of levels) {
      ctx.beginPath();
      for (let y = 0; y < this.height; y += step) {
        for (let x = 0; x < this.width; x += step) {
          const x1 = Math.min(this.width, x + step);
          const y1 = Math.min(this.height, y + step);
          const h00 = height(x, y);
          const h10 = height(x1, y);
          const h11 = height(x1, y1);
          const h01 = height(x, y1);
          const points = [];
          const edge = (ax, ay, ah, bx, by, bh) => {
            if ((ah < level && bh >= level) || (bh < level && ah >= level)) {
              const t = (level - ah) / (bh - ah);
              points.push([lerp(ax, bx, t), lerp(ay, by, t)]);
            }
          };
          edge(x, y, h00, x1, y, h10);
          edge(x1, y, h10, x1, y1, h11);
          edge(x1, y1, h11, x, y1, h01);
          edge(x, y1, h01, x, y, h00);
          if (points.length >= 2) {
            ctx.moveTo(points[0][0], points[0][1]);
            ctx.lineTo(points[1][0], points[1][1]);
            if (points.length === 4) {
              ctx.moveTo(points[2][0], points[2][1]);
              ctx.lineTo(points[3][0], points[3][1]);
            }
          }
        }
      }
      ctx.strokeStyle = `rgba(227, 246, 247, ${level % 19 < 9.5 ? 0.11 : 0.075})`;
      ctx.lineWidth = level % 19 < 9.5 ? 1.35 : 0.85;
      ctx.stroke();
    }
  }

  drawSnowTexture(ctx) {
    const random = mulberry32(this.seed ^ 0x51f15e);
    ctx.lineCap = "round";
    for (let index = 0; index < 2600; index += 1) {
      const x = random() * this.width;
      const y = random() * this.height;
      const length = range(random, 2, 12);
      const alpha = range(random, 0.025, 0.12);
      ctx.strokeStyle = `rgba(242, 252, 252, ${alpha})`;
      ctx.lineWidth = range(random, 0.5, 1.3);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + length * 0.72, y - length * 0.35);
      ctx.stroke();
    }
    for (let index = 0; index < 1400; index += 1) {
      const radius = range(random, 0.3, 1.2);
      ctx.fillStyle = `rgba(248, 253, 253, ${range(random, 0.04, 0.2)})`;
      ctx.beginPath();
      ctx.arc(random() * this.width, random() * this.height, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  placeDecorations() {
    const random = mulberry32(this.seed ^ 0xdec0de);
    for (let index = 0; index < 250; index += 1) {
      const x = range(random, 60, this.width - 60);
      const y = range(random, 60, this.height - 60);
      const nearest = this.nearestRoute(x, y, 40);
      if (nearest.distance < 72) continue;
      this.decorations.push({
        type: random() > 0.57 ? "pine" : "rock",
        x,
        y,
        scale: range(random, 0.55, 1.45),
        rotation: range(random, 0, Math.PI * 2),
        shade: range(random, 0.72, 1),
      });
    }
  }

  drawRoute(ctx) {
    const samples = this.route.samples;
    const path = new Path2D();
    samples.forEach((sample, index) => {
      if (index === 0) path.moveTo(sample.x, sample.y);
      else path.lineTo(sample.x, sample.y);
    });
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = "rgba(5, 15, 19, 0.3)";
    ctx.lineWidth = 82;
    ctx.stroke(path);
    ctx.strokeStyle = "#9eb2b8";
    ctx.lineWidth = 68;
    ctx.stroke(path);
    ctx.strokeStyle = "#ccdcdf";
    ctx.lineWidth = 51;
    ctx.stroke(path);
    ctx.strokeStyle = "#dce9ea";
    ctx.lineWidth = 34;
    ctx.stroke(path);

    for (const side of [-1, 1]) {
      ctx.beginPath();
      samples.forEach((sample, index) => {
        const normalX = Math.cos(sample.angle + Math.PI / 2);
        const normalY = Math.sin(sample.angle + Math.PI / 2);
        const x = sample.x + normalX * 10 * side;
        const y = sample.y + normalY * 10 * side;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = "rgba(54, 77, 84, 0.2)";
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }

    for (let index = 18; index < samples.length - 8; index += 18) {
      const sample = samples[index];
      const normalX = Math.cos(sample.angle + Math.PI / 2);
      const normalY = Math.sin(sample.angle + Math.PI / 2);
      for (const side of [-1, 1]) {
        const x = sample.x + normalX * 42 * side;
        const y = sample.y + normalY * 42 * side;
        ctx.strokeStyle = "rgba(19, 37, 43, 0.7)";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(x, y + 8);
        ctx.lineTo(x, y - 9);
        ctx.stroke();
        ctx.fillStyle = "rgba(255, 164, 69, 0.86)";
        ctx.fillRect(x - 1.6, y - 11, 3.2, 4);
      }
    }
  }

  drawDecorations(ctx) {
    for (const decoration of this.decorations) {
      ctx.save();
      ctx.translate(decoration.x, decoration.y);
      ctx.rotate(decoration.rotation);
      ctx.scale(decoration.scale, decoration.scale);
      if (decoration.type === "rock") {
        ctx.fillStyle = `rgba(28, 43, 49, ${0.38 * decoration.shade})`;
        ctx.beginPath();
        ctx.moveTo(-13, 8);
        ctx.lineTo(-7, -9);
        ctx.lineTo(9, -13);
        ctx.lineTo(15, 3);
        ctx.lineTo(7, 12);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(222, 237, 238, 0.22)";
        ctx.beginPath();
        ctx.moveTo(-7, -8);
        ctx.lineTo(8, -12);
        ctx.lineTo(4, -4);
        ctx.lineTo(-3, -2);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = `rgba(24, 45, 46, ${0.5 * decoration.shade})`;
        ctx.beginPath();
        ctx.moveTo(0, -26);
        ctx.lineTo(15, 13);
        ctx.lineTo(3, 8);
        ctx.lineTo(0, 19);
        ctx.lineTo(-3, 8);
        ctx.lineTo(-15, 13);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(225, 242, 242, 0.28)";
        ctx.beginPath();
        ctx.moveTo(0, -23);
        ctx.lineTo(7, 1);
        ctx.lineTo(1, -2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawBackdrop(ctx, camera) {
    const viewWidth = camera.width / camera.zoom;
    const viewHeight = camera.height / camera.zoom;
    const sourceX = (camera.x - viewWidth / 2) * this.backdropScale;
    const sourceY = (camera.y - viewHeight / 2) * this.backdropScale;
    const sourceWidth = viewWidth * this.backdropScale;
    const sourceHeight = viewHeight * this.backdropScale;
    ctx.drawImage(
      this.backdrop,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      camera.width,
      camera.height,
    );
  }

  drawStation(ctx, station, isNext, time) {
    const pulse = (Math.sin(time * 2.5) + 1) / 2;
    ctx.save();
    ctx.translate(station.x, station.y);

    if (isNext && !station.delivered) {
      ctx.strokeStyle = `rgba(255, 193, 90, ${0.16 + pulse * 0.16})`;
      ctx.lineWidth = 24;
      ctx.beginPath();
      ctx.arc(0, 0, 84 + pulse * 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 201, 108, ${0.48 + pulse * 0.25})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 10]);
      ctx.lineDashOffset = -time * 18;
      ctx.beginPath();
      ctx.arc(0, 0, 76, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = station.delivered ? "rgba(54, 104, 91, 0.48)" : "rgba(182, 204, 207, 0.28)";
    ctx.beginPath();
    ctx.ellipse(0, 8, 72, 48, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(station.angle);
    ctx.fillStyle = "rgba(10, 24, 29, 0.4)";
    ctx.beginPath();
    ctx.ellipse(4, 14, 45, 31, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#263d43";
    ctx.strokeStyle = "rgba(216, 238, 239, 0.52)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.roundRect(-25, -17, 50, 38, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#dce9e9";
    ctx.beginPath();
    ctx.moveTo(-30, -17);
    ctx.lineTo(-21, -30);
    ctx.lineTo(23, -30);
    ctx.lineTo(30, -17);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(95, 125, 131, 0.36)";
    ctx.fillRect(-21, -24, 43, 2);

    ctx.fillStyle = "#7dc4c7";
    ctx.fillRect(45 - 23, -5, 10, 7);
    ctx.fillStyle = "rgba(236, 255, 255, 0.45)";
    ctx.fillRect(45 - 23, -5, 3, 7);

    ctx.strokeStyle = "rgba(175, 198, 201, 0.7)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(19, -24);
    ctx.lineTo(19, -51);
    ctx.stroke();

    const lightColor = station.delivered ? "rgba(121, 225, 191, 0.95)" : "rgba(255, 133, 62, 0.95)";
    ctx.shadowBlur = 10 + pulse * 8;
    ctx.shadowColor = lightColor;
    ctx.fillStyle = lightColor;
    ctx.beginPath();
    ctx.arc(19, -53, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = "rgba(34, 53, 58, 0.7)";
    ctx.lineWidth = 1.2;
    for (let index = -18; index <= 18; index += 9) {
      ctx.beginPath();
      ctx.moveTo(index, 6);
      ctx.lineTo(index, 17);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(station.x, station.y - 94);
    ctx.textAlign = "center";
    ctx.font = "600 10px 'Barlow Condensed', 'Noto Sans SC Local', sans-serif";
    ctx.letterSpacing = "1px";
    ctx.fillStyle = station.delivered ? "#8fe8c9" : "#f2fbfb";
    ctx.fillText(`${station.code} / ${station.name}`, 0, 0);
    ctx.font = "9px 'Barlow Condensed', 'Noto Sans SC Local', sans-serif";
    ctx.fillStyle = station.delivered ? "rgba(143, 232, 201, 0.7)" : "rgba(208, 231, 233, 0.55)";
    ctx.fillText(station.delivered ? "物资已送达" : station.elevation, 0, 13);
    ctx.restore();
  }

  drawNavigation(ctx, fromIndex, target, time) {
    const samples = this.route.samples;
    const start = clamp(fromIndex + 3, 0, target.routeIndex);
    const end = target.routeIndex;
    if (end <= start) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255, 193, 90, 0.16)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 17]);
    ctx.lineDashOffset = -time * 24;
    ctx.beginPath();
    for (let index = start; index <= end; index += 2) {
      const sample = samples[index];
      if (index === start) ctx.moveTo(sample.x, sample.y);
      else ctx.lineTo(sample.x, sample.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    for (let step = 0; step < 8; step += 1) {
      const fraction = step / 8;
      const index = Math.floor(lerp(start, end, (fraction + (time * 0.035) % 0.125) % 1));
      const sample = samples[index];
      ctx.save();
      ctx.translate(sample.x, sample.y);
      ctx.rotate(sample.angle);
      ctx.fillStyle = `rgba(255, 197, 97, ${0.22 + step * 0.035})`;
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-3, -4);
      ctx.lineTo(-1, 0);
      ctx.lineTo(-3, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}
