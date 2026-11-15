const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const easeOut = (value) => 1 - Math.pow(1 - clamp(value, 0, 1), 3);

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (channel) =>
    amount < 0
      ? Math.round(channel * (1 + amount))
      : Math.round(channel + (255 - channel) * amount);
  return `rgb(${mix(r)} ${mix(g)} ${mix(b)})`;
}

export class LoomCanvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.rows = 16;
    this.pads = [];
    this.results = new Array(this.rows).fill(null);
    this.animation = null;
    this.frame = 0;
    this.reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    this.render = this.render.bind(this);
    this.draw();
  }

  setPads(pads) {
    this.pads = pads;
    this.draw();
  }

  reset() {
    this.cancelAnimation();
    this.results = new Array(this.rows).fill(null);
    this.draw();
  }

  setResults(results) {
    this.cancelAnimation();
    this.results = Array.from({ length: this.rows }, (_, index) => {
      const item = results[index];
      return item ? { ...item } : null;
    });
    this.draw();
  }

  showBeat(beat, result, duration) {
    this.cancelAnimation();
    this.results[beat] = { ...result };
    if (this.reducedMotion || result.status === "miss" || result.status === "rest") {
      this.draw();
      return;
    }
    this.animation = {
      beat,
      startedAt: performance.now(),
      duration: Math.max(120, Math.min(duration * 0.78, 520)),
    };
    this.frame = requestAnimationFrame(this.render);
  }

  cancelAnimation() {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.animation = null;
  }

  render(now) {
    this.frame = 0;
    if (!this.animation) {
      this.draw();
      return;
    }
    const progress = (now - this.animation.startedAt) / this.animation.duration;
    this.draw(progress);
    if (progress < 1) {
      this.frame = requestAnimationFrame(this.render);
    } else {
      this.animation = null;
      this.draw();
    }
  }

  draw(animationProgress = 0) {
    const { ctx, canvas } = this;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    this.drawWarpBase(width, height);

    const rowHeight = height / this.rows;
    for (let beat = 0; beat < this.rows; beat += 1) {
      const result = this.results[beat];
      if (!result) continue;
      const top = height - (beat + 1) * rowHeight;
      if (result.status === "hit") {
        const reveal =
          this.animation?.beat === beat ? easeOut(animationProgress) : 1;
        this.drawWeft(top, rowHeight, result.color, width, reveal);
      } else if (result.status === "error") {
        const reveal =
          this.animation?.beat === beat ? easeOut(animationProgress) : 1;
        this.drawWeft(top, rowHeight, result.color || "#8a6258", width, reveal);
        this.drawErrorRow(top, rowHeight, width, reveal);
      } else if (result.status === "miss") {
        this.drawMissingRow(top, rowHeight, width);
      }
    }

    this.drawWarpEdges(width, height, rowHeight);
    if (this.animation) {
      const progress = easeOut(animationProgress);
      const result = this.results[this.animation.beat];
      this.drawShuttle(animationProgress, result, width, height, rowHeight);
    }
  }

  drawWarpBase(width, height) {
    const { ctx } = this;
    const columnWidth = width / this.rows;
    const base = ctx.createLinearGradient(0, 0, 0, height);
    base.addColorStop(0, "#fbf7ec");
    base.addColorStop(0.5, "#fbf6ea");
    base.addColorStop(1, "#f8f2e5");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);

    for (let column = 0; column < this.rows; column += 1) {
      const x = column * columnWidth;
      const warp = ctx.createLinearGradient(x, 0, x + columnWidth, 0);
      warp.addColorStop(0, "rgba(255, 253, 245, 0.25)");
      warp.addColorStop(0.16, "rgba(251, 246, 234, 1)");
      warp.addColorStop(0.58, "rgba(251, 246, 234, 1)");
      warp.addColorStop(0.64, "rgba(249, 243, 230, 1)");
      warp.addColorStop(0.71, "rgba(246, 239, 224, 1)");
      warp.addColorStop(0.81, "rgba(243, 234, 216, 1)");
      warp.addColorStop(0.88, "rgba(244, 237, 220, 1)");
      warp.addColorStop(1, "rgba(251, 246, 234, 0.92)");
      ctx.fillStyle = warp;
      ctx.fillRect(x, 0, columnWidth + 0.5, height);

      ctx.strokeStyle = "rgba(117, 94, 66, 0.045)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + columnWidth * 0.63, 0);
      ctx.lineTo(x + columnWidth * 0.63, height);
      ctx.moveTo(x + columnWidth * 0.88, 0);
      ctx.lineTo(x + columnWidth * 0.88, height);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(95, 72, 46, 0.035)";
    for (let y = 8; y < height; y += 10) {
      ctx.fillRect(0, y, width, 1);
    }
  }

  drawWeft(top, rowHeight, color, width, reveal) {
    const { ctx } = this;
    const columnWidth = width / this.rows;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, width * reveal, rowHeight);
    ctx.clip();

    for (let column = 0; column < this.rows; column += 1) {
      const x = column * columnWidth;
      const parity = column % 2;
      const y = top + rowHeight * (parity ? 0.34 : 0.12);
      const bandHeight = rowHeight * (parity ? 0.63 : 0.64);
      const light = shade(color, 0.055);
      const middle = color;
      const dark = shade(color, -0.075);

      ctx.fillStyle = light;
      ctx.fillRect(x, y, columnWidth * 0.61, bandHeight);
      ctx.fillStyle = middle;
      ctx.fillRect(
        x + columnWidth * 0.61,
        y,
        columnWidth * 0.27,
        bandHeight,
      );
      ctx.fillStyle = dark;
      ctx.fillRect(
        x + columnWidth * 0.88,
        y,
        columnWidth * 0.12,
        bandHeight,
      );

      ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
      ctx.fillRect(x + 1, y + 1, columnWidth * 0.58, 1);
      ctx.fillStyle = "rgba(51, 35, 24, 0.11)";
      ctx.fillRect(x, y + bandHeight - 1, columnWidth, 1);
    }
    ctx.restore();
  }

  drawMissingRow(top, rowHeight, width) {
    const { ctx } = this;
    const columnWidth = width / this.rows;
    const y = top + rowHeight * 0.52;
    ctx.save();
    ctx.fillStyle = "rgba(105, 97, 87, 0.35)";
    for (let column = 0; column < this.rows; column += 1) {
      const x = column * columnWidth + columnWidth * 0.3;
      ctx.fillRect(x, y, columnWidth * 0.38, 1.5);
    }
    ctx.restore();
  }

  drawErrorRow(top, rowHeight, width, reveal) {
    const { ctx } = this;
    const columnWidth = width / this.rows;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, width * reveal, rowHeight);
    ctx.clip();
    ctx.strokeStyle = "rgba(53, 33, 27, 0.66)";
    ctx.lineWidth = 3;
    for (let column = 0; column < this.rows; column += 1) {
      const x = column * columnWidth + 3;
      ctx.beginPath();
      ctx.moveTo(x, top + rowHeight * 0.31);
      ctx.lineTo(x + 9, top + rowHeight * 0.55);
      ctx.moveTo(x + 9, top + rowHeight * 0.31);
      ctx.lineTo(x, top + rowHeight * 0.55);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawWarpEdges(width, height, rowHeight) {
    const { ctx } = this;
    const columnWidth = width / this.rows;
    ctx.save();
    ctx.strokeStyle = "rgba(95, 70, 43, 0.055)";
    ctx.lineWidth = 1;
    for (let column = 1; column < this.rows; column += 1) {
      const x = column * columnWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(84, 57, 31, 0.045)";
    for (let row = 0; row < this.rows; row += 1) {
      ctx.fillRect(0, row * rowHeight, width, 1);
    }
    ctx.restore();
  }

  drawShuttle(progress, result, width, height, rowHeight) {
    if (!result || result.status !== "hit") return;
    const { ctx } = this;
    const eased = easeOut(progress);
    const beat = this.animation.beat;
    const centerY = height - (beat + 0.5) * rowHeight;
    const x = clamp(width * eased - 5, 0, width - 50);

    ctx.save();
    ctx.shadowColor = "rgba(52, 35, 21, 0.28)";
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 4;
    const wood = ctx.createLinearGradient(0, centerY - 10, 0, centerY + 11);
    wood.addColorStop(0, "#b08b5d");
    wood.addColorStop(0.48, "#8a633c");
    wood.addColorStop(1, "#573e29");
    ctx.fillStyle = wood;
    ctx.beginPath();
    ctx.roundRect(x, centerY - 9, 46, 18, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255, 237, 201, 0.42)";
    ctx.beginPath();
    ctx.roundRect(x + 7, centerY - 6, 27, 3, 2);
    ctx.fill();
    ctx.fillStyle = shade(result.color, -0.12);
    ctx.fillRect(x + 3, centerY + 7, 41, 2);
    ctx.restore();
  }
}
