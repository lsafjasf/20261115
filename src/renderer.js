import { clamp, lerp, WORLD } from "./config.js";

const TAU = Math.PI * 2;

function hash(value) {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
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

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.time = 0;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  render(state, view) {
    const ctx = this.ctx;
    const { width, height } = this;
    this.time = view.time;
    const tide = clamp(1 - state.time / WORLD.duration, 0, 1);
    const easedTide = tide * tide * (3 - 2 * tide);
    const waterY = height * 0.625 - easedTide * height * 0.085;
    const camera = view.camera;

    ctx.clearRect(0, 0, width, height);
    this.drawSky(state, tide, waterY);
    this.drawFarBank(camera, waterY, tide);
    this.drawWater(camera, waterY, tide);
    this.drawShoreDetails(camera, waterY, tide);

    const world = { camera, waterY, tide };
    for (const dock of state.docks) this.drawDock(dock, state, world);
    this.drawProcessor(state, world);
    this.drawBoat(state, world, view.maxSpeed);
    this.drawTideGauge(state, tide, waterY);
    this.drawNavigationMarker(state, world);
  }

  drawSky(state, tide, waterY) {
    const ctx = this.ctx;
    const { width, height } = this;
    const sky = ctx.createLinearGradient(0, 0, 0, waterY);
    const late = clamp((1 - state.time / WORLD.duration) * 1.25, 0, 1);
    sky.addColorStop(0, late > 0.72 ? "#4b5c50" : "#294f55");
    sky.addColorStop(0.48, "#63827b");
    sky.addColorStop(0.82, "#9eb29a");
    sky.addColorStop(1, "#c2c9a9");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, waterY + 3);

    const sunX = width * 0.76;
    const sunY = height * (0.18 + tide * 0.02);
    const glow = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, Math.max(width, height) * 0.35);
    glow.addColorStop(0, "rgba(238, 239, 187, 0.42)");
    glow.addColorStop(0.15, "rgba(222, 229, 170, 0.12)");
    glow.addColorStop(1, "rgba(222, 229, 170, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, waterY);

    ctx.fillStyle = "rgba(246, 244, 201, 0.68)";
    ctx.beginPath();
    ctx.arc(sunX, sunY, 21, 0, TAU);
    ctx.fill();

    this.drawCloud(width * 0.14, height * 0.15, 1.05, 0.055);
    this.drawCloud(width * 0.46, height * 0.1, 0.74, 0.04);
    this.drawCloud(width * 0.86, height * 0.29, 0.56, 0.035);

    const birds = [
      [width * 0.61, height * 0.15, 1],
      [width * 0.65, height * 0.12, 0.75],
      [width * 0.68, height * 0.17, 0.58],
    ];
    ctx.strokeStyle = "rgba(18, 39, 36, 0.34)";
    ctx.lineWidth = 1;
    for (const [x, y, scale] of birds) {
      const flap = Math.sin(this.time * 2.2 + x) * 2.2;
      ctx.beginPath();
      ctx.moveTo(x - 7 * scale, y + flap * scale);
      ctx.quadraticCurveTo(x - 3 * scale, y - 3 * scale, x, y);
      ctx.quadraticCurveTo(x + 3 * scale, y - 3 * scale, x + 7 * scale, y + flap * scale);
      ctx.stroke();
    }
  }

  drawCloud(x, y, scale, alpha) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x + Math.sin(this.time * 0.035 + y) * 20, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = `rgba(227, 234, 210, ${alpha})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, 68, 13, -0.05, 0, TAU);
    ctx.ellipse(-38, -7, 32, 15, -0.1, 0, TAU);
    ctx.ellipse(24, -10, 44, 18, 0.04, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawFarBank(camera, waterY, tide) {
    const ctx = this.ctx;
    const { width } = this;
    const parallax = camera * 0.14;
    const baseline = waterY + 8;

    ctx.save();
    ctx.translate(-parallax, 0);
    const span = Math.ceil(width / 260) + 4;
    for (let i = -2; i < span; i += 1) {
      const x = i * 260;
      const h = 34 + hash(i + 12) * 58;
      ctx.fillStyle = i % 2 ? "rgba(31, 62, 60, 0.63)" : "rgba(35, 69, 65, 0.55)";
      ctx.fillRect(x, baseline - h, 170 + hash(i + 4) * 55, h);
      ctx.fillStyle = "rgba(195, 211, 184, 0.09)";
      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 5; col += 1) {
          if (hash(i * 20 + row * 5 + col) > 0.35) {
            ctx.fillRect(x + 14 + col * 25, baseline - h + 12 + row * 13, 5, 4);
          }
        }
      }
    }
    this.drawCrane(390 - parallax * 0, baseline, 0.72, "rgba(23, 55, 53, 0.66)");
    this.drawCrane(820 - parallax * 0, baseline, 0.52, "rgba(23, 55, 53, 0.55)");
    this.drawCrane(1680 - parallax * 0, baseline, 0.62, "rgba(23, 55, 53, 0.58)");
    ctx.restore();

    ctx.fillStyle = "rgba(29, 62, 56, 0.82)";
    ctx.fillRect(0, waterY + 1, width, 4);
    ctx.fillStyle = `rgba(188, 216, 173, ${0.12 + tide * 0.08})`;
    ctx.fillRect(0, waterY + 1, width, 1);
  }

  drawCrane(x, baseline, scale, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, baseline);
    ctx.scale(scale, scale);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-28, 0);
    ctx.lineTo(-18, -112);
    ctx.lineTo(20, -112);
    ctx.lineTo(34, 0);
    ctx.moveTo(-18, -112);
    ctx.lineTo(84, -116);
    ctx.lineTo(84, -108);
    ctx.moveTo(22, -108);
    ctx.lineTo(65, -78);
    ctx.stroke();
    ctx.fillRect(68, -111, 32, 8);
    ctx.fillRect(82, -103, 2, 30);
    ctx.restore();
  }

  drawWater(camera, waterY, tide) {
    const ctx = this.ctx;
    const { width, height } = this;
    const river = ctx.createLinearGradient(0, waterY, 0, height);
    river.addColorStop(0, "#416f6d");
    river.addColorStop(0.3, "#204b4c");
    river.addColorStop(1, "#092e34");
    ctx.fillStyle = river;
    ctx.fillRect(0, waterY, width, height - waterY);

    const horizonGlow = ctx.createLinearGradient(0, waterY, 0, waterY + height * 0.25);
    horizonGlow.addColorStop(0, "rgba(209, 214, 167, 0.26)");
    horizonGlow.addColorStop(1, "rgba(209, 214, 167, 0)");
    ctx.fillStyle = horizonGlow;
    ctx.fillRect(0, waterY, width, height * 0.28);

    const drift = (this.time * 26 - camera * 0.46) % 160;
    for (let layer = 0; layer < 4; layer += 1) {
      const yBase = waterY + 18 + layer * (height - waterY) * 0.19;
      const step = 86 + layer * 22;
      ctx.beginPath();
      for (let x = -step * 2 - drift; x < width + step; x += 4) {
        const wave = Math.sin((x + drift) * 0.021 + this.time * (0.55 + layer * 0.1)) * (2.2 + layer * 0.8);
        const y = yBase + wave + Math.sin((x + camera) * 0.009) * 3;
        if (x === -step * 2 - drift) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(184, 226, 201, ${0.12 - layer * 0.018})`;
      ctx.lineWidth = layer === 0 ? 1.1 : 0.7;
      ctx.stroke();
    }

    const reflectionX = width * 0.76;
    for (let i = 0; i < 13; i += 1) {
      const y = waterY + 8 + i * 15 + Math.sin(this.time * 0.8 + i) * 3;
      const w = 36 + hash(i + 8) * 80;
      ctx.strokeStyle = `rgba(229, 226, 172, ${0.12 - i * 0.007})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(reflectionX - w / 2 + Math.sin(this.time + i) * 10, y);
      ctx.lineTo(reflectionX + w / 2 + Math.cos(this.time * 0.7 + i) * 8, y);
      ctx.stroke();
    }

    for (let i = 0; i < 24; i += 1) {
      const x = (hash(i * 4.1) * (width + 160) + this.time * (4 + hash(i) * 7)) % (width + 160) - 80;
      const y = waterY + 25 + hash(i * 7.7) * (height - waterY - 45);
      ctx.fillStyle = `rgba(193, 226, 199, ${0.025 + hash(i + 5) * 0.05})`;
      ctx.fillRect(x, y, 2 + hash(i + 3) * 4, 1);
    }

    const tideFoam = ctx.createLinearGradient(0, waterY, 0, waterY + 16);
    tideFoam.addColorStop(0, `rgba(216, 237, 207, ${0.2 + tide * 0.12})`);
    tideFoam.addColorStop(1, "rgba(216, 237, 207, 0)");
    ctx.fillStyle = tideFoam;
    ctx.fillRect(0, waterY, width, 17);
  }

  drawShoreDetails(camera, waterY, tide) {
    const ctx = this.ctx;
    const { width } = this;
    const base = waterY - 31;
    ctx.save();
    ctx.translate(-camera * 0.46, 0);
    for (let i = -1; i < Math.ceil(width / 360) + 3; i += 1) {
      const x = i * 360 + camera * 0.46;
      if (x < -100 || x > width + 100) continue;
    }
    const shoreGradient = ctx.createLinearGradient(0, base, 0, waterY + 2);
    shoreGradient.addColorStop(0, "#596d55");
    shoreGradient.addColorStop(1, "#314e41");
    ctx.fillStyle = shoreGradient;
    ctx.fillRect(-200, base, width + Math.abs(camera) * 0.46 + 600, waterY - base + 2);
    ctx.fillStyle = "rgba(180, 202, 153, 0.18)";
    ctx.fillRect(-200, base, width + Math.abs(camera) * 0.46 + 600, 2);
    for (let x = -180; x < width + 500; x += 37) {
      const height = 8 + hash(x * 0.1) * 14;
      ctx.fillStyle = "rgba(100, 125, 80, 0.54)";
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x + 3, base - height);
      ctx.lineTo(x + 6, base);
      ctx.fill();
    }
    ctx.restore();
    if (tide > 0.55) {
      ctx.fillStyle = `rgba(74, 123, 112, ${0.22 * tide})`;
      ctx.fillRect(0, waterY - 26, width, 27);
    }
  }

  drawDock(dock, state, world) {
    const ctx = this.ctx;
    const { camera, waterY } = world;
    const x = dock.x - camera;
    if (x < -190 || x > this.width + 190) return;

    const deckY = waterY - 48;
    const distance = Math.abs(state.boat.x - dock.x);
    const inReach = distance < WORLD.dockReach && state.mode === "playing";
    const canAct = inReach && !dock.collected && state.boat.volume + dock.volume <= WORLD.capacity;

    ctx.save();
    ctx.translate(x, 0);

    if (!dock.collected) {
      const glow = ctx.createRadialGradient(0, deckY - 5, 4, 0, deckY - 5, 130);
      glow.addColorStop(0, `rgba(217, 243, 106, ${0.08 + (canAct ? 0.1 : 0)})`);
      glow.addColorStop(1, "rgba(217, 243, 106, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(-130, deckY - 135, 260, 175);
    }

    ctx.fillStyle = "rgba(13, 31, 33, 0.4)";
    ctx.fillRect(-92, deckY + 45, 184, 8);
    ctx.fillStyle = "#535d4e";
    ctx.fillRect(-98, deckY, 196, 15);
    ctx.fillStyle = "#75806b";
    ctx.fillRect(-98, deckY, 196, 3);
    ctx.fillStyle = "#38463e";
    ctx.fillRect(-83, deckY + 15, 16, waterY - deckY + 31);
    ctx.fillRect(67, deckY + 15, 16, waterY - deckY + 31);
    ctx.fillStyle = "rgba(152, 174, 139, 0.32)";
    ctx.fillRect(-83, deckY + 15, 3, waterY - deckY + 31);
    ctx.fillRect(67, deckY + 15, 3, waterY - deckY + 31);

    ctx.fillStyle = "#273a35";
    ctx.fillRect(-75, deckY - 12, 150, 13);
    for (let i = -68; i < 70; i += 12) {
      ctx.fillStyle = i % 24 === 0 ? "#b4a86f" : "#d45f49";
      ctx.fillRect(i, deckY - 12, 7, 13);
    }

    this.drawDockCargo(dock, deckY);
    this.drawDockSign(dock, deckY, state);

    if (!dock.collected) {
      const pulse = 0.5 + Math.sin(this.time * 2.4 + dock.x) * 0.5;
      const markerY = deckY - 92 - Math.sin(this.time * 1.8) * 3;
      ctx.strokeStyle = dock.accent;
      ctx.globalAlpha = 0.38 + pulse * 0.36;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, markerY, 17 + pulse * 3, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#0b2627";
      ctx.beginPath();
      ctx.arc(0, markerY, 12, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = dock.accent;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = dock.accent;
      ctx.font = "600 10px 'Chakra Petch', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(dock.short, 0, markerY + 1);
    } else {
      ctx.strokeStyle = "rgba(181, 240, 199, 0.72)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, deckY - 82, 11, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-5, deckY - 82);
      ctx.lineTo(-1, deckY - 78);
      ctx.lineTo(6, deckY - 88);
      ctx.stroke();
    }

    if (inReach && !dock.collected) {
      const ready = canAct ? "按 E 收集" : "货舱不足 · 先压缩";
      this.drawWorldPrompt(0, deckY + 62, ready, canAct ? "#d9f36a" : "#ff795f");
    }

    if (dock.flash > 0) {
      ctx.fillStyle = `rgba(217, 243, 106, ${dock.flash * 0.15})`;
      ctx.fillRect(-115, deckY - 145, 230, 210);
    }
    ctx.restore();
  }

  drawDockCargo(dock, deckY) {
    const ctx = this.ctx;
    if (dock.collected) {
      ctx.fillStyle = "rgba(173, 219, 177, 0.23)";
      ctx.fillRect(-34, deckY - 3, 68, 2);
      return;
    }

    const colors = ["#344844", "#2e403c", "#4c4a38", "#253b38"];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 4 - row; col += 1) {
        const w = 24 + hash(row * 4 + col) * 7;
        const x = -39 + col * 24 + row * 12;
        const y = deckY - 13 - row * 18;
        ctx.fillStyle = colors[(row + col) % colors.length];
        roundedRect(ctx, x, y - 14, w, 16, 4);
        ctx.fill();
        ctx.strokeStyle = "rgba(212, 231, 194, 0.15)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x + w * 0.35, y - 8, 2.2, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = "rgba(217, 243, 106, 0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-48, deckY - 11);
    ctx.lineTo(48, deckY - 11);
    ctx.stroke();
  }

  drawDockSign(dock, deckY, state) {
    const ctx = this.ctx;
    const signY = deckY - 125;
    ctx.fillStyle = "rgba(6, 28, 29, 0.9)";
    ctx.fillRect(-55, signY, 110, 28);
    ctx.fillStyle = dock.accent;
    ctx.fillRect(-55, signY, 2, 28);
    ctx.fillStyle = "rgba(237, 245, 231, 0.84)";
    ctx.font = "500 9px 'Noto Sans SC', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(dock.label, -46, signY + 10);
    ctx.fillStyle = "rgba(237, 245, 231, 0.4)";
    ctx.font = "500 7px 'Chakra Petch', sans-serif";
    ctx.fillText(dock.collected ? "COLLECTED" : `DOCK ${dock.short} / ${dock.volume}m³`, -46, signY + 20);
    if (dock.collected) {
      ctx.fillStyle = "rgba(181, 240, 199, 0.26)";
      ctx.fillRect(-46, signY + 8, 82, 1);
    }
  }

  drawProcessor(state, world) {
    const ctx = this.ctx;
    const { camera, waterY } = world;
    const x = state.processor.x - camera;
    if (x < -250 || x > this.width + 300) return;
    const deckY = waterY - 63;
    const active = state.docks.every((dock) => dock.collected);
    const inReach = Math.abs(state.boat.x - state.processor.x) < WORLD.processorReach;

    ctx.save();
    ctx.translate(x, 0);

    const glow = ctx.createRadialGradient(-22, deckY - 40, 4, -22, deckY - 40, 165);
    glow.addColorStop(0, `rgba(217, 243, 106, ${active ? 0.17 : 0.05})`);
    glow.addColorStop(1, "rgba(217, 243, 106, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-180, deckY - 200, 330, 260);

    ctx.fillStyle = "#303d38";
    ctx.fillRect(-150, deckY - 120, 160, 125);
    ctx.fillStyle = "#3f4e46";
    ctx.fillRect(-159, deckY - 126, 176, 8);
    ctx.fillStyle = "rgba(195, 214, 175, 0.12)";
    for (let i = 0; i < 7; i += 1) {
      ctx.fillRect(-134 + i * 18, deckY - 100, 8, 10);
    }
    ctx.fillStyle = "#263531";
    ctx.fillRect(-124, deckY - 158, 20, 34);
    ctx.fillRect(-96, deckY - 173, 15, 48);
    ctx.fillStyle = "rgba(214, 225, 199, 0.2)";
    ctx.beginPath();
    ctx.arc(-114, deckY - 166, 10 + Math.sin(this.time * 0.8) * 5, 0, TAU);
    ctx.arc(-88, deckY - 184, 7 + Math.sin(this.time * 0.65 + 2) * 4, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "#6a7768";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-12, deckY - 98);
    ctx.lineTo(52, deckY - 174);
    ctx.lineTo(102, deckY - 174);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(52, deckY - 174);
    ctx.lineTo(34, deckY - 123);
    ctx.lineTo(88, deckY - 123);
    ctx.stroke();

    ctx.fillStyle = "#566150";
    ctx.fillRect(12, deckY - 75, 98, 14);
    ctx.fillStyle = "#202f2d";
    ctx.beginPath();
    ctx.moveTo(22, deckY - 61);
    ctx.lineTo(74, deckY - 61);
    ctx.lineTo(60, deckY - 19);
    ctx.lineTo(34, deckY - 19);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(217, 243, 106, 0.34)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = active ? "#d9f36a" : "#6d806e";
    ctx.fillRect(15, deckY - 14, 3, 64);
    ctx.fillRect(27, deckY - 14, 3, 64);
    ctx.fillRect(-155, deckY - 14, 3, 64);
    ctx.fillRect(-143, deckY - 14, 3, 64);
    ctx.fillStyle = "#3a4a40";
    ctx.fillRect(-166, deckY - 2, 188, 12);

    ctx.fillStyle = "rgba(6, 27, 29, 0.92)";
    ctx.fillRect(-118, deckY - 200, 154, 34);
    ctx.fillStyle = active ? "#d9f36a" : "rgba(237, 245, 231, 0.42)";
    ctx.fillRect(-118, deckY - 200, 2, 34);
    ctx.font = "500 10px 'Noto Sans SC', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("东岸处理点", -108, deckY - 190);
    ctx.fillStyle = "rgba(237, 245, 231, 0.4)";
    ctx.font = "500 7px 'Chakra Petch', sans-serif";
    ctx.fillText(active ? "HOPPER READY" : "AWAITING THREE LOADS", -108, deckY - 179);

    if (active) {
      const pulse = 0.5 + Math.sin(this.time * 3) * 0.5;
      ctx.strokeStyle = `rgba(217, 243, 106, ${0.45 + pulse * 0.3})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(52, deckY - 90, 19 + pulse * 3, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = "#d9f36a";
      ctx.font = "600 12px 'Chakra Petch', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("P", 52, deckY - 89);
    }

    if (inReach) {
      this.drawWorldPrompt(48, deckY + 44, active ? "按 E 送抵处理" : `还需 ${state.docks.filter((d) => !d.collected).length} 处收集`, active ? "#d9f36a" : "#ff795f");
    }

    if (state.processor.flash > 0) {
      ctx.fillStyle = `rgba(217, 243, 106, ${state.processor.flash * 0.2})`;
      ctx.fillRect(-190, deckY - 220, 350, 320);
    }
    ctx.restore();
  }

  drawBoat(state, world, maxSpeed) {
    const ctx = this.ctx;
    const { camera, waterY } = world;
    const boat = state.boat;
    const x = boat.x - camera;
    const speedRatio = clamp(Math.abs(boat.vx) / Math.max(1, maxSpeed), 0, 1);
    const draft = boat.mass * 0.11;
    const bob = Math.sin(this.time * 2.25) * 1.4 - speedRatio * 1.2;
    const angle = clamp(boat.vx / maxSpeed, -1, 1) * 0.016;

    this.drawWake(x, waterY, speedRatio, boat.vx);

    ctx.save();
    ctx.translate(x, waterY + bob + draft);
    ctx.rotate(angle);

    this.drawLeakZone(boat, state);

    const hull = ctx.createLinearGradient(0, -43, 0, 23);
    hull.addColorStop(0, "#d5d7bd");
    hull.addColorStop(0.22, "#9ca886");
    hull.addColorStop(1, "#263e3c");
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(-84, -39);
    ctx.lineTo(71, -39);
    ctx.lineTo(86, -21);
    ctx.lineTo(70, 15);
    ctx.lineTo(-62, 17);
    ctx.lineTo(-82, 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#1e3435";
    ctx.beginPath();
    ctx.moveTo(-66, 2);
    ctx.lineTo(73, 2);
    ctx.lineTo(67, 15);
    ctx.lineTo(-60, 17);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(224, 234, 201, 0.42)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-82, -38);
    ctx.lineTo(71, -38);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 242, 183, 0.16)";
    ctx.fillRect(-54, 5, 109, 2);
    ctx.fillStyle = "rgba(8, 22, 22, 0.3)";
    ctx.fillRect(-56, 12, 102, 2);

    ctx.fillStyle = "#b34f3e";
    ctx.fillRect(31, -48, 29, 7);
    ctx.fillStyle = "#dbe0c1";
    ctx.font = "600 7px 'Chakra Petch', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("TIDE 07", 45, -42.5);

    ctx.fillStyle = "#344a42";
    ctx.fillRect(-78, -48, 132, 9);
    ctx.fillStyle = "#8ba07e";
    ctx.fillRect(-78, -48, 132, 2);
    for (let i = -74; i < 47; i += 18) {
      ctx.fillStyle = "rgba(226, 236, 202, 0.4)";
      ctx.fillRect(i, -58, 1, 10);
    }
    ctx.fillStyle = "rgba(226, 236, 202, 0.33)";
    ctx.fillRect(-78, -59, 132, 1);

    this.drawCabin();
    this.drawCargoBay(boat, state);
    this.drawHullGauge(boat);
    this.drawLeakDroplets(boat, state);
    ctx.restore();

    if (speedRatio > 0.05) this.drawSplash(x, waterY, speedRatio, boat.vx);
  }

  drawCabin() {
    const ctx = this.ctx;
    ctx.fillStyle = "#d7d9bd";
    ctx.beginPath();
    ctx.moveTo(-80, -48);
    ctx.lineTo(-78, -91);
    ctx.lineTo(-41, -101);
    ctx.lineTo(-25, -84);
    ctx.lineTo(-22, -48);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#335653";
    ctx.beginPath();
    ctx.moveTo(-72, -55);
    ctx.lineTo(-70, -85);
    ctx.lineTo(-44, -92);
    ctx.lineTo(-32, -81);
    ctx.lineTo(-31, -55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(190, 229, 203, 0.33)";
    ctx.fillRect(-68, -82, 28, 2);
    ctx.fillRect(-68, -71, 32, 1);
    ctx.fillStyle = "#293c36";
    ctx.fillRect(-60, -56, 17, 9);
    ctx.fillStyle = "#d9f36a";
    ctx.fillRect(-57, -54, 3, 2);
    ctx.fillStyle = "#c2b160";
    ctx.fillRect(-77, -103, 5, 15);
    ctx.fillStyle = "rgba(226, 232, 203, 0.15)";
    ctx.beginPath();
    ctx.arc(-74, -110, 7 + Math.sin(this.time * 1.2) * 4, 0, TAU);
    ctx.fill();
  }

  drawCargoBay(boat, state) {
    const ctx = this.ctx;
    const left = -17;
    const right = 65;
    const top = -101;
    const bottom = -48;
    const width = right - left;
    const height = bottom - top;
    const fill = clamp(boat.volume / WORLD.capacity, 0, 1);

    ctx.fillStyle = "#243c39";
    ctx.fillRect(left - 4, bottom - 2, width + 8, 7);
    ctx.fillStyle = "#627568";
    ctx.fillRect(left - 4, bottom - 2, width + 8, 2);
    ctx.fillStyle = "rgba(8, 30, 30, 0.7)";
    ctx.fillRect(left, top, width, height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(left + 2, top + 2, width - 4, height - 4);
    ctx.clip();

    const cargoHeight = Math.max(0, fill * (height - 5));
    const cargoTop = bottom - cargoHeight - 1;
    const density = clamp(boat.mass > 0 ? boat.volume / Math.max(1, boat.mass) : 0, 0.26, 1.2);
    const squished = density < 0.55;
    const blockW = squished ? 24 : 16;
    const blockH = squished ? 13 : 12;
    let index = 0;
    for (let y = bottom - blockH; y >= cargoTop; y -= blockH - 1) {
      for (let bx = left + 2 + (index % 2) * 4; bx < right - 3; bx += blockW) {
        const tone = hash(index + Math.floor(y) * 0.7);
        ctx.fillStyle = squished
          ? tone > 0.5
            ? "#9b9d63"
            : "#7d875c"
          : tone > 0.5
            ? "#536150"
            : "#45564c";
        roundedRect(ctx, bx, y, blockW - 2, blockH - 1, 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(226, 236, 197, 0.12)";
        ctx.stroke();
        index += 1;
      }
    }

    if (fill > 0.68) {
      const danger = ctx.createLinearGradient(0, cargoTop, 0, bottom);
      danger.addColorStop(0, "rgba(255, 121, 95, 0.05)");
      danger.addColorStop(1, "rgba(255, 121, 95, 0.24)");
      ctx.fillStyle = danger;
      ctx.fillRect(left, cargoTop, width, cargoHeight);
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(201, 228, 198, 0.38)";
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
    ctx.fillStyle = "rgba(217, 243, 106, 0.5)";
    ctx.fillRect(left + 3, bottom - 4, (width - 6) * fill, 2);

    const plunge = boat.compacting ? 30 + Math.sin(this.time * 23) * 5 : 0;
    ctx.fillStyle = "#9fa992";
    ctx.fillRect(left + 5, top + 4 + plunge, 10, 7);
    ctx.fillRect(right - 15, top + 4 + plunge, 10, 7);
    ctx.fillStyle = "#48584e";
    ctx.fillRect(left + 4, top + 11 + plunge, width - 8, 7);
    ctx.fillStyle = "rgba(237, 245, 231, 0.16)";
    ctx.fillRect(left + 4, top + 11 + plunge, width - 8, 2);

    if (boat.compacting) {
      ctx.strokeStyle = `rgba(217, 243, 106, ${0.4 + Math.sin(this.time * 15) * 0.2})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(left - 2.5, top - 2.5, width + 5, height + 5);
      for (let i = 0; i < 4; i += 1) {
        const sparkX = left + 8 + hash(i * 4 + Math.floor(this.time * 10)) * (width - 16);
        ctx.fillStyle = "rgba(255, 201, 87, 0.55)";
        ctx.fillRect(sparkX, bottom - 3, 2, 2);
      }
    }

    ctx.fillStyle = "rgba(4, 19, 20, 0.8)";
    ctx.fillRect(right - 40, top + 5, 33, 15);
    ctx.fillStyle = "#d9f36a";
    ctx.font = "600 7px 'Chakra Petch', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(fill * 100)}% LOAD`, right - 23.5, top + 12.5);

    if (boat.volume >= WORLD.capacity - 0.1) {
      ctx.fillStyle = "#ff795f";
      ctx.font = "600 7px 'Noto Sans SC', sans-serif";
      ctx.fillText("满仓", right - 23.5, top + 30);
    }
  }

  drawHullGauge(boat) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(8, 27, 28, 0.74)";
    ctx.fillRect(-53, -33, 99, 17);
    ctx.fillStyle = "rgba(237, 245, 231, 0.1)";
    ctx.fillRect(-48, -26, 88, 4);
    const load = 1 - boat.mass / 68;
    ctx.fillStyle = load < 0.45 ? "#ff795f" : load < 0.7 ? "#ffc957" : "#d9f36a";
    ctx.fillRect(-48, -26, 88 * clamp(load, 0, 1), 4);
    ctx.fillStyle = "rgba(237, 245, 231, 0.6)";
    ctx.font = "500 6px 'Chakra Petch', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("DRAFT", -48, -30.5);
    ctx.textAlign = "right";
    ctx.fillText(`${boat.mass.toFixed(1)} T`, 39, -30.5);
  }

  drawLeakZone(boat, state) {
    const ctx = this.ctx;
    const ratio = clamp(boat.leak / 100, 0, 1);
    if (ratio < 0.015) return;
    const width = 86 + ratio * 118;
    const height = 7 + ratio * 18;
    const alpha = 0.08 + ratio * 0.25;

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const slick = ctx.createRadialGradient(0, 20, 2, 0, 20, width * 0.62);
    slick.addColorStop(0, `rgba(186, 221, 122, ${alpha * 0.52})`);
    slick.addColorStop(0.45, `rgba(113, 176, 122, ${alpha})`);
    slick.addColorStop(0.72, `rgba(126, 147, 201, ${alpha * 0.72})`);
    slick.addColorStop(1, "rgba(64, 104, 97, 0)");
    ctx.fillStyle = slick;
    ctx.beginPath();
    ctx.ellipse(-8, 19, width * 0.62, height, 0, 0, TAU);
    ctx.ellipse(29, 23, width * 0.4, height * 0.56, 0.1, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = `rgba(255, 182, 104, ${0.09 + ratio * 0.24})`;
    ctx.lineWidth = 1;
    for (let ring = 0; ring < 3; ring += 1) {
      ctx.beginPath();
      ctx.ellipse(-8, 20, 45 + ring * 21, 4 + ring * 3, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    if (boat.leak >= 64) {
      const glow = 0.12 + Math.sin(this.time * 5.5) * 0.06;
      ctx.fillStyle = `rgba(255, 121, 95, ${glow})`;
      ctx.beginPath();
      ctx.ellipse(-8, 21, 104, 20, 0, 0, TAU);
      ctx.fill();
    }
  }

  drawLeakDroplets(boat, state) {
    const ctx = this.ctx;
    const ratio = clamp(boat.leak / 100, 0, 1);
    if (ratio < 0.04) return;
    const count = Math.round(2 + ratio * 9);
    for (let i = 0; i < count; i += 1) {
      const cycle = (this.time * (0.7 + hash(i) * 0.7) + hash(i * 3.2)) % 1;
      const x = -61 + hash(i + 4) * 121;
      const y = 11 - cycle * (10 + ratio * 14);
      const alpha = (1 - cycle) * ratio * 0.64;
      ctx.fillStyle = `rgba(188, 220, 161, ${alpha})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 1.5, 2.5 + cycle * 2, 0, 0, TAU);
      ctx.fill();
    }
  }

  drawWake(x, waterY, speedRatio, velocity) {
    if (speedRatio < 0.035) return;
    const ctx = this.ctx;
    const direction = velocity >= 0 ? -1 : 1;
    const strength = 0.14 + speedRatio * 0.28;
    ctx.save();
    ctx.translate(x, waterY + 10);
    ctx.strokeStyle = `rgba(208, 234, 207, ${strength})`;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 5; i += 1) {
      const spread = 104 + i * 28 + speedRatio * 38;
      const y = 4 + i * 5;
      ctx.beginPath();
      ctx.moveTo(direction * (88 + i * 2), y - 2);
      ctx.quadraticCurveTo(direction * spread, y + 9, direction * (spread + 46), y + 2);
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(200, 231, 207, ${strength * 0.6})`;
    ctx.beginPath();
    ctx.moveTo(direction * 76, 13);
    ctx.lineTo(direction * (124 + speedRatio * 60), 17);
    ctx.stroke();
    ctx.restore();
  }

  drawSplash(x, waterY, speedRatio, velocity) {
    const ctx = this.ctx;
    const direction = velocity >= 0 ? 1 : -1;
    ctx.save();
    ctx.translate(x + direction * 79, waterY + 9);
    for (let i = 0; i < 7; i += 1) {
      const cycle = (this.time * (1.2 + hash(i) * 1.3) + i * 0.31) % 1;
      const px = direction * (8 + cycle * 52 * speedRatio);
      const py = -2 - Math.sin(cycle * Math.PI) * (7 + hash(i) * 13) * speedRatio;
      ctx.fillStyle = `rgba(219, 238, 215, ${(1 - cycle) * 0.4})`;
      ctx.beginPath();
      ctx.arc(px, py, 0.8 + hash(i + 2) * 1.8, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawWorldPrompt(x, y, text, color) {
    const ctx = this.ctx;
    ctx.font = "500 10px 'Noto Sans SC', sans-serif";
    const width = ctx.measureText(text).width + 30;
    ctx.fillStyle = "rgba(4, 22, 24, 0.91)";
    ctx.fillRect(x - width / 2, y - 13, width, 26);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.65;
    ctx.strokeRect(x - width / 2 + 0.5, y - 12.5, width - 1, 25);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.fillRect(x - width / 2 + 3, y - 1, 8, 2);
    ctx.fillStyle = "#edf5e7";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 5, y);
  }

  drawNavigationMarker(state, world) {
    const ctx = this.ctx;
    const { width, height } = this;
    let target = state.docks.find((dock) => !dock.collected);
    let label = target ? `${target.short} · ${target.label}` : "P · 东岸处理点";
    if (!target) target = state.processor;
    const targetX = target.x - world.camera;
    if (targetX > 72 && targetX < width - 120) return;

    const onRight = targetX >= width - 120;
    const x = onRight ? width - 80 : 60;
    const y = height * 0.54;
    const direction = onRight ? 1 : -1;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(5, 25, 27, 0.82)";
    ctx.beginPath();
    ctx.arc(0, 0, 25, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(217, 243, 106, 0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = "#d9f36a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6 * direction, -8);
    ctx.lineTo(7 * direction, 0);
    ctx.lineTo(-6 * direction, 8);
    ctx.stroke();
    ctx.fillStyle = "rgba(237, 245, 231, 0.7)";
    ctx.font = "500 8px 'Noto Sans SC', sans-serif";
    ctx.textAlign = onRight ? "right" : "left";
    ctx.fillText(label, onRight ? -32 : 32, 1);
    ctx.restore();
  }

  drawTideGauge(state, tide, waterY) {
    const ctx = this.ctx;
    const x = this.width - 24;
    const highY = this.height * 0.54;
    const lowY = this.height * 0.635;
    ctx.save();
    ctx.strokeStyle = "rgba(217, 243, 106, 0.25)";
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x - 5, highY);
    ctx.lineTo(x - 5, lowY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(217, 243, 106, 0.26)";
    ctx.fillRect(x - 47, highY, 43, 1);
    ctx.fillStyle = "rgba(237, 245, 231, 0.36)";
    ctx.font = "500 7px 'Chakra Petch', sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("HIGH TIDE", x - 8, highY - 5);
    const currentY = lerp(lowY, highY, clamp(1 - state.time / WORLD.duration, 0, 1));
    ctx.fillStyle = "#b5f0c7";
    ctx.beginPath();
    ctx.moveTo(x - 4, currentY);
    ctx.lineTo(x + 3, currentY - 4);
    ctx.lineTo(x + 3, currentY + 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(237, 245, 231, 0.48)";
    ctx.fillText("NOW", x - 8, currentY + 2);
    ctx.restore();
  }
}
