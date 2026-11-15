// Canvas 分栏渲染：左 = 塔顶视角，右 = 塔底视角
// 严格按照引擎的 topView()/bottomView() 取数，保证信息不对称。

import { formatMs } from './engine.js';

const COLORS = {
  bg: '#0d1420',
  panel: '#16202f',
  panelLine: '#2a3a52',
  text: '#dce6f2',
  dim: '#7d8da3',
  good: '#4ade80',
  warn: '#fbbf24',
  bad: '#f87171',
  accent: '#60a5fa',
  arm: '#c9d6e8',
  target: '#38bdf8'
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function label(ctx, text, x, y, color = COLORS.dim, size = 13) {
  ctx.fillStyle = color;
  ctx.font = `${size}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(text, x, y);
}

function statusPill(ctx, text, ok, x, y) {
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = ok ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)';
  const w = ctx.measureText(text).width + 20;
  roundRect(ctx, x, y - 16, w, 24, 12);
  ctx.fill();
  label(ctx, text, x + 10, y + 1, ok ? COLORS.good : COLORS.bad, 13);
  return w;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  render(topView, bottomView, debugMode) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const half = w / 2;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    this._drawTop(topView, 0, 0, half, h);
    this._drawBottom(bottomView, half, 0, w - half, h);

    // 中央分隔线
    ctx.strokeStyle = COLORS.panelLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(half, 0);
    ctx.lineTo(half, h);
    ctx.stroke();

    if (debugMode) {
      label(ctx, '调试模式：双方状态全可见', half - 90, 22, COLORS.warn, 14);
    }
  }

  _panel(x, y, w, h, title) {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.panel;
    roundRect(ctx, x + 10, y + 10, w - 20, h - 20, 14);
    ctx.fill();
    ctx.strokeStyle = COLORS.panelLine;
    ctx.stroke();
    label(ctx, title, x + 26, y + 38, COLORS.text, 16);
  }

  _drawTop(v, x, y, w, h) {
    const ctx = this.ctx;
    this._panel(x, y, w, h, '塔顶 · 仪器维护位（玩家一：A / D / W / S / F）');

    const cx = x + w / 2;
    const cy = y + h * 0.38;

    // 风力表
    label(ctx, `风力 ${(v.windLevel * 100).toFixed(0)}%`, x + 30, y + 66, COLORS.dim);
    ctx.fillStyle = '#1f2c40';
    roundRect(ctx, x + 30, y + 76, w - 60, 12, 6);
    ctx.fill();
    ctx.fillStyle = v.windLevel > 0.75 ? COLORS.bad : v.windLevel > 0.45 ? COLORS.warn : COLORS.good;
    roundRect(ctx, x + 30, y + 76, (w - 60) * v.windLevel, 12, 6);
    ctx.fill();

    // 目标槽（固定）
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = COLORS.target;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(-70, 0);
    ctx.lineTo(70, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, '目标槽', -26, -12, COLORS.target, 12);

    // 摇臂（随风偏移，锁定后固定）
    ctx.rotate((v.armAngle * Math.PI) / 180);
    ctx.strokeStyle = v.pinEngaged ? COLORS.good : COLORS.arm;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-90, 0);
    ctx.lineTo(90, 0);
    ctx.stroke();
    ctx.fillStyle = COLORS.accent;
    ctx.beginPath();
    ctx.arc(90, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 转轴
    ctx.fillStyle = COLORS.text;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();

    // 锁定销
    ctx.fillStyle = v.pinEngaged ? COLORS.good : COLORS.warn;
    roundRect(ctx, cx - 8, cy + 26, 16, v.pinEngaged ? 34 : 18, 4);
    ctx.fill();
    label(ctx, v.pinEngaged ? '锁定销：已插入' : '锁定销：未锁定', cx - 72, cy + 82, v.pinEngaged ? COLORS.good : COLORS.warn, 13);

    // 对正状态
    const errText = `偏差 ${Math.abs(v.angleError).toFixed(1)}°（窗口 ±10°）`;
    label(ctx, errText, x + 30, cy + 118, v.aligned ? COLORS.good : COLORS.warn);

    // 仪器更换进度（只有塔顶看得到细节）
    const py = y + h * 0.72;
    label(ctx, `仪器更换 ${v.replacement}/${v.requiredReplacements}`, x + 30, py, COLORS.text);
    ctx.fillStyle = '#1f2c40';
    roundRect(ctx, x + 30, py + 12, w - 60, 16, 8);
    ctx.fill();
    ctx.fillStyle = COLORS.accent;
    const ratio = v.replacement >= v.requiredReplacements ? 1 : v.replaceProgress / v.replaceMs;
    roundRect(ctx, x + 30, py + 12, (w - 60) * ratio, 16, 8);
    ctx.fill();
    if (!v.powered && v.pinEngaged) {
      label(ctx, '供电已断开，更换进行中…', x + 30, py + 50, COLORS.good);
    }

    statusPill(ctx, v.linkOnline ? '链路在线' : '链路中断', v.linkOnline, x + 30, py + 84);
    label(ctx, `链路累计 ${formatMs(v.linkHoldAccum)} / ${formatMs(v.linkHoldTarget)}`, x + 130, py + 86, COLORS.dim);
  }

  _drawBottom(v, x, y, w, h) {
    const ctx = this.ctx;
    this._panel(x, y, w, h, '塔底 · 供电控制室（玩家二：Q / E / X / Enter）');

    // 三档供电状态
    const sources = [
      { key: 'main', name: '主电源' },
      { key: 'battery', name: '备用电池' },
      { key: 'off', name: '断开供电' }
    ];
    sources.forEach((src, i) => {
      const bx = x + 30 + i * ((w - 60) / 3 + 8);
      const bw = (w - 60) / 3 - 8;
      const active = v.powerSource === src.key;
      ctx.fillStyle = active ? 'rgba(96,165,250,0.22)' : '#1f2c40';
      roundRect(ctx, bx, y + 66, bw, 52, 10);
      ctx.fill();
      ctx.strokeStyle = active ? COLORS.accent : COLORS.panelLine;
      ctx.stroke();
      label(ctx, src.name, bx + 12, y + 90, active ? COLORS.accent : COLORS.dim, 14);
      if (src.key === 'main') {
        label(ctx, v.mainOnline ? '在线' : '周期中断', bx + 12, y + 110, v.mainOnline ? COLORS.good : COLORS.bad, 12);
      }
    });

    // 电池余量（只有塔底看得到）
    const by = y + h * 0.36;
    label(ctx, `备用电池 ${v.battery.toFixed(0)}%`, x + 30, by, COLORS.text);
    ctx.fillStyle = '#1f2c40';
    roundRect(ctx, x + 30, by + 10, w - 60, 18, 9);
    ctx.fill();
    ctx.fillStyle = v.battery < 20 ? COLORS.bad : v.battery < 50 ? COLORS.warn : COLORS.good;
    roundRect(ctx, x + 30, by + 10, (w - 60) * (v.battery / 100), 18, 9);
    ctx.fill();

    // 链路与宽限倒计时（只有塔底看得到宽限细节）
    const ly = y + h * 0.52;
    statusPill(ctx, v.linkOnline ? '通信链路在线' : '通信链路中断', v.linkOnline, x + 30, ly + 8);
    label(ctx, `链路累计 ${formatMs(v.linkHoldAccum)} / ${formatMs(v.linkHoldTarget)}`, x + 30, ly + 44, COLORS.dim);
    if (!v.linkOnline) {
      const left = Math.max(0, v.graceMs - v.linkDownAccum);
      label(ctx, `宽限剩余 ${formatMs(left)}，超时即失败`, x + 30, ly + 70, COLORS.bad);
      ctx.fillStyle = '#3a1d24';
      roundRect(ctx, x + 30, ly + 80, w - 60, 12, 6);
      ctx.fill();
      ctx.fillStyle = COLORS.bad;
      roundRect(ctx, x + 30, ly + 80, (w - 60) * (left / v.graceMs), 12, 6);
      ctx.fill();
    }

    // 更换计数（共享进度结果，但看不到塔顶操作细节）
    label(ctx, `已完成仪器更换 ${v.replacement}/${v.requiredReplacements}`, x + 30, y + h * 0.74, COLORS.text);
    label(ctx, v.powered ? '传感器供电中：无法更换' : '传感器已断电：允许塔顶更换', x + 30, y + h * 0.74 + 26, v.powered ? COLORS.warn : COLORS.good, 13);
  }

  drawAlarms(alarms, x, y, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a101b';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = COLORS.panelLine;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();
    label(ctx, '共享报警通道（两人唯一的沟通方式）', x + 18, y + 24, COLORS.text, 14);
    const recent = alarms.slice(-6);
    recent.forEach((alarm, i) => {
      const row = y + 48 + i * 22;
      const color = alarm.kind === '系统' ? COLORS.warn : alarm.kind === '塔顶' ? COLORS.accent : COLORS.good;
      label(ctx, `${formatMs(alarm.t)} [${alarm.kind}] ${alarm.message}`, x + 18, row, color, 12.5);
    });
  }

  drawOverlay(text, subText, color) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(8,12,20,0.72)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.font = 'bold 42px system-ui, sans-serif';
    ctx.fillText(text, this.canvas.width / 2, this.canvas.height / 2 - 10);
    ctx.fillStyle = COLORS.text;
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText(subText, this.canvas.width / 2, this.canvas.height / 2 + 32);
    ctx.textAlign = 'left';
  }
}
