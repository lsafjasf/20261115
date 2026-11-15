import { currentAt, mulberry32, WORLD } from "./world.js";
import { CHECKPOINT_RADIUS, FLEET } from "./simulation.js";

const TAU = Math.PI * 2;

export class OceanRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.clock = 0;
    this.particles = [];
    this.worldSeed = null;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(320, rect.width);
    this.height = Math.max(300, rect.height);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = Math.min(this.width / WORLD.width, this.height / WORLD.height);
    this.offsetX = (this.width - WORLD.width * this.scale) / 2;
    this.offsetY = (this.height - WORLD.height * this.scale) / 2;
  }

  pointerPosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - this.offsetX) / this.scale,
      y: (event.clientY - rect.top - this.offsetY) / this.scale
    };
  }

  primeParticles(world) {
    if (this.worldSeed === world.seed && this.particles.length) return;
    this.worldSeed = world.seed;
    const random = mulberry32(world.seed ^ 0x91e10da5);
    this.particles = Array.from({ length: 132 }, () => ({
      x: 35 + random() * (WORLD.width - 70),
      y: 35 + random() * (WORLD.height - 70),
      age: random() * 8,
      life: 2.5 + random() * 4.5,
      tone: random()
    }));
  }

  map(x, y) {
    return {
      x: this.offsetX + x * this.scale,
      y: this.offsetY + y * this.scale
    };
  }

  draw(run, frameIndex, options = {}) {
    const context = this.context;
    const frame = run.frames[Math.min(frameIndex, run.frames.length - 1)];
    const delta = options.delta ?? 0;
    this.clock += delta;
    this.primeParticles(run.world);
    context.clearRect(0, 0, this.width, this.height);
    this.drawOcean(run.world, frame);
    this.drawCurrentField(run.world, frame.time);
    this.drawParticles(run.world, delta);
    this.drawRoute(run.world, frame);
    this.drawObstacles(run.world);
    this.drawCheckpoints(run.world, frame);
    if (options.overlayRun) this.drawGhost(run, options.overlayRun);
    this.drawTrails(run, frame);
    this.drawCollisionEchoes(run, frame);
    this.drawBoats(run.world, frame);
    this.drawVignette();
  }

  drawOcean(world, frame) {
    const context = this.context;
    const gradient = context.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, "#071a2c");
    gradient.addColorStop(0.5, "#061d28");
    gradient.addColorStop(1, "#03131c");
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.width, this.height);

    context.save();
    context.translate(this.offsetX, this.offsetY);
    context.scale(this.scale, this.scale);
    context.strokeStyle = "rgba(106, 206, 216, 0.055)";
    context.lineWidth = 1 / this.scale;
    for (let x = 0; x <= WORLD.width; x += 40) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, WORLD.height);
      context.stroke();
    }
    for (let y = 0; y <= WORLD.height; y += 40) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(WORLD.width, y);
      context.stroke();
    }
    context.restore();

    const glow = context.createRadialGradient(
      this.width * 0.48, this.height * 0.4, 20,
      this.width * 0.48, this.height * 0.4, this.width * 0.62
    );
    glow.addColorStop(0, "rgba(30, 114, 131, 0.13)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, this.width, this.height);
  }

  drawCurrentField(world, time) {
    const context = this.context;
    context.save();
    context.lineCap = "round";
    for (let y = 54; y < WORLD.height; y += 67) {
      for (let x = 52; x < WORLD.width; x += 75) {
        const current = currentAt(world, x, y, time);
        const strength = Math.min(current.strength / 42, 1);
        const px = this.offsetX + x * this.scale;
        const py = this.offsetY + y * this.scale;
        const length = (13 + current.strength * 0.48) * this.scale;
        const angle = Math.atan2(current.y, current.x);
        context.strokeStyle = `rgba(70, 183, 205, ${0.08 + strength * 0.19})`;
        context.lineWidth = (1 + strength * 1.1) * this.scale;
        context.beginPath();
        context.moveTo(px, py);
        context.lineTo(px + Math.cos(angle) * length, py + Math.sin(angle) * length);
        context.stroke();
        context.beginPath();
        context.arc(
          px + Math.cos(angle) * (length + 2),
          py + Math.sin(angle) * (length + 2),
          (1.5 + strength * 1.4) * this.scale,
          0, TAU
        );
        context.fillStyle = `rgba(105, 221, 235, ${0.13 + strength * 0.23})`;
        context.fill();
      }
    }
    context.restore();

    for (const gyre of world.flow.gyres) {
      const point = this.map(gyre.x, gyre.y);
      const radius = gyre.radius * this.scale * 0.68;
      context.save();
      context.translate(point.x, point.y);
      context.strokeStyle = gyre.strength > 0
        ? "rgba(68, 205, 219, 0.10)"
        : "rgba(121, 112, 255, 0.09)";
      context.lineWidth = 1;
      for (let ring = 0; ring < 3; ring += 1) {
        const start = time * gyre.strength * 0.035 + ring * 1.7;
        context.beginPath();
        context.arc(0, 0, radius * (0.5 + ring * 0.23), start, start + 1.45);
        context.stroke();
      }
      context.restore();
    }
  }

  drawRoute(world, frame) {
    const context = this.context;
    context.save();
    context.strokeStyle = "rgba(139, 220, 225, 0.20)";
    context.setLineDash([5 * this.scale, 9 * this.scale]);
    context.lineWidth = 1;
    context.beginPath();
    const first = this.map(world.starts[1].x, world.starts[1].y);
    context.moveTo(first.x, first.y);
    for (const checkpoint of world.checkpoints) {
      const point = this.map(checkpoint.x, checkpoint.y);
      context.lineTo(point.x, point.y);
    }
    context.stroke();
    context.restore();
  }

  drawObstacles(world) {
    for (const obstacle of world.obstacles) {
      const center = this.map(obstacle.x, obstacle.y);
      const radius = obstacle.radius * this.scale;
      const pulse = 0.5 + Math.sin(this.clock * 1.7 + obstacle.phase) * 0.5;

      const glow = this.context.createRadialGradient(center.x, center.y, radius * 0.2, center.x, center.y, radius * 2);
      glow.addColorStop(0, "rgba(242, 100, 73, 0.12)");
      glow.addColorStop(1, "rgba(242, 100, 73, 0)");
      this.context.fillStyle = glow;
      this.context.beginPath();
      this.context.arc(center.x, center.y, radius * 2, 0, TAU);
      this.context.fill();

      this.context.save();
      this.context.translate(center.x, center.y);
      this.context.strokeStyle = `rgba(255, 127, 91, ${0.28 + pulse * 0.22})`;
      this.context.lineWidth = 1;
      this.context.setLineDash([3, 5]);
      this.context.beginPath();
      this.context.arc(0, 0, radius + 6 * this.scale, 0, TAU);
      this.context.stroke();
      this.context.setLineDash([]);

      this.context.beginPath();
      obstacle.shape.forEach((point, index) => {
        const px = point.x * this.scale;
        const py = point.y * this.scale;
        if (index === 0) this.context.moveTo(px, py);
        else this.context.lineTo(px, py);
      });
      this.context.closePath();
      this.context.fillStyle = "#102329";
      this.context.fill();
      this.context.strokeStyle = "rgba(244, 120, 86, 0.58)";
      this.context.lineWidth = 1.2;
      this.context.stroke();
      this.context.strokeStyle = "rgba(103, 166, 163, 0.25)";
      this.context.lineWidth = 0.75;
      this.context.beginPath();
      this.context.moveTo(-radius * 0.55, radius * 0.18);
      this.context.lineTo(-radius * 0.08, -radius * 0.22);
      this.context.lineTo(radius * 0.45, radius * 0.12);
      this.context.stroke();
      this.context.restore();
    }
  }

  drawCheckpoints(world, frame) {
    const context = this.context;
    world.checkpoints.forEach((checkpoint, index) => {
      const center = this.map(checkpoint.x, checkpoint.y);
      const radius = CHECKPOINT_RADIUS * this.scale;
      const states = frame.boats.map((boat) => boat.completed > index);
      const completed = states.every(Boolean);
      const active = frame.boats.some((boat) => boat.completed === index);
      const pulse = 0.5 + Math.sin(this.clock * 2.1 + index) * 0.5;
      context.save();
      context.translate(center.x, center.y);
      if (active) {
        context.fillStyle = `rgba(255, 204, 108, ${0.05 + pulse * 0.08})`;
        context.beginPath();
        context.arc(0, 0, radius * (1.25 + pulse * 0.14), 0, TAU);
        context.fill();
      }
      context.strokeStyle = completed
        ? "rgba(102, 240, 209, 0.82)"
        : active
          ? "rgba(255, 213, 126, 0.86)"
          : "rgba(141, 195, 205, 0.44)";
      context.lineWidth = active ? 1.8 : 1;
      context.beginPath();
      context.arc(0, 0, radius, 0, TAU);
      context.stroke();
      context.beginPath();
      context.arc(0, 0, radius * 0.63, -0.7, 1.9);
      context.stroke();
      context.fillStyle = completed
        ? "rgba(147, 255, 227, 0.95)"
        : active
          ? "rgba(255, 224, 154, 0.9)"
          : "rgba(181, 221, 225, 0.65)";
      context.font = `600 ${10 * this.scale}px "Bahnschrift", monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(completed ? "✓" : checkpoint.label, 0, 0.5);
      context.restore();
    });
  }

  drawParticles(world, delta) {
    if (delta <= 0) return;
    const context = this.context;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    for (const particle of this.particles) {
      particle.age += delta;
      const current = currentAt(world, particle.x, particle.y, this.clock);
      particle.x += current.x * delta * 0.8;
      particle.y += current.y * delta * 0.8;
      if (particle.age > particle.life || particle.x < 0 || particle.x > WORLD.width || particle.y < 0 || particle.y > WORLD.height) {
        particle.age = 0;
        particle.x = 20 + ((particle.x * 17.3 + particle.tone * 811) % (WORLD.width - 40) + WORLD.width - 40) % (WORLD.width - 40);
        particle.y = 20 + ((particle.y * 11.7 + particle.tone * 401) % (WORLD.height - 40) + WORLD.height - 40) % (WORLD.height - 40);
        continue;
      }
      const alpha = Math.sin((particle.age / particle.life) * Math.PI) * 0.32;
      const point = this.map(particle.x, particle.y);
      context.strokeStyle = particle.tone > 0.56
        ? `rgba(82, 218, 218, ${alpha})`
        : `rgba(103, 153, 241, ${alpha * 0.78})`;
      context.lineWidth = (0.7 + particle.tone * 0.7) * this.scale;
      context.beginPath();
      context.moveTo(point.x, point.y);
      context.lineTo(
        point.x + current.x * 0.32 * this.scale,
        point.y + current.y * 0.32 * this.scale
      );
      context.stroke();
    }
    context.restore();
  }

  trailPath(points, frameIndex) {
    const context = this.context;
    context.beginPath();
    const limit = Math.min(frameIndex, points.length - 1);
    for (let index = 0; index <= limit; index += 1) {
      const point = this.map(points[index].x, points[index].y);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
  }

  drawTrails(run, frame) {
    const context = this.context;
    const frameIndex = run.frames.indexOf(frame);
    run.fleet.forEach((boat, index) => {
      const points = run.frames.map((entry) => entry.boats[index]);
      if (points.length < 2) return;
      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";
      context.shadowColor = boat.color;
      context.shadowBlur = 8 * this.scale;
      context.strokeStyle = `${boat.color}70`;
      context.lineWidth = 1.45 * this.scale;
      this.trailPath(points, frameIndex);
      context.stroke();
      context.shadowBlur = 0;
      context.strokeStyle = `${boat.color}38`;
      context.lineWidth = 4 * this.scale;
      this.trailPath(points, frameIndex);
      context.stroke();
      context.restore();
    });
  }

  drawGhost(run, previousRun) {
    if (!previousRun) return;
    const context = this.context;
    context.save();
    context.setLineDash([4 * this.scale, 7 * this.scale]);
    context.lineCap = "round";
    previousRun.fleet.forEach((boat, index) => {
      const points = previousRun.frames.map((frame) => frame.boats[index]);
      context.strokeStyle = `${boat.color}65`;
      context.lineWidth = 1.2 * this.scale;
      this.trailPath(points, points.length - 1);
      context.stroke();
    });
    context.restore();
  }

  drawCollisionEchoes(run, frame) {
    const context = this.context;
    for (const event of run.events) {
      const age = frame.time - event.time;
      if (event.type !== "collision" || age < 0 || age > 1.2) continue;
      const point = this.map(event.x, event.y);
      const progress = age / 1.2;
      context.save();
      context.strokeStyle = `rgba(255, 123, 84, ${(1 - progress) * 0.85})`;
      context.lineWidth = (2 - progress) * this.scale;
      context.beginPath();
      context.arc(point.x, point.y, (10 + progress * 42) * this.scale, 0, TAU);
      context.stroke();
      context.restore();
    }
  }

  drawBoats(world, frame) {
    const context = this.context;
    frame.boats.forEach((boat, index) => {
      const meta = FLEET[index];
      const checkpoint = world.checkpoints[Math.min(boat.completed, world.checkpoints.length - 1)];
      if (checkpoint && boat.status === "sailing") {
        const source = this.map(boat.x, boat.y);
        const target = this.map(checkpoint.x, checkpoint.y);
        context.save();
        context.strokeStyle = `${meta.color}2e`;
        context.setLineDash([3, 6]);
        context.beginPath();
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.stroke();
        context.restore();
      }

      const point = this.map(boat.x, boat.y);
      const size = 12.5 * this.scale;
      context.save();
      context.translate(point.x, point.y);
      context.rotate(boat.heading);
      context.globalAlpha = boat.status === "lost" ? 0.38 : 1;

      if (boat.status === "sailing") {
        const wake = context.createLinearGradient(-size * 3.2, 0, -size, 0);
        wake.addColorStop(0, `${meta.color}00`);
        wake.addColorStop(1, `${meta.color}55`);
        context.strokeStyle = wake;
        context.lineWidth = 1.4 * this.scale;
        context.beginPath();
        context.moveTo(-size * 3.2, -size * 0.28);
        context.lineTo(-size, -size * 0.18);
        context.moveTo(-size * 3.2, size * 0.28);
        context.lineTo(-size, size * 0.18);
        context.stroke();
      }

      context.shadowColor = meta.color;
      context.shadowBlur = 15 * this.scale;
      context.fillStyle = meta.color;
      context.beginPath();
      context.moveTo(size * 1.45, 0);
      context.lineTo(-size * 0.72, -size * 0.74);
      context.lineTo(-size * 0.3, 0);
      context.lineTo(-size * 0.72, size * 0.74);
      context.closePath();
      context.fill();
      context.shadowBlur = 0;
      context.fillStyle = "#061820";
      context.beginPath();
      context.arc(-size * 0.06, 0, size * 0.22, 0, TAU);
      context.fill();
      context.strokeStyle = "#d9fff7";
      context.lineWidth = 0.8 * this.scale;
      context.beginPath();
      context.moveTo(-size * 0.4, 0);
      context.lineTo(size * 0.65, 0);
      context.stroke();
      context.restore();

      context.save();
      context.font = `600 ${9 * this.scale}px "Bahnschrift", monospace`;
      context.fillStyle = `${meta.color}dd`;
      context.textAlign = "center";
      context.fillText(meta.callsign, point.x, point.y - 17 * this.scale);
      context.restore();
    });
  }

  drawVignette() {
    const context = this.context;
    const gradient = context.createRadialGradient(
      this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.26,
      this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.74
    );
    gradient.addColorStop(0, "rgba(0, 8, 13, 0)");
    gradient.addColorStop(1, "rgba(0, 7, 11, 0.54)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.width, this.height);

    context.strokeStyle = "rgba(105, 205, 210, 0.12)";
    context.lineWidth = 1;
    context.strokeRect(this.offsetX + 0.5, this.offsetY + 0.5, WORLD.width * this.scale - 1, WORLD.height * this.scale - 1);
  }
}
