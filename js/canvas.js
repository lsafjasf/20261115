import { frameGeometry, sampleRoute, sampleValues } from "./engine.js";

const COLORS = {
  ink: "#1a2023",
  paper: "#e5dfd2",
  paperDark: "#d5cec0",
  orange: "#ff7448",
  orangeSoft: "#ff9b7c",
  focus: "#41bda2",
  white: "#fffdf7",
  danger: "#ff5158",
};

export class StageRenderer {
  constructor(canvas, shell) {
    this.canvas = canvas;
    this.shell = shell;
    this.ctx = canvas.getContext("2d");
    this.project = null;
    this.time = 0;
    this.violation = null;
    this.playing = false;
    this.drag = null;
    this.displayWidth = 960;
    this.displayHeight = 540;
    this.scale = 1;
    this.onPositionDrag = null;
    this.onPositionDragEnd = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(shell);
    this.bindPointer();
    this.resize();
  }

  setData(project, time, violation, playing = false) {
    this.project = project;
    this.time = time;
    this.violation = violation;
    this.playing = playing;
    this.draw();
  }

  resize() {
    const availableWidth = Math.max(120, this.shell.clientWidth - 54);
    const availableHeight = Math.max(80, this.shell.clientHeight - 38);
    const aspect = this.project
      ? this.project.stage.width / this.project.stage.height
      : 16 / 9;
    let width = availableWidth;
    let height = width / aspect;
    if (height > availableHeight) {
      height = availableHeight;
      width = height * aspect;
    }

    this.displayWidth = Math.floor(width);
    this.displayHeight = Math.floor(height);
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.canvas.style.width = `${this.displayWidth}px`;
    this.canvas.style.height = `${this.displayHeight}px`;
    this.canvas.width = Math.round(this.displayWidth * dpr);
    this.canvas.height = Math.round(this.displayHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  draw() {
    if (!this.project) return;
    const ctx = this.ctx;
    const { width, height } = this.project.stage;
    const scaleX = this.displayWidth / width;
    const scaleY = this.displayHeight / height;
    this.scale = Math.min(scaleX, scaleY);

    ctx.save();
    ctx.clearRect(0, 0, this.displayWidth, this.displayHeight);
    ctx.scale(scaleX, scaleY);
    this.drawBackdrop(ctx);
    this.drawScene(ctx);
    this.drawSafeArea(ctx);
    this.drawRoute(ctx);

    const values = sampleValues(this.project, this.time);
    const frame = frameGeometry(this.project, values);
    this.drawKeyframeFrames(ctx);
    this.drawCameraMask(ctx, frame);
    this.drawFocus(ctx, frame);
    this.drawViewfinder(ctx, frame);
    ctx.restore();
  }

  drawBackdrop(ctx) {
    const { width, height } = this.project.stage;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#ece6d9");
    gradient.addColorStop(0.58, COLORS.paper);
    gradient.addColorStop(1, "#d9d2c4");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.strokeStyle = "rgba(33, 40, 42, 0.055)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    const glow = ctx.createRadialGradient(705, 190, 10, 705, 190, 280);
    glow.addColorStop(0, "rgba(255, 140, 94, 0.09)");
    glow.addColorStop(1, "rgba(255, 140, 94, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(340, 0, 620, 500);
  }

  drawScene(ctx) {
    ctx.save();

    ctx.fillStyle = "rgba(34, 40, 41, 0.09)";
    ctx.beginPath();
    ctx.arc(720, 210, 116, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(34, 40, 41, 0.18)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = "rgba(41, 47, 48, 0.075)";
    this.roundRect(ctx, 76, 112, 204, 152, 3);
    ctx.fill();
    this.roundRect(ctx, 302, 72, 112, 192, 3);
    ctx.fill();
    this.roundRect(ctx, 760, 92, 120, 174, 3);
    ctx.fill();

    ctx.fillStyle = "rgba(229, 223, 210, 0.76)";
    this.roundRect(ctx, 98, 138, 52, 84, 2);
    ctx.fill();
    this.roundRect(ctx, 166, 138, 82, 35, 2);
    ctx.fill();
    this.roundRect(ctx, 326, 95, 58, 128, 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(41, 47, 48, 0.26)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 392);
    ctx.bezierCurveTo(180, 364, 300, 420, 460, 396);
    ctx.bezierCurveTo(660, 368, 780, 412, 960, 382);
    ctx.stroke();

    ctx.fillStyle = "rgba(38, 44, 45, 0.12)";
    ctx.fillRect(0, 416, 960, 124);
    ctx.strokeStyle = "rgba(255, 253, 247, 0.18)";
    ctx.beginPath();
    ctx.moveTo(0, 416.5);
    ctx.lineTo(960, 416.5);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 253, 247, 0.16)";
    ctx.lineWidth = 1;
    for (let x = 30; x < 960; x += 68) {
      ctx.beginPath();
      ctx.moveTo(x, 428);
      ctx.lineTo(x - 24, 540);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(255, 116, 72, 0.95)";
    ctx.beginPath();
    ctx.arc(727, 292, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 253, 247, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(727, 292, 27, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(39, 44, 46, 0.92)";
    ctx.font = '600 8px "Ubuntu Mono", monospace';
    ctx.letterSpacing = "1px";
    ctx.fillText("TALENT / A", 697, 338);

    ctx.fillStyle = "rgba(34, 40, 41, 0.58)";
    ctx.font = '500 9px "Ubuntu Mono", monospace';
    ctx.fillText("NORTH TERRACE", 28, 462);
    ctx.fillStyle = "rgba(34, 40, 41, 0.3)";
    ctx.fillText("SET 04 / BLOCK C", 28, 476);

    ctx.strokeStyle = "rgba(33, 39, 41, 0.32)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(882, 64);
    ctx.lineTo(882, 126);
    ctx.moveTo(860, 86);
    ctx.lineTo(904, 86);
    ctx.stroke();

    ctx.restore();
  }

  drawSafeArea(ctx) {
    const { width, height } = this.project.stage;
    const insetX = width * 0.05;
    const insetY = height * 0.05;
    ctx.save();
    ctx.setLineDash([4, 7]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(25, 32, 34, 0.19)";
    ctx.strokeRect(insetX + 0.5, insetY + 0.5, width - insetX * 2, height - insetY * 2);
    ctx.fillStyle = "rgba(25, 32, 34, 0.34)";
    ctx.font = '500 7px "Ubuntu Mono", monospace';
    ctx.fillText("TITLE SAFE", insetX + 5, insetY + 12);
    ctx.restore();
  }

  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, width, height, radius);
    } else {
      ctx.rect(x, y, width, height);
    }
  }

  drawRoute(ctx) {
    const route = sampleRoute(this.project, 0.06);
    const now = Math.min(this.time, this.project.duration);
    const trace = route.filter((point) => point.time <= now);
    const current = sampleValues(this.project, now);
    trace.push({ time: now, x: current.position.x, y: current.position.y });
    if (trace.length < 2) trace.unshift(route[0]);

    ctx.save();
    this.buildPath(ctx, route);
    ctx.strokeStyle = "rgba(255, 253, 247, 0.75)";
    ctx.lineWidth = 3.6;
    ctx.lineJoin = "round";
    ctx.stroke();

    ctx.setLineDash([5, 7]);
    ctx.strokeStyle = "rgba(39, 45, 46, 0.45)";
    ctx.lineWidth = 1.25;
    ctx.lineDashOffset = -2;
    ctx.stroke();

    ctx.setLineDash([]);
    this.buildPath(ctx, trace);
    ctx.strokeStyle = this.violation ? COLORS.danger : COLORS.orange;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.stroke();

    this.project.keyframes.forEach((key, index) => {
      const x = key.values.position.x;
      const y = key.values.position.y;
      ctx.beginPath();
      ctx.arc(x, y, index === this.nearestKeyIndex() ? 5.2 : 3.8, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.white;
      ctx.fill();
      ctx.strokeStyle = COLORS.orange;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = "rgba(27, 32, 34, 0.7)";
      ctx.font = '600 7px "Ubuntu Mono", monospace';
      ctx.textAlign = "center";
      ctx.fillText(String(index + 1).padStart(2, "0"), x, y - 9);
    });

    const last = route[route.length - 1];
    const previous = route[Math.max(0, route.length - 4)];
    const angle = Math.atan2(last.y - previous.y, last.x - previous.x);
    ctx.translate(last.x, last.y);
    ctx.rotate(angle);
    ctx.fillStyle = "rgba(39, 45, 46, 0.55)";
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-3, -4);
    ctx.lineTo(-3, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  buildPath(ctx, points) {
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
  }

  nearestKeyIndex() {
    let index = 0;
    let distance = Infinity;
    this.project.keyframes.forEach((key, i) => {
      const delta = Math.abs(key.time - this.time);
      if (delta < distance) {
        distance = delta;
        index = i;
      }
    });
    return distance <= 0.08 ? index : -1;
  }

  drawKeyframeFrames(ctx) {
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "rgba(255, 253, 247, 0.42)";
    this.project.keyframes.forEach((key, index) => {
      if (Math.abs(key.time - this.time) < 0.07) return;
      const frame = frameGeometry(this.project, key.values);
      ctx.beginPath();
      frame.points.forEach((point, pointIndex) => {
        if (pointIndex === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 253, 247, 0.46)";
      ctx.font = '500 6px "Ubuntu Mono", monospace';
      ctx.textAlign = "left";
      ctx.fillText(`K${String(index + 1).padStart(2, "0")}`, frame.corners.topLeft.x + 3, frame.corners.topLeft.y + 10);
    });
    ctx.restore();
  }

  drawCameraMask(ctx, frame) {
    const { width, height } = this.project.stage;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    frame.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fillStyle = this.violation ? "rgba(71, 27, 30, 0.3)" : "rgba(20, 26, 28, 0.27)";
    ctx.fill("evenodd");
    ctx.restore();
  }

  drawFocus(ctx, frame) {
    const point = frame.focus;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 253, 247, 0.9)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(frame.center.x, frame.center.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = COLORS.focus;
    ctx.fillStyle = COLORS.focus;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 8.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(point.x, point.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(point.x - 15, point.y);
    ctx.lineTo(point.x - 10, point.y);
    ctx.moveTo(point.x + 10, point.y);
    ctx.lineTo(point.x + 15, point.y);
    ctx.moveTo(point.x, point.y - 15);
    ctx.lineTo(point.x, point.y - 10);
    ctx.moveTo(point.x, point.y + 10);
    ctx.lineTo(point.x, point.y + 15);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 253, 247, 0.94)";
    ctx.font = '600 6.5px "Ubuntu Mono", monospace';
    ctx.textAlign = "left";
    ctx.fillText("FOCUS", point.x + 17, point.y - 7);
    ctx.restore();
  }

  drawViewfinder(ctx, frame) {
    const color = this.violation ? COLORS.danger : COLORS.white;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.65;
    ctx.shadowColor = this.violation ? "rgba(255, 81, 88, .5)" : "rgba(0, 0, 0, .25)";
    ctx.shadowBlur = 5;
    ctx.beginPath();
    frame.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;

    const { topLeft, topRight, bottomRight, bottomLeft } = frame.corners;
    this.cornerBracket(ctx, topLeft, topRight, topLeft);
    this.cornerBracket(ctx, topRight, topLeft, bottomRight);
    this.cornerBracket(ctx, bottomRight, topRight, bottomLeft);
    this.cornerBracket(ctx, bottomLeft, bottomRight, topLeft);

    const topMid = {
      x: (topLeft.x + topRight.x) / 2,
      y: (topLeft.y + topRight.y) / 2,
    };
    const outward = normalize(topMid.x - frame.center.x, topMid.y - frame.center.y);
    const rotationHandle = { x: topMid.x + outward.x * 22, y: topMid.y + outward.y * 22 };
    ctx.strokeStyle = "rgba(255, 253, 247, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(topMid.x, topMid.y);
    ctx.lineTo(rotationHandle.x, rotationHandle.y);
    ctx.stroke();
    ctx.fillStyle = "#141b1d";
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(rotationHandle.x, rotationHandle.y, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 253, 247, 0.58)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(frame.center.x - 8, frame.center.y);
    ctx.lineTo(frame.center.x + 8, frame.center.y);
    ctx.moveTo(frame.center.x, frame.center.y - 8);
    ctx.lineTo(frame.center.x, frame.center.y + 8);
    ctx.stroke();
    ctx.fillStyle = COLORS.orange;
    ctx.beginPath();
    ctx.arc(frame.center.x, frame.center.y, 2.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '600 7px "Ubuntu Mono", monospace';
    ctx.textAlign = "left";
    ctx.fillStyle = color;
    ctx.fillText("CAM A / SHOT 08", topLeft.x + 8, topLeft.y + 15);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255, 253, 247, 0.76)";
    ctx.fillText(
      `SCALE ${(frame.scale * 100).toFixed(0)}%  ROT ${frame.rotation.toFixed(1)}°`,
      bottomRight.x - 8,
      bottomRight.y - 8,
    );
    ctx.restore();
  }

  cornerBracket(ctx, corner, horizontalNeighbor, verticalNeighbor) {
    const h = normalize(horizontalNeighbor.x - corner.x, horizontalNeighbor.y - corner.y);
    const v = normalize(verticalNeighbor.x - corner.x, verticalNeighbor.y - corner.y);
    const length = 20;
    ctx.beginPath();
    ctx.moveTo(corner.x + h.x * length, corner.y + h.y * length);
    ctx.lineTo(corner.x, corner.y);
    ctx.lineTo(corner.x + v.x * length, corner.y + v.y * length);
    ctx.stroke();
  }

  bindPointer() {
    this.canvas.addEventListener("pointerdown", (event) => {
      if (!this.project) return;
      const point = this.pointerToStage(event);
      const values = sampleValues(this.project, this.time);
      const frame = frameGeometry(this.project, values);
      if (!pointInPolygon(point, frame.points)) return;
      event.preventDefault();
      this.canvas.setPointerCapture(event.pointerId);
      this.drag = {
        pointerId: event.pointerId,
        start: point,
        origin: { x: values.position.x, y: values.position.y },
      };
      this.canvas.style.cursor = "grabbing";
    });

    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.project) return;
      if (!this.drag) {
        const point = this.pointerToStage(event);
        const frame = frameGeometry(this.project, sampleValues(this.project, this.time));
        this.canvas.style.cursor = pointInPolygon(point, frame.points) ? "grab" : "default";
        return;
      }
      if (event.pointerId !== this.drag.pointerId) return;
      const point = this.pointerToStage(event);
      const next = {
        x: this.drag.origin.x + point.x - this.drag.start.x,
        y: this.drag.origin.y + point.y - this.drag.start.y,
      };
      this.onPositionDrag?.(next);
    });

    const finishDrag = (event) => {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      this.drag = null;
      this.canvas.style.cursor = "grab";
      this.onPositionDragEnd?.();
    };
    this.canvas.addEventListener("pointerup", finishDrag);
    this.canvas.addEventListener("pointercancel", finishDrag);
  }

  pointerToStage(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * this.project.stage.width,
      y: ((event.clientY - rect.top) / rect.height) * this.project.stage.height,
    };
  }
}

function normalize(x, y) {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > point.y !== yj > point.y
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 0.00001) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
