export const TARGET_EXPOSURE = 50;
export const TARGET_TOLERANCE = 0.35;

const W = 1280;
const H = 720;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function exposureEv(settings) {
  const units = settings.seconds * settings.iso / (settings.aperture * settings.aperture);
  return Math.log2(units / TARGET_EXPOSURE);
}

function noiseModel(settings) {
  const isoStop = Math.log2(settings.iso / 100) / Math.log2(12800 / 100);
  const longExposure = Math.min(1, Math.log2(settings.seconds * 8 + 1) / 7);
  const underPush = Math.max(0, -exposureEv(settings)) * 0.055;
  const level = clamp(0.06 + Math.pow(isoStop, 1.35) * 0.82 + longExposure * 0.12 + underPush, 0, 1);
  return {
    level,
    rating: clamp(Math.ceil(level * 5.25), 1, 5),
    chroma: clamp(0.06 + Math.pow(isoStop, 1.25) * 0.88 + longExposure * 0.08, 0, 1),
  };
}

function trailModel(settings) {
  const normalized = clamp(Math.log2(settings.seconds * 16 + 1) / 7.2, 0, 1);
  const pixels = clamp(settings.seconds * 102, 2, 560);
  return { normalized, pixels };
}

export function describeSettings(settings) {
  const ev = exposureEv(settings);
  const noise = noiseModel(settings);
  const trail = trailModel(settings);
  const inTarget = Math.abs(ev) <= TARGET_TOLERANCE;
  const highlight = ev > 1.15 ? "clipped" : ev > 0.55 ? "warning" : "safe";
  return {
    ev,
    inTarget,
    noise,
    trail,
    highlight,
    brightness: Math.pow(2, clamp(ev, -4, 4)),
  };
}

