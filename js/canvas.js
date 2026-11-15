/* Canvas 绘制：闪光、实时波形、标记轨道、误差图。 */
const CanvasUI = {
  TRACK_RANGE_MS: 250,

  setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.width;
    const cssH = parseInt(canvas.getAttribute('height'), 10);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: cssW, h: cssH };
  },

  /* 顶部闪光条：flashPerfMs 列表，闪烁窗口 150ms。 */
  drawFlash(canvas, pulses, nowPerfMs) {
    const { ctx, w, h } = this.setup(canvas);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b0f18';
    ctx.fillRect(0, 0, w, h);

    let intensity = 0;
    for (const p of pulses) {
      const dt = nowPerfMs - p.flashPerfMs;
      if (dt >= 0 && dt <= 150) intensity = Math.max(intensity, 1 - dt / 150);
    }

    const cx = w / 2;
    const cy = h / 2;
    if (intensity > 0) {
      const r = 18 + (1 - intensity) * 26;
      const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r * 2.2);
      g.addColorStop(0, `rgba(255, 220, 120, ${0.95 * intensity})`);
      g.addColorStop(1, 'rgba(255, 220, 120, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 236, 170, ${intensity})`;
      ctx.fill();
    }
    ctx.strokeStyle = '#3a4a6b';
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#8b98ad';
    ctx.font = '12px sans-serif';
    ctx.fillText('视觉闪烁（已应用补偿）', 10, 18);
  },

  /* 实时波形（AnalyserNode），空闲时画静态脉冲形状。 */
  drawWave(canvas, engine) {
    const { ctx, w, h } = this.setup(canvas);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#2c3648';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    ctx.strokeStyle = '#4fc3f7';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (engine.analyser && engine.state() === 'running') {
      const data = new Uint8Array(engine.analyser.fftSize);
      engine.analyser.getByteTimeDomainData(data);
      for (let i = 0; i < data.length; i++) {
        const x = (i / data.length) * w;
        const y = ((data[i] - 128) / 128) * (h / 2 - 6) + h / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    } else if (engine.clickBuffer) {
      const d = engine.clickBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        const x = (i / d.length) * w * 0.4 + 10;
        const y = -d[i] * (h / 2 - 6) + h / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.fillStyle = '#8b98ad';
    ctx.font = '12px sans-serif';
    ctx.fillText('输出波形', 10, 14);
  },

  /* 标记轨道：每个脉冲一行，中线为闪烁中心，可拖动三角标记。 */
  drawTrack(canvas, pulses) {
    const { ctx, w, h } = this.setup(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!pulses.length) {
      ctx.fillStyle = '#8b98ad';
      ctx.font = '13px sans-serif';
      ctx.fillText('开始测试后，这里会显示每个脉冲的标记轨道', 14, 24);
      return;
    }
    const rowH = h / pulses.length;
    const cx = w / 2;
    const pxPerMs = (w / 2 - 70) / this.TRACK_RANGE_MS;

    pulses.forEach((p, i) => {
      const y = rowH * i + rowH / 2;
      ctx.strokeStyle = '#2c3648';
      ctx.beginPath();
      ctx.moveTo(60, y);
      ctx.lineTo(w - 10, y);
      ctx.stroke();

      ctx.strokeStyle = '#7bd88a';
      ctx.beginPath();
      ctx.moveTo(cx, y - 8);
      ctx.lineTo(cx, y + 8);
      ctx.stroke();

      ctx.fillStyle = '#8b98ad';
      ctx.font = '11px sans-serif';
      ctx.fillText('脉冲 ' + (i + 1), 8, y + 4);

      if (p.errorMs !== null && p.errorMs !== undefined) {
        const x = cx + p.errorMs * pxPerMs;
        ctx.fillStyle = Math.abs(p.errorMs) <= 15 ? '#7bd88a' : '#ffb454';
        ctx.beginPath();
        ctx.moveTo(x, y - 9);
        ctx.lineTo(x - 7, y + 6);
        ctx.lineTo(x + 7, y + 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#dbe4f0';
        const label = (p.errorMs >= 0 ? '+' : '') + p.errorMs.toFixed(0) + ' ms';
        ctx.fillText(label, Math.min(Math.max(x - 16, 64), w - 60), y - 12);
      }
    });

    ctx.fillStyle = '#8b98ad';
    ctx.font = '11px sans-serif';
    ctx.fillText('-' + this.TRACK_RANGE_MS + 'ms', 62, h - 4);
    ctx.fillText('+' + this.TRACK_RANGE_MS + 'ms', w - 52, h - 4);
  },

  /* 误差柱状图：每个脉冲的误差 + 均值线。 */
  drawErrors(canvas, pulses, meanMs) {
    const { ctx, w, h } = this.setup(canvas);
    ctx.clearRect(0, 0, w, h);
    const zeroY = h / 2;
    const pxPerMs = (h / 2 - 14) / this.TRACK_RANGE_MS;

    ctx.strokeStyle = '#2c3648';
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.strokeStyle = '#7bd88a';
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(w, zeroY);
    ctx.stroke();

    const marked = pulses.filter((p) => p.errorMs !== null && p.errorMs !== undefined);
    if (!marked.length) {
      ctx.fillStyle = '#8b98ad';
      ctx.font = '12px sans-serif';
      ctx.fillText('误差图：移动标记后显示', 10, 16);
      return;
    }

    const barW = Math.min(40, (w - 20) / marked.length - 6);
    marked.forEach((p, i) => {
      const x = 12 + i * ((w - 24) / marked.length);
      const bh = -p.errorMs * pxPerMs;
      ctx.fillStyle = Math.abs(p.errorMs) <= 15 ? '#7bd88a' : '#ffb454';
      ctx.fillRect(x, zeroY, barW, bh);
    });

    if (meanMs !== null && meanMs !== undefined) {
      const y = zeroY - meanMs * pxPerMs;
      ctx.strokeStyle = '#ff6b6b';
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff6b6b';
      ctx.font = '12px sans-serif';
      ctx.fillText('均值 ' + (meanMs >= 0 ? '+' : '') + meanMs.toFixed(1) + ' ms', 8, y - 5);
    }
  },
};

window.CanvasUI = CanvasUI;
