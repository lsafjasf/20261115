import {
  BRIDGES,
  CAMP,
  CRACKS,
  DRILL,
  SITES,
  STRATA,
  THIN_CRACKS,
  WORLD,
} from "./config.js";

const TAU = Math.PI * 2;

function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

export class SceneRenderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.game = game;
    this.dpr = 1;
    this.width = 1;
    this.height = 1;
    this.base = document.createElement("canvas");
    this.base.width = WORLD.width;
    this.base.height = WORLD.height;
    this.baseCtx = this.base.getContext("2d");
    this.snowRandom = seededRandom(9087);
    this.snowflakes = Array.from({ length: 90 }, () => ({
      x: this.snowRandom() * 1.2,
      y: this.snowRandom(),
      speed: 0.008 + this.snowRandom() * 0.022,
      size: 0.6 + this.snowRandom() * 1.8,
      drift: this.snowRandom() * 6 - 3,
    }));
    this.resize();
    this.drawBaseWorld();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.framingOffsetX =
      this.width >= 1000 ? Math.min(180, this.width * 0.125) : this.width * 0.08;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.game.viewport = { width: this.width, height: this.height };
  }

  drawBaseWorld() {
    const ctx = this.baseCtx;
    const random = seededRandom(4173);
    ctx.clearRect(0, 0, WORLD.width, WORLD.height);

    const lake = ctx.createLinearGradient(0, 0, WORLD.width, WORLD.height);
    lake.addColorStop(0, "#2f5d66");
    lake.addColorStop(0.38, "#6fa6aa");
    lake.addColorStop(0.72, "#99bec1");
    lake.addColorStop(1, "#476b70");
    ctx.fillStyle = lake;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    ctx.globalAlpha = 0.3;
    for (let index = 0; index < 45; index += 1) {
      const x = random() * WORLD.width;
      const y = random() * WORLD.shoreY;
      const radius = 60 + random() * 260;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
      const cold = random() > 0.55;
      glow.addColorStop(0, cold ? "rgba(216,253,251,.34)" : "rgba(42,106,121,.32)");
      glow.addColorStop(1, "rgba(60,110,120,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    ctx.globalAlpha = 1;

    this.drawIceTexture(ctx, random);
    this.drawWindMarks(ctx, random);
    this.drawShore(ctx, random);
    this.drawThinCracks(ctx);
    this.drawCracks(ctx, random);
    this.drawBridges(ctx);
    this.drawCamp(ctx);
    this.drawSnowDrifts(ctx, random);
  }

  drawIceTexture(ctx, random) {
    for (let index = 0; index < 220; index += 1) {
      const x = random() * WORLD.width;
      const y = random() * (WORLD.shoreY - 30);
      const length = 10 + random() * 80;
      const angle = random() * TAU;
      ctx.strokeStyle =
        random() > 0.5
          ? `rgba(228,255,252,${0.025 + random() * 0.08})`
          : `rgba(21,68,82,${0.025 + random() * 0.06})`;
      ctx.lineWidth = 0.5 + random() * 1.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      ctx.stroke();
    }

    for (let index = 0; index < 900; index += 1) {
      const x = random() * WORLD.width;
      const y = random() * (WORLD.shoreY - 12);
      ctx.fillStyle = `rgba(240,255,252,${0.02 + random() * 0.08})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.4 + random() * 1.5, 0, TAU);
      ctx.fill();
    }
  }

  drawWindMarks(ctx, random) {
    ctx.save();
    ctx.globalAlpha = 0.13;
    for (let index = 0; index < 28; index += 1) {
      const x = random() * WORLD.width;
      const y = 120 + random() * (WORLD.shoreY - 220);
      const width = 100 + random() * 340;
      const gradient = ctx.createLinearGradient(x, y, x + width, y - width * 0.2);
      gradient.addColorStop(0, "rgba(236,255,251,0)");
      gradient.addColorStop(0.5, "rgba(236,255,251,.6)");
      gradient.addColorStop(1, "rgba(236,255,251,0)");
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2 + random() * 5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(
        x + width * 0.3,
        y - 20,
        x + width * 0.72,
        y + 12,
        x + width,
        y - width * 0.16,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  drawShore(ctx, random) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, WORLD.shoreY - 42);
    for (let x = 0; x <= WORLD.width; x += 36) {
      const y =
        WORLD.shoreY -
        32 +
        Math.sin(x * 0.012) * 18 +
        Math.sin(x * 0.031) * 8;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(WORLD.width, WORLD.height);
    ctx.lineTo(0, WORLD.height);
    ctx.closePath();
    const shore = ctx.createLinearGradient(0, WORLD.shoreY - 50, 0, WORLD.height);
    shore.addColorStop(0, "#173139");
    shore.addColorStop(0.24, "#283e42");
    shore.addColorStop(0.7, "#111d21");
    shore.addColorStop(1, "#071216");
    ctx.fillStyle = shore;
    ctx.fill();

    ctx.strokeStyle = "rgba(209,255,249,.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= WORLD.width; x += 24) {
      const y =
        WORLD.shoreY -
        34 +
        Math.sin(x * 0.012) * 18 +
        Math.sin(x * 0.031) * 8;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    for (let index = 0; index < 90; index += 1) {
      const x = random() * WORLD.width;
      const y = WORLD.shoreY + random() * (WORLD.height - WORLD.shoreY);
      ctx.fillStyle = `rgba(${100 + random() * 60},${140 + random() * 50},${143 + random() * 40},${0.08 + random() * 0.2})`;
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        3 + random() * 16,
        1 + random() * 6,
        random() * TAU,
        0,
        TAU,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  drawThinCracks(ctx) {
    ctx.save();
    ctx.strokeStyle = "rgba(12,54,66,.42)";
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    for (const line of THIN_CRACKS) {
      ctx.beginPath();
      ctx.moveTo(line[0][0], line[0][1]);
      for (const [x, y] of line.slice(1)) ctx.lineTo(x, y);
      ctx.stroke();
      ctx.strokeStyle = "rgba(209,251,247,.22)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = "rgba(12,54,66,.42)";
      ctx.lineWidth = 1.6;
    }
    ctx.restore();
  }

  drawCracks(ctx, random) {
    for (const crack of CRACKS) {
      const points = crack.points;
      const open = crack.kind === "open";
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = open
        ? "rgba(128,246,239,.11)"
        : "rgba(202,255,250,.12)";
      ctx.lineWidth = crack.width + 24;
      ctx.beginPath();
      points.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.strokeStyle = open ? "#052531" : "#385b62";
      ctx.lineWidth = crack.width + 3;
      ctx.beginPath();
      points.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.strokeStyle = open ? "#2f8190" : "#9ec9c8";
      ctx.globalAlpha = open ? 0.65 : 0.4;
      ctx.lineWidth = Math.max(1, crack.width * 0.28);
      ctx.beginPath();
      points.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x + 1, y + 1);
        else ctx.lineTo(x + 1, y + 1);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;

      for (let segment = 0; segment < points.length - 1; segment += 1) {
        const [x1, y1] = points[segment];
        const [x2, y2] = points[segment + 1];
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const count = open ? 3 : 2;
        for (let branch = 0; branch < count; branch += 1) {
          if (random() > 0.62) continue;
          const t = 0.2 + random() * 0.6;
          const x = x1 + (x2 - x1) * t;
          const y = y1 + (y2 - y1) * t;
          const side = random() > 0.5 ? 1 : -1;
          const branchAngle = angle + side * (0.65 + random() * 0.6);
          const length = 8 + random() * 32;
          ctx.strokeStyle = open ? "rgba(2,31,41,.8)" : "rgba(42,77,83,.55)";
          ctx.lineWidth = 0.7 + random() * (open ? 2 : 1.2);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(
            x + Math.cos(branchAngle) * length,
            y + Math.sin(branchAngle) * length,
          );
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  crackAngleAt(point) {
    let closest = { distance: Infinity, angle: 0 };
    for (const crack of CRACKS) {
      for (let index = 0; index < crack.points.length - 1; index += 1) {
        const start = crack.points[index];
        const end = crack.points[index + 1];
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const lengthSquared = dx * dx + dy * dy;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((point.x - start[0]) * dx + (point.y - start[1]) * dy) /
              lengthSquared,
          ),
        );
        const px = start[0] + dx * t;
        const py = start[1] + dy * t;
        const distance = Math.hypot(point.x - px, point.y - py);
        if (distance < closest.distance) {
          closest = { distance, angle: Math.atan2(dy, dx) };
        }
      }
    }
    return closest.angle;
  }

  drawBridges(ctx) {
    for (const bridge of BRIDGES) {
      const angle = this.crackAngleAt(bridge) + Math.PI / 2 + bridge.rotation;
      ctx.save();
      ctx.translate(bridge.x, bridge.y);
      ctx.rotate(angle);
      ctx.fillStyle = "rgba(0,12,17,.5)";
      ctx.beginPath();
      ctx.ellipse(4, 5, 69, 28, 0, 0, TAU);
      ctx.fill();

      const plank = ctx.createLinearGradient(0, -24, 0, 24);
      plank.addColorStop(0, "#dbeae5");
      plank.addColorStop(0.48, "#f0faf6");
      plank.addColorStop(1, "#9eb7b7");
      ctx.fillStyle = plank;
      roundedRect(ctx, -64, -23, 128, 46, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.72)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.strokeStyle = "rgba(69,99,103,.38)";
      ctx.lineWidth = 1.2;
      for (let x = -53; x <= 53; x += 13) {
        ctx.beginPath();
        ctx.moveTo(x, -19);
        ctx.lineTo(x + 4, 19);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(69,99,103,.22)";
      ctx.beginPath();
      ctx.moveTo(-60, -17);
      ctx.lineTo(60, -17);
      ctx.moveTo(-60, 17);
      ctx.lineTo(60, 17);
      ctx.stroke();

      for (const side of [-1, 1]) {
        ctx.strokeStyle = "rgba(51,75,79,.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-65, side * 25);
        ctx.lineTo(65, side * 25);
        ctx.stroke();
        for (const x of [-53, 53]) {
          ctx.fillStyle = "rgba(28,52,57,.9)";
          ctx.beginPath();
          ctx.arc(x, side * 25, 3.5, 0, TAU);
          ctx.fill();
          ctx.fillStyle = "rgba(255,194,105,.8)";
          ctx.beginPath();
          ctx.arc(x, side * 25, 1.4, 0, TAU);
          ctx.fill();
        }
      }

      ctx.fillStyle = "rgba(6,26,32,.65)";
      ctx.beginPath();
      ctx.roundRect(-20, -31, 40, 13, 2);
      ctx.fill();
      ctx.fillStyle = "rgba(224,251,245,.75)";
      ctx.font = '8px "Noto Sans SC", monospace';
      ctx.textAlign = "center";
      ctx.fillText(`SNOW BRIDGE ${bridge.label}`, 0, -22);
      ctx.restore();
    }
  }

  drawCamp(ctx) {
    ctx.save();
    ctx.translate(CAMP.x, CAMP.y);

    const padGlow = ctx.createRadialGradient(0, 0, 10, 0, 0, CAMP.radius + 38);
    padGlow.addColorStop(0, "rgba(255,181,94,.09)");
    padGlow.addColorStop(0.7, "rgba(255,181,94,.035)");
    padGlow.addColorStop(1, "rgba(255,181,94,0)");
    ctx.fillStyle = padGlow;
    ctx.beginPath();
    ctx.arc(0, 0, CAMP.radius + 38, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "rgba(22,35,36,.9)";
    ctx.beginPath();
    ctx.ellipse(0, 9, 94, 55, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,195,113,.45)";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.ellipse(0, 0, 87, 52, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(215,250,244,.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-28, 1);
    ctx.lineTo(-28, 36);
    ctx.moveTo(22, 0);
    ctx.lineTo(22, 35);
    ctx.stroke();
    ctx.strokeStyle = "rgba(215,250,244,.15)";
    ctx.beginPath();
    ctx.moveTo(-48, 18);
    ctx.lineTo(50, 18);
    ctx.stroke();

    ctx.fillStyle = "rgba(1,10,14,.35)";
    roundedRect(ctx, -78, -45, 66, 38, 4);
    ctx.fill();

    const container = ctx.createLinearGradient(-76, -42, -14, -8);
    container.addColorStop(0, "#b9713c");
    container.addColorStop(1, "#5f3e29");
    ctx.fillStyle = container;
    roundedRect(ctx, -78, -47, 63, 36, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,210,148,.45)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = "rgba(23,31,31,.38)";
    for (let x = -71; x < -20; x += 9) {
      ctx.beginPath();
      ctx.moveTo(x, -44);
      ctx.lineTo(x, -14);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(49, -30);
    ctx.rotate(-0.12);
    ctx.fillStyle = "rgba(4,18,22,.38)";
    roundedRect(ctx, -34, -24, 68, 51, 10);
    ctx.fill();
    const tent = ctx.createLinearGradient(0, -25, 0, 25);
    tent.addColorStop(0, "#d2ded8");
    tent.addColorStop(1, "#6c8484");
    ctx.fillStyle = tent;
    roundedRect(ctx, -37, -28, 68, 51, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,191,107,.45)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(0, 22);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = "rgba(193,229,224,.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-8, -40);
    ctx.lineTo(-8, -112);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-8, -118, 8, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,190,104,.85)";
    ctx.beginPath();
    ctx.arc(-8, -118, 2.5, 0, TAU);
    ctx.fill();

    for (const [x, y] of [[-70, 28], [65, 25]]) {
      ctx.fillStyle = "#192b2e";
      ctx.fillRect(x - 2, y - 10, 4, 15);
      ctx.fillStyle = "#ffd08a";
      ctx.beginPath();
      ctx.arc(x, y - 12, 4, 0, TAU);
      ctx.fill();
      const light = ctx.createRadialGradient(x, y, 0, x, y, 34);
      light.addColorStop(0, "rgba(255,197,111,.18)");
      light.addColorStop(1, "rgba(255,197,111,0)");
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.arc(x, y, 34, 0, TAU);
      ctx.fill();
    }

    ctx.fillStyle = "rgba(226,251,246,.8)";
    ctx.font = '10px "Noto Sans SC", monospace';
    ctx.textAlign = "center";
    ctx.letterSpacing = "2px";
    ctx.fillText("CAMP / 岸基营地", 0, 72);
    ctx.restore();
  }

  drawSnowDrifts(ctx, random) {
    ctx.save();
    for (let index = 0; index < 48; index += 1) {
      const x = random() * WORLD.width;
      const y = 40 + random() * (WORLD.shoreY - 80);
      const angle = -0.25 + random() * 0.3;
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = `rgba(235,255,250,${0.025 + random() * 0.07})`;
      ctx.beginPath();
      ctx.ellipse(
        0,
        0,
        25 + random() * 85,
        4 + random() * 12,
        0,
        0,
        TAU,
      );
      ctx.fill();
      ctx.rotate(-angle);
      ctx.translate(-x, -y);
    }
    ctx.restore();
  }

  render(time) {
    const ctx = this.ctx;
    const game = this.game;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    const background = ctx.createLinearGradient(0, 0, 0, this.height);
    background.addColorStop(0, "#031016");
    background.addColorStop(1, "#061a20");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, this.width, this.height);

    const shakeX = game.camera.shake
      ? (Math.random() - 0.5) * game.camera.shake
      : 0;
    const shakeY = game.camera.shake
      ? (Math.random() - 0.5) * game.camera.shake
      : 0;
    ctx.save();
    ctx.translate(
      this.width / 2 + this.framingOffsetX + shakeX,
      this.height / 2 + shakeY,
    );
    ctx.scale(game.camera.zoom, game.camera.zoom);
    ctx.translate(-game.camera.x, -game.camera.y);

    ctx.drawImage(this.base, 0, 0);
    this.drawRoute(ctx, time);
    this.drawTracks(ctx);
    this.drawSites(ctx, time);
    this.drawCampBeacon(ctx, time);
    this.drawParticles(ctx);
    this.drawVehicle(ctx, time);
    if (game.mode === "drilling") {
      this.drawDrillRig(ctx, time);
    }
    ctx.restore();

    this.drawAtmosphere(ctx, time);
    this.drawEdgePointer(ctx);
  }

  drawRoute(ctx, time) {
    const route = this.game.route;
    if (!route || !route.points?.length || this.game.mode === "complete") return;
    if (this.game.mode === "drilling") return;
    const unsafe = route.violations.length > 0;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    route.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = unsafe
      ? "rgba(255,104,89,.14)"
      : "rgba(134,255,235,.12)";
    ctx.lineWidth = 13;
    ctx.stroke();

    ctx.setLineDash([11, 13]);
    ctx.lineDashOffset = -time * 0.025;
    ctx.strokeStyle = unsafe
      ? "rgba(255,129,100,.8)"
      : "rgba(158,255,239,.72)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);

    if (route.points.length > 2) {
      const middle = route.points[Math.floor(route.points.length / 2)];
      ctx.fillStyle = "rgba(4,20,25,.72)";
      ctx.beginPath();
      ctx.roundRect(middle.x - 48, middle.y - 10, 96, 19, 2);
      ctx.fill();
      ctx.fillStyle = "rgba(189,255,241,.8)";
      ctx.font = '8px "Noto Sans SC", monospace';
      ctx.textAlign = "center";
      ctx.fillText(
        unsafe ? "路线中断" : `SAFE ROUTE · ${route.length} m`,
        middle.x,
        middle.y + 3,
      );
    }
    ctx.restore();
  }

  drawTracks(ctx) {
    ctx.save();
    ctx.strokeStyle = "rgba(30,63,70,.22)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    for (const track of this.game.tracks) {
      ctx.globalAlpha = track.strength * 0.6;
      ctx.beginPath();
      ctx.moveTo(track.x, track.y);
      ctx.lineTo(
        track.x - Math.cos(track.angle) * 11,
        track.y - Math.sin(track.angle) * 11,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSites(ctx, time) {
    const game = this.game;
    for (let index = 0; index < game.sites.length; index += 1) {
      const site = game.sites[index];
      const active = index === game.activeSiteIndex;
      const locked = index > game.activeSiteIndex;
      const pulse = 0.5 + Math.sin(time * 0.003 + index * 1.9) * 0.5;
      ctx.save();
      ctx.translate(site.x, site.y);
      ctx.globalAlpha = site.done ? 0.68 : locked ? 0.34 : 1;

      if (active && !site.done) {
        const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 98);
        glow.addColorStop(0, "rgba(255,190,102,.15)");
        glow.addColorStop(0.55, "rgba(255,190,102,.045)");
        glow.addColorStop(1, "rgba(255,190,102,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, 98, 0, TAU);
        ctx.fill();

        ctx.strokeStyle = `rgba(255,195,112,${0.25 + pulse * 0.25})`;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 9]);
        ctx.lineDashOffset = -time * 0.02;
        ctx.beginPath();
        ctx.arc(0, 0, 82 + pulse * 7, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.strokeStyle = site.done
        ? "rgba(157,255,218,.55)"
        : active
          ? "rgba(255,197,112,.75)"
          : "rgba(165,224,222,.45)";
      ctx.lineWidth = 1.4;
      for (let quadrant = 0; quadrant < 4; quadrant += 1) {
        const start = quadrant * (Math.PI / 2) + 0.2;
        ctx.beginPath();
        ctx.arc(0, 0, site.radius + 8, start, start + 0.8);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(5,29,36,.5)";
      ctx.beginPath();
      ctx.arc(0, 0, 38, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = active
        ? "rgba(255,191,102,.65)"
        : "rgba(199,250,245,.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 31, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, TAU);
      ctx.stroke();

      ctx.strokeStyle = "rgba(210,255,250,.25)";
      ctx.beginPath();
      ctx.moveTo(-26, 0);
      ctx.lineTo(-10, 0);
      ctx.moveTo(10, 0);
      ctx.lineTo(26, 0);
      ctx.moveTo(0, -26);
      ctx.lineTo(0, -10);
      ctx.moveTo(0, 10);
      ctx.lineTo(0, 26);
      ctx.stroke();

      if (site.done) {
        ctx.strokeStyle = "rgba(162,255,218,.9)";
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(-9, 0);
        ctx.lineTo(-2, 8);
        ctx.lineTo(12, -10);
        ctx.stroke();
      } else {
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = active
          ? "rgba(255,192,105,.88)"
          : "rgba(218,246,242,.65)";
        ctx.beginPath();
        ctx.moveTo(0, 18);
        ctx.lineTo(-5, 26);
        ctx.lineTo(5, 26);
        ctx.closePath();
        ctx.fill();
        ctx.rotate(Math.PI / 2);
      }

      ctx.rotate(-0.03);
      ctx.fillStyle = "rgba(3,17,22,.78)";
      ctx.beginPath();
      ctx.roundRect(-45, -88, 90, 25, 3);
      ctx.fill();
      ctx.strokeStyle = active
        ? "rgba(255,192,108,.62)"
        : site.done
          ? "rgba(151,255,218,.38)"
          : "rgba(171,227,224,.22)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillStyle = active ? "#ffc77a" : "#c1dcdb";
      ctx.font = '600 9px "Noto Sans SC", monospace';
      ctx.fillText(`${site.id} / ${site.name}`, 0, -76);
      ctx.fillStyle = site.done ? "#8ef1c9" : "#617f83";
      ctx.font = '7px "Noto Sans SC", monospace';
      ctx.fillText(
        site.done ? `${STRATA[site.core].sample} · 已封装` : site.subtitle,
        0,
        -67,
      );
      ctx.restore();
    }
  }

  drawCampBeacon(ctx, time) {
    if (this.game.activeSiteIndex < this.game.sites.length) return;
    const pulse = 0.5 + Math.sin(time * 0.004) * 0.5;
    ctx.save();
    ctx.translate(CAMP.x, CAMP.y);
    ctx.strokeStyle = `rgba(142,255,212,${0.38 + pulse * 0.38})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 8]);
    ctx.lineDashOffset = -time * 0.04;
    ctx.beginPath();
    ctx.ellipse(0, 0, 95 + pulse * 12, 60 + pulse * 7, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(3,20,24,.8)";
    ctx.beginPath();
    ctx.roundRect(-52, 84, 104, 23, 3);
    ctx.fill();
    ctx.fillStyle = "#afffe1";
    ctx.font = '600 9px "Noto Sans SC", monospace';
    ctx.textAlign = "center";
    ctx.fillText("RETURN / 返航点", 0, 98);
    ctx.restore();
  }

  drawParticles(ctx) {
    ctx.save();
    for (const particle of this.game.particles) {
      const alpha = Math.max(0, particle.life / particle.maxLife);
      ctx.globalAlpha = Math.min(1, alpha * 1.2);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawVehicle(ctx, time) {
    const vehicle = this.game.vehicle;
    const load = vehicle.load;
    ctx.save();
    ctx.translate(vehicle.x, vehicle.y);
    ctx.rotate(vehicle.angle);

    ctx.fillStyle = "rgba(1,10,14,.35)";
    ctx.beginPath();
    ctx.ellipse(-4, 8, 54, 34, 0.1, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.rotate(0.03);
    ctx.strokeStyle = "rgba(156,225,222,.12)";
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.arc(0, 0, 78, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    if (this.game.mode === "driving") {
      for (const side of [-1, 1]) {
        const beam = ctx.createLinearGradient(43, 0, 168, 0);
        beam.addColorStop(0, "rgba(255,229,182,.16)");
        beam.addColorStop(1, "rgba(255,229,182,0)");
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(44, side * 12);
        ctx.lineTo(166, side * 48);
        ctx.lineTo(166, side * 16);
        ctx.closePath();
        ctx.fill();
      }
    }

    for (const side of [-1, 1]) {
      ctx.fillStyle = "#0b1c20";
      roundedRect(ctx, -38, side * 21 - 6.5, 76, 13, 4);
      ctx.fill();
      ctx.strokeStyle = "rgba(173,216,211,.16)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.strokeStyle = "rgba(142,192,189,.28)";
      for (let x = -33; x <= 33; x += 8) {
        ctx.beginPath();
        ctx.moveTo(x, side * 21 - 5);
        ctx.lineTo(x + 3, side * 21 + 5);
        ctx.stroke();
      }
      ctx.fillStyle = "#2a3b3d";
      ctx.fillRect(-13, side * 19 - 1.5, 20, 3);
    }

    const body = ctx.createLinearGradient(-38, -23, 42, 23);
    body.addColorStop(0, "#94734f");
    body.addColorStop(0.28, "#e0af72");
    body.addColorStop(0.7, "#c8874c");
    body.addColorStop(1, "#755436");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-38, -19);
    ctx.lineTo(20, -22);
    ctx.lineTo(42, -12);
    ctx.lineTo(42, 12);
    ctx.lineTo(20, 22);
    ctx.lineTo(-38, 19);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,230,184,.4)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "rgba(24,42,43,.58)";
    roundedRect(ctx, 11, -15, 23, 30, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(192,237,229,.2)";
    ctx.stroke();
    ctx.fillStyle = "rgba(106,214,213,.24)";
    ctx.beginPath();
    ctx.moveTo(14, -11);
    ctx.lineTo(31, -6);
    ctx.lineTo(31, 7);
    ctx.lineTo(14, 11);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(244,208,147,.62)";
    ctx.beginPath();
    ctx.arc(34, 0, 5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#e7fff8";
    ctx.beginPath();
    ctx.arc(34, 0, 2, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(-26, 0);
    ctx.fillStyle = "rgba(16,33,37,.92)";
    roundedRect(ctx, -18, -19, 31, 38, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(155,225,220,.25)";
    ctx.stroke();
    const coreColors = ["#d9faf5", "#68c3d4", "#345d75"];
    for (let index = 0; index < 3; index += 1) {
      const filled = index < load;
      ctx.fillStyle = filled
        ? coreColors[index]
        : "rgba(4,16,21,.72)";
      roundedRect(ctx, -14, -15 + index * 11, 23, 7, 2);
      ctx.fill();
      ctx.strokeStyle = filled
        ? "rgba(218,255,246,.56)"
        : "rgba(128,195,192,.15)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      if (filled) {
        ctx.fillStyle = "rgba(255,255,255,.4)";
        ctx.fillRect(-9, -14 + index * 11, 1, 5);
      }
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(227,198,151,.55)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-3, -16);
    ctx.lineTo(-3, 16);
    ctx.moveTo(6, -17);
    ctx.lineTo(6, 17);
    ctx.stroke();

    ctx.fillStyle = "rgba(7,28,33,.85)";
    ctx.beginPath();
    ctx.arc(-6, 0, 8, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(116,244,232,${0.45 + Math.sin(time * 0.004) * 0.2})`;
    ctx.beginPath();
    ctx.arc(-6, 0, 10, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "#8df7e6";
    ctx.beginPath();
    ctx.arc(-6, 0, 2, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "rgba(232,255,250,.55)";
    ctx.font = '6px "Noto Sans SC", monospace';
    ctx.textAlign = "center";
    ctx.fillText("CC-07", -19, 3);

    ctx.strokeStyle = "rgba(183,223,217,.68)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(30, -8);
    ctx.lineTo(30, -35);
    ctx.lineTo(19, -35);
    ctx.stroke();
    ctx.fillStyle = "#ffc06e";
    ctx.beginPath();
    ctx.arc(19, -35, 2.2, 0, TAU);
    ctx.fill();

    if (this.game.mode === "drilling") {
      ctx.strokeStyle = "rgba(132,244,234,.38)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(31, 0, 16 + Math.sin(time * 0.008) * 2, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawDrillRig(ctx, time) {
    const site = this.game.currentSite;
    if (!site) return;
    const drill = this.game.drilling;
    const rpmRatio = drill.rpm / DRILL.maxRpm;
    const torqueRatio = drill.torque / DRILL.maxTorque;
    const heatRatio = drill.heat / DRILL.maxHeat;
    const danger = Math.max(0, torqueRatio - 0.54);
    const spin = time * 0.015 * (0.3 + rpmRatio * 2.8);

    ctx.save();
    ctx.translate(site.x, site.y);

    const heatGlow = ctx.createRadialGradient(0, 0, 2, 0, 0, 62);
    heatGlow.addColorStop(
      0,
      `rgba(${255},${110 + heatRatio * 40},${70 + (1 - heatRatio) * 90},${0.08 + heatRatio * 0.18})`,
    );
    heatGlow.addColorStop(1, "rgba(255,118,80,0)");
    ctx.fillStyle = heatGlow;
    ctx.beginPath();
    ctx.arc(0, 0, 62, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "rgba(66,38,27,.8)";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    for (let index = 0; index < 3; index += 1) {
      const angle = -Math.PI / 2 + index * (TAU / 3) + 0.45;
      const x = Math.cos(angle) * 43;
      const y = Math.sin(angle) * 43;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x * 1.45, y * 1.45);
      ctx.stroke();
      ctx.fillStyle = "rgba(30,44,44,.9)";
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(225,183,123,.45)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = "rgba(66,38,27,.8)";
      ctx.lineWidth = 7;
    }

    ctx.fillStyle = "rgba(7,24,29,.94)";
    ctx.beginPath();
    ctx.arc(0, 0, 29, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = danger > 0.1 ? "#ff815c" : "rgba(255,193,108,.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 29, 0, TAU);
    ctx.stroke();

    ctx.save();
    ctx.rotate(spin);
    ctx.fillStyle = "rgba(208,230,222,.86)";
    for (let tooth = 0; tooth < 14; tooth += 1) {
      ctx.rotate(TAU / 14);
      ctx.beginPath();
      ctx.moveTo(15, -2.8);
      ctx.lineTo(26, 0);
      ctx.lineTo(15, 2.8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = danger > 0.1 ? "#ff735e" : "#ffd188";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "#17363b";
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#8ef9e6";
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (drill.jam) {
      ctx.strokeStyle = "rgba(255,91,80,.75)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 38, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = "#ff8b72";
      ctx.font = '600 10px "Noto Sans SC", monospace';
      ctx.textAlign = "center";
      ctx.fillText("DRILL JAMMED", 0, -43);
    }

    if (danger > 0) {
      ctx.strokeStyle = `rgba(255,124,93,${danger * 0.45})`;
      ctx.lineWidth = 1.2;
      for (let index = 0; index < 6; index += 1) {
        const angle = index * 1.17 + 0.2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * 32, Math.sin(angle) * 32);
        ctx.lineTo(
          Math.cos(angle) * (42 + danger * 24),
          Math.sin(angle) * (42 + danger * 24),
        );
        ctx.stroke();
      }
    }

    ctx.strokeStyle = "rgba(126,241,230,.36)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, 54 + Math.sin(time * 0.005) * 3, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    const vehicle = this.game.vehicle;
    ctx.save();
    ctx.strokeStyle = "rgba(160,232,221,.3)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(vehicle.x, vehicle.y);
    ctx.bezierCurveTo(
      vehicle.x + (site.x - vehicle.x) * 0.38,
      vehicle.y + 34,
      site.x + (vehicle.x - site.x) * 0.25,
      site.y + 38,
      site.x,
      site.y,
    );
    ctx.stroke();
    ctx.restore();
  }

  drawAtmosphere(ctx, time) {
    ctx.save();
    const seconds = time * 0.001;
    for (const flake of this.snowflakes) {
      const x =
        (((flake.x * this.width + seconds * flake.drift) % this.width) +
          this.width) %
        this.width;
      const y = (flake.y * this.height + seconds * flake.speed * 100) % this.height;
      ctx.strokeStyle = `rgba(220,255,249,${0.08 + flake.size * 0.04})`;
      ctx.lineWidth = flake.size * 0.55;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2 - flake.drift * 0.5, y + 5 + flake.size * 2);
      ctx.stroke();
    }

    const vignette = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      Math.min(this.width, this.height) * 0.35,
      this.width / 2,
      this.height / 2,
      Math.max(this.width, this.height) * 0.72,
    );
    vignette.addColorStop(0, "rgba(0,8,12,0)");
    vignette.addColorStop(0.7, "rgba(0,8,12,.12)");
    vignette.addColorStop(1, "rgba(0,6,10,.56)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);

    const topShade = ctx.createLinearGradient(0, 0, 0, 105);
    topShade.addColorStop(0, "rgba(1,10,15,.55)");
    topShade.addColorStop(1, "rgba(1,10,15,0)");
    ctx.fillStyle = topShade;
    ctx.fillRect(0, 0, this.width, 105);
    ctx.restore();
  }

  drawEdgePointer(ctx) {
    const game = this.game;
    if (game.mode === "title" || game.mode === "complete" || !game.objective) {
      return;
    }
    const objective = game.objective;
    const sx =
      (objective.x - game.camera.x) * game.camera.zoom +
      this.width / 2 +
      this.framingOffsetX;
    const sy =
      (objective.y - game.camera.y) * game.camera.zoom + this.height / 2;
    const margin = 72;
    if (
      sx > margin &&
      sx < this.width - margin &&
      sy > margin &&
      sy < this.height - margin
    ) {
      return;
    }
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const angle = Math.atan2(sy - centerY, sx - centerX);
    const radiusX = this.width / 2 - margin;
    const radiusY = this.height / 2 - margin;
    const scale = Math.min(
      Math.abs(radiusX / Math.cos(angle)),
      Math.abs(radiusY / Math.sin(angle)),
    );
    const px = centerX + Math.cos(angle) * scale;
    const py = centerY + Math.sin(angle) * scale;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = "rgba(255,191,104,.9)";
    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.lineTo(-7, -3);
    ctx.lineTo(7, -3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(px, py + 22);
    ctx.fillStyle = "rgba(4,18,23,.8)";
    ctx.beginPath();
    ctx.roundRect(-58, -10, 116, 20, 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,191,104,.38)";
    ctx.stroke();
    ctx.fillStyle = "#ffc778";
    ctx.font = '8px "Noto Sans SC", monospace';
    ctx.textAlign = "center";
    ctx.fillText(
      objective.type === "camp" ? "RETURN TO CAMP" : `${objective.id} ${objective.name}`,
      0,
      3,
    );
    ctx.restore();
  }
}
