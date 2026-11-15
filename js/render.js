import {
  CHECKPOINTS,
  LIMITS,
  TERRAIN,
  WIND_ZONES,
  WORLD,
  targetAltitudeAt,
  terrainAt,
  windAt,
  windZoneAt,
} from "./sim.js";

const DEG = Math.PI / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const COLORS = {
  ink: "#17211f",
  cream: "#f4efe4",
  cyan: "#48c8d0",
  cyanDeep: "#137c8c",
  orange: "#ff7548",
  green: "#b6dc9d",
  greenDeep: "#2f6f55",
  windHigh: "rgba(134, 201, 211, 0.6)",
  windShear: "rgba(221, 161, 151, 0.58)",
  windValley: "rgba(166, 205, 154, 0.62)",
};

const rand = (index, salt = 0) => {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.windSeeds = Array.from({ length: 44 }, (_, index) => ({
      x: rand(index, 1) * WORLD.width,
      alt: 38 + rand(index, 2) * 464,
      size: 0.55 + rand(index, 3) * 0.9,
      phase: rand(index, 4) * Math.PI * 2,
    }));
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  get plot() {
    return {
      left: 45,
      right: 18,
      top: 30,
      bottom: 66,
      width: this.width - 63,
      height: this.height - 96,
    };
  }

  xToScreen(x) {
    const plot = this.plot;
    return plot.left + (x / WORLD.width) * plot.width;
  }

  altToScreen(altitude) {
    const plot = this.plot;
    return plot.top + (1 - altitude / WORLD.ceiling) * plot.height;
  }

  draw({
    overlays = [],
    live = null,
    markFlight = null,
    markTime = Number.POSITIVE_INFINITY,
    visualTime = 0,
    routeMode = "live",
  }) {
    const ctx = this.context;
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawSky(ctx);
    this.drawWindBands(ctx, visualTime);
    this.drawRouteGuide(ctx);
    this.drawTerrain(ctx);
    this.drawCheckpoints(ctx, markFlight ?? live, markTime);

    overlays.forEach((overlay) => {
      this.drawFlight(
        ctx,
        overlay.flight,
        overlay.time,
        overlay.color,
        overlay.alpha ?? 1,
        overlay.dashed ?? false,
      );
    });

    if (live?.trail?.length) {
      this.drawFlight(ctx, live, live.time, COLORS.orange, 1);
    } else if (live) {
      this.drawGhost(ctx, live, live.x, live.y, live.pitch / DEG, COLORS.orange, 0.9, "", live.settings.span);
    }

    this.drawWindParticles(ctx, visualTime);
    this.drawScaleNote(ctx);

    if (routeMode === "compare" && overlays.length === 2) {
      this.drawCompareLegend(ctx, overlays);
    }
  }

  drawSky(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, "#9cbac3");
    gradient.addColorStop(0.44, "#c8d9d8");
    gradient.addColorStop(0.76, "#e5dfd1");
    gradient.addColorStop(1, "#c8cfc1");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    const glow = ctx.createRadialGradient(
      this.width * 0.72,
      this.height * 0.16,
      10,
      this.width * 0.72,
      this.height * 0.16,
      this.width * 0.48,
    );
    glow.addColorStop(0, "rgba(255, 243, 201, 0.34)");
    glow.addColorStop(1, "rgba(255, 243, 201, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  drawWindBands(ctx, time) {
    const plot = this.plot;
    const bands = [
      { min: 312, max: 520, color: "rgba(126, 191, 204, 0.13)" },
      { min: 176, max: 312, color: "rgba(208, 155, 146, 0.11)" },
      { min: 0, max: 176, color: "rgba(145, 186, 132, 0.12)" },
    ];
    bands.forEach((band) => {
      const yTop = this.altToScreen(band.max);
      const yBottom = this.altToScreen(band.min);
      ctx.fillStyle = band.color;
      ctx.fillRect(plot.left, yTop, plot.width, yBottom - yTop);
    });

    [176, 312].forEach((altitude) => {
      const y = this.altToScreen(altitude);
      ctx.save();
      ctx.setLineDash([3, 7]);
      ctx.strokeStyle = "rgba(23, 33, 31, 0.19)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.left + plot.width, y);
      ctx.stroke();
      ctx.restore();
    });

    const zones = [
      { zone: WIND_ZONES[0], color: "rgba(24, 72, 78, 0.58)", y: this.altToScreen(404) },
      { zone: WIND_ZONES[1], color: "rgba(91, 47, 43, 0.54)", y: this.altToScreen(244) },
      { zone: WIND_ZONES[2], color: "rgba(43, 73, 36, 0.56)", y: this.altToScreen(158) },
    ];

    ctx.save();
    ctx.textAlign = "left";
    zones.forEach(({ zone, color, y }, index) => {
      ctx.fillStyle = color;
      ctx.font = '600 8px "SFMono-Regular", "Noto Sans SC", monospace';
      ctx.fillText(`0${index + 1}  ${zone.name}`, plot.left + 13, y);
      ctx.fillStyle = "rgba(23, 33, 31, 0.35)";
      ctx.font = '7px "Noto Sans SC", sans-serif';
      ctx.fillText(`${zone.short}  /  ${Math.abs(zone.x).toFixed(1)} m·s⁻¹`, plot.left + 13, y + 11);
    });
    ctx.restore();

    const pulse = 0.7 + Math.sin(time * 1.3) * 0.3;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.28 * pulse})`;
    ctx.lineWidth = 0.7;
    ctx.setLineDash([1, 8]);
    [210, 275, 355, 420].forEach((altitude, index) => {
      const y = this.altToScreen(altitude);
      const drift = (time * (index % 2 ? -8 : 11)) % 160;
      ctx.beginPath();
      ctx.moveTo(plot.left + 30 + drift, y);
      ctx.lineTo(plot.left + 100 + drift, y);
      ctx.stroke();
    });
    ctx.restore();
  }

  drawWindParticles(ctx, time) {
    const plot = this.plot;
    ctx.save();
    ctx.lineCap = "round";
    this.windSeeds.forEach((seed) => {
      const wind = windAt(seed.alt, time * 0.72);
      const magnitude = Math.max(1, Math.hypot(wind.x, wind.y));
      const direction = Math.sign(wind.x || 1);
      const travel = seed.x + wind.x * time * 3.1;
      const wrapped = ((travel % WORLD.width) + WORLD.width) % WORLD.width;
      const sx = this.xToScreen(wrapped);
      const sy = this.altToScreen(seed.alt) - wind.y * 1.2;
      const length = (6 + magnitude * 1.05) * seed.size;
      const nx = wind.x / magnitude;
      const ny = -wind.y / magnitude;
      const zone = windZoneAt(seed.alt);
      const color = zone.id === "high" ? COLORS.windHigh : zone.id === "shear" ? COLORS.windShear : COLORS.windValley;

      ctx.globalAlpha = 0.38 + Math.sin(time * 1.7 + seed.phase) * 0.18;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx - nx * length * 0.5, sy - ny * length * 0.5);
      ctx.lineTo(sx + nx * length * 0.5, sy + ny * length * 0.5);
      ctx.stroke();

      if (seed.size > 1.05) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(sx + nx * length * 0.52, sy + ny * length * 0.52, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      if (direction < -1) ctx.fillStyle = color;
    });
    ctx.restore();
  }

  drawRouteGuide(ctx) {
    const points = [
      [WORLD.startX, WORLD.startAlt],
      ...CHECKPOINTS.map((checkpoint) => [checkpoint.x, checkpoint.alt]),
      [1002, WORLD.landingAlt],
    ];
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 7]);
    ctx.beginPath();
    points.forEach(([x, altitude], index) => {
      const sx = this.xToScreen(x);
      const sy = this.altToScreen(altitude);
      if (index === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.stroke();

    const startX = this.xToScreen(WORLD.startX);
    const startY = this.altToScreen(WORLD.startAlt);
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
    ctx.beginPath();
    ctx.arc(startX, startY, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(23, 33, 31, 0.52)";
    ctx.font = '600 7px "SFMono-Regular", monospace';
    ctx.fillText("DROP 445 m", startX + 10, startY + 2);
    ctx.restore();
  }

  drawTerrain(ctx) {
    const plot = this.plot;
    const bottom = this.height;
    const path = new Path2D();
    path.moveTo(this.xToScreen(0), this.altToScreen(terrainAt(0)));
    for (let x = 4; x <= WORLD.width; x += 4) {
      path.lineTo(this.xToScreen(x), this.altToScreen(terrainAt(x)));
    }
    path.lineTo(this.xToScreen(WORLD.width), bottom);
    path.lineTo(this.xToScreen(0), bottom);
    path.closePath();

    const groundGradient = ctx.createLinearGradient(0, this.altToScreen(175), 0, bottom);
    groundGradient.addColorStop(0, "#54705d");
    groundGradient.addColorStop(0.48, "#385342");
    groundGradient.addColorStop(1, "#20382e");
    ctx.fillStyle = groundGradient;
    ctx.fill(path);

    ctx.save();
    ctx.clip(path);
    ctx.strokeStyle = "rgba(225, 236, 211, 0.12)";
    ctx.lineWidth = 1;
    for (let altitude = 24; altitude < 170; altitude += 18) {
      ctx.beginPath();
      for (let x = 0; x <= WORLD.width; x += 5) {
        const y = this.altToScreen(terrainAt(x) - altitude * 0.12);
        if (x === 0) ctx.moveTo(this.xToScreen(x), y);
        else ctx.lineTo(this.xToScreen(x), y);
      }
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(238, 239, 220, 0.38)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let x = 0; x <= WORLD.width; x += 4) {
      const y = this.altToScreen(terrainAt(x));
      if (x === 0) ctx.moveTo(this.xToScreen(x), y);
      else ctx.lineTo(this.xToScreen(x), y);
    }
    ctx.stroke();
    ctx.restore();

    const runwayY = this.altToScreen(terrainAt(1050));
    const runwayStart = this.xToScreen(WORLD.runwayStart);
    const runwayEnd = this.xToScreen(WORLD.runwayEnd);
    const runwayHeight = Math.max(5, this.altToScreen(0) - runwayY);
    const runwayGradient = ctx.createLinearGradient(runwayStart, runwayY, runwayEnd, runwayY);
    runwayGradient.addColorStop(0, "#b6d495");
    runwayGradient.addColorStop(0.5, "#8fc17e");
    runwayGradient.addColorStop(1, "#dbd69b");
    ctx.fillStyle = runwayGradient;
    ctx.fillRect(runwayStart, runwayY - 2, runwayEnd - runwayStart, Math.min(runwayHeight, 8));
    ctx.fillStyle = "rgba(23, 33, 31, 0.72)";
    for (let x = runwayStart + 12; x < runwayEnd - 8; x += 18) {
      ctx.fillRect(x, runwayY + 2, 8, 1);
    }
    ctx.strokeStyle = "rgba(23, 33, 31, 0.62)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(runwayStart, runwayY - 5);
    ctx.lineTo(runwayEnd, runwayY - 5);
    ctx.stroke();

    ctx.fillStyle = "rgba(23, 33, 31, 0.7)";
    ctx.font = '600 7px "SFMono-Regular", monospace';
    ctx.textAlign = "right";
    ctx.fillText(`LAND / ≤ ${LIMITS.touchdownSpeed} m·s⁻¹`, runwayEnd - 4, runwayY - 10);
    ctx.restore();
  }

  drawCheckpoints(ctx, flight, markTime = Number.POSITIVE_INFINITY) {
    CHECKPOINTS.forEach((checkpoint, index) => {
      const mark = flight?.checkpointMarks?.find((item) => item.id === checkpoint.id);
      const revealed = mark && mark.time <= markTime + 0.001;
      const passed = revealed ? mark.passed : undefined;
      const color = passed ? COLORS.green : "rgba(255, 249, 231, 0.82)";
      const sx = this.xToScreen(checkpoint.x);
      const top = this.altToScreen(checkpoint.alt + checkpoint.tolerance);
      const bottom = this.altToScreen(checkpoint.alt - checkpoint.tolerance);
      const center = this.altToScreen(checkpoint.alt);

      ctx.save();
      const bandGradient = ctx.createLinearGradient(sx, top, sx, bottom);
      bandGradient.addColorStop(0, "rgba(255, 250, 229, 0)");
      bandGradient.addColorStop(0.5, passed ? "rgba(182, 220, 157, 0.2)" : "rgba(255, 250, 229, 0.12)");
      bandGradient.addColorStop(1, "rgba(255, 250, 229, 0)");
      ctx.fillStyle = bandGradient;
      ctx.fillRect(sx - 7, top, 14, bottom - top);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(sx, top);
      ctx.lineTo(sx, bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(sx, center, index === 0 ? 12 : 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx - 3, center);
      ctx.lineTo(sx + 3, center);
      ctx.moveTo(sx, center - 3);
      ctx.lineTo(sx, center + 3);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.font = '600 7px "SFMono-Regular", monospace';
      ctx.textAlign = index === 0 ? "right" : "left";
      const labelX = index === 0 ? sx - 16 : sx + 16;
      ctx.fillText(`CP0${index + 1}`, labelX, center - 2);
      ctx.fillStyle = "rgba(23, 33, 31, 0.52)";
      ctx.font = '7px "Noto Sans SC", sans-serif';
      ctx.fillText(`±${checkpoint.tolerance} m`, labelX, center + 8);
      if (revealed) {
        ctx.fillStyle = passed ? COLORS.greenDeep : "#9d351e";
        ctx.textAlign = "center";
        ctx.font = '600 7px "Noto Sans SC", sans-serif';
        ctx.fillText(passed ? "CLEARED" : "MISSED", sx, bottom + 11);
      }
      ctx.restore();
    });
  }

  sampleAt(flight, time) {
    const trail = flight.trail;
    if (!trail.length) {
      return { x: flight.x, y: flight.y, pitch: flight.pitch / DEG };
    }
    if (time <= trail[0].time) return trail[0];
    if (time >= trail.at(-1).time) return trail.at(-1);

    for (let index = 1; index < trail.length; index += 1) {
      const right = trail[index];
      if (right.time < time) continue;
      const left = trail[index - 1];
      const mix = (time - left.time) / Math.max(0.0001, right.time - left.time);
      return {
        x: left.x + (right.x - left.x) * mix,
        y: left.y + (right.y - left.y) * mix,
        pitch: left.pitch + (right.pitch - left.pitch) * mix,
        speed: left.speed + (right.speed - left.speed) * mix,
      };
    }
    return trail.at(-1);
  }

  drawFlight(ctx, flight, currentTime, color, alpha = 1, dashed = false) {
    if (!flight?.trail?.length) return;
    const trail = flight.trail;
    const shown = trail.filter((point) => point.time <= currentTime);
    const future = trail.filter((point) => point.time > currentTime);
    const startX = this.xToScreen(flight.trail[0].x);
    const startY = this.altToScreen(flight.trail[0].y);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (future.length) {
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      trail.forEach((point) => ctx.lineTo(this.xToScreen(point.x), this.altToScreen(point.y)));
      ctx.strokeStyle = hexToRgba(color, 0.18);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (shown.length > 1) {
      ctx.beginPath();
      ctx.moveTo(this.xToScreen(shown[0].x), this.altToScreen(shown[0].y));
      shown.forEach((point) => ctx.lineTo(this.xToScreen(point.x), this.altToScreen(point.y)));
      ctx.strokeStyle = hexToRgba(color, 0.2);
      ctx.lineWidth = 4;
      ctx.shadowColor = color;
      ctx.shadowBlur = 9;
      if (dashed) ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.45;
      if (dashed) ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const point = this.sampleAt(flight, currentTime);
    const px = this.xToScreen(point.x);
    const py = this.altToScreen(point.y);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const label = alpha < 0.8 ? "" : flight.recordLabel || "";
    this.drawGhost(
      ctx,
      point,
      point.x,
      point.y,
      point.pitch,
      color,
      alpha,
      label,
      flight.span ?? flight.settings?.span,
    );
  }

  drawGhost(ctx, point, x, y, pitch, color, alpha = 1, label = "", span = 3.4) {
    const sx = this.xToScreen(x);
    const sy = this.altToScreen(y);
    const scale = 0.72 + (span - 2.6) * 0.18;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(sx, sy);

    ctx.fillStyle = "rgba(23, 33, 31, 0.12)";
    ctx.beginPath();
    ctx.ellipse(0, 7, 8 * scale, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(-pitch * DEG);
    const wing = 6.8 * scale;
    const body = 6.4 * scale;
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(249, 246, 233, 0.94)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(body, 0);
    ctx.lineTo(-3.8 * scale, -wing);
    ctx.lineTo(-1.4 * scale, -1.8 * scale);
    ctx.lineTo(-body, 0);
    ctx.lineTo(-1.4 * scale, 1.8 * scale);
    ctx.lineTo(-3.8 * scale, wing);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#f9f4e8";
    ctx.beginPath();
    ctx.arc(1.7 * scale, 0, 1.3 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (label) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.font = '700 7px "SFMono-Regular", monospace';
      ctx.textAlign = "center";
      ctx.fillText(label, sx, sy - 11 * scale);
      ctx.restore();
    }
  }

  drawCompareLegend(ctx, overlays) {
    const startX = this.plot.left + 10;
    const startY = 61;
    ctx.save();
    ctx.font = '600 7px "SFMono-Regular", monospace';
    overlays.forEach((overlay, index) => {
      const y = startY + index * 13;
      ctx.strokeStyle = overlay.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(startX + 13, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(23, 33, 31, 0.74)";
      ctx.fillText(
        `${overlay.label}  ${Number(overlay.flight.settings.span).toFixed(2)} m`,
        startX + 19,
        y + 2.5,
      );
    });
    ctx.restore();
  }

  drawScaleNote(ctx) {
    const plot = this.plot;
    const y = this.height - 14;
    const x = plot.left + plot.width - 80;
    ctx.save();
    ctx.strokeStyle = "rgba(23, 33, 31, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x, y);
    ctx.lineTo(x + 60, y);
    ctx.lineTo(x + 60, y - 8);
    ctx.stroke();
    ctx.fillStyle = "rgba(23, 33, 31, 0.42)";
    ctx.font = '6px "SFMono-Regular", monospace';
    ctx.textAlign = "center";
    ctx.fillText("200 m", x + 30, y - 3);
    ctx.restore();
  }
}

function hexToRgba(hex, alpha) {
  if (!hex.startsWith("#")) return hex;
  const raw = hex.replace("#", "");
  const value = raw.length === 3
    ? raw.split("").map((digit) => `${digit}${digit}`).join("")
    : raw;
  const number = Number.parseInt(value, 16);
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