export class NightScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.measureCanvas = document.createElement("canvas");
    this.measureCanvas.width = W;
    this.measureCanvas.height = H;
    this.measureCtx = this.measureCanvas.getContext("2d", { alpha: false });
    this.noiseFrames = [];
    this.shadowNoiseFrames = [];
    this.noiseKey = "";
    this.stars = this.createStars();
    this.buildings = this.createBuildings();
    this.noiseRng = mulberry32(7291);
  }

  createStars() {
    const rng = mulberry32(1948);
    return Array.from({ length: 78 }, () => ({
      x: rng() * W,
      y: rng() * 310 + 24,
      r: rng() * 1.3 + 0.3,
      a: rng() * 0.62 + 0.12,
      twinkle: rng() * 2.4 + 0.6,
      phase: rng() * Math.PI * 2,
    }));
  }

  createBuildings() {
    const rng = mulberry32(8821);
    const buildings = [];
    let x = -18;
    while (x < W + 20) {
      const width = 30 + rng() * 52;
      const height = 55 + rng() * 205;
      const roof = rng() > 0.82 ? "antenna" : rng() > 0.6 ? "step" : "flat";
      const windows = [];
      for (let wx = 11; wx < width - 6; wx += 10) {
        for (let wy = 14; wy < height - 9; wy += 13) {
          if (rng() > 0.72) {
            windows.push({
              x: wx,
              y: wy,
              warm: rng() > 0.35,
              alpha: 0.16 + rng() * 0.6,
            });
          }
        }
      }
      buildings.push({ x, width, height, roof, windows });
      x += width + rng() * 7;
    }
    return buildings;
  }

  drawSky(ctx, time) {
    const sky = ctx.createLinearGradient(0, 0, 0, 470);
    sky.addColorStop(0, "#030811");
    sky.addColorStop(0.46, "#0a1725");
    sky.addColorStop(0.78, "#1b2b34");
    sky.addColorStop(1, "#435158");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    const haze = ctx.createRadialGradient(640, 455, 10, 640, 455, 620);
    haze.addColorStop(0, "rgba(130, 153, 144, 0.19)");
    haze.addColorStop(0.35, "rgba(55, 88, 90, 0.1)");
    haze.addColorStop(1, "rgba(10, 20, 29, 0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 240, W, 300);

    const moonGlow = ctx.createRadialGradient(1028, 112, 3, 1028, 112, 150);
    moonGlow.addColorStop(0, "rgba(196, 219, 214, 0.14)");
    moonGlow.addColorStop(0.22, "rgba(137, 175, 177, 0.045)");
    moonGlow.addColorStop(1, "rgba(80, 120, 130, 0)");
    ctx.fillStyle = moonGlow;
    ctx.fillRect(840, 0, 380, 290);

    for (const star of this.stars) {
      const twinkle = 0.72 + 0.28 * Math.sin(time * star.twinkle + star.phase);
      ctx.globalAlpha = star.a * twinkle;
      ctx.fillStyle = star.r > 1.1 ? "#d6e5df" : "#a8c2c5";
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const moon = ctx.createLinearGradient(1017, 79, 1042, 130);
    moon.addColorStop(0, "rgba(230, 235, 218, 0.82)");
    moon.addColorStop(1, "rgba(140, 164, 159, 0.22)");
    ctx.fillStyle = moon;
    ctx.beginPath();
    ctx.arc(1028, 108, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(7, 13, 21, 0.72)";
    ctx.beginPath();
    ctx.arc(1019, 102, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  drawCity(ctx, time) {
    const groundGlow = ctx.createLinearGradient(0, 314, 0, 478);
    groundGlow.addColorStop(0, "rgba(17, 31, 42, 0)");
    groundGlow.addColorStop(0.56, "rgba(31, 52, 61, 0.27)");
    groundGlow.addColorStop(1, "rgba(95, 104, 94, 0.11)");
    ctx.fillStyle = groundGlow;
    ctx.fillRect(0, 300, W, 185);

    const farRng = mulberry32(442);
    ctx.fillStyle = "#0a151e";
    for (let x = -10; x < W + 20; x += 24) {
      const height = 34 + farRng() * 80;
      ctx.fillStyle = "#0b1922";
      ctx.fillRect(x, 430 - height, 26 + farRng() * 12, height + 20);
    }

    for (const building of this.buildings) {
      const bottom = 438 + (building.x / W) * 12;
      const top = bottom - building.height;
      const facade = ctx.createLinearGradient(building.x, top, building.x + building.width, bottom);
      facade.addColorStop(0, "#142531");
      facade.addColorStop(0.55, "#0d1b26");
      facade.addColorStop(1, "#09141d");
      ctx.fillStyle = facade;
      ctx.fillRect(building.x, top, building.width, building.height + 24);

      ctx.strokeStyle = "rgba(105, 137, 151, 0.08)";
      ctx.lineWidth = 1;
      ctx.strokeRect(building.x + 0.5, top + 0.5, building.width - 1, building.height - 1);

      if (building.roof === "step") {
        ctx.fillStyle = "#0c1821";
        ctx.fillRect(building.x + 7, top - 13, building.width - 14, 14);
      } else if (building.roof === "antenna") {
        ctx.strokeStyle = "rgba(154, 176, 177, 0.28)";
        ctx.beginPath();
        ctx.moveTo(building.x + building.width / 2, top);
        ctx.lineTo(building.x + building.width / 2, top - 30);
        ctx.stroke();
        ctx.fillStyle = "#dba87a";
        ctx.globalAlpha = 0.4 + 0.22 * Math.sin(time * 1.8 + building.x);
        ctx.fillRect(building.x + building.width / 2 - 1, top - 32, 2, 2);
        ctx.globalAlpha = 1;
      }

      for (const window of building.windows) {
        ctx.globalAlpha = window.alpha;
        ctx.fillStyle = window.warm ? "#e0a76d" : "#89b7b9";
        ctx.fillRect(building.x + window.x, top + window.y, 3.5, 2.2);
      }
      ctx.globalAlpha = 1;
    }
  }

  drawRoad(ctx, time, settings) {
    const water = ctx.createLinearGradient(0, 410, 0, 690);
    water.addColorStop(0, "#111d24");
    water.addColorStop(0.45, "#0a1218");
    water.addColorStop(1, "#060b10");
    ctx.fillStyle = water;
    ctx.fillRect(0, 410, W, 310);

    const reflectionRng = mulberry32(3419);
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 30; i += 1) {
      const x = reflectionRng() * W;
      const y = 438 + reflectionRng() * 60;
      const width = 12 + reflectionRng() * 64;
      const alpha = 0.025 + reflectionRng() * 0.06;
      ctx.fillStyle = reflectionRng() > 0.6
        ? `rgba(213, 162, 102, ${alpha})`
        : `rgba(104, 155, 159, ${alpha})`;
      ctx.fillRect(x, y, width, 1);
    }
    ctx.globalCompositeOperation = "source-over";

    const deck = ctx.createLinearGradient(0, 488, 0, 620);
    deck.addColorStop(0, "#111d23");
    deck.addColorStop(0.48, "#0a1318");
    deck.addColorStop(1, "#050a0d");
    ctx.beginPath();
    ctx.moveTo(0, 493);
    ctx.lineTo(W, 521);
    ctx.lineTo(W, 628);
    ctx.lineTo(0, 602);
    ctx.closePath();
    ctx.fillStyle = deck;
    ctx.fill();

    ctx.strokeStyle = "rgba(170, 190, 186, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 498);
    ctx.lineTo(W, 526);
    ctx.stroke();

    ctx.strokeStyle = "rgba(153, 175, 172, 0.12)";
    ctx.setLineDash([28, 45]);
    for (const offset of [54, 95, 134]) {
      ctx.beginPath();
      ctx.moveTo(0, 505 + offset);
      ctx.lineTo(W, 533 + offset);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(2, 4, 6, 0.86)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(0, 604);
    ctx.lineTo(W, 629);
    ctx.stroke();

    this.drawTraffic(ctx, time, settings);
  }

  drawTraffic(ctx, time, settings) {
    const trailPx = clamp(settings.seconds * 96, 0.5, 540);
    const traffic = [
      { y: 540, offset: 0, glow: "#fff3d8", speed: 83, direction: 1 },
      { y: 547, offset: 240, glow: "#fff0d1", speed: 91, direction: 1 },
      { y: 540, offset: 520, glow: "#f6e8c9", speed: 87, direction: 1 },
      { y: 547, offset: 800, glow: "#ffe4b4", speed: 96, direction: 1 },
      { y: 574, offset: 110, glow: "#f26d67", speed: 105, direction: -1 },
      { y: 581, offset: 360, glow: "#ea5556", speed: 116, direction: -1 },
      { y: 574, offset: 620, glow: "#ff7a6d", speed: 99, direction: -1 },
      { y: 590, offset: 790, glow: "#ff6860", speed: 97, direction: -1 },
    ];
    const span = W + 180;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const light of traffic) {
      const phase = (light.offset + time * light.speed) % span;
      const x = light.direction > 0 ? phase - 90 : W + 90 - phase;
      const slope = 0.02;
      const startX = x - light.direction * trailPx;
      const y = light.y + (x / W) * 9;
      const startY = light.y + (startX / W) * 9 + slope * 0;

      if (trailPx > 2) {
        const trail = ctx.createLinearGradient(startX, startY, x, y);
        trail.addColorStop(0, "rgba(0, 0, 0, 0)");
        trail.addColorStop(0.25, this.alphaColor(light.glow, 0.035));
        trail.addColorStop(0.68, this.alphaColor(light.glow, 0.24));
        trail.addColorStop(0.96, this.alphaColor(light.glow, 0.78));
        trail.addColorStop(1, this.alphaColor(light.glow, 0));
        ctx.strokeStyle = trail;
        ctx.lineCap = "round";
        ctx.lineWidth = light.direction > 0 ? 3.8 : 3.4;
        ctx.shadowColor = light.glow;
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.strokeStyle = this.alphaColor(light.glow, 0.25);
        ctx.lineWidth = 1.2;
        ctx.shadowBlur = 3;
        ctx.beginPath();
        ctx.moveTo(startX + trailPx * 0.12, startY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      const glow = ctx.createRadialGradient(x, y, 0, x, y, trailPx > 15 ? 17 : 12);
      glow.addColorStop(0, this.alphaColor(light.glow, 0.95));
      glow.addColorStop(0.12, this.alphaColor(light.glow, 0.58));
      glow.addColorStop(0.42, this.alphaColor(light.glow, 0.13));
      glow.addColorStop(1, this.alphaColor(light.glow, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, trailPx > 15 ? 17 : 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = this.alphaColor(light.glow, 0.9);
      ctx.beginPath();
      ctx.arc(x, y, trailPx > 15 ? 2.5 : 2, 0, Math.PI * 2);
      ctx.fill();

      if (trailPx > 18) {
        ctx.globalAlpha = 0.1;
        ctx.strokeStyle = light.glow;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(startX + 8, startY + 17);
        ctx.lineTo(x - 4, y + 17);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  drawForeground(ctx) {
    const parapet = ctx.createLinearGradient(0, 638, 0, H);
    parapet.addColorStop(0, "rgba(4, 8, 11, 0.94)");
    parapet.addColorStop(0.28, "#020507");
    parapet.addColorStop(1, "#010203");
    ctx.fillStyle = parapet;
    ctx.fillRect(0, 646, W, H - 646);

    ctx.fillStyle = "rgba(3, 6, 9, 0.92)";
    const rng = mulberry32(123);
    for (let x = -10; x < W + 30; x += 155) {
      const width = 6 + rng() * 2;
      ctx.fillRect(x, 612, width, 55);
      ctx.fillRect(x - 3, 609, width + 6, 4);
    }

    const rail = ctx.createLinearGradient(0, 610, 0, 623);
    rail.addColorStop(0, "rgba(58, 38, 24, 0.62)");
    rail.addColorStop(1, "rgba(5, 9, 12, 0.92)");
    ctx.fillStyle = rail;
    ctx.fillRect(0, 613, W, 7);
    ctx.fillStyle = "rgba(168, 127, 84, 0.19)";
    ctx.fillRect(0, 613, W, 1);

    const foregroundGlow = ctx.createLinearGradient(0, 660, 0, 720);
    foregroundGlow.addColorStop(0, "rgba(6, 10, 13, 0)");
    foregroundGlow.addColorStop(1, "rgba(0, 1, 3, 0.94)");
    ctx.fillStyle = foregroundGlow;
    ctx.fillRect(0, 660, W, 60);
  }

  alphaColor(hex, alpha) {
    const value = hex.replace("#", "");
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  createNoiseFrames() {
    if (this.noiseFrames.length) return;
    for (let frame = 0; frame < 4; frame += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d");
      const image = ctx.createImageData(canvas.width, canvas.height);
      const rng = mulberry32(5100 + frame * 977);
      for (let i = 0; i < image.data.length; i += 4) {
        const emission = Math.pow(rng(), 3.6);
        const luma = emission * (20 + rng() * 94);
        const chromaR = (rng() - 0.5) * 175 * emission;
        const chromaB = (rng() - 0.5) * 175 * emission;
        image.data[i] = clamp(luma + chromaR, 0, 255);
        image.data[i + 1] = clamp(luma - chromaR * 0.42 - chromaB * 0.19, 0, 255);
        image.data[i + 2] = clamp(luma + chromaB, 0, 255);
        image.data[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      this.noiseFrames.push(canvas);

      const shadowCanvas = document.createElement("canvas");
      shadowCanvas.width = 640;
      shadowCanvas.height = 360;
      const shadowCtx = shadowCanvas.getContext("2d");
      shadowCtx.drawImage(canvas, 0, 0);
      shadowCtx.globalCompositeOperation = "destination-in";
      const mask = shadowCtx.createLinearGradient(0, 0, 0, 360);
      mask.addColorStop(0, "rgba(255, 255, 255, 0.55)");
      mask.addColorStop(0.42, "rgba(255, 255, 255, 0.12)");
      mask.addColorStop(0.66, "rgba(255, 255, 255, 0.2)");
      mask.addColorStop(1, "rgba(255, 255, 255, 0.8)");
      shadowCtx.fillStyle = mask;
      shadowCtx.fillRect(0, 0, 640, 360);
      this.shadowNoiseFrames.push(shadowCanvas);
    }
  }

  drawNoise(ctx, settings, seed = 0) {
    this.createNoiseFrames();
    const noise = noiseModel(settings);
    const frame = Math.abs(Math.floor(seed)) % this.noiseFrames.length;
    const alpha = clamp(0.025 + noise.chroma * 0.17, 0.025, 0.2);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.noiseFrames[frame], 0, 0, W, H);
    ctx.globalAlpha = alpha * 0.24;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.noiseFrames[(frame + 2) % 4], 0, 0, W, H);
    ctx.globalAlpha = Math.max(0, noise.chroma - 0.24) * 0.18;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.shadowNoiseFrames[frame], 0, 0, W, H);
    ctx.restore();
  }

  applyExposure(ctx, info) {
    const ev = info.ev;
    if (ev < 0) {
      ctx.save();
      ctx.fillStyle = `rgba(1, 4, 8, ${clamp(-ev * 0.19, 0, 0.63)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      return;
    }
    if (ev > 0.2) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const overlay = ctx.createLinearGradient(0, 80, 0, H);
      const alpha = clamp((ev - 0.2) * 0.045, 0, 0.18);
      overlay.addColorStop(0, `rgba(239, 225, 205, ${alpha * 0.5})`);
      overlay.addColorStop(0.58, `rgba(255, 236, 208, ${alpha})`);
      overlay.addColorStop(1, `rgba(223, 194, 164, ${alpha * 0.34})`);
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  drawVignette(ctx) {
    const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.22, W / 2, H / 2, H * 0.86);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.68, "rgba(0, 2, 5, 0.10)");
    vignette.addColorStop(1, "rgba(0, 1, 3, 0.55)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  drawScene(ctx, settings, time) {
    const info = describeSettings(settings);
    this.drawSky(ctx, time);
    this.drawCity(ctx, time);
    this.drawRoad(ctx, time, settings);
    this.drawForeground(ctx);
    this.applyExposure(ctx, info);
  }

  render(settings, time = 0, options = {}) {
    const { noise = true, seed = 0, vignette = true } = options;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    this.drawScene(ctx, settings, time);
    if (noise) this.drawNoise(ctx, settings, seed);
    if (vignette) this.drawVignette(ctx);
    ctx.restore();
  }

  measureNoise(settings, time, seed) {
    const cleanCtx = this.measureCtx;
    cleanCtx.save();
    cleanCtx.globalCompositeOperation = "source-over";
    cleanCtx.globalAlpha = 1;
    this.drawScene(cleanCtx, settings, time);
    this.drawVignette(cleanCtx);
    cleanCtx.restore();

    const shot = this.ctx.getImageData(0, 0, W, H).data;
    const clean = cleanCtx.getImageData(0, 0, W, H).data;
    let count = 0;
    let lumaSquares = 0;
    let chromaTotal = 0;
    let tintTotal = 0;
    let peakChroma = 0;
    for (let y = 12; y < H - 8; y += 5) {
      const inSky = y < 185;
      const inShadow = y > 650;
      if (!inSky && !inShadow && (y < 435 || y > 475)) continue;
      for (let x = 10; x < W - 8; x += 5) {
        const index = (y * W + x) * 4;
        const cleanLuma = clean[index] * 0.2126 + clean[index + 1] * 0.7152 + clean[index + 2] * 0.0722;
        if (cleanLuma > 62) continue;
        const shotLuma = shot[index] * 0.2126 + shot[index + 1] * 0.7152 + shot[index + 2] * 0.0722;
        const luminance = shotLuma - cleanLuma;
        lumaSquares += luminance * luminance;
        const shotChroma = Math.max(shot[index], shot[index + 1], shot[index + 2])
          - Math.min(shot[index], shot[index + 1], shot[index + 2]);
        const cleanChroma = Math.max(clean[index], clean[index + 1], clean[index + 2])
          - Math.min(clean[index], clean[index + 1], clean[index + 2]);
        const chroma = Math.max(0, shotChroma - cleanChroma);
        const tint = Math.abs(shot[index] - shot[index + 2]) - Math.abs(clean[index] - clean[index + 2]);
        chromaTotal += chroma;
        tintTotal += Math.max(0, tint);
        peakChroma = Math.max(peakChroma, chroma);
        count += 1;
      }
    }
    const safeCount = Math.max(1, count);
    const lumaRms = Math.sqrt(lumaSquares / safeCount);
    const chromaAverage = chromaTotal / safeCount;
    const tintAverage = tintTotal / safeCount;
    return {
      shadowChroma: Number((chromaAverage * 9.2 + tintAverage * 4.8).toFixed(1)),
      lumaNoise: Number((lumaRms * 4.4).toFixed(1)),
      peakChroma: Number(peakChroma.toFixed(0)),
      sampleCount: count,
    };
  }
}
