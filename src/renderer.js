(function (root) {
  "use strict";

  const DATA = root.TestShipData;

  function easeInOut(value) {
    return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function pointOnPolyline(points, amount) {
    if (points.length === 1) return { ...points[0] };
    const lengths = [];
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      const distance = Math.hypot(
        points[index].x - points[index - 1].x,
        points[index].y - points[index - 1].y,
      );
      lengths.push(distance);
      total += distance;
    }
    let remaining = Math.max(0, Math.min(1, amount)) * total;
    for (let index = 1; index < points.length; index += 1) {
      const segment = lengths[index - 1];
      if (remaining <= segment || index === points.length - 1) {
        const ratio = segment ? remaining / segment : 0;
        return {
          x: lerp(points[index - 1].x, points[index].x, ratio),
          y: lerp(points[index - 1].y, points[index].y, ratio),
        };
      }
      remaining -= segment;
    }
    return { ...points[points.length - 1] };
  }

  class ShipRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.width = 0;
      this.height = 0;
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      this.stars = this.makeStars(118);
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas.parentElement);
      this.resize();
    }

    makeStars(count) {
      let seed = 7919;
      const random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
      return Array.from({ length: count }, () => ({
        x: random() * 1000,
        y: random() * 600,
        radius: 0.35 + random() * 1.05,
        alpha: 0.13 + random() * 0.54,
        phase: random() * Math.PI * 2,
      }));
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      this.width = Math.max(1, rect.width);
      this.height = Math.max(1, rect.height);
      this.canvas.width = Math.round(this.width * dpr);
      this.canvas.height = Math.round(this.height * dpr);
      this.dpr = dpr;
      this.scale = Math.min(this.width / 1000, this.height / 600);
      this.offsetX = (this.width - 1000 * this.scale) / 2;
      this.offsetY = (this.height - 600 * this.scale) / 2;
    }

    hullPath(ctx) {
      const { x, y, w, h, cut } = DATA.HULL;
      ctx.beginPath();
      ctx.moveTo(x + cut, y);
      ctx.lineTo(x + w - cut, y);
      ctx.lineTo(x + w, y + cut);
      ctx.lineTo(x + w, y + h - cut);
      ctx.lineTo(x + w - cut, y + h);
      ctx.lineTo(x + cut, y + h);
      ctx.lineTo(x, y + h - cut);
      ctx.lineTo(x, y + cut);
      ctx.closePath();
    }

    roundedRect(ctx, x, y, w, h, radius) {
      const r = Math.min(radius, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    render(snapshot, stamp) {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const dpr = this.dpr || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.save();
      ctx.translate(this.offsetX, this.offsetY);
      ctx.scale(this.scale, this.scale);

      this.drawSpace(ctx, snapshot, stamp);
      this.drawHull(ctx, snapshot, stamp);
      this.drawCorridors(ctx, snapshot);
      DATA.CABINS.forEach((cabin, index) => {
        this.drawCabin(ctx, cabin, snapshot, stamp, index);
      });
      this.drawHub(ctx, snapshot, stamp);
      DATA.CABINS.forEach((cabin) => this.drawAirlock(ctx, cabin, snapshot, stamp));
      this.drawRoutes(ctx, snapshot);
      (snapshot.robots || []).forEach((robot) => this.drawRobot(ctx, robot, stamp));
      this.drawHud(ctx, snapshot, stamp);
      ctx.restore();
    }

    drawSpace(ctx, snapshot, stamp) {
      const bg = ctx.createLinearGradient(0, 0, 0, 600);
      bg.addColorStop(0, "rgba(2, 10, 14, 0.1)");
      bg.addColorStop(0.5, "rgba(5, 19, 24, 0.35)");
      bg.addColorStop(1, "rgba(1, 8, 11, 0.7)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 1000, 600);

      const glow = ctx.createRadialGradient(500, 300, 50, 500, 300, 470);
      glow.addColorStop(0, "rgba(36, 114, 121, 0.12)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, 1000, 600);

      this.stars.forEach((star) => {
        const twinkle = 0.55 + Math.sin(stamp * 0.0007 + star.phase) * 0.35;
        ctx.globalAlpha = star.alpha * twinkle;
        ctx.fillStyle = star.radius > 0.9 ? "#bdf8ed" : "#b3d5df";
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      const sweep = 100 + ((stamp * 0.018) % 850);
      const scan = ctx.createLinearGradient(sweep - 90, 0, sweep, 0);
      scan.addColorStop(0, "rgba(82, 204, 210, 0)");
      scan.addColorStop(1, "rgba(82, 204, 210, 0.032)");
      ctx.fillStyle = scan;
      ctx.fillRect(sweep - 90, 0, 90, 600);

      ctx.strokeStyle = "rgba(105, 176, 183, 0.04)";
      ctx.lineWidth = 0.5;
      for (let x = 50; x <= 950; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 42);
        ctx.lineTo(x, 558);
        ctx.stroke();
      }
      for (let y = 42; y <= 558; y += 50) {
        ctx.beginPath();
        ctx.moveTo(32, y);
        ctx.lineTo(968, y);
        ctx.stroke();
      }
    }

    drawHull(ctx, snapshot, stamp) {
      ctx.save();
      this.hullPath(ctx);
      ctx.fillStyle = "rgba(10, 28, 35, 0.58)";
      ctx.fill();
      ctx.shadowBlur = 22;
      ctx.shadowColor = snapshot.running
        ? "rgba(98, 239, 209, 0.23)"
        : "rgba(91, 201, 245, 0.13)";
      ctx.strokeStyle = snapshot.running
        ? "rgba(116, 246, 220, 0.64)"
        : "rgba(113, 199, 209, 0.42)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.save();
      this.hullPath(ctx);
      ctx.clip();
      ctx.strokeStyle = "rgba(127, 207, 210, 0.08)";
      ctx.lineWidth = 0.6;
      for (let x = -420; x < 1100; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, 40);
        ctx.lineTo(x + 500, 560);
        ctx.stroke();
      }
      const hullGlow = ctx.createLinearGradient(0, 62, 0, 538);
      hullGlow.addColorStop(0, "rgba(53, 124, 132, 0.08)");
      hullGlow.addColorStop(0.5, "rgba(41, 103, 113, 0.02)");
      hullGlow.addColorStop(1, "rgba(1, 8, 11, 0.24)");
      ctx.fillStyle = hullGlow;
      ctx.fillRect(0, 0, 1000, 600);
      ctx.restore();

      ctx.lineWidth = 0.7;
      ctx.strokeStyle = "rgba(118, 214, 207, 0.2)";
      ctx.beginPath();
      ctx.moveTo(75, 90);
      ctx.lineTo(925, 90);
      ctx.moveTo(75, 510);
      ctx.lineTo(925, 510);
      ctx.stroke();

      ctx.font = "8px 'SFMono-Regular', Consolas, monospace";
      ctx.fillStyle = "rgba(158, 207, 204, 0.45)";
      ctx.fillText("T-09 / EXPERIMENTAL PRESSURE HULL", 82, 82);
      ctx.fillText("DECK 07 · SECTION A—A", 82, 526);
      ctx.textAlign = "right";
      ctx.fillText("CERTIFICATION LOADOUT 04", 915, 526);
      ctx.textAlign = "left";

      const pulse = 0.6 + Math.sin(stamp * 0.003) * 0.25;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = "#62efd1";
      [68, 932].forEach((x) => {
        ctx.beginPath();
        ctx.arc(x, 300, 2.2, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    drawCorridors(ctx, snapshot) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      Object.entries(DATA.CORRIDOR_PATHS).forEach(([cabinId, points]) => {
        const active = snapshot.activeCabinIds && snapshot.activeCabinIds.includes(cabinId);
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.bezierCurveTo(
          points[1].x,
          points[1].y,
          points[2].x,
          points[2].y,
          points[3].x,
          points[3].y,
        );
        ctx.strokeStyle = active
          ? "rgba(98, 239, 209, 0.56)"
          : "rgba(76, 156, 166, 0.19)";
        ctx.lineWidth = active ? 4.5 : 3;
        if (active) {
          ctx.shadowBlur = 13;
          ctx.shadowColor = "rgba(98, 239, 209, 0.5)";
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = active
          ? "rgba(221, 255, 247, 0.52)"
          : "rgba(124, 188, 193, 0.12)";
        ctx.lineWidth = 0.75;
        ctx.stroke();
      });
      ctx.restore();
    }

    drawCabin(ctx, cabin, snapshot, stamp, index) {
      const state = (snapshot.cabins && snapshot.cabins[cabin.id]) || {};
      const room = cabin.room;
      const active = Boolean(state.active);
      const complete = Boolean(state.complete);
      const low = (state.pressure ?? cabin.pressure) < 0.5;

      ctx.save();
      this.roundedRect(ctx, room.x, room.y, room.w, room.h, 4);
      const fill = ctx.createLinearGradient(room.x, room.y, room.x, room.y + room.h);
      fill.addColorStop(0, active ? "rgba(21, 61, 68, 0.82)" : "rgba(10, 34, 41, 0.76)");
      fill.addColorStop(1, "rgba(4, 18, 24, 0.88)");
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = active
        ? "rgba(98, 239, 209, 0.65)"
        : complete
          ? "rgba(98, 239, 209, 0.33)"
          : "rgba(91, 173, 184, 0.24)";
      ctx.lineWidth = active ? 1.2 : 0.8;
      if (active) {
        ctx.shadowBlur = 15;
        ctx.shadowColor = "rgba(98, 239, 209, 0.24)";
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      this.roundedRect(ctx, room.x, room.y, room.w, room.h, 4);
      ctx.clip();
      ctx.strokeStyle = "rgba(119, 196, 201, 0.07)";
      ctx.lineWidth = 0.5;
      for (let x = room.x + 15; x < room.x + room.w; x += 17) {
        ctx.beginPath();
        ctx.moveTo(x, room.y);
        ctx.lineTo(x, room.y + room.h);
        ctx.stroke();
      }
      for (let y = room.y + 16; y < room.y + room.h; y += 17) {
        ctx.beginPath();
        ctx.moveTo(room.x, y);
        ctx.lineTo(room.x + room.w, y);
        ctx.stroke();
      }
      this.drawCabinEquipment(ctx, cabin.id, room, stamp);
      ctx.restore();

      ctx.save();
      this.roundedRect(ctx, room.x, room.y, room.w, room.h, 4);
      ctx.clip();
      ctx.fillStyle = "rgba(4, 15, 20, 0.72)";
      ctx.fillRect(room.x + 9, room.y + 9, 103, 23);
      ctx.font = "600 15px 'SFMono-Regular', Consolas, monospace";
      ctx.fillStyle = low ? DATA.COLORS.amber : active ? DATA.COLORS.mint : "#b7d5d4";
      ctx.fillText(cabin.code, room.x + 18, room.y + 26);
      ctx.font = "10px 'Noto Sans SC', 'PingFang SC', sans-serif";
      ctx.fillStyle = "#c4dad8";
      ctx.fillText(cabin.name, room.x + 40, room.y + 25);
      ctx.font = "6px 'SFMono-Regular', Consolas, monospace";
      ctx.fillStyle = "rgba(133, 175, 177, 0.58)";
      ctx.fillText(cabin.english, room.x + 40, room.y + 33);
      ctx.restore();

      this.drawPressureGauge(
        ctx,
        room.x + room.w - 45,
        room.y + 13,
        state.pressure ?? cabin.pressure,
        active,
      );

      if (state.phaseLabel) {
        ctx.font = "7px 'SFMono-Regular', Consolas, monospace";
        ctx.fillStyle = active ? DATA.COLORS.mint : "rgba(153, 193, 192, 0.68)";
        ctx.textAlign = "center";
        ctx.fillText(state.phaseLabel, room.x + room.w / 2, room.y + room.h - 9);
        ctx.textAlign = "left";
      }
      if (complete) {
        ctx.fillStyle = "rgba(98, 239, 209, 0.8)";
        ctx.font = "8px 'SFMono-Regular', Consolas, monospace";
        ctx.textAlign = "right";
        ctx.fillText("✓ DONE", room.x + room.w - 11, room.y + room.h - 10);
        ctx.textAlign = "left";
      }
    }

    drawCabinEquipment(ctx, cabinId, room, stamp) {
      const cx = room.x + room.w * 0.55;
      const cy = room.y + room.h * 0.56;
      ctx.globalAlpha = 0.72;

      if (cabinId === "obs") {
        ctx.strokeStyle = "rgba(91, 201, 245, 0.52)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(room.x + room.w * 0.7, room.y + room.h * 0.62, 41, Math.PI * 0.8, Math.PI * 2.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(room.x + room.w * 0.7, room.y + room.h * 0.62, 29, Math.PI * 0.82, Math.PI * 2.18);
        ctx.stroke();
        ctx.strokeStyle = "rgba(98, 239, 209, 0.32)";
        ctx.beginPath();
        ctx.moveTo(room.x + room.w * 0.7, room.y + room.h * 0.62);
        ctx.lineTo(room.x + room.w * 0.48, room.y + room.h * 0.36);
        ctx.stroke();
        ctx.fillStyle = "rgba(91, 201, 245, 0.28)";
        for (let i = 0; i < 7; i += 1) {
          const angle = i * 1.37 + stamp * 0.0001;
          const radius = 18 + (i % 3) * 8;
          ctx.beginPath();
          ctx.arc(
            room.x + room.w * 0.7 + Math.cos(angle) * radius,
            room.y + room.h * 0.62 + Math.sin(angle) * radius,
            0.9,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }

      if (cabinId === "bio") {
        ctx.strokeStyle = "rgba(255, 189, 98, 0.42)";
        ctx.lineWidth = 0.7;
        for (let index = 0; index < 3; index += 1) {
          const x = room.x + 105 + index * 34;
          ctx.beginPath();
          ctx.roundRect(x, room.y + 61, 20, 48, 8);
          ctx.stroke();
          ctx.fillStyle = "rgba(255, 189, 98, 0.12)";
          ctx.fill();
          ctx.fillStyle = "rgba(255, 189, 98, 0.56)";
          ctx.fillRect(x + 4, room.y + 68 + index * 3, 12, 1);
        }
        ctx.strokeStyle = "rgba(98, 239, 209, 0.28)";
        ctx.beginPath();
        for (let index = 0; index < 28; index += 1) {
          const angle = index * 0.42;
          const x = room.x + 238 + Math.sin(angle) * 12;
          const y = room.y + 55 + index * 2.4;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      if (cabinId === "cargo") {
        const boxes = [
          [96, 58, 50, 42],
          [153, 63, 58, 37],
          [102, 108, 61, 32],
        ];
        boxes.forEach(([x, y, w, h], index) => {
          ctx.fillStyle = "rgba(91, 201, 245, 0.06)";
          ctx.strokeStyle = "rgba(126, 198, 205, 0.27)";
          ctx.lineWidth = 0.7;
          ctx.fillRect(room.x + x, room.y + y, w, h);
          ctx.strokeRect(room.x + x, room.y + y, w, h);
          ctx.strokeStyle = "rgba(255, 189, 98, 0.3)";
          ctx.beginPath();
          ctx.moveTo(room.x + x + 6, room.y + y + 7);
          ctx.lineTo(room.x + x + w - 6, room.y + y + h - 7);
          ctx.stroke();
          ctx.font = "6px 'SFMono-Regular', Consolas, monospace";
          ctx.fillStyle = "rgba(148, 181, 184, 0.5)";
          ctx.fillText(`C${index + 1} / SEALED`, room.x + x + 5, room.y + y + h - 4);
        });
      }

      if (cabinId === "engine") {
        ctx.strokeStyle = "rgba(255, 189, 98, 0.38)";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(cx + 38, cy + 2, 35, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + 38, cy + 2, 23, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "rgba(98, 239, 209, 0.3)";
        for (let index = 0; index < 5; index += 1) {
          ctx.beginPath();
          ctx.arc(cx + 38, cy + 2, 29, index * 1.25, index * 1.25 + 0.72);
          ctx.stroke();
        }
        const rotor = stamp * 0.0015;
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = "rgba(255, 189, 98, 0.55)";
        ctx.beginPath();
        ctx.moveTo(cx + 38 + Math.cos(rotor) * 25, cy + 2 + Math.sin(rotor) * 25);
        ctx.lineTo(cx + 38 + Math.cos(rotor + 2.5) * 25, cy + 2 + Math.sin(rotor + 2.5) * 25);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
    }

    drawPressureGauge(ctx, x, y, pressure, active) {
      const ratio = Math.max(0, Math.min(1, pressure));
      const low = pressure < 0.5;
      ctx.save();
      ctx.fillStyle = "rgba(3, 13, 17, 0.65)";
      ctx.fillRect(x, y, 34, 18);
      ctx.strokeStyle = low ? "rgba(255, 189, 98, 0.4)" : "rgba(98, 239, 209, 0.24)";
      ctx.lineWidth = 0.6;
      ctx.strokeRect(x, y, 34, 18);
      ctx.fillStyle = low ? DATA.COLORS.amber : active ? DATA.COLORS.mint : "#8bb9b7";
      ctx.fillRect(x + 3, y + 14 - ratio * 10, 16, Math.max(1, ratio * 10));
      ctx.font = "7px 'SFMono-Regular', Consolas, monospace";
      ctx.textAlign = "right";
      ctx.fillText(pressure.toFixed(2), x + 31, y + 11);
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(133, 171, 173, 0.55)";
      ctx.font = "5px 'SFMono-Regular', Consolas, monospace";
      ctx.fillText("BAR", x + 3, y + 17);
      ctx.restore();
    }

    drawHub(ctx, snapshot, stamp) {
      const hub = DATA.HUB;
      ctx.save();
      this.roundedRect(ctx, hub.x, hub.y, hub.w, hub.h, 8);
      const fill = ctx.createRadialGradient(
        hub.center.x,
        hub.center.y,
        4,
        hub.center.x,
        hub.center.y,
        90,
      );
      fill.addColorStop(0, "rgba(41, 105, 108, 0.34)");
      fill.addColorStop(1, "rgba(7, 25, 31, 0.92)");
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = "rgba(98, 239, 209, 0.38)";
      ctx.lineWidth = 0.9;
      ctx.stroke();

      ctx.strokeStyle = "rgba(91, 201, 245, 0.15)";
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.arc(hub.center.x, hub.center.y, 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hub.center.x, hub.center.y, 24, 0, Math.PI * 2);
      ctx.stroke();

      ctx.setLineDash([3, 6]);
      ctx.lineDashOffset = -stamp * 0.012;
      ctx.strokeStyle = "rgba(98, 239, 209, 0.22)";
      ctx.beginPath();
      ctx.arc(hub.center.x, hub.center.y, 43, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      [
        [hub.dockOne, "01"],
        [hub.dockTwo, "02"],
      ].forEach(([dock, label], index) => {
        const occupied = (snapshot.robots || []).some(
          (robot) => Math.hypot(robot.x - dock.x, robot.y - dock.y) < 11,
        );
        ctx.strokeStyle = occupied
          ? index === 0
            ? "rgba(255, 189, 98, 0.7)"
            : "rgba(91, 201, 245, 0.7)"
          : "rgba(105, 158, 163, 0.27)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(dock.x, dock.y, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "rgba(126, 186, 190, 0.2)";
        for (let spoke = 0; spoke < 4; spoke += 1) {
          const angle = (spoke / 4) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(dock.x + Math.cos(angle) * 9, dock.y + Math.sin(angle) * 9);
          ctx.lineTo(dock.x + Math.cos(angle) * 12, dock.y + Math.sin(angle) * 12);
          ctx.stroke();
        }
        ctx.font = "5px 'SFMono-Regular', Consolas, monospace";
        ctx.fillStyle = "rgba(143, 184, 184, 0.5)";
        ctx.fillText(label, dock.x + 10, dock.y + 11);
      });

      ctx.font = "6px 'SFMono-Regular', Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(146, 192, 190, 0.55)";
      ctx.fillText("DOCK HUB / 1.00 BAR", hub.center.x, hub.y + hub.h - 8);
      ctx.textAlign = "left";
      ctx.restore();
    }

    drawAirlock(ctx, cabin, snapshot, stamp) {
      const lock = cabin.lock;
      const state = (snapshot.cabins && snapshot.cabins[cabin.id]) || {};
      const active = Boolean(state.active);
      const isLeft = cabin.room.x < 500;
      const innerOpen = state.innerOpen || 0;
      const outerOpen = state.outerOpen || 0;
      const lockPressure = state.lockPressure ?? 1;
      const targetPressure = state.pressure ?? cabin.pressure;
      const equalizing = Boolean(state.equalizing);

      ctx.save();
      this.roundedRect(ctx, lock.x, lock.y, lock.w, lock.h, 2);
      ctx.fillStyle = active ? "rgba(22, 55, 58, 0.92)" : "rgba(8, 27, 32, 0.88)";
      ctx.fill();
      ctx.strokeStyle = active ? "rgba(98, 239, 209, 0.45)" : "rgba(104, 168, 173, 0.25)";
      ctx.lineWidth = 0.65;
      ctx.stroke();

      ctx.strokeStyle = "rgba(117, 192, 194, 0.1)";
      ctx.lineWidth = 0.5;
      for (let index = 0; index < 10; index += 1) {
        ctx.beginPath();
        ctx.moveTo(lock.x + 4 + index * 5.5, lock.y + 4);
        ctx.lineTo(lock.x + 1 + index * 5.5, lock.y + lock.h - 4);
        ctx.stroke();
      }

      const innerX = isLeft ? lock.x + 4 : lock.x + lock.w - 4;
      const outerX = isLeft ? lock.x + lock.w - 4 : lock.x + 4;
      const drawDoor = (x, open, side) => {
        const travel = 5 + open * (lock.h * 0.33);
        ctx.fillStyle =
          open > 0.78
            ? "rgba(98, 239, 209, 0.76)"
            : active
              ? "rgba(255, 189, 98, 0.72)"
              : "rgba(112, 173, 178, 0.5)";
        ctx.fillRect(x - 1.3, lock.y + 3, 2.6, lock.h / 2 - travel);
        ctx.fillRect(x - 1.3, lock.y + lock.h / 2 + travel, 2.6, lock.h / 2 - travel);
        ctx.strokeStyle = "rgba(91, 201, 245, 0.13)";
        ctx.beginPath();
        ctx.moveTo(x + side * 2.2, lock.y + lock.h / 2 - travel);
        ctx.lineTo(x + side * 2.2, lock.y + lock.h / 2 + travel);
        ctx.stroke();
        ctx.fillStyle = open > 0.78 ? DATA.COLORS.mint : "rgba(255, 189, 98, 0.65)";
        ctx.beginPath();
        ctx.arc(x, lock.y + lock.h / 2, 2.3, 0, Math.PI * 2);
        ctx.fill();
      };
      drawDoor(innerX, innerOpen, isLeft ? 1 : -1);
      drawDoor(outerX, outerOpen, isLeft ? -1 : 1);

      if (equalizing) {
        const phase = (stamp * 0.006) % (Math.PI * 2);
        ctx.strokeStyle = "rgba(98, 239, 209, 0.75)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(
          lock.x + lock.w / 2,
          lock.y + lock.h / 2,
          8,
          phase,
          phase + Math.PI * 0.8,
        );
        ctx.stroke();
      }

      ctx.font = "5px 'SFMono-Regular', Consolas, monospace";
      ctx.fillStyle = "rgba(139, 181, 181, 0.55)";
      ctx.textAlign = "center";
      ctx.fillText(
        `AIR ${lockPressure.toFixed(2)} → ${targetPressure.toFixed(2)}`,
        lock.x + lock.w / 2,
        lock.y + lock.h + 8,
      );
      ctx.fillText(`LOCK ${cabin.code}`, lock.x + lock.w / 2, lock.y - 4);
      ctx.textAlign = "left";
      ctx.restore();
    }

    drawRoutes(ctx, snapshot) {
      DATA.CABINS.forEach((cabin) => {
        const active = snapshot.activeCabinIds && snapshot.activeCabinIds.includes(cabin.id);
        const complete =
          snapshot.completedCabinIds && snapshot.completedCabinIds.includes(cabin.id);
        if (!active && !complete && !snapshot.showAllRoutes) return;
        const path = DATA.CORRIDOR_PATHS[cabin.id];
        const points = [
          ...path,
          cabin.lock.outer,
          cabin.lock.inner,
          cabin.workPoint,
        ];
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
          const previous = points[index - 1];
          const current = points[index];
          if (index < 4) {
            const control = path[Math.min(index, 2)];
            ctx.quadraticCurveTo(control.x, control.y, current.x, current.y);
          } else {
            ctx.lineTo(current.x, current.y);
          }
          if (previous === current) continue;
        }
        ctx.strokeStyle = active
          ? "rgba(98, 239, 209, 0.34)"
          : complete
            ? "rgba(98, 239, 209, 0.12)"
            : "rgba(91, 201, 245, 0.06)";
        ctx.lineWidth = active ? 7 : 4;
        if (active) {
          ctx.shadowBlur = 10;
          ctx.shadowColor = "rgba(98, 239, 209, 0.3)";
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.setLineDash(active ? [] : [3, 7]);
        ctx.strokeStyle = active
          ? "rgba(202, 255, 242, 0.7)"
          : complete
            ? "rgba(98, 239, 209, 0.28)"
            : "rgba(111, 192, 197, 0.15)";
        ctx.lineWidth = 0.7;
        ctx.stroke();
        ctx.restore();
      });
    }

    drawRobot(ctx, robot, stamp) {
      const color = robot.color || DATA.COLORS.amber;
      ctx.save();
      if (robot.trail && robot.trail.length > 1) {
        robot.trail.forEach((point, index) => {
          if (index === 0) return;
          const previous = robot.trail[index - 1];
          const alpha = (index / robot.trail.length) * 0.38;
          ctx.strokeStyle = color;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = 1.1 + (index / robot.trail.length) * 1.5;
          ctx.beginPath();
          ctx.moveTo(previous.x, previous.y);
          ctx.lineTo(point.x, point.y);
          ctx.stroke();
        });
      }
      ctx.globalAlpha = 1;

      if (robot.active) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.48;
        ctx.lineWidth = 0.8;
        const rotation = stamp * 0.0032;
        ctx.beginPath();
        ctx.arc(robot.x, robot.y, 14, rotation, rotation + Math.PI * 1.24);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.translate(robot.x, robot.y);
      ctx.rotate(robot.angle || 0);
      ctx.fillStyle = "rgba(3, 11, 14, 0.96)";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.globalAlpha = robot.active ? 0.85 : 0.55;
      ctx.fillRect(-7, -9, 14, 3);
      ctx.fillRect(-7, 6, 14, 3);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#061419";
      ctx.fillRect(-9, -8.5, 2, 2);
      ctx.fillRect(7, -8.5, 2, 2);
      ctx.fillRect(-9, 6.5, 2, 2);
      ctx.fillRect(7, 6.5, 2, 2);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(229, 255, 250, 0.82)";
      ctx.beginPath();
      ctx.arc(1.5, -0.5, 1.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.72;
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(12, 0);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();

      ctx.save();
      ctx.font = "6px 'SFMono-Regular', Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = color;
      ctx.globalAlpha = robot.active ? 0.9 : 0.56;
      ctx.fillText(robot.label || "R-01", robot.x, robot.y - 13);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    drawHud(ctx, snapshot, stamp) {
      ctx.save();
      ctx.font = "6px 'SFMono-Regular', Consolas, monospace";
      ctx.fillStyle = "rgba(137, 188, 187, 0.58)";
      ctx.fillText("TELEMETRY / 4 CABINS / 2 TREAD ROBOTS", 33, 27);
      ctx.fillText("INTERLOCK: HATCH OPEN REQUIRES ΔP ≤ 0.015 BAR", 33, 37);

      const complete = snapshot.complete;
      const running = snapshot.running;
      ctx.textAlign = "right";
      ctx.fillStyle = complete
        ? "rgba(98, 239, 209, 0.82)"
        : running
          ? "rgba(255, 189, 98, 0.85)"
          : "rgba(132, 177, 179, 0.58)";
      ctx.fillText(
        complete ? "CERTIFIED / 6 OF 6 / 0 ACCIDENTS" : running ? "LIVE SORTIE" : "ARCHIVE READY",
        967,
        27,
      );
      ctx.textAlign = "left";

      ctx.strokeStyle = "rgba(113, 190, 193, 0.2)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(33, 577);
      ctx.lineTo(967, 577);
      ctx.stroke();

      const legend = [
        [DATA.COLORS.amber, "R-01"],
        [DATA.COLORS.cyan, "R-02"],
        [DATA.COLORS.mint, "PRESSURE SAFE"],
        [DATA.COLORS.pale, "VACUUM TARGET"],
      ];
      let x = 33;
      legend.forEach(([color, text]) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, 589, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(141, 183, 183, 0.6)";
        ctx.fillText(text, x + 6, 591);
        x += 23 + text.length * 3.9;
      });

      const sweep = 0.4 + Math.sin(stamp * 0.002) * 0.2;
      ctx.globalAlpha = sweep;
      ctx.fillStyle = "#62efd1";
      ctx.fillRect(945, 584, 4, 1);
      ctx.fillRect(952, 584, 4, 1);
      ctx.fillRect(959, 584, 4, 1);
      ctx.globalAlpha = 1;
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(132, 176, 177, 0.5)";
      ctx.fillText("0              5 M              10 M", 861, 591);
      ctx.strokeStyle = "rgba(123, 181, 183, 0.4)";
      ctx.beginPath();
      ctx.moveTo(786, 586);
      ctx.lineTo(857, 586);
      ctx.moveTo(786, 583);
      ctx.lineTo(786, 589);
      ctx.moveTo(821, 584);
      ctx.lineTo(821, 588);
      ctx.moveTo(857, 583);
      ctx.lineTo(857, 589);
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.restore();
    }
  }

  root.ShipRenderer = ShipRenderer;
})(typeof globalThis !== "undefined" ? globalThis : this);
